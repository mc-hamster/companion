// SPDX-License-Identifier: GPL-3.0-or-later
// Independently implemented after reviewing Collapse Duplicates, Coalesce
// Variations, and the Emp++/Luminance tag highlighters. See THIRD_PARTY.md.

export function resultTitleLink(row) {
  return [...row.querySelectorAll('td a[href*="torrents.php"]')].find(link => {
    if (!link.textContent.trim() || link.closest('.tags,.torrent_icon_container,.epc-thumbnail')) return false;
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

export class VersionGroups {
  constructor(app) {
    this.app = app; this.rows = new Map(); this.moves = new Map(); this.controls = new Map();
    this.tables = new WeakMap(); this.nextTable = 0; this.nextRow = 0; this.expanded = new Set(); this.collapsed = 0; this.groups = new Map();
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
    const candidates = this.candidates.get(key);
    if (candidates.length < 2 || !candidates.some(item => item.parsed.hits.length)) return;
    const group = [...candidates].sort((a, b) => a.entry.order - b.entry.order);
    const [head, ...members] = group, open = this.expanded.has(key);
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
  append(rows) {
    if (!this.app.filtersReady || !this.app.settings.groupVersions) return;
    for (const key of this.collectCandidates(rows)) this.renderGroup(key);
    this.hideCollapsedPreview();
  }
  refresh() {
    const { doc, settings } = this.app;
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
    if (!this.app.settings.groupVersions || this.app.backfill?.busy) return;
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
    this.controls.clear(); this.groups.clear(); this.candidates.clear(); this.collapsed = 0;
  }
  dispose() { this.clear(); this.rows.clear(); }
}

export function highlightTagList(value) {
  return [...new Set(String(value || '').toLocaleLowerCase().split(/\s+/).filter(Boolean))];
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
  }
  refresh(root) {
    if (root?.matches?.('img,source,video,canvas')) return;
    const { app } = this, { doc, settings } = app;
    const query = new URL(app.win.location.href).searchParams.get('taglist') ?? doc.querySelector('#search_form [name=taglist]')?.defaultValue ?? '';
    const changed = settings.favoriteTags !== this.favoriteSource || settings.cautionTags !== this.cautionSource;
    const queryChanged = query !== this.querySource;
    const affected = new Set();
    if (changed) {
      const favorites = new Set(highlightTagList(settings.favoriteTags)), caution = new Set(highlightTagList(settings.cautionTags));
      for (const [before, after] of [[this.favorites || new Set(), favorites], [this.caution || new Set(), caution]]) {
        for (const value of before) if (!after.has(value)) affected.add(value);
        for (const value of after) if (!before.has(value)) affected.add(value);
      }
      this.favoriteSource = settings.favoriteTags; this.cautionSource = settings.cautionTags;
      this.favorites = favorites; this.caution = caution;
    }
    if (queryChanged) {
      this.querySource = query;
      const terms = positiveTagTerms(query);
      this.exact = new Set(terms.filter(term => !term.includes('*')));
      this.wildcards = terms.filter(term => term.includes('*')).map(term => term.split('*'));
    }
    const { favorites, caution } = this;
    const selector = '#content div.tags>a,#content ul#torrent_tags_list>li>a';
    const tags = new Set();
    const rows = new Set();
    if (this.initialized && changed && !queryChanged) {
      for (const value of affected) for (const tag of this.index.get(value) || []) tags.add(tag);
    } else if (!root || queryChanged || !this.initialized) root = doc;
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
      const tone = caution.has(value) ? 'caution' : favorites.has(value) ? 'favorite' : '';
      const matched = this.exact.has(value) || this.wildcards.some(parts => matchesTagParts(value, parts));
      const reasons = [tag.classList.contains('nseHardPassTag') ? 'Hard Pass' : tag.classList.contains('nseHiddenTag') ? 'Blocked tag' :
        tag.classList.contains('nseWhitelistedTag') ? 'Allowed tag' : '', tone === 'favorite' ? 'Favorite tag' : tone === 'caution' ? 'Caution tag' : '',
        matched ? 'Matches a search tag' : ''].filter(Boolean);
      if (tone || matched || reasons.length) {
        if (!this.originals.has(tag)) this.originals.set(tag, tag.getAttribute('title'));
        if (tag.dataset.epTagTone !== tone) tag.dataset.epTagTone = tone;
        if (tag.classList.contains('epc-tag-match') !== matched) tag.classList.toggle('epc-tag-match', matched);
        const title = [this.originals.get(tag), ...reasons].filter(Boolean).join(' · ');
        if (tag.title !== title) tag.title = title;
      } else this.restore(tag);
    }
    if (root === doc) for (const row of this.cues.keys()) rows.add(row);
    const showCues = settings.resultsView === 'grid' && settings.gridTagCues && !settings.gridShowTags;
    if (showCues || this.cues.size) for (const row of rows) this.refreshCue(row, showCues);
    this.refreshDetailTags();
  }
  refreshCue(row, enabled) {
    const { app } = this;
    const favorites = new Set(), cautions = new Set();
    if (enabled && row.isConnected) for (const tag of row.querySelectorAll('div.tags > a')) {
      const value = this.values.get(tag);
      if (this.caution.has(value)) cautions.add(value);
      else if (this.favorites.has(value)) favorites.add(value);
    }
    let cue = this.cues.get(row);
    if (!favorites.size && !cautions.size) { cue?.remove(); this.cues.delete(row); return; }
    if (!cue) {
      const title = resultTitleLink(row);
      if (!title) return;
      cue = app.node('details', null, 'epc-root epc-grid-tag-cue');
      cue.append(app.node('summary'), app.node('div', null, 'epc-grid-tag-matches'));
      title.after(cue); this.cues.set(row, cue);
    }
    const caption = [
      cautions.size === 1 ? 'Caution · ' + [...cautions][0] : cautions.size ? cautions.size + ' cautions' : '',
      favorites.size ? favorites.size + (favorites.size === 1 ? ' favorite' : ' favorites') : ''
    ].filter(Boolean).join(' · ');
    if (cue.firstElementChild.textContent !== caption) cue.firstElementChild.textContent = caption;
    const contents = [
      cautions.size ? 'Caution · ' + [...cautions].join(', ') : '',
      favorites.size ? 'Favorite · ' + [...favorites].join(', ') : ''
    ].filter(Boolean);
    if (cue.lastElementChild.textContent !== contents.join('')) {
      cue.lastElementChild.replaceChildren(...contents.map(text => app.node('div', text)));
    }
    cue.toggleAttribute('data-caution', !!cautions.size);
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
    const collapsed = new Set(highlightTagList(collapsedDetailTags));
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
      this.cues.get(row)?.remove(); this.cues.delete(row);
    }
    for (const tag of [root, ...root.querySelectorAll('div.tags>a,ul#torrent_tags_list>li>a')]) {
      const value = this.values.get(tag), entries = this.index.get(value);
      entries?.delete(tag); if (entries && !entries.size) this.index.delete(value);
      this.values.delete(tag); this.restore(tag);
    }
  }
  restore(tag) {
    if (!this.originals.has(tag)) return;
    const title = this.originals.get(tag);
    if (title == null) tag.removeAttribute('title'); else tag.title = title;
    tag.removeAttribute('data-ep-tag-tone'); tag.classList.remove('epc-tag-match'); this.originals.delete(tag);
  }
  choose(tag, tone) {
    const app = this.app;
    // Flush an in-progress form edit before a contextual action updates its lists.
    if (!app.preferences.flush()) return;
    try {
      app.preferences.beforeChange();
      const next = { ...app.settings };
      for (const [key, kind] of [['favoriteTags', 'favorite'], ['cautionTags', 'caution']]) {
        const list = highlightTagList(next[key]).filter(item => item !== tag);
        if (tone === kind) list.push(tag);
        next[key] = list.join(' ');
      }
      app.storage.set('ep.settings', next); app.settings = next;
      for (const key of ['favoriteTags', 'cautionTags']) if (app.controls.has(key)) app.controls.get(key).value = next[key];
      this.refresh(); app.refreshOptionSummaries?.();
      app.doc.getElementById('nseRCMBox')?.classList.add('hidden');
      app.ruleMenuOrigin?.focus({ preventScroll: true });
      app.toast(tone === 'favorite' ? 'Favorite highlighted. Visibility unchanged.' : tone === 'caution' ? 'Caution highlighted. Visibility unchanged.' : 'Highlight cleared.');
    } catch { app.toast('Could not save the highlight. Your previous choices are intact.'); }
  }
  menu(menu, kind, value) {
    menu.querySelector('.epc-highlight-actions')?.remove();
    if (kind !== 'tag') return;
    const tag = value.trim().toLocaleLowerCase(), app = this.app;
    const group = app.node('section', null, 'epc-highlight-actions'); group.setAttribute('aria-label', 'Tag highlight');
    group.append(app.node('p', 'Highlight only', 'epc-caption'));
    const selected = highlightTagList(app.settings.cautionTags).includes(tag) ? 'caution' :
      highlightTagList(app.settings.favoriteTags).includes(tag) ? 'favorite' : '';
    for (const [tone, label] of [['favorite', 'Favorite'], ['caution', 'Caution'], ['', 'Clear highlight']]) {
      const button = app.button(label, () => this.choose(tag, tone)); button.dataset.highlight = tone || 'clear';
      if (tone) button.setAttribute('aria-pressed', String(selected === tone)); else button.hidden = !selected;
      group.append(button);
    }
    menu.append(group);
  }
  dispose() {
    for (const tag of this.originals.keys()) this.restore(tag);
    this.index.clear();
    for (const cue of this.cues.values()) cue.remove();
    this.cues.clear(); this.releaseDetailTags();
  }
}
