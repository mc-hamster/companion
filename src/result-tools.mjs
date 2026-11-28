// SPDX-License-Identifier: GPL-3.0-or-later
// Independently implemented after reviewing Collapse Duplicates, Coalesce
// Variations, and the Emp++/Luminance tag highlighters. See THIRD_PARTY.md.
import { relativeLuminance, tagCategoriesWithTags, tagCategorySettings, tagHighlightPreferences, tagListTokens } from './core.mjs';
import { samePreference } from './preferences.mjs';
import { applyWorkspaceTheme } from './workspace.mjs';

const resultTagSelector = 'div.tags > a';
const detailTagSelector = 'ul#torrent_tags_list > li > a';

export function styleHighlight(element, color) {
  if (!color) {
    element.style.removeProperty('--epc-tag-background');
    element.style.removeProperty('--epc-tag-foreground');
    return;
  }
  const luminance = relativeLuminance(color.slice(1).match(/../g).map(hex => parseInt(hex, 16)));
  element.style.setProperty('--epc-tag-background', color);
  element.style.setProperty('--epc-tag-foreground', luminance > 0.179 ? '#000' : '#fff');
}

export function resultTitleLink(row) {
  return [...row.querySelectorAll('td a[href*="torrents.php"]')].find(link => {
    if (!link.textContent.trim() || link.closest('.tags,.torrent_icon_container,.epc-thumbnail,.epc-grid-card-actions,.epc-versions')) return false;
    try { const url = new URL(link.href); return url.searchParams.has('id') && !url.searchParams.has('action'); }
    catch { return false; }
  });
}

function versionDownloadLink(row, detail, origin) {
  const id = detail.searchParams.get('id');
  if (detail.origin !== origin || detail.pathname !== '/torrents.php' || !/^[1-9]\d{0,14}$/.test(id || '')) return;
  return [...row.querySelectorAll('a[href*="action=download"]:not(.epc-version-download)')].find(link => {
    try {
      const url = new URL(link.href);
      const actions = url.searchParams.getAll('action'), ids = url.searchParams.getAll('id');
      return url.origin === origin && url.pathname === detail.pathname && !url.username && !url.password &&
        actions.length === 1 && actions[0] === 'download' && ids.length === 1 && ids[0] === id &&
        !url.searchParams.has('usetoken');
    } catch { return false; }
  });
}

export function parseVersionTitle(value) {
  const hits = [];
  const take = token => { hits.push(token.trim().replace(/\s+/g, ' ')); return ' '; };
  // Only technical differences are removed. Dates, studios, performers, cuts,
  // parts, fixes, and censoring remain in the identity, including inside [].
  const technical = /\b(?:\d{3,5}\s*[x×]\s*\d{3,5}(?:p|i)?|\d{3,5}[pi](?:\d{2,3})?|[2-9]k(?:uhd)?|\d{3,5}px|(?:h[. ]?26[45]|x[. ]?26[45]|hevc|avc|(?:svt-)?av1)|\d+(?:[.,]\d+)?\s*(?:[km]b(?:it)?\/?s|[km]bps|fps)|(?:8|10|12)[ -]?bit)\b/gi;
  const soft = /\b(?:mp4|mkv|wmv|mov|avi|mpeg4|web[ -]?dl|web[ -]?rip|blu[ -]?ray|uhd|fhd|fullhd|hd|sd|hq|lq|(?:higher|lower|high|low)[ -]?bitrate|hbr|lbr)\b/gi;
  const clean = text => text.replace(/[\s,;/+._-]+/g, ' ').trim();
  let title = String(value || '').normalize('NFKC').trim();
  title = title.replace(/\[([^\[\]]*)\]|\(([^()]*)\)|\{([^{}]*)\}|\*([^*]+)\*/g, (whole, ...parts) => {
    const inner = parts.slice(0, 4).find(part => part !== undefined);
    const before = hits.length;
    let remainder = inner.replace(technical, take);
    if (hits.length > before || !clean(remainder.replace(soft, ' '))) remainder = remainder.replace(soft, take);
    // Bare resolutions are safe inside a descriptor, not inside a scene name.
    const bare = /\b(?:240|360|480|540|576|720|1080|1440|2160|2880|4320)\b/g;
    if (!clean(remainder.replace(bare, ' '))) remainder = remainder.replace(bare, take);
    remainder = clean(remainder);
    return remainder ? whole[0] + remainder + whole.at(-1) : ' ';
  });
  title = title.replace(technical, take);
  // Ambiguous descriptors such as HD and MP4 are recognized only at the end.
  const tail = /(?:^|[\s,;/+._-])((?:mp4|mkv|wmv|mov|avi|mpeg4|web[ -]?dl|web[ -]?rip|blu[ -]?ray|uhd|fhd|fullhd|hd|sd|hq|lq|hbr|lbr|(?:higher|lower|high|low)[ -]?bitrate|240|360|480|540|576|720|1080|1440|2160|2880|4320))\s*$/i;
  let match;
  while ((match = title.match(tail))) { take(match[1]); title = title.slice(0, match.index).trim(); }
  title = title.replace(/\s+/g, ' ').replace(/^[\s,;/+._-]+|[\s,;/+._-]+$/g, '').trim();
  const key = title.toLocaleLowerCase().replace(/[\s._–—-]+/g, ' ').trim();
  return { title, key: /\p{L}/u.test(key) && key.replace(/[^\p{L}\p{N}]/gu, '').length >= 6 ? key : '',
    label: [...new Set(hits.map(hit => hit.toUpperCase()))].join(' · ') || 'Other version', hits };
}

