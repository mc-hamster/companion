// SPDX-License-Identifier: GPL-3.0-or-later
import { compileConditionalRules } from './conditional-rules.mjs';
import { ConditionalRuleEditor } from './conditional-rule-editor.mjs';
import { torrentID } from './backfill.mjs';
import { mountFilterControls, optionGroup } from './workspace.mjs';
import { resultTitleLink } from './result-tools.mjs';
import { setSettingHelp, settingHelp } from './setting-help.mjs';

const SEEN_PREFIX = 'ep.seen.';
const IGNORED_KEY = 'nseIndividualUploadHidingBlacklist';
const HISTORY_PAGE_SIZE = 25;
const RESULT_ID = /^\d{1,15}$/;
const FREELEECH_ICONS = '.sitewide_leech,.unlimited_leech,.freeleech,[title*="freeleech" i],[title*="free leech" i],[title*="free-leech" i]';

function findFreeleech(row) {
  let kind = '', icon = null;
  for (const node of row.querySelectorAll(FREELEECH_ICONS)) {
    const title = (node.getAttribute('title') || '').trim();
    if (node.classList.contains('unlimited_leech') || /^unlimited\s+free[- ]?leech\b/i.test(title)) {
      return { kind: 'unlimited', icon: node };
    }
    if (node.classList.contains('sitewide_leech') || /^site[- ]?wide\s+free[- ]?leech\b/i.test(title)) {
      kind = 'sitewide'; icon = node;
    } else if (!kind && (node.classList.contains('freeleech') || /^(?:personal\s+)?free[- ]?leech\b/i.test(title)) &&
        !/\bdouble[- ]?seed/i.test(title)) {
      kind = 'other'; icon = node;
    }
  }
  return { kind, icon };
}

