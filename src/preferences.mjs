// SPDX-License-Identifier: GPL-3.0-or-later
import { validateSettings } from './core.mjs';

export class PreferencesController {
  constructor(app) { this.app = app; this.timer = null; this.checkpoint = app.storage.get('ep.preferenceUndo', null); }
  status(text) { if (this.app.saveStatus) this.app.saveStatus.textContent = text; }
  changed(target, event = {}) {
    if (!target.matches?.('[data-setting],[data-ep-filter-control]')) return;
    const app = this.app;
    app.dirty = true;
    if (target.hasAttribute('data-ep-filter-control')) app.filterDirty = true;
    app.win.clearTimeout(this.timer);
    this.status('Saving…');
    if (event.isComposing || app.composing) return;
    this.timer = app.win.setTimeout(() => this.flush(), event.type === 'change' ? 0 : 550);
  }
  beforeChange() {
    const app = this.app;
    if (!this.checkpoint || Date.now() - this.checkpoint.time > 30000) {
      const current = app.exportData();
      const next = { time: Date.now(), settings: current.settings, nse: current.nse };
      app.storage.set('ep.preferenceUndo', next); this.checkpoint = next;
    }
    if (app.undoPreferences) app.undoPreferences.hidden = false;
  }
  flush() {
    const app = this.app;
    app.win.clearTimeout(this.timer); this.timer = null;
    if (!app.dirty || app.composing || app.disposed) return true;
    const focused = app.doc.activeElement;
    const restore = focused?.matches?.('textarea[data-ep-filter-control],input[type=text][data-ep-filter-control]') ?
      { node: focused, value: focused.value, start: focused.selectionStart, end: focused.selectionEnd, scroll: focused.scrollTop } : null;
    let snapshot, checkpointBefore = this.checkpoint, filterChanged;
    const previousSettings = app.settings;
    try {
      const next = { ...app.settings };
      for (const [key, control] of app.controls) {
        if (control.type === 'number' && !control.checkValidity()) {
          control.setAttribute('aria-invalid', 'true'); this.status('Check the highlighted value.'); return false;
        }
        control.removeAttribute('aria-invalid');
        next[key] = control.type === 'checkbox' ? control.checked : control.type === 'number' ? Number(control.value) : control.value;
      }
      filterChanged = app.filterDirty;
      next.globalArrowNavigation = next.navigationScope === 'site';
      const checked = validateSettings(next);
      if (filterChanged) app.options.validateDraftFilters?.();
      const keys = new Set(['ep.settings', 'ep.preferenceUndo', 'nseArrowNavigationEnabled',
        ...(filterChanged ? app.storage.list().filter(key => key.startsWith('nse')) : [])]);
      snapshot = new Map([...keys].map(key => {
        const value = app.storage.get(key, undefined);
        return [key, value === undefined ? undefined : JSON.parse(JSON.stringify(value))];
      }));
      this.beforeChange(); app.savingPreferences = true;
      const arrow = app.doc.getElementById('nseCheckArrowNavigation');
      if (arrow) arrow.checked = next.navigationScope === 'results';
      if (filterChanged) app.options.flushNSE?.();
      const previous = app.settings;
      app.storage.set('ep.settings', checked);
      app.storage.set('nseArrowNavigationEnabled', checked.navigationScope === 'results');
      app.settings = checked;
      for (const key of ['favoriteTags', 'cautionTags']) if (app.controls.has(key) && app.doc.activeElement !== app.controls.get(key)) {
        app.controls.get(key).value = checked[key];
      }
      app.dirty = app.filterDirty = false;
      if (filterChanged) app.refreshFilters();
      app.updateMediaPreferences(previous);
      app.applyAppearance();
      this.status('Saved automatically');
      return true;
    } catch (error) {
      let restored = true;
      if (snapshot) {
        const keys = new Set([...snapshot.keys(), ...(filterChanged ? app.storage.list().filter(key => key.startsWith('nse')) : [])]);
        for (const key of keys) {
          try {
            const value = snapshot.get(key), current = app.storage.get(key, undefined);
            if (JSON.stringify(value) === JSON.stringify(current)) continue;
            if (value === undefined) app.storage.delete(key); else app.storage.set(key, value);
          } catch { restored = false; }
        }
        app.settings = previousSettings; this.checkpoint = checkpointBefore;
        if (app.undoPreferences) app.undoPreferences.hidden = !checkpointBefore;
        if (filterChanged && restored) app.refreshFilters();
      }
      app.dirty = true;
      if (filterChanged) app.filterDirty = true;
      this.status('Could not save. Your edits are still here.');
      app.toast(restored ? error.message || 'Preferences could not be saved.' : 'Storage failed and some preferences could not be restored. Your draft is still here.');
      return false;
    } finally {
      app.savingPreferences = false;
      if (restore && restore.node.isConnected && app.doc.activeElement === restore.node) {
        restore.node.value = restore.value;
        try { restore.node.setSelectionRange(restore.start, restore.end); } catch {}
        restore.node.scrollTop = restore.scroll;
      }
    }
  }
  cancel() {
    this.app.win.clearTimeout(this.timer); this.timer = null;
    this.app.dirty = this.app.filterDirty = false;
  }
  undo() {
    const app = this.app;
    if (!this.checkpoint) return;
    this.cancel();
    try {
      const current = app.exportData();
      const previous = this.checkpoint;
      app.importData(JSON.stringify({ ...current, settings: previous.settings, nse: previous.nse }), false);
      app.storage.delete('ep.preferenceUndo'); this.checkpoint = null;
      if (app.undoPreferences) app.undoPreferences.hidden = true;
      this.status('Changes restored'); app.toast('Recent preference changes undone.');
    } catch (error) { app.toast('Could not undo changes: ' + error.message); }
  }
}

export function captureFilterBaseline(app) {
  app.filterRows ||= new Map(); app.filterTags ||= new Map(); app.categoryCells ||= new Map();
  for (const row of app.doc.querySelectorAll('tr.torrent,#request_table tr')) if (!app.filterRows.has(row)) {
    app.filterRows.set(row, { hidden: row.classList.contains('hidden'), background: row.style.backgroundColor });
  }
  for (const tag of app.doc.querySelectorAll('#content div.tags')) if (!app.filterTags.has(tag)) {
    app.filterTags.set(tag, tag.classList.contains('hidden'));
  }
  for (const cell of app.doc.querySelectorAll('#content .cats_col,#content .cats_cols')) if (!app.categoryCells.has(cell)) {
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