function gridCardActions(app, title) {
  const existing = title.parentElement.querySelector(':scope > .epc-grid-card-actions');
  if (existing) return existing;
  const actions = app.node('div', null, 'epc-grid-card-actions');
  title.after(actions);
  return actions;
}

function removeGridCardAction(control) {
  const actions = control?.parentElement;
  control?.remove();
  if (actions?.classList.contains('epc-grid-card-actions') && !actions.children.length) actions.remove();
}

export class VersionGroups {
  constructor(app) {
    this.app = app; this.rows = new Map(); this.moves = new Map(); this.controls = new Map();
    this.tables = new WeakMap(); this.nextTable = 0; this.nextRow = 0; this.collapsed = 0; this.groups = new Map();
    this.expanded = { list: new Set(), grid: new Set() };
    this.layouts = new Map(); this.candidates = new Map();
  }
  captureOrder(rows = this.app.doc.querySelectorAll('tr.torrent')) {
    for (const row of rows) if (row.matches('tr.torrent') && !this.rows.has(row)) {
      this.rows.set(row, { order: ++this.nextRow, originalID: row.id });
    }
  }
  collectCandidates(rows) {
    this.captureOrder(rows);
    const affected = new Set();
    for (const row of rows) {
      if (!row.isConnected || row.matches('.epc-revealed,.epc-seen-revealed,.epc-filter-hidden') || row.hidden ||
          row.classList.contains('nseHardPassRemove') || row.classList.contains('hidden')) continue;
      const link = resultTitleLink(row); if (!link) continue;
      const entry = this.rows.get(row);
      const source = link.textContent;
      if (entry.source !== source) {
        const title = link.cloneNode(true); for (const annotation of title.querySelectorAll('color')) annotation.remove();
        entry.source = source; entry.parsed = parseVersionTitle(title.textContent);
      }
      const parsed = entry.parsed;
      const table = row.closest('tbody,table'); if (!table || !parsed.key) continue;
      if (!this.tables.has(table)) this.tables.set(table, ++this.nextTable);
      const category = row.querySelector('.cats_col [title],.cats_cols [title]')?.getAttribute('title') || '';
      // Games and image sets have different notions of a version; leave them intact.
      if (/games?|apps?|images?|pictures?|magazines?|manga|comics?/i.test(category)) continue;
      const key = this.tables.get(table) + ':' + category + ':' + parsed.key;
      if (!this.candidates.has(key)) this.candidates.set(key, []);
      this.candidates.get(key).push({ row, link, parsed, entry }); affected.add(key);
    }
    return affected;
  }
  renderGroup(key) {
    const { app } = this;
    const candidates = this.candidates.get(key);
    if (candidates.length < 2 || !candidates.some(item => item.parsed.hits.length)) return;
    const group = [...candidates].sort((a, b) => a.entry.order - b.entry.order);
    const [head, ...members] = group;
    const grid = app.settings.resultsView === 'grid' && !!head.row.closest('#content');
    const expanded = grid ? this.expanded.grid : this.expanded.list;
    const open = expanded.has(key);
    const ids = members.map(({ row, entry }) => {
      if (!row.id) row.id = 'epc-version-row-' + entry.order;
      return row.id;
    });
    let entry = this.controls.get(head.row);
    if (!entry) {
      const root = app.node('div', null, 'epc-versions');
      const list = app.node('ul', null, 'epc-version-list');
      list.setAttribute('aria-label', 'Versions');
      const control = app.button('', () => this.toggleGroup(control.dataset.versionKey));
      control.className = 'epc-version-control';
      root.append(list, control);
      this.controls.set(head.row, entry = { root, list, control });
    }
    const { root, control } = entry;
    const titleCell = head.link.closest('td');
    if (root.parentElement !== titleCell) titleCell.insertBefore(root, titleCell.querySelector(':scope > .tags'));
    this.renderOptions(entry, group);
    if (!open) this.collapsed += group.length - (this.groups.get(key)?.group.length || 1);
    this.groups.set(key, { group, control, expanded });
    control.dataset.versionKey = key;
    control.setAttribute('aria-controls', ids.join(' '));
    let previous = head.row;
    for (const { row } of members) {
      if (!this.moves.has(row)) {
        const marker = this.app.doc.createComment('Companion original version position');
        row.before(marker); this.moves.set(row, marker);
      }
      if (previous.nextElementSibling !== row) previous.after(row);
      previous = row;
      this.toggle(row, 'epc-version-member', true);
    }
    this.setGroupOpen(group, control, open);
    return group;
  }
  renderOptions(entry, group) {
    const { app } = this;
    const { list, control } = entry;
    const origin = app.win.location.origin;
    const options = group.map(({ row, parsed, link }) => {
      const detail = new URL(link.href);
      const titleCell = link.closest('td');
      let size;
      for (let cell = titleCell.nextElementSibling; cell; cell = cell.nextElementSibling) {
        const text = cell.textContent.trim();
        if (/^\d+(?:[.,]\d+)*\s*(?:[kmgt]i?b|b|bytes?)$/i.test(text)) { size = text; break; }
      }
      const format = parsed.label.replace(/(\d)[PI](?=\d*\b)/g, suffix => suffix.toLowerCase());
      return { row, detail, label: size ? format + ' · ' + size : format, title: link.textContent.trim(),
        download: versionDownloadLink(row, detail, origin) };
    });
    const signature = JSON.stringify(options.map(({ detail, label, title, download }) => [detail.href, label, title, download?.href]));
    if (entry.signature === signature) return;
    entry.signature = signature;
    const focus = list.contains(app.doc.activeElement) && app.doc.activeElement.href;
    list.replaceChildren(...options.map(({ row, detail, label, title, download }) => {
      const item = app.node('li');
      const link = app.node('a', label);
      link.href = detail.href; link.title = title;
      item.append(link);
      if (download) {
        const action = app.node('a', 'Download', 'epc-version-download');
        action.href = download.href;
        action.setAttribute('aria-label', 'Download ' + label + ' — ' + title);
        for (const attr of ['target', 'rel', 'download', 'referrerpolicy']) {
          if (download.hasAttribute(attr)) action.setAttribute(attr, download.getAttribute(attr));
        }
        action.addEventListener('click', event => {
          if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          const native = row.isConnected && versionDownloadLink(row, detail, origin);
          if (native) native.click();
          else app.toast('Open the version’s torrent page to download it.');
        });
        item.append(action);
      }
      return item;
    }));
    if (focus) ([...list.querySelectorAll('a')].find(link => link.href === focus) || control).focus({ preventScroll: true });
  }
  setGroupOpen(group, control, open) {
    const caption = open ? 'Hide version details' : 'Show version details';
    if (control.textContent !== caption) control.textContent = caption;
    control.setAttribute('aria-expanded', String(open));
    for (const [index, { row }] of group.entries()) {
      row.toggleAttribute('data-ep-version-details', open);
      if (index) this.toggle(row, 'epc-version-hidden', !open);
    }
  }
  append(rows) {
    if (!this.app.filtersReady || !this.app.settings.groupVersions) return;
    for (const key of this.collectCandidates(rows)) this.renderGroup(key);
    this.hideCollapsedPreview();
  }
  refresh() {
    const { doc, settings } = this.app;
    if (this.app.detailLayout?.torrentID) return;
    if (!this.app.filtersReady || !settings.groupVersions) { this.clear(); return; }
    this.collapsed = 0; this.groups.clear(); this.candidates.clear();
    const representatives = new Set(), members = new Set();
    for (const key of this.collectCandidates(doc.querySelectorAll('tr.torrent'))) {
      const group = this.renderGroup(key);
      if (!group) continue;
      representatives.add(group[0].row);
      for (const { row } of group.slice(1)) members.add(row);
    }
    for (const [row, marker] of this.moves) if (!members.has(row) && row.isConnected) {
      if (marker.isConnected) marker.before(row);
      marker.remove(); this.moves.delete(row);
    }
    for (const [row, { root }] of this.controls) if (!representatives.has(row)) {
      root.remove(); this.controls.delete(row);
    }
    for (const [row] of this.rows) {
      if (!members.has(row)) {
        this.toggle(row, 'epc-version-hidden', false); this.toggle(row, 'epc-version-member', false);
        if (!representatives.has(row)) row.removeAttribute('data-ep-version-details');
      }
      if (!row.isConnected && !this.app.detachedFilterRows.has(row)) {
        this.moves.get(row)?.remove(); this.moves.delete(row); this.rows.delete(row);
      }
    }
    this.hideCollapsedPreview();
  }
  toggleGroup(key) {
    const current = this.groups.get(key); if (!current) return;
    const { group, control, expanded } = current, open = !expanded.has(key);
    if (open) expanded.add(key); else expanded.delete(key);
    this.setGroupOpen(group, control, open);
    const difference = (open ? 1 : -1) * (group.length - 1);
    this.collapsed -= difference;
    this.app.groupVisibilityChanged(difference);
    if (open) this.app.media.prepareThumbnails(group.map(item => item.row));
    this.hideCollapsedPreview();
  }
  hideCollapsedPreview() {
    if (!this.app.preview.pinned && this.app.preview.anchor?.closest('.epc-version-hidden')) this.app.preview.hide(true);
  }
  toggle(row, name, wanted) { if (row.classList.contains(name) !== wanted) row.classList.toggle(name, wanted); }
  stabilizeLayouts() {
    if (this.app.detailLayout?.torrentID || !this.app.settings.groupVersions || this.app.backfill?.busy) return;
    for (const table of this.app.doc.querySelectorAll('table.torrent_table,table#torrent_table')) {
      if (table.matches('.epc-result-grid,[data-ep-list-columns]')) continue;
      if (this.layouts.has(table) || table.querySelector(':scope > colgroup') || table.querySelectorAll('tr.torrent').length < 200) continue;
      const row = [...table.querySelectorAll('tr.torrent')].find(row => row.getClientRects().length);
      if (!row) continue;
      const titleCell = resultTitleLink(row)?.closest('td'); if (!titleCell) continue;
      const sizes = [], flexible = new Set();
      for (const cell of row.cells) {
        const width = cell.getBoundingClientRect().width;
        if (!(width > 0)) continue;
        for (let i = 0; i < (cell.colSpan || 1); i++) {
          if (cell === titleCell) flexible.add(sizes.length);
          sizes.push(width / (cell.colSpan || 1));
        }
      }
      const width = sizes.reduce((sum, size) => sum + size, 0); if (!width || sizes.length < 2) continue;
      if (!flexible.size) continue;
      const columns = this.app.node('colgroup', null, 'epc-version-columns');
      let fixedWidth = 0;
      for (let index = 0; index < sizes.length; index++) {
        const col = this.app.node('col');
        if (!flexible.has(index)) { col.style.width = sizes[index].toFixed(2) + 'px'; fixedWidth += sizes[index]; }
        columns.append(col);
      }
      // Metadata keeps the space its native content/header needed. Only Name
      // flexes on resize; do not shrink header labels with percentage columns.
      const minimumTitle = Math.max(180, this.app.settings.inlineThumbnails ? this.app.settings.thumbnailSize + 24 : 0);
      table.style.setProperty('--epc-table-min-width', Math.ceil(fixedWidth + minimumTitle) + 'px');
      table.prepend(columns); table.classList.add('epc-stable-columns'); this.layouts.set(table, columns);
    }
  }
  releaseLayout(table) {
    const columns = this.layouts.get(table); if (!columns) return;
    columns.remove(); table.classList.remove('epc-stable-columns');
    table.style.removeProperty('--epc-table-min-width'); this.layouts.delete(table);
  }
  forget(root) {
    for (const [table] of this.layouts) if (!table.isConnected && (table === root || root.contains(table))) this.releaseLayout(table);
  }
  clear() {
    for (const [table] of this.layouts) this.releaseLayout(table);
    for (const [row, marker] of this.moves) {
      if (row.isConnected && marker.isConnected) marker.before(row);
      marker.remove();
    }
    this.moves.clear();
    for (const [row, entry] of this.rows) {
      this.toggle(row, 'epc-version-hidden', false); this.toggle(row, 'epc-version-member', false);
      row.removeAttribute('data-ep-version-details');
      if (!entry.originalID && /^epc-version-row-/.test(row.id)) row.removeAttribute('id');
      if (!row.isConnected && !this.app.detachedFilterRows.has(row)) this.rows.delete(row);
    }
    for (const { root } of this.controls.values()) root.remove();
    this.controls.clear(); this.groups.clear(); this.candidates.clear(); this.collapsed = 0;
  }
  dispose() { this.clear(); this.rows.clear(); }
}