export class ResultFilters {
  constructor(app) {
    this.app = app;
    this.pageURL = new URL(app.win.location.href);
    this.bookmarks = this.pageURL.pathname === '/bookmarks.php';
    this.freeleechKey = this.bookmarks ? 'bookmarkFreeleechView' : 'freeleechView';
    this.icons = new WeakMap();
    this.engineReasons = new WeakMap();
    this.reasonNodes = new WeakMap();
  }
  mountFreeleech() {
    const app = this.app;
    const label = app.node('label', null, 'epc-freeleech-view');
    const select = app.node('select');
    select.dataset.setting = this.freeleechKey;
    for (const [value, caption] of [['all', 'All results'], ['freeleech', 'Any freeleech'], ['sitewide', 'Sitewide only']]) {
      const option = app.node('option', caption); option.value = value; select.append(option);
    }
    select.value = app.settings[this.freeleechKey];
    label.append(setSettingHelp(app.node('span', 'Freeleech'),
      'Any freeleech includes permanent and temporary offers. Sitewide only shows time-limited sitewide offers.', select), select);
    label.hidden = true;
    app.controls.set(this.freeleechKey, select);
    app.panes.filters.prepend(label);
    this.freeleechControl = label;
    this.freeleechChip = app.button('', () => {
      if (app.setResultPreference(this.freeleechKey, 'all')) app.paneButtons.get('filters').focus();
    });
    this.freeleechChip.className = 'epc-active-filter';
    this.freeleechChip.hidden = true;
    app.toolbarStatus.append(this.freeleechChip);
  }
  syncFreeleech(available) {
    const mode = this.app.settings[this.freeleechKey];
    this.freeleechControl.hidden = !available;
    this.freeleechChip.hidden = !available || mode === 'all';
    if (this.freeleechChip.hidden) return;
    const caption = mode === 'sitewide' ? 'Sitewide freeleech' : 'Any freeleech';
    this.freeleechChip.textContent = caption + ' ×';
    this.freeleechChip.setAttribute('aria-label', 'Clear ' + caption + ' filter');
  }
  mountRules(parent) {
    this.ruleEditor = new ConditionalRuleEditor(this.app, parent);
  }
  refreshRulesEditor() { this.ruleEditor?.refresh(); }
  addTagRule(tag, uploader) {
    const app = this.app;
    if (!app.preferences.flush()) return;
    mountFilterControls(app);
    if (!this.ruleEditor?.addTagRule(tag, uploader)) return;
    app.doc.getElementById('nseRCMBox')?.classList.add('hidden');
    app.ruleMenuOrigin?.focus({ preventScroll: true });
    app.toast('Conditional rule saved.');
  }
  conditionalMatcher() {
    const source = this.app.settings.conditionalRules;
    if (source === this.ruleSource) return this.matchRules;
    this.ruleSource = source;
    let rules;
    try { rules = compileConditionalRules(source); }
    catch { rules = []; }
    this.matchRules = rules.length ? (tags, title, uploader) => {
      const row = {
        tags: new Set([...tags.querySelectorAll('a')].map(tag => tag.textContent.trim().toLocaleLowerCase())),
        title: title?.textContent.trim().toLocaleLowerCase() || '',
        uploader: uploader?.textContent.trim().toLocaleLowerCase() || ''
      };
      const actions = new Map();
      for (const rule of rules) if (!actions.has(rule.action) && rule.test(row)) actions.set(rule.action, rule);
      return actions;
    } : null;
    return this.matchRules;
  }
  readSeenIDs() {
    return new Set(this.app.storage.list().filter(key => key.startsWith(SEEN_PREFIX))
      .map(key => key.slice(SEEN_PREFIX.length)).filter(id => RESULT_ID.test(id)));
  }
  recordVisit() {
    const { app, pageURL } = this;
    const id = pageURL.searchParams.get('id');
    if (pageURL.pathname !== '/torrents.php' || pageURL.searchParams.has('action') || !RESULT_ID.test(id || '') ||
        !app.doc.querySelector('#content #torrent_tags_list')) return;
    const title = app.doc.querySelector('#content h2')?.textContent.trim().replace(/\s+/g, ' ').slice(0, 240) || '';
    try {
      app.storage.set(SEEN_PREFIX + id, { title, time: Date.now() });
      const ids = this.seen = this.readSeenIDs();
      if (ids.size > 2000) {
        // Prune in batches so ordinary detail opens never have to read every entry.
        const oldest = [...ids].map(id => [id, app.storage.get(SEEN_PREFIX + id, null)?.time || 0])
          .sort((a, b) => a[1] - b[1]).slice(0, ids.size - 1800);
        for (const [id, time] of oldest) if ((app.storage.get(SEEN_PREFIX + id, null)?.time || 0) === time) {
          app.storage.delete(SEEN_PREFIX + id); ids.delete(id);
        }
      }
    } catch { app.report('Seen history could not be updated.'); }
  }
  setEngineReason(row, reason) {
    if (reason) this.engineReasons.set(row, reason);
    else this.engineReasons.delete(row);
  }
  outsideView(row, kind = findFreeleech(row).kind) {
    const view = this.app.settings[this.freeleechKey];
    return view === 'sitewide' ? kind !== 'sitewide' : view === 'freeleech' && !kind;
  }
  renderReason(row, reason) {
    let node = this.reasonNodes.get(row);
    if (!reason) { node?.remove(); this.reasonNodes.delete(row); return; }
    if (!node) {
      const title = resultTitleLink(row);
      if (!title) return;
      node = this.app.node('span', null, 'epc-root epc-filter-reason');
      title.after(node); this.reasonNodes.set(row, node);
    }
    if (node.textContent !== reason) node.textContent = reason;
  }
  applyRow(row) {
    const { app } = this;
    const { kind, icon } = findFreeleech(row);
    const previous = this.icons.get(row);
    if (previous && previous !== icon) delete previous.dataset.epFreeleech;
    if (icon) { icon.dataset.epFreeleech = kind; this.icons.set(row, icon); }
    else this.icons.delete(row);
    const outsideView = this.outsideView(row, kind);
    const mode = app.settings.seenMode;
    const seen = mode !== 'show' && (this.seen ||= this.readSeenIDs()).has(torrentID(row, this.pageURL.href));
    const seenFiltered = seen && mode === 'hide';
    row.classList.toggle('epc-filter-hidden', outsideView || seenFiltered && !app.revealingFiltered);
    row.classList.toggle('epc-seen-revealed', seenFiltered && !!app.revealingFiltered);
    row.classList.toggle('epc-seen-dim', seen && mode === 'dim');
    return { outsideView, seenFiltered };
  }
  refreshSeen() {
    const showingHistory = this.historyVisible();
    if (this.app.settings.seenMode === 'show' && !showingHistory) { this.seen = null; return; }
    const next = this.readSeenIDs(), previous = this.seen;
    this.seen = next;
    if ((!previous || previous.size !== next.size || [...next].some(id => !previous.has(id))) &&
        this.app.settings.seenMode !== 'show' && this.app.filtersReady && this.app.mounted) this.refreshView();
    if (showingHistory) this.renderHistory();
  }
  historyVisible() {
    return this.history?.open && this.app.activePane === 'filters' && !this.app.panel.hidden;
  }
  refreshView() {
    this.app.syncGridFilters(false);
    this.app.media.prepareThumbnails();
    this.app.scheduleHealth();
  }
  mountHistory(parent) {
    if (this.history?.isConnected) return;
    const app = this.app;
    const section = this.history = optionGroup(app, parent, 'Seen & Ignored', { key: 'result-history' });
    const label = app.node('label', null, 'epc-field');
    const mode = app.node('select'); mode.dataset.setting = 'seenMode';
    for (const [value, caption] of [['show', 'Show normally'], ['dim', 'Dim opened results'], ['hide', 'Hide opened results']]) {
      const option = app.node('option', caption); option.value = value; mode.append(option);
    }
    mode.value = app.settings.seenMode;
    label.append(setSettingHelp(app.node('span', 'Previously opened torrents'), settingHelp.seenMode, mode), mode);
    app.controls.set('seenMode', mode);
    const listLabel = app.node('label', null, 'epc-field');
    const listType = this.historyType = app.node('select');
    for (const [value, caption] of [['seen', 'Seen torrents'], ['ignored', 'Ignored torrents']]) {
      const option = app.node('option', caption); option.value = value; listType.append(option);
    }
    listLabel.append(setSettingHelp(app.node('span', 'Review history'),
      'Switch between results you’ve opened and results you’ve hidden individually. You can mark them unseen or unignore them here.', listType), listType);
    this.historyList = app.node('ul', null, 'epc-history-list');
    this.historyCount = app.node('p', '', 'epc-caption');
    this.historyCount.setAttribute('role', 'status');
    const paging = app.node('div', null, 'epc-actions');
    this.historyPage = 0;
    this.historyPrev = app.button('Previous entries', () => { this.historyPage--; this.renderHistory(); });
    this.historyNext = app.button('Next entries', () => { this.historyPage++; this.renderHistory(); });
    paging.append(this.historyPrev, this.historyNext);
    const help = app.node('p', 'Opening a torrent’s details marks it seen in this browser. Choose ', 'epc-caption');
    help.append(app.node('strong', 'Hide this result'), ' (the eye icon) to ignore a torrent.');
    section.append(help, label,
      listLabel, this.historyCount, this.historyList, paging);
    section.addEventListener('toggle', () => { if (section.open) this.refreshSeen(); });
    listType.addEventListener('change', () => { this.historyPage = 0; this.renderHistory(); });
  }
  ignoredIDs() {
    const stored = this.app.storage.get(IGNORED_KEY, []);
    return Array.isArray(stored) ? [...new Set(stored.map(String).filter(id => RESULT_ID.test(id)))] : [];
  }
  renderHistory() {
    const app = this.app, ignored = this.historyType.value === 'ignored';
    const ids = ignored ? this.ignoredIDs() : [...(this.seen ||= this.readSeenIDs())];
    ids.sort((a, b) => Number(b) - Number(a));
    const last = Math.max(0, Math.ceil(ids.length / HISTORY_PAGE_SIZE) - 1);
    this.historyPage = Math.max(0, Math.min(last, this.historyPage));
    const offset = this.historyPage * HISTORY_PAGE_SIZE;
    this.historyList.replaceChildren();
    for (const id of ids.slice(offset, offset + HISTORY_PAGE_SIZE)) {
      const record = app.storage.get(SEEN_PREFIX + id, null);
      const title = typeof record?.title === 'string' ? record.title : '';
      const link = app.node('a', title || 'Torrent #' + id); link.href = '/torrents.php?id=' + id;
      const item = app.node('li');
      item.append(link, app.button(ignored ? 'Unignore' : 'Mark unseen', () => this.removeHistory(id, ignored),
        (ignored ? 'Unignore ' : 'Mark unseen ') + link.textContent));
      this.historyList.append(item);
    }
    this.historyCount.textContent = ids.length ? (offset + 1) + '–' + Math.min(offset + HISTORY_PAGE_SIZE, ids.length) + ' of ' + ids.length :
      (ignored ? 'No ignored torrents.' : 'No seen torrents.');
    this.historyPrev.hidden = this.historyNext.hidden = last === 0;
    this.historyPrev.disabled = this.historyPage === 0;
    this.historyNext.disabled = this.historyPage === last;
  }
  removeHistory(id, ignored) {
    const app = this.app;
    try {
      if (ignored) {
        app.preferences.beforeChange();
        app.storage.set(IGNORED_KEY, this.ignoredIDs().filter(value => value !== id));
        app.refreshFilters(true);
      } else {
        app.storage.delete(SEEN_PREFIX + id);
        this.seen?.delete(id);
        if (app.settings.seenMode !== 'show') this.refreshView();
      }
      this.renderHistory(); this.historyType.focus();
    } catch (error) { app.toast(error.message || 'Could not update history.'); }
  }
}
