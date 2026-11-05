// SPDX-License-Identifier: GPL-3.0-or-later
import { gridCardSizeChoices } from './grid-view.mjs';
import { keyboardShortcutList } from './workspace.mjs';
// A draft of existing preferences, committed through the normal import transaction.
export class OnboardingController {
  constructor(app) { this.app = app; this.open = false; }
  maybeOpen() {
    if (!this.app.onboardingComplete && !this.open && !this.app.doc.hidden && this.app.root?.dataset.epReady === 'true') this.show();
  }
  show() {
    const app = this.app;
    if (this.open || app.disposed || !app.preferences.flush()) return;
    this.firstUse = !app.onboardingComplete;
    this.returnFocus = app.doc.activeElement;
    app.preview.hide(true);
    const dialog = app.node('dialog', null, 'epc-root epc-onboarding'); this.element = dialog;
    dialog.setAttribute('aria-labelledby', 'epc-welcome-title');
    const title = app.node('h2', 'Welcome to Empornium Companion'); title.id = 'epc-welcome-title';
    dialog.append(title, app.node('p', 'Reliable thumbnails, image grids, larger previews on hover, filters, grouped versions, saved searches, and more results on one page.'));
    dialog.append(app.node('p', 'These options—and much more—are available in Settings anytime. Reopen this setup with Settings → Getting started.', 'epc-caption'));
    const form = app.node('form'); this.form = form;
    const fresh = this.firstUse && !app.hasExistingPreferences;
    const mode = fresh ? 'pages' : app.settings.backfillMode;
    const field = (parent, label, control) => {
      const row = app.node('label', null, 'epc-welcome-field'); row.append(app.node('span', label), control); parent.append(row); return control;
    };
    const backfill = app.node('fieldset'); backfill.append(app.node('legend', 'When a torrent results page opens…'));
    for (const [value, label] of [['pages', 'Load a few more pages (recommended)'], ['all', 'Load all remaining pages'], ['off', 'Don’t automatically load more pages']]) {
      const input = app.node('input'); input.type = 'radio'; input.name = 'welcome-backfill'; input.value = value; input.checked = value === mode;
      const row = app.node('label', null, 'epc-welcome-choice'); row.append(input, app.node('span', label)); backfill.append(row);
    }
    this.pages = app.node('input'); this.pages.type = 'number'; this.pages.min = 1; this.pages.max = 15; this.pages.step = 1;
    this.pages.value = fresh ? 3 : app.settings.backfillPages;
    const countRow = app.node('div'); field(countRow, 'Additional pages', this.pages); backfill.append(countRow);
    const detail = app.node('p', '', 'epc-caption'); backfill.append(detail); form.append(backfill);
    const syncMode = () => {
      const selected = form.querySelector('[name="welcome-backfill"]:checked').value;
      countRow.hidden = selected !== 'pages'; this.pages.disabled = selected !== 'pages'; this.pages.required = selected === 'pages';
      detail.textContent = selected === 'pages' ? 'Added to the page already open, using your current search and filters.' :
        selected === 'all' ? 'Loads the remaining pages one at a time. Larger searches can use more memory. Stop is always available; loading pauses in the background.' :
          'You can still add pages yourself with Backfill results.';
    };
    backfill.addEventListener('change', syncMode); syncMode();
    this.size = app.node('select');
    const widths = new Map([[72, 'Compact · 72px'], [100, 'Balanced · 100px'], [140, 'Large · 140px']]);
    if (!widths.has(app.settings.thumbnailSize)) widths.set(app.settings.thumbnailSize, 'Current · ' + app.settings.thumbnailSize + 'px');
    for (const [value, label] of widths) { const option = app.node('option', label); option.value = value; this.size.append(option); }
    this.size.value = app.settings.thumbnailSize; field(form, 'Thumbnail size', this.size);
    const sample = app.node('div', 'Preview', 'epc-welcome-sample'); sample.setAttribute('aria-hidden', 'true');
    const syncSize = () => sample.style.setProperty('--epc-sample-width', this.size.value + 'px');
    this.size.addEventListener('change', syncSize); syncSize(); form.append(sample);
    this.hover = app.node('input'); this.hover.type = 'checkbox'; this.hover.checked = app.settings.previews;
    field(form, 'Enlarge thumbnails on hover', this.hover);
    form.append(app.node('p', 'Move away to dismiss the larger preview. Click to keep it open and show controls.', 'epc-caption'));
    this.group = app.node('input'); this.group.type = 'checkbox'; this.group.checked = app.settings.groupVersions;
    field(form, 'Group alternate video versions', this.group);
    form.append(app.node('p', 'Similar releases share a Show versions button. Every version stays accessible.', 'epc-caption'));
    this.view = app.node('select'); this.view.dataset.welcomeSetting = 'resultsView';
    for (const [value, label] of [['list', 'List'], ['grid', 'Grid · larger image cards']]) {
      const option = app.node('option', label); option.value = value; this.view.append(option);
    }
    this.view.value = app.settings.resultsView; field(form, 'Results layout', this.view);
    this.gridSize = app.node('select'); gridCardSizeChoices(this.gridSize, app.settings.gridCardWidth);
    this.gridSize.dataset.welcomeSetting = 'gridCardWidth';
    field(form, 'Grid card size', this.gridSize);
    this.gridLarge = app.node('input'); this.gridLarge.type = 'checkbox'; this.gridLarge.checked = app.settings.gridLargeImages;
    this.gridLarge.dataset.welcomeSetting = 'gridLargeImages';
    field(form, 'Automatically load larger images in grid view', this.gridLarge);
    form.append(app.node('p', 'Grid cards show thumbnails first, then replace them with larger images when ready. Larger images use more data. Grid card width is separate from list thumbnail width.', 'epc-caption'));
    this.shortcuts = app.node('input'); this.shortcuts.type = 'checkbox'; this.shortcuts.checked = app.settings.keyboardShortcuts;
    this.shortcuts.dataset.welcomeSetting = 'keyboardShortcuts';
    this.shortcuts.setAttribute('aria-controls', 'epc-welcome-shortcuts');
    field(form, 'Use keyboard shortcuts', this.shortcuts);
    const shortcuts = keyboardShortcutList(app); shortcuts.id = 'epc-welcome-shortcuts';
    const syncShortcuts = () => { shortcuts.hidden = !this.shortcuts.checked; };
    this.shortcuts.addEventListener('change', syncShortcuts); syncShortcuts(); form.append(shortcuts);
    const tags = app.node('details'); tags.append(app.node('summary', 'Personalize tags (optional)'), app.node('p', 'Separate tags with spaces. Blocked tags hide matching results; Favorite and Caution only highlight them.', 'epc-caption'));
    this.tags = new Map();
    for (const [key, label, value] of [['blocked', 'Blocked tags', app.storage.get('nseTaglist', '')], ['favoriteTags', 'Favorite tags', app.settings.favoriteTags], ['cautionTags', 'Caution tags', app.settings.cautionTags]]) {
      const input = app.node('textarea'); input.rows = 2; input.maxLength = 50000; input.value = value;
      field(tags, label, input); this.tags.set(key, input);
    }
    form.append(tags);
    this.status = app.node('p', '', 'epc-notice'); this.status.setAttribute('role', 'alert'); form.append(this.status);
    const actions = app.node('div', null, 'epc-actions');
    this.save = app.node('button', this.firstUse ? 'Start browsing' : 'Save changes', 'epc-primary'); this.save.type = 'submit';
    actions.append(this.save, app.button(this.firstUse ? 'Not now' : 'Cancel', () => this.dismiss())); form.append(actions);
    form.addEventListener('submit', event => { event.preventDefault(); this.finish(); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.dismiss(); });
    dialog.append(form); app.doc.body.append(dialog); this.open = true;
    if (dialog.showModal) dialog.showModal(); else { dialog.open = true; dialog.setAttribute('role', 'dialog'); }
    // Native dialogs handle focus containment and return it on close.
    const focus = form.querySelector('[name="welcome-backfill"]:checked'); focus.focus({ preventScroll: true });
  }
  finish() {
    const app = this.app;
    if (!this.open || !this.form.reportValidity()) return;
    const mode = this.form.querySelector('[name="welcome-backfill"]:checked').value;
    try {
      const current = app.exportData();
      const settings = { ...app.settings, backfillMode: mode,
        backfillEnabled: mode !== 'off' || app.settings.backfillEnabled,
        backfillPages: mode === 'pages' ? Number(this.pages.value) : app.settings.backfillPages,
        thumbnailSize: Number(this.size.value), previews: this.hover.checked, groupVersions: this.group.checked,
        resultsView: this.view.value, gridCardWidth: Number(this.gridSize.value), gridLargeImages: this.gridLarge.checked,
        keyboardShortcuts: this.shortcuts.checked,
        favoriteTags: this.tags.get('favoriteTags').value, cautionTags: this.tags.get('cautionTags').value };
      app.importData(JSON.stringify({ ...current, settings,
        nse: { ...current.nse, nseTaglist: this.tags.get('blocked').value } }), false, { completeOnboarding: true });
      app.onboardingComplete = true; this.close(); app.backfill.maybeAutomatic();
    } catch { this.status.textContent = 'Could not save setup. Your choices are still here. Please try again.'; }
  }
  dismiss() {
    try {
      if (this.firstUse) this.app.storage.set('ep.onboardingDone', true);
      this.app.onboardingComplete = true; this.close(); this.app.backfill.maybeAutomatic();
    } catch { this.status.textContent = 'Could not save. Please try again.'; }
  }
  close() {
    this.open = false;
    if (this.element?.close) this.element.close();
    this.element?.remove(); this.element = null;
    if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    this.form = this.tags = this.pages = this.size = this.hover = this.group = this.status = this.save = this.returnFocus = null;
    this.view = this.gridSize = this.gridLarge = this.shortcuts = null;
  }
  dispose() { this.close(); }
}