// Extract positive tag terms without turning NOT/negative clauses into matches.
// This annotates individual terms; it does not claim to evaluate a result's query.
export function positiveTagTerms(query) {
  const tokens = String(query || '').match(/\(|\)|[!+-]|[\p{L}\p{N}_.*]+/gu) || [];
  const terms = new Set(), stack = [false]; let negative = false;
  for (const token of tokens) {
    if (/^(?:NOT|!|-)$/i.test(token)) { negative = !negative; continue; }
    if (token === '+') continue;
    if (token === '(') { stack.push(stack.at(-1) !== negative); negative = false; continue; }
    if (token === ')') { if (stack.length > 1) stack.pop(); negative = false; continue; }
    if (/^(?:AND|OR)$/i.test(token)) { negative = false; continue; }
    if (!(stack.at(-1) !== negative)) terms.add(token.toLocaleLowerCase());
    negative = false;
  }
  return [...terms];
}

export function matchesTagTerm(value, term) {
  // Literal segments avoid regular-expression backtracking for wildcard queries.
  const parts = term.split('*');
  if (parts.length === 1) return value === term;
  return matchesTagParts(value, parts);
}

function matchesTagParts(value, parts) {
  if (!value.startsWith(parts[0])) return false;
  let cursor = parts[0].length;
  for (const part of parts.slice(1, -1)) {
    const index = value.indexOf(part, cursor); if (index < 0) return false;
    cursor = index + part.length;
  }
  const end = parts.at(-1);
  return value.length - cursor >= end.length && value.endsWith(end);
}

