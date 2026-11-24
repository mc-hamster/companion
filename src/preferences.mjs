// SPDX-License-Identifier: GPL-3.0-or-later
import { DEFAULTS, validateSettings } from './core.mjs';
import { compileConditionalRules } from './conditional-rules.mjs';

const undoKey = 'ep.preferenceUndo';
export const SETTINGS_KEY = 'ep.settings';
const preferencePrefix = 'ep.preference.';
export const samePreference = (first, second) => first === second || JSON.stringify(first) === JSON.stringify(second);

export function readPreferenceValues(storage) {
  const stored = storage.get(SETTINGS_KEY);
  const values = stored && typeof stored === 'object' ? { ...stored } : {};
  for (const key of storage.list()) if (key.startsWith(preferencePrefix)) {
    const name = key.slice(preferencePrefix.length);
    if (Object.hasOwn(DEFAULTS, name)) values[name] = storage.get(key, values[name]);
  }
  return values;
}

export function addSettingsWrites(writes, before, after) {
  if (samePreference(before, after)) return;
  // Each edited preference has its own key so overlapping tab saves can retain both values.
  for (const [key, value] of Object.entries(after)) {
    if (!samePreference(before[key], value)) writes.set(preferencePrefix + key, value);
  }
  writes.set(SETTINGS_KEY, after);
}

export function writePreferences(storage, changes) {
  const attempted = [];
  const write = (key, value) => value === undefined ? storage.delete(key) : storage.set(key, value);
  try {
    for (const [key, value] of changes) {
      const before = storage.get(key);
      if (samePreference(before, value)) continue;
      attempted.push({ key, before, value });
      write(key, value);
    }
  } catch (error) {
    let restored = true;
    for (const { key, before, value } of attempted.reverse()) {
      try {
        if (samePreference(storage.get(key), value)) write(key, before);
      } catch { restored = false; }
    }
    if (!restored) throw new Error('Storage failed and some preferences could not be restored.', { cause: error });
    throw error;
  }
}

