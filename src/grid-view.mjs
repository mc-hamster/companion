// SPDX-License-Identifier: GPL-3.0-or-later
import { resultTitleLink } from './result-tools.mjs';

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
  constructor(app) { this.app = app; this.tables = new Set(); this.cells = new Set(); this.headings = new Set(); }
  mount() {
    const app = this.app;
    this.toggle = app.button('Grid view', () => {
      const next = app.settings.resultsView === 'grid' ? 'list' : 'grid';
      if (!app.preferences.flush()) return;
      if (app.settings.resultsView === next) return;
      app.controls.get('resultsView').value = next;
      app.dirty = true; app.preferences.flush();
    });
    this.toggle.dataset.epGridToggle = '';
    this.toggle.setAttribute('aria-pressed', 'false');
    app.toolbar.append(this.toggle);
  }
  refresh() {
    const app = this.app, grid = app.settings.resultsView === 'grid';
    app.batchDOM(() => {
      for (const table of [...this.tables]) if (!table.isConnected || !grid) this.release(table);
      const candidates = new Set([...app.doc.querySelectorAll('#content tr.torrent')].map(row => row.closest('table')));
      // Retain managed tables when Hard Pass temporarily removes every row.
      for (const table of this.tables) candidates.add(table);
      for (const table of candidates) {
        if (!table || !grid) continue;
        this.tables.add(table); app.versions?.releaseLayout(table);
        table.classList.add('epc-result-grid');
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
        const fallback = ['Category', 'Name', 'Files', 'Comments', 'Added', 'Size', 'Snatches', 'Seeds', 'Peers', 'Uploader'];
        for (const row of table.querySelectorAll('tr.torrent')) {
          const title = resultTitleLink(row)?.closest('td');
          let column = 0;
          for (const cell of row.cells) {
            cell.dataset.epGridCell = cell === title ? 'title' : cell.matches('.cats_col,.cats_cols') ?
              app.storage.get('nseHideCategoryIconsEnabled', false) || app.settings.categoryDisplay === 'hide' ? 'category-hidden' : 'category' : 'meta';
            cell.dataset.epGridLabel = labels[column] || (row.cells.length === fallback.length ? fallback[column] : '');
            column += cell.colSpan; this.cells.add(cell);
          }
        }
      }
      for (const cell of this.cells) if (!cell.isConnected && !app.detachedFilterRows.has(cell.closest('tr'))) {
        delete cell.dataset.epGridCell; delete cell.dataset.epGridLabel; this.cells.delete(cell);
      }
    });
    if (this.toggle) {
      this.toggle.hidden = !(this.tables.size || app.doc.querySelector('#content tr.torrent') || app.detachedFilterRows.size);
      this.toggle.textContent = grid ? 'List view' : 'Grid view';
      this.toggle.setAttribute('aria-pressed', String(grid));
      this.toggle.title = grid ? 'Switch results to a list' : 'Switch results to larger image cards';
    }
  }
  release(table) {
    table.classList.remove('epc-result-grid'); table.style.removeProperty('--epc-grid-width'); this.tables.delete(table);
    for (const row of this.headings) if (!row.isConnected || row.closest('table') === table) {
      delete row.dataset.epGridHeader; this.headings.delete(row);
    }
    for (const cell of this.cells) if (!cell.isConnected || cell.closest('table') === table) {
      delete cell.dataset.epGridCell; delete cell.dataset.epGridLabel; this.cells.delete(cell);
    }
  }
  dispose() { for (const table of this.tables) this.release(table); this.toggle?.remove(); }
}
