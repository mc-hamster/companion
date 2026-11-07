// SPDX-License-Identifier: GPL-3.0-or-later
import { resultTitleLink } from './result-tools.mjs';
import { companionIcon } from './workspace.mjs';

export function gridCardSizeChoices(select, width) {
  const choices = new Map([[240, 'Compact · 240px'], [320, 'Balanced · 320px'], [420, 'Large · 420px'], [540, 'Extra large · 540px']]);
  if (!choices.has(width)) choices.set(width, 'Current · ' + width + 'px');
  select.replaceChildren();
  for (const [value, label] of choices) {
    const option = select.ownerDocument.createElement('option'); option.value = value; option.textContent = label; select.append(option);
  }
  select.value = width; select.required = true;
}

// Keep native rows, links and controls: both layouts share filtering and backfill.
export class ResultGrid {
  constructor(app) { this.app = app; this.tables = new Map(); this.cells = new Set(); this.headings = new Set(); }
  mount() {
    const app = this.app;
    this.layout = app.node('div', null, 'epc-layout-switch');
    this.layout.setAttribute('role', 'group');
    this.layout.setAttribute('aria-label', 'Results layout');
    this.layout.hidden = true;
    this.layoutButtons = new Map();
    for (const [value, label, help] of [['list', 'List', 'Show results in a list'], ['grid', 'Grid', 'Show results as image cards']]) {
      const button = app.button(label, () => {
        if (!app.preferences.flush() || app.settings.resultsView === value) return;
        app.controls.get('resultsView').value = value;
        app.dirty = true; app.preferences.flush();
      });
      button.prepend(companionIcon(app, value));
      button.dataset.epLayout = value;
      button.title = help;
      this.layoutButtons.set(value, button); this.layout.append(button);
    }
    this.syncControls();
    app.browseTools.prepend(this.layout);
  }
  syncControls() {
    for (const [value, button] of this.layoutButtons) button.setAttribute('aria-pressed', String(this.app.settings.resultsView === value));
    if (this.settingsSwitch) this.settingsSwitch.hidden = this.layout.hidden || this.app.settings.resultsView === 'grid';
  }
  settingsHelp() {
    const { app } = this;
    const help = app.node('div', null, 'epc-caption');
    this.settingsSwitch = app.button('Switch to Grid', () => {
      this.layoutButtons.get('grid').click();
      if (this.settingsSwitch.hidden) app.controls.get('resultsView').focus();
    });
    help.append(app.node('p', 'Grid spacing also applies to the site’s Cover Art grid. Cover playback has separate settings for Grid and List.'), this.settingsSwitch);
    this.syncControls();
    return help;
  }
  refresh() {
    const app = this.app, grid = app.settings.resultsView === 'grid';
    app.batchDOM(() => {
      app.doc.documentElement.toggleAttribute('data-ep-compact-cover-grid', app.settings.gridSpacing === 'compact');
      app.doc.documentElement.toggleAttribute('data-ep-list-autoplay', !grid && app.settings.listAutoplayGifs);
      for (const table of this.tables.keys()) if (!table.isConnected || !grid) this.release(table);
      const candidates = new Set(this.tables.keys());
      // Retain managed tables when Hard Pass temporarily removes every row.
      if (grid) for (const row of app.doc.querySelectorAll('#content tr.torrent')) candidates.add(row.closest('table'));
      for (const table of candidates) {
        if (!table || !grid) continue;
        app.versions?.releaseLayout(table);
        table.classList.add('epc-result-grid');
        table.dataset.epGridDetails = String(app.settings.gridShowDetails);
        table.dataset.epGridTags = String(app.settings.gridShowTags);
        table.dataset.epGridSpacing = app.settings.gridSpacing;
        table.style.setProperty('--epc-grid-width', app.settings.gridCardWidth + 'px');
        const headings = [...table.querySelectorAll('tr')].find(row => row.querySelector('th') || row.matches('.colhead_dark'));
        if (headings) {
          headings.dataset.epGridHeader = headings.querySelector('a,button,input,select') ? 'sortable' : 'static';
          this.headings.add(headings);
        }
        const labels = [];
        for (const cell of headings?.cells || []) {
          const label = cell.textContent.trim() || cell.getAttribute('title') || cell.querySelector('[title]')?.getAttribute('title') || '';
          for (let i = 0; i < cell.colSpan; i++) labels.push(label);
        }
        this.tables.set(table, labels);
        this.decorateRows(table.querySelectorAll('tr.torrent'), labels);
      }
      for (const cell of this.cells) if (!cell.isConnected && !app.detachedFilterRows.has(cell.closest('tr'))) {
        for (const link of cell.querySelectorAll('[data-ep-grid-title]')) delete link.dataset.epGridTitle;
        delete cell.dataset.epGridCell; delete cell.dataset.epGridLabel; this.cells.delete(cell);
      }
    });
    if (this.layout) {
      this.layout.hidden = !(this.tables.size || app.doc.querySelector('#content tr.torrent') || app.detachedFilterRows.size);
      this.syncControls();
    }
  }
  append(rows) {
    if (this.app.settings.resultsView === 'grid') {
      // One backfilled page appends to a single results table.
      const table = rows[0]?.closest('table');
      if (table && table.closest('#content')) {
        const labels = this.tables.get(table);
        if (!labels) { this.refresh(); return; }
        this.decorateRows(rows, labels);
      }
    }
    if (this.layout?.hidden && (rows.some(row => row.closest('#content')) || this.app.detachedFilterRows.size)) {
      this.layout.hidden = false;
      this.syncControls();
    }
  }
  decorateRows(rows, labels) {
    const { app } = this;
    const category = app.storage.get('nseHideCategoryIconsEnabled', false) || app.settings.categoryDisplay === 'hide' ? 'category-hidden' : 'category';
    const fallback = ['Category', 'Name', 'Files', 'Comments', 'Added', 'Size', 'Snatches', 'Seeds', 'Peers', 'Uploader'];
    for (const row of rows) {
      const link = resultTitleLink(row), title = link?.closest('td');
      if (link) link.dataset.epGridTitle = '';
      let column = 0;
      for (const cell of row.cells) {
        cell.dataset.epGridCell = cell === title ? 'title' : cell.matches('.cats_col,.cats_cols') ? category : 'meta';
        cell.dataset.epGridLabel = labels[column] || (row.cells.length === fallback.length ? fallback[column] : '');
        column += cell.colSpan; this.cells.add(cell);
      }
    }
  }
  release(table) {
    table.classList.remove('epc-result-grid'); table.style.removeProperty('--epc-grid-width'); this.tables.delete(table);
    delete table.dataset.epGridDetails;
    delete table.dataset.epGridTags;
    delete table.dataset.epGridSpacing;
    for (const row of this.headings) if (!row.isConnected || row.closest('table') === table) {
      delete row.dataset.epGridHeader; this.headings.delete(row);
    }
    for (const cell of this.cells) if (!cell.isConnected || cell.closest('table') === table) {
      for (const link of cell.querySelectorAll('[data-ep-grid-title]')) delete link.dataset.epGridTitle;
      delete cell.dataset.epGridCell; delete cell.dataset.epGridLabel; this.cells.delete(cell);
    }
  }
  dispose() {
    for (const table of this.tables.keys()) this.release(table);
    this.app.doc.documentElement.removeAttribute('data-ep-compact-cover-grid');
    this.app.doc.documentElement.removeAttribute('data-ep-list-autoplay');
    this.layout?.remove();
  }
}