export class PreferencesController {
  constructor(app) {
    this.app = app; this.timer = null;
    this.settingsEdits = new Set(); this.filterEdits = new Set();
    this.checkpoint = app.storage.get(undoKey, null);
  }
  get dirty() { return !!(this.settingsEdits.size || this.filterEdits.size); }
  status(text) { if (this.app.saveStatus) this.app.saveStatus.textContent = text; }
  changed(target, event = {}) {
    const app = this.app;
    const key = target.dataset?.setting;
    if (key && app.controls.get(key) === target) this.settingsEdits.add(key);
    else if (target.id && (target.hasAttribute('data-ep-filter-control') || target.closest('#nseOuter'))) this.filterEdits.add(target.id);
    else return;
    app.win.clearTimeout(this.timer);
    this.status('Saving…');
    if (event.isComposing || app.composing) return;
    this.timer = app.win.setTimeout(() => this.flush(), event.type === 'change' ? 0 : 550);
  }
  refresh() {
    const { app } = this;
    if (!app.mounted || app.disposed || app.composing || this.dirty) return false;
    return app.applySavedSettings(app.storedSettings());
  }
  makeCheckpoint(before, after, filters, coalesce = true) {
    const now = Date.now(), current = this.checkpoint;
    const previous = coalesce && current?.applied && this.ownCheckpoint && now - current.time <= 30000 ? current : null;
    const settings = { ...previous?.settings }, nse = { ...previous?.nse };
    const applied = { settings: { ...previous?.applied.settings }, nse: { ...previous?.applied.nse } };
    const remember = (original, saved, key, oldValue, newValue) => {
      if (samePreference(oldValue, newValue)) return;
      if (!samePreference(saved[key], oldValue)) original[key] = oldValue;
      saved[key] = newValue;
      if (samePreference(original[key], newValue)) { delete original[key]; delete saved[key]; }
    };
    for (const [key, value] of Object.entries(after)) remember(settings, applied.settings, key, before[key], value);
    for (const [key, value] of filters) remember(nse, applied.nse, key, this.app.storage.get(key) ?? null, value ?? null);
    if (!Object.keys(settings).length && !Object.keys(nse).length) return null;
    return { time: previous?.time ?? now, settings, nse, applied };
  }
  setCheckpoint(checkpoint) {
    this.checkpoint = checkpoint;
    this.ownCheckpoint = !!checkpoint;
    if (this.app.undoPreferences) this.app.undoPreferences.hidden = !checkpoint;
  }
  flush(changes = {}) {
    const app = this.app;
    app.win.clearTimeout(this.timer); this.timer = null;
    const explicit = Object.keys(changes).length > 0;
    if (app.composing || app.disposed) return !explicit && !this.dirty;
    if (!this.dirty && !explicit) return true;
    const focused = app.doc.activeElement;
    const restore = this.filterEdits.has(focused?.id) && focused.matches('textarea,input[type=text]') ?
      { start: focused.selectionStart, end: focused.selectionEnd, scroll: focused.scrollTop } : null;
    try {
      const before = app.storedSettings();
      const next = { ...before };
      for (const key of this.settingsEdits) {
        const control = app.controls.get(key);
        const numeric = control.type === 'number' || control.hasAttribute('data-numeric');
        if (numeric && !control.checkValidity()) {
          control.setAttribute('aria-invalid', 'true'); this.status('Check the highlighted value.'); return false;
        }
        if (numeric) control.removeAttribute('aria-invalid');
        next[key] = control.type === 'checkbox' ? control.checked : numeric ? Number(control.value) : control.value;
      }
      Object.assign(next, changes);
      if (next.navigationScope !== before.navigationScope) next.globalArrowNavigation = next.navigationScope === 'site';
      const checked = validateSettings(next);
      if (checked.conditionalRules !== before.conditionalRules) compileConditionalRules(checked.conditionalRules);
      const filters = new Map(Object.entries(this.filterEdits.size ? app.options.readFilterDraft?.(this.filterEdits) || {} : {}));
      if (checked.navigationScope !== before.navigationScope) filters.set('nseArrowNavigationEnabled', checked.navigationScope === 'results');
      this.save(before, checked, filters);
      const syncedFilters = this.filterEdits.size > 0;
      this.cancel();
      app.applySavedSettings(checked, syncedFilters);
      this.status(Object.hasOwn(changes, 'conditionalRules') ? 'Rules saved' : 'Saved automatically');
      return true;
    } catch (error) {
      this.status('Could not save. Your edits are still here.');
      app.toast(error.message || 'Preferences could not be saved.');
      return false;
    } finally {
      if (restore && focused === app.doc.activeElement) {
        focused.setSelectionRange(restore.start, restore.end);
        focused.scrollTop = restore.scroll;
      }
    }
  }
  save(before, after, filters) {
    const writes = new Map(filters);
    addSettingsWrites(writes, before, after);
    if (![...writes].some(([key, value]) => !samePreference(this.app.storage.get(key), value))) return;
    const checkpoint = this.makeCheckpoint(before, after, filters);
    writes.set(undoKey, checkpoint ?? undefined);
    writePreferences(this.app.storage, writes);
    this.setCheckpoint(checkpoint);
  }
  saveVisibilityOverrides(blacklist, whitelist) {
    const { app } = this;
    try {
      this.saveFilters({ nseIndividualUploadHidingBlacklist: blacklist, nseIndividualUploadHidingWhitelist: whitelist });
    } catch (error) { app.toast(error.message); }
    app.scheduleFilterRefresh();
  }
  saveFilters(filters) {
    const { app } = this;
    const checked = app.options.validateNSE?.(filters) || filters;
    this.save(app.settings, app.settings, new Map(Object.entries(checked)));
  }
  cancel() {
    this.app.win.clearTimeout(this.timer); this.timer = null;
    this.settingsEdits.clear(); this.filterEdits.clear();
  }
  undo() {
    const app = this.app;
    if (!this.checkpoint) return;
    this.cancel();
    try {
      const { settings, nse, applied } = this.checkpoint;
      const current = app.storedSettings();
      if (applied) {
        const patch = { ...current };
        for (const [key, value] of Object.entries(settings)) if (samePreference(current[key], applied.settings[key])) patch[key] = value;
        const writes = new Map();
        for (const [key, value] of Object.entries(nse)) {
          if (samePreference(app.storage.get(key) ?? null, applied.nse[key])) writes.set(key, value ?? undefined);
        }
        const filtersChanged = writes.size > 0;
        const next = validateSettings(patch);
        addSettingsWrites(writes, current, next);
        if (samePreference(app.storage.get(undoKey), this.checkpoint)) writes.set(undoKey, undefined);
        writePreferences(app.storage, writes);
        app.applySavedSettings(next, filtersChanged, true);
      } else {
        const backup = app.exportData();
        app.importData(JSON.stringify({ ...backup, settings, nse }), false);
        if (samePreference(app.storage.get(undoKey), this.checkpoint)) app.storage.delete(undoKey);
      }
      this.setCheckpoint(null);
      this.status('Changes restored'); app.toast('Recent preference changes undone.');
    } catch (error) { app.toast('Could not undo changes: ' + error.message); }
  }
}

