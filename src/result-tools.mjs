// SPDX-License-Identifier: GPL-3.0-or-later
// Independently implemented after reviewing Collapse Duplicates, Coalesce
// Variations, and the Emp++/Luminance tag highlighters. See THIRD_PARTY.md.
import { DEFAULTS, LEGACY_TAG_LISTS, tagHighlightPreferences, tagListTokens } from './core.mjs';
import { samePreference } from './preferences.mjs';

const resultTagSelector = 'div.tags > a';
const detailTagSelector = 'ul#torrent_tags_list > li > a';

export function styleHighlight(element, color) {
  if (!color) {
    element.style.removeProperty('--epc-tag-background');
    element.style.removeProperty('--epc-tag-foreground');
    return;
  }
  const channels = color.slice(1).match(/../g).map(hex => {
    const channel = parseInt(hex, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  element.style.setProperty('--epc-tag-background', color);
  element.style.setProperty('--epc-tag-foreground', luminance > 0.179 ? '#000' : '#fff');
}

export function resultTitleLink(row) {
  return [...row.querySelectorAll('td a[href*="torrents.php"]')].find(link => {
    if (!link.textContent.trim() || link.closest('.tags,.torrent_icon_container,.epc-thumbnail,.epc-grid-card-actions')) return false;
    try { const url = new URL(link.href); return url.searchParams.has('id') && !url.searchParams.has('action'); }
    catch { return false; }
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
    this.tables = new WeakMap(); this.nextTable = 0; this.nextRow = 0; this.expanded = new Set(); this.collapsed = 0; this.groups = new Map();
    this.layouts = new Map(); this.candidates = new Map(); this.gridControls = new Map();
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
    const candidates = this.candidates.get(key);
    if (candidates.length < 2 || !candidates.some(item => item.parsed.hits.length)) return;
    const group = [...candidates].sort((a, b) => a.entry.order - b.entry.order);
    const [head, ...members] = group, grid = this.app.settings.resultsView === 'grid' && !!head.row.closest('#content');
    const open = !grid && this.expanded.has(key);
    const ids = members.map(({ row, entry }) => {
      if (!row.id) row.id = 'epc-version-row-' + entry.order;
      return row.id;
    });
    let control = this.controls.get(head.row);
    if (!control) {
      control = this.app.button('', () => this.toggleGroup(control.dataset.versionKey));
      control.className = 'epc-version-control'; this.controls.set(head.row, control);
    }
    if (!open) this.collapsed += group.length - (this.groups.get(key)?.group.length || 1);
    this.groups.set(key, { group, control });
    control.dataset.versionKey = key;
    const caption = (open ? 'Hide' : 'Show') + ' ' + group.length + ' versions';
    if (control.textContent !== caption) control.textContent = caption;
    control.setAttribute('aria-expanded', String(open)); control.setAttribute('aria-controls', ids.join(' '));
    const labels = [...new Set(group.map(item => item.parsed.label))].join('\n');
    control.title = 'Versions on loaded pages:\n' + labels;
    if (head.link.nextElementSibling !== control) head.link.after(control);
    if (grid) this.renderGridGroup(head, group);
    let previous = head.row;
    for (const { row } of members) {
      if (!this.moves.has(row)) {
        const marker = this.app.doc.createComment('Companion original version position');
        row.before(marker); this.moves.set(row, marker);
      }
      if (previous.nextElementSibling !== row) previous.after(row);
      previous = row;
      this.toggle(row, 'epc-version-hidden', !open); this.toggle(row, 'epc-version-member', true);
    }
    return group;
  }
  renderGridGroup(head, group) {
    const { app } = this;
    let entry = this.gridControls.get(head.row);
    if (!entry) {
      const details = app.node('details', null, 'epc-root epc-grid-versions');
      details.append(app.node('summary'), app.node('ul', null, 'epc-grid-version-list'));
      gridCardActions(app, head.link).append(details);
      this.gridControls.set(head.row, entry = { details });
    }
    const values = group.map(({ parsed, link }) => [parsed.label.replace(/(\d)[PI]\b/g, suffix => suffix.toLowerCase()), link.href, link.textContent.trim()]);
    const signature = JSON.stringify(values);
    if (entry.signature === signature) return;
    entry.signature = signature;
    const [summary, list] = entry.details.children;
    summary.textContent = group.length + ' versions';
    const focus = list.contains(app.doc.activeElement) && app.doc.activeElement.href;
    list.replaceChildren(...values.map(([label, href, title], index) => {
      const item = app.node('li');
      if (!index) item.append(app.node('strong', label), app.node('span', 'Current card'));
      else {
        const link = app.node('a', label);
        link.href = href; link.title = title; link.setAttribute('aria-label', title);
        item.append(link);
      }
      return item;
    }));
    if (focus) [...list.querySelectorAll('a')].find(link => link.href === focus)?.focus({ preventScroll: true });
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
    for (const [row, control] of this.controls) if (!representatives.has(row)) { control.remove(); this.controls.delete(row); }
    for (const [row, { details }] of this.gridControls) if (!representatives.has(row) || settings.resultsView !== 'grid') {
      removeGridCardAction(details); this.gridControls.delete(row);
    }
    for (const [row] of this.rows) {
      if (!members.has(row)) {
        this.toggle(row, 'epc-version-hidden', false); this.toggle(row, 'epc-version-member', false);
      }
      if (!row.isConnected && !this.app.detachedFilterRows.has(row)) {
        this.moves.get(row)?.remove(); this.moves.delete(row); this.rows.delete(row);
      }
    }
    this.hideCollapsedPreview();
  }
  toggleGroup(key) {
    const current = this.groups.get(key); if (!current) return;
    const { group, control } = current, open = !this.expanded.has(key);
    if (group[0].row.closest('.epc-result-grid')) return;
    if (open) this.expanded.add(key); else this.expanded.delete(key);
    for (const { row } of group.slice(1)) this.toggle(row, 'epc-version-hidden', !open);
    const difference = (open ? 1 : -1) * (group.length - 1);
    this.collapsed -= difference;
    control.textContent = (open ? 'Hide' : 'Show') + ' ' + group.length + ' versions';
    control.setAttribute('aria-expanded', String(open));
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
      if (!entry.originalID && /^epc-version-row-/.test(row.id)) row.removeAttribute('id');
      if (!row.isConnected && !this.app.detachedFilterRows.has(row)) this.rows.delete(row);
    }
    for (const control of this.controls.values()) control.remove();
    for (const { details } of this.gridControls.values()) removeGridCardAction(details);
    this.gridControls.clear();
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
      this.groups = (tagCategories || DEFAULTS.tagCategories).map(group => ({
        ...group, tags: LEGACY_TAG_LISTS.has(group.id) ? this.app.settings[LEGACY_TAG_LISTS.get(group.id)] : group.tags
      }));
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
    list.toggleAttribute('data-ep-tags-expanded', this.detailExpanded);
    const collapsed = new Set(tagListTokens(collapsedDetailTags));
    let count = 0;
    for (const item of list.children) {
      const tag = item.matches('li') && item.querySelector(':scope > a');
      const low = !!tag && !item.hidden && !item.classList.contains('hidden') && collapsed.has(tag.textContent.trim().toLocaleLowerCase());
      item.toggleAttribute('data-ep-low-priority-tag', low);
      if (low) count++;
    }
    if (!count) {
      this.detailControls?.remove(); this.detailControls = this.detailToggle = null; this.detailExpanded = false;
      return;
    }
    if (!this.detailToggle) {
      const controls = app.node('div', null, 'epc-root epc-detail-tag-actions');
      this.detailToggle = app.button('', () => {
        this.detailExpanded = !this.detailExpanded;
        this.refreshDetailTags();
      });
      this.detailToggle.setAttribute('aria-controls', list.id);
      controls.append(this.detailToggle); list.before(controls);
      this.detailControls = controls;
    }
    const label = (this.detailExpanded ? 'Hide ' : 'Show ') + count + (count === 1 ? ' other tag' : ' other tags');
    if (this.detailToggle.textContent !== label) this.detailToggle.textContent = label;
    this.detailToggle.setAttribute('aria-expanded', String(this.detailExpanded));
  }
  releaseDetailTags() {
    this.detailControls?.remove(); this.detailControls = this.detailToggle = null;
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
    const changes = { tagCategories: groups.map(({ tags, ...group }) => LEGACY_TAG_LISTS.has(group.id) ? group : { ...group, tags }) };
    for (const [id, key] of LEGACY_TAG_LISTS) changes[key] = groups.find(group => group.id === id).tags;
    if (app.preferences.flush(changes)) return true;
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
    if (tone && !group) return;
    if (!this.assign(new Set([tag]), tone)) return;
    app.doc.getElementById('nseRCMBox')?.classList.add('hidden');
    const anchor = app.ruleMenuOrigin;
    if (anchor?.closest('.epc-filter-hidden')) this.viewChip?.focus();
    else anchor?.focus({ preventScroll: true });
    app.toast(group ? 'Highlighted as ' + group.name + '.' : 'Highlight cleared.');
  }
  menu(menu, kind, value) {
    menu.querySelector('.epc-highlight-actions')?.remove();
    if (kind !== 'tag') return;
    const tag = value.trim().toLocaleLowerCase(), app = this.app;
    const group = app.node('section', null, 'epc-highlight-actions'); group.setAttribute('aria-label', 'Tag highlight');
    group.append(app.node('p', 'Highlight as', 'epc-caption'));
    const choices = app.node('div', null, 'epc-highlight-choices');
    group.append(choices);
    const categories = this.categories();
    const selected = this.assignments.get(tag)?.id;
    for (const category of categories.filter(category => category.enabled)) {
      const button = app.button(category.name, () => this.choose(tag, category.id));
      button.dataset.highlight = category.id;
      button.prepend(app.node('i', null, 'epc-tag-color-dot'));
      button.firstChild.setAttribute('aria-hidden', 'true');
      styleHighlight(button, category.color);
      button.setAttribute('aria-pressed', String(selected === category.id));
      choices.append(button);
    }
    const clear = app.button('Clear highlight', () => this.choose(tag, ''));
    clear.dataset.highlight = 'clear'; clear.hidden = !selected; group.append(clear);
    menu.append(group);
  }
  dispose() {
    for (const tag of this.originals.keys()) this.restore(tag);
    this.index.clear();
    for (const cue of this.cues.values()) removeGridCardAction(cue);
    this.cues.clear(); this.releaseDetailTags();
  }
}
