// SPDX-License-Identifier: GPL-3.0-or-later
import { resultTitleLink } from './result-tools.mjs';
import { companionIcon } from './workspace.mjs';
import { setSettingHelp } from './setting-help.mjs';

const listColumnLabels = new Map([
  ['files', 'Files'], ['comments', 'Comments'], ['added', 'Added'], ['size', 'Size'],
  ['snatches', 'Snatches'], ['seeds', 'Seeds'], ['peers', 'Peers'], ['uploader', 'Uploader']
]);
const listColumnAliases = new Map([
  ['files', 'files'], ['file count', 'files'], ['comments', 'comments'], ['added', 'added'], ['time', 'added'], ['date added', 'added'],
  ['size', 'size'], ['snatches', 'snatches'], ['snatched', 'snatches'], ['seeds', 'seeds'], ['seeders', 'seeds'],
  ['peers', 'peers'], ['leechers', 'peers'], ['leeches', 'peers'], ['uploader', 'uploader'], ['uploaded by', 'uploader']
]);
const columnKey = cell => {
  const labels = [cell.textContent, cell.title, ...[...cell.querySelectorAll('img[alt],[title],[aria-label]')]
    .flatMap(node => [node.alt, node.title, node.getAttribute('aria-label')])];
  for (const label of labels) {
    const key = listColumnAliases.get((label || '').trim().toLowerCase().replace(/^(?:sort|order) by /, ''));
    if (key) return key;
  }
  const sort = cell.querySelector('a[href*="order_by="]');
  if (sort) return listColumnAliases.get(new URL(sort.href).searchParams.get('order_by'));
};

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
  constructor(app) {
    this.app = app; this.tables = new Map(); this.cells = new Set(); this.headings = new Set();
    this.listTables = new Map(); this.hiddenCells = new Set(); this.listSpans = new Map();
  }
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
    app.toolbarContext.append(this.layout);
    this.columns = app.node('details', null, 'epc-columns');
    this.columns.hidden = true;
    this.columns.append(app.node('summary', 'Columns'));
    this.columnOptions = app.node('div', null, 'epc-column-options');
    this.columns.append(this.columnOptions);
    const control = app.node('input'); control.type = 'hidden'; control.hidden = true;
    control.value = app.settings.listHiddenColumns; control.dataset.setting = 'listHiddenColumns';
    app.controls.set('listHiddenColumns', control);
    app.toolbarContext.append(this.columns, control);
  }
  syncListColumns(grid) {
    const { app } = this;
    this.clearListColumns();
    if (!this.columns) return;
    const hidden = new Set(app.settings.listHiddenColumns.split(' '));
    const available = new Map(), sorts = new Map();
    const tables = new Set(grid ? [] : [...app.doc.querySelectorAll('#content table')]
      .filter(table => table.querySelector(':scope > tbody > tr.torrent, :scope > tr.torrent')));
    if (!grid) for (const marker of app.detachedFilterRows.values()) {
      const table = marker.parentElement?.closest('table');
      if (table) tables.add(table);
    }
    if (!grid) for (const table of tables) {
      const header = [...table.rows].find(row => row.matches('.colhead,.colhead_dark') || row.closest('thead') || row.querySelector('th'));
      if (!header) continue;
      const columns = [...header.cells].flatMap(cell => Array(cell.colSpan).fill(cell.colSpan === 1 ? columnKey(cell) : undefined));
      const keys = new Set(columns.filter(Boolean));
      if (!keys.size) continue;
      const duplicates = new Set(columns.filter((key, index) => key && columns.indexOf(key) !== index));
      for (const key of duplicates) keys.delete(key);
      if (!keys.size) continue;
      for (const cell of header.cells) {
        const key = cell.colSpan === 1 && columnKey(cell);
        if (!keys.has(key)) continue;
        available.set(key, listColumnLabels.get(key));
        const sort = cell.querySelector('a[href]');
        if (sort && !sorts.has(key)) sorts.set(key, sort);
        if (hidden.has(key)) this.hideListCell(cell);
      }
      const selected = new Set([...keys].filter(key => hidden.has(key)));
      if (!selected.size) continue;
      app.versions?.releaseLayout(table);
      table.setAttribute('data-ep-list-columns', '');
      this.listTables.set(table, { columns, selected });
      this.applyListRows(table.querySelectorAll('tr.torrent'), columns, selected);
      for (const row of table.rows) {
        const cell = row.cells.length === 1 && row.cells[0];
        if (cell && cell.colSpan === columns.length) {
          this.listSpans.set(cell, cell.getAttribute('colspan'));
          cell.colSpan -= selected.size;
        }
      }
    }
    this.columns.hidden = !available.size;
    if (this.columns.hidden) this.columns.open = false;
    const optionsKey = JSON.stringify([...available].map(([key, label]) => [key, label, hidden.has(key), sorts.get(key)?.href]));
    if (this.columnOptionsKey === optionsKey) return;
    this.columnOptionsKey = optionsKey;
    const focused = app.doc.activeElement?.dataset.columnChoice;
    this.columnOptions.replaceChildren(app.node('p', 'Show in List', 'epc-caption'));
    for (const [key, label] of available) {
      const line = app.node('div', null, 'epc-column-option');
      const field = app.node('label');
      const input = app.node('input'); input.type = 'checkbox'; input.checked = !hidden.has(key);
      input.dataset.columnChoice = key;
      input.addEventListener('change', () => {
        const next = new Set(app.settings.listHiddenColumns.split(' ').filter(Boolean));
        if (input.checked) next.delete(key); else next.add(key);
        app.controls.get('listHiddenColumns').value = [...next].join(' ');
        app.dirty = true;
        if (!app.preferences.flush()) {
          input.checked = !input.checked;
          app.controls.get('listHiddenColumns').value = app.settings.listHiddenColumns;
        }
      });
      field.append(input, app.node('span', label)); line.append(field);
      if (hidden.has(key) && sorts.has(key)) {
        const link = app.node('a', 'Sort'); link.href = sorts.get(key).href;
        link.setAttribute('aria-label', 'Sort by ' + label); line.append(link);
      }
      this.columnOptions.append(line);
      if (key === focused) input.focus({ preventScroll: true });
    }
  }
  hideListCell(cell) {
    cell.setAttribute('data-ep-list-column-hidden', ''); this.hiddenCells.add(cell);
  }
  applyListRows(rows, columns, selected) {
    for (const row of rows) {
      let index = columns.length;
      const title = resultTitleLink(row)?.closest('td');
      for (const cell of [...row.cells].reverse()) {
        if (cell === title) break;
        index -= cell.colSpan;
        if (!title || cell.colSpan !== 1) continue;
        if (selected.has(columns[index])) this.hideListCell(cell);
      }
    }
  }
  clearListColumns() {
    for (const cell of this.hiddenCells) cell.removeAttribute('data-ep-list-column-hidden');
    for (const table of this.listTables.keys()) table.removeAttribute('data-ep-list-columns');
    for (const [cell, span] of this.listSpans) cell.setAttribute('colspan', span);
    this.hiddenCells.clear(); this.listTables.clear(); this.listSpans.clear();
  }
  syncControls() {
    for (const [value, button] of this.layoutButtons) button.setAttribute('aria-pressed', String(this.app.settings.resultsView === value));
    if (this.settingsSwitch) this.settingsSwitch.hidden = this.layout.hidden || this.app.settings.resultsView === 'grid';
  }
  settingsHelp() {
    const { app } = this;
    const help = app.node('div', null, 'epc-caption');
    this.settingsSwitch = setSettingHelp(app.button('Switch to Grid', () => {
      this.layoutButtons.get('grid').click();
      if (this.settingsSwitch.hidden) app.controls.get('resultsView').focus();
    }), 'Apply the Grid layout to the current results so you can see your card settings.');
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
      this.syncListColumns(grid);
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
    } else {
      const table = rows[0]?.closest('table');
      const layout = this.listTables.get(table);
      if (layout) this.applyListRows(rows, layout.columns, layout.selected);
      else if (table && this.app.settings.listHiddenColumns) this.refresh();
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
    this.clearListColumns(); this.columns?.remove();
    for (const table of this.tables.keys()) this.release(table);
    this.app.doc.documentElement.removeAttribute('data-ep-compact-cover-grid');
    this.app.doc.documentElement.removeAttribute('data-ep-list-autoplay');
    this.layout?.remove();
  }
}