export class TagHighlights {
  constructor(app) {
    this.app = app; this.originals = new Map(); this.index = new Map(); this.values = new WeakMap();
    this.cues = new Map();
    this.touchPointer = app.win.matchMedia?.('(any-pointer: coarse)');
    this.touchPickers = new WeakMap();
  }
  refreshStoredPreferences(report = false) {
    const { app } = this;
    const before = tagHighlightPreferences(app.settings);
    app.preferences.refresh();
    const changed = !samePreference(before, tagHighlightPreferences(app.settings));
    if (changed && report) app.toast('Tag highlights changed in another tab. Review them and try again.');
    return changed;
  }
  categories() {
    const { tagCategories, favoriteTags, cautionTags } = this.app.settings;
    if (this.categorySource !== tagCategories || this.favoriteSource !== favoriteTags || this.cautionSource !== cautionTags || !this.groups) {
      this.categorySource = tagCategories; this.favoriteSource = favoriteTags; this.cautionSource = cautionTags;
      this.groups = tagCategoriesWithTags(this.app.settings);
      this.assignments = new Map();
      this.members = new Map();
      for (const group of this.groups) {
        const tags = new Set(tagListTokens(group.tags));
        this.members.set(group.id, tags);
        for (const tag of tags) this.assignments.set(tag, group);
      }
    }
    return this.groups;
  }
  activeView() {
    const group = this.categories().find(group => group.id === this.activeCategory && group.enabled);
    if (!group) this.activeCategory = null;
    return group ? this.members.get(group.id) : null;
  }
  matchesView(row, matches) {
    return !matches || Array.from(row.querySelectorAll(resultTagSelector)).some(tag => matches.has(tag.textContent.trim().toLocaleLowerCase()));
  }
  showMatches(id) {
    const { app } = this;
    if (id && app.activePane) app.closePane();
    this.activeCategory = id;
    app.resultFilters.refreshView();
    app.media.demandListener?.();
    if (id && !this.viewChip.hidden) this.viewChip.focus();
    else app.paneButtons.get('filters')?.focus();
  }
  mountView() {
    if (this.app.detailLayout?.torrentID) return;
    this.viewChip = this.app.button('', () => this.showMatches(null));
    this.viewChip.className = 'epc-active-filter epc-category-view';
    this.viewChip.hidden = true;
    this.app.toolbarStatus.append(this.viewChip);
  }
  syncView(count) {
    if (!this.viewChip) return;
    const group = this.categories().find(group => group.id === this.activeCategory);
    this.viewChip.hidden = !group;
    if (!group) return;
    const caption = group.name + ' · ' + count.toLocaleString() + (count === 1 ? ' result' : ' results') + ' ×';
    if (caption !== this.viewChip.textContent) this.viewChip.textContent = caption;
    this.viewChip.setAttribute('aria-label', 'Clear ' + group.name + ' view. ' + count + (count === 1 ? ' result' : ' results'));
  }
  refresh(root) {
    if (root?.matches?.('img,source,video,canvas')) return;
    const { app } = this, { doc, settings } = app;
    const query = new URL(app.win.location.href).searchParams.get('taglist') ?? doc.querySelector('#search_form [name=taglist]')?.defaultValue ?? '';
    const groups = this.categories();
    const changed = groups !== this.renderedGroups;
    const queryChanged = query !== this.querySource;
    const layout = [settings.resultsView, settings.gridShowTags, settings.gridTagCues].join();
    const layoutChanged = layout !== this.cueLayout;
    this.cueLayout = layout;
    const affected = new Set();
    if (changed) {
      const before = this.renderedAssignments || new Map();
      for (const value of new Set([...before.keys(), ...this.assignments.keys()])) {
        const old = before.get(value), next = this.assignments.get(value);
        if (old?.id !== next?.id || old?.name !== next?.name || old?.color !== next?.color || old?.enabled !== next?.enabled) affected.add(value);
      }
      // Order changes affect cue labels even when the individual tags keep their styles.
      if (groups.map(group => group.id).join() !== this.renderedGroups?.map(group => group.id).join()) {
        for (const value of this.assignments.keys()) affected.add(value);
      }
      this.renderedGroups = groups;
      this.renderedAssignments = this.assignments;
    }
    if (queryChanged) {
      this.querySource = query;
      const terms = positiveTagTerms(query);
      this.exact = new Set(terms.filter(term => !term.includes('*')));
      this.wildcards = terms.filter(term => term.includes('*')).map(term => term.split('*'));
    }
    const selector = '#content div.tags>a,#content ul#torrent_tags_list>li>a';
    const tags = new Set();
    const rows = new Set();
    if (this.initialized && changed && !queryChanged && !layoutChanged) {
      for (const value of affected) for (const tag of this.index.get(value) || []) tags.add(tag);
    } else if (!root || queryChanged || layoutChanged || !this.initialized) root = doc;
    if (root) {
      for (const scope of Array.isArray(root) ? root : [root]) {
        const row = scope.closest?.('tr.torrent');
        if (row) rows.add(row);
        for (const tag of scope.matches?.(selector) ? [scope] : scope.querySelectorAll?.(selector) || []) tags.add(tag);
      }
    }
    this.initialized = true;
    for (const tag of tags) {
      const row = tag.closest('tr.torrent');
      if (row) rows.add(row);
      const value = tag.textContent.trim().toLocaleLowerCase();
      const previous = this.values.get(tag);
      if (previous !== value) {
        const entries = this.index.get(previous); entries?.delete(tag);
        if (entries && !entries.size) this.index.delete(previous);
        if (!this.index.has(value)) this.index.set(value, new Set());
        this.index.get(value).add(tag); this.values.set(tag, value);
      }
      const assignment = this.assignments.get(value);
      const group = assignment?.enabled ? assignment : null;
      const tone = group?.id || '';
      const matched = this.exact.has(value) || this.wildcards.some(parts => matchesTagParts(value, parts));
      const reasons = [tag.classList.contains('nseHardPassTag') ? 'Hard Pass' : tag.classList.contains('nseHiddenTag') ? 'Blocked tag' :
        tag.classList.contains('nseWhitelistedTag') ? 'Allowed tag' : '', group ? group.name + ' tag' : '',
        matched ? 'Matches a search tag' : ''].filter(Boolean);
      if (tone || matched || reasons.length) {
        if (!this.originals.has(tag)) this.originals.set(tag, tag.getAttribute('title'));
        if (tag.dataset.epTagTone !== tone) tag.dataset.epTagTone = tone;
        if (tag.style.getPropertyValue('--epc-tag-background') !== (group?.color || '')) styleHighlight(tag, group?.color);
        if (tag.classList.contains('epc-tag-match') !== matched) tag.classList.toggle('epc-tag-match', matched);
        const title = [this.originals.get(tag), ...reasons].filter(Boolean).join(' · ');
        if (tag.title !== title) tag.title = title;
      } else this.restore(tag);
    }
    if (root === doc) for (const row of this.cues.keys()) rows.add(row);
    const showTagsDrawer = settings.resultsView === 'grid' && !settings.gridShowTags;
    if (showTagsDrawer || this.cues.size) for (const row of rows) this.refreshCue(row, showTagsDrawer);
    this.refreshDetailTags();
  }
  refreshCue(row, enabled) {
    const { app } = this;
    const tags = enabled && row.isConnected ? [...row.querySelectorAll('div.tags:not(.hidden,[hidden]) > a')] : [];
    let cue = this.cues.get(row);
    if (!tags.length) { removeGridCardAction(cue); this.cues.delete(row); return; }
    if (!cue) {
      const title = resultTitleLink(row);
      if (!title) return;
      cue = app.node('details', null, 'epc-root epc-grid-tag-cue');
      cue.append(app.node('summary'));
      cue.addEventListener('toggle', () => {
        if (cue.open) this.refreshTouchPicker(cue, row);
        app.media.invalidateLayout();
      });
      gridCardActions(app, title).prepend(cue); this.cues.set(row, cue);
    }
    if (cue.open) this.refreshTouchPicker(cue, row);
    const matched = new Set(tags.map(tag => this.assignments.get(this.values.get(tag))));
    const groups = app.settings.gridTagCues ? this.categories().filter(group => group.enabled && matched.has(group)) : [];
    const summary = cue.firstElementChild;
    const signature = JSON.stringify(groups.map(({ name, color }) => [name, color]));
    if (summary.dataset.epCategories === signature) return;
    summary.dataset.epCategories = signature;
    summary.setAttribute('aria-label', ['Tags', ...groups.map(group => group.name)].join(', '));
    summary.replaceChildren(app.node('span', 'Tags'), ...groups.map(group => {
      const label = app.node('span', group.name, 'epc-tag-swatch');
      styleHighlight(label, group.color);
      return label;
    }));
  }
  refreshTouchPicker(cue, row) {
    const { app } = this;
    let entry = this.touchPickers.get(cue);
    const available = this.touchPointer?.matches && app.storage.get('nseRightClickManagementEnabled', true) &&
      app.storage.get('nseRCMTagsEnabled', true) && (app.engineReady || app.resultFilters.bookmarks);
    if (!available) { if (entry) entry.control.hidden = true; return; }
    if (!entry) {
      const control = app.node('div', null, 'epc-grid-tag-picker');
      const select = app.node('select'); select.setAttribute('aria-label', 'Tag to highlight');
      const open = app.button('Highlight', () => {
        const link = entry.links[Number(select.value)];
        if (select.value && link?.isConnected) app.openTagMenu(link, open);
      });
      select.addEventListener('change', () => { open.disabled = !select.value; });
      control.append(select, open); cue.append(control);
      this.touchPickers.set(cue, entry = { control, select, open });
    }
    entry.control.hidden = false;
    const links = [...row.querySelectorAll('div.tags:not(.hidden,[hidden]) > a')];
    const names = links.map(link => link.textContent.trim());
    const signature = JSON.stringify(names);
    entry.links = links;
    if (signature === entry.signature) return;
    entry.signature = signature;
    const placeholder = app.node('option', 'Choose a tag'); placeholder.value = '';
    entry.select.replaceChildren(placeholder, ...names.map((name, index) => {
      const option = app.node('option', name); option.value = String(index); return option;
    }));
    entry.open.disabled = true;
  }
  refreshDetailTags() {
    const { app } = this;
    const list = app.doc.querySelector('ul#torrent_tags_list');
    if (list !== this.detailList) {
      this.releaseDetailTags();
      this.detailList = list;
      this.detailExpanded = false;
    }
    if (!list) return;
    const { adaptiveDetailTags, collapsedDetailTags } = app.settings;
    list.toggleAttribute('data-ep-adaptive-tags', adaptiveDetailTags);
    const collapsed = new Set(tagListTokens(collapsedDetailTags));
    const names = new Map();
    let count = 0;
    for (const item of list.children) {
      const tag = item.matches('li') && item.querySelector(':scope > a');
      const name = tag && !item.hidden && !item.classList.contains('hidden') && tag.textContent.trim();
      const value = name && name.toLocaleLowerCase();
      if (value) names.set(value, name);
      const low = !!value && collapsed.has(value);
      item.toggleAttribute('data-ep-low-priority-tag', low);
      if (low) count++;
    }
    if (!count) this.detailExpanded = false;
    list.toggleAttribute('data-ep-tags-expanded', this.detailExpanded);
    if (!names.size) {
      this.detailControls?.remove();
      this.detailControls = this.detailToggle = this.detailEditor = null;
      return;
    }
    if (!this.detailControls) this.mountDetailEditor(list);
    this.detailToggle.hidden = !count;
    const label = (this.detailExpanded ? 'Hide ' : 'Show ') + count + (count === 1 ? ' other tag' : ' other tags');
    if (this.detailToggle.textContent !== label) this.detailToggle.textContent = label;
    this.detailToggle.setAttribute('aria-expanded', String(this.detailExpanded));
    if (this.detailEditor.details.open) this.refreshDetailEditor(names);
  }
  mountDetailEditor(list) {
    const { app } = this;
    const controls = app.node('div', null, 'epc-root epc-detail-tag-actions');
    const details = app.node('details', null, 'epc-detail-highlight-editor');
    const summary = app.node('summary', 'Highlight tags');
    const select = app.node('select'); select.setAttribute('aria-label', 'Tag to highlight');
    const actions = app.node('div');
    details.append(summary, select, actions);
    details.addEventListener('toggle', () => {
      if (!details.isConnected) return;
      if (details.open) this.refreshDetailTags();
      app.media.invalidateLayout();
    });
    details.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !details.open) return;
      event.preventDefault(); event.stopPropagation();
      details.open = false; summary.focus();
    });
    select.addEventListener('change', () => this.refreshDetailTags());
    this.detailEditor = { details, select, actions };
    this.detailToggle = app.button('', () => {
      this.detailExpanded = !this.detailExpanded;
      this.refreshDetailTags();
    });
    this.detailToggle.setAttribute('aria-controls', list.id);
    controls.append(this.detailToggle, details);
    list.before(controls);
    this.detailControls = controls;
    applyWorkspaceTheme(app, [controls]);
  }
  refreshDetailEditor(names) {
    const { app, detailEditor: editor } = this;
    const { select, actions } = editor;
    const signature = JSON.stringify([...names]);
    if (editor.names !== signature) {
      editor.names = signature;
      const previous = select.value;
      const placeholder = app.node('option', 'Choose a tag'); placeholder.value = '';
      select.replaceChildren(placeholder, ...[...names].map(([value, name]) => {
        const option = app.node('option', name); option.value = value; return option;
      }));
      select.value = names.has(previous) ? previous : '';
    }
    const tag = select.value, groups = this.categories();
    if (editor.tag === tag && editor.groups === groups) return;
    editor.tag = tag; editor.groups = groups;
    const focus = actions.contains(app.doc.activeElement) && app.doc.activeElement.dataset.highlight;
    actions.replaceChildren();
    if (tag) actions.append(this.highlightActions(tag, tone => this.choose(tag, tone)));
    if (focus) {
      const next = [...actions.querySelectorAll('button')].find(button => button.dataset.highlight === focus && !button.hidden);
      (next || select).focus({ preventScroll: true });
    }
  }
  releaseDetailTags() {
    this.detailControls?.remove(); this.detailControls = this.detailToggle = this.detailEditor = null;
    this.detailList?.removeAttribute('data-ep-adaptive-tags');
    this.detailList?.removeAttribute('data-ep-tags-expanded');
    for (const item of this.detailList?.children || []) item.removeAttribute('data-ep-low-priority-tag');
  }
  forget(root) {
    for (const row of [root, ...root.querySelectorAll('tr.torrent')]) {
      removeGridCardAction(this.cues.get(row)); this.cues.delete(row);
    }
    for (const tag of [root, ...root.querySelectorAll(resultTagSelector + ',' + detailTagSelector)]) {
      const value = this.values.get(tag), entries = this.index.get(value);
      entries?.delete(tag); if (entries && !entries.size) this.index.delete(value);
      this.values.delete(tag); this.restore(tag);
    }
  }
  restore(tag) {
    if (!this.originals.has(tag)) return;
    const title = this.originals.get(tag);
    if (title == null) tag.removeAttribute('title'); else tag.title = title;
    styleHighlight(tag, null);
    tag.removeAttribute('data-ep-tag-tone'); tag.classList.remove('epc-tag-match'); this.originals.delete(tag);
  }
  commit(edit) {
    const app = this.app;
    if (!app.preferences.flush() || this.refreshStoredPreferences(true)) return false;
    const groups = this.categories().map(group => ({ ...group }));
    edit(groups);
    if (app.preferences.flush(tagCategorySettings(groups))) return true;
    app.toast('Could not save the highlight changes.');
    return false;
  }
  assign(tags, id) {
    return this.commit(groups => {
      for (const group of groups) {
        const remaining = tagListTokens(group.tags).filter(tag => !tags.has(tag));
        group.tags = (group.id === id ? remaining.concat([...tags]) : remaining).join(' ');
      }
    });
  }
  choose(tag, tone) {
    const app = this.app;
    this.categories();
    const group = this.groups.find(group => group.id === tone && group.enabled);
    if (!tag || (tone && !group) || !this.assign(new Set([tag]), tone)) return false;
    app.toast(group ? 'Highlighted as ' + group.name + '.' : 'Highlight cleared.');
    return true;
  }
  menu(menu, kind, value) {
    menu.querySelector('.epc-highlight-actions')?.remove();
    if (kind !== 'tag') return;
    const tag = value.trim().toLocaleLowerCase();
    menu.append(this.highlightActions(tag, tone => {
      if (!this.choose(tag, tone)) return;
      menu.classList.add('hidden');
      const anchor = this.app.ruleMenuOrigin;
      if (anchor?.closest('.epc-filter-hidden')) this.viewChip?.focus();
      else anchor?.focus({ preventScroll: true });
    }));
  }
  highlightActions(tag, choose) {
    const { app } = this;
    const group = app.node('section', null, 'epc-highlight-actions'); group.setAttribute('aria-label', 'Tag highlight');
    group.append(app.node('p', 'Highlight as', 'epc-caption'));
    const choices = app.node('div', null, 'epc-highlight-choices');
    group.append(choices);
    const categories = this.categories();
    const selected = this.assignments.get(tag)?.id;
    for (const category of categories.filter(category => category.enabled)) {
      const button = app.button(category.name, () => choose(category.id));
      button.dataset.highlight = category.id;
      button.prepend(app.node('i', null, 'epc-tag-color-dot'));
      button.firstChild.setAttribute('aria-hidden', 'true');
      styleHighlight(button, category.color);
      button.setAttribute('aria-pressed', String(selected === category.id));
      choices.append(button);
    }
    const clear = app.button('Clear highlight', () => choose(''));
    clear.dataset.highlight = 'clear'; clear.hidden = !selected; group.append(clear);
    return group;
  }
  dispose() {
    for (const tag of this.originals.keys()) this.restore(tag);
    this.index.clear();
    for (const cue of this.cues.values()) removeGridCardAction(cue);
    this.cues.clear(); this.releaseDetailTags();
  }
}