export function captureFilterBaseline(app, rows) {
  app.filterRows ||= new Map(); app.filterTags ||= new Map(); app.categoryCells ||= new Map();
  for (const row of rows || app.doc.querySelectorAll('tr.torrent,#request_table tr')) if (!app.filterRows.has(row)) {
    app.filterRows.set(row, { hidden: row.classList.contains('hidden'), background: row.style.backgroundColor });
  }
  const roots = rows || [app.doc];
  for (const root of roots) for (const tag of root.querySelectorAll('#content div.tags')) if (!app.filterTags.has(tag)) {
    app.filterTags.set(tag, tag.classList.contains('hidden'));
  }
  for (const root of roots) for (const cell of root.querySelectorAll('#content .cats_col,#content .cats_cols')) if (!app.categoryCells.has(cell)) {
    app.categoryCells.set(cell, { display: cell.style.display, next: cell.nextElementSibling,
      colspan: cell.nextElementSibling?.getAttribute('colspan') });
  }
}

export function restoreFilterBaseline(app) {
  for (const [row, marker] of app.detachedFilterRows) {
    if (marker.isConnected) { marker.before(row); marker.remove(); }
  }
  app.detachedFilterRows.clear(); app.removedFilterIDs.clear();
  for (const [row, original] of app.filterRows || []) {
    if (!row.isConnected) continue;
    row.classList.toggle('hidden', original.hidden);
    row.classList.remove('nseHardPassRemove', 'epc-revealed');
    row.removeAttribute('isNSEHidden');
    if (row.style.backgroundColor !== original.background) row.style.backgroundColor = original.background;
  }
  for (const node of app.doc.querySelectorAll('#content color.nseHiddenTitle,#content color.nseWhitelistedTitle,#content color.nseHardPassTitle,#content .nseToggleHideButton')) node.remove();
  const highlights = ['nseHiddenTag','nseHardPassTag','nseWhitelistedTag','nseHiddenUploader',
    'nseWhitelistedUploader','nseBlacklistIdentifier'];
  for (const name of highlights) for (const node of app.doc.querySelectorAll('#content .' + name)) node.classList.remove(name);
  for (const [tag, hidden] of app.filterTags || []) if (tag.isConnected) tag.classList.toggle('hidden', hidden);
  for (const [cell, original] of app.categoryCells || []) if (cell.isConnected) {
    if (cell.style.display !== original.display) cell.style.display = original.display;
    if (original.next) {
      if (original.colspan == null) original.next.removeAttribute('colspan');
      else original.next.setAttribute('colspan', original.colspan);
    }
  }
}
