// ==UserScript==
// @name         Companion
// @namespace    empornium-companion.local
// @version      2.14.2-alpha.2
// @homepageURL  https://github.com/mc-hamster/companion#readme
// @supportURL   https://github.com/mc-hamster/companion/issues
// @source       https://github.com/mc-hamster/companion
// @updateURL    https://raw.githubusercontent.com/mc-hamster/companion/main/dist/EmporniumCompanion.meta.js
// @downloadURL  https://raw.githubusercontent.com/mc-hamster/companion/main/dist/EmporniumCompanion.user.js
// @description  Reliable images, alternate versions, tag highlights, filters, and saved searches.
// @author       Companion contributors; filtering engine by ceodoe
// @license      GPL-3.0-or-later
// @match        https://empornium.sx/*
// @match        https://www.empornium.sx/*
// @match        https://empornium.me/*
// @match        https://www.empornium.me/*
// @match        https://empornium.is/*
// @match        https://www.empornium.is/*
// @match        https://empornium.ph/*
// @match        https://www.empornium.ph/*
// @match        https://emparadise.rs/*
// @match        https://www.emparadise.rs/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      hamsterimg.net
// @connect      hamster.is
// @connect      empornium.sx
// @connect      empornium.me
// @connect      empornium.is
// @connect      empornium.ph
// @connect      emparadise.rs
// ==/UserScript==

(function () {
"use strict";
// SPDX-License-Identifier: GPL-3.0-or-later
// New companion implementation. Reference projects are attributed in THIRD_PARTY.md.
const DEFAULTS = Object.freeze({
  enabled: true, previews: true, inlineThumbnails: true,
  thumbnailPlacement: 'title', categoryDisplay: 'keep', thumbnailMode: 'auto',
  thumbnailSize: 100, previewWidth: 440, hoverDelay: 140, hideDelay: 240,
  resultsView: 'list', gridCardWidth: 320, gridSpacing: 'standard', gridAutoplayGifs: false, listAutoplayGifs: false,
  gridShowDetails: false, gridShowTags: false, gridTagCues: true, adaptiveDetailTags: false,
  listHiddenColumns: '', collapsedDetailTags: '',
  concurrency: 8, maxRetries: 2, stallMs: 8000, timeoutMs: 24000, thumbnailTimeoutMs: 4500,
  cacheEntries: 24, cacheMegapixels: 48, preloadScreens: 0.8,
  persistentImages: true, persistentCacheMB: 512,
  recoverImages: true, recoverBackgrounds: true, legacyFallback: true,
  prepareGalleries: true, reserveImageSpace: true, compactBodyImages: false,
  progressBar: true, keyboardShortcuts: true, globalArrowNavigation: false, navigationScope: 'off', diagnostics: false,
  backfillEnabled: true, backfillPages: 5, backfillMode: 'off', groupVersions: true,
  favoriteTags: '', cautionTags: '', conditionalRules: '', seenMode: 'show',
  freeleechView: 'all', bookmarkFreeleechView: 'all'
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function isSaveShortcut(event) {
  return event.key.toLowerCase() === 's' && event.ctrlKey !== event.metaKey && !event.altKey && !event.shiftKey;
}

function emporniumAccountID(root, page) {
  const href = root.querySelector('#userinfo_username a[href]')?.getAttribute('href');
  if (!href || !URL.canParse(href, page)) return null;
  const url = new URL(href, page);
  const ids = url.searchParams.getAll('id');
  return url.origin === new URL(page).origin && url.pathname === '/user.php' && !url.searchParams.has('action') &&
    ids.length === 1 && /^[1-9]\d{0,14}$/.test(ids[0]) ? ids[0] : null;
}

function validateSettings(input = {}) {
  const result = { ...DEFAULTS };
  for (const [key, value] of Object.entries(input)) {
    if (!(key in DEFAULTS)) continue;
    if (typeof DEFAULTS[key] === 'boolean' && typeof value === 'boolean') result[key] = value;
  }
  const ranges = {
    thumbnailSize: [48, 300], gridCardWidth: [240, 600], previewWidth: [240, 800], hoverDelay: [0, 1500],
    hideDelay: [100, 1500], concurrency: [1, 8], maxRetries: [0, 3], thumbnailTimeoutMs: [1500, 12000],
    stallMs: [1000, 30000], timeoutMs: [3000, 90000], cacheEntries: [4, 64],
    cacheMegapixels: [8, 160], persistentCacheMB: [32, 2048], preloadScreens: [0, 2], backfillPages: [1, 15]
  };
  for (const [key, range] of Object.entries(ranges)) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key])) {
      result[key] = clamp(input[key], ...range);
    }
  }
  result.timeoutMs = Math.max(result.timeoutMs, result.stallMs + 1000);
  result.concurrency = Math.floor(result.concurrency);
  result.backfillPages = Math.floor(result.backfillPages);
  for (const [key, options] of Object.entries({
    thumbnailPlacement: ['title', 'category'], categoryDisplay: ['keep', 'overlay', 'hide'],
    thumbnailMode: ['auto', 'small', 'supplied', 'original'], navigationScope: ['off', 'results', 'site'],
    backfillMode: ['off', 'pages', 'all'], resultsView: ['list', 'grid'], gridSpacing: ['standard', 'compact'],
    seenMode: ['show', 'dim', 'hide'], freeleechView: ['all', 'freeleech', 'sitewide'],
    bookmarkFreeleechView: ['all', 'freeleech', 'sitewide']
  })) if (options.includes(input[key])) result[key] = input[key];
  if (typeof input.conditionalRules === 'string') result.conditionalRules = input.conditionalRules;
  if (result.thumbnailMode === 'small') result.thumbnailMode = 'auto';
  for (const key of ['favoriteTags', 'cautionTags', 'collapsedDetailTags']) {
    if (typeof input[key] === 'string') {
      if (input[key].length > 50000) throw new Error('Tag highlight list exceeds 50,000 characters.');
      result[key] = [...new Set(input[key].trim().toLocaleLowerCase().split(/\s+/).filter(Boolean))].join(' ');
    }
  }
  if (typeof input.listHiddenColumns === 'string') {
    result.listHiddenColumns = [...new Set(input.listHiddenColumns.split(' ').filter(key =>
      /^(?:files|comments|added|size|snatches|seeds|peers|uploader)$/.test(key)))].join(' ');
  }
  // A caution takes visual precedence if a manually edited list overlaps.
  const caution = new Set(result.cautionTags.split(' '));
  result.favoriteTags = result.favoriteTags.split(' ').filter(tag => !caution.has(tag)).join(' ');
  return result;
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function decodeEntities(value) {
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (m, entity) => {
    if (entity[0] === '#') {
      const code = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[entity.toLowerCase()] || m;
  });
}

function safeImageURL(value, base) {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(decodeEntities(value.trim()), base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    if (/^(download)$/i.test(url.searchParams.get('action') || '') ||
        Array.from(url.searchParams.keys()).some(k => /^(authkey|torrent_pass|passkey)$/i.test(k)) ||
        /\.torrent$/i.test(url.pathname)) return null;
    if (!/\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(url.pathname) &&
        !/\/images\//i.test(url.pathname)) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function canonicalImageURL(value) {
  const url = new URL(value);
  url.searchParams.delete('_ep_retry');
  url.hash = '';
  return url.href;
}

function retryURL(value, nonce) {
  const url = new URL(value);
  url.searchParams.set('_ep_retry', String(nonce));
  return url.href;
}

function legacyOriginal(value) {
  const url = new URL(value);
  if (!/^(?:fapping|jerking|cache)\.empornium\.(?:sx|me|is|ph)$/i.test(url.hostname)) return null;
  if (!/^\/images\/resize\/\d+\//.test(url.pathname)) return null;
  url.pathname = url.pathname.replace(/^\/images\/resize\/\d+\//, '/images/');
  return url.href;
}

function isFriendlyImageHost(host) {
  return /^(?:hamsterimg\.net|hamster\.is|(?:fapping|jerking|cache)\.empornium\.(?:sx|me|is|ph))$/i.test(host);
}

function fullSizeURL(value) {
  const original = legacyOriginal(value) || value;
  const url = new URL(original);
  if (isFriendlyImageHost(url.hostname)) url.pathname = url.pathname.replace(/\.(?:th|md)(\.[^/.]+)$/i, '$1');
  return url.href;
}

function thumbnailCandidates(value, mode = 'auto', known = []) {
  const result = [];
  const supplied = canonicalImageURL(value);
  const full = fullSizeURL(supplied);
  if (mode === 'small' || mode === 'auto') {
    result.push(...known);
    const url = new URL(full);
    if (isFriendlyImageHost(url.hostname)) {
      url.pathname = url.pathname.replace(/(\.[^/.]+)$/, '.th$1');
      result.push(url.href);
    }
    result.push(supplied, full);
  } else if (mode === 'original') result.push(full, supplied);
  else if (mode === 'supplied') result.push(supplied, full);
  else result.push(...known, supplied, full);
  return Array.from(new Set(result.filter(Boolean)));
}

// Parses server-provided string literals as data. Never executes page JavaScript or
// inserts overlay HTML into a document (which could eagerly fetch every preview).
function parseOverlayDefinitions(text, base) {
  const definitions = [];
  const pattern = /(?:var|let|const)\s+(overlay\d+)\s*=\s*("(?:\\.|[^"\\])*")\s*;?/g;
  for (const match of String(text).matchAll(pattern)) {
    let html;
    try { html = JSON.parse(match[2]); } catch { continue; }
    const image = html.match(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const src = image && safeImageURL(image[1] ?? image[2] ?? image[3], base);
    if (!src) continue;
    const provided = html.match(/\bdata-(?:thumbnail|thumb)\s*=\s*["']([^"']+)["']/i);
    const thumbnail = provided && safeImageURL(provided[1], base);
    const summary = decodeEntities(html.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 800);
    definitions.push({ name: match[1], src, summary, ...(thumbnail ? { thumbnail } : {}) });
  }
  return definitions;
}

function imageState({ hasSource, complete, width, deferred, stalled }) {
  if (!hasSource) return deferred ? 'deferred' : 'empty';
  if (complete) return width > 0 ? 'ready' : 'failed';
  return stalled && !width ? 'stalled' : width > 0 ? 'streaming' : 'loading';
}

function editableTarget(target) {
  return !!target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]');
}

function isNSEPage(location) {
  const url = new URL(location);
  if (url.pathname === '/torrents.php') return true;
  if (/^\/collage(?:s\.php|\/)/.test(url.pathname)) return true;
  if (url.pathname === '/requests.php') return true;
  if (url.pathname === '/user.php') return url.searchParams.get('action') === 'notify';
  return url.pathname === '/top10.php' && !['users', 'tags', 'taggers'].includes(url.searchParams.get('type'));
}

const SEARCH_NAMES = /^(?:searchtext|title|sizeall|sizerange|filelist|taglist|filter_freeleech|limit_matches|order_by|order_way|sizeunit|sizeselect|sizeunits|sizetype|autocomplete_toggle|searchstr|filter_cat\[\d+\])$/;
function validSearchFields(fields) {
  if (!Array.isArray(fields) || fields.length > 500) throw new Error('Invalid saved search fields.');
  return fields.map(field => {
    if (!field || !SEARCH_NAMES.test(field.name) || typeof field.value !== 'string' ||
        field.value.length > 20000 || !['text', 'textarea', 'checkbox', 'radio', 'select-one', 'select-multiple', 'number', 'hidden'].includes(field.type)) {
      throw new Error('Invalid saved search field.');
    }
    return { name: field.name, value: field.value, type: field.type, checked: !!field.checked };
  });
}

function validateSearches(input) {
  if (!Array.isArray(input) || input.length > 1000) throw new Error('Invalid saved searches.');
  return input.map((search, index) => {
    if (!search || typeof search.title !== 'string' || search.title.length > 300) throw new Error('Invalid search title.');
    let fields = search.fields;
    if (!fields && Array.isArray(search.textInputs) && Array.isArray(search.checkBoxes)) {
      fields = search.textInputs.map(f => ({ name: f.name, value: String(f.value ?? ''), type: 'text' }))
        .concat(search.checkBoxes.map(f => ({ name: f.name, value: '1', checked: !!f.checked, type: 'checkbox' })));
    }
    return { id: String(search.id || 'import-' + index + '-' + Date.now()), title: search.title,
      date: typeof search.date === 'string' ? search.date.slice(0, 120) : '', fields: validSearchFields(fields) };
  });
}

class RetryBudget {
  constructor(now = Date.now, maxRetries = 2) { this.now = now; this.maxRetries = maxRetries; this.items = new Map(); }
  get(url) {
    const key = canonicalImageURL(url);
    if (!this.items.has(key)) this.items.set(key, { attempts: 0, last: 0, manual: -Infinity });
    return this.items.get(key);
  }
  seed(url) { const b = this.get(url); if (!b.attempts) { b.attempts = 1; b.last = this.now(); } }
  consume(url) {
    const b = this.get(url);
    if (b.attempts >= this.maxRetries + 1) return false;
    b.attempts++; b.last = this.now(); return true;
  }
  manual(url) {
    const b = this.get(url), now = this.now();
    if (now - b.manual < 3000) return false;
    if (b.attempts >= this.maxRetries + 1 && now - b.last < 30000) return false;
    if (b.attempts >= this.maxRetries + 1) b.attempts = 0;
    b.manual = now; return true;
  }
  rescue(url) {
    const b = this.get(url);
    if (b.rescued) return false;
    b.rescued = true;
    b.rescueFrom = b.attempts;
    if (b.attempts >= this.maxRetries + 1) b.attempts = 0;
    return true;
  }
}

// Only requests created by this scheduler are concurrency-limited. Native page
// transfers may already be running before a userscript can observe their elements.
class MediaPool {
  constructor(env, settings = DEFAULTS) {
    this.env = env; this.settings = settings; this.entries = new Map(); this.readyImages = new Map(); this.queue = [];
    this.batchDepth = 0; this.queueDirty = false;
    this.active = 0; this.sequence = 0; this.hosts = new Map(); this.activeLanes = { cache: 0, thumbnail: 0, large: 0 };
    this.budget = new RetryBudget(() => env.now(), settings.maxRetries);
    this.listeners = new Set(); this.disposed = false;
    this.restoreHosts(env.hostHistory);
  }
  emit(entry) {
    entry.touched = this.env.now();
    for (const listener of entry.listeners) { try { listener(entry); } catch (e) { this.env.report?.(e); } }
    for (const listener of this.listeners) listener(entry);
    if (entry.keepAlive && !entry.listeners.size && entry.dimensions) this.trim();
  }
  batch(operation) {
    this.batchDepth++;
    try { return operation(); }
    finally {
      if (!--this.batchDepth) {
        if (this.pumpPending) this.pump();
        if (this.trimPending) this.trim();
      }
    }
  }
  recordMemoryHit(entry) {
    this.env.imageCache?.recordActivity?.('hit', entry.cacheBytes);
    if (this.settings.diagnostics) this.env.diagnostic?.(entry, 'cache', {cacheOutcome: 'hit', cacheReason: 'memory-reuse', elapsedMs: 0});
  }
  request(url, options = {}) {
    const canonical = canonicalImageURL(url), tier = options.tier || 'normal', key = canonical + '|' + tier;
    let entry = this.entries.get(key);
    if ((!entry || entry.status === 'failed') && !options.force && !options.strictCandidates) {
      const shared = Array.from(this.entries.values()).find(e => !e.cancelled &&
        ['loading', 'streaming', 'stalled', 'ready', 'partial'].includes(e.status) &&
        e.actualKey === canonical);
      if (shared) {
        if (shared.status === 'ready' && (shared.cacheMode || options.cacheMode)) this.recordMemoryHit(shared);
        shared.keepAlive ||= !!options.keepAlive; shared.touched = this.env.now();
        shared.priority = Math.max(shared.priority, options.priority || 0);
        if (shared.image && shared.priority >= 50) shared.image.fetchPriority = 'high';
        return shared;
      }
    }
    if (entry && !options.force) {
      if (entry.status === 'ready' && (entry.cacheMode || options.cacheMode)) this.recordMemoryHit(entry);
      entry.keepAlive ||= !!options.keepAlive; entry.touched = this.env.now();
      if (options.eligible) {
        const previous = entry.eligible;
        entry.eligible = previous ? () => previous() || options.eligible() : options.eligible;
      }
      if (options.priorityFor) {
        const previous = entry.priorityFor;
        entry.priorityFor = previous ? () => Math.max(previous(), options.priorityFor()) : options.priorityFor;
      }
      entry.priority = Math.max(entry.priority, options.priority || 0);
      if (entry.image && entry.priority >= 50) entry.image.fetchPriority = 'high';
      if (entry.status === 'queued') { this.queueDirty = true; this.pump(); }
      return entry;
    }
    if (options.rescue ? !this.budget.rescue(canonical) : options.force && !this.budget.manual(canonical)) return entry || null;
    const listeners = entry?.listeners || new Set();
    if (entry) { this.cancel(entry); this.entries.delete(key); }
    if (options.failedAlready) this.budget.seed(canonical);
    const candidates = Array.from(new Set((options.candidates || [canonical]).filter(Boolean)));
    entry = { key, url: canonical, candidates, candidateIndex: 0, actualURL: candidates[0],
      status: 'queued', priority: options.priority || 0, sequence: ++this.sequence,
      listeners, image: null, touched: this.env.now(), attempts: 0,
      dimensions: null, released: true, cancelled: false, timers: [] };
    entry.lane = options.lane || 'thumbnail';
    entry.keepAlive = !!options.keepAlive;
    entry.cacheMode = options.cacheMode || null;
    entry.gridAutoplay = options.gridAutoplay === true;
    entry.cacheFresh = !!options.force;
    entry.target = options.target || null;
    entry.eligible = options.eligible;
    entry.priorityFor = options.priorityFor;
    entry.timeoutMs = options.timeoutMs || this.settings.timeoutMs;
    entry.fullTimeoutMs = options.fullTimeoutMs || entry.timeoutMs;
    entry.smallFirst = !!options.smallFirst;
    entry.smallCandidates = new Set(options.smallCandidates || []);
    entry.strictCandidates = !!options.strictCandidates;
    entry.singleAttempt = !!options.singleAttempt; entry.rescue = !!options.rescue;
    entry.rescueBase = this.budget.get(canonical).rescueFrom || 0;
    if (options.failedAlready && this.settings.legacyFallback && !entry.strictCandidates) {
      const original = legacyOriginal(canonical);
      if (original) { entry.candidates = [original, ...candidates.filter(c => c !== original)]; entry.actualURL = original; }
    }
    entry.bustFirst = !!options.fresh;
    this.entries.set(key, entry); this.enqueue(entry); this.trim();
    return entry;
  }
  enqueue(entry) {
    this.queue.push(entry); this.queueDirty = true;
    this.emit(entry); this.pump();
  }
  subscribe(entry, listener) {
    if (!entry) return () => {};
    entry.listeners.add(listener); listener(entry);
    return () => {
      entry.listeners.delete(listener);
      let reschedule = false;
      const live = this.entries.get(entry.key);
      if (live && live.listeners === entry.listeners && !live.listeners.size) {
        if (live.keepAlive && live.lane === 'large') {
          // The popup is gone; keep the original warming without retaining its
          // DOM/hover eligibility closures or reserved interactive priority.
          live.priority = 10; live.priorityFor = null; live.eligible = null;
          this.queueDirty ||= live.status === 'queued';
          live.touched = this.env.now();
          if (live.image) live.image.fetchPriority = 'low';
          reschedule = ['queued', 'loading', 'streaming', 'stalled', 'retrying'].includes(live.status);
        } else if (live.priority >= 90 && ['queued', 'loading', 'streaming', 'stalled', 'retrying'].includes(live.status)) {
          // Moving away is not a host failure. Refund only the cancelled in-flight
          // attempt, retaining failures already charged to this URL.
          this.refundTransfer(live);
          this.cancel(live); this.entries.delete(live.key);
          reschedule = true;
        }
      }
      this.trim();
      if (reschedule) this.pump();
    };
  }
  abandon(entry) {
    if (!entry || this.entries.get(entry.key) !== entry || entry.listeners.size ||
        !['queued', 'loading', 'streaming', 'stalled', 'retrying'].includes(entry.status)) return;
    this.refundTransfer(entry);
    this.cancel(entry); this.entries.delete(entry.key); this.pump();
  }
  pump() {
    if (this.disposed) return;
    if (this.batchDepth) { this.pumpPending = true; return; }
    this.pumpPending = false;
    const hidden = this.env.hidden();
    if (hidden && !this.wasHidden) for (const e of this.entries.values()) if (!e.released) e.hostTimingIgnored = true;
    this.wasHidden = hidden;
    this.env.clearTimeout(this.wakeTimer); this.wakeTimer = null;
    const revision = this.env.priorityRevision?.();
    if (this.queueDirty || revision === undefined || revision !== this.rankedRevision) {
      for (const entry of this.queue) if (entry.priorityFor) entry.priority = entry.priorityFor();
      this.queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
      this.queueDirty = false; this.rankedRevision = revision;
    }
    while (this.queue.length) {
      const index = this.queue.findIndex(e => !e.cancelled && (e.priority >= 90 || !hidden) &&
        this.hasSlot(e) && (!e.eligible || e.eligible()));
      if (index < 0) {
        // One deadline timer for eligible host cooldowns; no idle polling.
        const now = this.env.now(); let deadline = Infinity;
        for (const e of this.queue) if (!e.cancelled && (e.priority >= 90 || !hidden) && !this.canLookup(e)) {
          const host = this.hostFor(e);
          if (host.until > now && host.until < deadline && (!e.eligible || e.eligible())) deadline = host.until;
        }
        if (Number.isFinite(deadline)) this.wakeTimer = this.env.setTimeout(() => this.pump(), deadline - now + 1);
        break;
      }
      const entry = this.queue.splice(index, 1)[0];
      const cacheOnly = this.canLookup(entry);
      if (!cacheOnly && !this.budget.consume(entry.url)) { entry.status = 'failed'; entry.reason = 'Retry limit reached. Try again after a short pause.'; this.emit(entry); continue; }
      this.load(entry, cacheOnly);
    }
  }
  canLookup(entry) {
    if (entry.cacheMode !== 'thumbnail' || entry.cacheDisabled || entry.cacheFresh || entry.cacheFault || entry.bustFirst) return false;
    const candidate = entry.candidates[entry.candidateIndex] || entry.url, cache = this.env.imageCache;
    if (candidate === entry.cacheChecked || candidate === entry.lastCandidate || !cache?.enabled()) return false;
    if (entry.lookupCandidate !== candidate) {
      entry.lookupCandidate = candidate;
      entry.lookupAllowed = !!cache.allowed?.(candidate);
    }
    return entry.lookupAllowed;
  }
  hasSlot(entry) {
    // Local thumbnail reads and decoding have their own limit. Host cooldowns
    // and slow transfers only apply if a thumbnail needs the network.
    if (this.canLookup(entry)) return this.activeLanes.cache < this.settings.concurrency;
    if (this.active - this.activeLanes.cache >= this.settings.concurrency + 3) return false;
    const lane = this.transferLane(entry), host = this.hostFor(entry);
    if (this.env.now() < host.until) return false;
    if (this.activeLanes[lane] >= (lane === 'thumbnail' ? this.settings.concurrency : entry.priority >= 90 ? 3 : 2)) return false;
    const hostLimit = Math.min(host.limit, this.settings.concurrency);
    // Keep thumbnails and visible playback moving alongside each other after cooldown.
    const thumbnailReserve = lane === 'thumbnail' && hostLimit === 1 && host.large === 1 && !host.thumbnail;
    const playbackReserve = entry.gridAutoplay && lane === 'large' && hostLimit === 1 && host.thumbnail === 1 && !host.large;
    if (host.constrained && host.thumbnail + host.large >= hostLimit && !thumbnailReserve && !playbackReserve) return false;
    // Ordinary large images have their own bounded lane. A hover can use one
    // extra host slot without displacing active thumbnail pixels.
    return lane === 'thumbnail' ? host.thumbnail < hostLimit :
      host.large < (entry.priority >= 90 ? 3 : Math.min(2, host.limit));
  }
  hostFor(entry) {
    const candidate = entry.candidates[entry.candidateIndex] || entry.url;
    if (entry.hostCandidate !== candidate) { entry.hostCandidate = candidate; entry.hostKey = new URL(candidate).host.toLowerCase(); }
    let host = this.hosts.get(entry.hostKey);
    if (!host) {
      // At most a small page-local history; active hosts are never evicted.
      if (this.hosts.size >= 128) for (const [key, value] of this.hosts) if (!value.thumbnail && !value.large) { this.hosts.delete(key); break; }
      host = { limit: 2, safeLimit: 1, thumbnail: 0, large: 0, baseline: 0, good: 0, generation: 0, constrained: false,
        growAfter: 0, until: 0, failures: [] };
      this.hosts.set(entry.hostKey, host);
    }
    return host;
  }
  restoreHosts(history) {
    if (!Array.isArray(history)) return;
    const now = this.env.now();
    for (const item of history.slice(0,32)) {
      try {
        if (!item || typeof item.host !== 'string' || new URL('https://' + item.host).host !== item.host ||
            !Number.isFinite(item.time) || item.time > now + 1000 || now - item.time > 86400000 ||
            !Number.isInteger(item.limit) || item.limit < 1 || item.limit > 6 ||
            !Number.isFinite(item.baseline) || item.baseline < 0 || item.baseline > 30000) continue;
        this.hosts.set(item.host, { limit:item.limit, safeLimit:Number.isInteger(item.safeLimit) ? clamp(item.safeLimit,1,item.limit) : 1,
          baseline:item.baseline, constrained:item.constrained === true, thumbnail:0, large:0, good:0, generation:0, failures:[],
          updated:item.time, until:clamp(Number(item.until)||0,0,now+15000), growAfter:clamp(Number(item.growAfter)||0,0,now+30000) });
      } catch {}
    }
  }
  hostChanged(host) {
    host.updated = this.env.now();
    if (!this.env.saveHosts) return;
    this.hostsDirty = true;
    if (!this.hostSaveTimer) this.hostSaveTimer = this.env.setTimeout(() => { this.hostSaveTimer = null; this.flushHosts(); },500);
  }
  flushHosts() {
    if (!this.hostsDirty) return;
    this.hostsDirty = false;
    const history = [...this.hosts].filter(([,h])=>h.updated).sort((a,b)=>b[1].updated-a[1].updated).slice(0,32)
      .map(([host,h])=>({host,limit:h.limit,safeLimit:h.safeLimit,baseline:h.baseline,constrained:h.constrained,until:h.until,growAfter:h.growAfter,time:h.updated}));
    // Advisory learning must never make image loading depend on a storage write.
    try { this.env.saveHosts?.(history); } catch {}
  }
  hostFeedback(entry, outcome) {
    if (!entry.hostState || entry.hostSampled || outcome !== 'error' && (this.env.hidden() || entry.hostTimingIgnored)) return;
    if (outcome === 'timeout') outcome = 'error';
    if (outcome !== 'slow') entry.hostSampled = true;
    const host = entry.hostState, now = this.env.now(), elapsed = now - entry.started;
    if (outcome === 'error') {
      host.constrained = true;
      host.failures = host.failures.filter(f => now - f.time < 30000);
      if (!host.failures.some(f => f.url === entry.url)) host.failures.push({ url: entry.url, time: now });
      host.failures = host.failures.slice(-6);
      if (entry.hostGeneration === host.generation) {
        host.limit = host.safeLimit < host.limit ? host.safeLimit : Math.max(1, Math.floor(host.limit / 2)); host.generation++;
      }
      host.good = 0; host.growAfter = Math.max(host.growAfter, now + 30000);
      host.until = Math.max(host.until, now + 250);
      // A lone missing variant can fall back immediately; repeated independent
      // failures cool down only this host, including interactive retries.
      if (host.failures.length >= 2) host.until = Math.max(host.until, now + (host.failures.length >= 6 ? 15000 : 1000));
      this.hostChanged(host);
      return;
    }
    if (entry.hostGeneration !== host.generation) return; // Ignore successes from before a reduction.
    let slow = outcome === 'slow' || entry.activeLane === 'thumbnail' && host.baseline && elapsed > Math.max(250, host.baseline * 1.6);
    if (slow && outcome === 'success' && host.limit === 1 && now >= host.growAfter && elapsed < this.settings.stallMs) {
      // At serial demand, a stable RTT change is a new baseline, not evidence
      // that more parallel work is still overloading the host.
      host.baseline = elapsed; host.good = 0; slow = false; this.hostChanged(host);
    }
    if (slow) {
      host.constrained = true;
      const reduced = host.limit > 1;
      host.limit = Math.max(1, host.limit - 1); host.good = 0;
      if (reduced || outcome === 'slow') { host.generation++; host.growAfter = now + 10000; this.hostChanged(host); }
      return;
    }
    if (entry.activeLane !== 'thumbnail' || elapsed < 40 || outcome !== 'success') return;
    const firstBaseline = !host.baseline;
    host.baseline = host.baseline ? Math.min(host.baseline * 1.01, elapsed) : elapsed;
    if (firstBaseline) this.hostChanged(host);
    if (now < host.growAfter) return;
    if (++host.good >= Math.max(4, host.limit * 2)) {
      const next = Math.min(6, this.settings.concurrency, host.limit + 1);
      host.safeLimit = host.limit; host.good = 0;
      if (next > host.limit) { host.limit = next; host.generation++; }
      this.hostChanged(host);
    }
  }
  transferLane(entry) {
    const candidate = entry.candidates[entry.candidateIndex] || entry.url;
    // Full-size fallbacks must not occupy the small-image lane.
    const small = entry.smallCandidates.has(canonicalImageURL(candidate)) || /\.(?:th|md)\.[^/.?]+(?:\?|$)/i.test(candidate);
    return entry.lane === 'thumbnail' && (!entry.smallFirst || small) ? 'thumbnail' : 'large';
  }
  load(entry, cacheOnly) {
    this.active++; entry.released = false; entry.status = 'loading';
    entry.started = this.env.now(); entry.cancelled = false;
    const lane = this.transferLane(entry);
    entry.activeLane = cacheOnly ? 'cache' : lane; entry.hostState = cacheOnly ? null : this.hostFor(entry);
    entry.hostSampled = false; entry.hostTimingIgnored = cacheOnly || this.env.hidden();
    this.activeLanes[entry.activeLane]++;
    if (entry.hostState) {
      entry.attempts++; entry.hostGeneration = entry.hostState.generation; entry.hostState[lane]++;
    }
    const image = entry.target || new this.env.Image(); entry.image = image;
    const loadVersion = entry.loadVersion = (entry.loadVersion || 0) + 1;
    const current = () => !entry.cancelled && !this.disposed && entry.loadVersion === loadVersion;
    const cache = this.env.imageCache;
    const diagnostic = this.settings.diagnostics && this.env.diagnostic ? (kind, details) => {
      if (current()) this.env.diagnostic(entry, kind, details);
    } : undefined;
    entry.displayURL = null; entry.cacheResult = null; entry.cacheHit = false;entry.cacheBytes=0;
    const timeoutMs = lane === 'large' ? entry.fullTimeoutMs : entry.timeoutMs;
    image.decoding = 'async'; image.fetchPriority = entry.priority >= 50 ? 'high' : 'low';
    const candidate = entry.candidates[entry.candidateIndex] || entry.url;
    const requestedKey = entry.actualKey = canonicalImageURL(candidate);
    let url = candidate;
    const repeated = entry.lastCandidate === url;
    const cacheFresh = !!entry.bustFirst || !!entry.cacheFresh || !!entry.cacheFault || repeated || entry.cacheChecked === url;
    if (!cacheOnly) entry.lastCandidate = url;
    if (repeated || entry.bustFirst) url = retryURL(url, this.env.now() + '-' + entry.sequence);
    entry.bustFirst = false; entry.actualURL = url;
    const assign = (displayURL, native = false) => {
      if (!current()) return;
      if (native) diagnostic?.('transport', {transport: 'native', httpStatus: null});
      entry.displayURL = displayURL;
      if (image.dataset) image.dataset.epImageSource = url;
      image.src = displayURL;
    };
    const queueTransfer = () => {
      entry.cacheChecked = entry.candidates[entry.candidateIndex] || entry.url;
      entry.loadVersion++;
      entry.abortTransfer?.(); entry.abortTransfer = null; entry.cacheResult = null;
      this.clearTimers(entry); this.release(entry); image.onload = image.onerror = null;
      if (entry.displayURL) image.removeAttribute?.('src');
      entry.displayURL = null; entry.status = 'queued'; this.enqueue(entry);
    };
    const failed = (reason, outcome = 'error') => {
      if (!current() || entry.status === 'ready' || entry.status === 'failed') return;
      entry.abortTransfer?.(); entry.abortTransfer = null;
      if (entry.cacheHit) { void this.env.imageCache?.remove(entry.actualURL); entry.cacheFault = true; }
      if (outcome !== 'missing') this.hostFeedback(entry, outcome);
      this.clearTimers(entry); this.release(entry); image.onload = image.onerror = null;
      image.removeAttribute?.('src');
      const before = entry.candidateIndex;
      if (entry.candidateIndex + 1 < entry.candidates.length) entry.candidateIndex++;
      else if (this.settings.legacyFallback && !entry.strictCandidates) {
        const original = legacyOriginal(entry.url);
        if (original && !entry.candidates.includes(original)) { entry.candidates.push(original); entry.candidateIndex = entry.candidates.length - 1; }
      }
      if (!entry.singleAttempt && (outcome !== 'missing' || entry.candidateIndex !== before) &&
          this.budget.get(entry.url).attempts < this.settings.maxRetries + 1) {
        entry.status = 'retrying'; entry.reason = reason;
        this.emit(entry);
        if (entry.cancelled || this.disposed) { this.pump(); return; }
        const timer = this.env.setTimeout(() => {
          if (entry.cancelled || this.disposed) return;
          entry.status = 'queued'; this.enqueue(entry);
        }, entry.candidateIndex !== before ? 0 : Math.min(4000, 700 * 2 ** (entry.attempts - 1)));
        entry.timers.push(timer);
      } else {
        if (entry.rescue) this.budget.get(entry.url).attempts = this.settings.maxRetries + 1;
        entry.status = 'failed'; entry.reason = reason; this.emit(entry);
      }
      this.pump();
    };
    image.onload = () => {
      if (!current()) return;
      if (!image.naturalWidth) { failed('The image could not be displayed.'); return; }
      if (cacheOnly) entry.attempts++;
      this.hostFeedback(entry, 'success'); this.clearTimers(entry); this.release(entry);
      entry.dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      // Completed loads begin a new failure streak. Retain manual/rescue guards,
      // but do not charge later cache misses for earlier successful transfers.
      this.budget.get(entry.url).attempts = 0;
      if(entry.cacheResult){entry.cacheBytes=entry.cacheResult.blob?.size||0;this.env.imageCache.recordActivity?.(entry.cacheResult.hit?'hit':'download',entry.cacheBytes);}
      if (entry.cacheResult && !entry.cacheResult.hit) void this.env.imageCache.commit(entry.actualURL, entry.cacheResult.blob, entry.cacheResult.epoch, entry.cacheResult.kind);
      entry.cacheResult = null; entry.abortTransfer = null;
      entry.status = 'ready'; entry.reason = '';
      if (entry.cacheHit) diagnostic?.('cache', {cacheOutcome: 'hit',
        cacheReason: entry.actualKey === requestedKey ? 'preferred-candidate' : 'alternate-candidate'});
      this.readyImages.set(entry.actualKey, entry);
      this.emit(entry); this.pump(); this.trim();
    };
    image.onerror = () => {
      if (!current()) return;
      if (entry.displayURL?.startsWith('data:')) {
        // Corrupt saved bytes or a page CSP must never break ordinary images.
        if (entry.cacheHit) {
          diagnostic?.('cache', {cacheOutcome: 'unusable', cacheReason: cache.displayBlocked ? 'data-url-blocked' : 'decode-error'});
          if (!cache.displayBlocked) {
            cache.recordActivity?.('miss'); void cache.remove(entry.actualURL);
          }
        }
        entry.cacheFault = true; entry.cacheDisabled = true; entry.cacheHit = false; entry.cacheResult = null;
        if (cacheOnly) { queueTransfer(); return; }
        entry.abortTransfer?.(); entry.abortTransfer = null;
        assign(url, true); return;
      }
      failed('The image request failed.');
    };
    let usingNativePlayback = false;
    if (!cacheOnly) entry.timers.push(this.env.setTimeout(() => {
      if (!current() || entry.status !== 'loading') return;
      if (entry.gridAutoplay && !entry.displayURL && entry.abortTransfer) {
        // A buffered download cannot show frames until the full response arrives.
        usingNativePlayback = entry.preferNativePlayback = true;
        entry.abortTransfer(); entry.abortTransfer = null;
        assign(url, true);
        return;
      }
      if (image.naturalWidth) {
        entry.dimensions = { width: image.naturalWidth, height: image.naturalHeight };
        entry.status = 'streaming'; entry.reason = 'The full image is still loading.';
      } else { this.hostFeedback(entry, 'slow'); entry.status = 'stalled'; entry.reason = 'Still waiting for the image host.'; }
      this.emit(entry); this.pump();
    }, this.settings.stallMs));
    entry.timers.push(this.env.setTimeout(() => {
      if (!current() || entry.status === 'ready') return;
      if (image.naturalWidth) {
        // Preserve a usable progressive image/animation. Do not wait for decode(),
        // which waits for every frame of an animation before resolving.
        entry.dimensions = { width: image.naturalWidth, height: image.naturalHeight };
        entry.hostSampled = true; entry.status = 'partial'; this.release(entry); this.emit(entry); this.pump();
      } else if (cacheOnly) {
        diagnostic?.('cache', {cacheOutcome: 'unavailable', cacheReason: entry.cacheHit ? 'decode-timeout' : 'lookup-timeout'});
        queueTransfer();
      }
      else failed('The image did not respond in time.', 'timeout');
    }, timeoutMs));
    this.emit(entry);
    if (!current()) return;
    // A bounded check on active requests only, not a scan of the page. Image
    // elements have no byte-progress event, and metadata can arrive before load.
    const firstFrame = () => {
      if (!current() || ['ready', 'failed', 'partial'].includes(entry.status)) return;
      if (image.naturalWidth) {
        entry.dimensions = { width: image.naturalWidth, height: image.naturalHeight };
        entry.status = 'streaming'; entry.reason = 'The full image is still loading.'; this.emit(entry);
      } else entry.timers.push(this.env.setTimeout(firstFrame, 160));
    };
    entry.timers.push(this.env.setTimeout(firstFrame, 80));
    if (entry.cacheMode && !entry.cacheDisabled && cache?.enabled()) {
      if (diagnostic && cacheFresh && entry.cacheChecked !== candidate) {
        diagnostic('cache', {cacheOutcome: 'skipped', cacheReason: entry.cacheFresh ? 'forced' : 'retry'});
      }
      const abort = cache.load(url, {
        kind: entry.cacheMode === 'thumbnail' ? 'thumbnail' : 'preview',
        network: !cacheOnly && !entry.preferNativePlayback && (entry.cacheMode === 'network' || entry.cacheMode === 'thumbnail' &&
          (lane === 'thumbnail' || !/\.gif(?:\?|$)/i.test(url))),
        candidates: entry.cacheMode === 'thumbnail' && entry.smallFirst ? entry.candidates.slice(entry.candidateIndex + 1) : [],
        fresh: cacheFresh, diagnostic
      }, result => {
        if (!current() || usingNativePlayback) return;
        if (cacheOnly && !result?.hit) { queueTransfer(); return; }
        if (!result) { assign(url, true); return; }
        if (result.failure) {
          // A confirmed missing thumbnail variant says nothing about host capacity.
          const thumbnail = entry.strictCandidates || entry.cacheMode === 'thumbnail' && lane === 'thumbnail';
          const missing = thumbnail && (result.status === 404 || result.status === 410);
          failed('The image host returned HTTP ' + result.status + '.', missing ? 'missing' : 'error'); return;
        }
        entry.cacheHit = result.hit; entry.cacheResult = result;
        if (result.hit) {
          entry.hostTimingIgnored = true;
          if (result.key) {
            url = result.key; entry.actualURL = url; entry.actualKey = canonicalImageURL(url);
            if (!cacheOnly) entry.lastCandidate = url;
            entry.candidateIndex = Math.max(0, entry.candidates.findIndex(candidate => canonicalImageURL(candidate) === url));
          }
        }
        assign(result.dataURL);
      });
      if (current()) entry.abortTransfer = abort; else abort?.();
    } else {
      if (diagnostic && entry.cacheMode && entry.cacheChecked !== candidate) {
        diagnostic('cache', {cacheOutcome: 'skipped', cacheReason: entry.cacheDisabled ? 'previous-decode-error' :
          cache?.unavailableReason?.() || 'storage-unavailable'});
      }
      if (cacheOnly) queueTransfer(); else assign(url, true);
    }
  }
  refundTransfer(entry) {
    if (entry.released || !entry.hostState) return;
    const budget = this.budget.get(entry.url);
    budget.attempts = Math.max(entry.rescue ? entry.rescueBase : 0, budget.attempts - 1);
  }
  release(entry) {
    if (entry.released) return;
    entry.released = true; this.active = Math.max(0, this.active - 1);
    this.activeLanes[entry.activeLane]--;
    if (entry.hostState) entry.hostState[entry.activeLane]--;
  }
  clearTimers(entry) { for (const timer of entry.timers) this.env.clearTimeout(timer); entry.timers = []; }
  cancel(entry) {
    if (entry.status === 'ready') {
      if (this.readyImages.get(entry.actualKey) === entry) this.readyImages.delete(entry.actualKey);
    }
    entry.loadVersion = (entry.loadVersion || 0) + 1; entry.abortTransfer?.(); entry.abortTransfer = null; entry.cacheResult = null;
    entry.cancelled = true; this.clearTimers(entry); this.release(entry);
    if (entry.image) {
      entry.image.onload = entry.image.onerror = null;
      const displayed = entry.target || entry.image.isConnected;
      if (!displayed || !['ready', 'streaming', 'partial'].includes(entry.status)) entry.image.removeAttribute?.('src');
    }
    this.queue = this.queue.filter(e => e !== entry);
  }
  trim() {
    if (this.batchDepth) { this.trimPending = true; return; }
    this.trimPending = false;
    const idle = Array.from(this.entries.values()).filter(e => !e.listeners.size &&
      (['ready', 'failed', 'partial'].includes(e.status) || e.keepAlive &&
        ['queued', 'loading', 'streaming', 'stalled', 'retrying'].includes(e.status))).sort((a, b) =>
      Number(!!a.keepAlive) - Number(!!b.keepAlive) || a.touched - b.touched);
    // Cache limits apply to idle retained work/pixels. Live page consumers are
    // not cache entries and must not immediately evict a warming original.
    const pixels = () => idle.reduce((sum, e) =>
      sum + (e.dimensions ? e.dimensions.width * e.dimensions.height : 0), 0);
    let freedSlot = false;
    while (idle.length && (idle.length > this.settings.cacheEntries ||
        pixels() > this.settings.cacheMegapixels * 1000000)) {
      const entry = idle.shift();
      if (!entry.released) {
        freedSlot = true;
        this.refundTransfer(entry);
      }
      this.cancel(entry); this.entries.delete(entry.key);
    }
    if (freedSlot && this.queue.length) this.pump();
    // Retry history is bounded too, rather than growing throughout an infinite-scroll session.
    if (this.budget.items.size > 1000) {
      for (const [key, b] of this.budget.items) {
        if (this.env.now() - b.last > 60000) this.budget.items.delete(key);
        if (this.budget.items.size <= 750) break;
      }
    }
  }
  dispose() {
    this.disposed = true; this.env.clearTimeout(this.wakeTimer); this.env.clearTimeout(this.hostSaveTimer); this.flushHosts();
    for (const e of this.entries.values()) this.cancel(e);
    this.entries.clear();
    this.readyImages.clear();
    this.hosts.clear();
  }
}

// SPDX-License-Identifier: GPL-3.0-or-later

// No wildcard permission or cookie access. Other hosts retain native loading.
const IMAGE_CACHE_HOSTS = ['hamsterimg.net','hamster.is','empornium.sx','empornium.me','empornium.is','empornium.ph','emparadise.rs'];
const CACHE_ACTIVITY_KEYS=['hits','misses','downloads','savedBytes','sizedHits'];
const CACHE_ACTIVITY_BUCKET_MS=5000, CACHE_ACTIVITY_HOUR_MS=3600000;
function emptyCacheActivity(pending=false){return{hits:0,misses:0,downloads:0,savedBytes:0,sizedHits:0,recent:pending?new Map():[]};}
function cacheActivityRows(activity){return activity?.recent instanceof Map?[...activity.recent.values()]:activity?.recent||[];}
function mergeCacheActivityRecent(a,b,now){
  const buckets=new Map();
  for(const row of [...cacheActivityRows(a),...cacheActivityRows(b)]){
    if(row[0]+CACHE_ACTIVITY_BUCKET_MS<=now-CACHE_ACTIVITY_HOUR_MS)continue;
    const previous=buckets.get(row[0])||[row[0],0,0,0,0,0];
    for(let i=1;i<=CACHE_ACTIVITY_KEYS.length;i++)previous[i]+=row[i]||0;buckets.set(row[0],previous);
  }
  return [...buckets.values()].sort((a,b)=>a[0]-b[0]).slice(-721);
}
function restoreCacheActivity(target,source,now){
  for(const key of CACHE_ACTIVITY_KEYS)target[key]+=source[key]||0;
  target.recent=new Map(mergeCacheActivityRecent(target,source,now).map(row=>[row[0],row]));
}
function cacheActivityWindows(activity,now=Date.now()){
  const windows={};
  for(const [key,ms]of[['five',300000],['fifteen',900000],['hour',CACHE_ACTIVITY_HOUR_MS]]){
    const total=emptyCacheActivity();delete total.recent;
    for(const row of cacheActivityRows(activity))if(row[0]<=now&&row[0]+CACHE_ACTIVITY_BUCKET_MS>now-ms){
      CACHE_ACTIVITY_KEYS.forEach((name,i)=>{total[name]+=row[i+1]||0;});
    }
    windows[key]=total;
  }
  windows.all=Object.fromEntries(CACHE_ACTIVITY_KEYS.map(key=>[key,activity?.[key]||0]));return windows;
}
function cacheBytes(bytes){
  if(bytes>=1024**3)return (bytes/1024**3).toFixed(1)+' GB';
  if(bytes>=1024**2)return (bytes/1024**2).toFixed(1).replace(/\.0$/,'')+' MB';
  if(bytes>=1024)return (bytes/1024).toFixed(1)+' KB';
  return Math.max(0,Math.round(bytes||0))+' B';
}
class PersistentImageCache {
  constructor(env, settings) {
    this.env=env;this.settings=settings;this.dbPromise=null;this.storageFailure=null;this.writeBlocked=false;
    this.epoch=0;this.touches=new Map();this.writes=Promise.resolve();this.closed=false;this.nativeOnly=new Set();
    this.activity=emptyCacheActivity();this.listeners=new Set();
    this.pendingActivity=emptyCacheActivity(true);this.activitySequence=0;
    this.activityID=this.env.now()+'-'+Math.random().toString(36).slice(2);
    this.activityGeneration=null;
    try{this.activityChannel=this.env.activityChannel?.();if(this.activityChannel)this.activityChannel.onmessage=e=>this.acceptActivityReset(e.data);}catch{}
  }
  subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  notify(){if(!this.closed)for(const listener of this.listeners){try{listener();}catch{}}}
  recordActivity(type,bytes=0){
    const key=type==='hit'?'hits':type==='miss'?'misses':type==='download'?'downloads':null;if(!key||this.closed)return;
    const now=this.env.now(),at=Math.floor(now/CACHE_ACTIVITY_BUCKET_MS)*CACHE_ACTIVITY_BUCKET_MS;
    this.activity[key]++;this.pendingActivity[key]++;this.activitySince??=now;
    let bucket=this.pendingActivity.recent.get(at);
    if(!bucket){bucket=[at,0,0,0,0,0];this.pendingActivity.recent.set(at,bucket);}
    bucket[CACHE_ACTIVITY_KEYS.indexOf(key)+1]++;
    if(type==='hit'&&Number.isSafeInteger(bytes)&&bytes>0){
      this.activity.savedBytes+=bytes;this.pendingActivity.savedBytes+=bytes;bucket[4]+=bytes;
      this.activity.sizedHits++;this.pendingActivity.sizedHits++;bucket[5]++;
    }
    if(this.pendingActivity.recent.size>721)this.pendingActivity.recent=new Map(mergeCacheActivityRecent(this.pendingActivity,null,now).map(row=>[row[0],row]));
    if(!this.dbPromise)void this.open();
    if(!this.activityTimer)this.activityTimer=this.env.setTimeout(()=>{this.activityTimer=null;void this.flushActivity();},500);
    this.notify();
  }
  flushActivity(){
    this.env.clearTimeout(this.activityTimer);this.activityTimer=null;
    if(this.activityReset)return this.activityReset.then(()=>this.flushActivity(),()=>false);
    if(this.activityWrite)return this.activityWrite.then(()=>this.flushActivity());
    if(!CACHE_ACTIVITY_KEYS.some(key=>this.pendingActivity[key]))return Promise.resolve(true);
    if(!this.db)return this.open().then(db=>db?this.flushActivity():false);
    if(this.activityReady)return this.activityReady.then(()=>this.flushActivity());
    const delta=this.pendingActivity;this.pendingActivity=emptyCacheActivity(true);
    const batch={id:this.activityID+'-'+(++this.activitySequence),...delta,recent:cacheActivityRows(delta),since:this.activitySince,epoch:this.activityGeneration||0};
    this.activityWrite=new Promise(resolve=>{
      let settled=false;
      const failed=()=>{if(settled)return;settled=true;if(batch.epoch===this.activityGeneration)restoreCacheActivity(this.resetDiscard||this.pendingActivity,delta,this.env.now());resolve(false);};
      try{
        // Write-only journaling can commit on pagehide without another JS read
        // callback. The next page can replay it if compaction is interrupted.
        const tx=this.db.transaction('activity','readwrite');tx.objectStore('activity').put(batch);
        tx.oncomplete=()=>{if(!settled){settled=true;resolve(true);}};tx.onerror=tx.onabort=failed;
      }catch{failed();}
    });
    const pending=this.activityWrite;
    pending.then(saved=>{this.activityWrite=null;if(saved){this.activityUnavailable=false;void this.compactActivity();}else this.activityUnavailable=true;});
    return pending;
  }
  compactActivity(){
    if(this.activityCompaction)return this.activityCompaction;
    const pending=(async()=>{
      const db=await this.open();if(!db)return null;
      return new Promise(resolve=>{try{
        const tx=db.transaction(['activity','stats'],'readwrite'),journal=tx.objectStore('activity'),stats=tx.objectStore('stats');
        let total={...emptyCacheActivity(),since:null},epoch=0;
        stats.get('activityEpoch').onsuccess=g=>{epoch=g.target.result||0;stats.get('activityTotals').onsuccess=e=>{
          total=e.target.result||total;
          total.historyPartial ||= total.misses==null&&!!(total.hits||total.downloads);
          for(const key of CACHE_ACTIVITY_KEYS)total[key]??=0;
          total.recent=mergeCacheActivityRecent(total,null,this.env.now());
          const cursor=journal.openCursor();
          cursor.onsuccess=event=>{const c=event.target.result;if(c){
            if((c.value.epoch||0)===epoch){
              total.historyPartial ||= c.value.misses==null&&!!(c.value.hits||c.value.downloads);
              for(const key of CACHE_ACTIVITY_KEYS)total[key]+=(c.value[key]||0);
              total.recent=mergeCacheActivityRecent(total,c.value,this.env.now());
              total.since=total.since==null?c.value.since:Math.min(total.since,c.value.since);}
            c.delete();c.continue();
          }else stats.put(total,'activityTotals');};
        };};
        tx.oncomplete=()=>{this.acceptActivityReset({epoch,since:total.since});resolve({...total,epoch});};tx.onerror=tx.onabort=()=>resolve(null);
      }catch{resolve(null);}});
    })();
    this.activityCompaction=pending;pending.then(()=>{this.activityCompaction=null;});return pending;
  }
  acceptActivityReset(message){
    if(!message||!Number.isSafeInteger(message.epoch)||message.epoch<= (this.activityGeneration??-1))return;
    const previous=this.activityGeneration;this.activityGeneration=message.epoch;
    if(previous!=null){this.pendingActivity=emptyCacheActivity(true);this.activity=emptyCacheActivity();this.activitySince=message.since;
      this.env.clearTimeout(this.activityTimer);this.activityTimer=null;this.notify();}
  }
  resetActivity(){
    if(this.activityReset)return this.activityReset;
    const previous={pending:this.pendingActivity,activity:this.activity,since:this.activitySince,generation:this.activityGeneration};
    this.resetDiscard=previous.pending;this.pendingActivity=emptyCacheActivity(true);this.activity=emptyCacheActivity();this.activitySince=this.env.now();
    this.env.clearTimeout(this.activityTimer);this.activityTimer=null;
    const pending=(async()=>{
      const db=await this.open();if(!db)throw Error('Usage history storage is unavailable.');
      const epoch=await new Promise((resolve,reject)=>{const tx=db.transaction(['activity','stats'],'readwrite'),stats=tx.objectStore('stats');let next;
        stats.get('activityEpoch').onsuccess=e=>{next=(e.target.result||0)+1;tx.objectStore('activity').clear();stats.put(next,'activityEpoch');stats.put({...emptyCacheActivity(),since:this.activitySince},'activityTotals');};
        tx.oncomplete=()=>resolve(next);tx.onerror=tx.onabort=()=>reject(tx.error);
      });
      this.activityGeneration=epoch;this.activityUnavailable=false;
      try{this.activityChannel?.postMessage({epoch,since:this.activitySince});}catch{}
      this.notify();
    })();
    this.activityReset=pending;pending.then(()=>{this.resetDiscard=null;this.activityReset=null;},()=>{
      if(this.activityGeneration===(previous.generation??0)||this.activityGeneration==null&&previous.generation==null){
        restoreCacheActivity(this.pendingActivity,previous.pending,this.env.now());
        for(const key of CACHE_ACTIVITY_KEYS)this.activity[key]+=previous.activity[key];this.activitySince=previous.since;}
      this.resetDiscard=null;this.activityReset=null;
    });return pending;
  }
  isThumbnail(row){return row.kind==='thumbnail'||row.kind==='legacy'&&!!row.tier;}
  adjust(total,row,sign){
    total.bytes=(total.bytes||0)+sign*row.size;total.count=(total.count||0)+sign;
    total.thumbnailBytes=(total.thumbnailBytes||0)+(row.tier?sign*row.size:0);
    total.thumbnailCount=(total.thumbnailCount||0)+(this.isThumbnail(row)?sign:0);
    total.thumbnailFileBytes=(total.thumbnailFileBytes||0)+(this.isThumbnail(row)?sign*row.size:0);
  }
  tier(kind,size){return kind!=='preview'&&size>0&&size<=512*1024?1:0;}
  kind(previous,incoming){return previous==='thumbnail'||incoming==='thumbnail'?'thumbnail':incoming&&incoming!=='legacy'?incoming:previous||incoming||'legacy';}
  enabled(){return !this.unavailableReason();}
  unavailableReason(){
    if(this.closed)return 'storage-closed';
    if(this.displayBlocked)return 'data-url-blocked';
    if(this.storageFailure)return this.storageFailure;
    if(!this.env.indexedDB)return 'indexeddb-unavailable';
    return this.settings().persistentImages===false?'disabled':null;
  }
  key(url){return canonicalImageURL(url);}
  allowed(url){
    if(!safeImageURL(url,this.env.origin))return false;
    if(new URL(url).searchParams.getAll('action').some(action=>/^download$/i.test(action)))return false;
    const host=new URL(url).hostname.toLowerCase();
    return IMAGE_CACHE_HOSTS.some(h=>host===h||host.endsWith('.'+h))||this.env.local&&['127.0.0.1','localhost'].includes(host);
  }
  async open(){
    const db=await this.openImages();
    if(db&&this.activityReady)await this.activityReady;
    return db;
  }
  openImages(){
    if(this.storageFailure||this.closed||!this.env.indexedDB)return Promise.resolve(null);
    if(this.dbPromise)return this.dbPromise;
    this.dbPromise=new Promise(resolve=>{
      let settled=false,request;
      const finish=(db,reason=null)=>{if(settled){db?.close();return;}settled=true;this.env.clearTimeout(timer);this.storageFailure=reason;this.db=db;resolve(db);};
      const timer=this.env.setTimeout(()=>finish(null,'open-timeout'),1500);
      // Fence old writers that cannot preserve saved-byte accounting.
      try{request=this.env.indexedDB.open('empornium-companion-images',6);}catch{finish(null,'open-error');return;}
      request.onupgradeneeded=event=>{
        this.env.clearTimeout(timer);
        const db=request.result;
        if(!db.objectStoreNames.contains('images'))db.createObjectStore('images');
        const meta=db.objectStoreNames.contains('meta')?request.transaction.objectStore('meta'):db.createObjectStore('meta',{keyPath:'url'});
        if(!meta.indexNames.contains('used'))meta.createIndex('used','used');
        if(!meta.indexNames.contains('evict'))meta.createIndex('evict',['tier','used']);
        if(!db.objectStoreNames.contains('stats'))db.createObjectStore('stats');
        if(!db.objectStoreNames.contains('activity'))db.createObjectStore('activity',{keyPath:'id'});
        if(event.oldVersion>=3)return;
        // Upgrade metadata only. Existing image Blobs are never read or cleared.
        const total={bytes:0,count:0,thumbnailBytes:0,thumbnailCount:0,thumbnailFileBytes:0},cursor=meta.openCursor();
        cursor.onsuccess=e=>{const c=e.target.result;if(c){const row=c.value,kind=row.kind||'legacy',tier=this.tier(kind,row.size);
          c.update({...row,kind,tier});this.adjust(total,{...row,kind,tier},1);c.continue();
        }else request.transaction.objectStore('stats').put(total,'total');};
      };
      request.onsuccess=()=>{const db=request.result;if(settled){db.close();return;}if(!['images','meta','stats','activity'].every(s=>db.objectStoreNames.contains(s))){db.close();finish(null,'schema-unavailable');return;}db.onversionchange=()=>{void this.flushActivity();db.close();this.db=null;this.storageFailure='version-changed';};
        // Image reads can proceed while another tab holds the statistics store.
        this.activityReady=new Promise(resolve=>{try{
          const tx=db.transaction('stats','readonly');
          tx.objectStore('stats').get('activityEpoch').onsuccess=e=>{this.activityGeneration=Math.max(this.activityGeneration||0,e.target.result||0);};
          tx.oncomplete=tx.onerror=tx.onabort=resolve;
        }catch{resolve();}});
        this.activityReady.then(()=>{this.activityReady=null;});
        finish(db);
      };
      request.onerror=()=>finish(null,'open-error');
      request.onblocked=()=>finish(null,'open-blocked');
    });return this.dbPromise;
  }
  async get(url,kind=null,onReadError){
    const db=await this.openImages();if(!db){onReadError?.();return null;}const key=this.key(url);
    return new Promise(resolve=>{let value=null;const fail=()=>{onReadError?.();resolve(null);};try{
      const tx=db.transaction('images','readonly');tx.objectStore('images').get(key).onsuccess=e=>{value=e.target.result;};
      tx.oncomplete=()=>{if(value&&value.size>0&&typeof value.slice==='function'){this.touch(key,kind);resolve(value);}else resolve(null);};
      tx.onerror=tx.onabort=fail;
    }catch{fail();}});
  }
  touch(key,kind=null){
    const previous=this.touches.get(key);this.touches.delete(key);this.touches.set(key,{used:this.env.now(),kind:kind?this.kind(previous?.kind,kind):previous?.kind||null});
    if(!this.touchTimer)this.touchTimer=this.env.setTimeout(()=>{this.touchTimer=null;void this.flushTouches();},500);
  }
  async flushTouches(){
    this.env.clearTimeout(this.touchTimer);this.touchTimer=null;
    if(!this.touches.size)return;const touches=this.touches;this.touches=new Map();const db=await this.open();if(!db)return;
    let changed=false;
    await new Promise(resolve=>{try{const tx=db.transaction(['meta','stats'],'readwrite'),store=tx.objectStore('meta'),stats=tx.objectStore('stats');
      stats.get('total').onsuccess=e=>{const total=e.target.result||{bytes:0,count:0,thumbnailBytes:0};let pending=touches.size;
        for(const[key,touch]of touches)store.get(key).onsuccess=event=>{const row=event.target.result;if(row){const kind=this.kind(row.kind,touch.kind),tier=this.tier(kind,row.size);
          const next={...row,used:touch.used,kind,tier};this.adjust(total,row,-1);this.adjust(total,next,1);store.put(next);
          changed ||= kind!==row.kind||tier!==row.tier;
        }if(!--pending)stats.put(total,'total');};
      };
      tx.oncomplete=tx.onerror=tx.onabort=resolve;
    }catch{resolve();}});
    if(changed)this.notify();
  }
  limit(){return (this.settings().persistentCacheMB||512)*1024*1024;}
  async stats(){
    const db=await this.open();if(!db)return{bytes:0,count:0,available:false};
    return new Promise(resolve=>{try{const tx=db.transaction('stats','readonly');let s={bytes:0,count:0};
      tx.objectStore('stats').get('total').onsuccess=e=>{s=e.target.result||s;};tx.oncomplete=()=>resolve({...s,available:true});tx.onerror=tx.onabort=()=>resolve({...s,available:false});
    }catch{resolve({bytes:0,count:0,available:false});}});
  }
  async summary(){
    await this.writes;await this.flushTouches();const flushed=await this.flushActivity(),activity=await this.compactActivity(),stats=await this.stats();
    return {...stats,thumbnailCount:stats.thumbnailCount||0,thumbnailFileBytes:stats.thumbnailFileBytes||0,
      previewCount:Math.max(0,stats.count-(stats.thumbnailCount||0)),previewBytes:Math.max(0,stats.bytes-(stats.thumbnailFileBytes||0)),
      ...Object.fromEntries(CACHE_ACTIVITY_KEYS.map(key=>[key,(activity?.[key]||0)+this.pendingActivity[key]])),
      recent:mergeCacheActivityRecent(activity,this.pendingActivity,this.env.now()),historyPartial:!!activity?.historyPartial,
      activitySince:activity?.since,activityAvailable:!!activity&&flushed,
      limitBytes:this.limit(),saving:this.settings().persistentImages!==false};
  }
  enqueue(work){const pending=this.writes.then(work,work);this.writes=pending.catch(()=>false);return pending;}
  commit(url,blob,epoch=this.epoch,kind='legacy'){
    const thumbnail=this.tier(kind,blob?.size);
    if(!this.enabled()||this.writeBlocked||!thumbnail&&this.previewWriteBlocked||epoch!==this.epoch||!blob?.size||blob.size>this.limit())return Promise.resolve(false);
    return this.enqueue(async()=>{
      if(epoch!==this.epoch||!this.enabled())return false;
      try{const saved=await this.write(url,blob,epoch,kind);this.notify();return saved;}catch(error){
        if(error?.name!=='QuotaExceededError'){this.writeBlocked=true;return false;}
        const s=await this.stats();await this.prune(Math.max(0,s.bytes- Math.max(blob.size*2,s.bytes/4)),{preserveThumbnails:!thumbnail});
        try{const saved=await this.write(url,blob,epoch,kind);this.notify();return saved;}catch{if(thumbnail)this.writeBlocked=true;else this.previewWriteBlocked=true;return false;}
      }
    });
  }
  async write(url,blob,epoch,requestedKind='legacy'){
    const db=await this.open();if(!db||epoch!==this.epoch)return false;const key=this.key(url);
    return new Promise((resolve,reject)=>{try{
      const tx=db.transaction(['images','meta','stats'],'readwrite'),images=tx.objectStore('images'),meta=tx.objectStore('meta'),stats=tx.objectStore('stats');
      let retained=true,total={bytes:0,count:0,thumbnailBytes:0};stats.get('total').onsuccess=e=>{
        total=e.target.result||total;meta.get(key).onsuccess=old=>{
          const previous=old.target.result,kind=this.kind(previous?.kind,requestedKind),tier=this.tier(kind,blob.size);
          const protectedAfter=(total.thumbnailBytes||0)-(previous?.tier?previous.size:0)+(tier?blob.size:0);
          // Reject a large newcomer before evicting anything if it could not
          // fit even after every unprotected file was removed.
          if(!tier&&blob.size>this.limit()-protectedAfter){
            retained=false;
            if(previous){images.delete(key);meta.delete(key);this.adjust(total,previous,-1);stats.put(total,'total');}
            return;
          }
          if(previous)this.adjust(total,previous,-1);
          const next={url:key,size:blob.size,used:this.env.now(),kind,tier};this.adjust(total,next,1);
          images.put(blob,key);meta.put(next);
          const cursor=meta.index('evict').openCursor();cursor.onsuccess=event=>{
            const c=event.target.result;if(c&&(total.bytes>this.limit()||total.count>50000)){
              if(c.value.url===key)retained=false;
              this.adjust(total,c.value,-1);images.delete(c.value.url);c.delete();c.continue();
            }else stats.put(total,'total');
          };
        };
      };
      tx.oncomplete=()=>resolve(retained);tx.onerror=tx.onabort=()=>reject(tx.error||Error('Image cache transaction failed.'));
    }catch(e){reject(e);}});
  }
  async prune(bytes,{preserveThumbnails=false}={}){
    const db=await this.open();if(!db)return;
    await new Promise(resolve=>{try{const tx=db.transaction(['images','meta','stats'],'readwrite'),meta=tx.objectStore('meta'),images=tx.objectStore('images'),stats=tx.objectStore('stats');
      stats.get('total').onsuccess=e=>{const total=e.target.result||{bytes:0,count:0,thumbnailBytes:0};const r=meta.index('evict').openCursor();r.onsuccess=event=>{
        const c=event.target.result;if(c&&total.bytes>bytes&&!(preserveThumbnails&&c.value.tier)){this.adjust(total,c.value,-1);images.delete(c.value.url);c.delete();c.continue();}else stats.put(total,'total');
      };};tx.oncomplete=tx.onerror=tx.onabort=resolve;
    }catch{resolve();}});
    this.notify();
  }
  remove(url){return this.enqueue(async()=>{
    const db=await this.open();if(!db)return;
    await new Promise(resolve=>{try{const tx=db.transaction(['images','meta','stats'],'readwrite'),meta=tx.objectStore('meta'),stats=tx.objectStore('stats'),key=this.key(url);
      meta.get(key).onsuccess=e=>{if(!e.target.result)return;const row=e.target.result;meta.delete(key);tx.objectStore('images').delete(key);stats.get('total').onsuccess=s=>{const t=s.target.result||{bytes:row.size,count:1};this.adjust(t,row,-1);stats.put(t,'total');};};tx.oncomplete=tx.onerror=tx.onabort=resolve;
    }catch{resolve();}});
    this.notify();
  });}
  async clear(){
    this.epoch++;this.touches.clear();this.env.clearTimeout(this.touchTimer);this.touchTimer=null;
    return this.enqueue(async()=>{const db=await this.open();if(!db)throw Error('Browser image storage is unavailable.');
      await new Promise((resolve,reject)=>{const tx=db.transaction(['images','meta','stats'],'readwrite');for(const s of['images','meta'])tx.objectStore(s).clear();tx.objectStore('stats').delete('total');tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);});this.writeBlocked=this.previewWriteBlocked=false;this.notify();
    });
  }
  load(url,{network=false,fresh=false,kind='legacy',candidates=[],diagnostic}={},done){
    let cancelled=false,delivered=false,finishing=false,handle=null;const epoch=this.epoch;const valid=()=>!cancelled&&!this.closed;
    const deliver=result=>{if(valid()&&!delivered){delivered=true;done(result);}};
    const noteCache=(cacheOutcome,cacheReason)=>{if(valid()&&!delivered)diagnostic?.('cache',{cacheOutcome,cacheReason});};
    const noteHTTP=(response,reason)=>{
      if(!diagnostic)return;
      const status=response?.status;
      diagnostic('http',{transport:'manager',httpStatus:Number.isInteger(status)&&status>=100&&status<=599?status:null,transportReason:reason});
    };
    const finish=async(blob,hit,source=url)=>{
      if(!valid()||delivered||finishing)return;finishing=true;
      const unusable=reason=>{if(valid()){if(hit){noteCache('unusable',reason);this.recordActivity('miss');}deliver(null);}};
      if(!blob?.size||blob.size>64*1024*1024){unusable('invalid-size');return;}
      try{const dataURL=await this.env.encode(blob);if(valid())deliver({dataURL,blob,hit,epoch,key:this.key(source),kind});}catch{unusable('encode-error');}
    };
    void(async()=>{
      const unavailable=this.unavailableReason();
      if(unavailable||!this.allowed(url)){noteCache('skipped',unavailable||'ineligible-url');deliver(null);return;}
      if(!await this.openImages()){noteCache('unavailable',this.unavailableReason()||'storage-unavailable');deliver(null);return;}
      if(!fresh){
        // A cover's supplied resize URL can be gone while another successful
        // variant is still saved. Check this request's alternatives before
        // recording a miss or attempting the preferred URL on the network.
        const sources=[...new Set([url,...candidates].filter(source=>this.allowed(source)).map(source=>this.key(source)))];
        let readFailed=false;
        const onReadError=diagnostic?()=>{readFailed=true;}:undefined;
        for(const source of sources){const cached=await this.get(source,kind,onReadError);if(!valid())return;
          if(cached){await finish(cached,true,source);return;}}
        if(readFailed)noteCache('unavailable','read-error');else noteCache('miss','no-saved-candidate');
        this.recordActivity('miss');
      }
      if(!valid())return;
      const host=new URL(url).host;
      if(!network||!this.env.request||this.writeBlocked||kind==='preview'&&this.previewWriteBlocked||this.nativeOnly.has(host)){deliver(null);return;}
      const fallback=(reason,response)=>{if(valid()&&!delivered&&!finishing){noteHTTP(response,reason);this.nativeOnly.add(host);deliver(null);}};
      const transportURL=new URL(url);if(transportURL.protocol==='http:'&&!this.env.local)transportURL.protocol='https:';
      try{handle=this.env.request({method:'GET',url:transportURL.href,anonymous:true,redirect:'error',responseType:'blob',headers:{Referer:this.env.origin+'/'},
        onload:response=>{if(!valid()||delivered||finishing)return;const final=response.finalUrl||transportURL.href;
          if(!this.allowed(final)||!this.env.local&&new URL(final).protocol!=='https:'){fallback('redirect',response);return;}
          if([401,403].includes(response.status)){fallback('access-denied',response);return;}
          if(response.status<200||response.status>=300){noteHTTP(response);deliver({failure:true,status:response.status});return;}
          if(/^(?:text\/html|application\/json)/i.test(response.response?.type||'')){fallback('non-image-response',response);return;}
          noteHTTP(response);
          void finish(response.response,false);
        },onerror:response=>fallback('transport-error',response),ontimeout:response=>fallback('transport-timeout',response),
        onabort:response=>fallback('transport-aborted',response)});
      }catch{if(valid()&&!delivered&&!finishing){noteHTTP(null,'transport-error');deliver(null);}}
    })();
    return()=>{cancelled=true;try{handle?.abort?.();}catch{};};
  }
  close(){void this.flushActivity();this.closed=true;this.listeners.clear();this.activityChannel?.close();this.env.clearTimeout(this.touchTimer);this.env.clearTimeout(this.activityTimer);this.dbPromise?.then(db=>db?.close());}
}

// SPDX-License-Identifier: GPL-3.0-or-later

class PreferencesController {
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
  flush(conditionalRules = this.app.settings.conditionalRules) {
    const app = this.app;
    app.win.clearTimeout(this.timer); this.timer = null;
    const wasDirty = app.dirty;
    const updatingRules = conditionalRules !== app.settings.conditionalRules;
    if (app.composing || app.disposed) return !updatingRules;
    if (!wasDirty && !updatingRules) return true;
    const focused = app.doc.activeElement;
    const restore = focused?.matches?.('textarea[data-ep-filter-control],input[type=text][data-ep-filter-control]') ?
      { node: focused, value: focused.value, start: focused.selectionStart, end: focused.selectionEnd, scroll: focused.scrollTop } : null;
    let snapshot, checkpointBefore = this.checkpoint, filterChanged, conditionalChanged;
    const previousSettings = app.settings;
    try {
      const next = { ...app.settings, conditionalRules };
      for (const [key, control] of app.controls) {
        const numeric = control.type === 'number' || control.hasAttribute('data-numeric');
        if (numeric && !control.checkValidity()) {
          control.setAttribute('aria-invalid', 'true'); this.status('Check the highlighted value.'); return false;
        }
        if (numeric) control.removeAttribute('aria-invalid');
        next[key] = control.type === 'checkbox' ? control.checked : numeric ? Number(control.value) : control.value;
      }
      filterChanged = app.filterDirty;
      next.globalArrowNavigation = next.navigationScope === 'site';
      const checked = validateSettings(next);
      conditionalChanged = checked.conditionalRules !== previousSettings.conditionalRules;
      if (conditionalChanged) compileConditionalRules(checked.conditionalRules);
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
      if (filterChanged || conditionalChanged) app.refreshFilters();
      if (conditionalChanged) app.resultFilters.refreshRulesEditor();
      app.updateMediaPreferences(previous);
      app.applyAppearance();
      this.status(conditionalChanged ? 'Rules saved' : 'Saved automatically');
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
        if ((filterChanged || conditionalChanged) && restored) app.refreshFilters();
      }
      app.dirty = wasDirty;
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

function captureFilterBaseline(app, rows) {
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

function restoreFilterBaseline(app) {
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

// SPDX-License-Identifier: GPL-3.0-or-later
// Backfill behavior contributed by mc-hamster; integrated with Companion's
// existing filtering/media controllers. See THIRD_PARTY.md for pinned sources.

const TABLE = '#torrent_table, #content table.torrent_table';
const PAGE_LINKS = 'a.pager_page,a.pager_last';
const NEXT_LINKS = 'a.pager_next,a[rel="next"]';
const COLLAGE_PATH = /^\/collage\/[1-9]\d*\/?$/;
const COLLAGE_BURST_PAGES = 5;
const searchIdentity = url => JSON.stringify([...url.searchParams].filter(([key]) => key !== 'page')
  .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])));
const pageNumber = url => Number(new URL(url).searchParams.get('page') || 1);
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const pageError = (message, retryable = false, retryAfter = 0, status = 0) =>
  Object.assign(new Error(message), { retryable, retryAfter, status });

function backfillRetryAfter(value, now = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return 0;
  const raw = value.trim();
  const ms = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now;
  return Number.isFinite(ms) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER - now, ms)) : 0;
}

function backfillURL(value, base, search = base) {
  try {
    const url = new URL(value, base), original = new URL(search);
    const collage=COLLAGE_PATH.test(original.pathname);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== original.origin || (!collage&&url.pathname !== '/torrents.php') || original.pathname !== url.pathname ||
        url.username || url.password || url.searchParams.has('id') || original.searchParams.has('id') ||
        url.searchParams.getAll('action').some(action => !(collage?['','view']:['', 'advanced', 'basic', 'search']).includes(action)) ||
        !/^\d{1,7}$/.test(url.searchParams.get('page') || '1') || pageNumber(url.href)<1 ||
        searchIdentity(url) !== searchIdentity(original)) return null;
    url.hash = ''; url.searchParams.set('page', String(pageNumber(url.href))); url.searchParams.sort();
    return url.href;
  } catch { return null; }
}

function nextBackfillURL(source, current, search, loaded = new Set()) {
  const eligible = value => {
    const url = value && backfillURL(value, current, search);
    return url && pageNumber(url) > pageNumber(current) && !loaded.has(url) ? url : null;
  };
  for (const link of source.querySelectorAll(NEXT_LINKS)) {
    const url = eligible(link.getAttribute('href')); if (url) return url;
  }
  // Some responses omit Next. Use the next numbered link, never a guessed URL
  // or a jump to Last that would skip intermediate result pages.
  return [...source.querySelectorAll('a.pager_page')].map(link => eligible(link.getAttribute('href')))
    .filter(Boolean).sort((a, b) => pageNumber(a) - pageNumber(b))[0] || null;
}

function torrentID(row, base) {
  for (const link of row.querySelectorAll('a[href]')) {
    try {
      const url = new URL(link.getAttribute('href'), base), id = url.searchParams.get('id');
      if (url.origin === new URL(base).origin && url.pathname === '/torrents.php' &&
          !url.searchParams.has('action') && /^\d{1,15}$/.test(id || '')) return id;
    } catch {}
  }
  return null;
}

class BackfillController {
  constructor(app) {
    this.app = app; this.win = app.win; this.doc = app.doc; this.now = Date.now;
    this.search = this.win.location.href; this.loaded = new Set(); this.seenIDs = new Set();
    this.generation = 0; this.overlaySequence = 1000000000; this.pages = 0; this.added = 0;
    this.busy = false; this.initialized = false; this.disposed = false; this.message = '';
    this.lastRequestStartedAt = null; this.burstRequestAt = 0;
  }
  table() { return this.doc.querySelector(TABLE); }
  supported() { return !!backfillURL(this.search, this.search) && !!this.table(); }
  mount() {
    this.button = this.app.button('', () => {
      if (this.busy) this.stop(); else this.run();
    });
    this.button.dataset.epBackfill = '';
    this.button.className = 'epc-primary epc-load-more';
    this.buttonLabel = this.app.node('span', 'Load more');
    const add = companionIcon(this.app, 'add'), stop = companionIcon(this.app, 'stop');
    add.classList.add('epc-load-icon'); stop.classList.add('epc-stop-icon');
    this.button.append(add, stop, this.buttonLabel);
    this.status = this.app.node('span', '', 'epc-backfill-status');
    this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
    this.footer = this.app.node('div', null, 'epc-root epc-results-end');
    this.endLabel = this.app.node('span', 'End of loaded results');
    this.footer.append(this.endLabel, this.status, this.button);
    this.sync();
  }
  sync() {
    if (!this.button || this.disposed) return;
    const table = this.table(), available = !!table && !!backfillURL(this.search, this.search);
    if (available && table.nextElementSibling !== this.footer) table.after(this.footer);
    if (!this.app.settings.backfillEnabled && this.busy) this.stop();
    if (available && this.app.filtersReady && !this.initialized) {
      this.initialized = true;
      this.loaded.add(backfillURL(this.search, this.search));
      this.nextURL = nextBackfillURL(this.doc, this.search, this.search, this.loaded);
    }
    this.button.hidden = !available || !this.app.settings.backfillEnabled || this.initialized && !this.nextURL && !this.busy;
    this.status.hidden = !available || !this.app.settings.backfillEnabled;
    this.buttonLabel.textContent = this.busy ? 'Stop loading' : 'Load more';
    this.button.disabled = !this.app.filtersReady || this.app.options.waitForFilters && !this.app.engineReady || !this.nextURL && !this.busy;
    this.button.disabled ||= !this.busy && this.now() < (this.notBefore || 0);
    this.win.clearTimeout(this.cooldownTimer); this.cooldownTimer = null;
    if (!this.busy && this.now() < (this.notBefore || 0)) this.cooldownTimer = this.win.setTimeout(() => this.sync(),
      Math.min(2147483647, this.notBefore - this.now()));
    this.button.setAttribute('aria-busy', String(this.busy));
    this.button.title = this.initialized && !this.nextURL && !this.busy ? 'No more result pages' :
      this.app.settings.backfillMode === 'all' ? 'Add all remaining result pages using your current filters' :
        'Add up to ' + this.app.settings.backfillPages + ' following result pages using your current filters';
    this.status.textContent = this.message;
    if (this.failedURL && !this.busy) {
      const link = this.app.node('a', 'Open page ' + pageNumber(this.failedURL));
      link.href = this.failedURL; link.target = '_blank'; link.rel = 'noopener noreferrer';
      this.status.append(this.doc.createTextNode(' '), link);
    }
    this.status.hidden ||= !this.message;
    this.endLabel.hidden = !this.status.hidden;
    this.footer.hidden = this.button.hidden && this.status.hidden;
  }
  maybeAutomatic() {
    if (this.autoStarted || this.busy || this.disposed || !this.app.onboardingComplete || this.app.onboarding?.open ||
        this.doc.hidden || this.app.root?.dataset.epReady !== 'true' || !this.app.filtersReady ||
        this.app.options.waitForFilters && !this.app.engineReady || !this.app.settings.backfillEnabled ||
        this.app.settings.backfillMode === 'off' || !this.initialized || !this.nextURL) return;
    this.autoStarted = true;
    void this.run();
  }
  async foreground(generation) {
    if (!this.doc.hidden) return true;
    this.message = 'Backfill paused while this tab is in the background.'; this.sync();
    return new Promise(resolve => {
      const finish = proceed => {
        this.doc.removeEventListener('visibilitychange', changed); this.cancelForeground = null;
        resolve(proceed && !this.disposed && generation === this.generation);
      };
      const changed = () => { if (!this.doc.hidden) finish(true); };
      this.cancelForeground = () => finish(false);
      this.doc.addEventListener('visibilitychange', changed);
    });
  }
  active(generation) { return !this.disposed && generation === this.generation && this.app.settings.backfillEnabled; }
  wait(ms, generation) {
    const deadline = this.now() + ms;
    return new Promise(resolve => {
      let timer;
      const finish = proceed => { this.win.clearTimeout(timer); this.cancelDelay = null; resolve(proceed && this.active(generation)); };
      const wake = () => {
        const remaining = deadline - this.now();
        if (remaining <= 0) finish(true);
        else timer = this.win.setTimeout(wake, Math.min(2147483647, remaining));
      };
      this.cancelDelay = () => finish(false);
      // Even a zero delay yields to rendering and input between requests.
      timer = this.win.setTimeout(wake, Math.min(2147483647, Math.max(0, ms)));
    });
  }
  async readWithRetry(url, generation, burst) {
    const interval = this.app.options.backfillIntervalMs ?? 1000;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!await this.foreground(generation) || !this.active(generation)) return null;
      if (!attempt && this.lastRequestStartedAt !== null) {
        // A short collage batch can use up to five starts up front. The
        // allowance refills one request per interval across successive runs.
        const earliest = burst ? this.burstRequestAt - (COLLAGE_BURST_PAGES - 1) * interval : this.lastRequestStartedAt + interval;
        // Fetch and append time count toward spacing. A zero wait still yields to input and rendering.
        if (!await this.wait(Math.max(0, earliest - this.now()), generation)) return null;
      }
      if (this.now() < (this.notBefore || 0) && !await this.wait(this.notBefore - this.now(), generation)) return null;
      if (!await this.foreground(generation) || !this.active(generation)) return null;
      const controller = new this.win.AbortController(); this.controller = controller;
      let timedOut = false, failure, result;
      const timeout = this.win.setTimeout(() => { timedOut = true; controller.abort(); }, this.app.options.backfillTimeoutMs || 20000);
      this.message = 'Loading page ' + pageNumber(url) + (attempt ? ' · attempt ' + (attempt + 1) + '/3' : ''); this.sync();
      this.lastRequestStartedAt = this.now();
      this.burstRequestAt = Math.max(this.burstRequestAt, this.lastRequestStartedAt) + interval;
      try { result = await this.readPage(url, controller.signal); }
      catch (error) { failure = timedOut ? pageError('The page request timed out.', true) : error; }
      finally { this.win.clearTimeout(timeout); if (this.controller === controller) this.controller = null; }
      if (!this.active(generation)) return null;
      if (!failure) { this.notBefore = 0; return result; }
      if (!failure.retryable) throw failure;
      const base = failure.status === 429 ? (this.app.options.backfillRateLimitMs ?? 10000) : (this.app.options.backfillRetryMs ?? 2000);
      const random = this.app.options.backfillRandom || Math.random;
      const delay = Math.max(failure.retryAfter || 0, base * 2 ** attempt * (1 + random() * .25));
      // Retain server cooldowns across Stop/resume within this page session.
      if (attempt < 2 || failure.retryAfter || failure.status === 429) this.notBefore = Math.max(this.notBefore || 0, this.now() + delay);
      if (attempt === 2) throw pageError(failure.message + ' Automatic retry limit reached.');
      this.message = 'Page ' + pageNumber(url) + ': ' + failure.message + ' Retrying in ' + Math.ceil(delay / 1000) +
        's (attempt ' + (attempt + 2) + '/3).'; this.sync();
      if (!await this.wait(delay, generation)) return null;
    }
  }
  activateImages(rows, cards) {
    for (const row of rows) for (const image of row.querySelectorAll('img[data-ep-backfill-src],img[data-ep-backfill-srcset]')) {
      if (image.closest('.hidden:not(.epc-revealed),[hidden],.epc-filter-hidden')) continue;
      for (const name of ['src', 'srcset']) {
        const value = image.getAttribute('data-ep-backfill-' + name);
        if (value) { image.setAttribute(name, value); image.removeAttribute('data-ep-backfill-' + name); }
      }
    }
    for(const card of cards) for(const cover of card.querySelectorAll('.torrent__cover[data-ep-backfill-background]')){
      if(cover.closest('.hidden:not(.epc-revealed),[hidden],.epc-filter-hidden'))continue;
      const source=safeImageURL(cover.dataset.epBackfillBackground,this.search);
      cover.removeAttribute('data-ep-backfill-background');if(source){
        if(this.app.settings.enabled&&this.app.settings.recoverBackgrounds)cover.classList.remove('epc-native-cover');
        cover.style.backgroundImage='url('+JSON.stringify(source)+')';
      }
    }
  }
  collectIDs() {
    for (const row of [...this.doc.querySelectorAll('tr.torrent'), ...this.app.detachedFilterRows.keys()]) {
      const id = torrentID(row, this.search); if (id) this.seenIDs.add(id);
    }
    for (const id of this.app.removedFilterIDs) this.seenIDs.add(id);
  }
  prepareRow(source, definitions, pageURL) {
    const row = source.cloneNode(true);
    for (const link of row.querySelectorAll('a[onmouseover]')) {
      const name = link.getAttribute('onmouseover').match(/\boverlay\d+/)?.[0], def = definitions.get(name);
      if (!def) continue;
      let unique;
      do { unique = 'overlay' + (++this.overlaySequence); } while (this.app.media.definitions.has(unique));
      link.dataset.epOverlay = unique;
      // Keep parsed data on the row so disabling/re-enabling media can rebuild
      // previews without re-fetching a result page or running its scripts.
      link.dataset.epBackfillPreview = JSON.stringify({ ...def, name: unique });
    }
    for (const node of row.querySelectorAll('script,style,link,base,meta,iframe,object,embed,form,svg,math')) node.remove();
    for (const node of [row, ...row.querySelectorAll('*')]) {
      for (const attr of [...node.attributes]) {
        if (/^on/i.test(attr.name) || ['srcdoc', 'autofocus', 'formaction'].includes(attr.name)) node.removeAttribute(attr.name);
      }
      for (const name of ['href', 'src', 'data-src']) {
        if (!node.hasAttribute(name)) continue;
        try {
          const value = new URL(node.getAttribute(name), pageURL);
          const ordinaryLink = node.tagName === 'A' && name === 'href' && value.protocol === 'magnet:';
          if (!ordinaryLink && (!['http:', 'https:'].includes(value.protocol) || value.username || value.password)) node.removeAttribute(name);
          else node.setAttribute(name, value.href);
        } catch { node.removeAttribute(name); }
      }
      // Native row images wait until filtering has run. The browser can still
      // lazily load these icons; Companion thumbnails use the shared scheduler.
      if (node.tagName === 'IMG') {
        node.loading = 'lazy';
        for (const name of ['src', 'srcset']) if (node.hasAttribute(name)) {
          if (name === 'src' && !safeImageURL(node.getAttribute(name), pageURL)) { node.removeAttribute(name); continue; }
          node.setAttribute('data-ep-backfill-' + name, node.getAttribute(name)); node.removeAttribute(name);
        }
      }
    }
    row.dataset.epBackfillPage = String(pageNumber(pageURL));
    return this.doc.importNode(row, true);
  }
  prepareCover(source,pageURL){
    const spacer=!!source.querySelector(':scope > svg'),coverSource=source.querySelector('.torrent__cover');
    const background=coverSource?.style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
    const card=this.prepareRow(source,new Map(),pageURL);
    for(const node of[card,...card.querySelectorAll('[style]')])node.removeAttribute('style');
    const cover=card.querySelector('.torrent__cover'),safe=safeImageURL(background,pageURL);
    if(cover){if(safe)cover.dataset.epBackfillBackground=safe;
      const thumb=safeImageURL(cover.getAttribute('data-thumbnail'),pageURL);if(thumb)cover.setAttribute('data-thumbnail',thumb);else cover.removeAttribute('data-thumbnail');}
    if(spacer){const svg=this.doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 1 1');card.prepend(svg);}
    return card;
  }
  async readPage(url, signal) {
    const fetchPage = this.app.options.fetch || this.win.fetch?.bind(this.win);
    if (!fetchPage) throw new Error('Page loading is unavailable in this browser.');
    let response;
    try { response = await fetchPage(url, { credentials: 'same-origin', redirect: 'error', signal }); }
    catch { throw pageError('The page request failed (network or browser blocking).', true); }
    if (signal.aborted) throw new Error('Stopped');
    if (!response.ok) throw pageError('The server returned HTTP ' + (response.status || 'error') + '.',
      TRANSIENT_STATUS.has(response.status), backfillRetryAfter(response.headers?.get('retry-after'), this.now()), response.status);
    if (response.url && backfillURL(response.url, url, this.search) !== url) throw new Error('The site returned a different page.');
    const type = response.headers?.get('content-type');
    if (type && !/\btext\/html\b/i.test(type)) throw new Error('The site did not return a results page.');
    let html;
    try { html = await response.text(); }
    catch { throw pageError('The page response was interrupted.', true); }
    if (signal.aborted) throw new Error('Stopped');
    if (html.length > 8 * 1024 * 1024) throw new Error('The results page is too large.');
    // Template content stays inert, including image URLs and inline handlers.
    const template = this.doc.createElement('template'); template.innerHTML = html;
    const page = template.content, table = page.querySelector(TABLE);
    if (!table || page.querySelector('input[type="password"]')) throw new Error('No results table was returned. Check your login.');
    const rows = [...table.querySelectorAll('tr.torrent')];
    if (rows.length > 500) throw new Error('The results page contains too many rows.');
    const definitions = new Map();
    for (const script of page.querySelectorAll('script:not([src])')) {
      for (const def of parseOverlayDefinitions(script.textContent, url)) definitions.set(def.name, def);
    }
    const cards=[...page.querySelectorAll('.torrent_grid > .torrent_grid__torrent')];
    if(cards.length>500)throw new Error('The results page contains too many covers.');
    return { page, rows, definitions, cards };
  }
  updatePager() {
    for (const link of this.doc.querySelectorAll(PAGE_LINKS)) {
      const url = backfillURL(link.getAttribute('href'), this.search, this.search);
      if (url && this.loaded.has(url) && url !== backfillURL(this.search, this.search)) {
        link.classList.add('epc-backfilled-page'); link.title = 'Already included in this list';
      }
    }
    for (const link of this.doc.querySelectorAll(NEXT_LINKS)) {
      if(link.hasAttribute('href')&&!backfillURL(link.getAttribute('href'),this.search,this.search))continue;
      if (this.nextURL) { const hash=new URL(link.getAttribute('href')||this.search,this.search).hash;link.href = this.nextURL+hash; link.removeAttribute('aria-disabled'); link.removeAttribute('tabindex'); }
      else { link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); link.tabIndex = -1; }
    }
  }
  async run() {
    if (this.busy || this.disposed || !this.app.preferences.flush()) return;
    this.sync();
    if (this.button.disabled || !this.app.settings.backfillEnabled || !this.supported() || !this.nextURL) return;
    this.collectIDs();
    this.autoStarted = true; // Stop/manual retries must never restart automatic loading on this page.
    this.failedURL = null;
    const generation = ++this.generation, limit = this.app.settings.backfillMode === 'all' ? Infinity : this.app.settings.backfillPages;
    const burst = limit <= COLLAGE_BURST_PAGES && COLLAGE_PATH.test(this.win.location.pathname);
    let pages = 0, added = 0;
    this.busy = true;
    this.loadProgress = { loaded: 0, limit: Number.isFinite(limit) ? limit : null, status: 'loading' };
    this.app.scheduleHealth();
    this.app.versions?.releaseLayout(this.table());
    try {
      for (; pages < limit && this.nextURL; ) {
        if (!this.active(generation)) return;
        const url = this.nextURL;
        const result = await this.readWithRetry(url, generation, burst);
        if (!result || !this.active(generation)) return;
        const prepared = [], acceptedIDs = new Set();
        for (const source of result.rows) {
          const id = torrentID(source, url);
          if (!id || this.seenIDs.has(id) || acceptedIDs.has(id)) continue;
          prepared.push(this.prepareRow(source, result.definitions, url)); acceptedIDs.add(id);
        }
        const grid=this.doc.querySelector('#content .torrent_grid'),preparedCovers=[];
        if(grid){const coverIDs=new Set([...grid.querySelectorAll('.torrent_grid__torrent')].map(card=>torrentID(card,this.search)));
          for(const card of result.cards||[]){const id=torrentID(card,url);if(acceptedIDs.has(id)&&!coverIDs.has(id)){preparedCovers.push(this.prepareCover(card,url));coverIDs.add(id);}}}
        const target = this.table();
        if (!target) throw new Error('The results table is no longer available.');
        if (prepared.length) this.app.batchDOM(() => {
          const body = target.tBodies[0] || target.createTBody();
          body.append(...prepared);
          grid?.append(...preparedCovers);
          // Use one filtering implementation for native and appended rows. Do this
          // synchronously before thumbnails or deferred native images can start.
          try { this.app.options.newRows?.(body, prepared); }
          catch (error) {
            // A failed filter pass must not leave fresh rows visible and marked
            // as already seen. Keep earlier pages and allow this page to retry.
            for (const row of prepared) {
              const id = torrentID(row, url);
              this.app.removedFilterIDs.delete(id);
              this.app.detachedFilterRows.get(row)?.remove(); this.app.detachedFilterRows.delete(row);
              this.app.filterRows?.delete(row);
              for (const tag of row.querySelectorAll('div.tags')) this.app.filterTags?.delete(tag);
              for (const cell of row.querySelectorAll('.cats_col,.cats_cols')) this.app.categoryCells?.delete(cell);
              row.remove();
            }
            for(const card of preparedCovers)card.remove();
            this.app.refreshFilters(); throw pageError('A result on this page could not be processed. Loaded pages were kept.');
          }
          this.app.syncGridFilters(true, prepared);
          if (this.app.settings.enabled) {
            for (const row of prepared) if (row.isConnected) {
              this.app.media.scan(row, false); this.app.preview.scan(row);
            }
            for (const card of preparedCovers) {
              this.app.media.scan(card, false); this.app.preview.scan(card);
            }
            this.app.media.prepareThumbnails(prepared, preparedCovers);
          }
        });
        for (const id of acceptedIDs) this.seenIDs.add(id);
        pages++; added += prepared.length; this.pages++; this.added += prepared.length;
        this.loadProgress.loaded = pages; this.app.scheduleHealth();
        this.loaded.add(url);
        this.nextURL = result.rows.length ? nextBackfillURL(result.page, url, this.search, this.loaded) ||
          nextBackfillURL(this.doc, url, this.search, this.loaded) : null;
        this.updatePager();
      }
      this.loadProgress.status = 'ready';
      this.message = added + ' results added from ' + pages + (pages === 1 ? ' page' : ' pages') + (this.nextURL ? '' : ' · No more pages');
    } catch (error) {
      if (generation === this.generation && !this.disposed) {
        this.loadProgress.status = 'failed';
        this.failedURL = this.nextURL;
        this.message = (pages ? pages + (pages === 1 ? ' page kept. ' : ' pages kept. ') : '') + 'Could not load page ' + pageNumber(this.nextURL) +
          ': ' + error.message + (this.now() < (this.notBefore || 0) ? ' Loading is available again after the cooldown.' : '') + ' Try Load more again.';
      }
    } finally {
      if (generation === this.generation) {
        this.busy = false; this.controller = null; this.sync();
        this.app.scheduleHealth();
        this.app.versions?.stabilizeLayouts();
      }
    }
  }
  stop() {
    this.cancelForeground?.();
    this.cancelDelay?.();
    this.generation++; this.controller?.abort(); this.controller = null; this.busy = false;
    if (this.loadProgress?.status === 'loading') this.loadProgress.status = 'stopped';
    this.app.scheduleHealth();
    this.message = 'Backfill stopped. Loaded results are kept.'; this.sync();
    this.app.versions?.stabilizeLayouts();
  }
  dispose() {
    this.disposed = true; this.generation++; this.controller?.abort(); this.cancelForeground?.(); this.cancelDelay?.();
    this.win.clearTimeout(this.cooldownTimer);
    this.footer?.remove();
  }
}

// SPDX-License-Identifier: GPL-3.0-or-later

const quickAddID = /^[1-9]\d{0,14}$/;
const quickAddCollagePath = /^\/collage\/([1-9]\d{0,14})\/?$/;
const quickAddDetails = '#content tr.torrentdetails';

function quickAddPageID(url, pathname) {
  const ids = url.searchParams.getAll('id');
  return url.pathname === pathname && !url.searchParams.has('action') && ids.length === 1 && quickAddID.test(ids[0])
    ? ids[0] : null;
}

function quickAddForm(root, collageURL) {
  const form = root.querySelector('#content #addtorrent form');
  if (form?.method !== 'post' || !form.querySelector('input[name="url"]:enabled')) return null;
  const token = form.querySelector('input[type="hidden"][name="token"]:enabled')?.value;
  const endpoint = new URL(collageURL.href + '/add');
  const action = form.getAttribute('action');
  return token && action && URL.canParse(action, collageURL) && new URL(action, collageURL).href === endpoint.href
    ? { endpoint, token } : null;
}

function quickAddMembership(root, base) {
  const ids = new Set();
  for (const link of root.querySelectorAll('#content table#collages a[href], #content table#personal_collages a[href]')) {
    const href = link.getAttribute('href');
    if (!URL.canParse(href, base)) continue;
    const url = new URL(href, base);
    const id = quickAddCollagePath.exec(url.pathname)?.[1];
    if (id && url.origin === base.origin && !url.search) ids.add(id);
  }
  return ids;
}

class CollageQuickAdd {
  constructor(app) {
    this.app = app;
    this.page = new URL(app.win.location.href);
    this.collageID = quickAddCollagePath.exec(this.page.pathname)?.[1];
    this.torrentID = quickAddPageID(this.page, '/torrents.php');
    this.added = new Set();
    this.unconfirmed = new Set();
  }

  mount() {
    if (this.tools || !this.collageID && !this.torrentID) return;
    const { app, page } = this;
    const heading = app.doc.querySelector('#content h2');
    this.accountID = emporniumAccountID(app.doc, page);
    if (!heading || !this.accountID) return;

    if (this.collageID) {
      this.collageURL = this.urlFor(this.collageID);
      this.title = heading.textContent.trim().slice(0, 300);
      if (!this.title || !quickAddForm(app.doc, this.collageURL)) return;
    } else {
      if (!app.doc.querySelector(quickAddDetails)) return;
      this.fetch = app.options.fetch || app.win.fetch?.bind(app.win);
      if (!this.fetch) return;
      this.torrentURL = new URL('/torrents.php?id=' + this.torrentID, page);
      this.members = quickAddMembership(app.doc, page);
    }

    this.scope = 'ep.collageQuickAdd:' + page.origin + ':' + this.accountID;
    this.pinPrefix = this.scope + ':pin:';
    this.tools = app.node('div', null, 'epc-collage-tools');
    this.button = app.button('', () => this.collageID ? this.togglePin() : void this.add());
    if (this.torrentID) this.button.classList.add('epc-primary');
    this.status = app.node('span', '', 'epc-collage-status');
    this.status.setAttribute('role', 'status');
    if (this.torrentID) {
      this.select = app.node('select');
      this.select.setAttribute('aria-label', 'Quick-add collage');
      this.select.addEventListener('change', () => {
        try { app.storage.set(this.scope + ':selected', this.select.value); this.status.textContent = ''; }
        catch { this.status.textContent = 'Could not remember the selected collage.'; }
        this.renderAdd();
      });
    }
    this.tools.append(this.button);
    if (this.select) this.tools.append(this.select);
    app.contextActions.append(this.tools);
    app.toolbarStatus.append(this.status);
    app.on(app.win, 'focus', () => this.refresh());
    app.on(app.win, 'pageshow', event => { if (event.persisted) this.refresh(); });
    app.on(app.win, 'pagehide', () => this.dispose());
    this.refresh();
  }

  urlFor(id) { return new URL('/collage/' + id, this.page); }

  refresh() {
    if (this.collageID) {
      const pinned = !!this.app.storage.get(this.pinPrefix + this.collageID, '');
      this.button.textContent = pinned ? 'Unpin collage' : 'Pin for quick add';
      this.button.setAttribute('aria-pressed', String(pinned));
      return;
    }

    const { app, pinPrefix } = this;
    const pins = [];
    for (const key of app.storage.list()) {
      if (!key.startsWith(pinPrefix)) continue;
      const id = key.slice(pinPrefix.length);
      const title = app.storage.get(key, '');
      if (quickAddID.test(id) && typeof title === 'string' && title.trim()) pins.push({ id, title: title.slice(0, 300) });
    }
    pins.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    const selected = app.storage.get(this.scope + ':selected', this.select.value);
    if (JSON.stringify(pins) !== JSON.stringify(this.pins)) {
      this.pins = pins;
      this.select.replaceChildren(...pins.map(pin => {
        const option = app.node('option', pin.title);
        option.value = pin.id;
        return option;
      }));
    }
    if (pins.some(pin => pin.id === selected)) this.select.value = selected;
    this.renderAdd();
  }

  renderAdd() {
    const pin = this.pins.find(item => item.id === this.select.value);
    this.tools.hidden = !pin;
    this.status.hidden = !pin;
    this.select.hidden = this.pins.length < 2;
    this.select.disabled = !!this.operation;
    if (!pin) return;
    const added = this.added.has(pin.id), present = this.members.has(pin.id);
    this.button.textContent = (added ? 'Added to ' : present ? 'Already in ' : 'Add to ') + pin.title;
    this.button.disabled = !!this.operation || added || present;
    this.button.setAttribute('aria-busy', String(!!this.operation));
  }

  togglePin() {
    const { storage } = this.app;
    const key = this.pinPrefix + this.collageID;
    try {
      const pinned = !!storage.get(key, '');
      if (pinned) storage.delete(key);
      else storage.set(key, this.title);
      this.status.textContent = pinned ? 'Collage unpinned.' : 'Pinned. Add torrents from their details pages.';
      this.refresh();
    } catch { this.status.textContent = 'Could not save the collage pin.'; }
  }

  async readPage(url, signal) {
    const response = await this.fetch(url.href, {
      credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal
    });
    if (!response.ok || response.url && response.url !== url.href) throw new Error('Empornium could not load the page.');
    const contentType = response.headers?.get('content-type');
    if (contentType && !/\btext\/html\b/i.test(contentType)) throw new Error('Empornium did not return a page.');
    const html = await response.text();
    if (html.length > 8 * 1024 * 1024) throw new Error('The Empornium page was too large to check.');
    const template = this.app.doc.createElement('template');
    template.innerHTML = html;
    if (emporniumAccountID(template.content, url) !== this.accountID) throw new Error('Your Empornium session changed.');
    return template.content;
  }

  async verifyMembership(id, signal) {
    const detail = await this.readPage(this.torrentURL, signal);
    if (!detail.querySelector(quickAddDetails)) throw new Error('Empornium did not return the torrent details.');
    return quickAddMembership(detail, this.torrentURL).has(id);
  }

  async add() {
    if (this.button.disabled || this.operation) return;
    const pin = this.pins.find(item => item.id === this.select.value);
    if (!pin) return;
    const { id, title } = pin;
    const controller = new this.app.win.AbortController();
    this.operation = controller;
    this.app.scheduleHealth();
    const { signal } = controller;
    const timeout = this.app.win.setTimeout(() => controller.abort(), 20000);
    this.renderAdd();
    this.status.textContent = 'Checking ' + title + '…';
    try {
      if (this.unconfirmed.has(id) && await this.verifyMembership(id, signal)) {
        this.unconfirmed.delete(id);
        this.members.add(id);
        this.status.textContent = 'Already in ' + title + '.';
        return;
      }
      this.unconfirmed.delete(id);
      const url = this.urlFor(id);
      const page = await this.readPage(url, signal);
      const form = quickAddForm(page, url);
      if (!form) {
        this.status.textContent = 'Empornium is not accepting adds to ' + title + '. Check the collage for access.';
        return;
      }
      if (signal.aborted) throw new Error('The request was interrupted.');

      this.status.textContent = 'Adding to ' + title + '…';
      this.unconfirmed.add(id);
      try {
        await this.fetch(form.endpoint.href, {
          method: 'POST', body: new URLSearchParams({ token: form.token, url: this.torrentURL.href }),
          credentials: 'same-origin', mode: 'same-origin', redirect: 'manual', signal
        });
      } catch { /* The site may have accepted the add before the connection dropped. */ }
      if (!await this.verifyMembership(id, signal)) throw new Error('The add could not be verified.');
      this.unconfirmed.delete(id);
      this.added.add(id);
      this.status.textContent = 'Added to ' + title + '.';
    } catch {
      this.status.textContent = this.unconfirmed.has(id)
        ? 'Could not confirm the add. Try again to check membership first.'
        : 'Could not reach the collage. Check your sign-in and try again.';
    } finally {
      this.app.win.clearTimeout(timeout);
      this.operation = null;
      this.app.scheduleHealth();
      if (!this.app.disposed) this.refresh();
    }
  }

  dispose() { this.operation?.abort(); }
}

// SPDX-License-Identifier: GPL-3.0-or-later
// A draft of existing preferences, committed through the normal import transaction.
class OnboardingController {
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
    applyWorkspaceTheme(app, [dialog]);
    dialog.setAttribute('aria-labelledby', 'epc-welcome-title');
    const title = app.node('h2', 'Welcome to Companion'); title.id = 'epc-welcome-title';
    const heading = app.node('header', null, 'epc-welcome-heading');
    const mark = app.node('span', null, 'epc-brand-mark'); mark.append(companionIcon(app, 'brand'));
    heading.append(mark, title);
    dialog.append(heading, app.node('p', 'Reliable thumbnails, image grids, larger previews on hover, filters, grouped versions, saved searches, and more results on one page.'));
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
          'You can still add pages yourself with Load more.';
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
    this.gridSpacing = app.controls.get('gridSpacing').cloneNode(true);
    this.gridSpacing.removeAttribute('data-setting'); this.gridSpacing.dataset.welcomeSetting = 'gridSpacing';
    this.gridSpacing.value = app.settings.gridSpacing;
    field(form, 'Grid spacing', this.gridSpacing);
    for (const [key, label] of [['gridAutoplayGifs', 'Play animated covers in Grid'], ['listAutoplayGifs', 'Play animated covers in List']]) {
      const input = this[key] = app.node('input'); input.type = 'checkbox';
      input.checked = app.settings[key]; input.dataset.welcomeSetting = key;
      field(form, label, input);
    }
    this.coverMotionNote = app.createCoverMotionNote('epc-cover-motion-welcome');
    form.append(this.coverMotionNote,
      app.node('p', 'Preload full-size covers, including off-screen results. List playback shows inline covers. This can use more data.', 'epc-caption'));
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
    app.syncCoverMotionControls();
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
        resultsView: this.view.value, gridCardWidth: Number(this.gridSize.value),
        gridSpacing: this.gridSpacing.value, gridAutoplayGifs: this.gridAutoplayGifs.checked, listAutoplayGifs: this.listAutoplayGifs.checked,
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
    this.view = this.gridSize = this.gridSpacing = this.gridAutoplayGifs = this.listAutoplayGifs = this.shortcuts = null;
    this.coverMotionNote = null;
  }
  dispose() { this.close(); }
}

// SPDX-License-Identifier: GPL-3.0-or-later

const labels = {
  searchtext: 'Keywords', searchstr: 'Keywords', title: 'Title contains', taglist: 'Tags',
  filelist: 'File name contains', sizeall: 'Size', sizerange: 'Size range',
  sizetype: 'Size unit', sizeunit: 'Size unit', sizeunits: 'Size unit', sizeselect: 'Size filter',
  filter_freeleech: 'Freeleech only', limit_matches: 'Limit matches',
  order_by: 'Sort by', order_way: 'Sort direction', autocomplete_toggle: 'Autocomplete'
};
const ordinary = new Set(['searchtext', 'searchstr', 'title', 'taglist', 'filelist', 'sizeall', 'sizerange']);
const labelFor = name => labels[name] || (/^filter_cat\[(\d+)\]$/.exec(name) ? 'Category ' + /^filter_cat\[(\d+)\]$/.exec(name)[1] : name);

// Build from the saved record. Native controls provide labels/options only;
// their current values never become the saved search's draft.
function createSavedSearchEditor(app, saved, { save, cancel }) {
  const root = app.node('section', null, 'epc-search-editor');
  root.setAttribute('aria-label', 'Edit saved search: ' + saved.title);
  root.append(app.node('strong', 'Editing “' + saved.title + '”'));
  const nameLabel = app.node('label', null, 'epc-field');
  const name = app.node('input'); name.type = 'text'; name.value = saved.title; name.required = true; name.maxLength = 300;
  name.dataset.searchTitle = ''; nameLabel.append(app.node('span', 'Search name'), name); root.append(nameLabel);
  const main = app.node('div', null, 'epc-search-editor-fields'); root.append(main);
  const more = app.node('details', null, 'epc-search-editor-extra');
  more.append(app.node('summary', 'More criteria'));
  const extra = app.node('div', null, 'epc-search-editor-fields'); more.append(extra); root.append(more);
  const status = app.node('p', '', 'epc-search-editor-status'); status.setAttribute('role', 'status');
  const groups = new Map(), order = new WeakMap(), native = Array.from(app.savedForm?.elements || []).filter(control => SEARCH_NAMES.test(control.name));
  for (const [index, field] of saved.fields.entries()) {
    if (!groups.has(field.name)) groups.set(field.name, []);
    const record = { ...field }; order.set(record, index); groups.get(field.name).push(record);
  }
  const keyword = groups.has('searchstr') && !groups.has('searchtext') ? 'searchstr' : 'searchtext';
  for (const fieldName of [keyword, 'taglist', 'title', 'filelist']) if (!groups.has(fieldName)) groups.set(fieldName, []);
  for (const control of native) if (!groups.has(control.name) && !(control.name === 'searchtext' && keyword === 'searchstr')) groups.set(control.name, []);
  const readers = [];
  const addReader = (records, read) => readers.push({ order: records.length ? Math.min(...records.map(record => order.get(record))) : saved.fields.length + readers.length, read });
  let firstActive = null, hasExtra = false;
  const entries = [...groups].sort((a, b) => {
    const active = records => records.some(field => ['checkbox', 'radio'].includes(field.type) ? field.checked : !!field.value.trim());
    return Number(active(b[1])) - Number(active(a[1]));
  });
  const rowFor = (fieldName, control, active, caption = labelFor(fieldName)) => {
    const row = app.node('label', null, 'epc-field' + (control.type === 'checkbox' ? ' epc-check' : ''));
    control.dataset.searchField = fieldName; control.maxLength = 20000;
    if (control.type === 'checkbox') row.append(control, app.node('span', caption));
    else row.append(app.node('span', caption), control);
    const primary = ordinary.has(fieldName) && active || fieldName === keyword || fieldName === 'taglist' ||
      control.type === 'checkbox' && active;
    (primary ? main : extra).append(row);
    if (!primary) hasExtra = true;
    if (active && primary && !firstActive) firstActive = control;
    return control;
  };
  for (const [fieldName, records] of entries) {
    const source = native.filter(control => control.name === fieldName);
    const kind = records[0]?.type || source[0]?.type || (fieldName === 'taglist' ? 'textarea' : 'text');
    if (kind === 'checkbox') {
      const values = records.length ? records : [{ name: fieldName, type: 'checkbox', value: source[0]?.value || '1', checked: false }];
      for (const record of values) {
        const control = app.node('input'); control.type = 'checkbox'; control.checked = !!record.checked; control.value = record.value;
        const nativeLabel = source.find(input => input.value === record.value)?.labels?.[0]?.textContent.trim();
        rowFor(fieldName, control, control.checked, /^filter_cat\[/.test(fieldName) && nativeLabel ? nativeLabel : labelFor(fieldName));
        addReader(records.length ? [record] : [], () => records.length || control.checked ? [{ ...record, checked: control.checked }] : []);
      }
      continue;
    }
    if (kind === 'radio') {
      const control = app.node('select'), empty = app.node('option', 'Not set'); empty.value = ''; control.append(empty);
      const values = [...new Set([...records.map(field => field.value), ...source.map(input => input.value)])];
      for (const value of values) {
        const caption = source.find(input => input.value === value)?.labels?.[0]?.textContent.trim();
        const option = app.node('option', caption || value); option.value = value; control.append(option);
      }
      control.value = records.find(field => field.checked)?.value || '';
      rowFor(fieldName, control, !!control.value);
      addReader(records, () => records.length ? records.map(field => ({ ...field, checked: field.value === control.value })) :
        control.value ? [{ name: fieldName, type: 'radio', value: control.value, checked: true }] : []);
      continue;
    }
    const select = source.find(control => control.tagName === 'SELECT');
    if (kind === 'select-multiple' || kind === 'select-one' || select) {
      const control = app.node('select'); control.multiple = kind === 'select-multiple';
      const choices = new Map(Array.from(select?.options || [], option => [option.value, option.textContent]));
      if (!control.multiple) choices.set('', choices.get('') || 'Not set');
      for (const record of records) if (!choices.has(record.value)) choices.set(record.value, record.value || 'Not set');
      const selected = new Set(records.map(record => record.value));
      for (const [value, caption] of choices) {
        const option = app.node('option', caption); option.value = value; option.selected = selected.has(value); control.append(option);
      }
      if (!control.multiple) control.value = records[0]?.value || '';
      rowFor(fieldName, control, records.some(record => !!record.value));
      addReader(records, () => control.multiple ? [
        ...records.filter(record => Array.from(control.selectedOptions).some(option => option.value === record.value)).map(record => ({ ...record })),
        ...Array.from(control.selectedOptions).filter(option => !records.some(record => record.value === option.value))
          .map(option => ({ name: fieldName, type: kind, checked: false, value: option.value }))
      ] : records.length ? records.map(record => ({ ...record, value: control.value })) :
        control.value ? [{ name: fieldName, type: 'select-one', value: control.value, checked: false }] : []);
      continue;
    }
    for (const record of records.length ? records : [{ name: fieldName, type: fieldName === 'taglist' ? 'textarea' : 'text', value: '', checked: false }]) {
      const control = app.node(fieldName === 'taglist' || kind === 'textarea' ? 'textarea' : 'input');
      if (control.tagName === 'INPUT') control.type = 'text'; else control.rows = 2;
      control.value = record.value; rowFor(fieldName, control, !!record.value.trim());
      addReader(records.length ? [record] : [], () => records.length || control.value ? [{ ...record, value: control.value }] : []);
    }
  }
  more.hidden = !hasExtra;
  const actions = app.node('div', null, 'epc-actions');
  const commit = () => {
    name.removeAttribute('aria-invalid');
    if (!name.value.trim()) { name.setAttribute('aria-invalid', 'true'); status.textContent = 'Enter a search name.'; name.focus({ preventScroll: true }); return; }
    try {
      // Keep unedited records byte-for-byte equivalent in value/type, including
      // fields the current site's search form doesn't expose.
      const fields = [...readers].sort((a, b) => a.order - b.order).flatMap(reader => reader.read());
      save({ title: name.value.trim(), fields });
    } catch (error) { status.textContent = error.message || 'Could not save. Your changes are still here.'; }
  };
  actions.append(app.button('Save changes', commit), app.button('Cancel', cancel)); root.append(status, actions);
  root.addEventListener('keydown', event => {
    if (!app.settings.keyboardShortcuts) return;
    if (event.isComposing || event.key === 'Escape' && event.target.tagName === 'SELECT') { event.stopPropagation(); return; }
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
    else if (isSaveShortcut(event) ||
      event.key === 'Enter' && event.target.tagName === 'INPUT') { event.preventDefault(); event.stopPropagation(); commit(); }
  });
  return { element: root, focus: () => (firstActive || name).focus({ preventScroll: true }) };
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Independently implemented after reviewing Collapse Duplicates, Coalesce
// Variations, and the Emp++/Luminance tag highlighters. See THIRD_PARTY.md.

function resultTitleLink(row) {
  return [...row.querySelectorAll('td a[href*="torrents.php"]')].find(link => {
    if (!link.textContent.trim() || link.closest('.tags,.torrent_icon_container,.epc-thumbnail,.epc-grid-card-actions')) return false;
    try { const url = new URL(link.href); return url.searchParams.has('id') && !url.searchParams.has('action'); }
    catch { return false; }
  });
}

function parseVersionTitle(value) {
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

class VersionGroups {
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
    for (const { details } of this.gridControls.values()) removeGridCardAction(details);
    this.gridControls.clear();
    this.controls.clear(); this.groups.clear(); this.candidates.clear(); this.collapsed = 0;
  }
  dispose() { this.clear(); this.rows.clear(); }
}

function highlightTagList(value) {
  return [...new Set(String(value || '').toLocaleLowerCase().split(/\s+/).filter(Boolean))];
}

// Extract positive tag terms without turning NOT/negative clauses into matches.
// This annotates individual terms; it does not claim to evaluate a result's query.
function positiveTagTerms(query) {
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

function matchesTagTerm(value, term) {
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

class TagHighlights {
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
    if (!favorites.size && !cautions.size) { removeGridCardAction(cue); this.cues.delete(row); return; }
    if (!cue) {
      const title = resultTitleLink(row);
      if (!title) return;
      cue = app.node('details', null, 'epc-root epc-grid-tag-cue');
      cue.append(app.node('summary'), app.node('div', null, 'epc-grid-tag-matches'));
      gridCardActions(app, title).prepend(cue); this.cues.set(row, cue);
    }
    const caption = [
      cautions.size === 1 ? 'Caution' : cautions.size ? cautions.size + ' cautions' : '',
      favorites.size === 1 ? 'Favorite' : favorites.size ? favorites.size + ' favorites' : ''
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
      removeGridCardAction(this.cues.get(row)); this.cues.delete(row);
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
    for (const cue of this.cues.values()) removeGridCardAction(cue);
    this.cues.clear(); this.releaseDetailTags();
  }
}

// SPDX-License-Identifier: GPL-3.0-or-later

const listColumnLabels = new Map([
  ['files', 'Files'], ['comments', 'Comments'], ['added', 'Added'], ['size', 'Size'],
  ['snatches', 'Snatches'], ['seeds', 'Seeds'], ['peers', 'Peers'], ['uploader', 'Uploader']
]);
const listColumnAliases = new Map([
  ['files', 'files'], ['file count', 'files'], ['comments', 'comments'], ['comm', 'comments'],
  ['added', 'added'], ['time', 'added'], ['date added', 'added'],
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

function gridCardSizeChoices(select, width) {
  const choices = new Map([[240, 'Compact · 240px'], [320, 'Balanced · 320px'], [420, 'Large · 420px'], [540, 'Extra large · 540px']]);
  if (!choices.has(width)) choices.set(width, 'Current · ' + width + 'px');
  select.replaceChildren();
  for (const [value, label] of choices) {
    const option = select.ownerDocument.createElement('option'); option.value = value; option.textContent = label; select.append(option);
  }
  select.value = width; select.required = true;
}

// Keep native rows, links and controls: both layouts share filtering and backfill.
class ResultGrid {
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
        if (app.settings.resultsView !== value) app.setResultPreference('resultsView', value);
      });
      button.prepend(companionIcon(app, value));
      button.dataset.epLayout = value;
      button.title = help;
      this.layoutButtons.set(value, button); this.layout.append(button);
    }
    app.toolbarContext.append(this.layout);
    this.viewOptions = app.node('div', null, 'epc-view-options');
    this.viewOptions.id = 'epc-view-options';
    this.viewOptions.hidden = true;
    this.viewOptionsButton = app.button('View options', () => {
      if (!this.viewOptions.hidden) { this.closeViewOptions(); return; }
      if (app.activePane) { app.closePane(); this.viewOptionsButton.focus(); }
      this.viewOptions.hidden = false;
      this.viewOptionsButton.setAttribute('aria-expanded', 'true');
      app.media.invalidateLayout();
    });
    this.viewOptionsButton.hidden = true;
    this.viewOptionsButton.setAttribute('aria-expanded', 'false');
    this.viewOptionsButton.setAttribute('aria-controls', this.viewOptions.id);
    this.viewOptions.append(this.columnOptions = app.node('div', null, 'epc-column-options'),
      this.gridOptions = app.node('div', null, 'epc-grid-options'));
    this.columnOptions.hidden = this.gridOptions.hidden = true;
    app.resultActions.append(this.viewOptionsButton);
    this.viewOptions.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      this.closeViewOptions();
      this.viewOptionsButton.focus();
    });
    this.viewOptionsButton.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || this.viewOptions.hidden) return;
      event.preventDefault(); event.stopPropagation();
      this.closeViewOptions();
    });
    const control = app.node('input'); control.type = 'hidden'; control.hidden = true;
    control.value = app.settings.listHiddenColumns; control.dataset.setting = 'listHiddenColumns';
    app.controls.set('listHiddenColumns', control);
    app.toolbarContext.append(control);
    this.syncControls();
  }
  closeViewOptions() {
    if (this.viewOptions.hidden) return;
    this.viewOptions.hidden = true;
    this.viewOptionsButton.setAttribute('aria-expanded', 'false');
    this.app.media.invalidateLayout();
  }
  mountViewOptions() {
    const { app } = this;
    app.toolbarContext.append(this.viewOptions);
    this.gridOptionFields = new Map();
    for (const [key, label] of [['gridCardWidth', 'Card size'], ['gridSpacing', 'Spacing'],
      ['gridShowTags', 'Show tags'], ['gridShowDetails', 'Show details']]) {
      const field = app.controls.get(key).cloneNode(true);
      field.removeAttribute('data-setting');
      field.removeAttribute('data-numeric');
      field.removeAttribute('aria-describedby');
      field.dataset.viewOption = key;
      const row = app.node('label');
      if (field.type === 'checkbox') row.append(field, app.node('span', label));
      else row.append(app.node('span', label), field);
      this.gridOptions.append(row);
      this.gridOptionFields.set(key, field);
      field.addEventListener('change', () => {
        if (!app.setResultPreference(key, field.type === 'checkbox' ? field.checked : field.value)) this.syncGridOptions();
      });
    }
    this.syncGridOptions();
  }
  syncGridOptions() {
    for (const [key, field] of this.gridOptionFields || []) {
      const value = this.app.settings[key];
      if (field.type === 'checkbox') field.checked = value;
      else if (key === 'gridCardWidth' && ![...field.options].some(option => Number(option.value) === value)) {
        gridCardSizeChoices(field, value);
      } else field.value = value;
    }
  }
  syncListColumns(grid) {
    const { app } = this;
    this.clearListColumns();
    if (!this.columnOptions) return;
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
    this.columnOptions.hidden = grid || !available.size;
    const optionsKey = JSON.stringify([...available].map(([key, label]) => [key, label, hidden.has(key), sorts.get(key)?.href]));
    if (this.columnOptionsKey === optionsKey) return;
    this.columnOptionsKey = optionsKey;
    const focused = app.doc.activeElement?.dataset.columnChoice;
    this.columnOptions.replaceChildren(app.node('p', 'Columns', 'epc-caption'));
    for (const [key, label] of available) {
      const line = app.node('div', null, 'epc-column-option');
      const field = app.node('label');
      const input = app.node('input'); input.type = 'checkbox'; input.checked = !hidden.has(key);
      input.dataset.columnChoice = key;
      input.addEventListener('change', () => {
        const next = new Set(app.settings.listHiddenColumns.split(' ').filter(Boolean));
        if (input.checked) next.delete(key); else next.add(key);
        if (!app.setResultPreference('listHiddenColumns', [...next].join(' '))) input.checked = !input.checked;
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
    const grid = this.app.settings.resultsView === 'grid';
    for (const [value, button] of this.layoutButtons) button.setAttribute('aria-pressed', String(this.app.settings.resultsView === value));
    if (this.settingsSwitch) this.settingsSwitch.hidden = this.layout.hidden || grid;
    this.gridOptions.hidden = !grid;
    this.viewOptionsButton.hidden = this.layout.hidden || !grid && this.columnOptions.hidden;
    if (this.viewOptionsButton.hidden) this.closeViewOptions();
    this.syncGridOptions();
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
    this.clearListColumns();
    for (const table of this.tables.keys()) this.release(table);
    this.app.doc.documentElement.removeAttribute('data-ep-compact-cover-grid');
    this.app.doc.documentElement.removeAttribute('data-ep-list-autoplay');
    this.layout?.remove();
  }
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Keep media changes local, and process each changed subtree once per frame.
function coalesceScanRoots(roots) {
  const connected = new Set([...roots].filter(root => root.isConnected));
  return [...connected].filter(root => {
    for (let parent = root.parentElement; parent; parent = parent.parentElement) if (connected.has(parent)) return false;
    return true;
  });
}

function presentationMutation(mutation) {
  if (mutation.type !== 'attributes') return false;
  const current = mutation.target.getAttribute(mutation.attributeName);
  if (current === mutation.oldValue) return true;
  if (mutation.attributeName !== 'class') return false;
  const nativeClasses = value => (value || '').split(/\s+/).filter(name => name &&
    !/^epc-(?:tag-match|page-image|compact|revealed|stable-columns|result-grid|cover-art|managed-cover|native-cover|cover-positioned|version-(?:hidden|member)|category-(?:keep|hide|overlay))$/.test(name)).join(' ');
  return nativeClasses(current) === nativeClasses(mutation.oldValue);
}

function mutationChangesResults(mutation) {
  const target = mutation.target;
  if (target.nodeType !== 1 || target.matches('img,source,video,canvas')) return false;
  const containsRows = node => node.nodeType === 1 && (node.matches('tr.torrent') ||
    node.children.length > 0 && !!node.querySelector('tr.torrent'));
  if (mutation.type === 'attributes') {
    if (!['class', 'style', 'hidden', 'isnsehidden'].includes(mutation.attributeName)) return false;
    if (mutation.attributeName === 'style') {
      const visibility = value => (value || '').match(/(?:^|;)\s*(?:display|visibility)\s*:[^;]*/gi)?.join('').toLowerCase() || '';
      if (visibility(mutation.oldValue) === visibility(target.getAttribute('style'))) return false;
    }
    return containsRows(target);
  }
  if (target.closest('div.tags,#torrent_tags_list,.torrent_icon_container,.nseToggleIcon')) return false;
  const changed = [...mutation.addedNodes, ...mutation.removedNodes];
  if (changed.some(containsRows)) return true;
  if (changed.some(node => node.nodeType === 1 && (node.matches('#search_form,#search_box,#content') ||
    node.children.length && node.querySelector('#search_form,#search_box')))) return true;
  return !!target.closest('tr.torrent') || !!target.closest('#search_form,#search_box');
}

// SPDX-License-Identifier: GPL-3.0-or-later

const settingHelp = Object.freeze({
  enabled: 'Turn on Companion’s thumbnails, hover previews, and image recovery. Filters and saved searches still work when this is off.',
  previews: 'Hover over a result title or thumbnail to see a larger image. Click the preview to keep it open.',
  inlineThumbnails: 'Show a small image beside each result in List. Grid has its own card images.',
  thumbnailPlacement: 'Put List thumbnails beside the title or in the category column. Choose the title if you hide the category column.',
  categoryDisplay: 'Keep the site’s category icon, overlay it on the thumbnail, or hide the icon.',
  thumbnailMode: 'Choose the image List tries first. Small first uses a small variant when available, Page preview uses the site’s supplied image, and Full original starts with the largest image.',
  thumbnailSize: 'Set the size of List thumbnails in pixels. Grid card size is controlled separately.',
  resultsView: 'Choose List for the site’s table or Grid for image cards. You can also switch from the results toolbar.',
  gridCardWidth: 'Choose the target card width. Smaller cards fit more across the page, and cards shrink to fit a narrow screen.',
  gridSpacing: 'Compact reduces the gaps and padding in Grid. It also tightens spacing in the site’s Cover Art view.',
  gridAutoplayGifs: 'Preload full-size covers so animated images can play when Grid cards are visible. This can use extra data, including for still images.',
  listAutoplayGifs: 'Preload full-size covers so animated images can play on visible List rows. This shows inline covers even if Inline thumbnails is off and can use extra data.',
  gridShowDetails: 'Show the category and metadata such as size, seeds, and uploader on each Grid card.',
  gridShowTags: 'Show the full tag list on each Grid card. Tags still count toward filters when the list is hidden.',
  gridTagCues: 'When the full tag list is hidden, show a short cue on Grid cards with Favorite or Caution matches. Open it to see the matching tags.',
  adaptiveDetailTags: 'Let the tag list on a torrent detail page wrap into columns when there’s room. Narrow screens use one column.',
  previewWidth: 'Set the target width of enlarged previews in pixels. Previews still fit within the browser window.',
  hoverDelay: 'Wait this many milliseconds before showing a preview when you hover over a title. Increase it if previews open while you scan the list.',
  hideDelay: 'Give yourself this many milliseconds to move from the trigger into the preview before it closes. A pinned preview stays open.',
  recoverImages: 'Retry page images that fail or stall as they come into view, including images on torrent detail pages.',
  recoverBackgrounds: 'Load and recover images used as collage or Cover Art covers. This also enables Companion’s cover handling on those pages.',
  legacyFallback: 'Try the full-size image if an older Empornium resize link fails. The original can use more data.',
  prepareGalleries: 'Let the browser wait to load offscreen images in unopened galleries, reducing work when a page first opens.',
  reserveImageSpace: 'Hold space for nearby images while they load so text and controls move less as the images appear.',
  compactBodyImages: 'Limit the displayed height of very tall images in page content so they take up less scrolling space.',
  concurrency: 'Set the maximum number of thumbnail loads at once. Companion can slow down for a struggling image host. Lower this if loading feels heavy.',
  thumbnailTimeoutMs: 'Give the small image this many milliseconds before trying another candidate. A shorter wait can switch sooner to a larger image where available.',
  maxRetries: 'Set how many automatic retries to make after an image attempt fails. Zero turns off automatic retries. You can still retry manually.',
  stallMs: 'Show a slow-load message after this many milliseconds without progress. The request can keep running until its timeout.',
  timeoutMs: 'Set how long to wait for an unanswered full-size image attempt before retrying or reporting a failure.',
  cacheEntries: 'Limit the number of idle images kept in memory for quick reuse. Lower this to use less memory.',
  cacheMegapixels: 'Limit the total decoded image pixels kept in the in-memory cache. The saved image cache has its own limit in megabytes.',
  persistentImages: 'Save supported image files in this browser so future pages can reuse them. This uses local disk space.',
  persistentCacheMB: 'Set how much browser storage saved images may use. Older cached files can be cleared to make room.',
  preloadScreens: 'Prioritize thumbnails within this many screen heights of the viewport. Other loaded results can still warm in the background.',
  progressBar: 'Show the progress indicator in the Companion header. Open it to see which images and result pages are loading.',
  keyboardShortcuts: 'Enable Companion shortcuts for previews, saving edits, and opening tag menus. See the key list in this section.',
  navigationScope: 'Choose where Left and Right arrows go to the previous or next page. Requires Companion keyboard shortcuts.',
  diagnostics: 'Keep a local record of recent image and loading events for troubleshooting. Full image URLs and account tokens are omitted.',
  backfillEnabled: 'Enable Load more on supported lists and collages so you can append results to the current page.',
  backfillMode: 'Choose manual loading, a fixed number of additional pages, or every remaining page. Loading all pages can use more memory.',
  backfillPages: 'Set the number of extra pages per click or per automatic batch in fixed-count mode. The current page is already loaded.',
  groupVersions: 'Keep alternate video versions together. In List, expand the original rows. In Grid, open the versions list on the card.',
  favoriteTags: 'Enter space-separated tags to highlight as favorites. This helps you spot matches without changing which results appear.',
  cautionTags: 'Enter space-separated tags to flag for review. Caution takes priority if a tag also appears in Favorites.',
  collapsedDetailTags: 'Enter space-separated tags to tuck under Show other tags on torrent detail pages. The original tag links and controls are still available.',
  seenMode: 'Choose what to do with results whose detail pages you’ve opened in this browser. Show filtered can reveal hidden seen results in the current view.',
  nseBlacklistTaglistArea: 'Hide results with any of these exact tags. Separate tags with spaces. An Allow match can override an ordinary block.',
  nseWhitelistTaglistArea: 'Let results with any of these tags through ordinary blocks. Hard Pass and activity filters that bypass Allow can still hide them.',
  nseBlacklistTitleListArea: 'Hide results whose titles contain a listed phrase. Separate phrases with semicolons.',
  nseWhitelistTitleListArea: 'Allow results whose titles contain a listed phrase to pass ordinary blocks. Separate phrases with semicolons.',
  nseBlacklistUploadersArea: 'Hide results from these uploaders where uploader names are available. Separate usernames with spaces.',
  nseWhitelistUploadersArea: 'Let results from these uploaders through ordinary blocks. Separate usernames with spaces.',
  nseCheckHardPassEnabled: 'Apply the Hard Pass tag and title lists. Matching results stay hidden even when an ordinary Allow rule matches.',
  nseHardPassTaglistArea: 'When Hard Pass is enabled, hide results with any of these exact tags. Separate tags with spaces.',
  nseHardPassTitleListArea: 'When Hard Pass is enabled, hide results whose title contains a listed phrase. Separate phrases with semicolons.',
  nseCheckRemoveHardPassResults: 'Take Hard Pass rows out of the displayed list until you choose Show filtered. Their original positions are kept.',
  nseCheckHideAnonUploads: 'Hide results where the site shows the uploader as anonymous.',
  nseCheckHideReported: 'Hide results whose titles carry the site’s reported marker.',
  nseCheckHideWarned: 'Hide results with a warning marker from the site.',
  nseCheckHideUnseeded: 'Hide results with zero seeders in the current listing.',
  nseCheckHideGrabbed: 'Hide results the site marks as grabbed. This is useful when you want to skip downloads you’ve already grabbed.',
  nseCheckHideLeeching: 'Hide results the site marks as currently downloading.',
  nseCheckHideSeeding: 'Hide results the site marks as currently seeding.',
  nseCheckHideSnatched: 'Hide results the site marks as previously completed.',
  nseCheckHideBookmarked: 'Hide results marked as bookmarked in the current listing.',
  nseCheckBypassWhitelists: 'Give the grabbed, leeching, seeding, snatched, and bookmarked filters priority over ordinary Allow rules.',
  nseThemeDropdown: 'Choose Companion’s interface colors. Select Custom to use the colors under Advanced settings → Appearance.',
  nseUIFont: 'Set the font family for Companion’s interface. Use a font installed in your browser or a CSS fallback such as sans-serif.',
  nseTextAreaFont: 'Set the font family used in filter list and rule text boxes. Monospace makes tag lists easier to align.',
  nseBlacklistColor: 'Set the color used to mark ordinary blocked matches. Enter a CSS color such as #b91c1c.',
  nseHardPassColor: 'Set the color used to mark Hard Pass matches on tags and titles.',
  nseWhitelistColor: 'Set the color used to mark matches that are allowed through ordinary blocks.',
  nseCustomThemeBgCol: 'Set the main background color for the Custom theme.',
  nseCustomThemeBgHighCol: 'Set the hover background in parts of the filter interface that use the Custom theme.',
  nseCustomThemeForeCol: 'Set the main text color for the Custom theme. Choose one that is easy to read against the background.',
  nseCustomThemeAccentCol: 'Set the accent color for links, focus outlines, and highlighted controls in the Custom theme.',
  nseCustomThemeHighCol: 'Set the highlight and divider color used by the Custom theme.',
  nseCustomThemeHiddenBgCol: 'Set the background of filtered result rows when you reveal them with Show filtered.',
  nseCheckIndividualHide: 'Add a control on results to save a visibility exception for that one result. Right-click the control to reset a saved exception.',
  nseCheckRightClickManagementEnabled: 'Open Companion’s rule menu when you right-click supported tags or uploaders. Hold Shift to use the browser’s menu.',
  nseCheckRCMTagsEnabled: 'Include tags in the right-click rule menu so you can set Block, Allow, Favorite, or Caution while browsing.',
  nseCheckRCMUploadersEnabled: 'Include uploader names in the right-click rule menu so you can block or allow an uploader while browsing.',
  nseCheckScrollToNSEEnabled: 'Scroll to the Companion controls when a supported page opens.',
  nseCheckFilterAllButtonEnabled: 'Offer a bulk action that saves individual hide exceptions for the visible results. Requires individual result visibility.',
  nseCheckFloatingToggleButton: 'Show the Show filtered button in the toolbar when there are results it can reveal in the current view.',
  nseCheckOpenAllButton: 'Offer a bulk action that opens eligible visible results in separate tabs.',
  nseCheckOpenAllGoNext: 'After Open visible results opens the tabs, advance the current tab to the next results page.',
  nseCheckHideCategoryIcons: 'Remove the category column from the table to free up space for result names.',
  nseCheckObliviousMode: 'Hide the tag text in result rows. Tag rules still apply.',
  nseCheckCustomCSS: 'Apply the styles in the Custom CSS box to the site when Companion is active.',
  nseCheckEmojiEnabled: 'Use emoji for some rule-menu symbols and decorative text.',
  nseCheckUpdateToasts: 'Show a notice when the filtering engine is updated and your settings have been retained.',
  nseCheckRenumberTorrents: 'Renumber the visible entries on Top 10 pages after filtering.',
  nseCheckRussianRouletteMode: 'Randomly let filtered results appear on some page loads. Leave this off for consistent filtering.',
  nseCheckApril1stAllYear: 'Keep the decorative April Fools’ effect active year-round.',
  nseCustomCSSArea: 'Enter CSS for the site. Turn on Enable custom CSS to apply it.',
  nseTimeout: 'Wait this many milliseconds before integrating with the site’s comment links and calculating legacy filter storage usage.'
});

const helpCaptions = new WeakMap();

function setSettingHelp(caption, description, control = caption) {
  if (!description) return caption;
  caption.dataset.settingHelp = description;
  helpCaptions.set(control, caption);
  control.setAttribute('aria-description', description);
  return caption;
}

const settingGroupHelp = Object.freeze({
  advanced: 'Open less frequently used image, keyboard, appearance, browsing, and troubleshooting settings.',
  images: 'Choose how Companion shows thumbnails and enlarged previews.',
  loading: 'Tune image recovery, retry limits, and how much loading happens at once.',
  interaction: 'Set shortcuts, arrow-key navigation, and the menus available on results.',
  appearance: 'Customize fonts, filter colors, tag cues, and how parts of results are displayed.',
  results: 'Configure loading extra pages and actions that affect multiple results.',
  extras: 'Find optional display effects and filter engine behavior.',
  diagnostics: 'Review local loading history to troubleshoot images and result pages.',
  'cache-details': 'See how many images are saved, how often they’re reused, and how much space they take.',
  backup: 'Save your settings and searches, restore a backup, or import tag lists from Luminance.',
  'conditional-rules': 'Combine tags, title phrases, and uploader names to hide or allow results in specific cases.',
  'result-history': 'Choose how to show results you’ve opened and review which results you’ve seen or ignored.',
  'tag-highlights': 'Mark tags as Favorite or Caution so you can spot them while browsing.',
  'collapsed-detail-tags': 'Choose which tag labels to tuck away on torrent detail pages.',
  'Title rules': 'Hide or allow results by phrases in their titles.',
  'Uploader rules': 'Hide or allow results by the account that uploaded them.',
  'hard-pass': 'Hide matches even when an ordinary Allow rule also matches.',
  status: 'Filter by the site’s activity, bookmark, warning, and seeding markers.',
  bulk: 'Open or hide multiple eligible results in one step.'
});

function mountSettingTooltips(app) {
  const selector = '[data-setting-help]';
  const tooltip = app.node('div', null, 'epc-setting-tooltip');
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  app.panel.append(tooltip);
  let anchor, positionAnchor, pointerFocus = false;
  const hide = () => { tooltip.hidden = true; anchor = positionAnchor = null; };
  const place = () => {
    if (!positionAnchor) return;
    const position = positionAnchor.getBoundingClientRect();
    const { innerWidth, innerHeight } = app.win;
    if (!positionAnchor.isConnected || position.bottom < 0 || position.top > innerHeight) { hide(); return; }
    const { width, height } = tooltip.getBoundingClientRect();
    tooltip.style.left = Math.max(8, Math.min(position.left, innerWidth - width - 8)) + 'px';
    tooltip.style.top = Math.max(8, position.bottom + height <= innerHeight - 8 ? position.bottom : position.top - height) + 'px';
  };
  const show = (caption, field) => {
    anchor = caption;
    positionAnchor = field?.closest('label') || caption;
    tooltip.textContent = caption.dataset.settingHelp;
    tooltip.hidden = false;
    place();
  };
  app.panel.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const caption = event.target.closest?.(selector);
    if (caption && caption !== anchor) show(caption);
  });
  app.panel.addEventListener('pointerout', event => {
    if (!anchor || !anchor.contains(event.target) && !tooltip.contains(event.target)) return;
    const next = event.relatedTarget;
    if (!next?.nodeType || !anchor.contains(next) && !tooltip.contains(next)) hide();
  });
  app.panel.addEventListener('pointerdown', () => { pointerFocus = true; hide(); });
  app.panel.addEventListener('focusin', event => {
    if (pointerFocus) return;
    const field = event.target;
    const caption = helpCaptions.get(field) || (field.matches(selector) ? field : null);
    if (caption) show(caption, field);
  });
  app.panel.addEventListener('focusout', () => {
    if (anchor && !anchor.matches(':hover') && !tooltip.matches(':hover')) hide();
  });
  app.on(app.doc, 'keydown', event => {
    pointerFocus = false;
    if (event.key !== 'Escape' || tooltip.hidden || app.panel.hidden) return;
    event.preventDefault(); event.stopPropagation(); hide();
  }, true);
  app.on(app.win, 'scroll', place, true);
  app.on(app.win, 'resize', place);
  return hide;
}

// SPDX-License-Identifier: GPL-3.0-or-later

// The filtering engine supplies behavior; Companion owns every visible control.
const toolbarIcons = {
  brand: 'm12 2 10 6-10 6L2 8l10-6Zm-10 10 10 6 10-6M2 16l10 6 10-6',
  filters: 'M4 6h16M7 12h10m-7 6h4',
  searches: 'M6 4h12v16l-6-4-6 4V4Z',
  settings: 'M4 6h5m4 0h7M4 12h9m4 0h3M4 18h2m4 0h10M9 4v4m4 2v4m-7 2v4',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  grid: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z',
  add: 'M12 5v14M5 12h14',
  stop: 'M6 6h12v12H6z',
  open: 'M7 17 17 7M7 7h10v10',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z'
};

function companionIcon(app, name) {
  // Isolate the glyph from site themes that style or hide SVG elements.
  const icon = app.node('span', null, 'epc-icon');
  icon.setAttribute('aria-hidden', 'true');
  const svg = app.doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '1.65', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    focusable: 'false' })) svg.setAttribute(key, value);
  svg.style.display = 'block';
  const path = app.doc.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', toolbarIcons[name]); svg.append(path);
  icon.attachShadow({ mode: 'open' }).append(svg);
  return icon;
}

function toolbarPageName(url) {
  const { pathname, searchParams } = new URL(url);
  if (/^\/collage\//.test(pathname)) return 'Collage';
  if (pathname === '/torrents.php') return searchParams.has('id') ? 'Torrent details' : 'Search results';
  return ({ '/bookmarks.php': 'Bookmarks', '/collages.php': 'Collages', '/top10.php': 'Top 10',
    '/requests.php': 'Requests', '/user.php': 'Account' })[pathname] || '';
}

function optionGroup(app, parent, title, { key = '', open = false, searchable = false } = {}) {
  const section = app.node('details', null, 'epc-group epc-option-group'); section.open = open;
  const summary = setSettingHelp(app.node('summary'), settingGroupHelp[key]);
  summary.append(app.node('span', title), app.node('small', '', 'epc-option-count'));
  section.append(summary); parent.append(section);
  if (key) section.dataset.optionGroup = key;
  if (searchable) section.dataset.settingsGroup = title;
  return section;
}

function keyboardShortcutList(app) {
  const list = app.node('ul', null, 'epc-caption epc-shortcut-list');
  list.setAttribute('aria-label', 'Keyboard shortcuts');
  for (const [keys, action] of [
    ['Ctrl+S / Cmd+S', 'Save changes in Companion.'],
    ['P', 'Pin or unpin the open image preview.'],
    ['R', 'Retry loading the open image preview.'],
    ['Esc', 'Dismiss a preview, menu, or panel, or cancel a saved-search edit.'],
    ['Shift+F10 / Menu', 'Open the filter menu for the focused tag when tag menus are enabled.'],
    ['← / →', 'Go to the previous or next page when Arrow key pagination is enabled.'],
    ['Enter', 'Save from a text field in the saved-search editor or rename field.']
  ]) {
    const item = app.node('li');
    item.append(app.node('kbd', keys), ' ' + action);
    list.append(item);
  }
  return list;
}

function setupSettingsSearch(app) {
  const input = app.node('input'); input.type = 'search'; input.placeholder = 'Find a setting…';
  input.setAttribute('aria-label', 'Find a setting'); input.className = 'epc-settings-search';
  const status = app.node('p', '', 'epc-caption'); status.setAttribute('role', 'status'); status.hidden = true;
  const hint = app.node('p', 'Hover over a setting name or tab to its control for help.', 'epc-caption');
  app.panes.settings.prepend(input, status, hint); app.settingsSearch = input;
  const scope=app.panes.settings;
  let previous = null;
  input.addEventListener('input', () => {
    const query = input.value.trim().toLocaleLowerCase();
    if (query && !previous) previous = new Map([...scope.querySelectorAll('details')].map(group => [group, group.open]));
    let matches = 0;
    for (const group of scope.querySelectorAll('[data-settings-group]')) {
      const groupMatches = !!query && group.dataset.settingsGroup.toLocaleLowerCase().includes(query);
      const items = [...group.querySelectorAll('[data-option-item]')];
      let found = groupMatches;
      for (const item of items) {
        const match = !query || groupMatches || (item.textContent+' '+(item.getAttribute('aria-label')||'')).toLocaleLowerCase().includes(query);
        item.hidden = !match;
        if (query && match) { found = true; matches++; for (let node = item.parentElement; node && node !== scope; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true; }
      }
      group.hidden = !!query && !found;
      if (query && found) group.open = true;
    }
    if (!query && previous) { for (const [group, open] of previous) group.open = open; previous = null; }
    app.syncSettingsUI?.();
    status.hidden = !query;
    status.textContent = matches ? matches + (matches === 1 ? ' matching option' : ' matching options') :
      'No matching settings. Try “image”, “backfill”, or “color”.';
  });
}

function mountFilterControls(app) {
  if (app.filterControlsMounted || !app.engineReady) return;
  app.filterControlsMounted = true;
  const { doc } = app;
  const field = (parent, id, label, help = '') => {
    const control = doc.getElementById(id); if (!control) return;
    const row = app.node('label', null, 'epc-field' + (control.type === 'checkbox' ? ' epc-check' : ''));
    row.dataset.optionItem = '';
    control.className = ''; control.dataset.epFilterControl = ''; control.setAttribute('aria-label', label);
    if (control.tagName === 'TEXTAREA') control.rows = 3;
    const caption = setSettingHelp(app.node('span', label), settingHelp[id], control);
    if (control.type === 'checkbox') row.append(control, caption); else row.append(caption, control);
    if (help) row.append(app.node('small', help));
    parent.append(row); return control;
  };
  const bindings = [];
  const summarize = (section, read) => bindings.push([section.querySelector('.epc-option-count'), read]);
  const countList = (id, separator) => (doc.getElementById(id)?.value || '').split(separator).filter(s => s.trim()).length;
  const ruleCount = (ids, separator) => ids.reduce((sum, id) => sum + countList(id, separator), 0);
  const countText = count => count ? count + (count === 1 ? ' rule' : ' rules') : 'None';
  app.refreshOptionSummaries = () => {
    for (const [node, read] of bindings) node.textContent = read();
  };
  summarize(app.optionGroups.images, () => !app.controls.get('enabled').checked ? 'Off' :
    [!app.controls.get('inlineThumbnails').checked ? 'Thumbnails off' : '', !app.controls.get('previews').checked ? 'Hover off' : ''].filter(Boolean).join(' · '));
  summarize(app.optionGroups.results, () => app.controls.get('backfillEnabled').checked ?
    app.controls.get('backfillMode').value === 'all' ? 'All remaining pages on load' :
      (app.controls.get('backfillPages').value || app.settings.backfillPages) +
        (app.controls.get('backfillMode').value === 'pages' ? ' additional pages on load' : ' pages per manual batch') : 'Backfill off');
  app.panes.filters.replaceChildren(app.resultFilters.freeleechControl,
    app.node('p', 'Tag lists update as you type. Separate tags with spaces.', 'epc-caption'));
  const grid = app.node('div', null, 'epc-rule-grid'); app.panes.filters.append(grid);
  field(grid, 'nseBlacklistTaglistArea', 'Blocked tags');
  field(grid, 'nseWhitelistTaglistArea', 'Allowed tags', 'Allowed matches override ordinary blocks.');
  app.resultFilters.mountRules(app.panes.filters);
  app.resultFilters.mountHistory(app.panes.filters);
  const highlights = optionGroup(app, app.panes.filters, 'Tag highlights', { key: 'tag-highlights' });
  highlights.append(app.node('p', 'Favorites are green; caution tags are amber. Both keep visibility unchanged. Search tags are emphasized automatically. Right-click a tag for a quick choice.', 'epc-caption'));
  for (const [key, label] of [['favoriteTags', 'Favorite tags'], ['cautionTags', 'Caution tags']]) {
    const row = app.node('label', null, 'epc-field');
    const input = app.node('textarea'); input.rows = 2; input.maxLength = 50000; input.value = app.settings[key];
    input.dataset.setting = key; input.setAttribute('aria-label', label);
    row.append(setSettingHelp(app.node('span', label), settingHelp[key], input), input); highlights.append(row); app.controls.set(key, input);
  }
  const lowPriority = optionGroup(app, app.panes.filters, 'Collapse tags on detail pages', { key: 'collapsed-detail-tags' });
  const lowPriorityField = app.node('label', null, 'epc-field');
  const lowPriorityInput = app.node('textarea'); lowPriorityInput.rows = 2; lowPriorityInput.maxLength = 50000;
  lowPriorityInput.value = app.settings.collapsedDetailTags; lowPriorityInput.dataset.setting = 'collapsedDetailTags';
  lowPriorityField.append(setSettingHelp(app.node('span', 'Low-priority tags'), settingHelp.collapsedDetailTags, lowPriorityInput), lowPriorityInput);
  lowPriority.append(app.node('p', 'Matching tags stay available under Show other tags on detail pages.', 'epc-caption'), lowPriorityField);
  app.controls.set('collapsedDetailTags', lowPriorityInput);
  summarize(highlights, () => {
    const count = key => app.controls.get(key).value.trim().split(/\s+/).filter(Boolean).length;
    const favorite = count('favoriteTags'), caution = count('cautionTags');
    return favorite || caution ? favorite + (favorite === 1 ? ' favorite' : ' favorites') + ' · ' + caution + ' caution' : 'Search matches automatically';
  });
  for (const [title, hint, ids, separator] of [
    ['Title rules', 'Hide or allow results by words in their titles. Separate phrases with semicolons.', [['nseBlacklistTitleListArea', 'Blocked title phrases'], ['nseWhitelistTitleListArea', 'Allowed title phrases']], ';'],
    ['Uploader rules', 'Separate usernames with spaces.', [['nseBlacklistUploadersArea', 'Blocked uploaders'], ['nseWhitelistUploadersArea', 'Allowed uploaders']], /\s+/]
  ]) {
    const section = optionGroup(app, app.panes.filters, title, { key: title });
    section.append(app.node('p', hint, 'epc-caption'));
    for (const [id, label] of ids) field(section, id, label);
    summarize(section, () => countText(ruleCount(ids.map(([id]) => id), separator)));
  }
  const hardPass = optionGroup(app, app.panes.filters, 'Hard Pass', { key: 'hard-pass' });
  hardPass.append(app.node('p', 'Always hide matching results, including allowed matches.', 'epc-caption'));
  field(hardPass, 'nseCheckHardPassEnabled', 'Enable Hard Pass');
  field(hardPass, 'nseHardPassTaglistArea', 'Hard Pass tags');
  field(hardPass, 'nseHardPassTitleListArea', 'Hard Pass title phrases');
  field(hardPass, 'nseCheckRemoveHardPassResults', 'Remove Hard Pass results completely');
  summarize(hardPass, () => doc.getElementById('nseCheckHardPassEnabled').checked ?
    countText(countList('nseHardPassTaglistArea', /\s+/) + countList('nseHardPassTitleListArea', ';')) : 'Off');
  const rules = optionGroup(app, app.panes.filters, 'Hide by status', { key: 'status' });
  const checks = app.node('div', null, 'epc-check-grid'); rules.append(checks);
  for (const [id, label] of [
    ['nseCheckHideAnonUploads', 'Hide anonymous uploads'], ['nseCheckHideReported', 'Hide reported results'],
    ['nseCheckHideWarned', 'Hide warned results'], ['nseCheckHideUnseeded', 'Hide unseeded results'],
    ['nseCheckHideGrabbed', 'Hide grabbed results'], ['nseCheckHideLeeching', 'Hide leeching results'],
    ['nseCheckHideSeeding', 'Hide seeding results'], ['nseCheckHideSnatched', 'Hide snatched results'],
    ['nseCheckHideBookmarked', 'Hide bookmarked results'], ['nseCheckBypassWhitelists', 'Activity filters override allowed matches']
  ]) field(checks, id, label);
  summarize(rules, () => { const count = rules.querySelectorAll('input:checked').length; return count ? count + ' enabled' : 'Off'; });
  field(app.basicAppearance, 'nseThemeDropdown', 'Color theme');
  const appearance = app.optionGroups.appearance;
  for (const [id, label] of [['nseUIFont', 'Interface font'],
    ['nseTextAreaFont', 'List font'], ['nseBlacklistColor', 'Blocked highlight'],
    ['nseHardPassColor', 'Hard Pass highlight'], ['nseWhitelistColor', 'Allowed highlight']]) field(appearance, id, label);
  const colors = app.node('details');
  colors.append(setSettingHelp(app.node('summary', 'Custom theme colors'), 'Set these colors, then select Custom under Color theme to use them.'));
  appearance.append(colors);
  for (const [id, label] of [['nseCustomThemeBgCol', 'Background'], ['nseCustomThemeBgHighCol', 'Hover background'],
    ['nseCustomThemeForeCol', 'Text'], ['nseCustomThemeAccentCol', 'Accent'], ['nseCustomThemeHighCol', 'Highlight'],
    ['nseCustomThemeHiddenBgCol', 'Filtered row background']]) field(colors, id, label);
  const interaction = app.optionGroups.interaction, extras = app.optionGroups.extras, results = app.optionGroups.results;
  for (const [parent, rows] of [
    [interaction, [['nseCheckIndividualHide', 'Individual result visibility'], ['nseCheckRightClickManagementEnabled', 'Right-click tag and uploader rules'],
      ['nseCheckRCMTagsEnabled', 'Edit tag rules from results'],
      ['nseCheckRCMUploadersEnabled', 'Edit uploader rules from results'], ['nseCheckScrollToNSEEnabled', 'Scroll to Companion on page load']]],
    [results, [['nseCheckFilterAllButtonEnabled', 'Hide visible results action'], ['nseCheckFloatingToggleButton', 'Quick visibility control'],
      ['nseCheckOpenAllButton', 'Open visible results action'], ['nseCheckOpenAllGoNext', 'Advance after opening visible results']]],
    [appearance, [['nseCheckHideCategoryIcons', 'Remove the category column'], ['nseCheckObliviousMode', 'Hide result tags'],
      ['nseCheckCustomCSS', 'Enable custom CSS']]],
    [extras, [['nseCheckEmojiEnabled', 'Decorative icons'], ['nseCheckUpdateToasts', 'Version notices'],
      ['nseCheckRenumberTorrents', 'Renumber Top 10 results'], ['nseCheckRussianRouletteMode', 'Random filtering mode'],
      ['nseCheckApril1stAllYear', 'Decorative April 1 mode']]]
  ]) for (const [id, label] of rows) field(parent, id, label);
  summarize(extras, () => doc.getElementById('nseCheckRussianRouletteMode').checked ? 'Random filtering enabled' : '');
  field(appearance, 'nseCustomCSSArea', 'Custom CSS');
  field(app.optionGroups.loading, 'nseTimeout', 'Compatibility delay (ms)');
  const batch = optionGroup(app, app.panes.filters, 'Bulk actions', { key: 'bulk' });
  const actions = app.node('div', null, 'epc-actions'); batch.append(actions);
  app.openVisibleAction = app.button('Open visible results', () => app.options.openVisible?.());
  app.hideVisibleAction = app.button('Hide visible results', () => app.options.hideVisible?.());
  setSettingHelp(app.openVisibleAction, 'Open eligible visible results in separate tabs. Your browser may ask you to allow pop-ups.');
  setSettingHelp(app.hideVisibleAction, 'Save individual hide exceptions for the visible results. You’ll be asked to confirm first.');
  actions.append(app.openVisibleAction, app.hideVisibleAction); app.syncFilterActions();
  const info = optionGroup(app, app.advancedSettings, 'Statistics & credits', { searchable: true });
  const stats = app.node('dl', null, 'epc-statistics');
  const count = (id, separator) => (doc.getElementById(id)?.value || '').split(separator).filter(s => s.trim()).length;
  for (const [label, id, separator] of [
    ['Blocked tags', 'nseBlacklistTaglistArea', /\s+/], ['Allowed tags', 'nseWhitelistTaglistArea', /\s+/],
    ['Hard Pass tags', 'nseHardPassTaglistArea', /\s+/], ['Blocked title phrases', 'nseBlacklistTitleListArea', ';'],
    ['Allowed title phrases', 'nseWhitelistTitleListArea', ';'], ['Hard Pass title phrases', 'nseHardPassTitleListArea', ';'],
    ['Blocked uploaders', 'nseBlacklistUploadersArea', /\s+/], ['Allowed uploaders', 'nseWhitelistUploadersArea', /\s+/]
  ]) stats.append(app.node('dt', label), app.node('dd', String(count(id, separator))));
  for (const [label, key] of [['Individually hidden', 'nseIndividualUploadHidingBlacklist'], ['Individually allowed', 'nseIndividualUploadHidingWhitelist']]) {
    stats.append(app.node('dt', label), app.node('dd', String(app.storage.get(key, []).length)));
  }
  const data = Object.fromEntries(app.storage.list().filter(key => key.startsWith('nse')).map(key => [key, app.storage.get(key)]));
  stats.append(app.node('dt', 'Stored filter data'), app.node('dd', Math.ceil(JSON.stringify(data).length / 1024) + ' KiB'));
  const credit = app.node('p', 'Filtering engine: NoShitEmpornium 2.8.2 by ceodoe. Backfill contributed by mc-hamster. GPL-3.0-or-later. Companion provides the interface, media loader, and search library.', 'epc-caption');
  credit.dataset.epAttribution = '';
  info.append(stats, credit);
  const reset = app.button('Reset filter preferences', () => doc.getElementById('nseEraseDataButton')?.click());
  setSettingHelp(reset, 'Clear filter lists, visibility exceptions, and filter preferences after confirmation. Your saved searches and image preferences stay available.');
  reset.dataset.optionItem = ''; info.append(reset);
  app.refreshOptionSummaries();
}

function adoptRuleMenu(app, event, kind, value = '') {
  const menu = app.doc.getElementById('nseRCMBox'); if (!menu) return;
  app.ruleMenuOrigin = event.target.closest?.('a') || event.target;
  menu.dataset.epRuleKind = kind || '';
  menu.classList.add('epc-root'); menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Edit filter rule');
  const close = menu.querySelector('#nseRCMClose');
  if (close) {
    close.textContent = 'Close'; close.setAttribute('role', 'button'); close.tabIndex = 0;
    close.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close.click(); } };
  }
  for (const item of menu.querySelectorAll('.nseRCMButton')) {
    item.textContent = item.textContent.replace(/^[+−➕➖-]\s*/, '').replace(/(?:Add|Move) to blacklist/i, 'Block tag')
      .replace(/(?:Add|Move) to whitelist/i, 'Allow tag').replace(/Remove from blacklist/i, 'Remove block')
      .replace(/Remove from whitelist/i, 'Remove allow rule');
    item.setAttribute('role', 'button'); item.tabIndex = 0;
    item.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click(); } };
    item.addEventListener('click', () => {
      app.toast('Filter rule saved. Results updated.');
    }, { once: true });
  }
  const footer = menu.querySelector(':scope > p:not([id])');
  if (footer) { footer.textContent = 'Rules save and update your results automatically.'; footer.hidden = kind === 'tag'; }
  app.tags.menu(menu, kind, value);
  menu.querySelector('.epc-uploader-rule')?.remove();
  if (kind === 'tag') {
    const info = menu.querySelector('#nseRCMBoxInfoText'), tag = menu.querySelector('#nseRCMBoxTag');
    if (info && tag) {
      const status = app.node('span', 'Visibility rules', 'epc-caption epc-menu-caption');
      info.replaceChildren(app.node('strong', 'Tag: '), tag, status);
    }
    const row = app.ruleMenuOrigin.closest?.('tr.torrent');
    const uploader = row?.querySelector(app.win.location.pathname === '/top10.php' ? 'td:nth-child(10) > a' : 'td.user > a')
      ?.textContent.trim();
    const tagName = app.ruleMenuOrigin.textContent.trim();
    if (uploader && tagName && !/[{}\r\n]/.test(uploader + tagName)) {
      const rule = app.button('Hide this tag for ' + uploader, () => app.resultFilters.addTagRule(tagName, uploader));
      rule.className = 'epc-uploader-rule'; menu.append(rule);
    }
  }
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.max(12, Math.min(event.clientX, app.win.innerWidth - rect.width - 12)) + 'px';
  menu.style.top = Math.max(12, Math.min(event.clientY, app.win.innerHeight - rect.height - 12)) + 'px';
}

function styleRowControls(app, roots = [app.doc]) {
  app.rowKeys ||= new WeakSet();
  for (const root of roots) for (const icon of root.querySelectorAll('.nseToggleIcon')) {
    const row = icon.closest('tr'); const hidden = row?.getAttribute('isNSEHidden') === '1';
    const label = hidden ? 'Always show this result' : 'Hide this result';
    icon.setAttribute('role', 'button'); icon.setAttribute('aria-label', label);
    icon.title = icon.matches('.nseIndividuallyWhitelisted,.nseIndividuallyBlacklisted') ? label + ' · Right-click to reset the exception' : label;
    icon.tabIndex = 0;
    if (!app.rowKeys.has(icon)) {
      app.rowKeys.add(icon);
      icon.addEventListener('keydown', e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); icon.click(); } });
    }
  }
}

function adoptNotificationControls(app) {
  for (const button of app.doc.querySelectorAll('[id^="nseImportListButton"]')) {
    const allowed = button.textContent.includes('whitelist');
    const container = button.parentNode;
    container.classList.add('epc-root', 'epc-notification-control');
    button.className = 'epc-rule-import'; button.setAttribute('role', 'button'); button.tabIndex = 0;
    button.textContent = allowed ? 'Use allowed tag rules' : 'Use blocked tag rules';
    container.onclick = () => {
      const field = container.parentNode.parentNode.querySelector('textarea.long');
      if (!field) return;
      const get = id => app.doc.getElementById(id)?.value.trim() || '';
      field.value = allowed ? get('nseWhitelistTaglistArea') :
        [app.doc.getElementById('nseCheckHardPassEnabled')?.checked ? get('nseHardPassTaglistArea') : '',
          get('nseBlacklistTaglistArea')].filter(Boolean).join(' ');
      field.dispatchEvent(new app.win.Event('input', { bubbles: true }));
      field.dispatchEvent(new app.win.Event('change', { bubbles: true }));
      app.toast('Tag rules copied. Save the notification form on the site to apply them.');
    };
    button.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); button.click(); } };
  }
}

function applyWorkspaceTheme(app, roots = [app.root, app.backfill?.footer, app.preview?.element, app.onboarding?.element,
  app.doc.getElementById('nseRCMBox'), ...app.doc.querySelectorAll('.epc-notification-control,.epc-search-feedback,.epc-media-retry')]) {
  const selected = app.storage.get('nseSelectedTheme', null);
  const palettes = {
    nseThemeLegacy: ['#23395a', '#eef4ff', '#91c5ff', '#526b8e'],
    nseThemeEdgy: ['#19171c', '#ffe8eb', '#ff7f9a', '#664454'],
    nseThemeBaked: ['#202b23', '#e5f4d9', '#c9a7ff', '#53674c'],
    nseThemeDarkPurple: ['#241e31', '#ede8ff', '#c6b0ff', '#5d4d79']
  };
  let colors = palettes[selected];
  if (selected === 'nseThemeCustom') {
    const theme = app.storage.get('nseCustomTheme', {});
    colors = [theme.backgroundColor, theme.foregroundColor, theme.accentColor, theme.highlightColor];
  }
  for (const root of roots.filter(Boolean)) {
    ['--epc-bg', '--epc-fg', '--epc-accent', '--epc-line'].forEach((key, i) => {
      if (colors?.[i]) root.style.setProperty(key, colors[i]);
      else root.style.removeProperty(key);
    });
    root.style.colorScheme = palettes[selected] ? 'dark' : '';
    const font = app.storage.get('nseUIFont', null);
    root.style.fontFamily = font && /^[\w\s,'".-]{1,200}$/.test(font) ? font : '';
    const listFont = app.storage.get('nseTextAreaFont', null);
    if (listFont && /^[\w\s,'".-]{1,200}$/.test(listFont)) root.style.setProperty('--epc-list-font', listFont);
    else root.style.removeProperty('--epc-list-font');
  }
}

// SPDX-License-Identifier: GPL-3.0-or-later
const CONDITIONAL_RULE_LIMIT = 20000;

function compileCondition(source) {
  const pattern = /\s*(?:\$(TA|TI|UP)\{([^{}]+)\}|(AND|OR|NOT)\b|([()]))/iy;
  const tokens = [];
  while (pattern.lastIndex < source.length) {
    const match = pattern.exec(source);
    if (!match) throw new Error('Expected a tag, title, uploader, or logical operator.');
    const [, selector, value, operator, paren] = match;
    if (selector && !value.trim()) throw new Error('A selector needs a value between braces.');
    tokens.push(selector ? { selector: selector.toUpperCase(), value: value.trim(), key: value.trim().toLocaleLowerCase() } :
      operator?.toUpperCase() || paren);
    if (tokens.length > 128) throw new Error('Split this expression into smaller rules.');
  }

  let index = 0;
  const take = token => {
    if (tokens[index] !== token) return false;
    index++;
    return true;
  };
  function term() {
    if (take('NOT')) {
      const test = term();
      return row => !test(row);
    }
    if (take('(')) {
      const test = expression();
      if (!take(')')) throw new Error('Missing a closing parenthesis.');
      return test;
    }
    const atom = tokens[index++];
    if (typeof atom !== 'object') throw new Error('Expected a selector or an opening parenthesis.');
    if (atom.selector === 'TA') return row => row.tags.has(atom.key);
    if (atom.selector === 'UP') return row => row.uploader === atom.key;
    return row => row.title.includes(atom.key);
  }
  function conjunction() {
    const tests = [term()];
    while (take('AND')) tests.push(term());
    return row => tests.every(test => test(row));
  }
  function expression() {
    const tests = [conjunction()];
    while (take('OR')) tests.push(conjunction());
    return row => tests.some(test => test(row));
  }
  const test = expression();
  if (index !== tokens.length) throw new Error('Expected AND or OR between conditions.');
  return { test, tokens };
}

function compileConditionalRules(text) {
  if (text.length > CONDITIONAL_RULE_LIMIT) throw new Error('Conditional rules exceed 20,000 characters.');
  const rules = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    try {
      const match = /^(HIDE|SHOW|PASS)\s*:\s*(.+)$/i.exec(line);
      if (!match) throw new Error('Start with HIDE, SHOW, or PASS followed by a colon and a condition.');
      rules.push({ action: match[1].toUpperCase(), line: index, ...compileCondition(match[2]) });
    } catch (error) {
      throw new Error('Line ' + (index + 1) + ' · ' + error.message);
    }
  }
  return rules;
}

// SPDX-License-Identifier: GPL-3.0-or-later

const RULE_ACTIONS = [
  ['HIDE', 'Hide matching results', 'Hide'],
  ['SHOW', 'Allow matching results', 'Allow'],
  ['PASS', 'Hard Pass (overrides allow rules)', 'Hard Pass']
];
const RULE_FIELDS = {
  TA: { positive: 'Has tag', negative: 'Lacks tag', label: 'Tag', example: 'e.g. example.tag',
    describe: (value, negated) => 'tag ' + value + (negated ? ' is absent' : ' is present') },
  TI: { positive: 'Title contains', negative: 'Title does not contain', label: 'Title text', example: 'e.g. collection',
    describe: (value, negated) => 'title ' + (negated ? 'does not contain ' : 'contains ') + value },
  UP: { positive: 'Uploaded by', negative: 'Uploader is different from', label: 'Uploader name', example: 'e.g. example-user',
    describe: (value, negated) => 'uploader is ' + (negated ? 'different from ' : '') + value }
};
const RULE_MATCHES = Object.entries(RULE_FIELDS).flatMap(([key, field]) => [[key, field.positive], ['!' + key, field.negative]]);

function ruleSelect(app, title, options, help) {
  const field = app.node('label', null, 'epc-field'), select = app.node('select');
  for (const [value, text] of options) {
    const option = app.node('option', text); option.value = value; select.append(option);
  }
  field.append(setSettingHelp(app.node('span', title), help, select), select);
  return { field, select };
}

function describeRule(rule) {
  const action = RULE_ACTIONS.find(([key]) => key === rule.action)[2];
  const conditions = rule.tokens.map((token, index, tokens) => {
    if (typeof token === 'string') return token === 'NOT' && typeof tokens[index + 1] === 'object' ? '' : token.toLowerCase();
    return RULE_FIELDS[token.selector].describe('“' + token.value + '”', tokens[index - 1] === 'NOT');
  });
  return action + ' when ' + conditions.filter(Boolean).join(' ');
}

// The form represents flat AND/OR rules. Grouped expressions remain editable as text.
function editableRule(tokens) {
  const conditions = [];
  let join = 'AND';
  for (let i = 0; i < tokens.length;) {
    const negated = tokens[i] === 'NOT';
    if (negated) i++;
    const token = tokens[i++];
    if (typeof token !== 'object') return null;
    conditions.push({ match: (negated ? '!' : '') + token.selector, value: token.value });
    if (i === tokens.length) break;
    const next = tokens[i++];
    if (!['AND', 'OR'].includes(next) || conditions.length > 1 && next !== join) return null;
    join = next;
  }
  return { conditions, join };
}

class ConditionalRuleEditor {
  constructor(app, parent) {
    this.app = app;
    const section = this.section = optionGroup(app, parent, 'Conditional rules', { key: 'conditional-rules' });
    this.count = section.querySelector('.epc-option-count');
    this.catalog = app.node('div');
    this.list = app.node('ul', null, 'epc-conditional-list');
    this.empty = app.node('p', 'No conditional rules yet.', 'epc-caption');
    this.add = app.button('Add a rule', () => this.openBuilder());
    this.add.classList.add('epc-primary');
    this.catalog.append(this.empty, this.list, this.add);

    this.builder = app.node('div', null, 'epc-conditional-builder');
    this.builder.hidden = true;
    this.heading = app.node('h3');
    const action = ruleSelect(app, 'When conditions match', RULE_ACTIONS,
      'Choose Hide, Allow, or Hard Pass. Hard Pass takes priority over ordinary Allow rules.');
    const match = ruleSelect(app, 'Match results that meet', [['AND', 'Every condition'], ['OR', 'Any condition']],
      'Every condition requires all checks to match. Any condition lets one matching check trigger the rule.');
    this.action = action.select; this.join = match.select; this.joinField = match.field;
    this.rows = app.node('div');
    this.addCondition = app.button('Add condition', () => this.appendCondition().focus());
    this.builderStatus = app.node('p', '', 'epc-caption');
    this.builderStatus.setAttribute('role', 'status');
    const controls = app.node('div', null, 'epc-actions');
    const save = app.button('Save rule', () => this.saveBuilder()); save.classList.add('epc-primary');
    controls.append(this.addCondition, save, app.button('Cancel', () => this.closeBuilder()));
    this.builder.append(this.heading, action.field, this.rows, match.field, controls, this.builderStatus);

    const raw = this.rawSection = app.node('details', null, 'epc-conditional-advanced');
    this.raw = app.node('textarea');
    this.raw.rows = 5; this.raw.maxLength = CONDITIONAL_RULE_LIMIT; this.raw.spellcheck = false;
    this.rawStatus = app.node('p', '', 'epc-caption'); this.rawStatus.setAttribute('role', 'status');
    this.rawStatus.id = 'epc-conditional-status';
    this.raw.setAttribute('aria-describedby', this.rawStatus.id);
    const label = app.node('label', null, 'epc-field');
    label.append(setSettingHelp(app.node('span', 'Rule text'),
      'Enter one rule per line. Use $TA for a tag, $TI for a title phrase, or $UP for an uploader, and apply the text to save it.', this.raw), this.raw);
    this.applyText = app.button('Apply rule text', () => this.saveText(this.raw.value));
    this.discardText = app.button('Discard draft', () => { this.raw.value = this.source; this.validateText(); });
    const rawControls = app.node('div', null, 'epc-actions');
    rawControls.append(this.applyText, this.discardText);
    raw.append(setSettingHelp(app.node('summary', 'Advanced rule text'), 'Edit multiple rules together or use parentheses to group conditions.'),
      app.node('p', 'Enter one rule per line. Use AND, OR, NOT, and parentheses to group conditions.', 'epc-caption'),
      app.node('code', 'HIDE: $UP{uploader} AND NOT ($TA{favorite.tag} OR $TI{collection})'), label, this.rawStatus, rawControls);
    this.raw.addEventListener('input', () => this.validateText());
    section.append(app.node('p', 'Combine tags, title text, and uploaders in one filter.', 'epc-caption'), this.catalog, this.builder, raw);
    section.addEventListener('toggle', () => { if (section.open && !this.list.hasChildNodes()) this.renderRules(); });
    this.refresh();
  }
  refresh() {
    const source = this.app.settings.conditionalRules;
    if (source === this.source) return;
    this.source = source;
    this.raw.value = source;
    this.list.replaceChildren();
    try { this.rules = compileConditionalRules(source); }
    catch { this.rules = []; this.rawSection.open = true; }
    this.count.textContent = this.rules.length ? this.rules.length + ' active' : 'None';
    this.empty.hidden = this.rules.length > 0;
    if (this.section.open) this.renderRules();
    this.validateText();
  }
  renderRules() {
    for (const [index, rule] of this.rules.entries()) {
      const item = this.app.node('li'), edit = this.app.button('Edit', () => this.openBuilder(rule, edit), 'Edit rule ' + (index + 1));
      const remove = this.app.button('Remove', () => {
        if (!this.savedDraft()) return;
        if (this.saveText(this.replaceLine(rule.line))) this.add.focus();
      }, 'Remove rule ' + (index + 1));
      const actions = this.app.node('div', null, 'epc-actions'); actions.append(edit, remove);
      item.append(this.app.node('span', describeRule(rule)), actions); this.list.append(item);
    }
  }
  validateText() {
    const changed = this.raw.value !== this.source;
    this.discardText.disabled = !changed;
    this.applyText.disabled = true;
    try {
      compileConditionalRules(this.raw.value);
      this.raw.removeAttribute('aria-invalid');
      this.rawStatus.textContent = changed ? 'Ready to apply.' : '';
      this.applyText.disabled = !changed;
    } catch (error) {
      this.raw.setAttribute('aria-invalid', 'true');
      this.rawStatus.textContent = error.message;
    }
  }
  savedDraft() {
    if (this.raw.value === this.source) return true;
    this.section.open = this.rawSection.open = true;
    this.raw.focus();
    this.app.toast('Apply or discard the advanced rule draft first.');
    return false;
  }
  openBuilder(rule, opener = this.add) {
    if (!this.savedDraft()) return;
    const draft = rule && editableRule(rule.tokens);
    if (rule && !draft) {
      this.rawSection.open = true;
      this.raw.focus();
      const lines = this.source.split('\n'), start = lines.slice(0, rule.line).join('\n').length + (rule.line ? 1 : 0);
      this.raw.setSelectionRange(start, start + lines[rule.line].length);
      return;
    }
    this.opener = opener; this.editing = rule && { line: rule.line, source: this.source };
    this.heading.textContent = rule ? 'Edit rule' : 'New rule';
    this.action.value = rule?.action || 'HIDE';
    this.join.value = draft?.join || 'AND';
    this.rows.replaceChildren(); this.builderStatus.textContent = '';
    this.builder.hidden = false; this.catalog.hidden = this.rawSection.hidden = true;
    for (const condition of draft?.conditions || [{}]) this.appendCondition(condition);
    this.rows.querySelector('input').focus();
  }
  appendCondition({ match = 'TA', value = '' } = {}) {
    const row = this.app.node('div', null, 'epc-conditional-row');
    const condition = ruleSelect(this.app, 'Condition', RULE_MATCHES,
      'Pick what to match on this result, or choose a negative condition to match when the value is absent.');
    condition.select.value = match;
    const label = this.app.node('label', null, 'epc-field'), caption = this.app.node('span');
    const input = this.app.node('input'); input.type = 'text'; input.value = value;
    const sync = () => {
      const field = RULE_FIELDS[condition.select.value.replace('!', '')];
      caption.textContent = field.label;
      input.placeholder = field.example;
      setSettingHelp(caption, 'Enter the ' + field.label.toLowerCase() + ' to check. ' + field.example, input);
    };
    condition.select.addEventListener('change', sync); sync();
    input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
    label.append(caption, input);
    const remove = this.app.button('Remove condition', () => {
      row.remove(); this.syncConditions(); this.addCondition.focus();
    });
    row.append(condition.field, label, remove); this.rows.append(row);
    this.syncConditions();
    return input;
  }
  syncConditions() {
    const multiple = this.rows.children.length > 1;
    this.joinField.hidden = !multiple;
    for (const [index, row] of [...this.rows.children].entries()) {
      const label = row.querySelector('select').closest('label').firstChild;
      label.textContent = multiple ? 'Condition ' + (index + 1) : 'Condition';
      const remove = row.querySelector('button'); remove.hidden = !multiple;
      remove.setAttribute('aria-label', 'Remove condition ' + (index + 1));
    }
  }
  saveBuilder() {
    const parts = [];
    for (const row of this.rows.children) {
      const input = row.querySelector('input'), value = input.value.trim(), match = row.querySelector('select').value;
      if (!value || /[{}\r\n]/.test(value)) {
        this.builderStatus.textContent = value ? 'Use text without braces.' : 'Enter text for this condition.';
        input.setAttribute('aria-invalid', 'true'); input.focus(); return;
      }
      const atom = '$' + match.replace('!', '') + '{' + value + '}';
      parts.push(match.startsWith('!') ? 'NOT ' + atom : atom);
    }
    const line = this.action.value + ': ' + parts.join(' ' + this.join.value + ' ');
    if (this.editing && this.editing.source !== this.source) {
      this.builderStatus.textContent = 'The saved rules changed. Reopen this rule to edit the latest version.'; return;
    }
    const text = this.editing ? this.replaceLine(this.editing.line, line) : [this.source.trimEnd(), line].filter(Boolean).join('\n');
    if (this.saveText(text, this.builderStatus)) this.closeBuilder();
  }
  replaceLine(index, value) {
    const lines = this.source.split('\n');
    lines.splice(index, 1, ...(value ? [value] : []));
    return lines.join('\n');
  }
  saveText(text, status = this.rawStatus) {
    try { compileConditionalRules(text); }
    catch (error) { status.textContent = error.message; return false; }
    if (this.app.preferences.flush(text)) return true;
    status.textContent = 'Could not apply the rules. Your draft is still here.';
    return false;
  }
  addTagRule(tag, uploader) {
    if (!this.savedDraft()) return false;
    const line = 'HIDE: $TA{' + tag + '} AND $UP{' + uploader + '}';
    if (this.source.split('\n').some(rule => rule.trim().toLocaleLowerCase() === line.toLocaleLowerCase())) return true;
    return this.saveText([this.source.trimEnd(), line].filter(Boolean).join('\n'));
  }
  closeBuilder() {
    this.builder.hidden = true; this.catalog.hidden = this.rawSection.hidden = false;
    (this.opener?.isConnected ? this.opener : this.add).focus();
  }
}

// SPDX-License-Identifier: GPL-3.0-or-later

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

class ResultFilters {
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

// SPDX-License-Identifier: GPL-3.0-or-later

const legacyLuminanceGroups = new Map([
  ['good', '1a'], ['loved', '1b'], ['performer', '2a'], ['loveperf', '2b'],
  ['newperf', '3a'], ['amateur', '4a'], ['loveamat', '4b'], ['maleperf', '5a'],
  ['lovemale', '5b'], ['likesite', '6a'], ['lovesite', '6b'], ['disliked', '7a'],
  ['hated', '7b'], ['terrible', '7c'], ['useless', '7d']
]);
const luminanceNames = new Map([
  ['1a', 'Liked'], ['1b', 'Loved'], ['2a', 'Performer'], ['2b', 'Loved Performer'],
  ['3a', 'New Performer'], ['3b', 'Loved New Performer'], ['4a', 'Amateur'],
  ['4b', 'Loved Amateur'], ['5a', 'Male Performer'], ['5b', 'Loved Male Performer'],
  ['6a', 'Liked Site'], ['6b', 'Loved Site'], ['7a', 'Disliked'], ['7b', 'Hated'],
  ['7c', 'Blacklisted'], ['7d', 'Useless']
]);
const luminanceWeights = new Map([['verygood', 2], ['good', 1], ['ignore', 0], ['bad', -1], ['verybad', -2]]);
const luminanceDestinations = { favorite: 'Favorite', caution: 'Caution', block: 'Block', collapse: 'Collapse on details', skip: 'Skip' };
const importTagSet = value => new Set(String(value || '').toLocaleLowerCase().split(/\s+/).filter(Boolean));

function readLuminanceExport(text) {
  if (text.length > 8 * 1024 * 1024) throw new Error('The backup is too large (maximum 8 MiB).');
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('Paste the JSON from Luminance’s Export Settings box.'); }
  if (!data?.tags || typeof data.tags !== 'object' || Array.isArray(data.tags)) {
    throw new Error('This export does not contain Luminance tag groups.');
  }
  const groups = [];
  for (const [key, values] of Object.entries(data.tags)) {
    const id = /^Tags([1-6][abc]|7[abcd])$/.exec(key)?.[1] || legacyLuminanceGroups.get(key);
    if (!id) continue;
    const modernKey = 'Tags' + id;
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) {
      throw new Error('Invalid tag list in ' + key + '.');
    }
    const tags = new Set();
    for (const value of values) {
      const tag = value.trim().replace(/^📸+\s*/u, '').toLocaleLowerCase();
      if (!tag) continue;
      if (/\s|[\u0000-\u001f\u007f]/u.test(tag)) throw new Error('A tag in ' + key + ' contains spaces or control characters.');
      tags.add(tag);
    }
    if (!tags.size) continue;
    const legacyFlag = 'use' + key[0].toUpperCase() + key.slice(1) + 'Tags';
    const enabled = (data['useTag' + id + 'Tags'] ?? data[legacyFlag]) === true;
    const hiding = id === '7c' && (data.hideTags7cTorrents ?? data.hideTerribleTorrents ?? true) === true;
    const rawWeight = data.tagValues?.[modernKey] ?? data.tagValues?.[key];
    const weight = typeof rawWeight === 'number' ? rawWeight : luminanceWeights.get(rawWeight) ??
      (rawWeight == null ? id[0] === '7' ? -1 : id.endsWith('c') ? 0 : 1 : 0);
    const destination = !enabled || hiding || id === '7d' ? 'skip' : id === '7c' || weight < 0 ? 'caution' :
      weight > 0 ? 'favorite' : 'skip';
    const savedName = data.names?.[key] ?? data.names?.[modernKey];
    const name = typeof savedName === 'string' && savedName.trim() ? savedName.trim().slice(0, 100) : luminanceNames.get(id) || modernKey;
    const note = !enabled ? 'Disabled in Luminance' : hiding ? 'Hid results in Luminance. Choose Block to apply result filtering.' :
      id === '7d' ? 'Collapse on details keeps the tags available under Show other tags on detail pages.' : '';
    groups.push({ id, name, tags: [...tags], destination, note });
  }
  if (!groups.length) throw new Error('No supported Luminance tags were found in this export.');
  return groups;
}

function planLuminanceImport(groups, choices, settings, nse) {
  const current = {
    favorite: importTagSet(settings.favoriteTags), caution: importTagSet(settings.cautionTags),
    block: importTagSet(nse.nseTaglist), collapse: importTagSet(settings.collapsedDetailTags)
  };
  const allow = importTagSet(nse.nseWhitelist), hardPass = importTagSet(nse.nseHardPassTaglist);
  const requested = { favorite: new Set(), caution: new Set(), block: new Set(), collapse: new Set() };
  for (const [index, group] of groups.entries()) {
    const target = Object.hasOwn(requested, choices[index]) && requested[choices[index]];
    if (target) for (const tag of group.tags) target.add(tag);
  }
  const added = { favorite: [], caution: [], block: [], collapse: [] }, conflicts = new Set();
  for (const [kind, tags] of Object.entries(requested)) for (const tag of tags) {
    if (current[kind].has(tag)) continue;
    const opposite = kind === 'favorite' ? 'caution' : 'favorite';
    if (kind === 'block' ? allow.has(tag) || hardPass.has(tag) :
      kind !== 'collapse' && (current[opposite].has(tag) || requested[opposite].has(tag))) {
      conflicts.add(tag); continue;
    }
    added[kind].push(tag);
  }
  return { added, conflicts: [...conflicts] };
}

function mountLuminanceImport(app, parent) {
  const panel = app.node('details', null, 'epc-luminance-import');
  panel.dataset.optionItem = '';
  panel.append(setSettingHelp(app.node('summary', 'Import from Luminance'),
    'Bring your tag lists into Companion. You can review what each group will do before anything is applied.'));
  panel.append(app.node('p', 'Copy the JSON from LTH → Import/Export → Export Settings, or choose your saved export.', 'epc-caption'));
  const input = app.node('textarea'); input.rows = 3;
  input.setAttribute('aria-label', 'Luminance export JSON');
  const inputLabel = app.node('label', null, 'epc-field');
  inputLabel.append(setSettingHelp(app.node('span', 'Luminance export JSON'),
    'Paste the settings export you copied from Luminance. Preview import reads the tag groups and shows their suggested destinations.', input), input);
  const file = app.node('input'); file.type = 'file'; file.accept = '.json,.txt,application/json,text/plain';
  file.setAttribute('aria-label', 'Choose Luminance export');
  setSettingHelp(file, 'Open a Luminance JSON or text export and preview its tag groups.');
  const preview = app.node('section', null, 'epc-luminance-preview');
  const status = app.node('p', '', 'epc-caption'); status.setAttribute('role', 'status');
  let groups = [], choices = [], plan, apply;
  const current = () => ({
    settings: { ...app.settings, ...app.storage.get('ep.settings', {}) },
    nse: app.exportData().nse
  });
  const render = () => {
    const { settings, nse } = current();
    plan = planLuminanceImport(groups, choices, settings, nse);
    const { added, conflicts } = plan;
    const counts = Object.entries(added).filter(([, tags]) => tags.length).map(([kind, tags]) => {
      if (kind === 'collapse') return tags.length + (tags.length === 1 ? ' tag' : ' tags') + ' to collapse on details';
      return tags.length + ' ' + luminanceDestinations[kind].toLowerCase() + (tags.length === 1 ? '' : 's');
    });
    status.textContent = (counts.length ? 'To add · ' + counts.join(' · ') : 'No new tags to add') +
      (conflicts.length ? ' · ' + conflicts.length + (conflicts.length === 1 ? ' conflict skipped' : ' conflicts skipped') : '');
    apply.disabled = !Object.values(added).some(tags => tags.length);
    const conflictList = preview.querySelector('.epc-luminance-conflicts');
    conflictList.textContent = conflicts.length ? 'Conflicts kept as-is · ' + conflicts.join(', ') : '';
    preview.querySelector('.epc-luminance-block-note').hidden = !added.block.length;
  };
  const analyze = () => {
    preview.replaceChildren();
    try {
      groups = readLuminanceExport(input.value); choices = groups.map(group => group.destination);
      preview.append(app.node('h3', 'Review tag groups'));
      for (const [index, group] of groups.entries()) {
        const row = app.node('div', null, 'epc-luminance-group');
        const tags = app.node('details');
        const heading = app.node('summary', group.name + ' · ' + group.tags.length);
        tags.append(heading,
          app.node('p', group.tags.join(' '), 'epc-luminance-tags'));
        if (group.note) tags.append(app.node('p', group.note, 'epc-caption'));
        const select = app.node('select');
        select.setAttribute('aria-label', 'Destination for ' + group.name);
        setSettingHelp(heading, 'Open to inspect the tags. Use the adjacent menu to choose how Companion treats this group.', select);
        for (const [value, label] of Object.entries(luminanceDestinations)) {
          if (value === 'collapse' && group.id !== '7d') continue;
          const option = app.node('option', label); option.value = value; select.append(option);
        }
        select.value = choices[index];
        select.addEventListener('change', () => { choices[index] = select.value; render(); });
        row.append(tags, select); preview.append(row);
      }
      preview.append(app.node('p', 'Skipped settings include styles, scores, size indicators, and layout.', 'epc-caption'),
        app.node('p', '', 'epc-caption epc-luminance-conflicts'),
        app.node('p', 'Block hides matching results under Companion’s regular rules and page coverage.', 'epc-caption epc-luminance-block-note'));
      apply = app.button('Import selected tags', () => {
        if (!app.preferences.flush()) return;
        const reviewed = JSON.stringify(plan);
        render();
        if (reviewed !== JSON.stringify(plan)) {
          status.textContent += ' · Preferences changed. Review these counts and click Import again.';
          return;
        }
        const { settings, nse } = current(), { added } = plan;
        const merge = (old, tags) => [String(old || '').trim(), ...tags].filter(Boolean).join(' ');
        const snapshot = {
          format: 'empornium-companion', version: 1,
          settings: { ...settings, favoriteTags: merge(settings.favoriteTags, added.favorite),
            cautionTags: merge(settings.cautionTags, added.caution),
            collapsedDetailTags: merge(settings.collapsedDetailTags, added.collapse) },
          nse: added.block.length ? { nseTaglist: merge(nse.nseTaglist, added.block) } : {}
        };
        try {
          app.importData(JSON.stringify(snapshot), false, { mergePreferences: true });
          status.textContent = 'Tags imported. You can use Undo changes to reverse the import. Disable Luminance and reload after reviewing your tags.';
          preview.replaceChildren();
        } catch (error) { status.textContent = 'Nothing imported · ' + error.message; }
      });
      preview.append(setSettingHelp(apply, 'Merge the selected tags into your preferences. Undo changes can reverse the import.'));
      render();
    } catch (error) { status.textContent = error.message; }
  };
  input.addEventListener('input', () => { preview.replaceChildren(); status.textContent = ''; });
  file.addEventListener('change', async () => {
    const picked = file.files?.[0];
    if (!picked) return;
    try {
      if (picked.size > 8 * 1024 * 1024) throw new Error('The backup is too large (maximum 8 MiB).');
      input.value = await app.readFile(picked); analyze();
    } catch (error) { status.textContent = error.message; }
    finally { file.value = ''; }
  });
  panel.append(inputLabel, setSettingHelp(app.button('Preview import', analyze),
    'Review detected tag groups, suggested mappings, and conflicts before importing.'), file, status, preview);
  parent.append(panel);
}

// EFF Short Wordlist #1, Electronic Frontier Foundation, CC BY 4.0.
// Dice indices and the hyphenated entry removed.
// https://www.eff.org/files/2016/09/08/eff_short_wordlist_1.txt
// https://creativecommons.org/licenses/by/4.0/
const templatePassphraseWords = `
acid acorn acre acts afar affix aged agent agile aging agony ahead aide aids aim ajar
alarm alias alibi alien alike alive aloe aloft aloha alone amend amino ample amuse angel anger
angle ankle apple april apron aqua area arena argue arise armed armor army aroma array arson
art ashen ashes atlas atom attic audio avert avoid awake award awoke axis bacon badge bagel
baggy baked baker balmy banjo barge barn bash basil bask batch bath baton bats blade blank
blast blaze bleak blend bless blimp blink bloat blob blog blot blunt blurt blush boast boat
body boil bok bolt boned boney bonus bony book booth boots boss botch both boxer breed
bribe brick bride brim bring brink brisk broad broil broke brook broom brush buck bud buggy
bulge bulk bully bunch bunny bunt bush bust busy buzz cable cache cadet cage cake calm
cameo canal candy cane canon cape card cargo carol carry carve case cash cause cedar chain
chair chant chaos charm chase cheek cheer chef chess chest chew chief chili chill chip chomp
chop chow chuck chump chunk churn chute cider cinch city civic civil clad claim clamp clap
clash clasp class claw clay clean clear cleat cleft clerk click cling clink clip cloak clock
clone cloth cloud clump coach coast coat cod coil coke cola cold colt coma come comic
comma cone cope copy coral cork cost cot couch cough cover cozy craft cramp crane crank
crate crave crawl crazy creme crepe crept crib cried crisp crook crop cross crowd crown crumb
crush crust cub cult cupid cure curl curry curse curve curvy cushy cut cycle dab dad
daily dairy daisy dance dandy darn dart dash data date dawn deaf deal dean debit debt
debug decaf decal decay deck decor decoy deed delay denim dense dent depth derby desk dial
diary dice dig dill dime dimly diner dingy disco dish disk ditch ditzy dizzy dock dodge
doing doll dome donor donut dose dot dove down dowry doze drab drama drank draw dress
dried drift drill drive drone droop drove drown drum dry duck duct dude dug duke duo
dusk dust duty dwarf dwell eagle early earth easel east eaten eats ebay ebony ebook echo
edge eel eject elbow elder elf elk elm elope elude elves email emit empty emu enter
entry envoy equal erase error erupt essay etch evade even evict evil evoke exact exit fable
faced fact fade fall false fancy fang fax feast feed femur fence fend ferry fetal fetch
fever fiber fifth fifty film filth final finch fit five flag flaky flame flap flask fled
flick fling flint flip flirt float flock flop floss flyer foam foe fog foil folic folk
food fool found fox foyer frail frame fray fresh fried frill frisk from front frost froth
frown froze fruit gag gains gala game gap gas gave gear gecko geek gem genre gift
gig gills given giver glad glass glide gloss glove glow glue goal going golf gong good
gooey goofy gore gown grab grain grant grape graph grasp grass grave gravy gray green greet
grew grid grief grill grip grit groom grope growl grub grunt guide gulf gulp gummy guru
gush gut guy habit half halo halt happy harm hash hasty hatch hate haven hazel hazy
heap heat heave hedge hefty help herbs hers hub hug hula hull human humid hump hung
hunk hunt hurry hurt hush hut ice icing icon icy igloo image ion iron islam issue
item ivory ivy jab jam jaws jazz jeep jelly jet jiffy job jog jolly jolt jot
joy judge juice juicy july jumbo jump junky juror jury keep keg kept kick kilt king
kite kitty kiwi knee knelt koala kung ladle lady lair lake lance land lapel large lash
lasso last latch late lazy left legal lemon lend lens lent level lever lid life lift
lilac lily limb limes line lint lion lip list lived liver lunar lunch lung lurch lure
lurk lying lyric mace maker malt mama mango manor many map march mardi marry mash match
mate math moan mocha moist mold mom moody mop morse most motor motto mount mouse mousy
mouth move movie mower mud mug mulch mule mull mumbo mummy mural muse music musky mute
nacho nag nail name nanny nap navy near neat neon nerd nest net next niece ninth
nutty oak oasis oat ocean oil old olive omen onion only ooze opal open opera opt
otter ouch ounce outer oval oven owl ozone pace pagan pager palm panda panic pants panty
paper park party pasta patch path patio payer pecan penny pep perch perky perm pest petal
petri petty photo plank plant plaza plead plot plow pluck plug plus poach pod poem poet
pogo point poise poker polar polio polka polo pond pony poppy pork poser pouch pound pout
power prank press print prior prism prize probe prong proof props prude prune pry pug pull
pulp pulse puma punch punk pupil puppy purr purse push putt quack quake query quiet quill
quilt quit quota quote rabid race rack radar radio raft rage raid rail rake rally ramp
ranch range rank rant rash raven reach react ream rebel recap relax relay relic remix repay
repel reply rerun reset rhyme rice rich ride rigid rigor rinse riot ripen rise risk ritzy
rival river roast robe robin rock rogue roman romp rope rover royal ruby rug ruin rule
runny rush rust rut sadly sage said saint salad salon salsa salt same sandy santa satin
sauna saved savor sax say scale scam scan scare scarf scary scoff scold scoop scoot scope
score scorn scout scowl scrap scrub scuba scuff sect sedan self send sepia serve set seven
shack shade shady shaft shaky sham shape share sharp shed sheep sheet shelf shell shine shiny
ship shirt shock shop shore shout shove shown showy shred shrug shun shush shut shy sift
silk silly silo sip siren sixth size skate skew skid skier skies skip skirt skit sky
slab slack slain slam slang slash slate slaw sled sleek sleep sleet slept slice slick slimy
sling slip slit slob slot slug slum slurp slush small smash smell smile smirk smog snack
snap snare snarl sneak sneer sniff snore snort snout snowy snub snuff speak speed spend spent
spew spied spill spiny spoil spoke spoof spool spoon sport spot spout spray spree spur squad
squat squid stack staff stage stain stall stamp stand stank stark start stash state stays steam
steep stem step stew stick sting stir stock stole stomp stony stood stool stoop stop storm
stout stove straw stray strut stuck stud stuff stump stung stunt suds sugar sulk surf sushi
swab swan swarm sway swear sweat sweep swell swept swim swing swipe swirl swoop swore syrup
tacky taco tag take tall talon tamer tank taper taps tarot tart task taste tasty taunt
thank thaw theft theme thigh thing think thong thorn those throb thud thumb thump thus tiara
tidal tidy tiger tile tilt tint tiny trace track trade train trait trap trash tray treat
tree trek trend trial tribe trick trio trout truce truck trump trunk try tug tulip tummy
turf tusk tutor tutu tux tweak tweet twice twine twins twirl twist uncle uncut undo unify
union unit untie upon upper urban used user usher utter value vapor vegan venue verse vest
veto vice video view viral virus visa visor vixen vocal voice void volt voter vowel wad
wafer wager wages wagon wake walk wand wasp watch water wavy wheat whiff whole whoop wick
widen widow width wife wifi wilt wimp wind wing wink wipe wired wiry wise wish wispy
wok wolf womb wool woozy word work worry wound woven wrath wreck wrist xerox yahoo yam
yard year yeast yelp yield yodel yoga yoyo yummy zebra zero zesty zippy zone zoom
`.trim().split(/\s+/);

// SPDX-License-Identifier: GPL-3.0-or-later

const templateName = 'Companion';
const templatePassphraseKey = 'ep.templatePassphrase';
const templateWordCount = 8;
const templateFormat = 'companion-settings-v1';
const templateMaxPayload = 1024 * 1024;
const templatePrivateOptions = '#template optgroup[label="private templates"] option';
const templateLocalSettings = ['diagnostics', 'persistentImages', 'persistentCacheMB'];
const templateLocalNSE = new Set(['nseSavedVersion', 'nseCustomCSS', 'nseCustomCSSEnabled',
  'nseIndividualUploadHidingBlacklist', 'nseIndividualUploadHidingWhitelist']);

function generateTemplatePassphrase(crypto) {
  const size = templatePassphraseWords.length;
  const limit = 65536 - 65536 % size;
  const draw = new Uint16Array(1);
  const words = [];
  while (words.length < templateWordCount) {
    crypto.getRandomValues(draw);
    if (draw[0] < limit) words.push(templatePassphraseWords[draw[0] % size]);
  }
  return words.join(' ');
}

function normalizeTemplatePassphrase(input) {
  const words = input.trim().toLowerCase().split(/[\s-]+/);
  if (words.length !== templateWordCount || words.some(word => !templatePassphraseWords.includes(word))) {
    throw new Error('Enter all eight words from Copy passphrase on your other device, in the same order.');
  }
  return words.join(' ');
}

function portableTemplateData(app, nseKeys, data) {
  if (!data?.settings || typeof data.settings !== 'object' || Array.isArray(data.settings) ||
      !data.nse || typeof data.nse !== 'object' || Array.isArray(data.nse)) {
    throw new Error('The Companion template contains invalid settings.');
  }
  const settings = validateSettings(data.settings);
  for (const key of templateLocalSettings) delete settings[key];
  compileConditionalRules(settings.conditionalRules);
  const nse = {};
  for (const key of nseKeys) if (Object.hasOwn(data.nse, key)) nse[key] = data.nse[key];
  return { settings, nse: app.options.validateNSE(nse), searches: validateSearches(data.searches) };
}

function templateBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function templateUnbase64(text) {
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}

async function deriveTemplateKey(crypto, passphrase, salt, usage) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt }, material,
    { name: 'AES-GCM', length: 256 }, false, [usage]);
}

function templateCipherParams(iv, account) {
  return { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(templateFormat + ':' + account) };
}

async function encryptTemplateSettings(crypto, passphrase, account, settings) {
  const bytes = new TextEncoder().encode(JSON.stringify(settings));
  if (bytes.length > Math.floor((templateMaxPayload - 100) * 3 / 4)) {
    throw new Error('These settings are too large for a template. Transfer them using Backup & restore.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveTemplateKey(crypto, passphrase, salt, 'encrypt');
  const ciphertext = await crypto.subtle.encrypt(templateCipherParams(iv, account), key, bytes);
  return [templateFormat, templateBase64(salt), templateBase64(iv), templateBase64(new Uint8Array(ciphertext))].join('.');
}

async function decryptTemplateSettings(crypto, passphrase, account, payload) {
  const format = /^companion-settings-v1\.([\w-]{22})\.([\w-]{16})\.([\w-]{22,})$/;
  const fields = payload.length <= templateMaxPayload && format.exec(payload);
  if (!fields) throw new Error('The private Companion template does not contain a supported settings snapshot. It was left alone.');
  try {
    const [salt, iv, ciphertext] = fields.slice(1).map(templateUnbase64);
    const key = await deriveTemplateKey(crypto, passphrase, salt, 'decrypt');
    const bytes = await crypto.subtle.decrypt(templateCipherParams(iv, account), key, ciphertext);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('Could not unlock the Companion template. Check that you entered the same passphrase used to write it.');
  }
}

class EmpTemplate {
  constructor(app, fetch, signal) {
    this.doc = app.doc;
    this.fetch = fetch;
    this.signal = signal;
    this.upload = new URL('/upload.php', app.win.location.href);
    this.account = emporniumAccountID(app.doc, this.upload);
    if (!this.account) throw new Error('Sign in to Emp before using the Companion template.');
  }

  async request(url, fields) {
    let response;
    try {
      response = await this.fetch(url.href, {
        method: fields ? 'POST' : 'GET', body: fields ? new URLSearchParams(fields) : undefined,
        mode: 'same-origin', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: this.signal
      });
    } catch {
      throw new Error('Could not connect to Emp. Check your session and try again.');
    }
    if (!response.ok || response.url && response.url !== url.href) {
      throw new Error('Emp could not open the template. Check that your account can use private upload templates.');
    }
    const text = await response.text();
    if (text.length > 8 * 1024 * 1024) throw new Error('Emp returned a page that was too large to check.');
    return text;
  }

  async page(fields) {
    const template = this.doc.createElement('template');
    template.innerHTML = await this.request(this.upload, fields);
    const root = template.content;
    if (emporniumAccountID(root, this.upload) !== this.account) throw new Error('Your Emp session changed. Sign in and try again.');
    const select = root.querySelector('select#template[name="template"]');
    if (!select) throw new Error('Private upload templates are unavailable for this Emp account.');
    const matches = [...root.querySelectorAll(templatePrivateOptions)].filter(option => option.textContent.trim() === templateName);
    if (matches.length > 1) throw new Error('Emp has more than one private template named Companion. Review them on the Upload page.');
    const id = matches[0]?.value || '';
    if (id && !/^[1-9]\d{0,14}$/.test(id)) throw new Error('Emp returned an invalid template ID.');
    return { id, select, root };
  }

  async read(id) {
    if (!id) throw new Error('No private Companion template yet. Use Write on the device that has your settings.');
    const page = await this.page({ fill: 'fill from', template: id });
    const body = page.root.querySelector('textarea#desc[name="desc"]');
    if (!body || page.id !== id || page.select.value !== id) throw new Error('Emp could not load the private Companion template.');
    return body.value;
  }

  async write(id, payload) {
    let result;
    try {
      const saveURL = new URL('/upload.php?action=add_template', this.upload);
      result = JSON.parse(await this.request(saveURL, {
        templateID: id || '0', name: templateName, ispublic: '0', title: '', image: '', category: '0', tags: '', body: payload
      }));
    } catch {
      throw new Error('Emp did not confirm the write. Use Read to check the template before trying again.');
    }
    if (Array.isArray(result) && result[0] === 0) {
      throw new Error('Emp declined the save. Check that your account can create and edit private upload templates.');
    }
    try {
      if (!Array.isArray(result) || result[0] !== 1) throw new Error();
      const saved = await this.page();
      if ((id && saved.id !== id) || await this.read(saved.id) !== payload) throw new Error();
    } catch {
      throw new Error('Emp did not confirm the write. Use Read to check the template before trying again.');
    }
  }
}

function mountTemplateSync(app) {
  const { win, storage } = app;
  const { prompt, copyPassphrase, nseSchema, requireTrusted = true } = app.options.empTemplate;
  const nseKeys = Object.keys(nseSchema).filter(key => !templateLocalNSE.has(key) && nseSchema[key] !== 'array');
  const fetch = app.options.fetch || win.fetch?.bind(win);
  const crypto = win.crypto;
  const group = optionGroup(app, app.panes.settings, 'Experimental', { key: 'experimental', searchable: true });
  const panel = app.node('div');
  panel.dataset.optionItem = '';
  const status = app.node('p', '', 'epc-caption');
  status.setAttribute('role', 'status');
  const preview = app.node('div');
  const secret = () => storage.get(templatePassphraseKey, '');
  const templateButton = (label, action) => app.button(label, event => {
    if (event.isTrusted || !requireTrusted) action();
  });
  const copy = templateButton('Copy passphrase', () => {
    try {
      copyPassphrase(secret());
      status.textContent = 'Passphrase copied. Enter it in Experimental on your other device.';
    } catch { status.textContent = 'Could not copy. Use Show or change passphrase to copy or type the words.'; }
  });
  const change = templateButton('Show or change passphrase', () => {
    try {
      const previous = secret();
      const entered = prompt('Use the same eight words in the same order on every Companion installation.', previous);
      if (entered === null) return;
      const next = normalizeTemplatePassphrase(entered);
      if (next !== previous) {
        storage.set(templatePassphraseKey, next);
        preview.replaceChildren();
      }
      status.textContent = 'Passphrase ready on this device.';
    } catch (error) { status.textContent = error.message; }
  });
  const write = templateButton('Write to Companion Template', () => void transfer('write'));
  const read = templateButton('Read from Companion Template', () => void transfer('read'));
  const buttons = [copy, change, write, read];
  const setDisabled = disabled => {
    for (const button of buttons) button.disabled = disabled;
    copy.disabled ||= !copyPassphrase;
    change.disabled ||= !prompt;
  };
  const secretActions = app.node('div', null, 'epc-actions');
  const transferActions = app.node('div', null, 'epc-actions');
  secretActions.append(copy, change);
  transferActions.append(write, read);
  panel.append(app.node('h4', 'Companion settings across devices'),
    app.node('p', 'On your first device, copy or show the generated passphrase, then choose Write. On your other device, choose Show or change passphrase and enter the same eight words, then choose Read.', 'epc-caption'),
    secretActions,
    app.node('p', 'Use the same Emp account and passphrase on every installation. Write saves or replaces the encrypted settings, filter rules, and saved searches in your private Companion upload template. Read previews changes before replacing the settings on this device.', 'epc-caption'),
    app.node('p', 'Your passphrase, custom CSS, per-torrent history and overrides, collage pins, image cache, and diagnostic data stay on this device. Image retention and diagnostic logging choices stay local too.', 'epc-caption'),
    transferActions, status, preview);
  group.append(panel);

  try {
    if (!fetch || !crypto?.subtle) throw new Error('Template transfer is unavailable in this browser.');
    if (!secret()) storage.set(templatePassphraseKey, generateTemplatePassphrase(crypto));
    setDisabled(false);
  } catch (error) {
    setDisabled(true);
    status.textContent = !fetch || !crypto?.subtle ? error.message :
      'Could not save the passphrase on this device. Reload Companion and try again.';
  }

  const currentSettings = () => ({ ...app.settings, ...storage.get('ep.settings', {}) });
  const currentSnapshot = () => {
    const nse = {};
    for (const key of nseKeys) {
      const value = storage.get(key, undefined);
      if (value !== undefined) nse[key] = value;
    }
    return portableTemplateData(app, nseKeys, {
      settings: currentSettings(), nse, searches: storage.get('ep.searches', app.searches)
    });
  };
  const signature = data => JSON.stringify(data);

  function showPreview(incoming, localChanged = false) {
    const current = currentSnapshot();
    preview.replaceChildren();
    if (signature(current) === signature(incoming)) {
      status.textContent = 'Your settings already match the Companion template.';
      return;
    }
    status.textContent = localChanged ? 'Local settings changed. Review the updated preview and choose Apply settings again.' :
      'Review the changes before replacing your settings on this device.';
    const changes = app.node('ul', null, 'epc-caption');
    for (const [key, label] of [['settings', 'Companion preferences'], ['nse', 'Filter and theme preferences']]) {
      const keys = new Set([...Object.keys(current[key]), ...Object.keys(incoming[key])]);
      const count = [...keys].filter(name => signature(current[key][name]) !== signature(incoming[key][name])).length;
      if (count) changes.append(app.node('li', `${label} · ${count} to update`));
    }
    if (signature(current.searches) !== signature(incoming.searches)) {
      changes.append(app.node('li', `Saved searches · replace ${current.searches.length} local with ${incoming.searches.length} from Emp`));
    }
    const apply = templateButton('Apply settings', () => {
      if (!app.preferences.flush()) return;
      try {
        if (signature(current) !== signature(currentSnapshot())) {
          showPreview(incoming, true);
          return;
        }
        const settings = { ...currentSettings(), ...incoming.settings };
        app.importData(JSON.stringify({ format: 'empornium-companion', version: 1, ...incoming, settings }),
          true, { replaceNSEKeys: nseKeys });
        status.textContent = 'Settings applied. To undo, use Backup & restore → Restore previous import.';
        preview.replaceChildren();
      } catch (error) { status.textContent = error.message; }
    });
    preview.append(changes, apply, app.button('Cancel', () => {
      preview.replaceChildren();
      status.textContent = 'Import canceled.';
    }));
  }

  async function transfer(operation) {
    if (!app.preferences.flush()) {
      status.textContent = 'Resolve the unsaved setting before transferring settings.';
      return;
    }
    preview.replaceChildren();
    setDisabled(true);
    status.textContent = operation === 'write' ? 'Writing settings to Emp…' : 'Reading settings from Emp…';
    try {
      const signal = win.AbortSignal.timeout(20000);
      const passphrase = secret();
      if (!passphrase) throw new Error('Set a passphrase before transferring settings.');
      const remote = new EmpTemplate(app, fetch, signal);
      const { id } = await remote.page();
      const readSnapshot = async () => {
        const decoded = await decryptTemplateSettings(crypto, passphrase, remote.account, await remote.read(id));
        return portableTemplateData(app, nseKeys, decoded);
      };
      if (operation === 'read') {
        const incoming = await readSnapshot();
        if (passphrase !== secret()) throw new Error('The passphrase changed. Read the template again.');
        showPreview(incoming);
        return;
      }
      const local = currentSnapshot();
      if (id && signature(local) === signature(await readSnapshot())) {
        status.textContent = 'The Companion template already has these settings.';
        return;
      }
      const payload = await encryptTemplateSettings(crypto, passphrase, remote.account, local);
      if (passphrase !== secret() || emporniumAccountID(app.doc, remote.upload) !== remote.account) {
        throw new Error('Your Emp session or passphrase changed. Review it before writing again.');
      }
      await remote.write(id, payload);
      status.textContent = 'Saved and verified the private Companion template on Emp.';
    } catch (error) { status.textContent = error.message; }
    finally { setDisabled(false); }
  }
}

// SPDX-License-Identifier: GPL-3.0-or-later

const SETTINGS_KEY = 'ep.settings';
const SEARCH_KEY = 'ep.searches';
const CACHE_STATS_PIN_KEY = 'ep.cacheStatsPinned';
const DIAGNOSTIC_LIMIT = 3000;
const OWN = '.epc-root,.epc-thumbnail,.epc-cover-image,.epc-cover-status,.epc-grid-gif-poster,.epc-grid-gif-playback,.epc-media-retry,.epc-engine,.epc-version-control,.epc-version-columns,.epc-grid-card-actions,#nseOuter,#nseFloatyBoi';
// Image URLs can be extensionless, and formats such as WebP can carry animation.
const coverMayAnimate = source => !/\.(?:jpe?g|bmp|ico)$/i.test(new URL(source).pathname);
const loadLabels = {
  thumbnail: 'Thumbnails', cover: 'Collage covers', animation: 'Cover playback', preview: 'Image previews',
  image: 'Page images', background: 'Background images', backfill: 'Result pages', collage: 'Collage update'
};
const emptyLoadCounts = () => ({ ready: 0, partial: 0, failed: 0, pending: 0, deferred: 0 });
const pendingLoadStates = ['queued', 'loading', 'streaming', 'retrying', 'stalled'];
function countLoad(counts, state) {
  if (pendingLoadStates.includes(state)) counts.pending++;
  else if (['ready', 'partial', 'failed', 'deferred'].includes(state)) counts[state]++;
}
const searchSignature = fields => JSON.stringify(fields.map(field => [field.name, field.type, field.value, !!field.checked]));
const smallLegacyResize = source => {
  const resize = source.match(/\/images\/resize\/(\d+)\//);
  return resize && Number(resize[1]) <= 350 && !!legacyOriginal(source);
};

function captureSearch(form) {
  const fields = [];
  for (const control of Array.from(form.elements || [])) {
    if (!SEARCH_NAMES.test(control.name) || control.disabled) continue;
    if (control.type === 'select-multiple') {
      for (const option of Array.from(control.selectedOptions)) {
        fields.push({ name: control.name, type: control.type, value: option.value, checked: false });
      }
    } else fields.push({ name: control.name, type: control.type, value: control.value, checked: !!control.checked });
  }
  return fields;
}

function applySearch(form, saved, append = false) {
  const textNames = new Set(['searchtext', 'title', 'filelist', 'taglist', 'searchstr']);
  const controls = Array.from(form.elements || []);
  if (!append) {
    for (const control of controls) {
      if (!SEARCH_NAMES.test(control.name)) continue;
      if (control.type === 'checkbox' || control.type === 'radio') control.checked = false;
      else if (textNames.has(control.name) || ['sizeall', 'sizerange'].includes(control.name)) control.value = '';
    }
  }
  for (const field of saved.fields) {
    const matches = controls.filter(c => c.name === field.name);
    for (const control of matches) {
      if (control.type === 'checkbox' || control.type === 'radio') {
        if (control.type === 'radio' && control.value !== field.value) continue;
        control.checked = append && /^filter_cat\[/.test(field.name) ? control.checked || field.checked : field.checked;
      } else if (control.type === 'select-multiple') {
        const selected = saved.fields.filter(f => f.name === field.name).map(f => f.value);
        for (const option of Array.from(control.options)) option.selected = selected.includes(option.value) || append && option.selected;
      } else if (append && textNames.has(field.name)) {
        if (field.value.trim() && control.value.trim() !== field.value.trim()) {
          control.value = [control.value.trim(), field.value.trim()].filter(Boolean).join(' ');
        }
      } else if (!append || field.value.trim()) control.value = field.value;
      const EventClass = control.ownerDocument.defaultView.Event;
      control.dispatchEvent(new EventClass('input', { bubbles: true }));
      control.dispatchEvent(new EventClass('change', { bubbles: true }));
    }
  }
}

class CompanionApp {
  constructor(win, storage, options = {}) {
    this.win = win; this.doc = win.document; this.storage = storage; this.options = options;
    const storedSettings = storage.get(SETTINGS_KEY, {});
    const savedSettings = storedSettings && typeof storedSettings === 'object' ? { ...storedSettings } : {};
    this.hasExistingPreferences = Object.keys(savedSettings).length > 0 || storage.list().some(key => key.startsWith('nse'));
    this.onboardingComplete = storage.get('ep.onboardingDone', false) === true;
    if (!this.hasExistingPreferences && !this.onboardingComplete) savedSettings.keyboardShortcuts = false;
    if (!Object.hasOwn(savedSettings, 'backfillEnabled')) savedSettings.backfillEnabled = storage.get('nseBackfillButtonEnabled', true);
    if (!Object.hasOwn(savedSettings, 'backfillPages')) savedSettings.backfillPages = storage.get('nseBackfillPageLimit', 5);
    if (!savedSettings.navigationScope) savedSettings.navigationScope = savedSettings.globalArrowNavigation ? 'site' :
      storage.get('nseArrowNavigationEnabled', false) ? 'results' : 'off';
    if (storage.get('ep.mediaRevision', 0) < 2) {
      // Upgrade the old two-slot default, retaining other explicit tuning.
      if (savedSettings.concurrency === 2) savedSettings.concurrency = 6;
      storage.set('ep.mediaRevision', 2);
      storage.set(SETTINGS_KEY, savedSettings);
    }
    this.settings = validateSettings(savedSettings);
    this.log = []; this.assetIds = new Map(); this.nextAssetId = 0; this.cleanups = [];
    this.roots = new Set(); this.scanPending = false; this.mounted = false; this.disposed = false;
    this.searches = [];
    this.searchEdits = new Map();
    this.filtersReady = !options.waitForFilters;
    this.removedFilterIDs = new Set();
    this.detachedFilterRows = new Map();
    this.preferences = new PreferencesController(this);
    this.resultFilters = new ResultFilters(this);
    try {
      const existing = storage.get(SEARCH_KEY, null);
      this.searches = validateSearches(existing || JSON.parse(storage.get('empSavedSearches', '[]')));
    } catch (e) { this.report('Saved searches could not be read: ' + e.message); }
  }
  node(tag, text, cls) {
    const node = this.doc.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  button(text, listener, label) {
    const button = this.node('button', text); button.type = 'button';
    if (label) button.setAttribute('aria-label', label);
    button.addEventListener('click', listener); return button;
  }
  on(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this.cleanups.push(() => target.removeEventListener(type, listener, options));
  }
  report(message) {
    const text = String(message?.message || message);
    this.appendDiagnostic({ type: 'application', message: text.slice(0, 240) });
    if (this.notice) this.notice.textContent = text;
  }
  appendDiagnostic(event) {
    if (this.log.length >= DIAGNOSTIC_LIMIT) this.log.splice(0, 200);
    this.log.push({ time: new Date().toISOString(), ...event });
  }
  record(entry, kind, details) {
    if (!this.settings.diagnostics) return;
    if (!this.assetIds.has(entry.url)) this.assetIds.set(entry.url, ++this.nextAssetId);
    const url = new URL(entry.url), candidate = new URL(entry.actualURL || entry.url);
    this.appendDiagnostic({ asset: this.assetIds.get(entry.url), host: url.host, candidateHost: candidate.host,
      resizePixels: Number(candidate.pathname.match(/^\/images\/resize\/(\d+)\//)?.[1]) || undefined,
      kind, state: entry.status, attempts: entry.attempts, lane: entry.activeLane,
      elapsedMs: entry.started ? Date.now() - entry.started : 0,
      legacyResize: !!legacyOriginal(entry.url), dimensions: entry.dimensions,
      reason: ['retrying', 'failed', 'stalled'].includes(entry.status) ? entry.reason : undefined, ...details });
  }
  toast(text) {
    this.win.clearTimeout(this.toastTimer);
    if (this.notice) {
      this.notice.textContent = text; this.notice.hidden = false;
      this.toastTimer = this.win.setTimeout(() => {
        if (!this.notice.querySelector('button')) this.notice.textContent = '';
      }, 6000);
    }
  }
  start() {
    if (this.disposed) return this;
    this.imageCache = this.options.imageCache || new PersistentImageCache({
      indexedDB: this.win.indexedDB, origin: this.win.location.origin, local: !!this.options.localImageCache,
      now: Date.now, setTimeout: this.win.setTimeout.bind(this.win), clearTimeout: this.win.clearTimeout.bind(this.win),
      request: this.options.requestImage,
      activityChannel: typeof this.win.BroadcastChannel==='function'?()=>new this.win.BroadcastChannel('empornium-companion-cache-usage'):null,
      encode: blob => new Promise((resolve,reject) => { const reader=new this.win.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob); })
    }, () => this.settings);
    this.cacheUsageUnsubscribe=this.imageCache.subscribe?.(()=>this.scheduleCacheUsage());
    this.versions = new VersionGroups(this); this.tags = new TagHighlights(this);
    this.grid = new ResultGrid(this);
    this.media = new PageMedia(this);
    this.preview = new PreviewController(this);
    this.backfill = new BackfillController(this);
    this.collageQuickAdd = new CollageQuickAdd(this);
    this.onboarding = new OnboardingController(this);
    this.on(this.doc,'securitypolicyviolation',event=>{
      if(/^img-src/.test(event.violatedDirective||'')&&/^data(?::|$)/.test(event.blockedURI||''))this.imageCache.displayBlocked=true;
    });
    this.on(this.doc, 'error', event => {
      if (event.target?.tagName === 'IMG') this.media.inspect(event.target, true);
    }, true);
    this.on(this.doc, 'load', event => {
      if (event.target?.tagName === 'IMG') this.media.inspect(event.target);
    }, true);
    this.on(this.win, 'keydown', event => this.keydown(event));
    this.on(this.win, 'pagehide', event => {
      this.preferences.flush(); this.media.flushThumbnailHistory(); this.media.pool.flushHosts(); void this.imageCache.flushTouches();void this.imageCache.flushActivity?.();
      if (this.backfill.busy) this.backfill.stop();
      // Manager requests run in a background context: explicitly stop them
      // when this document is leaving, while retaining BFCache documents.
      if (!event.persisted) this.media.pool.dispose();
    });
    this.on(this.doc, 'click', event => {
      if (event.target.closest?.('.nseToggleHideButton')) this.preferences.beforeChange();
    }, true);
    this.on(this.doc, 'pointerdown', event => {
      const menu = this.doc.getElementById('nseRCMBox');
      if (menu && !menu.contains(event.target)) menu.classList.add('hidden');
      if (this.preview.open && !this.preview.pinned && !this.preview.element.contains(event.target) &&
          !this.preview.anchor?.contains(event.target)) this.preview.hide();
    });
    this.on(this.doc, 'visibilitychange', () => { this.media.pool.pump(); this.onboarding.maybeOpen(); this.backfill.maybeAutomatic(); });
    this.on(this.win, 'online', () => this.media.resumeAutomaticRecovery(true));
    this.on(this.win, 'focus', () => { this.refreshSavedSearches(); this.resultFilters.refreshSeen(); });
    this.on(this.doc, 'visibilitychange', () => {
      if(this.doc.hidden)this.cancelCacheUsage();
      else{this.refreshSavedSearches();this.resultFilters.refreshSeen();void this.refreshCacheUsage();}
    });
    this.observer = new this.win.MutationObserver(mutations => {
      if (this.media.coverGatePending) this.media.syncCoverGate();
      if (!this.filtersReady) { if (!this.mounted && this.doc.body) this.mount(); return; }
      let removed = false;
      for (const mutation of mutations) {
        if (mutation.target.nodeType === 1 && mutation.target.closest?.(OWN)) continue;
        if (mutation.type === 'childList' && [...mutation.addedNodes, ...mutation.removedNodes].every(node =>
          node.nodeType === 1 && node.matches('.epc-thumbnail,.epc-cover-image,.epc-cover-status,.epc-grid-gif-poster,.epc-grid-gif-playback'))) continue;
        if (presentationMutation(mutation)) continue;
        const results = mutationChangesResults(mutation);
        if (mutation.type === 'attributes') this.schedule(mutation.target, results);
        else {
          for (const node of mutation.addedNodes) if (node.nodeType === 1) this.schedule(node, results);
          for (const node of mutation.removedNodes) if (node.nodeType === 1 && !node.isConnected) {
            this.rememberRemovedFilters(node); this.preview.forget(node); this.media.noteRemoved(node); this.versions.forget(node);
            this.tags.forget(node); removed = true;
          }
          if (mutation.target.nodeType === 1 && (results || mutation.target.tagName === 'SCRIPT' ||
              mutation.target.closest('div.tags,#torrent_tags_list,a[data-ep-overlay],.torrent__cover'))) this.schedule(mutation.target, results);
        }
      }
      if (removed) this.scheduleHealth();
      if (!this.mounted && this.doc.body) this.mount();
    });
    this.observeDOM();
    if (this.doc.body) this.mount();
    if (this.doc.readyState !== 'loading') this.resultFilters.recordVisit();
    this.on(this.doc, 'DOMContentLoaded', () => {
      this.resultFilters.recordVisit(); this.mount(); this.schedule(this.doc.body);
    }, { once: true });
    this.on(this.win, 'pageshow', event => {
      if (event.persisted && this.doc.body) {
        this.resultFilters.recordVisit(); this.schedule(this.doc.body);
        const pinned = this.storage.get(CACHE_STATS_PIN_KEY, false) === true;
        if (pinned !== this.cacheStatsPinned) this.setCacheStatsPinned(pinned);
        else if (pinned) void this.refreshCacheUsage();
      }
    });
    return this;
  }
  observeDOM() {
    if (!this.disposed) this.observer?.observe(this.doc.documentElement || this.doc, { childList: true, subtree: true,
      attributes: true, attributeOldValue: true, attributeFilter: ['src', 'srcset', 'data-src', 'data-srcset', 'style', 'class', 'hidden', 'isnsehidden'] });
  }
  batchDOM(operation) {
    const outer = !this.domBatchDepth;
    this.domBatchDepth = (this.domBatchDepth || 0) + 1;
    if (outer) this.observer?.disconnect();
    try { return operation(); }
    finally { this.domBatchDepth--; if (outer) this.observeDOM(); }
  }
  mount() {
    if (this.mounted || !this.doc.body) return;
    this.mounted = true;
    this.buildUI();
    this.schedule(this.doc.body);
    this.win.setTimeout(() => {
      if (!this.disposed) this.options.startNSE?.(this);
    }, 0);
  }
  schedule(root, results = true) {
    if (this.disposed || !this.win.document || !this.doc.documentElement || !root || root.nodeType !== 1 || root.closest?.(OWN)) return;
    this.roots.add(root);
    if (results && !this.resultsDirty) this.media.invalidateLayout();
    this.resultsDirty ||= results;
    if (!this.filtersReady) return;
    if (this.scanPending) return;
    this.scanPending = true;
    const run = () => {
      this.scanPending = false;
      if (this.disposed || !this.win.document || !this.doc.documentElement) return;
      const roots = coalesceScanRoots(this.roots); this.roots.clear();
      const results = this.resultsDirty; this.resultsDirty = false;
      if (results) {
        this.attachWorkspace(); this.ensureSavedSearchUI();
        this.batchDOM(() => { for (const root of roots) this.options.newRows?.(root); });
        this.syncGridFilters(false);
      }
      for (const root of roots) {
        this.tags.refresh(root);
        if (this.settings.enabled) {
          this.media.scan(root);
          this.preview.scan(root);
        }
      }
      if (results || roots.some(root => root.matches('body,#content,table,tbody,tr.torrent'))) this.versions.stabilizeLayouts();
      if (this.root && this.filtersReady && this.root.dataset.epReady !== 'true') this.root.dataset.epReady = 'true';
      this.onboarding.maybeOpen(); this.backfill.maybeAutomatic();
    };
    (this.win.requestAnimationFrame || (fn => this.win.setTimeout(fn, 16))).call(this.win, run);
  }
  buildUI() {
    this.root = this.node('section', null, 'epc-root epc-workspace');
    this.root.setAttribute('aria-label', 'Companion');
    this.toolbar = this.node('header', null, 'epc-toolbar');
    const main = this.node('div', null, 'epc-toolbar-main');
    const brand = this.node('div', null, 'epc-toolbar-brand');
    const mark = this.node('span', null, 'epc-brand-mark'); mark.append(companionIcon(this, 'brand'));
    this.launcher = this.node('strong', 'Companion', 'epc-brand');
    const pageName = toolbarPageName(this.win.location.href);
    brand.append(mark, this.launcher);
    if (pageName) brand.append(this.node('span', pageName, 'epc-page-name'));
    this.buildLoadProgress(brand, main);
    main.append(brand);
    this.panel = this.node('section', null, 'epc-panel'); this.panel.hidden = true;
    const heading = this.node('header', null, 'epc-panel-heading');
    this.paneHeading = this.node('strong', 'Companion');
    heading.append(this.paneHeading, this.button('Close', () => this.closePane()));
    this.panel.append(heading);
    this.panes = {}; this.paneButtons = new Map();
    const navigation = this.node('nav', null, 'epc-navigation'); navigation.setAttribute('aria-label', 'Companion tools');
    const resultActions = this.node('nav', null, 'epc-navigation epc-result-actions');
    resultActions.setAttribute('aria-label', 'Result controls');
    for (const [key, title] of [['filters', 'Filters'], ['searches', 'Searches'], ['images', 'Images'], ['settings', 'Settings']]) {
      const pane = this.node('section', null, 'epc-pane'); pane.hidden = true;
      pane.dataset.pane = key; pane.id = 'epc-pane-' + key;
      const button = this.button(title, () => this.openPane(key));
      button.dataset.pane = key; button.setAttribute('aria-controls', pane.id); button.setAttribute('aria-expanded', 'false');
      this.paneButtons.set(key, button); this.panes[key] = pane;
      if (key !== 'images') {
        button.prepend(companionIcon(this, key));
        (key === 'filters' ? resultActions : navigation).append(button);
      }
      this.panel.append(pane);
    }
    main.append(navigation);
    this.toolbarContext = this.node('div', null, 'epc-toolbar-context');
    this.resultActions = resultActions;
    this.contextActions = this.node('div', null, 'epc-context-actions');
    const footer = this.node('div', null, 'epc-toolbar-footer');
    this.toolbarUtilities = this.node('div', null, 'epc-toolbar-utilities');
    this.toolbarStatus = this.node('div', null, 'epc-toolbar-status');
    this.filterSummary = this.node('span', '', 'epc-result-summary');
    this.notice = this.node('p', '', 'epc-notice'); this.notice.setAttribute('role', 'status');
    this.health = this.node('span', '', 'epc-health'); this.health.hidden = true;
    this.toolbarStatus.append(this.filterSummary, this.health);
    footer.append(this.toolbarStatus, this.toolbarUtilities);
    this.toolbar.append(main, this.toolbarContext, footer);
    const filteredLabel = this.node('span', 'Show filtered');
    this.filteredCount = this.node('span', '', 'epc-filtered-count');
    this.filteredCount.setAttribute('aria-hidden', 'true');
    this.toggleFiltered = this.button('', () => {
      this.revealingFiltered = !this.revealingFiltered;
      this.toggleFiltered.setAttribute('aria-pressed', String(this.revealingFiltered));
      this.syncGridFilters(); this.media.demandListener?.();
    });
    this.filteredLabel = filteredLabel;
    this.toggleFiltered.dataset.epReveal = '';
    this.toggleFiltered.hidden = true;
    this.toggleFiltered.setAttribute('aria-pressed', 'false');
    this.toggleFiltered.append(companionIcon(this, 'eye'), filteredLabel, this.filteredCount);
    this.controls = new Map();
    this.grid.mount();
    this.resultFilters.mountFreeleech();
    this.toolbarStatus.append(this.toggleFiltered);
    this.toolbarContext.append(resultActions, this.contextActions);
    this.backfill.mount();
    this.panes.filters.append(this.node('p', 'Loading filter preferences…', 'epc-filter-placeholder'));
    this.panes.searches.append(this.node('p', 'Click a name to run its search. More lets you edit saved criteria here.', 'epc-caption'));
    const displaySection=this.node('section',null,'epc-settings-section');displaySection.dataset.settingsGroup='Appearance';
    displaySection.append(setSettingHelp(this.node('h3','Appearance'), 'Choose how results, thumbnails, and previews look.'));
    const settings = this.node('div', null, 'epc-basic-settings');displaySection.append(settings);
    this.basicAppearance = this.node('div'); settings.append(this.basicAppearance);
    const browsingSection=this.node('section',null,'epc-settings-section');browsingSection.dataset.settingsGroup='Browsing';browsingSection.append(setSettingHelp(this.node('h3','Browsing'), 'Choose how Companion loads extra pages and groups alternate versions.'));
    const browsing=this.node('div',null,'epc-basic-settings');browsingSection.append(browsing);
    this.panes.settings.append(displaySection,browsingSection);
    this.cacheUsage=this.node('section',null,'epc-cache-usage');this.cacheUsage.setAttribute('aria-label','Image cache');
    this.cacheUsage.setAttribute('aria-live','polite');
    const cacheHeading=this.node('header',null,'epc-cache-heading');
    const resetUsage=this.button('Reset stats',async()=>{
      resetUsage.disabled=true;this.cancelCacheUsage();
      try{await this.imageCache.resetActivity();await this.refreshCacheUsage();}
      catch{this.cacheUsageFields.activity.textContent='Could not reset usage history. Please try again.';}
      finally{resetUsage.disabled=false;}
    },'Reset cache usage statistics');
    setSettingHelp(resetUsage, 'Reset activity and savings in every time window. Saved images stay in the cache.');
    this.cacheStatsPinned = false;
    this.cachePinButton = this.button('Pin statistics', () => this.toggleCacheStatsPin());
    setSettingHelp(this.cachePinButton, 'Show image cache statistics below the Companion toolbar on every page.');
    this.cachePinButton.dataset.optionItem = '';
    this.cachePinButton.setAttribute('aria-controls', 'epc-cache-statistics');
    cacheHeading.append(setSettingHelp(this.node('strong','Image cache'), 'See saved image usage and control how much space Companion uses in this browser.'), this.cachePinButton);this.cacheUsage.append(cacheHeading);
    this.cacheDetails=optionGroup(this,this.cacheUsage,'Statistics & storage',{key:'cache-details'});
    const cacheActions=this.node('div',null,'epc-actions');cacheActions.append(resetUsage);resetUsage.dataset.optionItem='';
    const usageList=this.node('dl');this.cacheUsageFields={};
    for(const[key,label]of[['thumbnails','Thumbnails'],['previews','Previews']]){
      const row=this.node('div'),value=this.node('dd','—');row.append(this.node('dt',label),value);usageList.append(row);this.cacheUsageFields[key]=value;
    }
    this.cacheUsageFields.total=this.node('p','Reading saved images…','epc-caption');
    this.cacheUsageFields.activity=this.node('p','','epc-caption');
    this.cacheActivityTable=this.node('table',null,'epc-cache-activity');this.cacheActivityTable.setAttribute('aria-label','Cache activity');
    const activityHead = this.node('thead'), headRow = this.node('tr');
    for (const [label, tooltip] of [
      ['Period', 'Rolling time window. All history starts when tracking began or when you last reset stats.'],
      ['Hits', 'Image loads served from Companion’s memory or saved files. Each reuse counts.'],
      ['Misses', 'Cache checks that found no usable image. The image can still load after a miss.'],
      ['Hit rate', 'Hits ÷ (hits + misses).'],
      ['Downloads', 'Images fetched by the userscript manager and decoded successfully. Direct browser loads are excluded.'],
      ['Saved', 'Estimated image data reused across hits. ≥ means some hits have unknown sizes. — means no hit sizes are known.']
    ]) {
      const cell = this.node('th', label);
      cell.scope = 'col'; cell.title = tooltip; headRow.append(cell);
    }
    activityHead.append(headRow);
    const activityBody=this.node('tbody');this.cacheActivityRows={};
    for(const[key,label]of[['five','5 min'],['fifteen','15 min'],['hour','1 hour'],['all','All history']]){
      const row=this.node('tr'),heading=this.node('th',label);heading.scope='row';row.append(heading);this.cacheActivityRows[key]={};
      for(const name of['hits','misses','hitRate','downloads','savedBytes']){const cell=this.node('td','—');this.cacheActivityRows[key][name]=cell;row.append(cell);}activityBody.append(row);
    }
    this.cacheActivityTable.append(activityHead,activityBody);
    this.cacheUsage.insertBefore(this.cacheUsageFields.total,this.cacheDetails);
    this.cacheStatistics = this.node('div');
    this.cacheStatistics.id = 'epc-cache-statistics'; this.cacheStatistics.dataset.optionItem = '';
    this.cacheStatistics.append(usageList, this.cacheActivityTable, this.cacheUsageFields.activity);
    this.cacheDetails.append(this.cacheStatistics, cacheActions);
    this.cacheDetails.addEventListener('toggle', () => {
      if (this.cacheStatsPinned) return;
      if (this.cacheDetails.open) void this.refreshCacheUsage();
      else { this.win.clearTimeout(this.cacheUsageClock); this.cacheUsageClock = null; }
    });
    this.cacheUsage.dataset.settingsGroup='Image cache';
    this.panes.settings.append(this.cacheUsage);
    this.cachePinned = this.node('section', null, 'epc-cache-pinned'); this.cachePinned.hidden = true;
    this.cachePinned.setAttribute('aria-label', 'Image cache statistics');
    const pinnedHeading = this.node('header', null, 'epc-cache-heading');
    pinnedHeading.append(this.node('strong', 'Image cache statistics'),
      this.button('Unpin statistics', () => this.toggleCacheStatsPin()));
    this.cachePinned.append(pinnedHeading);
    this.advancedSettings = optionGroup(this, this.panes.settings, 'Advanced settings', { key: 'advanced' });
    setupSettingsSearch(this);
    this.optionGroups = {};
    for (const [key, title] of [['images', 'Image behavior'], ['loading', 'Loading & recovery'],
      ['interaction', 'Keyboard & menus'], ['appearance', 'Appearance'], ['results', 'Results & backfill'],
      ['extras', 'Extra features'], ['diagnostics', 'Diagnostics']]) {
      this.optionGroups[key] = optionGroup(this, this.advancedSettings, title, { key, searchable: true });
    }
    const imageKeys = new Set(['enabled', 'previews', 'inlineThumbnails', 'compactBodyImages', 'thumbnailPlacement',
      'categoryDisplay', 'thumbnailMode', 'previewWidth', 'progressBar']);
    const schema = [
      ['enabled', 'Enable image improvements', 'checkbox'],
      ['previews', 'Enlarge images on hover', 'checkbox'],
      ['inlineThumbnails', 'Inline thumbnails', 'checkbox'],
      ['thumbnailPlacement', 'Place thumbnails', ['title', 'category']],
      ['categoryDisplay', 'Category icons', ['keep', 'overlay', 'hide']],
      ['thumbnailMode', 'Thumbnail source', ['auto', 'supplied', 'original']],
      ['thumbnailSize', 'Thumbnail width', 'number', 48, 300],
      ['resultsView', 'Results layout', ['list', 'grid']],
      ['gridCardWidth', 'Grid card size', [240, 320, 420, 540]],
      ['gridSpacing', 'Grid spacing', ['standard', 'compact']],
      ['gridAutoplayGifs', 'Play animated covers in Grid', 'checkbox'],
      ['listAutoplayGifs', 'Play animated covers in List', 'checkbox'],
      ['gridShowDetails', 'Show details in grid cards', 'checkbox'],
      ['gridShowTags', 'Show tags in grid cards', 'checkbox'],
      ['gridTagCues', 'Show Favorite and Caution cues in Grid', 'checkbox'],
      ['adaptiveDetailTags', 'Use a responsive layout for detail tags', 'checkbox'],
      ['previewWidth', 'Preview width', 'number', 240, 800],
      ['hoverDelay', 'Title hover delay (ms)', 'number', 0, 1500],
      ['hideDelay', 'Popup grace period (ms)', 'number', 100, 1500],
      ['recoverImages', 'Recover failed page images', 'checkbox'],
      ['recoverBackgrounds', 'Track collage cover backgrounds', 'checkbox'],
      ['legacyFallback', 'Use originals when legacy resizes fail', 'checkbox'],
      ['prepareGalleries', 'Defer offscreen images in unopened galleries', 'checkbox'],
      ['reserveImageSpace', 'Reserve space while images load', 'checkbox'],
      ['compactBodyImages', 'Compact very tall page images', 'checkbox'],
      ['concurrency', 'Maximum concurrent thumbnails (automatic per host)', 'number', 1, 8],
      ['thumbnailTimeoutMs', 'Small-image fallback after (ms)', 'number', 1500, 12000],
      ['maxRetries', 'Automatic retries per image', 'number', 0, 3],
      ['stallMs', 'Show slow-load status after (ms)', 'number', 1000, 30000],
      ['timeoutMs', 'Retry unanswered requests after (ms)', 'number', 3000, 90000],
      ['cacheEntries', 'Images retained in preview cache', 'number', 4, 64],
      ['cacheMegapixels', 'Image cache budget (megapixels)', 'number', 8, 160],
      ['persistentImages', 'Remember images between page loads', 'checkbox'],
      ['persistentCacheMB', 'Saved image cache limit (MB)', 'number', 32, 2048],
      ['preloadScreens', 'Prioritize nearby images (screens)', 'number', 0, 2],
      ['progressBar', 'Header load progress', 'checkbox'],
      ['keyboardShortcuts', 'Use keyboard shortcuts', 'checkbox'],
      ['navigationScope', 'Arrow key pagination', ['off', 'results', 'site']],
      ['diagnostics', 'Keep a local diagnostic history', 'checkbox'],
      ['backfillEnabled', 'Show Load more action', 'checkbox'],
      ['backfillMode', 'Load more pages', ['off', 'pages', 'all']],
      ['backfillPages', 'Additional pages per batch', 'number', 1, 15],
      ['groupVersions', 'Group alternate video versions', 'checkbox']
    ];
    for (const [key, label, type, min, max] of schema) {
      const row = this.node('label', null, 'epc-setting');
      const caption = this.node('span', label);
      row.dataset.optionItem = ''; row.append(caption);
      const control = this.node(Array.isArray(type) ? 'select' : 'input');
      if (Array.isArray(type)) {
        for (const value of type) {
          const label = key === 'thumbnailMode' ? ({ auto: 'Small first', supplied: 'Page preview', original: 'Full original' })[value] :
            key === 'navigationScope' ? ({ off: 'Off', results: 'Results only', site: 'Across site' })[value] :
            key === 'backfillMode' ? ({ off: 'When I click Backfill', pages: 'Automatically load a few pages', all: 'Automatically load all pages' })[value] :
            key === 'resultsView' ? ({ list: 'List', grid: 'Grid' })[value] :
            key === 'gridSpacing' ? ({ standard: 'Standard', compact: 'Compact' })[value] : value;
          const option = this.node('option', label); option.value = value; control.append(option);
        }
        control.value = this.settings[key];
      } else {
        control.type = type;
        if (type === 'checkbox') control.checked = this.settings[key];
        else {
          control.value = this.settings[key]; control.min = min; control.max = max;
          control.step = key === 'preloadScreens' ? '0.1' : '1'; control.required = true;
        }
      }
      if (key === 'gridCardWidth') { gridCardSizeChoices(control, this.settings.gridCardWidth); control.dataset.numeric = ''; }
      control.dataset.setting = key; this.controls.set(key, control); row.append(control);
      setSettingHelp(caption, settingHelp[key], control);
      if(type==='checkbox')row.classList.add('epc-setting-toggle');
      const parent = ['thumbnailSize','previews','resultsView','gridCardWidth','gridSpacing','gridAutoplayGifs','listAutoplayGifs','gridShowDetails','gridShowTags'].includes(key) ? settings : ['backfillMode','backfillPages','groupVersions'].includes(key)?browsing :
        ['persistentImages','persistentCacheMB'].includes(key)?this.cacheDetails:key.startsWith('backfill') ? this.optionGroups.results :
        ['gridTagCues', 'adaptiveDetailTags'].includes(key) ? this.optionGroups.appearance :
        key === 'diagnostics' ? this.optionGroups.diagnostics : ['keyboardShortcuts', 'navigationScope'].includes(key) ? this.optionGroups.interaction :
        imageKeys.has(key) ? this.optionGroups.images : this.optionGroups.loading;
      parent.append(row);
      if(type==='checkbox'&&(parent===settings||parent===browsing))row.prepend(control);
    }
    this.coverMotionNote = this.createCoverMotionNote('epc-cover-motion-settings');
    this.grid.mountViewOptions();
    this.controls.get('listAutoplayGifs').closest('label').after(this.coverMotionNote);
    settings.append(this.controls.get('previews').closest('label'));
    settings.append(this.grid.settingsHelp());
    settings.append(this.node('p', 'Preload full-size covers, including off-screen results. List playback shows inline covers. This can use more data.', 'epc-caption'));
    const shortcuts = keyboardShortcutList(this);
    shortcuts.dataset.optionItem = '';
    this.optionGroups.interaction.append(shortcuts);
    this.syncSettingsUI();
    const retry = setSettingHelp(this.button('Retry visible images', () => this.media.retryVisible()),
      'Try loading visible images that failed again. Useful after reconnecting or when an image host is back online.');
    retry.dataset.optionItem = '';
    this.optionGroups.loading.append(retry);
    const cacheStatus=this.node('p','Saved thumbnails and previews stay until you clear them or storage needs space.','epc-caption');
    const clearSaved=this.button('Clear saved images',async()=>{
      try{this.cancelCacheUsage();await this.imageCache.clear();cacheStatus.textContent='Saved image cache cleared. Images already on this page stay visible.';void this.refreshCacheUsage();}
      catch{cacheStatus.textContent='Browser image storage is unavailable.';}
    });
    setSettingHelp(clearSaved, 'Delete saved image files from this browser. Images already displayed on the page stay visible.');
    clearSaved.dataset.optionItem='';this.cacheDetails.append(cacheStatus,clearSaved);
    const backup = optionGroup(this, this.panes.settings, 'Backup & restore', { key: 'backup',searchable:true });
    const picker = this.node('input'); picker.type = 'file'; picker.accept = '.json,application/json';
    picker.setAttribute('aria-label', 'Import companion or legacy settings JSON');
    setSettingHelp(picker, 'Choose a Companion, legacy filter, or saved-search backup. Companion keeps a copy of your previous settings before applying it.');
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0]; if (!file) return;
      try {
        if (file.size > 8 * 1024 * 1024) throw new Error('The backup is too large (maximum 8 MiB).');
        const text = await this.readFile(file);
        this.importData(text); this.toast('Backup restored. Your preferences are active.');
      } catch (e) { this.toast('Nothing imported: ' + e.message); }
      picker.value = '';
    });
    backup.append(
      this.node('p', 'Import a Companion backup, a legacy filter export, or an older saved-search backup.'),
      setSettingHelp(this.button('Export everything', () => {
        this.download('companion-backup.json', JSON.stringify(this.exportData(), null, 2));
      }), 'Download your preferences, filters, and saved searches as JSON. Saved image files are separate.'), picker,
      setSettingHelp(this.button('Restore previous import', () => {
        const previous = this.storage.get('ep.previousImport', null);
        if (!previous) { this.toast('No previous import is available.'); return; }
        try { this.importData(JSON.stringify(previous), false); this.toast('Previous data restored. Your preferences are active.'); }
        catch (e) { this.toast(e.message); }
      }), 'Restore the settings and saved searches from just before your most recent full import.')
    );
    for(const item of backup.querySelectorAll('button,input'))item.dataset.optionItem='';
    mountLuminanceImport(this, backup);
    if (this.options.empTemplate) mountTemplateSync(this);
    const setupHelp=setSettingHelp(this.button('Getting started',()=>this.onboarding.show()),
      'Reopen the setup guide to review common browsing and image choices.');
    setupHelp.classList.add('epc-settings-help');this.panes.settings.append(setupHelp);
    const diagnostics = this.optionGroups.diagnostics;
    this.diagnosticList = this.node('pre', '', 'epc-log');
    diagnostics.append(setSettingHelp(this.button('Show recent events', () => {
      this.diagnosticList.textContent = this.log.length ? JSON.stringify(this.log.slice(-30), null, 2) : 'No events recorded. Enable local diagnostic history in settings.';
    }), 'Show up to 30 recent loading events in this section.'),
    setSettingHelp(this.button('Export diagnostic history', () => this.download('empornium-image-diagnostics.json', JSON.stringify(this.log, null, 2))),
      'Download the locally recorded loading events as a JSON file for troubleshooting.'),
    setSettingHelp(this.button('Clear history', () => { this.log = []; this.diagnosticList.textContent = ''; }),
      'Clear the recorded diagnostic events. Saved images and cache statistics stay available.'), this.diagnosticList);
    for (const button of diagnostics.querySelectorAll('button')) button.dataset.optionItem = '';
    this.saveBar = this.node('footer', null, 'epc-savebar');
    this.saveStatus = this.node('span', 'Changes save automatically', 'epc-caption');
    this.saveStatus.setAttribute('role', 'status');
    this.undoPreferences = setSettingHelp(this.button('Undo changes', () => this.preferences.undo()),
      'Restore the most recent preference checkpoint. Your current saved searches stay available.');
    this.undoPreferences.hidden = !this.preferences.checkpoint;
    this.saveBar.append(this.saveStatus, this.undoPreferences); this.panel.append(this.saveBar);
    this.hideSettingHelp = mountSettingTooltips(this);
    this.savedShortcuts = this.node('nav', null, 'epc-saved-shortcuts');
    this.savedShortcuts.setAttribute('aria-label', 'Saved searches'); this.savedShortcuts.hidden = true;
    this.toolbarUtilities.append(this.savedShortcuts);
    this.root.append(this.toolbar, this.notice, this.cachePinned, this.panel); this.doc.body.append(this.root);
    this.root.addEventListener('input', event => this.markDirty(event.target, event));
    this.root.addEventListener('change', event => {
      if(event.target.dataset.setting==='backfillMode')this.controls.get('backfillEnabled').checked=true;
      this.syncSettingsUI();this.markDirty(event.target,event);
    });
    this.root.addEventListener('focusout', event => {
      const input = event.target;
      if (input.matches?.('input[type=number][data-setting]') && !input.checkValidity()) {
        const value = input.value.trim() ? Number(input.value) : NaN;
        const step = Number(input.step) || 1;
        input.value = Number.isFinite(value) ? Number((Math.min(Number(input.max),
          Math.max(Number(input.min), Math.round(value / step) * step))).toFixed(3)) : this.settings[input.dataset.setting];
        input.removeAttribute('aria-invalid');
      }
      if (event.target.matches?.('[data-setting],[data-ep-filter-control]')) this.preferences.flush();
    });
    this.root.addEventListener('compositionstart', () => { this.composing = true; });
    this.root.addEventListener('compositionend', event => { this.composing = false; this.markDirty(event.target, event); });
    this.attachWorkspace();
    this.setCacheStatsPinned(this.storage.get(CACHE_STATS_PIN_KEY, false) === true);
    this.preview.build();
  }
  attachWorkspace() {
    if (!this.root) return;
    const anchor = this.doc.querySelector('#search_box') || this.doc.querySelector('#content h2');
    const table = this.doc.querySelector('#content .torrent_table,#content .torrent_grid');
    if (anchor && this.workspaceAnchor !== anchor) { anchor.after(this.root); this.workspaceAnchor = anchor; }
    else if (!anchor && table && this.workspaceAnchor !== table) { table.before(this.root); this.workspaceAnchor = table; }
    this.collageQuickAdd.mount();
  }
  openPane(key) {
    if (key === 'images') key = 'settings';
    this.preferences.flush();
    if (!this.panes?.[key]) return;
    this.hideSettingHelp?.();
    this.grid.closeViewOptions();
    if (key === 'filters' || key === 'settings') mountFilterControls(this);
    if (key === 'searches') this.ensureSavedSearchUI();
    if (key === 'searches' && !this.savedDrawer) {
      this.panes.searches.replaceChildren(this.node('p', 'Saved searches are available on torrent search pages.', 'epc-caption'));
    }
    const close = this.activePane === key && !this.panel.hidden;
    if (close) { this.closePane(); return; }
    this.activePane = key; this.panel.hidden = false;
    for (const [name, pane] of Object.entries(this.panes)) {
      pane.hidden = name !== key; this.paneButtons.get(name).setAttribute('aria-expanded', String(name === key));
    }
    this.paneHeading.textContent = ({ filters: 'Filter your results', searches: 'Saved searches', images: 'Images & previews', settings: 'Settings' })[key];
    this.saveBar.hidden = key === 'searches';
    if (key === 'filters' && this.resultFilters.history?.open) this.resultFilters.refreshSeen();
    this.storage.set('ep.searchDrawerOpen', key === 'searches');
    if(key==='settings')void this.refreshCacheUsage();
    else if (!this.cacheStatsPinned) this.cancelCacheUsage();
    this.media.demandListener?.();
  }
  toggleCacheStatsPin() {
    const pinned = !this.cacheStatsPinned;
    try { this.storage.set(CACHE_STATS_PIN_KEY, pinned); }
    catch { this.toast('Could not save the statistics pin.'); return; }
    this.setCacheStatsPinned(pinned);
  }
  setCacheStatsPinned(pinned) {
    if (pinned === this.cacheStatsPinned) return;
    const returnFocus = this.cachePinned.contains(this.doc.activeElement);
    this.cacheStatsPinned = pinned;
    this.cachePinned.hidden = !pinned;
    this.cachePinButton.textContent = pinned ? 'Unpin statistics' : 'Pin statistics';
    setSettingHelp(this.cachePinButton, pinned ? 'Return the statistics to Settings.' : 'Show image cache statistics below the Companion toolbar on every page.');
    if (pinned) {
      this.cacheStatistics.hidden = false;
      this.cachePinned.append(this.cacheStatistics);
    } else {
      this.cacheDetails.firstElementChild.after(this.cacheStatistics);
      if (this.settingsSearch.value.trim()) this.settingsSearch.dispatchEvent(new this.win.Event('input'));
      if (this.cacheUsageVisible() && !this.cacheUsage.hidden) this.cacheDetails.open = true;
      if (returnFocus) {
        const button = this.cachePinButton.closest('[hidden]') ? this.paneButtons.get('settings') : this.cachePinButton;
        button.focus();
      }
    }
    if (this.cacheUsageVisible()) void this.refreshCacheUsage();
    else this.cancelCacheUsage();
  }
  cacheUsageVisible() {
    return !this.disposed && !this.doc.hidden && !!this.cacheUsage &&
      (this.cacheStatsPinned || this.activePane === 'settings' && !this.panel.hidden);
  }
  cancelCacheUsage(){this.win.clearTimeout(this.cacheUsageTimer);this.win.clearTimeout(this.cacheUsageClock);this.cacheUsageTimer=this.cacheUsageClock=null;this.cacheUsageSnapshot=null;this.cacheUsageVersion=(this.cacheUsageVersion||0)+1;}
  syncSettingsUI(){
    const mode=this.controls?.get('backfillMode')?.value,pages=this.controls?.get('backfillPages');if(!pages)return;
    const row=pages.closest('[data-option-item]');row.querySelector('span').textContent=mode==='off'?'Pages per click':'Additional pages';
    const searching=!!this.settingsSearch?.value.trim();if(!searching)row.hidden=mode==='all';
    if(mode==='all'&&!pages.checkValidity())pages.value=this.settings.backfillPages;
    this.controls.get('navigationScope').disabled = !this.controls.get('keyboardShortcuts').checked;
    this.syncCoverMotionControls();
    if(!this.cacheStatsPinned&&this.cacheUsage?.hidden){this.win.clearTimeout(this.cacheUsageClock);this.cacheUsageClock=null;}
  }
  createCoverMotionNote(id) {
    const note = this.node('p', 'Animated covers are unavailable while reduced motion is on in your system settings.', 'epc-caption epc-cover-motion-note');
    note.id = id; note.hidden = true;
    note.setAttribute('role', 'status');
    return note;
  }
  syncCoverMotionControls() {
    const reduced = !!this.media.reducedMotion?.matches;
    const groups = [
      [this.coverMotionNote, [this.controls?.get('gridAutoplayGifs'), this.controls?.get('listAutoplayGifs')]],
      [this.onboarding?.coverMotionNote, [this.onboarding?.gridAutoplayGifs, this.onboarding?.listAutoplayGifs]]
    ];
    for (const [note, controls] of groups) {
      if (!note) continue;
      note.hidden = !reduced || controls.every(control => control.closest('label').hidden);
      for (const control of controls) {
        control.disabled = reduced;
        if (reduced) control.setAttribute('aria-describedby', note.id);
        else control.removeAttribute('aria-describedby');
      }
    }
  }
  scheduleCacheUsage(){
    if(!this.cacheUsageVisible()||this.cacheUsageTimer)return;
    this.cacheUsageTimer=this.win.setTimeout(()=>{this.cacheUsageTimer=null;void this.refreshCacheUsage();},250);
  }
  async refreshCacheUsage(){
    if(!this.cacheUsageVisible())return;
    this.win.clearTimeout(this.cacheUsageTimer);this.cacheUsageTimer=null;
    const version=this.cacheUsageVersion=(this.cacheUsageVersion||0)+1;this.cacheUsage.setAttribute('aria-busy','true');
    let s;try{s=await this.imageCache.summary?.();}catch{}
    if(version!==this.cacheUsageVersion||!this.cacheUsageVisible())return;
    const fields=this.cacheUsageFields;
    this.cacheUsage.setAttribute('aria-busy','false');
    if(!s?.available){fields.thumbnails.textContent=fields.previews.textContent='—';fields.total.textContent='Saved image storage unavailable.';fields.activity.textContent=this.cacheStatsPinned?fields.total.textContent:'';this.cacheActivityTable.hidden=true;this.win.clearTimeout(this.cacheUsageClock);this.cacheUsageClock=null;this.cacheUsageSnapshot=null;return;}
    fields.thumbnails.textContent=s.thumbnailCount.toLocaleString()+' · '+cacheBytes(s.thumbnailFileBytes);
    fields.previews.textContent=s.previewCount.toLocaleString()+' · '+cacheBytes(s.previewBytes);
    fields.total.textContent=cacheBytes(s.bytes)+' of '+cacheBytes(s.limitBytes)+' used'+(s.saving?'':' · Saving off');
    this.cacheUsageSnapshot=s;this.renderCacheActivity();
  }
  renderCacheActivity(){
    this.win.clearTimeout(this.cacheUsageClock);this.cacheUsageClock=null;
    const s=this.cacheUsageSnapshot;if(!s||!this.cacheUsageVisible()||!this.cacheStatsPinned&&this.cacheUsage.hidden)return;
    this.cacheActivityTable.hidden=s.activityAvailable===false;
    this.cacheUsageFields.activity.textContent=s.activityAvailable===false?'Usage history unavailable.':(s.historyPartial?'Older totals predate miss tracking; all-history rate unavailable. ':'')+'Saved estimates image data reused.';
    if(s.activityAvailable===false)return;
    const now=Date.now(),windows=cacheActivityWindows(s,now);
    for(const[key,values]of Object.entries(windows)){
      for(const name of['hits','misses','downloads']){const value=values[name];
        const cell=this.cacheActivityRows[key][name],text=value.toLocaleString();if(cell.textContent!==text)cell.textContent=text;
      }
      const lookups=values.hits+values.misses,incomplete=key==='all'&&s.historyPartial;
      const rate=this.cacheActivityRows[key].hitRate,text=lookups&&!incomplete?(values.hits/lookups).toLocaleString(undefined,{style:'percent',maximumFractionDigits:1}):'—';
      if(rate.textContent!==text)rate.textContent=text;
      rate.title=incomplete?'All-history hit rate is unavailable because older hits predate miss tracking.':lookups?'Hits ÷ (hits + misses). Downloads are excluded.':'No cache lookups in this window.';
      const saved=this.cacheActivityRows[key].savedBytes,unknown=values.hits>values.sizedHits;
      const savedText=unknown?(values.savedBytes?'≥'+cacheBytes(values.savedBytes):'—'):cacheBytes(values.savedBytes);
      if(saved.textContent!==savedText)saved.textContent=savedText;
      saved.title=unknown?'Only hits with known file sizes are included; older or unmeasured savings cannot be reconstructed.':'Estimated image payload reused, including memory hits. Browser HTTP caching and transfer overhead are not measurable.';
    }
    // Age the in-memory snapshot only; no database polling or hidden-panel timer.
    if((this.cacheStatsPinned||this.cacheDetails.open)&&s.recent?.some(row=>row[0]+5000>now-3600000))this.cacheUsageClock=this.win.setTimeout(()=>this.renderCacheActivity(),5000);
  }
  closePane() {
    this.hideSettingHelp?.();
    this.preferences.flush();
    const trigger = this.paneButtons.get(this.activePane);
    this.panel.hidden = true; this.activePane = null;
    if (!this.cacheStatsPinned) this.cancelCacheUsage();
    for (const button of this.paneButtons.values()) button.setAttribute('aria-expanded', 'false');
    this.storage.set('ep.searchDrawerOpen', false); trigger?.focus();
    this.media.demandListener?.();
  }
  markDirty(target, event) { this.preferences.changed(target, event); this.refreshOptionSummaries?.(); }
  applyChanges() { return this.preferences.flush(); }
  setResultPreference(key, value) {
    if (!this.preferences.flush()) return false;
    const control = this.controls.get(key);
    const field = control.type === 'checkbox' ? 'checked' : 'value';
    const previous = control[field];
    control[field] = value;
    this.dirty = true;
    if (this.preferences.flush()) return true;
    control[field] = previous;
    this.dirty = false;
    return false;
  }
  captureFilterBaseline(rows) { this.versions?.captureOrder(rows); captureFilterBaseline(this, rows); }
  restoreFilterBaseline() { restoreFilterBaseline(this); }
  detachFilteredRow(row) {
    if (!row.isConnected) return;
    if (!this.detachedFilterRows.has(row)) {
      const marker = this.doc.createComment('Companion filtered result');
      row.before(marker); this.detachedFilterRows.set(row, marker);
    }
    this.rememberRemovedFilters(row);
    // Retain the original position even while explicitly inspecting removed results.
    if (this.revealingFiltered) return;
    row.classList.remove('epc-revealed'); row.classList.add('hidden');
    row.remove(); this.preview?.forget(row); this.media?.noteRemoved(row); this.tags?.forget(row);
  }
  beforeFilterWrite() { if (!this.savingPreferences) this.preferences.beforeChange(); }
  afterFilterWrite() {
    if (this.savingPreferences) return;
    this.win.clearTimeout(this.filterRefreshTimer);
    this.filterRefreshTimer = this.win.setTimeout(() => {
      this.refreshFilters(); this.applyAppearance(); this.saveStatus.textContent = 'Saved automatically';
    }, 0);
  }
  refreshFilters(syncInputs = false) {
    try { this.batchDOM(() => this.options.refreshFilters?.(syncInputs)); }
    catch { this.report('Filters could not update on this page. Your preferences have been saved.'); }
    this.syncFilterActions();
    if (this.preview.open && !this.preview.pinned &&
        (!this.preview.anchor?.isConnected || this.preview.anchor.closest('.hidden:not(.epc-revealed),[hidden],.epc-version-hidden'))) this.preview.hide(true);
    this.versions.refresh(); this.tags.refresh();
    if (this.resultFilters.historyVisible()) this.resultFilters.renderHistory();
  }
  syncFilterActions() {
    const available = this.options.resultActionsAvailable?.() !== false;
    if (this.openVisibleAction) this.openVisibleAction.hidden = !available || !this.storage.get('nseOpenAllButtonEnabled', true);
    if (this.hideVisibleAction) this.hideVisibleAction.hidden = !available || !this.storage.get('nseFilterAllButtonEnabled', true) ||
      !this.storage.get('nseIndividualUploadHidingEnabled', true);
  }
  applyAppearance() {
    this.refreshOptionSummaries?.();
    applyWorkspaceTheme(this);
    const enabled = this.doc.getElementById('nseCheckCustomCSS')?.checked;
    const css = enabled ? this.doc.getElementById('nseCustomCSSArea')?.value || '' : '';
    if (css || this.customStyle) {
      if (!this.customStyle) {
        this.customStyle = this.options.addStyle?.('') || this.doc.createElement('style');
        if (!this.customStyle.isConnected) this.doc.head.append(this.customStyle);
      }
      this.customStyle.textContent = css;
    }
    const content = this.doc.getElementById('content');
    for (const [key, name, fallback] of [['nseBlacklistColor','--epc-blocked','#f00'],
      ['nseHardPassColor','--epc-hard-pass','#a00'],['nseWhitelistColor','--epc-allowed','#0f0']]) {
      content?.style.setProperty(name, this.storage.get(key, fallback));
    }
  }
  updateMediaPreferences(previous) {
    this.syncSettingsUI();
    gridCardSizeChoices(this.controls.get('gridCardWidth'), this.settings.gridCardWidth);
    if (previous.resultsView === this.settings.resultsView) this.grid?.refresh();
    this.backfill?.sync();
    this.backfill?.maybeAutomatic();
    if(previous.persistentCacheMB!==this.settings.persistentCacheMB)void this.imageCache.prune(this.imageCache.limit());
    if (previous.seenMode !== this.settings.seenMode) this.resultFilters.seen = null;
    if (previous.resultsView !== this.settings.resultsView || previous.groupVersions !== this.settings.groupVersions || previous.seenMode !== this.settings.seenMode ||
        previous[this.resultFilters.freeleechKey] !== this.settings[this.resultFilters.freeleechKey]) {
      this.resultFilters.refreshView();
    }
    if (['favoriteTags', 'cautionTags', 'collapsedDetailTags', 'adaptiveDetailTags', 'resultsView', 'gridShowTags', 'gridTagCues']
      .some(key => previous[key] !== this.settings[key])) this.tags.refresh();
    if (previous.keyboardShortcuts !== this.settings.keyboardShortcuts) this.preview.syncShortcutLabels();
    const other = new Set(['groupVersions', 'favoriteTags', 'cautionTags', 'backfillEnabled', 'backfillPages', 'backfillMode',
      'keyboardShortcuts', 'navigationScope', 'globalArrowNavigation', 'diagnostics', 'persistentImages', 'persistentCacheMB',
      'conditionalRules', 'seenMode', 'freeleechView', 'bookmarkFreeleechView', 'collapsedDetailTags',
      'adaptiveDetailTags', 'gridTagCues', 'listHiddenColumns']);
    if (!Object.keys(this.settings).some(key => !other.has(key) && previous[key] !== this.settings[key])) return;
    if (previous.enabled !== this.settings.enabled) {
      this.restartMedia(); return;
    }
    if (previous.previews !== this.settings.previews) {
      this.preview.dispose(); this.preview = new PreviewController(this); this.preview.build();
      this.preview.scan(this.doc.getElementById('content') || this.doc.body);
      for (const record of this.media.thumbnails.values()) {
        const definition = this.media.definitions.get(record.link?.dataset.epOverlay);
        if (definition) this.preview.bind(record.element.querySelector('button'), {
          ...definition, title: this.preview.titleOf(record.link), href: record.link.href
        });
      }
    }
    this.media.updateSettings(previous);
    this.preview.position();
  }
  adoptEngine() {
    if (!this.doc.getElementById('nseOuter')) {
      if (this.resultFilters.bookmarks) {
        this.panes.filters.replaceChildren(this.resultFilters.freeleechControl);
        this.resultFilters.mountHistory(this.panes.filters);
      } else this.panes.filters.replaceChildren(this.resultFilters.freeleechControl,
        this.node('p', 'Filtering is available on torrent lists and detail pages.'));
      return;
    }
    this.engineReady = true;
    adoptNotificationControls(this);
    if (this.doc.getElementById('nseUpdateToast')) {
      this.toast('Filtering engine updated. Your preferences have been kept.');
      this.doc.getElementById('nseUpdateToast').remove();
    }
    const menu = this.doc.getElementById('nseRCMBox');
    if (menu) { menu.classList.add('epc-root'); this.doc.body.append(menu); }
    if (this.activePane === 'filters' || this.activePane === 'settings') mountFilterControls(this);
    this.applyAppearance();
    // Saved names stay visible; management opens only when requested.
  }
  adoptRuleMenu(event, kind, value) { adoptRuleMenu(this, event, kind, value); }
  readFile(file) {
    if (file.text) return file.text();
    return new Promise((resolve, reject) => {
      const reader = new this.win.FileReader(); reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('The file could not be read.')); reader.readAsText(file);
    });
  }
  exportData() {
    const nse = {};
    for (const key of this.storage.list()) if (/^nse/.test(key)) nse[key] = this.storage.get(key);
    nse.nseBackfillButtonEnabled = this.settings.backfillEnabled;
    nse.nseBackfillPageLimit = this.settings.backfillPages;
    return { format: 'empornium-companion', version: 1, createdAt: new Date().toISOString(),
      settings: this.settings, searches: this.searches, searchDrawerOpen: this.activePane === 'searches', nse };
  }
  importData(text, keepUndo = true, { completeOnboarding = false, mergePreferences = false, replaceNSEKeys = null } = {}) {
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { throw new SyntaxError('The backup file is not valid JSON.'); }
    let searches, settings, nse, drawer;
    if (Array.isArray(parsed)) searches = validateSearches(parsed);
    else if (!parsed || typeof parsed !== 'object') throw new Error('Expected a JSON object or saved-search array.');
    else if (parsed.format === 'empornium-companion') {
      if (parsed.version !== 1) throw new Error('Unsupported backup version.');
      settings = validateSettings(parsed.settings);
      if (Object.hasOwn(parsed.settings ?? {}, 'conditionalRules')) compileConditionalRules(settings.conditionalRules);
      for (const key of ['keyboardShortcuts', 'conditionalRules', 'seenMode', 'freeleechView', 'bookmarkFreeleechView']) {
        if (!Object.hasOwn(parsed.settings ?? {}, key)) settings[key] = this.settings[key];
      }
      if (!mergePreferences) searches = validateSearches(parsed.searches);
      nse = this.options.validateNSE?.(parsed.nse || {}) || parsed.nse;
      if (!mergePreferences && !replaceNSEKeys) drawer = !!parsed.searchDrawerOpen;
    } else if ('empSavedSearches' in parsed) {
      let legacy = parsed.empSavedSearches;
      if (typeof legacy === 'string') {
        try { legacy = JSON.parse(legacy); }
        catch { throw new SyntaxError('The saved-search backup is not valid JSON.'); }
      }
      searches = validateSearches(legacy);
      drawer = !!parsed.empSavedSearchesKeepOpen;
    } else {
      if (!this.options.validateNSE) throw new Error('Filter import is unavailable.');
      nse = this.options.validateNSE(parsed);
    }
    if (settings && !parsed.settings?.navigationScope) {
      settings.navigationScope = settings.globalArrowNavigation ? 'site' : nse?.nseArrowNavigationEnabled ? 'results' : 'off';
    } else if (!settings && nse && Object.hasOwn(nse, 'nseArrowNavigationEnabled')) {
      settings = validateSettings({ ...this.settings, navigationScope: nse.nseArrowNavigationEnabled ? 'results' : 'off',
        globalArrowNavigation: false });
    }
    if (nse) {
      const compatible = {};
      if (Object.hasOwn(nse, 'nseBackfillButtonEnabled') && !Object.hasOwn(parsed.settings || {}, 'backfillEnabled')) compatible.backfillEnabled = nse.nseBackfillButtonEnabled;
      if (Object.hasOwn(nse, 'nseBackfillPageLimit') && !Object.hasOwn(parsed.settings || {}, 'backfillPages')) compatible.backfillPages = nse.nseBackfillPageLimit;
      if (Object.keys(compatible).length) settings = validateSettings({ ...this.settings, ...settings, ...compatible });
    }
    const changes = new Map();
    if (completeOnboarding) changes.set('ep.onboardingDone', true);
    if (settings) changes.set(SETTINGS_KEY, settings);
    if (searches) changes.set(SEARCH_KEY, searches);
    if (drawer !== undefined) changes.set('ep.searchDrawerOpen', drawer);
    if (nse) {
      if (!mergePreferences) {
        for (const key of replaceNSEKeys ?? this.storage.list().filter(key => /^nse/.test(key))) changes.set(key, undefined);
      }
      for (const [key, value] of Object.entries(nse)) changes.set(key, value);
    }
    if (!changes.size) throw new Error('No compatible settings were found.');
    this.preferences.cancel();
    const previous = this.exportData();
    if (keepUndo && replaceNSEKeys) {
      previous.settings = validateSettings({ ...previous.settings, ...this.storage.get(SETTINGS_KEY, {}) });
      previous.searches = validateSearches(this.storage.get(SEARCH_KEY, previous.searches));
    }
    if (mergePreferences) {
      const stored = this.storage.get(SETTINGS_KEY, {});
      changes.set('ep.preferenceUndo', { time: Date.now(), settings: { ...previous.settings, ...stored }, nse: previous.nse });
    }
    const writes = keepUndo ? new Map([['ep.previousImport', previous], ...changes]) : changes;
    const old = new Map(Array.from(writes.keys(), key => [key, this.storage.get(key, undefined)]));
    try {
      for (const [key, value] of writes) value === undefined ? this.storage.delete(key) : this.storage.set(key, value);
    } catch (error) {
      for (const [key, value] of old) {
        try { value === undefined ? this.storage.delete(key) : this.storage.set(key, value); } catch {}
      }
      throw error;
    }
    const conditionalChanged = settings && settings.conditionalRules !== this.settings.conditionalRules;
    if (settings) {
      const before = this.settings; this.settings = settings;
      for (const [key, control] of this.controls || []) {
        if (control.type === 'checkbox') control.checked = settings[key]; else control.value = settings[key];
      }
      if (this.mounted) this.updateMediaPreferences(before);
      this.resultFilters.refreshRulesEditor();
    }
    if ((nse || conditionalChanged) && this.mounted) { this.refreshFilters(true); this.applyAppearance(); }
    if (searches) { this.searches = searches; this.renderSavedSearches(); }
    if (mergePreferences) {
      this.preferences.checkpoint = changes.get('ep.preferenceUndo');
      if (this.undoPreferences) this.undoPreferences.hidden = false;
    }
    // Legacy drawer state only restores management. Saved shortcuts are always visible.
    // Old drawer flags do not reopen management or hide the primary shortcuts.
    if (this.saveStatus) this.saveStatus.textContent = 'Backup restored';
    return changes.size;
  }
  download(name, data) {
    const url = this.win.URL.createObjectURL(new this.win.Blob([data], { type: 'application/json' }));
    const anchor = this.node('a'); anchor.href = url; anchor.download = name;
    this.doc.body.append(anchor); anchor.click(); anchor.remove();
    this.win.setTimeout(() => this.win.URL.revokeObjectURL(url), 1000);
  }
  ensureSavedSearchUI() {
    if (this.disposed || !this.win.document || !this.doc.documentElement) return;
    const form = this.win.location.pathname === '/torrents.php' && !new URL(this.win.location.href).searchParams.has('id') ?
      this.doc.getElementById('search_form') : null;
    const changed = this.savedForm !== form; this.savedForm = form;
    if (!this.savedDrawer?.isConnected) {
      this.savedDrawer = this.node('div', null, 'epc-saved');
      this.searchName = this.node('input'); this.searchName.type = 'text'; this.searchName.maxLength = 300;
      this.searchName.placeholder = 'Name this search'; this.searchName.setAttribute('aria-label', 'Saved search name');
      this.saveNamedSearch = this.button('Save current search', () => this.saveCurrentSearch());
      this.savedFormHint = this.node('p', 'Saved searches can be edited here. Open torrent search to save a new search from its form.', 'epc-caption');
      this.savedList = this.node('div', null, 'epc-saved-list');
      const named = optionGroup(this, this.savedDrawer, 'Save with a name', { key: 'named-search' });
      named.append(this.searchName, this.saveNamedSearch);
      this.namedSearch = named;
      this.savedDrawer.append(this.savedFormHint, this.savedList);
      this.panes.searches.append(this.savedDrawer);
    } else if (!changed) return;
    this.namedSearch.hidden = !form;
    this.savedFormHint.hidden = !!form;
    if (!this.quickSaveSearch) {
      this.quickSaveSearch = this.button('Save search', () => this.saveCurrentSearch());
      this.quickSaveSearch.className = 'epc-quiet epc-quick-search';
      this.quickSaveSearch.prepend(companionIcon(this, 'add'));
      this.toolbarUtilities.append(this.quickSaveSearch);
    }
    this.quickSaveSearch.hidden = !form;
    if (form && changed) {
      this.on(form, 'input', () => this.updateQuickSearch());
      this.on(form, 'change', () => this.updateQuickSearch());
    }
    this.renderSavedSearches();
  }
  refreshSavedSearches() {
    if (this.disposed || !this.win.document || !this.doc.documentElement || !this.mounted || this.savedList?.contains(this.doc.activeElement)) return;
    try {
      const current = validateSearches(this.storage.get(SEARCH_KEY, this.searches));
      if (JSON.stringify(current) !== JSON.stringify(this.searches)) { this.searches = current; this.renderSavedSearches(); }
    } catch { this.toast('Saved searches could not be read. Your current shortcuts are still available.'); }
  }
  saveCurrentSearch() {
    if (!this.savedForm) return;
    const fields = captureSearch(this.savedForm), name = this.searchName?.value.trim();
    const fallback = fields.find(f => ['searchtext', 'title', 'taglist'].includes(f.name) && f.value.trim())?.value;
    const title = (name || fallback || 'All results').slice(0, 300);
    const current = validateSearches(this.storage.get(SEARCH_KEY, this.searches));
    const signature = searchSignature(fields);
    if (current.some(item => searchSignature(item.fields) === signature && (!name || item.title === title))) {
      this.searches = current; this.renderSavedSearches(); this.toast('This search is already saved.'); return;
    }
    current.push({ id: this.win.crypto?.randomUUID?.() || Date.now() + '-' + Math.random(),
      title, date: new Date().toISOString(), fields });
    try { this.persistSearches(current); }
    catch { this.toast('Could not save the search. Your form and saved searches are unchanged.'); return; }
    if (this.searchName) this.searchName.value = '';
    this.toast('Search saved.');
  }
  updateQuickSearch() {
    if (!this.quickSaveSearch || !this.savedForm) return;
    const saved = this.searchSignatures?.has(searchSignature(captureSearch(this.savedForm)));
    this.quickSaveSearch.disabled = !!saved;
    this.quickSaveSearch.hidden = !!saved;
  }
  persistSearches(searches = this.searches, { deletedSearch = this.deletedSearch } = {}) {
    this.storage.set(SEARCH_KEY, searches);
    this.searches = searches; this.deletedSearch = deletedSearch; this.renderSavedSearches();
  }
  renderSavedSearches() {
    if (!this.savedList) return;
    this.savedList.replaceChildren();
    const searches = [...this.searches].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    this.searchSignatures = new Set(searches.map(item => searchSignature(item.fields)));
    if (this.savedShortcuts) {
      this.savedShortcuts.replaceChildren();
      for (const saved of searches) {
        const link = this.searchLink(saved); link.className = 'epc-saved-shortcut';
        link.append(companionIcon(this, 'open'));
        this.savedShortcuts.append(link);
      }
      this.savedShortcuts.hidden = !searches.length;
      this.updateQuickSearch();
    }
    for (const saved of searches) {
      const draft = this.searchEdits.get(saved.id);
      if (draft) { this.savedList.append(draft.row); continue; }
      const row = this.node('div', null, 'epc-saved-row'); row.dataset.searchId = saved.id;
      const run = this.searchLink(saved);
      run.title = [saved.date, ...saved.fields.filter(f => f.type === 'checkbox' ? f.checked : !!f.value)
        .map(f => f.name + ': ' + f.value)].filter(Boolean).join('\n').slice(0, 1000);
      run.className = 'epc-search-name';
      row.append(run);
      const more = this.node('details', null, 'epc-search-more');
      const summary = this.node('summary', 'More'); summary.setAttribute('aria-label', 'Options for ' + saved.title);
      more.append(summary); row.append(more);
      more.append(this.button('Edit search', () => this.editSavedSearch(saved, row)));
      if (this.savedForm) more.append(this.button('Add to site search form', () => this.restoreSearch(saved, true, false)));
      more.append(this.button('Rename', () => {
          const input = this.node('input'); input.value = saved.title; input.maxLength = 300;
          input.setAttribute('aria-label', 'Rename saved search');
          const commit = () => {
            const title = input.value.trim(); if (!title) return;
            const current = validateSearches(this.storage.get(SEARCH_KEY, this.searches));
            const found = current.find(s => s.id === saved.id); if (found) found.title = title;
            try { this.persistSearches(current); }
            catch { this.toast('Could not save the name. Your draft is still here.'); }
          };
          row.replaceChildren(input, this.button('Save name', commit), this.button('Cancel', () => this.renderSavedSearches()));
          input.addEventListener('keydown', e => {
            if (!this.settings.keyboardShortcuts || e.isComposing || this.composing || e.defaultPrevented) return;
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.renderSavedSearches(); }
          });
          input.focus();
        }),
        this.button('Delete', () => {
          const current = validateSearches(this.storage.get(SEARCH_KEY, this.searches));
          const deletedSearch = current.find(s => s.id === saved.id);
          try { this.persistSearches(current.filter(s => s.id !== saved.id), { deletedSearch }); }
          catch { this.toast('Could not delete the search. Your saved searches are unchanged.'); }
        })
      );
      this.savedList.append(row);
    }
    for (const [id, draft] of this.searchEdits) if (!searches.some(saved => saved.id === id)) this.savedList.append(draft.row);
    if (!searches.length) this.savedList.append(this.node('p', 'No saved searches yet.'));
    if (this.deletedSearch) this.savedList.append(this.button('Undo last deletion', () => {
      const current = validateSearches(this.storage.get(SEARCH_KEY, this.searches));
      if (!current.some(s => s.id === this.deletedSearch.id)) current.push(this.deletedSearch);
      try { this.persistSearches(current, { deletedSearch: null }); }
      catch { this.toast('Could not restore the search. Undo is still available.'); }
    }));
  }
  editSavedSearch(saved, row) {
    if (this.searchEdits.has(saved.id)) { this.searchEdits.get(saved.id).editor.focus(); return; }
    const baseline = JSON.stringify([saved.title, saved.fields]), more = row.querySelector('.epc-search-more');
    const findRow = () => [...this.savedList.querySelectorAll('.epc-saved-row')].find(node => node.dataset.searchId === saved.id);
    const editor = createSavedSearchEditor(this, saved, {
      save: draft => {
        const current = validateSearches(this.storage.get(SEARCH_KEY, this.searches));
        const index = current.findIndex(search => search.id === saved.id);
        if (index < 0) throw new Error('This search was deleted elsewhere. Your draft is still here.');
        if (JSON.stringify([current[index].title, current[index].fields]) !== baseline) {
          throw new Error('This search changed elsewhere. Cancel and reopen it to edit the latest version.');
        }
        current[index] = validateSearches([{ ...current[index], ...draft }])[0];
        try { this.storage.set(SEARCH_KEY, current); }
        catch { throw new Error('Could not save. Your changes are still here.'); }
        this.searches = current; this.searchEdits.delete(saved.id); this.renderSavedSearches();
        const updated = findRow(), status = this.node('span', 'Saved changes.', 'epc-caption');
        status.setAttribute('role', 'status'); updated?.append(status);
        updated?.querySelector('.epc-search-name')?.focus({ preventScroll: true });
      },
      cancel: () => {
        this.searchEdits.delete(saved.id);
        try { this.searches = validateSearches(this.storage.get(SEARCH_KEY, this.searches)); } catch {}
        this.renderSavedSearches();
        const current = findRow(), tools = current?.querySelector('.epc-search-more');
        if (tools) { tools.open = true; [...tools.querySelectorAll('button')].find(button => button.textContent === 'Edit search')?.focus({ preventScroll: true }); }
      }
    });
    this.searchEdits.set(saved.id, { row, editor });
    row.classList.add('epc-is-editing'); more.open = true; more.append(editor.element); editor.focus();
  }
  restoreSearch(saved, append, run) {
    if (run) { this.navigate(this.savedSearchURL(saved).href); return; }
    if (!this.savedForm?.isConnected) return;
    applySearch(this.savedForm, saved, append);
    this.revealSearchForm(saved, append);
  }
  searchLink(saved) {
    const link = this.node('a', saved.title); link.href = this.savedSearchURL(saved).href;
    link.dataset.searchId = saved.id; link.title = 'Run saved search: ' + saved.title;
    link.addEventListener('click', event => {
      if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); this.restoreSearch(saved, false, true);
    });
    return link;
  }
  savedSearchURL(saved) {
    const target = new URL('/torrents.php', this.win.location.origin);
    for (const field of saved.fields) {
      if (['checkbox', 'radio'].includes(field.type) && !field.checked) continue;
      if (field.value) target.searchParams.append(field.name, field.value);
    }
    const action = this.savedForm?.querySelector('input[name="action"]')?.value;
    target.searchParams.set('action', ['advanced', 'basic', 'search'].includes(action) ? action : 'advanced');
    return target;
  }
  revealSearchForm(saved, append) {
    const form = this.savedForm, reveal = element => {
      if (element.tagName === 'DETAILS') element.open = true;
      element.hidden = false; element.classList.remove('hidden');
      if (this.win.getComputedStyle(element).display === 'none') element.style.setProperty('display', 'block');
    };
    for (let node = form; node && node !== this.doc.body && node.id !== 'content'; node = node.parentElement) reveal(node);
    for (const control of Array.from(form.elements)) {
      if (control.type === 'hidden') continue;
      for (let node = control.parentElement; node && node !== form; node = node.parentElement) reveal(node);
    }
    if (this.panel && !this.panel.hidden) this.closePane();
    this.doc.getElementById('filter_slidetoggle')?.setAttribute('aria-expanded', 'true');
    if (!this.searchFeedback?.isConnected) {
      this.searchFeedback = this.node('div', null, 'epc-root epc-search-feedback');
      this.searchFeedback.setAttribute('role', 'status');
      this.searchFeedbackText = this.node('span');
      this.searchFeedback.append(this.searchFeedbackText, this.button('Search now', () => {
        this.navigate(this.savedSearchURL({ fields: captureSearch(this.savedForm) }).href);
      }));
      form.prepend(this.searchFeedback);
    }
    this.searchFeedbackText.textContent = (append ? 'Added “' : 'Loaded “') + saved.title + '”' +
      (append ? ' to your current criteria. Review the form, then Search now.' : '. Edit the form, then Search now.');
    const preferred = saved.fields.find(field => ['searchtext', 'title', 'filelist', 'taglist', 'searchstr'].includes(field.name) && field.value.trim());
    const focus = Array.from(form.elements).find(control => control.name === preferred?.name && control.type !== 'hidden') ||
      form.querySelector('input:not([type=hidden]),textarea,select');
    (focus || form).scrollIntoView?.({ block: 'center' });
    focus?.focus({ preventScroll: true });
    this.media.demandListener?.();
  }
  navigate(url) {
    const target = new URL(url, this.win.location.href);
    if (target.origin !== this.win.location.origin || target.searchParams.get('action') === 'download') return;
    if (this.options.navigate) this.options.navigate(target.href); else this.win.location.assign(target.href);
  }
  keydown(event) {
    if (!this.settings.keyboardShortcuts || this.onboarding?.open || event.isComposing || event.defaultPrevented) return;
    if (isSaveShortcut(event) &&
        event.target.closest?.('.epc-workspace') && this.activePane !== 'searches') {
      event.preventDefault(); if (this.dirty) this.applyChanges(); return;
    }
    if (event.key === 'Escape') {
      if (this.preview.open) { event.preventDefault(); this.preview.hide(true); }
      else if (this.doc.getElementById('nseRCMBox') && !this.doc.getElementById('nseRCMBox').classList.contains('hidden')) {
        this.doc.getElementById('nseRCMBox')?.classList.add('hidden');
        this.ruleMenuOrigin?.focus();
      } else if (this.panel && !this.panel.hidden) this.closePane();
      return;
    }
    if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
      const tag = event.target.closest?.('div.tags>a,ul#torrent_tags_list>li>a');
      if (tag) {
        const rect = tag.getBoundingClientRect();
        const menuEvent = new this.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true,
          clientX: rect.left, clientY: rect.bottom });
        tag.dispatchEvent(menuEvent);
        if (menuEvent.defaultPrevented) {
          event.preventDefault(); this.doc.querySelector('#nseRCMBox .nseRCMButton')?.focus();
        }
      }
      return;
    }
    if (editableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.preview.open) {
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); this.preview.retry(); return; }
      if (event.key.toLowerCase() === 'p') { event.preventDefault(); this.preview.pin(); return; }
      if (event.target.closest?.('.epc-root') || this.preview.pinned) return;
    }
    if (event.target.closest?.('.epc-root,#nseOuter') || event.shiftKey) return;
    const scope = this.settings.navigationScope;
    if (scope === 'off' || scope === 'results' && !isNSEPage(this.win.location.href)) return;
    const selectors = event.key === 'ArrowLeft' ? ['.pager_prev', 'a[rel="prev"]', '.pager_first'] :
      event.key === 'ArrowRight' ? ['.pager_next', 'a[rel="next"]', '.pager_last'] : [];
    if (event.key === 'ArrowRight' && this.backfill?.initialized && !this.backfill.nextURL) return;
    for (const selector of selectors) {
      const link = this.doc.querySelector(selector);
      if (link?.href) { event.preventDefault(); this.navigate(link.href); break; }
    }
  }
  syncGridFilters(refreshTags = true, appended) {
    const previous = appended && !this.resultsDirty ? this.resultCounts : null;
    const newRows = previous ? appended : null;
    let revealable = previous?.revealable || 0;
    const seenFiltered = new Set();
    let rows;
    this.batchDOM(() => {
      if (!newRows) for (const [row, marker] of this.detachedFilterRows) {
        if (!marker.isConnected) continue;
        if (this.revealingFiltered && !row.isConnected) {
          marker.after(row); this.schedule(row, false);
        } else if (!this.revealingFiltered && row.isConnected) this.detachFilteredRow(row);
      }
      rows = newRows ? newRows.filter(row => row.isConnected) : [...this.doc.querySelectorAll('tr.torrent')];
      for (const row of rows) {
        const filtered = row.getAttribute('isNSEHidden') === '1';
        const revealed = !!this.revealingFiltered && filtered;
        // Native themes may hide .hidden with a more specific !important rule.
        // Keep the filter identity in isNSEHidden; remove the native hiding class
        // while revealing, just as the site's own visibility toggle does.
        const wasRevealed = row.classList.contains('epc-revealed');
        const hidden = filtered && !revealed;
        if ((filtered || wasRevealed) && row.classList.contains('hidden') !== hidden) row.classList.toggle('hidden', hidden);
        if (wasRevealed !== revealed) row.classList.toggle('epc-revealed', revealed);
        const { seenFiltered: seen, outsideView } = this.resultFilters.applyRow(row);
        if (seen) seenFiltered.add(row);
        if (!outsideView && (filtered || seen)) revealable++;
        let reason;
        if (this.revealingFiltered && !outsideView) {
          if (filtered) reason = this.resultFilters.engineReasons.get(row) || 'Hidden by a filter';
          else if (seen) reason = 'Already seen';
        }
        this.resultFilters.renderReason(row, reason);
      }
    });
    const cards = this.doc.querySelectorAll('.torrent_grid__torrent'), affectedCards = [];
    if (cards.length) {
      const visibility = new Map(newRows ? [] : Array.from(this.removedFilterIDs, id => [id, { hidden: true }]));
      for (const row of newRows || rows) {
        const id = torrentID(row, this.win.location.href);
        if (!id) continue;
        visibility.set(id, {
          hidden: !row.isConnected || row.classList.contains('epc-filter-hidden') || !row.classList.contains('epc-revealed') &&
            (row.classList.contains('hidden') || row.classList.contains('nseHardPassRemove')),
          dim: row.classList.contains('epc-seen-dim')
        });
      }
      for (const card of cards) {
        const state = visibility.get(torrentID(card, this.win.location.href));
        if (state) {
          card.classList.toggle('epc-filter-hidden', state.hidden);
          card.classList.toggle('epc-seen-dim', !!state.dim);
          affectedCards.push(card);
        } else if (!newRows) this.resultFilters.applyRow(card);
      }
    }
    this.resultFilters.syncFreeleech(!!(rows.length || cards.length || previous?.total || this.detachedFilterRows.size));
    if (newRows) {
      this.versions?.append(newRows); this.grid?.append(rows);
    } else {
      this.batchDOM(() => this.versions?.refresh()); this.grid?.refresh();
    }
    if (refreshTags) this.tags?.refresh(newRows ? rows : undefined);
    if (this.filterSummary) {
      const archived = newRows ? newRows.filter(row => this.detachedFilterRows.has(row)) : [...this.detachedFilterRows.keys()];
      const removed = (previous?.removed || 0) + archived.filter(row => !row.isConnected).length;
      revealable += archived.filter(row => !row.isConnected && !this.resultFilters.outsideView(row)).length;
      const filtered = (previous?.filtered || 0) + rows.filter(row => row.getAttribute('isNSEHidden') === '1' || seenFiltered.has(row)).length;
      const grouped = this.versions?.collapsed || 0;
      const eligible = rows.filter(row => !row.hidden && !row.classList.contains('epc-filter-hidden') &&
        (newRows || !row.classList.contains('epc-version-hidden')) &&
        (row.classList.contains('epc-revealed') || !row.classList.contains('nseHardPassRemove') && !row.classList.contains('hidden'))).length;
      // A new version can also collapse existing rows that had no group before.
      const shown = previous ? previous.shown + eligible - (grouped - previous.grouped) : eligible;
      this.resultCounts = { total: (previous?.total || 0) + rows.length, shown, grouped, filtered, removed, revealable }; this.renderResultSummary();
      this.toggleFiltered.disabled = !revealable;
      this.toggleFiltered.hidden = !revealable || !this.storage.get('nseFloatingToggleButtonEnabled', true);
      this.filteredCount.textContent = revealable.toLocaleString();
      this.filteredLabel.textContent = this.revealingFiltered ? 'Hide filtered' : 'Show filtered';
      this.toggleFiltered.setAttribute('aria-label', this.filteredLabel.textContent + ' (' + this.filteredCount.textContent + ')');
      styleRowControls(this, newRows ? rows : undefined);
    }
    this.backfill?.sync();
    this.backfill?.activateImages(rows, newRows ? affectedCards : cards);
    this.media?.invalidateLayout();
    if (this.preview?.open && !this.preview.pinned && this.preview.anchor?.closest('.epc-filter-hidden')) this.preview.hide(true);
  }
  groupVisibilityChanged(difference) {
    if (this.resultCounts) {
      this.resultCounts.shown += difference; this.resultCounts.grouped -= difference; this.renderResultSummary();
    }
    this.scheduleHealth();
    this.media?.invalidateLayout();
  }
  renderResultSummary() {
    if (!this.resultCounts || !this.filterSummary) return;
    const { total, shown, grouped, filtered, removed, revealable } = this.resultCounts;
    const revealed = this.revealingFiltered ? revealable : 0;
    const caption = total || removed ? shown + ' shown' + (grouped ? ' · ' + grouped + ' grouped' : '') +
      (revealed ? ' · ' + revealed + ' revealed' : filtered ? ' · ' + filtered + ' filtered' : '') +
      (removed ? ' · ' + removed + ' removed' : '') : '';
    if (this.filterSummary.textContent !== caption) this.filterSummary.textContent = caption;
  }
  rememberRemovedFilters(root) {
    const rows = root.matches?.('tr.nseHardPassRemove') ? [root] : root.querySelectorAll?.('tr.nseHardPassRemove') || [];
    for (const row of rows) {
      const link = row.querySelector('a[href*="torrents.php?id="]');
      if (link) this.removedFilterIDs.add(new URL(link.href).searchParams.get('id'));
    }
  }
  filtersFinished() {
    const initial = !this.filtersReady;
    this.filtersReady = true;
    this.syncGridFilters(false);
    if (initial) {
      this.attachWorkspace(); this.ensureSavedSearchUI(); this.resultsDirty = false;
    }
    for (const [element, callback] of this.media.near) if (this.media.visible(element, true)) callback();
    this.media.prepareThumbnails();
    this.schedule(this.doc.body, !initial);
  }
  buildLoadProgress(brand, main) {
    const wrapper = this.loadProgress = this.node('div', null, 'epc-load-progress');
    const panel = this.node('div', null, 'epc-load-detail'); panel.id = 'epc-load-detail'; panel.hidden = true;
    const show = open => {
      if (open) panel.style.top = (trigger.getBoundingClientRect().bottom - main.getBoundingClientRect().top) + 'px';
      panel.hidden = !open; trigger.setAttribute('aria-expanded', String(open));
    };
    let pinned = false, hovering = false;
    const trigger = this.loadGauge = this.button('—', () => {
      pinned = !pinned; show(pinned || hovering);
    }, 'Load progress');
    trigger.className = 'epc-load-gauge';
    trigger.setAttribute('aria-controls', panel.id);
    trigger.setAttribute('aria-describedby', panel.id);
    trigger.setAttribute('aria-expanded', 'false');
    wrapper.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'touch') { hovering = true; show(true); }
    });
    wrapper.addEventListener('pointerleave', () => {
      hovering = false;
      if (!pinned && !trigger.matches(':focus-visible')) show(false);
    });
    trigger.addEventListener('focus', () => show(true));
    trigger.addEventListener('blur', () => { if (!pinned && !hovering) show(false); });
    this.on(this.doc, 'keydown', event => {
      if (event.key !== 'Escape' || panel.hidden || wrapper.hidden || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation(); pinned = false; show(false);
    });
    this.on(this.doc, 'pointerdown', event => {
      if (pinned && !wrapper.contains(event.target)) { pinned = false; show(false); }
    });
    this.loadRows = new Map();
    panel.append(this.node('strong', 'Load progress'));
    this.loadIdle = this.node('p', 'Nothing queued'); panel.append(this.loadIdle);
    for (const [key, label] of Object.entries(loadLabels)) {
      const row = this.node('div', null, 'epc-load-row'); row.dataset.loadKind = key; row.hidden = true;
      const status = this.node('span', '', 'epc-load-count');
      const bar = this.node('progress'); bar.setAttribute('aria-hidden', 'true');
      row.append(this.node('span', label), status, bar); panel.append(row);
      this.loadRows.set(key, { row, status, bar });
    }
    wrapper.append(trigger, panel); brand.append(wrapper);
    wrapper.hidden = !this.settings.progressBar;
  }
  updateHealth() {
    if (!this.health) return;
    const loads = this.media.loadCounts();
    const failedImages = Object.values(loads).reduce((sum, counts) => sum + counts.failed, 0);
    const pages = this.backfill.loadProgress;
    if (pages) {
      loads.backfill = {
        ...emptyLoadCounts(), ready: pages.loaded, failed: Number(pages.status === 'failed'),
        pending: pages.status === 'loading' && pages.limit !== null ? Math.max(0, pages.limit - pages.loaded) : 0,
        indeterminate: pages.status === 'loading' && pages.limit === null,
        note: pages.status === 'stopped' ? 'Stopped' : ''
      };
    }
    if (this.collageQuickAdd.operation) loads.collage = { ...emptyLoadCounts(), indeterminate: true };
    let total = 0, finished = 0, failed = 0, indeterminate = false, hasRows = false;
    for (const [key, { row, status, bar }] of this.loadRows) {
      const counts = loads[key];
      const done = counts ? counts.ready + counts.partial + counts.failed : 0;
      const size = done + (counts?.pending || 0);
      row.hidden = !(size || counts?.deferred || counts?.indeterminate || counts?.note);
      if (row.hidden) continue;
      hasRows = true; indeterminate ||= !!counts.indeterminate;
      if (!counts.indeterminate) { total += size; finished += done; }
      failed += counts.failed;
      const parts = [
        counts.indeterminate ? (counts.ready ? counts.ready + ' ready' : '') : size ? counts.ready + '/' + size + ' ready' : '',
        counts.pending ? counts.pending + ' pending' : '',
        counts.partial ? counts.partial + ' partial' : '',
        counts.failed ? counts.failed + ' failed' : '',
        counts.deferred ? counts.deferred + ' deferred' : '',
        counts.indeterminate ? 'Loading…' : counts.note
      ];
      status.textContent = parts.filter(Boolean).join(' · ');
      bar.hidden = !(size || counts.indeterminate);
      bar.max = size || 1;
      if (counts.indeterminate) bar.removeAttribute('value'); else bar.value = done;
    }
    this.loadProgress.hidden = !this.settings.progressBar;
    this.loadIdle.hidden = hasRows;
    const percent = total && !indeterminate ? Math.floor(finished * 100 / total) + '%' : '';
    this.loadGauge.textContent = percent || (indeterminate ? '…' : '—');
    this.loadGauge.style.setProperty('--epc-load-fill', percent || '0%');
    this.loadGauge.setAttribute('aria-label', 'Load progress, ' +
      (percent ? percent + ' processed' : indeterminate ? 'loading, total unknown' : 'nothing queued') +
      (failed ? ', ' + failed + ' failed' : ''));
    this.health.hidden = !failedImages && !this.settings.diagnostics;
    this.health.textContent = failedImages ? failedImages + (failedImages === 1 ? ' image unavailable' : ' images unavailable') : '';
  }
  scheduleHealth() {
    if (this.healthFrame || this.disposed) return;
    this.healthFrame = this.win.requestAnimationFrame(() => {
      this.healthFrame = null; if (!this.disposed) this.updateHealth();
    });
  }
  restartMedia() {
    this.preview.dispose(); this.media.dispose();
    this.media = new PageMedia(this); this.preview = new PreviewController(this); this.preview.build();
    this.syncCoverMotionControls();
    this.updateHealth();
    for (const [key, control] of this.controls) {
      if (control.type === 'checkbox') control.checked = this.settings[key]; else control.value = this.settings[key];
    }
    this.schedule(this.doc.body);
    applyWorkspaceTheme(this);
  }
  dispose() {
    this.disposed = true; this.observer?.disconnect(); this.backfill?.dispose(); this.preview?.dispose(); this.media?.dispose();
    this.collageQuickAdd?.dispose();
    this.onboarding?.dispose();
    this.cancelCacheUsage();this.cacheUsageUnsubscribe?.();
    this.imageCache?.close();
    this.versions?.dispose(); this.tags?.dispose();
    this.grid?.dispose();
    this.preferences.cancel(); this.win.clearTimeout(this.toastTimer); this.win.clearTimeout(this.filterRefreshTimer);
    if (this.healthFrame) this.win.cancelAnimationFrame(this.healthFrame);
    this.customStyle?.remove();
    for (const cleanup of this.cleanups) cleanup();
    this.searchEdits.clear();
    this.root?.remove(); this.savedDrawer?.remove(); this.searchFeedback?.remove();
    this.doc.getElementById('nseRCMBox')?.remove();
  }
}

// Media and preview controllers follow; they share one request scheduler.

class PageMedia {
  constructor(app) {
    this.app = app; this.win = app.win; this.doc = app.doc;
    this.definitions = new Map(); this.scriptText = new WeakMap(); this.knownVariants = new Map();
    this.records = new Map(); this.thumbnails = new Map(); this.thumbnailsByOriginal = new Map(); this.near = new Map();
    this.gridGifs = new Map();
    this.reducedMotion = this.win.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.motionListener = () => {
      app.syncCoverMotionControls();
      this.prepareThumbnails();
      app.scheduleHealth();
    };
    this.reducedMotion?.addEventListener('change', this.motionListener);
    this.layoutVersion = 0;
    this.viewportTop = this.win.scrollY; this.viewportHeight = this.win.innerHeight;
    this.nativeTimers = new Set(); this.disposed = false;
    this.syncCoverGate();
    this.pool = new MediaPool({
      Image: app.options.Image || this.win.Image, now: () => Date.now(),
      imageCache: app.imageCache,
      diagnostic: (entry, kind, details) => app.record(entry, kind, details),
      hostHistory: app.storage.get('ep.hostHistory', []), saveHosts: history => app.storage.set('ep.hostHistory', history),
      priorityRevision: () => `${this.layoutVersion}/${this.viewportTop}/${this.viewportHeight}/${app.settings.preloadScreens}`,
      setTimeout: this.win.setTimeout.bind(this.win), clearTimeout: this.win.clearTimeout.bind(this.win),
      hidden: () => this.doc.hidden, report: error => app.report(error)
    }, app.settings);
    this.pool.listeners.add(entry => {
      app.record(entry, 'scheduled'); app.scheduleHealth();
      if (entry.status === 'ready' && !entry.gridAutoplay) for (const record of this.thumbnailsByOriginal.get(entry.actualKey) || []) {
        this.useLoadedOriginal(record, entry);
      }
      if (['ready','streaming','partial'].includes(entry.status)) app.preview?.acceptRecovered(entry);
    });
    const history = app.storage.get('ep.thumbnailHistory', []);
    this.thumbnailHistory = new Map((Array.isArray(history) ? history : []).filter(item =>
      Array.isArray(item) && item.length === 2 && typeof item[1] === 'object' && item[1] &&
      Date.now() - item[1].time < 7 * 86400000 && safeImageURL(item[1].src, this.win.location.href)));
    this.makeObserver();
    this.resizeListener = () => { this.makeObserver(); this.invalidateLayout(); this.demandListener(); this.app.preview?.position(); };
    this.win.addEventListener('resize', this.resizeListener, { passive: true });
    this.demandListener = event => {
      if (event?.target?.nodeType === 1) this.invalidateLayout(); // Scrolling an inner container changes document-relative positions.
      if (this.demandPending) return;
      this.demandPending = true;
      this.win.requestAnimationFrame(() => {
        this.demandPending = false;
        if (this.disposed) return;
        for (const [target, callback] of this.near) if (this.visible(target, true)) callback();
        this.prepareThumbnails();
        this.planAutomaticRecovery();
      });
    };
    this.win.addEventListener('scroll', this.demandListener, { passive: true, capture: true });
    this.doc.addEventListener('visibilitychange', this.demandListener);
    if (this.win.ResizeObserver) this.layoutObserver = new this.win.ResizeObserver(() => {
      this.invalidateLayout(); this.demandListener();
    });
  }
  makeObserver() {
    this.intersection?.disconnect();
    if (this.win.IntersectionObserver) {
      this.intersection = new this.win.IntersectionObserver(entries => {
        for (const item of entries) if (item.isIntersecting) this.near.get(item.target)?.();
        this.pool.pump();
      }, { rootMargin: Math.round(this.win.innerHeight * this.app.settings.preloadScreens) + 'px 0px', threshold: 0 });
      for (const target of this.near.keys()) this.intersection.observe(target);
    } else if (!this.fallbackListener) {
      this.fallbackListener = () => {
        if (this.fallbackPending) return; this.fallbackPending = true;
        this.win.requestAnimationFrame(() => {
          this.fallbackPending = false;
          for (const [target, callback] of this.near) if (this.visible(target, true)) callback();
        });
      };
      this.win.addEventListener('scroll', this.fallbackListener, { passive: true });
      this.win.addEventListener('resize', this.fallbackListener, { passive: true });
    }
  }
  updateSettings(previous) {
    const settings = this.app.settings;
    this.invalidateLayout();
    this.syncCoverGate();
    this.pool.settings = settings; this.pool.budget.maxRetries = settings.maxRetries;
    for (const [element, record] of this.records) if (record.kind === 'background') {
      const playbackChanged = record.coverArt && settings.gridAutoplayGifs !== previous.gridAutoplayGifs;
      if (!settings.recoverBackgrounds || record.coverArt && (settings.thumbnailMode !== previous.thumbnailMode ||
          playbackChanged && record.state !== 'ready')) {
        this.clearRecord(record); this.clearCover(record); this.intersection?.unobserve(element); this.near.delete(element);
        this.records.delete(element); this.pool.abandon(record.lastEntry);
      } else if (!settings.gridAutoplayGifs) this.stopGridGif(record);
    }
    for (const [row, record] of this.thumbnails) {
      if (!this.thumbnailsEnabled(row)) {
        this.removeThumbnail(record); continue;
      }
      record.element.style.setProperty('--epc-thumb-size', settings.thumbnailSize + 'px');
      const link = record.link || row.querySelector('a[data-ep-overlay]');
      const category = row.querySelector('td.cats_col,td.cats_cols');
      const cell = link?.closest('td');
      const destination = settings.resultsView !== 'grid' && settings.thumbnailPlacement === 'category' && category &&
        !this.app.storage.get('nseHideCategoryIconsEnabled', false) ? category : cell;
      if (destination && record.element.parentNode !== destination) {
        if (destination === category) destination.append(record.element); else destination.prepend(record.element);
      }
      for (const value of ['keep','overlay','hide']) {
        const name = 'epc-category-' + value, wanted = value === settings.categoryDisplay;
        if (row.classList.contains(name) !== wanted) row.classList.toggle(name, wanted);
      }
      const grid = row.closest('table')?.classList.contains('epc-result-grid');
      if (!this.coverAutoplayEnabled(record)) this.stopGridGif(record);
      const entry = record.lastEntry, usable = ['ready', 'partial'].includes(record.state);
      const changedLayout = settings.resultsView !== previous.resultsView;
      const listAutoplay = this.listCoverAutoplay(row);
      const listPlaybackChanged = !grid && row.matches('tr.torrent') && settings.listAutoplayGifs !== previous.listAutoplayGifs;
      const layoutNeedsReload = changedLayout && (!usable || grid && (!entry ||
        !this.thumbnailOptions(record.source, null, 'grid')?.candidates.includes(canonicalImageURL(entry.actualURL))));
      if (layoutNeedsReload || listPlaybackChanged && (!usable || !listAutoplay) ||
          !grid && !listAutoplay && settings.thumbnailMode !== previous.thumbnailMode) {
        record.unsubscribe?.(); record.unsubscribe = null; this.pool.abandon(entry);
        if (entry?.target === record.image && !entry.cancelled) {
          // The previous image can still serve a preview. Keep its source
          // intact and give the new thumbnail its own element.
          const image = record.image.cloneNode(false);
          record.image.replaceWith(image); record.image = image;
          entry.target = null;
        }
        record.image.removeAttribute('src'); delete record.image.dataset.epImageSource;
        record.gifPoster?.remove(); record.gifPoster = null;
        record.lastEntry = null; record.state = 'deferred'; record.element.dataset.state = 'deferred';
        record.failedAt = null; record.autoRecoveryAttempted = false;
        record.status.textContent = 'Waiting'; record.status.hidden = false;
      } else if ((grid || listAutoplay) && (changedLayout || listPlaybackChanged) && entry) this.drawGridGifPoster(record, entry);
    }
    if (settings.preloadScreens !== previous.preloadScreens) this.makeObserver();
    this.pool.trim(); this.pool.pump();
    this.app.schedule(this.doc.getElementById('content') || this.doc.body);
  }
  failedRecords() {
    return [...this.records.values(), ...this.thumbnails.values()].filter(record =>
      record.state === 'failed' && !record.autoRecoveryAttempted && record.lastEntry &&
      (record.kind !== 'image' || this.app.settings.recoverImages) &&
      (record.kind !== 'background' || this.app.settings.recoverBackgrounds) && this.visible(record.element, true));
  }
  pendingRecovery(url) {
    return this.app.settings.maxRetries > 0 && [...this.records.values(), ...this.thumbnails.values()].some(record =>
      record.state === 'failed' && !record.autoRecoveryAttempted && fullSizeURL(record.source) === fullSizeURL(url));
  }
  trackRecovery(record, entry) {
    record.lastEntry = entry;
    if (entry.status === 'failed') {
      record.failedAt ||= this.pool.env.now();
      this.planAutomaticRecovery();
    }
  }
  planAutomaticRecovery() {
    this.pool.env.clearTimeout(this.recoveryTimer); this.recoveryTimer = null;
    if (this.disposed || !this.app.settings.maxRetries || this.doc.hidden || this.win.navigator.onLine === false) return;
    const records = this.failedRecords();
    if (!records.length) return;
    const deadline = Math.min(...records.map(record =>
      Math.max(record.failedAt, this.pool.budget.get(record.lastEntry.url).last) + 31000));
    this.recoveryTimer = this.pool.env.setTimeout(() => this.resumeAutomaticRecovery(),
      Math.max(0, deadline - this.pool.env.now()));
  }
  resumeAutomaticRecovery(online = false) {
    if (this.disposed || !this.app.settings.maxRetries || this.doc.hidden || this.win.navigator.onLine === false) return;
    const now = this.pool.env.now();
    for (const record of this.failedRecords()) {
      if (!online && now < Math.max(record.failedAt, this.pool.budget.get(record.lastEntry.url).last) + 31000) continue;
      record.autoRecoveryAttempted = true;
      if (record.kind === 'image') this.recover(record, true, true, true);
      else if (record.kind === 'background') this.loadBackground(record, true, true);
      else this.loadThumbnail(record, true, true);
    }
    this.planAutomaticRecovery();
  }
  invalidateLayout() { this.layoutVersion++; }
  displayed(element, record) {
    if (!element?.isConnected || element.closest('.hidden:not(.epc-revealed),[hidden],.epc-filter-hidden,.epc-version-hidden')) return false;
    const position = record && this.thumbnailPosition(record);
    if (position?.displayed !== undefined) return position.displayed;
    const style = element.getClientRects().length && this.win.getComputedStyle(element);
    const displayed = !!style && style.visibility !== 'hidden' && style.display !== 'none';
    if (position) position.displayed = displayed;
    return displayed;
  }
  visible(element, ahead = false) {
    if (!this.displayed(element)) return false;
    const rect = element.getBoundingClientRect(), margin = ahead ? this.win.innerHeight * this.app.settings.preloadScreens : 0;
    return rect.bottom >= -margin && rect.top <= this.win.innerHeight + margin;
  }
  thumbnailPosition(record) {
    if (record.position?.version !== this.layoutVersion) {
      // Document coordinates remain useful while the window scrolls.
      const rect = record.element.getBoundingClientRect(), scroll = this.win.scrollY;
      record.position = { version: this.layoutVersion, top: rect.top + scroll, bottom: rect.bottom + scroll };
    }
    return record.position;
  }
  thumbnailDistance(record) {
    const { top, bottom } = this.thumbnailPosition(record), scroll = this.viewportTop;
    const height = Math.max(1, this.viewportHeight);
    return Math.max(top - scroll - height, scroll - bottom, 0) / height;
  }
  thumbnailPriority(record) {
    // Queue ranking is a read pass. Cache visibility here so each dispatch
    // does not measure layout again after the previous image changed the DOM.
    if (!this.displayed(record.element, record)) return 0;
    const distance = this.thumbnailDistance(record);
    if (!distance) return 80;
    return distance <= this.app.settings.preloadScreens ? 40 - distance : 10 / (1 + distance);
  }
  prepareThumbnails(rows, cards) {
    if (this.disposed || !this.app.filtersReady) return;
    const playGifs = (this.app.settings.gridAutoplayGifs || this.listCoverAutoplay()) && !this.reducedMotion?.matches;
    if (!playGifs && this.gridGifs.size) this.pool.batch(() => {
      for (const record of this.gridGifs.keys()) this.stopGridGif(record);
    });
    if (this.doc.hidden) {
      for (const record of this.gridGifs.keys()) this.syncGridGif(record);
      return;
    }
    // Scroll and resize already request this pass. Reading the viewport from
    // the scheduler would force layout again after each image updates its DOM.
    this.viewportTop = this.win.scrollY; this.viewportHeight = this.win.innerHeight;
    // Warm the current result list as slots finish, even when the user stays at
    // the top. Nearby rows lead; filtering and closed galleries still apply.
    const records = rows ? rows.map(row => this.thumbnails.get(row)).filter(Boolean) : [...this.thumbnails.values()];
    if (this.app.settings.recoverBackgrounds) {
      if (!rows) {
        for (const record of this.records.values()) if (record.coverArt) records.push(record);
      } else if (cards) for (const card of cards) for (const cover of card.querySelectorAll('.torrent__cover')) {
        const record = this.records.get(cover);
        if (record?.coverArt) records.push(record);
      }
    }
    // Measure the batch before queue updates write image status into the DOM.
    for (const record of records) if (record.state === 'deferred') this.displayed(record.element, record);
    this.pool.batch(() => {
      for (const record of records) {
        if (record.coverArt) this.loadBackground(record);
        else this.loadThumbnail(record);
        if (playGifs) this.syncGridGif(record);
      }
      this.pool.pump();
    });
  }
  thumbnailsEnabled(row) {
    return this.app.settings.inlineThumbnails || this.listCoverAutoplay(row) || this.app.settings.resultsView === 'grid' &&
      (row ? row.closest('table')?.classList.contains('epc-result-grid') : true);
  }
  listCoverAutoplay(row) {
    const { settings } = this.app;
    return settings.resultsView === 'list' && settings.listAutoplayGifs && (!row || row.matches('tr.torrent'));
  }
  watchNear(element, callback) {
    this.near.set(element, callback);
    if (this.intersection) this.intersection.observe(element);
    if (this.visible(element, true)) callback();
  }
  collectDefinitions(root) {
    const metadata = root.matches?.('a[data-ep-backfill-preview]') ? [root] :
      root.querySelectorAll?.('a[data-ep-backfill-preview]') || [];
    for (const link of metadata) {
      try {
        const def = JSON.parse(link.dataset.epBackfillPreview), src = safeImageURL(def.src, this.win.location.href);
        if (!/^overlay\d+$/.test(def.name) || !src) continue;
        const thumbnail = safeImageURL(def.thumbnail, this.win.location.href);
        this.registerDefinition({ name: def.name, src, summary: String(def.summary || '').slice(0, 800),
          ...(thumbnail ? { thumbnail } : {}) });
      } catch {}
    }
    const scripts = root.matches?.('script:not([src])') ? [root] : Array.from(root.querySelectorAll?.('script:not([src])') || []);
    for (const script of scripts) {
      const text = script.textContent;
      if (this.scriptText.get(script) === text) continue;
      this.scriptText.set(script, text);
      if (!/\boverlay\d+\s*=/.test(text)) continue;
      for (const def of parseOverlayDefinitions(text, this.win.location.href)) {
        this.registerDefinition(def);
      }
    }
  }
  registerDefinition(def) {
    this.definitions.set(def.name, def);
    if (def.thumbnail) this.registerVariant(fullSizeURL(def.src), def.thumbnail);
    this.rememberVariant(def.src);
  }
  scan(root, prepare = true) {
    if (this.disposed || !this.app.settings.enabled || root.closest?.(OWN)) return;
    if (!this.observedLayout && this.doc.body && this.layoutObserver) {
      this.layoutObserver.observe(this.doc.body); this.observedLayout = true;
    }
    this.collectDefinitions(root);
    const images = root.tagName === 'IMG' ? [root] : Array.from(root.querySelectorAll?.('img') || []);
    for (const image of images) this.inspect(image);
    if (this.thumbnailsEnabled()) {
      const rows = new Set(root.matches?.('tr.torrent,#request_table tr') ? [root] :
        Array.from(root.querySelectorAll?.('tr.torrent,#request_table tr') || []));
      const parent = root.closest?.('tr.torrent,#request_table tr'); if (parent) rows.add(parent);
      for (const row of rows) this.addThumbnail(row);
    }
    if (this.app.settings.recoverBackgrounds) {
      const covers = root.matches?.('.torrent__cover') ? [root] : Array.from(root.querySelectorAll?.('.torrent__cover') || []);
      for (const cover of covers) this.addBackground(cover);
    }
    if (prepare && !root.matches?.('img,source')) this.prepareThumbnails();
    this.app.scheduleHealth();
  }
  rememberVariant(src) {
    if (/\.(th|md)\.[^/.?]+(?:\?|$)/i.test(src) || smallLegacyResize(src)) this.registerVariant(fullSizeURL(src), src);
  }
  registerVariant(original, variant) {
    if (!this.knownVariants.has(original)) this.knownVariants.set(original, new Set());
    this.knownVariants.get(original).add(variant);
  }
  requestedSource(image) {
    const raw = image.getAttribute('src');
    if (image.getAttribute('srcset') && image.currentSrc) return safeImageURL(image.currentSrc, this.win.location.href);
    return raw ? safeImageURL(raw, this.win.location.href) : null;
  }
  inspect(image, explicitError = false) {
    if (this.disposed || !this.app.settings.enabled || !image.isConnected ||
        image.closest(OWN) || !image.closest('#content') || image.closest('.avatar,.avatar_container,.user_avatar')) return;
    const raw = this.requestedSource(image);
    const deferred = safeImageURL(image.getAttribute('data-src'), this.win.location.href);
    if ((!raw && !deferred) || raw?.includes('/static/')) return;
    if (raw) this.rememberVariant(raw); if (deferred) this.rememberVariant(deferred);
    let record = this.records.get(image);
    if (!record) {
      record = { element: image, kind: 'image', source: raw, state: 'empty', revision: 0, nativeStarted: Date.now(),
        originalInlineSize: image.style.inlineSize, originalAspect: image.style.aspectRatio };
      this.records.set(image, record);
      if (!image.classList.contains('epc-page-image')) image.classList.add('epc-page-image');
    }
    if (raw !== record.source && raw !== record.appliedURL) {
      this.clearRecord(record); record.source = raw; record.appliedURL = null; record.revision++;
      record.nativeStarted = Date.now();
    }
    if (!raw) {
      record.state = deferred ? 'deferred' : 'empty';
      if (deferred && this.app.settings.prepareGalleries && image.getAttribute('loading') !== 'lazy') image.loading = 'lazy';
      this.app.scheduleHealth(); return;
    }
    if (image.naturalWidth > 0 && image.naturalWidth <= 32 && image.naturalHeight <= 32) return;
    if (record.recovering) return;
    record.state = explicitError ? 'failed' : imageState({ hasSource: true, complete: image.complete,
      width: image.naturalWidth, stalled: Date.now() - record.nativeStarted >= this.app.settings.stallMs });
    if (record.state === 'ready') {
      this.clearTimer(record); this.restoreSpace(record); this.removeRetry(record);
      this.near.delete(image); this.intersection?.unobserve(image);
    } else if (record.state === 'failed' || record.state === 'stalled') {
      this.clearTimer(record); this.showRetry(record);
      if (this.app.settings.recoverImages && this.visible(image, true) && !record.recovering && !record.recoveryDone) {
        this.recover(record, false, record.state === 'stalled');
      }
      else this.watchNear(image, () => {
        if (['failed', 'stalled'].includes(record.state)) this.showRetry(record);
        if (['failed', 'stalled'].includes(record.state) && !record.recovering && !record.recoveryDone && this.app.settings.recoverImages) {
          this.recover(record, false, record.state === 'stalled');
        }
      });
    } else if (!record.timer && !record.recovering) {
      if (this.app.settings.reserveImageSpace && this.visible(image, true) && !image.naturalWidth) this.reserveSpace(record);
      const revision = record.revision;
      record.timer = this.win.setTimeout(() => {
        record.timer = null;
        if (this.disposed || revision !== record.revision || !image.isConnected || image.complete) return;
        record.state = image.naturalWidth ? 'streaming' : 'stalled';
        if (image.naturalWidth) this.restoreSpace(record);
        this.showRetry(record);
        if (!image.naturalWidth && this.app.settings.recoverImages && this.visible(image, true)) this.recover(record, false, true);
        this.app.scheduleHealth();
      }, this.app.settings.stallMs);
      this.watchNear(image, () => {
        if (!this.visible(image, true) || !['failed', 'stalled', 'streaming'].includes(record.state)) return;
        this.showRetry(record);
        if (record.state !== 'streaming' && !record.recovering && !record.recoveryDone && this.app.settings.recoverImages) {
          this.recover(record, false, true);
        }
      });
    }
    if (image.naturalWidth) this.restoreSpace(record);
    if (!this.visible(image) && image.getAttribute('fetchpriority') === null) image.fetchPriority = 'low';
    if (this.app.settings.compactBodyImages) {
      if (!image.classList.contains('epc-compact')) image.classList.add('epc-compact');
    }
    else if (image.classList.contains('epc-compact')) image.classList.remove('epc-compact');
    this.app.scheduleHealth();
  }
  reserveSpace(record) {
    if (!record.reserved && record.element.getBoundingClientRect().width === 0) {
      record.element.style.inlineSize = 'min(100%, 500px)'; record.reserved = true;
    }
    if (!record.element.style.aspectRatio) { record.element.style.aspectRatio = 'auto 16 / 9'; record.aspectReserved = true; }
  }
  restoreSpace(record) {
    if (record.reserved) { record.element.style.inlineSize = record.originalInlineSize; record.reserved = false; }
    if (record.aspectReserved) { record.element.style.aspectRatio = record.originalAspect; record.aspectReserved = false; }
  }
  clearTimer(record) { if (record.timer) this.win.clearTimeout(record.timer); record.timer = null; }
  clearRecord(record) {
    this.clearTimer(record); record.unsubscribe?.(); record.unsubscribe = null;
    record.recovering = false; record.recoveryDone = false; this.removeRetry(record);
    record.failedAt = null; record.autoRecoveryAttempted = false;
  }
  showRetry(record) {
    if (record.retryButton || !this.visible(record.element)) return;
    const button = this.app.button('Retry image', event => {
      event.preventDefault(); event.stopPropagation(); this.recover(record, true, true);
    });
    button.className = 'epc-root epc-media-retry';
    button.setAttribute('aria-label', 'Retry this image');
    // Do not nest a button inside an existing image link.
    const anchor = record.element.closest('a');
    (anchor || record.element).after(button); record.retryButton = button;
  }
  removeRetry(record) { record.retryButton?.remove(); record.retryButton = null; }
  recover(record, manual = false, fresh = false, rescue = false) {
    if (!record.source || this.disposed || !record.element.isConnected) return;
    if (!manual && record.recoveryDone) return;
    const revision = record.revision, expected = this.requestedSource(record.element);
    record.unsubscribe?.(); record.unsubscribe = null;
    const original = this.app.settings.legacyFallback && legacyOriginal(record.source);
    const entry = this.pool.request(record.source, { lane: 'large', priority: this.visible(record.element) ? 80 : 20,
      failedAlready: !rescue, force: manual, fresh: rescue || fresh && !original, rescue, singleAttempt: rescue,
      candidates: original ? [original, record.source] : [record.source] });
    if (!entry) { this.app.toast('That image has reached its retry limit. Try again after a short pause.'); return; }
    record.recovering = true; record.recoveryDone = false;
    const update = item => {
      if (revision !== record.revision || !record.element.isConnected || this.disposed) return;
      const current = this.requestedSource(record.element);
      if (current !== expected && current !== record.appliedURL) return;
      record.state = item.status;
      this.trackRecovery(record, item);
      if (['ready', 'streaming', 'partial'].includes(item.status) && item.image?.naturalWidth) {
        record.appliedURL = item.actualURL;
        // Retire an errored srcset selection as well, so it cannot override recovery.
        if (record.element.hasAttribute('srcset')) {
          record.element.dataset.epOriginalSrcset = record.element.getAttribute('srcset');
          record.element.removeAttribute('srcset');
        }
        if (record.element.getAttribute('src') !== item.actualURL) record.element.src = item.actualURL;
        this.restoreSpace(record);
      }
      if (['ready', 'partial', 'failed'].includes(item.status)) {
        record.recovering = false; record.recoveryDone = true;
        record.unsubscribe?.(); record.unsubscribe = null;
        if (item.status === 'failed') this.showRetry(record); else this.removeRetry(record);
      }
      this.app.scheduleHealth();
    };
    record.unsubscribe = this.pool.subscribe(entry, update);
    if (['ready', 'partial', 'failed'].includes(entry.status)) { record.unsubscribe(); record.unsubscribe = null; }
  }
  addThumbnail(row) {
    if (this.thumbnails.has(row) || row.closest('#nseOuter') || !this.thumbnailsEnabled(row)) return;
    const link = row.querySelector('a[onmouseover*="overlay"],a[data-ep-overlay]');
    if (!link) return;
    const name = link.dataset.epOverlay || link.getAttribute('onmouseover')?.match(/\boverlay\d+/)?.[0];
    const definition = this.definitions.get(name); if (!definition) return;
    const cell = link.closest('td'); if (!cell) return;
    const category = row.querySelector('td.cats_col,td.cats_cols');
    const inCategory = this.app.settings.resultsView !== 'grid' && this.app.settings.thumbnailPlacement === 'category' && category &&
      !this.app.storage.get('nseHideCategoryIconsEnabled', false);
    const host = this.app.node('span', null, 'epc-thumbnail');
    host.style.setProperty('--epc-thumb-size', this.app.settings.thumbnailSize + 'px');
    const button = this.app.button('', () => this.app.preview.showFor(button, { pin: true }), 'Open image preview');
    button.className = 'epc-thumb-button';
    button.title = 'Hover to enlarge. Click for preview controls.';
    const image = this.app.node('img'); image.alt = ''; image.decoding = 'async'; image.draggable = false;
    const status = this.app.node('span', 'Waiting', 'epc-thumb-status');
    button.append(image, status); host.append(button);
    if (inCategory) category.append(host); else cell.prepend(host);
    const categoryClass = 'epc-category-' + this.app.settings.categoryDisplay;
    if (!row.classList.contains(categoryClass)) row.classList.add(categoryClass);
    const original = fullSizeURL(canonicalImageURL(definition.src));
    host.toggleAttribute('data-ep-grid-gif', coverMayAnimate(definition.src));
    const record = { element: host, row, image, status, link, source: definition.src, original, state: 'deferred', unsubscribe: null };
    this.thumbnails.set(row, record);
    this.indexThumbnail(record);
    this.invalidateLayout();
    // Hover offers a temporary enlargement; clicking either image opens controls.
    this.app.preview.bind(button, { ...definition, title: this.app.preview.titleOf(link), href: link.href });
  }
  removeThumbnail(record) {
    this.stopGridGif(record);
    this.thumbnails.delete(record.row);
    this.unindexThumbnail(record);
    record.unsubscribe?.(); this.intersection?.unobserve(record.element); this.near.delete(record.element);
    record.element.remove(); this.pool.abandon(record.lastEntry);
  }
  indexThumbnail(record) {
    if (!this.thumbnailsByOriginal.has(record.original)) this.thumbnailsByOriginal.set(record.original, new Set());
    this.thumbnailsByOriginal.get(record.original).add(record);
  }
  unindexThumbnail(record) {
    const matching = this.thumbnailsByOriginal.get(record.original);
    matching.delete(record);
    if (!matching.size) this.thumbnailsByOriginal.delete(record.original);
  }
  thumbnailOptions(source, rescueEntry, mode = this.app.settings.thumbnailMode, preferred) {
    const grid = mode === 'grid', original = fullSizeURL(canonicalImageURL(source));
    const smallCandidates = (rescueEntry ? [...rescueEntry.smallCandidates] :
      [this.thumbnailHistory.get(canonicalImageURL(source))?.src, preferred,
        ...Array.from(this.knownVariants.get(fullSizeURL(source)) || [])].filter(Boolean))
      .filter(candidate => mode !== 'auto' && !grid || canonicalImageURL(candidate) !== original);
    let candidates = rescueEntry ? [canonicalImageURL(rescueEntry.actualURL)] :
      thumbnailCandidates(source, grid ? 'auto' : mode, smallCandidates);
    if (grid) {
      candidates = candidates.map(canonicalImageURL).filter(candidate => candidate !== original);
      if (!candidates.length) return null;
    }
    const smallFirst = grid || /\.(?:th|md)\.[^/.?]+(?:\?|$)/i.test(candidates[0]) ||
      candidates[0] !== original && smallCandidates.includes(candidates[0]);
    return { candidates, smallCandidates: grid ? candidates : smallCandidates, smallFirst, cacheMode: 'thumbnail',
      strictCandidates: grid,
      lane: mode === 'original' || !smallFirst ? 'large' : 'thumbnail',
      tier: 'thumbnail:' + mode,
      timeoutMs: this.app.settings.thumbnailTimeoutMs, fullTimeoutMs: this.app.settings.timeoutMs };
  }
  rememberThumbnail(record, item) {
    const source=record.originalSource||record.source;
    this.thumbnailHistory.delete(canonicalImageURL(source));
    this.thumbnailHistory.set(canonicalImageURL(source),{src:canonicalImageURL(item.actualURL),time:Date.now()});
    while(this.thumbnailHistory.size>200)this.thumbnailHistory.delete(this.thumbnailHistory.keys().next().value);
    if(!this.historyTimer)this.historyTimer=this.win.setTimeout(()=>this.flushThumbnailHistory(),500);
  }
  flushThumbnailHistory() {
    if(!this.historyTimer)return;
    this.win.clearTimeout(this.historyTimer);this.historyTimer=null;
    try{this.app.storage.set('ep.thumbnailHistory',[...this.thumbnailHistory]);}catch{}
  }
  showThumbnail(record, entry) {
    const displayURL = entry.displayURL || entry.actualURL;
    if (record.image.getAttribute('src') !== displayURL) record.image.src = displayURL;
    record.image.dataset.epImageSource = entry.actualURL;
    record.status.hidden = true;
    if (record.coverArt || record.row.closest('.epc-result-grid') || this.listCoverAutoplay(record.row)) this.drawGridGifPoster(record, entry);
  }
  drawGridGifPoster(record, entry) {
    const animatedThumbnail = coverMayAnimate(entry.actualURL) ||
      this.coverAutoplayEnabled(record) && entry.actualKey === (record.original || record.source);
    record.element.toggleAttribute('data-ep-grid-gif', animatedThumbnail);
    if (!animatedThumbnail) {
      record.gifPoster?.remove(); record.gifPoster = null;
      return;
    }
    const image = entry.image;
    if (entry.status !== 'ready' || !(image instanceof this.win.HTMLImageElement) ||
        !image.naturalWidth || !image.naturalHeight) return;
    if (record.gifPoster?.dataset.source === entry.actualURL) return;
    const poster = record.gifPoster || this.app.node('canvas', null, 'epc-grid-gif-poster');
    const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
    poster.width = Math.max(1, Math.round(image.naturalWidth * scale));
    poster.height = Math.max(1, Math.round(image.naturalHeight * scale));
    // Drawing an animated image uses its default frame, even for cross-origin images.
    poster.getContext('2d')?.drawImage(image, 0, 0, poster.width, poster.height);
    poster.dataset.source = entry.actualURL;
    poster.setAttribute('aria-hidden', 'true');
    if (!record.gifPoster) record.image.before(poster);
    record.gifPoster = poster;
  }
  coverAutoplayEnabled(record) {
    const { settings } = this.app;
    if (record.coverArt) return settings.recoverBackgrounds && settings.gridAutoplayGifs;
    return record.row.closest('.epc-result-grid') ? settings.gridAutoplayGifs : this.listCoverAutoplay(record.row);
  }
  gridGifEligible(record) {
    return !this.disposed && !this.reducedMotion?.matches && this.coverAutoplayEnabled(record) && this.displayed(record.element, record);
  }
  gridGifVisible(record) {
    if (this.doc.hidden || !this.gridGifEligible(record)) return false;
    const { top, bottom, left, right } = record.element.getBoundingClientRect();
    return bottom > 0 && top < this.win.innerHeight && right > 0 && left < this.win.innerWidth;
  }
  syncGridGif(record) {
    if (!this.gridGifEligible(record)) { this.stopGridGif(record); return; }
    const previous = this.gridGifs.get(record);
    if (previous?.entry) {
      this.updateGridGif(record, previous, this.pool.entries.get(previous.entry.key) || previous.entry);
      return;
    }
    const visible = this.gridGifVisible(record);
    if (this.doc.hidden || previous && !visible) return;
    // Match the enlarged preview. A supplied resize can be a still image.
    const original = record.original || record.source;
    const supplied = canonicalImageURL(record.originalSource || record.source);
    const visiblePriority = coverMayAnimate(original) ? 65 : 45;
    const ready = this.pool.readyImages.get(original);
    if (previous?.state === 'failed' && !ready) return;
    const entry = ready || this.pool.request(original, {
      lane: 'large', cacheMode: 'network', candidates: [original, supplied], gridAutoplay: true,
      eligible: () => this.gridGifEligible(record),
      priorityFor: () => {
        const distance = this.thumbnailDistance(record);
        return distance ? 20 / (1 + distance) : visiblePriority;
      }
    });
    if (!entry) return;
    if (ready) this.pool.recordMemoryHit(ready);
    const playback = { entry, state: entry.status };
    this.gridGifs.set(record, playback);
    this.app.scheduleHealth();
    playback.unsubscribe = this.pool.subscribe(entry, item => this.updateGridGif(record, playback, item));
    if (!visible && !pendingLoadStates.includes(playback.state)) this.releaseGridGif(playback);
  }
  updateGridGif(record, playback, item) {
    playback.entry = item;
    playback.state = item.status;
    if (!this.gridGifVisible(record)) {
      this.hideGridGif(record, playback);
      if (!pendingLoadStates.includes(item.status)) this.releaseGridGif(playback);
      return;
    }
    if (!['streaming', 'partial', 'ready'].includes(item.status) || !item.image?.naturalWidth) {
      this.hideGridGif(record, playback);
      return;
    }
    if (playback.image) return;
    const native = item.image instanceof this.win.HTMLImageElement;
    const movable = native && !item.target && !item.image.isConnected;
    if (native && !movable && item.status !== 'ready') return;
    const image = playback.image = movable ? item.image : this.app.node('img');
    const show = () => {
      if (this.gridGifs.get(record) !== playback || !this.gridGifVisible(record)) return;
      image.classList.add('epc-grid-gif-playback'); image.alt = ''; image.draggable = false;
      record.image.after(image);
      record.element.setAttribute('data-ep-grid-playing', '');
    };
    if (movable) {
      // Keep the loaded node in the card without letting a popup move it.
      item.target = image; playback.owner = item;
      show();
    } else {
      if (native) {
        image.onload = () => { image.onload = image.onerror = null; show(); };
        image.onerror = () => this.stopGridGif(record);
      }
      image.src = item.displayURL || item.actualURL;
      if (!native) show();
    }
  }
  releaseGridGif(playback) {
    const { unsubscribe } = playback;
    if (!unsubscribe) return;
    playback.unsubscribe = playback.entry = null;
    unsubscribe();
  }
  hideGridGif(record, playback) {
    const { image, owner } = playback;
    if (!image) return;
    record.element.removeAttribute('data-ep-grid-playing');
    image.classList.remove('epc-grid-gif-playback');
    image.remove();
    if (owner) {
      if (owner.target === image) owner.target = null;
    } else {
      image.onload = image.onerror = null;
      image.removeAttribute('src');
    }
    playback.image = playback.owner = null;
  }
  stopGridGif(record) {
    const playback = this.gridGifs.get(record);
    if (!playback) return;
    this.gridGifs.delete(record);
    const { entry } = playback;
    this.hideGridGif(record, playback);
    this.releaseGridGif(playback);
    const live = entry && this.pool.entries.get(entry.key);
    if (!live?.keepAlive) this.pool.abandon(live);
    this.app.scheduleHealth();
  }
  useLoadedOriginal(record, entry = this.pool.readyImages.get(record.original)) {
    const previous = record.lastEntry;
    if (entry?.status !== 'ready' || entry.cancelled || entry.gridAutoplay || !entry.image?.naturalWidth ||
        record.state === 'ready' && previous?.actualKey === record.original ||
        !this.app.filtersReady || this.disposed || this.doc.hidden ||
        !(record.coverArt ? this.app.settings.recoverBackgrounds : this.thumbnailsEnabled(record.row)) ||
        !this.displayed(record.element, record)) return false;
    record.state = record.element.dataset.state = 'ready';
    record.lastEntry = entry;
    record.unsubscribe?.(); record.unsubscribe = null;
    this.pool.abandon(previous);
    if (previous !== entry && previous?.target === record.image && !previous.cancelled && previous.status !== 'failed') {
      // A title tooltip may still be using the small request. Keep its target
      // separate so a late thumbnail completion cannot replace the original.
      const image = record.image.cloneNode(false);
      record.image.replaceWith(image); record.image = image; previous.target = null;
    }
    this.showThumbnail(record, entry);
    record.status.textContent = '';
    this.removeRetry(record);
    this.app.scheduleHealth();
    return true;
  }
  loadThumbnail(record, force = false, rescue = false) {
    if (this.useLoadedOriginal(record) || !force && record.state !== 'deferred') return;
    if (!this.app.filtersReady || this.disposed || !this.thumbnailsEnabled(record.row) || this.doc.hidden || !this.displayed(record.element, record)) return;
    const smallOnly = () => !!record.row.closest('.epc-result-grid') || this.listCoverAutoplay(record.row);
    const strict = smallOnly();
    const options = this.thumbnailOptions(record.source, rescue ? record.lastEntry : null, strict ? 'grid' : this.app.settings.thumbnailMode);
    if (!options) {
      record.state = 'failed'; record.element.dataset.state = 'failed';
      record.status.textContent = 'Thumbnail unavailable'; record.status.hidden = false;
      this.app.scheduleHealth(); return;
    }
    // Thumbnail failures must never exhaust the retry budget for a requested original.
    const source = strict ? (rescue ? record.lastEntry.url : options.candidates[0]) : record.source;
    const entry = this.pool.request(source, {
      ...options,
      priority: this.thumbnailPriority(record),
      priorityFor: () => this.thumbnailPriority(record),
      eligible: () => !this.disposed && this.app.filtersReady && this.thumbnailsEnabled(record.row) &&
        strict === smallOnly() && !this.doc.hidden && this.displayed(record.element, record),
      force,
      rescue, singleAttempt: rescue, fresh: rescue,
      // Use the real inline element: no detached preload followed by a second
      // assignment/transfer. The test Image adapter remains injectable.
      target: this.app.options.Image ? null : record.image
    });
    if (!entry) return;
    record.unsubscribe?.();
    const update = item => {
      if (this.disposed || !record.element.isConnected) return;
      record.state = item.status;
      if (item.status === 'failed' && this.useLoadedOriginal(record)) return;
      this.trackRecovery(record, item);
      record.status.textContent = ({ queued: 'Waiting', loading: 'Loading', retrying: 'Retrying',
        stalled: 'Slow load', failed: strict ? 'Thumbnail unavailable' : record.autoRecoveryAttempted || !this.app.settings.maxRetries ? 'Unavailable' : 'Retrying soon',
        streaming: 'Loading', partial: '', ready: '' })[item.status] || '';
      if (item.image?.naturalWidth && ['streaming', 'partial', 'ready'].includes(item.status)) {
        this.showThumbnail(record, item);
      } else record.status.hidden = false;
      record.element.dataset.state = item.status;
      if (['ready', 'failed', 'partial'].includes(item.status)) { record.unsubscribe?.(); record.unsubscribe = null; }
      if (item.status === 'ready') this.rememberThumbnail(record,item);
      this.app.scheduleHealth();
    };
    record.unsubscribe = this.pool.subscribe(entry, update);
    if (['ready', 'failed', 'partial'].includes(entry.status)) { record.unsubscribe(); record.unsubscribe = null; }
  }
  syncCoverGate() {
    this.coverGatePending = !this.doc.documentElement;
    this.doc.documentElement?.classList.toggle('epc-cover-art', !!(this.app.settings.enabled && this.app.settings.recoverBackgrounds));
  }
  bindCover(record) {
    if (!record.coverArt) return;
    const card = record.element.closest('.torrent_grid__torrent');
    const link = record.element.closest('a[href]');
    if (!link) return;
    try { const url = new URL(link.href); if (url.origin !== this.win.location.origin || url.pathname !== '/torrents.php' || !url.searchParams.has('id') || url.searchParams.has('action')) return; }
    catch { return; }
    const title = [...card.querySelectorAll('a[href]')].find(a=>a.textContent.trim() && a.href === link.href);
    record.link = link;
    this.app.preview.bind(link, { src: record.source, cover: record.element,
      href: link.href, title: title ? this.app.preview.titleOf(title) : 'Cover preview', summary: '' });
  }
  clearCover(record) {
    if (!record.coverArt) return;
    this.stopGridGif(record);
    this.unindexThumbnail(record);
    this.app.preview?.unbind(record.link);
    record.gifPoster?.remove(); delete record.element.dataset.epGridGif;
    record.image?.remove(); record.status?.remove(); record.element.classList.remove('epc-managed-cover', 'epc-cover-positioned');
  }
  addBackground(element) {
    const background = element.style.backgroundImage || this.win.getComputedStyle(element).backgroundImage;
    const candidate = background.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
    const supplied = safeImageURL(candidate, this.win.location.href);
    const previous = this.records.get(element);
    if (!supplied || supplied.includes('/static/')) {
      if (previous) { this.clearRecord(previous); this.clearCover(previous); this.pool.abandon(previous.lastEntry); this.records.delete(element); this.near.delete(element); this.intersection?.unobserve(element); }
      element.classList.add('epc-native-cover'); return;
    }
    const coverArt = !!element.closest('.torrent_grid__torrent') && !!element.style.backgroundImage;
    const source = coverArt ? fullSizeURL(supplied) : supplied;
    if (previous && (previous.originalSource === supplied || previous.appliedURL === supplied)) { this.bindCover(previous); return; }
    if (previous) { this.clearRecord(previous); this.clearCover(previous); this.pool.abandon(previous.lastEntry); this.intersection?.unobserve(element); this.near.delete(element); }
    element.classList.remove('epc-native-cover');
    const record = { kind: 'background', element, source, originalSource: supplied, coverArt, state: 'deferred' };
    this.records.set(element, record);
    if (coverArt) {
      record.original = canonicalImageURL(source);
      this.indexThumbnail(record);
      element.toggleAttribute('data-ep-grid-gif', coverMayAnimate(supplied));
      const thumb = safeImageURL(element.getAttribute('data-thumbnail'), this.win.location.href);
      const resized = smallLegacyResize(supplied) ? supplied : null;
      record.preferredThumbnail = thumb || resized;
      if (thumb) this.registerVariant(source, thumb);
      if (resized) this.registerVariant(source, resized);
      const image = record.image = this.app.node('img'); image.className = 'epc-cover-image'; image.alt = ''; image.draggable = false; image.decoding = 'async';
      const status = record.status = this.app.node('span', 'Waiting', 'epc-cover-status'); status.setAttribute('aria-hidden','true');
      const position = this.win.getComputedStyle(element).position;
      if (!position || position === 'static') element.classList.add('epc-cover-positioned');
      element.classList.add('epc-managed-cover'); element.append(image,status); this.bindCover(record);
    } else this.watchNear(element, () => this.loadBackground(record));
  }
  loadBackground(record, force = false, rescue = false) {
    if (record.coverArt && this.useLoadedOriginal(record)) return;
    if (!force && record.state !== 'deferred') return;
    if (!this.app.filtersReady || this.disposed || !this.app.settings.recoverBackgrounds ||
        !(record.coverArt ? this.displayed(record.element, record) : this.visible(record.element, true)) || this.doc.hidden) return;
    const viewportPlayback = record.coverArt && this.app.settings.gridAutoplayGifs;
    const options = record.coverArt ? this.thumbnailOptions(record.originalSource, rescue ? record.lastEntry : null,
      viewportPlayback ? 'grid' : undefined, record.preferredThumbnail) : { lane: 'large' };
    if (!options) {
      record.state = 'failed'; record.status.textContent = 'Thumbnail unavailable'; record.status.hidden = false;
      this.app.scheduleHealth(); return;
    }
    const source = viewportPlayback ? (rescue ? record.lastEntry.url : options.candidates[0]) : record.source;
    const entry = this.pool.request(source, {
      ...options,
      priority: record.coverArt ? this.thumbnailPriority(record) : this.visible(record.element) ? 30 : 5,
      ...(record.coverArt ? { priorityFor: () => this.thumbnailPriority(record), target: this.app.options.Image ? null : record.image } : {}), force,
      eligible: () => !this.disposed && this.app.settings.recoverBackgrounds && !this.doc.hidden &&
        (record.coverArt ? this.displayed(record.element, record) : this.visible(record.element, true)), rescue, singleAttempt: rescue, fresh: rescue });
    if (!entry) return;
    record.unsubscribe?.();
    const update = item => {
      if (this.disposed || !record.element.isConnected) return;
      record.state = item.status;
      if (record.coverArt && item.status === 'failed' && this.useLoadedOriginal(record)) return;
      this.trackRecovery(record, item);
      if (record.coverArt) {
        if(item.status==='ready')this.rememberThumbnail(record,item);
        record.status.textContent = ({queued:'Waiting',loading:'Loading…',retrying:'Retrying…',stalled:'Slow load',failed:'Unavailable'})[item.status] || '';
        record.status.hidden = ['streaming','partial','ready'].includes(item.status) && !!item.image?.naturalWidth;
      }
      if (item.image?.naturalWidth && ['streaming', 'partial', 'ready'].includes(item.status)) {
        record.appliedURL = item.actualURL;
        if (record.coverArt) this.showThumbnail(record, item);
        else {
          const value = 'url("' + item.actualURL.replace(/\\/g, '%5C').replace(/"/g, '%22').replace(/\n/g, '%0A') + '")';
          if (record.element.style.backgroundImage !== value) record.element.style.backgroundImage = value;
        }
        this.removeRetry(record);
      }
      if (['partial', 'ready'].includes(item.status)) { this.near.delete(record.element); this.intersection?.unobserve(record.element); }
      if (item.status === 'failed') {
        if (!record.retryButton && this.visible(record.element)) {
          const retry = this.app.button('Retry cover', event => {
            event.preventDefault(); event.stopPropagation(); this.loadBackground(record, true);
          });
          retry.className = 'epc-root epc-media-retry'; (record.element.closest('a') || record.element).after(retry); record.retryButton = retry;
        }
      }
      if (['ready', 'failed', 'partial'].includes(item.status)) { record.unsubscribe?.(); record.unsubscribe = null; }
      this.app.scheduleHealth();
    };
    record.unsubscribe = this.pool.subscribe(entry, update);
    if (['ready', 'failed', 'partial'].includes(entry.status)) { record.unsubscribe(); record.unsubscribe = null; }
  }
  loadCounts() {
    const counts = Object.fromEntries(Object.keys(loadLabels).map(key => [key, emptyLoadCounts()]));
    for (const record of [...this.records.values(), ...this.thumbnails.values()]) {
      if (!record.element.isConnected || record.element.closest('.hidden:not(.epc-revealed),[hidden],.epc-filter-hidden,.epc-version-hidden')) continue;
      const key = record.coverArt ? 'cover' : record.kind || 'thumbnail';
      const lazy = record.kind === 'image' && record.state === 'loading' && record.element.loading === 'lazy' && !this.visible(record.element);
      countLoad(counts[key], lazy ? 'deferred' : record.state);
    }
    const animationEntries = new Set();
    let animationLoads = 0;
    for (const [record, playback] of this.gridGifs) {
      if (!record.element.isConnected || record.element.closest('.hidden:not(.epc-revealed),[hidden],.epc-filter-hidden,.epc-version-hidden')) continue;
      animationLoads++;
      if (playback.entry) animationEntries.add(playback.entry);
      countLoad(counts.animation, playback.state);
    }
    const grid = this.app.settings.resultsView === 'grid';
    const hasCoverArt = counts.cover.ready || counts.cover.pending;
    if (!animationLoads && (grid || this.listCoverAutoplay() || hasCoverArt)) {
      const autoplay = this.listCoverAutoplay() || (grid || hasCoverArt) && this.app.settings.gridAutoplayGifs;
      counts.animation.note = !this.app.settings.enabled || !autoplay ? 'Off' :
        this.reducedMotion?.matches ? 'Reduced motion' : 'No covers to load';
    }
    const preview = this.app.preview;
    if (preview.open) countLoad(counts.preview, preview.element.dataset.state || 'loading');
    for (const entry of this.pool.entries.values()) {
      if (entry.keepAlive && entry !== preview.progressEntry && !animationEntries.has(entry) && pendingLoadStates.includes(entry.status)) {
        countLoad(counts.preview, entry.status);
      }
    }
    return counts;
  }
  retryVisible() {
    let attempted = 0;
    for (const record of this.records.values()) {
      if (!this.visible(record.element) || !['failed', 'stalled', 'partial'].includes(record.state)) continue;
      if (record.kind === 'background') this.loadBackground(record, true); else this.recover(record, true, true);
      attempted++;
    }
    for (const record of this.thumbnails.values()) if (this.visible(record.element) && ['failed', 'stalled'].includes(record.state)) {
      this.loadThumbnail(record, true); attempted++;
    }
    this.app.toast(attempted ? 'Retry requested for ' + attempted + ' visible images.' : 'No failed visible images to retry.');
  }
  noteRemoved(root) {
    for (const element of [root, ...root.querySelectorAll('img,.torrent__cover')]) {
      const record = this.records.get(element); if (!record || element.isConnected) continue;
      this.clearRecord(record); this.intersection?.unobserve(element); this.near.delete(element); this.records.delete(element);
      this.clearCover(record);
      this.pool.abandon(record.lastEntry);
    }
    for (const row of [root, ...root.querySelectorAll('tr')]) {
      const record = this.thumbnails.get(row); if (!record || row.isConnected) continue;
      this.invalidateLayout();
      this.removeThumbnail(record);
    }
  }
  dispose() {
    this.disposed = true; this.intersection?.disconnect(); this.layoutObserver?.disconnect();
    this.reducedMotion?.removeEventListener('change', this.motionListener);
    for (const record of this.gridGifs.keys()) this.stopGridGif(record);
    this.pool.dispose();
    this.doc.documentElement?.classList.remove('epc-cover-art');
    this.pool.env.clearTimeout(this.recoveryTimer);
    this.win.removeEventListener('resize', this.resizeListener);
    this.win.removeEventListener('scroll', this.demandListener, true);
    this.doc.removeEventListener('visibilitychange', this.demandListener);
    this.flushThumbnailHistory();
    if (this.fallbackListener) {
      this.win.removeEventListener('scroll', this.fallbackListener);
      this.win.removeEventListener('resize', this.fallbackListener);
    }
    for (const record of this.records.values()) {
      this.clearRecord(record);
      this.clearCover(record);
      if (record.kind === 'image') {
        this.restoreSpace(record); record.element.classList.remove('epc-page-image', 'epc-compact');
      }
    }
    for (const record of this.thumbnails.values()) {
      record.unsubscribe?.(); record.element.remove();
      record.row.classList.remove('epc-category-keep', 'epc-category-overlay', 'epc-category-hide');
    }
    this.records.clear(); this.thumbnails.clear(); this.thumbnailsByOriginal.clear(); this.near.clear();
  }
}

class PreviewController {
  constructor(app) {
    this.app = app; this.win = app.win; this.doc = app.doc; this.bound = new Map();
    this.open = false; this.pinned = false; this.version = 0;
  }
  build() {
    this.element = this.app.node('section', null, 'epc-root epc-preview'); this.element.hidden = true;
    this.element.setAttribute('role', 'dialog'); this.element.setAttribute('aria-modal', 'false');
    this.element.setAttribute('aria-label', 'Image preview'); this.element.tabIndex = -1;
    const heading = this.heading = this.app.node('header', null, 'epc-preview-heading');
    this.title = this.app.node('strong');
    heading.append(this.title, this.app.button('Close', () => this.hide(true)));
    this.frame = this.app.node('div', null, 'epc-preview-frame');
    this.image = this.fallbackImage = this.app.node('img'); this.image.alt = ''; this.image.decoding = 'async';
    this.image.draggable = false;
    this.image.hidden = true; this.frame.append(this.image);
    this.status = this.app.node('p', '', 'epc-preview-status'); this.status.setAttribute('role', 'status'); this.status.hidden = true;
    this.statusMessage = this.app.node('span');
    this.loadStats = this.app.node('small', '', 'epc-preview-stats'); this.loadStats.hidden = true;
    this.loadStats.setAttribute('aria-hidden', 'true'); this.status.append(this.statusMessage, this.loadStats);
    this.statsVisibility = () => {
      this.app.media.pool.env.clearTimeout(this.statsTimer); this.statsTimer = null;
      if (!this.doc.hidden) this.refreshLoadStats();
    };
    this.doc.addEventListener('visibilitychange', this.statsVisibility);
    this.summary = this.app.node('p', '', 'epc-preview-summary');
    const actions = this.actions = this.app.node('div', null, 'epc-actions');
    this.pinButton = this.app.button('Pin', () => this.pin());
    this.retryButton = this.app.button('Retry', () => this.retry());
    this.syncShortcutLabels();
    this.details = this.app.node('a', 'Details'); this.details.target = '_blank'; this.details.rel = 'noopener noreferrer';
    actions.append(this.pinButton, this.retryButton, this.details);
    this.element.append(heading, this.frame, this.status, this.summary, actions); this.doc.body.append(this.element);
    this.element.addEventListener('pointerenter', () => { this.inside = true; this.win.clearTimeout(this.hideTimer); });
    this.element.addEventListener('pointerleave', event => {
      this.inside = false;
      if (this.zoom && this.anchor?.contains(event.relatedTarget)) return;
      this.deferHide();
    });
    this.frame.addEventListener('click', () => {
      if (this.open && this.zoom) this.showFor(this.anchor, { pin: true });
    });
    this.element.addEventListener('pointercancel', () => { if (this.zoom) this.hide(); });
    this.element.addEventListener('focusout', event => {
      if (!this.element.contains(event.relatedTarget)) this.deferHide();
    });
    this.image.addEventListener('load', () => this.position());
    this.scrollListener = () => this.position();
    this.win.addEventListener('scroll', this.scrollListener, { passive: true });
    this.pointerListener = event => {
      if (!this.open || !(this.zoom || this.titleHover) || this.pinned) return;
      const contains = element => {
        const rect = element?.getBoundingClientRect();
        return rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      };
      if (!contains(this.metadata?.cover || this.anchor) && (this.titleHover || !contains(this.element))) {
        this.hoveredTrigger = null; this.inside = false; this.hide();
      }
    };
    this.blurListener = () => { if (this.zoom || this.titleHover) this.hide(); };
    this.win.addEventListener('pointermove', this.pointerListener, { passive: true });
    this.win.addEventListener('blur', this.blurListener);
    if (this.win.visualViewport) {
      this.win.visualViewport.addEventListener('resize', this.scrollListener, { passive: true });
      this.win.visualViewport.addEventListener('scroll', this.scrollListener, { passive: true });
    }
    if (this.win.ResizeObserver) {
      this.resize = new this.win.ResizeObserver(() => this.position());
      this.resize.observe(this.element);
    }
  }
  clearPendingImage() {
    if (!this.pendingImage) return;
    this.pendingImage.onload = this.pendingImage.onerror = null;
    this.pendingImage.removeAttribute('src'); this.pendingImage = null; this.pendingViewStarted = null;
  }
  clearLoadStats() {
    this.app.media.pool.env.clearTimeout(this.statsTimer); this.statsTimer = null; this.statsSession = null;
    if (this.loadStats) { this.loadStats.textContent = ''; this.loadStats.hidden = true; }
  }
  setStatusText(text) {
    if (this.statusMessage.textContent !== text) this.statusMessage.textContent = text;
    this.status.hidden = !text;
  }
  updateLoadStats(entry, version, pendingView) {
    const active = pendingView || ['queued','loading','streaming','stalled','retrying','partial'].includes(entry.status);
    if (!active || this.titleHover) { this.clearLoadStats(); return; }
    if (this.statsSession?.entry !== entry || this.statsSession.pendingView !== !!pendingView) {
      this.clearLoadStats();
      const now = this.app.media.pool.env.now();
      this.statsSession = { entry, version, pendingView:!!pendingView,
        began:pendingView ? this.pendingViewStarted ?? now : entry.started ?? now };
    } else this.statsSession.version = version;
    this.refreshLoadStats();
  }
  refreshLoadStats() {
    const session = this.statsSession;
    if (!session || !this.open || session.version !== this.version) { this.clearLoadStats(); return; }
    if (this.doc.hidden) return;
    const seconds = Math.max(0, Math.floor((this.app.media.pool.env.now() - session.began) / 1000));
    const text = seconds ? ' · ' + seconds + 's' + (session.entry.attempts > 1 ? ' · try ' + session.entry.attempts : '') : '';
    if (this.loadStats.textContent !== text) this.loadStats.textContent = text;
    this.loadStats.hidden = !text;
    // One timer for the open, visible preview only. No image/host/page scans.
    if (!this.statsTimer) this.statsTimer = this.app.media.pool.env.setTimeout(() => {
      this.statsTimer = null; this.refreshLoadStats();
    }, 1000);
  }
  clearImage() {
    this.clearPendingImage();
    if (!this.fallbackImage) return;
    // Detached pool images retain their successful pixels for the next hover.
    if (this.image !== this.fallbackImage) this.frame.replaceChildren(this.fallbackImage);
    this.image = this.fallbackImage; this.image.removeAttribute('src'); this.image.hidden = true;
    delete this.image.dataset.epImageSource;
  }
  displayImage(image) {
    image.alt = ''; image.draggable = false; image.hidden = false;
    if (this.image !== image) this.frame.replaceChildren(image);
    this.image = image;
  }
  displayLoaded(entry, version, update) {
    const displayURL=entry.displayURL||entry.actualURL;
    if (!this.image.hidden && this.image.getAttribute('src') === displayURL) return true;
    if (entry.image instanceof this.win.HTMLImageElement && !entry.target) {
      // The scheduler already loaded this node: moving it avoids another URL
      // assignment/transfer, including on hosts that disallow HTTP caching.
      this.clearPendingImage(); entry.image.dataset.epImageSource=entry.actualURL;this.displayImage(entry.image); return true;
    }
    if (!(entry.image instanceof this.win.HTMLImageElement)) {
      // Injectable image adapters represent completed pixels in model tests.
      this.fallbackImage.src = displayURL;this.fallbackImage.dataset.epImageSource=entry.actualURL; this.displayImage(this.fallbackImage); return true;
    }
    // A shared native/inline target belongs to the page. Never move it out of
    // its original position, and keep our current image until its view loads.
    if (this.pendingImage?.getAttribute('src') === displayURL) return false;
    this.clearPendingImage();
    const view = this.app.node('img'); this.pendingImage = view;
    this.pendingViewStarted = this.app.media.pool.env.now();
    view.decoding = 'async';
    view.onload = () => {
      if (!this.open || version !== this.version || this.pendingImage !== view) return;
      if (!view.naturalWidth) { view.onerror(); return; }
      view.onload = view.onerror = null; this.pendingImage = null;
      this.displayImage(view); update(entry);
    };
    view.onerror = () => {
      if (!this.open || version !== this.version || this.pendingImage !== view) return;
      this.clearPendingImage(); this.element.dataset.state = 'failed';
      this.clearLoadStats(); this.setStatusText('Larger image unavailable. Keeping the current preview.'); this.position();
    };
    view.dataset.epImageSource=entry.actualURL;view.src = displayURL; return false;
  }
  titleOf(link) {
    const clone = link.cloneNode(true);
    for (const annotation of clone.querySelectorAll('color,.nseHiddenTitle,.nseWhitelistedTitle,.nseHardPassTitle')) annotation.remove();
    return clone.textContent.replace(/\s+/g, ' ').trim().slice(0, 400);
  }
  scan(root) {
    if (!this.element) return;
    const links = root.matches?.('a[onmouseover*="overlib"]') ? [root] :
      Array.from(root.querySelectorAll?.('a[onmouseover*="overlib"],a[data-ep-overlay]') || []);
    const parentRow = root.closest?.('tr.torrent');
    if (parentRow) links.push(...parentRow.querySelectorAll('a[onmouseover*="overlib"],a[data-ep-overlay]'));
    for (const link of links) {
      if (this.bound.has(link)) continue;
      const name = link.dataset.epOverlay || link.getAttribute('onmouseover')?.match(/\boverlay\d+/)?.[0];
      const def = this.app.media.definitions.get(name);
      if (def) { link.dataset.epOverlay = name; this.bind(link, { ...def, title: this.titleOf(link), href: link.href }); }
    }
  }
  bind(link, metadata, clickOnly = false) {
    if (metadata.cover && this.open && this.anchor === link && this.metadata?.src !== metadata.src) this.hide(true);
    if (this.bound.has(link)) {
      if (metadata.cover) this.bound.get(link).metadata = metadata;
      return;
    }
    clickOnly ||= !this.app.settings.previews;
    const item = { metadata, thumbnail: link.matches('.epc-thumb-button') || !!metadata.cover,
      over: link.getAttribute('onmouseover'), out: link.getAttribute('onmouseout') };
    const enter = event => {
      if (event.type === 'pointerenter' && this.open && this.zoom && this.anchor !== link) {
        const rect = this.element.getBoundingClientRect();
        // A transient enlargement overlaps neighboring cards. Their underlying
        // link must not steal the hover while the pointer moves onto its image.
        if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) return;
      }
      this.win.clearTimeout(this.hideTimer);
      if (this.dismissed === link || this.pinned) return;
      if (event.pointerType === 'touch') return;
      // A mouse click focuses the button before click. Keep the enlargement
      // stable until the click pins it; keyboard focus still offers controls.
      if (event.type === 'focus' && this.zoom && this.hoveredTrigger === link) return;
      this.hoveredTrigger = event.type === 'pointerenter' ? link : null;
      this.point = event.type === 'focus' ? null : { x: event.clientX, y: event.clientY };
      this.win.clearTimeout(this.showTimer);
      this.showTimer = this.win.setTimeout(() => this.showFor(link, { keyboard: event.type === 'focus' }),
        item.thumbnail || event.type === 'focus' ? 0 : this.app.settings.hoverDelay);
    };
    const leave = event => {
      this.win.clearTimeout(this.showTimer);
      if (this.dismissed === link) this.dismissed = null;
      if (event.type === 'blur' && this.zoom && (this.hoveredTrigger === link || this.inside)) return;
      if (this.hoveredTrigger === link) {
        this.hoveredTrigger = null;
        if (this.element) this.element.style.pointerEvents = '';
      }
      if (this.open && this.titleHover && this.anchor === link && ['pointerleave', 'pointercancel'].includes(event.type)) {
        this.inside = false; this.hide(); return;
      }
      if (this.open && this.zoom && this.anchor === link && ['pointerleave', 'pointercancel'].includes(event.type)) {
        const rect = this.element.getBoundingClientRect();
        // The enlarged image overlaps its trigger. On leaving the small image,
        // it can receive the pointer and be clicked without blocking the trigger.
        const onImage = event.type !== 'pointercancel' && (this.element.contains(event.relatedTarget) ||
          event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
        this.inside = onImage;
        if (!onImage) this.hide();
        return;
      }
      this.deferHide();
    };
    item.events = clickOnly ? [] : [['pointerenter', enter], ['pointerleave', leave], ['pointercancel', leave],
      ...(item.thumbnail ? [['focus', enter], ['blur', leave]] : [['contextmenu', () => {
        if (this.hoveredTrigger === link) { this.win.clearTimeout(this.showTimer); this.hoveredTrigger = null; }
        if (this.titleHover && this.anchor === link) this.hide();
      }]])];
    for (const [event, listener] of item.events) link.addEventListener(event, listener);
    link.removeAttribute('onmouseover'); link.removeAttribute('onmouseout');
    this.bound.set(link, item);
  }
  showFor(link, options = {}) {
    const retainedPin = this.pinned && options.pin === true && this.anchor === link && this.metadata;
    const item = this.bound.get(link) || (retainedPin ? { metadata: this.metadata, thumbnail: link.matches('.epc-thumb-button') || !!this.metadata.cover } : null);
    if (!item || !this.app.settings.enabled || !this.app.settings.previews && !options.pin || !retainedPin && (!link.isConnected ||
        link.closest('.hidden:not(.epc-revealed),[hidden],.epc-filter-hidden,.epc-version-hidden'))) return;
    if (this.pinned && options.pin === undefined && !options.force) return;
    this.win.clearTimeout(this.showTimer); this.win.clearTimeout(this.hideTimer);
    // hide() clears the displayed image. Remembering the previous item does not
    // mean its pixels are still visible when a new hover session starts.
    const same = this.open && this.metadata?.src === item.metadata.src;
    if (!same) this.clearLoadStats();
    const previousUnsubscribe = this.unsubscribe; this.unsubscribe = null;
    this.anchor = link; this.metadata = item.metadata;
    this.pinned = options.pin ?? this.pinned; this.open = true; const version = ++this.version;
    this.zoom = item.thumbnail && !this.pinned && !options.keyboard;
    const titleHover = this.titleHover = !item.thumbnail && !this.pinned && !options.keyboard;
    this.element.dataset.mode = this.zoom ? 'zoom' : titleHover ? 'tooltip' : 'controls';
    this.element.setAttribute('role', this.zoom || titleHover ? 'tooltip' : 'dialog');
    this.heading.hidden = this.actions.hidden = this.zoom || titleHover;
    this.summary.hidden = this.zoom;
    this.element.style.pointerEvents = titleHover || !this.pinned && this.hoveredTrigger === link ? 'none' : '';
    this.element.hidden = false; this.title.textContent = item.metadata.title || 'Image preview';
    this.summary.textContent = item.metadata.summary || '';
    this.syncShortcutLabels();
    this.pinButton.setAttribute('aria-pressed', String(this.pinned));
    this.clearPendingImage();
    if (!same) { this.clearImage(); this.setStatusText('Waiting for image…'); }
    const href = item.metadata.href && new URL(item.metadata.href, this.win.location.href);
    this.details.hidden = !href || href.origin !== this.win.location.origin || href.searchParams.get('action') === 'download';
    if (!this.details.hidden) this.details.href = href.href;
    const source = this.pinned || this.zoom ? fullSizeURL(item.metadata.src) : item.metadata.src;
    // If the same image already has a usable inline thumbnail, keep it visible
    // while its larger form loads. Never show a previous torrent's picture.
    const row = link.closest('tr.torrent');
    const thumbnail = row ? this.app.media.thumbnails.get(row) : item.metadata.cover && this.app.media.records.get(item.metadata.cover);
    if (!same && thumbnail?.image.naturalWidth && fullSizeURL(thumbnail.source) === fullSizeURL(item.metadata.src)) {
      this.image.src = thumbnail.image.src; this.image.hidden = false;
      this.image.dataset.epImageSource=thumbnail.image.dataset.epImageSource||thumbnail.image.src;
    }
    const readyThumbnail = thumbnail?.lastEntry && ['ready', 'partial'].includes(thumbnail.lastEntry.status);
    if (titleHover && readyThumbnail && !options.force) this.app.media.pool.recordMemoryHit(thumbnail.lastEntry);
    const smallTitle = titleHover && row && (row.closest('.epc-result-grid') || this.app.media.listCoverAutoplay(row));
    const requestOptions = titleHover ? this.app.media.thumbnailOptions(source, null, smallTitle ? 'grid' : undefined) : {
      lane: 'large', keepAlive: true,
      cacheMode: thumbnail?.image.naturalWidth && !/\.gif(?:\?|$)/i.test(source) ? 'network' : 'lookup',
      candidates: Array.from(new Set([source, item.metadata.src]))
    };
    const entry = titleHover && readyThumbnail && !options.force ? thumbnail.lastEntry : requestOptions &&
      this.app.media.pool.request(smallTitle ? requestOptions.candidates[0] : source, {
      ...requestOptions, priority: 100, force: !!options.force,
      eligible: () => this.open && version === this.version,
      priorityFor: () => this.open && version === this.version ? 100 : 0,
      fresh: !!options.force });
    if (!entry) {
      previousUnsubscribe?.();
      this.progressEntry = null; this.element.dataset.state = 'failed'; this.app.scheduleHealth();
      this.clearLoadStats(); this.setStatusText(requestOptions ? 'Retry limit reached. Try again after a short pause.' : 'Thumbnail unavailable');
      this.position(); return;
    }
    const update = current => {
      if (!this.open || version !== this.version) return;
      this.progressEntry = current;
      const visible = !this.image.hidden && this.image.hasAttribute('src');
      // A first frame may be useful when no image exists. It must not replace
      // a working thumbnail until the larger request has actually succeeded.
      const usable = current.image?.naturalWidth && ['streaming', 'partial', 'ready'].includes(current.status);
      const pendingView = usable && (!visible || current.status === 'ready') && !this.displayLoaded(current, version, update);
      const thumbnailVisible = !this.image.hidden && this.image.hasAttribute('src') &&
        canonicalImageURL(this.image.dataset.epImageSource||this.image.src) !== canonicalImageURL(source);
      const larger = !titleHover && thumbnailVisible ? {
        queued: 'Waiting to load larger image…', loading: 'Loading larger image…',
        streaming: 'Loading larger image… Showing thumbnail.',
        stalled: 'Larger image is taking longer. Showing thumbnail.',
        retrying: 'Retrying larger image… Showing thumbnail.',
        partial: 'Larger image has not finished loading. Showing thumbnail.',
        failed: 'Larger image unavailable. Showing thumbnail.',
        ready: 'Larger image unavailable. Showing thumbnail.'
      } : {};
      let message = ({
        queued: 'Waiting for a loading slot…', loading: 'Loading image…',
        streaming: 'Preview available; the full image is still loading.',
        stalled: 'Still waiting for the image host. You can retry or keep waiting.',
        retrying: 'Retrying image…', failed: this.app.media.pendingRecovery(item.metadata.src) ?
          'Image temporarily unavailable. Retrying automatically.' : 'The image is currently unavailable.',
        partial: 'The image is partly available. Retry if it looks incomplete.', ready: '', ...larger
      })[current.status] || '';
      if (pendingView) message = thumbnailVisible ? 'Loading larger image…' : 'Loading image…';
      this.setStatusText(message); this.updateLoadStats(current, version, pendingView);
      this.element.dataset.state = pendingView ? 'loading' : current.status; this.position(); this.app.scheduleHealth();
    };
    this.unsubscribe = this.app.media.pool.subscribe(entry, update);
    this.renderEntry = update;
    previousUnsubscribe?.();
    this.position();
  }
  deferHide() {
    this.win.clearTimeout(this.hideTimer);
    if ((this.zoom || this.titleHover) && !this.pinned) {
      if (!this.inside && this.hoveredTrigger !== this.anchor) this.hide();
      return;
    }
    this.hideTimer = this.win.setTimeout(() => {
      if (!this.pinned && !this.inside && this.doc.activeElement !== this.anchor &&
          !this.element.contains(this.doc.activeElement)) this.hide();
    }, this.app.settings.hideDelay);
  }
  acceptRecovered(entry) {
    if (!this.open || !this.metadata || this.element.dataset.state !== 'failed' || !entry.image?.naturalWidth) return;
    if (fullSizeURL(entry.url) !== fullSizeURL(this.metadata.src)) return;
    const previous = this.unsubscribe;
    this.unsubscribe = this.app.media.pool.subscribe(entry, this.renderEntry);
    previous?.();
    if (/\.(?:th|md)\.[^/.?]+(?:\?|$)/i.test(entry.actualURL)) this.setStatusText('Thumbnail available; the full image is unavailable.');
  }
  hide(force = false) {
    if (this.pinned && !force) return;
    this.clearLoadStats();
    this.win.clearTimeout(this.showTimer); this.win.clearTimeout(this.hideTimer);
    if (force) this.dismissed = this.anchor;
    const restoreFocus = force && this.element?.contains(this.doc.activeElement);
    this.clearImage();
    this.unsubscribe?.(); this.unsubscribe = null; this.renderEntry = null; this.version++;
    this.progressEntry = null; this.app.scheduleHealth();
    this.open = false; this.pinned = false; this.inside = false; this.zoom = false; this.titleHover = false;
    if (this.element) this.element.hidden = true;
    if (restoreFocus) this.anchor?.focus({ preventScroll: true });
    if (!this.anchor?.isConnected) { this.anchor = null; this.metadata = null; this.dismissed = null; }
    this.app.media.pool.trim();
  }
  syncShortcutLabels() {
    const shortcuts = this.app.settings.keyboardShortcuts;
    const pin = (this.pinned ? 'Unpin' : 'Pin') + (shortcuts ? ' (P)' : '');
    const retry = shortcuts ? 'Retry (R)' : 'Retry';
    if (this.pinButton.textContent !== pin) this.pinButton.textContent = pin;
    if (this.retryButton.textContent !== retry) this.retryButton.textContent = retry;
  }
  pin() {
    if (!this.anchor) return;
    if (this.pinned && (!this.anchor.isConnected || this.anchor.closest('.hidden:not(.epc-revealed),[hidden],.epc-filter-hidden,.epc-version-hidden'))) { this.hide(true); return; }
    this.pinned = !this.pinned; this.showFor(this.anchor, { pin: this.pinned });
  }
  retry() { if (this.anchor) this.showFor(this.anchor, { force: true, pin: this.pinned }); }
  position() {
    if (!this.open || this.positionPending || !this.element) return;
    this.positionPending = true;
    this.win.requestAnimationFrame(() => {
      this.positionPending = false; if (!this.open) return;
      const viewport = this.win.visualViewport;
      const width = viewport?.width || this.win.innerWidth, height = viewport?.height || this.win.innerHeight;
      const offsetX = viewport?.offsetLeft || 0, offsetY = viewport?.offsetTop || 0, pad = 12;
      const popupWidth = Math.max(180, Math.min(this.pinned ? Math.max(600, this.app.settings.previewWidth) :
        this.titleHover ? Math.min(350, this.app.settings.previewWidth) : this.app.settings.previewWidth, width - pad * 2));
      const popupHeight = Math.max(120, height - pad * 2);
      const style = this.element.style;
      const assignments = { width: popupWidth + 'px', maxHeight: popupHeight + 'px' };
      for (const [key, value] of Object.entries(assignments)) if (style[key] !== value) style[key] = value;
      const frameHeight = Math.max(60, popupHeight - (this.zoom ? this.status.textContent ? 60 : 14 : this.titleHover ? 130 : 190)) + 'px';
      if (this.frame.style.maxHeight !== frameHeight) this.frame.style.maxHeight = frameHeight;
      const anchor = (this.metadata?.cover || this.anchor)?.getBoundingClientRect();
      const rect = this.element.getBoundingClientRect();
      let left = this.pinned ? offsetX + (width - rect.width) / 2 :
        this.zoom ? (anchor?.left ?? pad) - 6 : this.point?.x + 12 || anchor?.right + 10 || pad;
      let top = this.pinned ? offsetY + pad :
        this.zoom ? (anchor?.top ?? pad) - 6 : this.point?.y + 12 || anchor?.bottom + 10 || pad;
      if (!this.zoom && top + rect.height > offsetY + height - pad && anchor) top = anchor.top - rect.height - pad;
      left = Math.max(offsetX + pad, Math.min(left, offsetX + width - rect.width - pad));
      top = Math.max(offsetY + pad, Math.min(top, offsetY + height - rect.height - pad));
      if (style.left !== left + 'px') style.left = left + 'px';
      if (style.top !== top + 'px') style.top = top + 'px';
    });
  }
  forget(root) {
    for (const link of [root, ...root.querySelectorAll('a,button')]) {
      const item = this.bound.get(link); if (!item || link.isConnected) continue;
      for (const [event, listener] of item.events) link.removeEventListener(event, listener);
      if (item.over !== null) link.setAttribute('onmouseover', item.over);
      if (item.out !== null) link.setAttribute('onmouseout', item.out);
      this.bound.delete(link);
    }
    if (this.open && !this.pinned && !this.anchor?.isConnected) this.hide();
    if (!this.open && this.anchor && !this.anchor.isConnected) { this.anchor = null; this.metadata = null; this.dismissed = null; this.renderEntry = null; }
  }
  unbind(link) {
    const item = this.bound.get(link); if (!item) return;
    for (const [event, listener] of item.events) link.removeEventListener(event, listener);
    if (item.over !== null) link.setAttribute('onmouseover', item.over);
    if (item.out !== null) link.setAttribute('onmouseout', item.out);
    this.bound.delete(link);
    if (this.open && !this.pinned && this.anchor === link) this.hide();
  }
  dispose() {
    this.hide(true); this.resize?.disconnect(); this.win.removeEventListener('scroll', this.scrollListener);
    this.doc.removeEventListener('visibilitychange', this.statsVisibility);
    this.win.removeEventListener('pointermove', this.pointerListener); this.win.removeEventListener('blur', this.blurListener);
    if (this.win.visualViewport) {
      this.win.visualViewport.removeEventListener('resize', this.scrollListener);
      this.win.visualViewport.removeEventListener('scroll', this.scrollListener);
    }
    for (const [link, item] of this.bound) {
      for (const [event, listener] of item.events) link.removeEventListener(event, listener);
      if (item.over !== null) link.setAttribute('onmouseover', item.over);
      if (item.out !== null) link.setAttribute('onmouseout', item.out);
    }
    this.bound.clear(); this.element?.remove();
  }
}

function createApp(win, storage, options = {}) {
  return new CompanionApp(win, storage, options);
}

// SPDX-License-Identifier: GPL-3.0-or-later
const NSE_EMPTY_LISTS = ['nseTaglist', 'nseHardPassTaglist', 'nseWhitelist',
  'nseBlacklistTitles', 'nseHardPassTitles', 'nseWhitelistTitles', 'nseUploaders', 'nseWhitelistUploaders'];
// Compatible with mc-hamster's fork, while the pinned upstream engine retains
// its own complete schema/readers. Companion owns these controls.
const NSE_BACKFILL_SCHEMA = { nseBackfillButtonEnabled: 'boolean', nseBackfillPageLimit: 'number' };

function validateNSE(input, schema) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid filter settings object.');
  const result = {};
  const color = /^(?:#[0-9a-f]{3,8}|[a-z]{1,30}|rgba?\([\d.,%\s]+\)|hsla?\([\d.,%\s]+\))$/i;
  for (const [key, value] of Object.entries(input)) {
    const type = Object.hasOwn(schema, key) ? schema[key] :
      Object.hasOwn(NSE_BACKFILL_SCHEMA, key) && NSE_BACKFILL_SCHEMA[key];
    if (!type) throw new Error('Unknown filter preference in the import file.');
    if (type === 'array') {
      if (!Array.isArray(value) || value.length > 100000 || value.some(id => !/^\d{1,15}$/.test(String(id)))) {
        throw new Error('Invalid list of individual result overrides.');
      }
      result[key] = [...new Set(value.map(String))]; continue;
    }
    if (type === 'object') {
      const names = ['backgroundColor', 'backgroundHighlightColor', 'foregroundColor', 'accentColor', 'highlightColor', 'hiddenBackgroundColor'];
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Object.keys(value).some(name => !names.includes(name)) ||
          names.slice(0, 5).some(name => !color.test(value[name] || '')) ||
          value.hiddenBackgroundColor && !color.test(value.hiddenBackgroundColor)) throw new Error('Invalid custom theme.');
      result[key] = { ...value }; continue;
    }
    if (typeof value !== type || type === 'number' && (!Number.isFinite(value) || value < 0 || value > 10000000) ||
        type === 'string' && value.length > (key === 'nseCustomCSS' ? 2000000 : 500000)) {
      throw new Error('A filter preference has an invalid value.');
    }
    if (/Color$/.test(key) && !color.test(value)) throw new Error('Invalid filter highlight color.');
    if (/Font$/.test(key) && !/^[\w\s,'".-]{1,200}$/.test(value)) throw new Error('Invalid font family.');
    if (key === 'nseSelectedTheme' && !/^nseTheme(?:Default|Legacy|Edgy|Baked|DarkPurple|Custom)$/.test(value)) throw new Error('Invalid theme.');
    result[key] = key === 'nseBackfillPageLimit' ? Math.floor(Math.min(15, Math.max(1, value))) : value;
  }
  return result;
}

const epHost = /^(?:www\.)?(?:empornium\.(?:sx|me|is|ph)|emparadise\.rs)$/i.test(location.hostname);
const epFixture = ['127.0.0.1', 'localhost'].includes(location.hostname) &&
  document.querySelector('meta[name="ep-companion-fixture"][content="local-test-only"]');
if (!epHost && !epFixture) return;
// The document is shared by userscript sandboxes, even before <html> exists.
const epRunningEvent = 'ep-companion:running';
if (!document.dispatchEvent(new Event(epRunningEvent, { cancelable: true }))) return;
const epSchema = {"nseSavedVersion":"number","nseTaglist":"string","nseHardPassTaglist":"string","nseWhitelist":"string","nseBlacklistTitles":"string","nseHardPassTitles":"string","nseWhitelistTitles":"string","nseUploaders":"string","nseWhitelistUploaders":"string","nseIndividualUploadHidingEnabled":"boolean","nseIndividualUploadHidingBlacklist":"array","nseIndividualUploadHidingWhitelist":"array","nseFilterAllButtonEnabled":"boolean","nseRightClickManagementEnabled":"boolean","nseRCMTagsEnabled":"boolean","nseRCMTitlesEnabled":"boolean","nseRCMUploadersEnabled":"boolean","nseHideAnonUploadsEnabled":"boolean","nseHideReportedEnabled":"boolean","nseHideWarnedEnabled":"boolean","nseHideUnseededEnabled":"boolean","nseHideGrabbedEnabled":"boolean","nseHideLeechingEnabled":"boolean","nseHideSeedingEnabled":"boolean","nseHideSnatchedEnabled":"boolean","nseHideBookmarkedEnabled":"boolean","nseBypassWhitelistsEnabled":"boolean","nseHardPassEnabled":"boolean","nseRemoveHardPassResults":"boolean","nseObliviousModeEnabled":"boolean","nseCustomCSSEnabled":"boolean","nseCustomCSS":"string","nseScrollToNSEEnabled":"boolean","nseEmojiEnabled":"boolean","nseUpdateToastsEnabled":"boolean","nseFloatingToggleButtonEnabled":"boolean","nseOpenAllButtonEnabled":"boolean","nseOpenAllGoNextEnabled":"boolean","nseUIFont":"string","nseTextAreaFont":"string","nseBlacklistColor":"string","nseHardPassColor":"string","nseWhitelistColor":"string","nseTimeout":"number","nseSelectedTheme":"string","nseCustomTheme":"object","nseRenumberTorrentsEnabled":"boolean","nseHideCategoryIconsEnabled":"boolean","nseArrowNavigationEnabled":"boolean","nseRussianRouletteEnabled":"boolean","nseEveryDayIsApril1st":"boolean"};
const epStorage = {
  get: (key, fallback) => GM_getValue(key, fallback),
  set: (key, value) => GM_setValue(key, value),
  list: () => GM_listValues(),
  delete: key => GM_deleteValue(key)
};
GM_addStyle("/* SPDX-License-Identifier: GPL-3.0-or-later */\n.epc-root,.epc-thumbnail{\n  --epc-bg:#fbfcfe;--epc-fg:#18243a;--epc-line:#dbe2ee;--epc-accent:#274f9d;\n  --epc-muted:color-mix(in srgb,var(--epc-fg) 77%,var(--epc-bg));\n  --epc-subtle:color-mix(in srgb,var(--epc-bg) 95%,var(--epc-fg));\n  --epc-soft:color-mix(in srgb,var(--epc-bg) 88%,var(--epc-accent));\n  --epc-radius:12px;--epc-control-radius:7px;--epc-shadow:0 8px 24px #12234124;\n  box-sizing:border-box;font:13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;color:var(--epc-fg);color-scheme:light dark\n}\n.epc-root *,.epc-thumbnail *{box-sizing:border-box}\n.epc-root [hidden],.epc-root[hidden],.epc-filter-hidden{display:none!important}\n.epc-root :is(button,input,select),button.epc-root.epc-media-retry{\n  font:inherit;color:inherit;border:1px solid var(--epc-line);border-radius:var(--epc-control-radius);\n  background:var(--epc-bg);padding:5px 8px;margin:2px;max-width:100%;box-shadow:none!important;text-shadow:none\n}\n.epc-root button,button.epc-root.epc-media-retry{appearance:none;cursor:pointer;min-height:32px}\n.epc-root button:hover,button.epc-root.epc-media-retry:hover{background:var(--epc-subtle)}\n.epc-root :is(button,a,input,select,textarea,summary):focus-visible,button.epc-root.epc-media-retry:focus-visible{outline:2px solid var(--epc-accent);outline-offset:2px}\n.epc-root :is(input[type=radio],input[type=checkbox]){accent-color:var(--epc-accent)}\n.epc-root a{color:var(--epc-accent);text-decoration:underline}\n.epc-root p{margin:8px 0}\n.epc-root summary{cursor:pointer;font-weight:650;padding:7px 0}\n.epc-panel :is(span,h3)[data-setting-help]{width:fit-content;max-width:100%;cursor:help}\n.epc-panel :is(span,h3)[data-setting-help]:hover{text-decoration:underline dotted;text-underline-offset:3px}\n.epc-setting-tooltip{position:fixed;z-index:2147483001;width:max-content;max-width:min(340px,calc(100vw - 16px));padding:7px 10px;border:1px solid var(--epc-line);border-radius:var(--epc-control-radius);background:var(--epc-bg);color:var(--epc-fg);box-shadow:var(--epc-shadow);font-size:12px;line-height:1.45;overflow-wrap:anywhere}\n.epc-tools{position:fixed;right:16px;bottom:16px;z-index:2147483000}\n.epc-launcher{border-radius:999px!important;background:var(--epc-accent)!important;color:white!important;font-weight:750!important;padding:9px 13px!important;box-shadow:0 2px 12px #0003}\n.epc-panel{position:absolute;right:0;bottom:50px;width:min(460px,calc(100vw - 32px));max-height:calc(100vh - 100px);overflow:auto;background:var(--epc-bg);border:1px solid var(--epc-line);border-radius:10px;box-shadow:0 12px 40px #0004;padding:14px}\n.epc-panel-heading,.epc-preview-heading{display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:7px}\n.epc-panel-heading strong{font-size:16px}\n.epc-panel details{border-top:1px solid var(--epc-line);margin-top:8px}\n.epc-setting{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:4px 0}\n.epc-setting input[type=number],.epc-setting select{width:100px;flex-shrink:0}\n.epc-setting select[data-setting=gridCardWidth]{width:180px}\n.epc-setting input[type=checkbox]{width:18px;height:18px}\n.epc-actions{display:flex;flex-wrap:wrap;gap:4px;align-items:center}\n.epc-notice{white-space:pre-wrap;font-size:12px;color:var(--epc-accent)}\n.epc-health{font-variant-numeric:tabular-nums}\n.epc-log{white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;font:11px/1.4 ui-monospace,monospace}\n.epc-saved{background:var(--epc-bg);border:1px solid var(--epc-line);border-radius:7px;padding:6px 12px;margin:10px 0}\n.epc-saved-list{display:grid;gap:6px;margin-top:8px}\n.epc-saved-row{display:flex;gap:3px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--epc-line);padding-top:5px}\n.epc-search-name{flex:1;min-width:130px;text-align:left}\n.epc-thumbnail{display:inline-flex;float:left;position:relative;margin:0 8px 5px 0;vertical-align:top}\n.epc-thumb-button{display:flex;position:relative;justify-content:center;align-items:center;width:var(--epc-thumb-size);height:var(--epc-thumb-size);padding:0;border:1px solid var(--epc-line);border-radius:var(--epc-control-radius);background:var(--epc-subtle);overflow:hidden;cursor:zoom-in}\n.epc-thumb-button>img{display:block;width:100%;height:100%;object-fit:contain;border:0;margin:0}\n.epc-thumb-status{position:absolute;inset:auto 2px 2px;background:#17213ae8;color:#fff;font:11px/1.3 system-ui,sans-serif;text-align:center;padding:2px;border-radius:3px}\n.epc-thumb-button>img:not([src]){visibility:hidden}\n.epc-thumbnail [hidden]{display:none!important}\nhtml.epc-cover-art .torrent_grid__torrent .torrent__cover[style*=\"background\"]:not(.epc-native-cover),.torrent__cover.epc-managed-cover{background-image:none!important}\n.torrent__cover.epc-cover-positioned{position:relative}\n.epc-cover-image{position:absolute!important;inset:0;width:100%!important;height:100%!important;max-width:none!important;object-fit:cover;object-position:center;pointer-events:none}\n.epc-cover-image:not([src]){visibility:hidden}\n.epc-cover-status{position:absolute;bottom:5px;left:5px;right:5px;text-align:center;font:11px system-ui;color:#fff;background:#17213abf;border-radius:3px;padding:2px;pointer-events:none}\n.epc-cover-status[hidden]{display:none!important}\n.epc-category-overlay .cats_col,.epc-category-overlay .cats_cols{position:relative}\n.epc-category-overlay .cats_col>div[title],.epc-category-overlay .cats_cols>div[title]{position:absolute;top:2px;left:2px;z-index:1;width:24px;overflow:hidden}\n.epc-category-hide .cats_col>div[title],.epc-category-hide .cats_cols>div[title]{display:none!important}\n.epc-preview{position:fixed;z-index:2147482999;background:var(--epc-bg);border:1px solid var(--epc-line);border-radius:var(--epc-radius);box-shadow:var(--epc-shadow);padding:12px;overflow:auto;max-width:calc(100vw - 24px)}\n.epc-preview-heading strong{font-size:13px;overflow-wrap:anywhere}\n.epc-preview-heading button{flex-shrink:0}\n.epc-preview-frame{display:flex;align-items:center;justify-content:center;min-height:90px;overflow:hidden;background:var(--epc-subtle);border-radius:var(--epc-control-radius)}\n.epc-preview-frame>img{display:block;max-width:100%;max-height:inherit;width:auto;height:auto;object-fit:contain;margin:auto}\n.epc-preview-status{font-size:12px;min-height:18px}\n.epc-preview-stats{color:var(--epc-fg);opacity:.65;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}\n.epc-preview-summary{font-size:11px;max-height:65px;overflow:auto;overflow-wrap:anywhere}\n.epc-thumb-button,.epc-preview-frame{user-select:none}\n.epc-preview[data-mode=zoom]{padding:6px;overflow:hidden;cursor:zoom-in}\n.epc-preview[data-mode=zoom] .epc-preview-frame>img{width:100%;height:auto}\n.epc-preview[data-mode=zoom] .epc-preview-status:empty{display:none}\n.epc-preview[data-mode=tooltip]{padding:8px;overflow:hidden}\n.epc-preview[data-mode=tooltip] .epc-preview-frame{min-height:0;background:none}\n.epc-preview[data-mode=tooltip] .epc-preview-status:empty{display:none}\n.epc-preview[data-state=failed] .epc-preview-status,.epc-preview[data-state=stalled] .epc-preview-status{color:#a3391a}\n.epc-media-retry{display:inline-block;background:var(--epc-bg);padding:3px 7px;vertical-align:middle}\n#content img.epc-page-image{max-width:min(100%,calc(100vw - 48px))!important;height:auto}\n#content img.epc-page-image.epc-compact{max-height:75vh!important;object-fit:contain}\n@media(prefers-color-scheme:dark){.epc-root,.epc-thumbnail{--epc-bg:#1e2532;--epc-fg:#edf2fd;--epc-line:#3c495e;--epc-accent:#a8c0ff;--epc-shadow:0 8px 24px #0006}.epc-preview[data-state=failed] .epc-preview-status,.epc-preview[data-state=stalled] .epc-preview-status{color:#ffb194}}\n\n/* One in-page workspace. Engine DOM is private behavior infrastructure. */\n.epc-engine,#nseOuter,#nseFloatyBoi,#nseUpdateToast{display:none!important}\n.epc-workspace{display:block;margin:16px 0 20px;padding:0;border:1px solid var(--epc-line);border-radius:var(--epc-radius);background:var(--epc-bg);color:var(--epc-fg);clear:both;max-width:100%;text-align:left}\n.epc-toolbar{position:relative}\n.epc-toolbar-main,.epc-toolbar-context,.epc-toolbar-footer{display:flex;align-items:center;justify-content:space-between;gap:8px 12px;flex-wrap:wrap;padding:10px 14px;min-width:0}\n.epc-toolbar-main{position:relative;gap:5px 10px;padding-block:8px}\n.epc-toolbar-brand{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}\n.epc-brand-mark{display:grid;place-items:center;width:31px;height:31px;border-radius:8px;background:var(--epc-soft);color:var(--epc-accent)}\n.epc-root .epc-brand{font-weight:680;letter-spacing:-.025em;font-size:15px;margin:0}\n.epc-page-name{font-size:12px;color:var(--epc-muted)}\n.epc-icon{display:inline-block;width:15px;height:15px;flex:none;vertical-align:middle}\n.epc-toolbar :is(button,summary){display:inline-flex;align-items:center;justify-content:center;gap:6px;margin:0}\n.epc-toolbar .epc-load-gauge{width:34px;min-height:34px;padding:0;border:0;border-radius:50%;color:var(--epc-accent);font-size:10px;font-weight:700;font-variant-numeric:tabular-nums;\n  background:radial-gradient(circle closest-side,var(--epc-bg) 79%,transparent 83%),conic-gradient(var(--epc-accent) var(--epc-load-fill,0%),var(--epc-line) 0)}\n.epc-toolbar .epc-load-gauge:hover{background:radial-gradient(circle closest-side,var(--epc-soft) 79%,transparent 83%),conic-gradient(var(--epc-accent) var(--epc-load-fill,0%),var(--epc-line) 0)}\n.epc-load-detail{position:absolute;inset-inline-start:10px;z-index:6;width:min(305px,calc(100% - 20px));padding:10px 12px;\n  border:1px solid var(--epc-line);border-radius:var(--epc-radius);background:var(--epc-bg);box-shadow:var(--epc-shadow);font-size:12px}\n.epc-load-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.65fr);gap:3px 8px;align-items:baseline;margin-top:7px}\n.epc-load-count{color:var(--epc-muted);text-align:end;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}\n.epc-load-row progress{appearance:none;grid-column:1/-1;width:100%;height:3px;border:0;border-radius:2px;overflow:hidden;background:var(--epc-line)}\n.epc-load-row progress::-webkit-progress-bar{background:var(--epc-line)}\n.epc-load-row progress::-webkit-progress-value{background:var(--epc-accent)}\n.epc-load-row progress::-moz-progress-bar{background:var(--epc-accent)}\n.epc-load-row progress:indeterminate{background:linear-gradient(90deg,var(--epc-line),var(--epc-accent),var(--epc-line))}\n.epc-toolbar-context{justify-content:flex-start;column-gap:6px;padding-block:5px 8px}\n.epc-context-actions,.epc-result-actions,.epc-toolbar-utilities,.epc-toolbar-status,.epc-collage-tools{display:flex;align-items:center;gap:5px 6px;flex-wrap:wrap;min-width:0}\n.epc-result-actions{margin-inline-start:auto}\n.epc-result-actions [aria-expanded=true]{color:var(--epc-accent);background:var(--epc-soft)}\n.epc-result-actions [aria-controls=epc-view-options]::after{content:\"\";width:6px;height:6px;margin-top:-3px;border:solid currentColor;border-width:0 1px 1px 0;transform:rotate(45deg)}\n.epc-context-actions{justify-content:flex-end;margin-inline-start:auto;max-width:100%}\n.epc-context-actions:not(:has(> :not([hidden]))){display:none}\n.epc-layout-switch{display:inline-flex;padding:2px;border-radius:9px;border:1px solid var(--epc-line);gap:2px}\n.epc-root .epc-layout-switch button{min-height:27px;padding:3px 8px;border-radius:5px;background:transparent;border-color:transparent;color:var(--epc-muted)}\n.epc-root .epc-layout-switch button[aria-pressed=true]{background:var(--epc-bg);color:var(--epc-accent);border-color:var(--epc-line);font-weight:650}\n.epc-filtered-count{font-size:11px;border-radius:4px;padding:0 5px;color:var(--epc-accent);background:var(--epc-soft);font-variant-numeric:tabular-nums}\n.epc-results-end .epc-stop-icon,.epc-results-end [aria-busy=true]>.epc-load-icon{display:none}\n.epc-results-end [aria-busy=true]>.epc-stop-icon{display:inline-block}\n.epc-toolbar-footer{border-top:1px solid var(--epc-line);padding-block:6px}\n.epc-toolbar-footer:not(:has(.epc-toolbar-utilities> :not([hidden]),.epc-toolbar-status> :not([hidden]):not(:empty))){display:none}\n.epc-toolbar-utilities:not(:has(> :not([hidden]))),.epc-toolbar-status:not(:has(> :not([hidden]):not(:empty))){display:none}\n.epc-toolbar-status>span:empty{display:none}\n.epc-toolbar-status{color:var(--epc-muted);font-size:12px;font-variant-numeric:tabular-nums}\n.epc-toolbar-status .epc-collage-status,.epc-backfill-status{color:var(--epc-accent);overflow-wrap:anywhere}\n.epc-root .epc-active-filter{border:0;border-radius:999px;background:var(--epc-soft);color:var(--epc-accent);min-height:25px}\n.epc-toolbar-status [data-ep-reveal]{min-height:25px;padding-block:2px}\n.epc-results-end{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin:12px 0;padding:8px 0;border-top:1px solid var(--epc-line);color:var(--epc-muted);font-size:12px;text-align:start}\n.epc-results-end:has(>[aria-busy=true]){position:fixed;inset:auto 16px 16px auto;z-index:2147482998;max-width:min(480px,calc(100% - 32px));margin:0;padding:8px 10px;border:1px solid var(--epc-line);border-radius:var(--epc-radius);background:var(--epc-bg);box-shadow:var(--epc-shadow)}\n.epc-root .epc-load-more{display:inline-flex;align-items:center;gap:6px;margin-inline-start:auto}\n.epc-collage-tools select{margin:0}\n.epc-collage-tools button,.epc-collage-status{overflow-wrap:anywhere}\n.epc-toolbar .epc-collage-tools button{white-space:normal;text-align:start}\n.epc-root button:disabled{cursor:default;opacity:.6}\na.epc-backfilled-page{text-decoration:line-through!important;opacity:.65}\na.pager_next[aria-disabled=true],a[rel=next][aria-disabled=true]{opacity:.55;pointer-events:none}\n.epc-navigation{display:flex;align-items:center;gap:2px;flex-wrap:wrap}\n.epc-root :is(.epc-toolbar-main .epc-navigation button,.epc-quiet){background:transparent;border-color:transparent;color:var(--epc-muted)}\n.epc-root .epc-navigation button[aria-expanded=true],.epc-root [data-ep-reveal][aria-pressed=true]{color:var(--epc-accent);background:var(--epc-soft)}\n.epc-workspace>.epc-panel{display:block;position:static;width:auto;max-height:none;border:0;border-top:1px solid var(--epc-line);border-radius:0 0 var(--epc-radius) var(--epc-radius);box-shadow:none;overflow:visible;padding:16px}\n.epc-panel-heading{margin-bottom:8px}\n.epc-panel-heading strong{font-size:17px;letter-spacing:-.025em}\n.epc-root .epc-caption{font-size:12px;color:var(--epc-muted);line-height:1.5;margin:4px 0 12px}\n.epc-root .epc-shortcut-list{padding-inline-start:20px;list-style:disc}\n.epc-root .epc-notice{margin:0 12px 8px;padding:8px 10px;border-radius:5px;background:color-mix(in srgb,var(--epc-accent) 10%,transparent)}\n.epc-root .epc-notice:empty{display:none}\n.epc-rule-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}\n.epc-root .epc-group{display:block!important;margin:12px 0;padding:0;border:0}\n.epc-root .epc-option-group[hidden]{display:none!important}\n.epc-root .epc-option-group{border-top:1px solid var(--epc-line);padding:5px 0;margin:8px 0}\n.epc-option-group>summary{display:flex;align-items:center;gap:10px;list-style:none}\n.epc-option-group>summary::-webkit-details-marker{display:none}\n.epc-option-group>summary:before{content:\"›\";font-size:18px;line-height:1;transition:transform .1s}\n.epc-option-group[open]>summary:before{transform:rotate(90deg)}\n.epc-option-count{font-size:11px;font-weight:400;opacity:.65;margin-left:auto}\n.epc-basic-settings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;max-width:700px;margin:12px 0 18px}\n.epc-basic-settings .epc-field,.epc-basic-settings .epc-setting{margin:0}\n.epc-basic-settings .epc-setting{font-size:12px;flex-direction:column;align-items:stretch;justify-content:flex-start;gap:5px}\n.epc-basic-settings .epc-setting input,.epc-basic-settings .epc-setting select{width:100%;margin:0}\n.epc-settings-section{margin:10px 0 18px;max-width:700px}\n.epc-settings-section>h3{font-size:13px;margin:0 0 10px;font-weight:650}\n.epc-settings-section .epc-basic-settings{margin:0;gap:12px 20px}\n.epc-basic-settings .epc-setting-toggle{grid-column:1/-1;flex-direction:row;align-items:center;justify-content:flex-start;gap:8px}\n.epc-basic-settings .epc-setting-toggle input{width:16px;height:16px;margin:0}\n.epc-settings-help{font-size:12px;margin-top:10px}\n.epc-cache-usage .epc-option-group{margin-bottom:0}\n.epc-settings-section[hidden]{display:none!important}\n.epc-settings-search{display:block;width:min(100%,480px);margin:8px 0 12px!important}\n.epc-pane:is([data-pane=settings],[data-pane=filters],[data-pane=searches]){--epc-group-indent:20px}\n.epc-pane:is([data-pane=settings],[data-pane=filters],[data-pane=searches]) :is(details[open],.epc-basic-settings){padding-inline-start:var(--epc-group-indent)}\n.epc-pane:is([data-pane=settings],[data-pane=filters],[data-pane=searches]) details[open]>summary{margin-inline-start:calc(-1 * var(--epc-group-indent))}\n.epc-pane[data-pane=settings] .epc-cache-usage>:is(details,p){margin-inline-start:var(--epc-group-indent)}\n@media(max-width:530px){.epc-pane:is([data-pane=settings],[data-pane=filters],[data-pane=searches]){--epc-group-indent:12px}}\n.epc-pane[data-pane=searches] .epc-search-more{margin:0;border:0}\n.epc-search-more>summary{font-size:12px;font-weight:400;padding:4px 8px}\n.epc-pane[data-pane=searches] .epc-search-more[open]{margin-inline-start:var(--epc-group-indent);flex-basis:calc(100% - var(--epc-group-indent))}\n.epc-search-more[open]>summary{padding-inline:0}\n.epc-is-editing>.epc-search-more>button{display:none}\n.epc-search-editor{padding:12px;margin:6px 0;border:1px solid var(--epc-line);border-radius:var(--epc-control-radius);background:var(--epc-subtle)}\n.epc-search-editor>strong{display:block;margin-bottom:8px}\n.epc-search-editor-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px}\n.epc-search-editor .epc-field input:not([type=checkbox]),.epc-search-editor .epc-field select{width:100%}\n.epc-search-editor-extra{margin:8px 0}\n.epc-search-editor-status:empty{display:none}\n.epc-root h3{font:650 13px/1.5 system-ui,sans-serif;color:var(--epc-fg);margin:0 0 8px}\n.epc-root .epc-field{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:500;margin:10px 0}\n.epc-root textarea{width:100%;resize:vertical;min-height:65px;border:1px solid var(--epc-line);border-radius:var(--epc-control-radius);background:var(--epc-subtle);color:var(--epc-fg);font:12px/1.5 ui-monospace,monospace;padding:8px;box-sizing:border-box}\n.epc-root textarea{font-family:var(--epc-list-font,ui-monospace,monospace)}\n.epc-root .epc-field input,.epc-root .epc-field select{margin:0}\n.epc-check-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 20px}\n.epc-root .epc-check{display:flex;flex-direction:row;align-items:center;margin:3px 0;gap:8px;font-weight:400}\n.epc-check input{accent-color:var(--epc-accent)}\n.epc-root .epc-check input[type=checkbox]{flex:0 0 16px;width:16px;height:16px}\n.epc-root .epc-savebar{display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid var(--epc-line);margin-top:14px;padding-top:12px}\n.epc-root .epc-savebar .epc-caption{margin:0}\n.epc-root .epc-primary{background:var(--epc-accent);border-color:var(--epc-accent);color:var(--epc-bg);font-weight:650}\n.epc-root .epc-primary:hover{background:var(--epc-accent);filter:brightness(1.1)}\n.epc-root button:disabled{cursor:default;opacity:.5}\n.epc-saved{border:0;padding:0;margin:0}\n.epc-statistics{display:grid;grid-template-columns:1fr auto;gap:5px 16px;font-size:12px;max-width:500px}\n.epc-statistics dd{margin:0;font-variant-numeric:tabular-nums}\n.epc-setting{max-width:650px}\n.epc-setting:nth-child(n+12){font-size:12px}\n.epc-revealed{opacity:.75}\n.epc-filter-reason{display:block;width:fit-content;max-width:100%;margin:5px 0;color:#743918;background:#fff1de;border:1px solid #d99a62;border-radius:5px;padding:2px 7px;font-size:11px;font-weight:650;overflow-wrap:anywhere}\n.epc-grid-card-actions{display:flex;flex-wrap:wrap;align-items:flex-start;gap:6px;margin-top:6px}\n.epc-grid-tag-cue{color:#155846;background:#e5f5ee;border-radius:6px;padding:0 7px;font-size:12px;overflow-wrap:anywhere}\n.epc-grid-tag-cue[data-caution]{color:#694510;background:#fff2d4}\n.epc-grid-card-actions details>summary{padding:4px 0}\n.epc-grid-tag-matches{padding:0 0 5px}\n.epc-grid-versions{margin-inline-start:auto;padding:0 7px;border:1px solid var(--epc-line);border-radius:var(--epc-control-radius);background:var(--epc-bg);font-size:12px}\n.epc-grid-versions[open]{flex:1 0 100%}\n.epc-grid-version-list{list-style:none;margin:0;padding:0}\n.epc-grid-version-list li{display:flex;justify-content:space-between;flex-wrap:wrap;gap:3px 8px;padding:5px 0;border-top:1px solid var(--epc-line)}\n.epc-grid-version-list li>span{color:var(--epc-muted)}\n.epc-view-options{flex:0 0 100%;padding:8px 10px;background:var(--epc-subtle);border:1px solid var(--epc-line);border-radius:var(--epc-control-radius)}\n.epc-grid-options,.epc-column-options{display:flex;align-items:center;flex-wrap:wrap;gap:5px 14px}\n.epc-grid-options label{display:flex;align-items:center;flex-wrap:wrap;gap:4px}\n.epc-column-options .epc-caption{flex:0 0 100%;margin:0}\n.epc-column-option,.epc-column-option label{display:flex;align-items:center;gap:6px}\n.epc-column-option{justify-content:space-between;min-height:25px}\n.epc-column-option a{font-size:11px}\n#content [data-ep-list-column-hidden],#content table[data-ep-list-columns]>colgroup{display:none!important}\n#content ul#torrent_tags_list:not([data-ep-tags-expanded])>[data-ep-low-priority-tag]{display:none!important}\n#content ul#torrent_tags_list[data-ep-adaptive-tags]{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr));align-items:start;gap:6px 12px;float:none!important;width:auto!important}\n#content ul#torrent_tags_list[data-ep-adaptive-tags]>li{float:none!important;width:auto!important;min-width:0;box-sizing:border-box;margin:0;padding:4px 6px;overflow-wrap:anywhere}\n.epc-detail-tag-actions{margin:4px 0}\n.epc-luminance-import{margin-top:10px;border-top:1px solid var(--epc-line);padding:5px 0;max-width:680px}\n.epc-luminance-group{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;padding:4px 0;border-top:1px solid var(--epc-line)}\n.epc-luminance-group summary,.epc-luminance-tags,.epc-luminance-conflicts{overflow-wrap:anywhere}\n.epc-luminance-tags{font:12px/1.5 ui-monospace,monospace;max-height:8em;overflow:auto}\n.epc-seen-dim{opacity:.6}\n.epc-freeleech-view{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--epc-muted)}\n.epc-root .epc-freeleech-view select{min-height:32px;margin:0;color:var(--epc-fg)}\n.epc-conditional-list{list-style:none;padding:0;margin:0}\n.epc-conditional-list li{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 12px;padding:6px 0;border-bottom:1px solid var(--epc-line)}\n.epc-conditional-list li>span{min-width:0;overflow-wrap:anywhere}\n.epc-conditional-list:not(:empty)+button{margin-top:8px}\n.epc-conditional-advanced{margin-top:12px}\n.epc-conditional-advanced code{overflow-wrap:anywhere}\n.epc-conditional-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr) auto;align-items:end;gap:8px;margin-bottom:8px}\n.epc-root .epc-conditional-row .epc-field{min-width:0;margin:0}\n.epc-conditional-row input,.epc-conditional-row select{width:100%;min-width:0}\n.epc-conditional-builder>label{max-width:320px}\n@media(max-width:480px){.epc-conditional-row{grid-template-columns:minmax(0,1fr)}.epc-conditional-row>button{justify-self:start}}\n[data-ep-freeleech=sitewide]{outline:2px solid #db9e27;outline-offset:1px}\n[data-ep-freeleech=unlimited]{outline:1px dashed currentColor;outline-offset:1px}\n.epc-history-list{list-style:none;padding:0;margin:0}\n.epc-history-list li{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0}\n.epc-history-list a{min-width:0;overflow-wrap:anywhere}\n.epc-history-list button{flex-shrink:0}\n.nseToggleIcon{display:inline-flex!important;width:22px;height:22px;align-items:center;justify-content:center;cursor:pointer;border:1px solid #8a98ad!important;border-radius:5px!important;background:transparent!important;font:14px/1 system-ui,sans-serif!important;color:inherit}\n.nseToggleIcon>img{display:none!important}\n.nseToggleIcon:before{content:\"−\";font:14px/1 system-ui,sans-serif!important}\ntr[isnsehidden=\"1\"] .nseToggleIcon:before,.nseToggleIcon.nseIndividuallyBlacklisted:before{content:\"+\"}\n.nseToggleIcon:focus-visible{outline:2px solid var(--epc-accent,#4289dd);outline-offset:2px}\n#nseRCMBox.epc-root{position:fixed!important;z-index:2147483001!important;width:min(340px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:14px;border-radius:var(--epc-radius);background:var(--epc-bg)!important;color:var(--epc-fg)!important;border:1px solid var(--epc-line)!important;box-shadow:var(--epc-shadow)}\n#nseRCMBox .nseRCMButton{display:inline-block;background:var(--epc-bg)!important;color:var(--epc-fg)!important;border:1px solid var(--epc-line);border-radius:var(--epc-control-radius);font:12px/1.5 system-ui,sans-serif;padding:5px 8px;margin:3px 0;cursor:pointer}\n#nseRCMBox .nseRCMButton:hover{background:var(--epc-soft)!important}\n#nseRCMBox #nseRCMClose{font:12px/1.5 system-ui,sans-serif;cursor:pointer}\n.epc-rule-import{display:inline-block;border:1px solid var(--epc-line);border-radius:var(--epc-control-radius);background:var(--epc-bg);padding:5px 8px;cursor:pointer}\n.epc-rule-import:focus-visible{outline:2px solid var(--epc-accent);outline-offset:2px}\n.epc-saved-shortcuts{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0}\n.epc-root a.epc-saved-shortcut{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:3px 7px;border-radius:var(--epc-control-radius);color:var(--epc-accent)!important;background:var(--epc-soft);text-decoration:none;overflow-wrap:anywhere}\n.epc-root a.epc-saved-shortcut:hover{background:var(--epc-subtle)}\n.epc-saved-shortcut .epc-icon{width:12px;height:12px}\n.epc-toolbar .epc-quick-search{min-height:27px;padding:3px 5px}\n.epc-search-name{overflow-wrap:anywhere}\n.epc-search-feedback{display:flex;align-items:center;flex-wrap:wrap;gap:8px;grid-column:1/-1;margin:8px 0;padding:9px 12px;border:1px solid var(--epc-line);border-radius:5px;background:var(--epc-bg)}\n.epc-savebar [role=status]{font-size:12px;opacity:.72}\n.epc-root [aria-invalid=true]{border-color:#bf493e!important;outline:1px solid #bf493e}\n#content .nseHiddenTag,#content .nseHiddenTitle,#content .nseHiddenUploader,#content .nseBlacklistIdentifier{color:var(--epc-blocked,#f00)!important}\n#content .nseWhitelistedTag,#content .nseWhitelistedTitle,#content .nseWhitelistedUploader{color:var(--epc-allowed,#0f0)!important}\n#content .nseHardPassTag,#content .nseHardPassTitle{color:var(--epc-hard-pass,#a00)!important}\n/* Result tools share the existing list and rule menu. No extra toolbar. */\n#content tr.epc-version-hidden{display:none!important}\n#content tr.epc-version-member>td:nth-child(2){border-inline-start:2px solid #7a8ba780}\n#content .epc-version-control{display:inline-block;margin:3px 0 3px 8px;padding:2px 7px;border:1px solid #7a8ba780;border-radius:4px;background:transparent;color:inherit;font:11px/1.6 system-ui,sans-serif;cursor:pointer;vertical-align:middle}\n#content .epc-version-control:before{content:\"▸\";margin-inline-end:4px}\n#content .epc-version-control[aria-expanded=true]:before{content:\"▾\"}\n#content .epc-version-control:hover{background:#7a8ba720}\n#content .epc-version-control:focus-visible{outline:2px solid #4289dd;outline-offset:2px}\n#content a[data-ep-tag-tone=favorite]:not(.nseHiddenTag):not(.nseHardPassTag){background:#ccefe0;color:#154f39!important;box-shadow:inset 0 -2px #298661;border-radius:3px}\n#content a[data-ep-tag-tone=caution]:not(.nseHiddenTag):not(.nseHardPassTag){background:#ffe2a8;color:#68420b!important;box-shadow:inset 0 -2px #b67816;border-radius:3px}\n#content table.epc-stable-columns{table-layout:fixed;width:100%;min-width:var(--epc-table-min-width,0px)}\n#content table.epc-stable-columns td[width],#content table.epc-stable-columns th[width]{width:auto}\n#content table.epc-stable-columns td.user,#content table.epc-stable-columns .tags{overflow-wrap:anywhere}\n#content a.epc-tag-match{text-decoration:underline!important;text-decoration-thickness:2px!important;text-underline-offset:3px;font-weight:700}\n#nseRCMBox .epc-highlight-actions{margin-top:10px;padding-top:8px;border-top:1px solid var(--epc-line)}\n#nseRCMBox .epc-highlight-actions p{margin:0 0 5px}\n#nseRCMBox .epc-highlight-actions button{padding:4px 7px;margin:0 5px 4px 0}\n#nseRCMBox .epc-highlight-actions button[aria-pressed=true]{box-shadow:inset 0 0 0 2px var(--epc-accent)}\n#nseRCMBox .epc-menu-caption{display:block;margin-top:8px}\n#nseRCMBox[data-ep-rule-kind=tag] #nseRCMBoxChoices{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}\n#nseRCMBox[data-ep-rule-kind=tag] #nseRCMBoxChoices br{display:none}\n@media(max-width:700px){.epc-rule-grid,.epc-basic-settings,.epc-search-editor-fields,.epc-check-grid{grid-template-columns:1fr}.epc-savebar{flex-wrap:wrap}}\n@media(max-width:530px){\n  .epc-toolbar :is(.epc-toolbar-main,.epc-toolbar-context,.epc-toolbar-footer){padding-inline:10px}\n  .epc-toolbar:has(.epc-layout-switch:not([hidden])) .epc-page-name{display:none}\n  .epc-toolbar :is(.epc-navigation,.epc-result-actions,.epc-layout-switch) .epc-icon{display:none}\n  .epc-grid-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 10px}\n  .epc-grid-options label:has(select){display:grid}\n  .epc-grid-options select{width:100%;min-width:0;margin:0}\n}\n@media(pointer:coarse){\n  .epc-root .epc-toolbar :is(button,select,summary),.epc-root a.epc-saved-shortcut,.epc-root .epc-load-more{min-height:44px}\n  .epc-grid-card-actions summary{min-height:44px;align-content:center}\n  .epc-toolbar .epc-load-gauge{width:44px}\n}\n\n/* First-use setup reuses the workspace's visual language and settings. */\n.epc-onboarding{width:min(560px,calc(100vw - 24px));max-height:calc(100dvh - 32px);overflow:auto;margin:auto;padding:22px;border:1px solid var(--epc-line);border-radius:var(--epc-radius);background:var(--epc-bg);color:var(--epc-fg);text-align:left;box-shadow:var(--epc-shadow)}\n.epc-onboarding::backdrop{background:#1017239c}\n.epc-onboarding h2{margin:0 0 10px;font-size:21px;line-height:1.25;color:inherit}\n.epc-welcome-heading{display:flex;align-items:center;gap:10px;margin-block-end:10px}\n.epc-welcome-heading .epc-brand-mark{flex:none}\n.epc-onboarding .epc-welcome-heading h2{margin:0}\n.epc-onboarding fieldset{margin:16px 0 12px;padding:12px;border:1px solid var(--epc-line);border-radius:8px;min-width:0}\n.epc-onboarding legend{padding:0 5px;font-weight:650}\n.epc-welcome-choice{display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer}\n.epc-welcome-field{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 0}\n.epc-welcome-field input[type=number]{width:70px}\n.epc-onboarding textarea{width:100%;font:inherit;color:inherit;background:var(--epc-subtle);border:1px solid var(--epc-line);border-radius:var(--epc-control-radius);padding:7px;resize:vertical}\n.epc-onboarding details{border-top:1px solid var(--epc-line);margin-top:16px;padding-top:4px}\n.epc-onboarding details .epc-welcome-field{display:block}\n.epc-welcome-sample{width:var(--epc-sample-width);max-width:100%;height:64px;border-radius:var(--epc-control-radius);margin:8px 0 12px;display:grid;place-items:center;color:var(--epc-accent);background:var(--epc-soft);font-size:11px}\n.epc-onboarding .epc-actions{justify-content:flex-end;margin-top:16px}\n@media(max-width:420px){.epc-onboarding{padding:16px}.epc-welcome-field{flex-wrap:wrap}.epc-onboarding h2{font-size:19px}}\n.epc-onboarding{padding:18px}\n.epc-onboarding p{margin:6px 0}\n.epc-onboarding fieldset{margin:12px 0 10px;padding:10px}\n.epc-welcome-choice{padding:2px 0}\n.epc-welcome-sample{height:40px}\n.epc-onboarding .epc-actions{position:sticky;bottom:-18px;padding:10px 0 4px;background:var(--epc-bg);box-shadow:0 -8px 8px var(--epc-bg)}\n@media(max-width:420px){.epc-onboarding .epc-actions{bottom:-16px}}\n.epc-cache-usage,.epc-cache-pinned{margin:12px 0;padding:12px;border:1px solid var(--epc-line);border-radius:7px;max-width:560px}\n.epc-cache-pinned{margin-inline:14px}\n#epc-cache-statistics dl{margin:6px 0}\n#epc-cache-statistics dl>div{display:flex;justify-content:space-between;gap:16px;padding:2px 0}\n#epc-cache-statistics dt,#epc-cache-statistics dd{margin:0}\n#epc-cache-statistics dd{font-variant-numeric:tabular-nums;text-align:right}\n:is(.epc-cache-usage,.epc-cache-pinned) p{margin:4px 0 0}\n.epc-cache-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}\n.epc-cache-heading strong{font-size:13px}\n.epc-cache-heading button{font-size:11px;min-height:25px;padding:3px 7px}\n.epc-cache-activity{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px;table-layout:auto}\n.epc-cache-activity th,.epc-cache-activity td{padding:4px 3px;text-align:right;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}\n.epc-cache-activity th{font-size:11px;font-weight:600}\n.epc-cache-activity th:first-child{text-align:left;width:18%}\n.epc-cache-activity thead th{border-bottom:1px solid var(--epc-line);cursor:help;text-decoration:underline dotted;text-underline-offset:2px}\n.epc-cache-activity tbody th{font-weight:400}\n.epc-cache-activity tbody tr:last-child>*{border-top:1px solid var(--epc-line)}\n@media(max-width:420px){.epc-cache-usage,.epc-cache-pinned{padding:10px 8px}.epc-cache-activity{font-size:11px}.epc-cache-activity th{font-size:10px}.epc-cache-activity th,.epc-cache-activity td{padding:4px 2px}}\n\n/* Grid presentation of the native result rows. */\n#content table.epc-result-grid{display:block!important;width:100%!important;min-width:0!important;table-layout:auto!important;border:0;border-spacing:0}\n#content .epc-result-grid>colgroup{display:none!important}\n#content .epc-result-grid>tbody{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--epc-grid-width,320px)),1fr));gap:16px;align-items:start;width:100%}\n#content .epc-result-grid>thead,#content .epc-result-grid>tfoot{display:block;width:100%;margin-bottom:12px}\n#content .epc-result-grid tr:not(.torrent){display:flex;flex-wrap:wrap;gap:8px;grid-column:1/-1}\n#content .epc-result-grid tr[data-ep-grid-header=static]{display:none!important}\n#content .epc-result-grid tr[data-ep-grid-header=sortable]:before{content:\"Sort by\";align-self:center;font:11px system-ui,sans-serif;opacity:.65}\n#content .epc-result-grid tr:not(.torrent)>th,#content .epc-result-grid tr:not(.torrent)>td{display:block;width:auto!important;padding:5px;border:0}\n#content .epc-result-grid tr[data-ep-grid-header=sortable]>:is(th,td):not(:has(a,button,input,select)){display:none!important}\n#content .epc-result-grid tr:not(.torrent)>th:empty{display:none}\n#content .epc-result-grid{--epc-card-inset:12px}\n#content .epc-result-grid tr.torrent{display:flex;flex-wrap:wrap;align-content:start;gap:0;min-width:0;max-width:100%;height:auto!important;min-height:0!important;margin:0;padding:0;border:1px solid #7a8ba760;border-radius:10px;box-sizing:border-box;overflow:hidden;box-shadow:0 2px 7px #0000000a}\n#content .epc-result-grid tr.torrent[hidden],#content .epc-result-grid tr.torrent.hidden:not(.epc-revealed),#content .epc-result-grid tr.epc-version-hidden,#content tr.torrent.epc-filter-hidden{display:none!important}\n#content .epc-result-grid tr.torrent>td{display:block!important;box-sizing:border-box;min-width:0!important;width:auto!important;max-width:100%;height:auto!important;min-height:0!important;border:0!important;padding:6px 10px 6px 0;text-align:left;vertical-align:top;overflow-wrap:anywhere}\n#content .epc-result-grid tr.torrent>td[data-ep-grid-cell=category-hidden],#content .epc-result-grid tr.torrent>td[hidden],#content .epc-result-grid tr.torrent>td.hidden{display:none!important}\n#content .epc-result-grid tr.torrent>td[data-ep-grid-cell=title]{order:0;flex:0 0 100%;padding:var(--epc-card-inset);font-size:14px;line-height:1.5}\n#content .epc-result-grid [data-ep-grid-cell=title]>br{display:none}\n#content .epc-result-grid [data-ep-grid-cell=title]>a{font-weight:650}\n#content .epc-result-grid [data-ep-grid-title]{display:-webkit-box!important;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;min-height:3em;max-height:3em;line-height:1.5;overflow-wrap:anywhere}\n#content .epc-result-grid [data-ep-grid-cell=title] .tags{margin-top:8px;font-size:12px;line-height:1.7}\n#content .epc-result-grid:not([data-ep-grid-tags=true]) tr.torrent .tags{display:none!important}\n#content .epc-result-grid [data-ep-grid-cell=title] .tags>a{display:inline-block;margin-inline-end:5px;max-width:100%;overflow-wrap:anywhere}\n#content .epc-result-grid tr.torrent>td[data-ep-grid-cell=category]{order:2;flex:0 0 100%;font-size:11px;opacity:.8}\n#content .epc-result-grid tr.torrent>td[data-ep-grid-cell=meta]{order:1;flex:1 0 30%;font-size:12px;border-top:1px solid #7a8ba730!important}\n#content .epc-result-grid tr.torrent>td:is([data-ep-grid-cell=meta],[data-ep-grid-cell=category]){padding-inline:var(--epc-card-inset)}\n#content .epc-result-grid:not([data-ep-grid-details=true]) tr.torrent>td[data-ep-grid-cell=meta],#content .epc-result-grid:not([data-ep-grid-details=true]) tr.torrent>td[data-ep-grid-cell=category]{display:none!important}\n#content .epc-result-grid [data-ep-grid-cell=meta]:before{content:attr(data-ep-grid-label);display:block;font:10px/1.5 system-ui,sans-serif;opacity:.65}\n#content .epc-result-grid .epc-thumbnail{display:block;float:none;width:auto;margin:calc(-1 * var(--epc-card-inset)) calc(-1 * var(--epc-card-inset)) var(--epc-card-inset)}\n#content .epc-result-grid .epc-thumb-button{width:100%;height:auto;aspect-ratio:16/9;min-height:120px;max-height:none;border:0;border-radius:0}\n#content .epc-result-grid .epc-thumb-button:focus-visible{outline:2px solid var(--epc-accent);outline-offset:-3px}\n#content .epc-result-grid .epc-thumb-button>:is(img,canvas){position:absolute;inset:0;width:100%;height:100%;max-width:none;max-height:none;object-fit:cover}\n.epc-grid-gif-poster{display:none}\n.epc-root .epc-cover-motion-note{grid-column:1/-1;margin:0}\n.epc-root label:has(>input:disabled[aria-describedby^=\"epc-cover-motion-\"]){opacity:.65;cursor:not-allowed}\n.epc-thumb-button>:is(.epc-grid-gif-poster,.epc-grid-gif-playback){position:absolute;inset:0;width:100%;height:100%;object-fit:contain}\n#content :is(.epc-result-grid,.epc-managed-cover) .epc-grid-gif-poster,\nhtml[data-ep-list-autoplay] #content tr.torrent .epc-grid-gif-poster{display:block}\n#content .epc-managed-cover>:is(.epc-grid-gif-poster,.epc-grid-gif-playback){position:absolute;inset:0;width:100%;height:100%;max-width:none;max-height:none;object-fit:cover;pointer-events:none}\n#content .epc-result-grid [data-ep-grid-gif] img:not(.epc-grid-gif-playback),\nhtml[data-ep-list-autoplay] #content tr.torrent [data-ep-grid-gif] img:not(.epc-grid-gif-playback){visibility:hidden}\n#content .epc-managed-cover[data-ep-grid-gif]>.epc-cover-image{visibility:hidden}\n#content :is(.epc-thumbnail[data-ep-grid-playing] .epc-thumb-button,.epc-managed-cover[data-ep-grid-playing])>:not(.epc-grid-gif-playback){visibility:hidden!important}\n@media(prefers-reduced-motion:reduce){\n  #content .epc-grid-gif-playback{display:none}\n}\n#content .epc-result-grid .epc-version-control{display:none!important}\n#content .epc-result-grid .cats_col>div[title],#content .epc-result-grid .cats_cols>div[title]{position:static}\n@media(max-width:520px){#content .epc-result-grid>tbody{gap:12px}#content .epc-result-grid{--epc-card-inset:10px}}\n#content .epc-result-grid[data-ep-grid-spacing=compact]>tbody{gap:10px}\n#content .epc-result-grid[data-ep-grid-spacing=compact]{--epc-card-inset:8px}\n\nhtml[data-ep-compact-cover-grid] #content .torrent_grid{gap:4px;padding:0}\nhtml[data-ep-compact-cover-grid] #content .torrent_grid>.torrent_grid__torrent{padding:0;border-width:1px}\nhtml[data-ep-compact-cover-grid] #content .torrent_grid .torrent_grid__torrent__info{padding:6px}\n");
const epBridge = {};
function epRunNSE(app) {
  const run = () => app.batchDOM(() => {
    try {
      if (isNSEPage(location.href)) epNSEEngine(app, epBridge);
    } catch { app.report('Filters could not start on this page. Reload the page and try again.'); }
    finally { app.adoptEngine(); app.filtersFinished(); }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}
const epApp = createApp(window, epStorage, {
  waitForFilters: true, startNSE: epRunNSE,
  requestImage: typeof GM_xmlhttpRequest === 'function' ? details => GM_xmlhttpRequest(details) : null,
  empTemplate: epHost ? {
    nseSchema: epSchema,
    prompt: window.prompt?.bind(window),
    copyPassphrase: typeof GM_setClipboard === 'function' ? text => GM_setClipboard(text, 'text') : null
  } : null,
  localImageCache: !!epFixture,
  newRows: (root, rows) => epBridge.newRows?.(root, rows),
  flushNSE: () => epBridge.flush?.(),
  refreshFilters: syncInputs => epBridge.refresh?.(syncInputs),
  validateDraftFilters: () => epBridge.validateDraft?.(),
  openVisible: () => epBridge.openVisible?.(),
  hideVisible: () => epBridge.hideVisible?.(),
  resultActionsAvailable: () => epBridge.resultActions,
  addStyle: css => GM_addStyle(css),
  validateNSE: input => validateNSE(input, epSchema)
}).start();
document.addEventListener(epRunningEvent, event => event.preventDefault());
GM_registerMenuCommand('Companion settings', () => {
  epApp.openPane('settings'); epApp.root?.scrollIntoView({ block: 'start' });
});
function epNSEEngine(app, bridge) {
  // NSE can only enumerate/delete its own settings, so its Reset and Export
  // controls cannot accidentally erase saved searches or image preferences.
  const GM_info = { script: { version: '2.8.2' } };
  const GM_listValues = () => epStorage.list().filter(key => Object.hasOwn(epSchema, key));
  const GM_deleteValue = key => { if(Object.hasOwn(epSchema, key)) epStorage.delete(key); };
  const GM_getValue = (key, fallback) => {
    const value = epStorage.get(key, NSE_EMPTY_LISTS.includes(key) ? '' : fallback);
    try { return validateNSE({ [key]: value }, epSchema)[key]; }
    catch { return NSE_EMPTY_LISTS.includes(key) ? '' : fallback; }
  };
  const GM_setValue = (key, value) => {
    const checked = validateNSE({ [key]: value }, epSchema);
    epStorage.set(key, checked[key]);
  };
  // Copyright © 2015-2026 ceodoe
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.


// +----------------------------+
// | Loading and initialization |
// +----------------------------+

// Get version information
let nseVersion = GM_info.script.version.split(".");
let nseVersionNum = Number(nseVersion[0] + nseVersion[1].padStart(2, "0") + nseVersion[2].padStart(2, "0"));
let nseSavedVersion = GM_getValue("nseSavedVersion", nseVersionNum);
GM_setValue("nseSavedVersion", nseSavedVersion);

// Load and initialize saved filter lists
let nseBlacklistTaglist = GM_getValue("nseTaglist", "enter.tags.here separated.by.spaces no.newlines").trim();
let nseBlacklistTags = nseBlacklistTaglist.split(" ");
nseBlacklistTags.sort();
nseBlacklistTaglist = nseBlacklistTags.join(" ");
if(nseBlacklistTags.length === 1 && nseBlacklistTags[0] === "") { nseBlacklistTags = new Array(0); }
GM_setValue("nseTaglist", nseBlacklistTaglist);

let nseHardPassTaglist = GM_getValue("nseHardPassTaglist", "enter.hard.pass.tags.here big.poopies gushing.blood").trim();
let nseHardPassTags = nseHardPassTaglist.split(" ");
nseHardPassTags.sort();
nseHardPassTaglist = nseHardPassTags.join(" ");
if(nseHardPassTags.length === 1 && nseHardPassTags[0] === "") { nseHardPassTags = new Array(0); }
GM_setValue("nseHardPassTaglist", nseHardPassTaglist);

let nseWhitelistTaglist = GM_getValue("nseWhitelist", "whitelist.tags go.here").trim();
let nseWhitelistTags = nseWhitelistTaglist.split(" ");
nseWhitelistTags.sort();
nseWhitelistTaglist = nseWhitelistTags.join(" ");
if(nseWhitelistTags.length === 1 && nseWhitelistTags[0] === "") { nseWhitelistTags = new Array(0); }
GM_setValue("nseWhitelist", nseWhitelistTaglist);

let nseBlacklistTitleList = GM_getValue("nseBlacklistTitles", "this is a title phrase;this is another title phrase").trim();
let nseBlacklistTitlePhrases = nseBlacklistTitleList.split(";");
nseBlacklistTitlePhrases.sort();
nseBlacklistTitleList = nseBlacklistTitlePhrases.join(";");
if(nseBlacklistTitlePhrases.length === 1 && nseBlacklistTitlePhrases[0] === "") { nseBlacklistTitlePhrases = new Array(0); }
GM_setValue("nseBlacklistTitles", nseBlacklistTitleList);

let nseHardPassTitleList = GM_getValue("nseHardPassTitles", "this is a title phrase;this is another title phrase").trim();
let nseHardPassTitlePhrases = nseHardPassTitleList.split(";");
nseHardPassTitlePhrases.sort();
nseHardPassTitleList = nseHardPassTitlePhrases.join(";");
if(nseHardPassTitlePhrases.length === 1 && nseHardPassTitlePhrases[0] === "") { nseHardPassTitlePhrases = new Array(0); }
GM_setValue("nseHardPassTitles", nseHardPassTitleList);

let nseWhitelistTitleList = GM_getValue("nseWhitelistTitles", "this is a title phrase;this is another title phrase").trim();
let nseWhitelistTitlePhrases = nseWhitelistTitleList.split(";");
nseWhitelistTitlePhrases.sort();
nseWhitelistTitleList = nseWhitelistTitlePhrases.join(";");
if(nseWhitelistTitlePhrases.length === 1 && nseWhitelistTitlePhrases[0] === "") { nseWhitelistTitlePhrases = new Array(0); }
GM_setValue("nseWhitelistTitles", nseWhitelistTitleList);

let nseBlacklistUploadersList = GM_getValue("nseUploaders", "PutUserNamesHere SeparatedBySpaces NoNewlines").trim();
let nseBlacklistUploaders = nseBlacklistUploadersList.split(" ");
nseBlacklistUploaders.sort();
nseBlacklistUploadersList = nseBlacklistUploaders.join(" ");
if(nseBlacklistUploaders.length === 1 && nseBlacklistUploaders[0] === "") { nseBlacklistUploaders = new Array(0); }
GM_setValue("nseUploaders", nseBlacklistUploadersList);

let nseWhitelistUploadersList = GM_getValue("nseWhitelistUploaders", "PutUserNamesHere SeparatedBySpaces NoNewlines").trim();
let nseWhitelistUploaders = nseWhitelistUploadersList.split(" ");
nseWhitelistUploaders.sort();
nseWhitelistUploadersList = nseWhitelistUploaders.join(" ");
if(nseWhitelistUploaders.length === 1 && nseWhitelistUploaders[0] === "") { nseWhitelistUploaders = new Array(0); }
GM_setValue("nseWhitelistUploaders", nseWhitelistUploadersList);

// Delete obsolete options
GM_deleteValue("nseEnableGCDCompatibilityMode");


// Load saved options
//  Filtering options
//   Individual upload filtering
let nseIndividualUploadHidingEnabled = GM_getValue("nseIndividualUploadHidingEnabled", true);
let nseIndividualUploadHidingBlacklist = GM_getValue("nseIndividualUploadHidingBlacklist", new Array(0));
let nseIndividualUploadHidingWhitelist = GM_getValue("nseIndividualUploadHidingWhitelist", new Array(0));

// Filter all button
let nseFilterAllButtonEnabled = GM_getValue("nseFilterAllButtonEnabled", true);

//   Right-Click Management
let nseRightClickManagementEnabled = GM_getValue("nseRightClickManagementEnabled", true);
let nseRCMTagsEnabled = GM_getValue("nseRCMTagsEnabled", true);
let nseRCMTitlesEnabled = GM_getValue("nseRCMTitlesEnabled", true);
let nseRCMUploadersEnabled = GM_getValue("nseRCMUploadersEnabled", true);

//   Torrent site status
let nseHideAnonUploadsEnabled = GM_getValue("nseHideAnonUploadsEnabled", false);
let nseHideReportedEnabled = GM_getValue("nseHideReportedEnabled", false);
let nseHideWarnedEnabled = GM_getValue("nseHideWarnedEnabled", false);
let nseHideUnseededEnabled = GM_getValue("nseHideUnseededEnabled", false);

//   Torrent personal status
let nseHideGrabbedEnabled = GM_getValue("nseHideGrabbedEnabled", false);
let nseHideLeechingEnabled = GM_getValue("nseHideLeechingEnabled", false);
let nseHideSeedingEnabled = GM_getValue("nseHideSeedingEnabled", false);
let nseHideSnatchedEnabled = GM_getValue("nseHideSnatchedEnabled", false);
let nseHideBookmarkedEnabled = GM_getValue("nseHideBookmarkedEnabled", false);
let nseBypassWhitelistsEnabled = GM_getValue("nseBypassWhitelistsEnabled", false);

//   Hard Pass
let nseHardPassEnabled = GM_getValue("nseHardPassEnabled", false);
let nseRemoveHardPassResults = GM_getValue("nseRemoveHardPassResults", false);

//  Interface options
//   Oblivious mode
let nseObliviousModeEnabled = GM_getValue("nseObliviousModeEnabled", false);

//   Custom CSS
let nseCustomCSSEnabled = GM_getValue("nseCustomCSSEnabled", false);
let nseCustomCSS = GM_getValue("nseCustomCSS", "/* With great power comes great responsibility */");

//   Auto-scroll to NSE
let nseScrollToNSEEnabled = GM_getValue("nseScrollToNSEEnabled", false);

//   Emoji
let nseEmojiEnabled = GM_getValue("nseEmojiEnabled", true);

//   Update toasts
let nseUpdateToastsEnabled = GM_getValue("nseUpdateToastsEnabled", true);

//   Floating toggle button
let nseFloatingToggleButtonEnabled = GM_getValue("nseFloatingToggleButtonEnabled", true);

//   Open all button
let nseOpenAllButtonEnabled = GM_getValue("nseOpenAllButtonEnabled", true);
let nseOpenAllGoNextEnabled = GM_getValue("nseOpenAllGoNextEnabled", false);

//   Fonts
let nseUIFont = GM_getValue("nseUIFont", "Helvetica");
let nseTextAreaFont = GM_getValue("nseTextAreaFont", "Monospace");

// Highlight colors
let nseBlacklistColor = GM_getValue("nseBlacklistColor", "#F00");
let nseHardPassColor = GM_getValue("nseHardPassColor", "#A00");
let nseWhitelistColor = GM_getValue("nseWhitelistColor", "#0F0");

// Custom timeout
let nseTimeout = GM_getValue("nseTimeout", 1500);

//   Theme
let nseSelectedTheme = GM_getValue("nseSelectedTheme", "nseThemeDefault");
let nseCustomTheme = GM_getValue("nseCustomTheme", {
    backgroundColor: "#fff",
    backgroundHighlightColor: "#cfe7ff",
    foregroundColor: "#000",
    accentColor: "#0af",
    highlightColor: "#0071b0",
    hiddenBackgroundColor: "#aaf"
});

if(nseCustomTheme.hiddenBackgroundColor == undefined) {
    nseCustomTheme.hiddenBackgroundColor = "#aaf";
}

let themes = {
    nseThemeDefault:
        {
            backgroundColor: "#fff",
            backgroundHighlightColor: "#cfe7ff",
            foregroundColor: "#000",
            accentColor: "#0af",
            highlightColor: "#0071b0",
            hiddenBackgroundColor: "#aaf"
        },
    nseThemeLegacy:
        {
            backgroundColor: "#00f",
            backgroundHighlightColor: "#44f",
            foregroundColor: "#fff",
            accentColor: "#ddd",
            highlightColor: "#fff",
            hiddenBackgroundColor: "#aaf"
        },
    nseThemeEdgy:
        {
            backgroundColor: "#000",
            backgroundHighlightColor: "#333",
            foregroundColor: "#f00",
            accentColor: "#f22",
            highlightColor: "#f22",
            hiddenBackgroundColor: "#aaf"
        },
    nseThemeBaked:
        {
            backgroundColor: "#8300ff",
            backgroundHighlightColor: "#087300",
            foregroundColor: "#0a8700",
            accentColor: "#b669ff",
            highlightColor: "#b669ff",
            hiddenBackgroundColor: "#aaf"
        },
    nseThemeDarkPurple:
        {
            backgroundColor: "#31363b",
            backgroundHighlightColor: "#495057",
            foregroundColor: "#ffffff",
            accentColor: "#7b68ee",
            highlightColor: "#7b68ee",
            hiddenBackgroundColor: "#aaf"
        },
    nseThemeCustom:
        {
            backgroundColor: nseCustomTheme.backgroundColor,
            backgroundHighlightColor: nseCustomTheme.backgroundHighlightColor,
            foregroundColor: nseCustomTheme.foregroundColor,
            accentColor: nseCustomTheme.accentColor,
            highlightColor: nseCustomTheme.highlightColor,
            hiddenBackgroundColor: nseCustomTheme.hiddenBackgroundColor
        }
};

let nseThemeDescriptions = {
    nseThemeDefault: "White background with black text and blue accents",
    nseThemeLegacy: "Ye Olde Theme with a blue background and white text",
    nseThemeEdgy: "For the edgelord in all of us, red text on a black background",
    nseThemeBaked: "Ayyyy 420 blaze it &mdash; Green and purple",
    nseThemeDarkPurple: "A dark mode theme with purple highlights",
    nseThemeCustom: "Define your own colors using the text boxes below"
};

//   Extras
let nseRenumberTorrentsEnabled = GM_getValue("nseRenumberTorrentsEnabled", true);
let nseHideCategoryIconsEnabled = GM_getValue("nseHideCategoryIconsEnabled", false);
let nseArrowNavigationEnabled = GM_getValue("nseArrowNavigationEnabled", false);

//   "Fun"
let nseRussianRouletteEnabled = GM_getValue("nseRussianRouletteEnabled", false);
let nseEveryDayIsApril1st = GM_getValue("nseEveryDayIsApril1st", false);


// +------------------------------+
// | Script setup and preparation |
// +------------------------------+

// Figure out what page we're on
let currentPage = "Torrents";
if(window.location.href.includes("top10.php")) {
    currentPage = "Top 10";
} else if(window.location.href.includes("user.php?action=notify")) {
    currentPage = "Notification filters";
} else if(window.location.href.match(/torrents\.php.*(\?|&)(action=notify)/)) {
    currentPage = "Notifications";
} else if(window.location.href.match(/torrents\.php.*(\?|&)(id=)/)) {
    currentPage = "Torrent details";
} else if(window.location.href.includes("/collage/")) {
    currentPage = "Collage";
} else if(window.location.href.includes("/requests.php")) {
    currentPage = "Requests";
} else if(window.location.href.includes("type=uploaded")) {
    // Check if we are on our own uploaded page
    let myUserID = document.querySelector(".username").href.match(/id=([0-9]+)/)[1];
    let pageUserID = window.location.href.match(/userid=([0-9]+)/)[1];

    if(myUserID === pageUserID) {
        currentPage = "My uploaded";
    } else {
        currentPage = "Uploaded";
    }
}

// Define which of our pages where filtering doesn't apply, but other functionality should work
let nseUnfilteredPages = ["My uploaded", "Notification filters", "Torrent details"];

// Reenable torrent icon box and hide comments if GCD is running, check for its unique elements a.comment
if(currentPage == "Torrents") { //torrents.php is the only page we have in common
    window.setTimeout(function() {
        if(document.querySelector("a.comment")) {
            GM_addStyle(`
                span.torrent_icon_container {
                    display: flex !important;
                }
            `);

            for(let i = 0; i < torrents.length; i++) {
                let gcdCommentElement = torrents[i].querySelector("td > div > a.comment");
                let clmCommentElement = torrents[i].querySelector("td:nth-child(4)");

                if(gcdCommentElement) {
                    clmCommentElement.innerHTML = "";
                    clmCommentElement.appendChild(gcdCommentElement);
                }
                
            }
        }
    }, nseTimeout);
}

let nseEnableApril1stOption = false;
if(nseBlacklistTags.includes("hehehehehe")) {
    nseEnableApril1stOption = true;
}

// Get storage size
window.setTimeout(function() {
    let bytesUsed = exportSettings(true);

    if(bytesUsed < 1024) {
        document.getElementById("nseDataUsage").innerHTML = bytesUsed + " bytes";
    } else {
        document.getElementById("nseDataUsage").innerHTML = Math.round((bytesUsed / 1024) * 100) / 100 + " KiB";
    }
}, nseTimeout);


// Check if we've just updated
if(nseUpdateToastsEnabled) {
    if(nseVersionNum > nseSavedVersion) {
        GM_setValue("nseSavedVersion", nseVersionNum); // Update saved version so toast is only shown once

        let updateToast = document.createElement("div");
        updateToast.innerHTML = `
            <div id="nseUpdateToast">  
                <div class="nseUpdateToastDiv">
                    <big>Hooray! NoShitEmpornium was just updated to <b>v${GM_info.script.version}</b>!</big>
                </div>

                <div class="nseUpdateToastDiv">
                    <span class="nseNiceButton" id="nseSeeWhatsNewButton">
                        <span class="nseEmoji">📋</span> See what's new!
                    </span>
                    
                    <span class="nseNiceButton" id="nseCloseUpdateToastButton">
                        <span class="nseEmoji">❌</span> Close
                    </span>
                    
                    <span class="nseNiceButton" id="nseNeverShowUpdateToastButton">
                        <span class="nseEmoji">🚫</span> Don't show again
                    </span>
                </div>
            </div>
        `;

        let reference = document.querySelector("body > :last-child");
        reference.after(updateToast);

        document.getElementById("nseSeeWhatsNewButton").onclick = function() {
            window.open("https://github.com/ceodoe/noshitempornium/blob/master/CHANGELOG.md#latest-changes",'_blank');
            this.parentNode.parentNode.remove();
        };

        document.getElementById("nseCloseUpdateToastButton").onclick = function() {
            this.parentNode.parentNode.remove();
        };

        document.getElementById("nseNeverShowUpdateToastButton").onclick = function() {
            document.getElementById("nseCheckUpdateToasts").checked = false;
            saveData();
            this.parentNode.parentNode.remove();
        };
    }
}

// +--------------+
// | HTML section |
// +--------------+

// Set up reference node
let referenceNode = document.querySelector("div#filter_slidetoggle"); // Torrents

if(currentPage == "Top 10" || currentPage == "Notification filters") {
    referenceNode = document.querySelector("div.linkbox");
} else if(currentPage == "Notifications") {
    referenceNode = document.querySelector("#content > div > h2");
} else if(currentPage == "Torrent details") {
    referenceNode = document.querySelector(".linkbox");
} else if(currentPage == "Collage") {
    referenceNode = document.querySelector("div.thin > div.clear:nth-child(6)");
} else if(currentPage == "Uploaded" || currentPage == "My uploaded") {
    referenceNode = document.querySelector(".submit");
} else if(currentPage == "Requests") {
    referenceNode = document.querySelector("#search_form");
}

// Die if we can't get a reference node, most likely the site is borked or changed its code
if(!referenceNode) {
    referenceNode = document.querySelector("#search_form,.linkbox,#content h2");
    if (!referenceNode) { app.report("Filtering controls could not find a page anchor."); return; }
}

let htmlContent = document.createElement("div");
htmlContent.innerHTML = `
<div id="nseOuter" class="nseOuterDiv">
    <div id="nseHeader">
        <span id="nseHeaderText">NoShitEmpornium</span>
        <span id="nseToggleOptionsNode" class="nseNiceButton">Options</span><span id="nseDynamicRefreshNode" class="nseNiceButton hidden" title="Reload the page to apply your changes" onclick="javascript:location.reload();">🗘</span>
    </div>
    <div id="nseMainDiv" class="nseMainBox hidden">
        <input class="nseRadioButton" id="nseTab1" type="radio" name="tabs" checked>
        <label class="nseLabel" for="nseTab1"><span class="nseEmoji">🏷️</span> Tags</label>

        <input class="nseRadioButton" id="nseTab2" type="radio" name="tabs">
        <label class="nseLabel" for="nseTab2"><span class="nseEmoji">📚</span> Titles</label>

        <input class="nseRadioButton" id="nseTab3" type="radio" name="tabs">
        <label class="nseLabel" for="nseTab3"><span class="nseEmoji">👥</span> Uploaders</label>

        <input class="nseRadioButton" id="nseTab4" type="radio" name="tabs">
        <label class="nseLabel" for="nseTab4"><span class="nseEmoji">⚙️</span> Settings</label>

        <section id="nseContent1">
            <div class="nseFieldDiv">
                <span class="nseImageButton nseListHeader" id="nseTagBlacklistHeader"><span class="nseEmoji">👎</span> Tag blacklist <small>(space-separated)</small></span><sup class="nseExplanationToggler" id="nseBLEToggler">[?]</sup><br />
                <div id="nseBLE" class="nseExplanationBox hidden">
                    <div class="nseExplanationNode">
                        <b>TL;DR</b>: <i>If any of these tags exist, hide the torrent</i>
                    </div>

                    <div class="nseExplanationNode">
                        This is where you specify tags you don't want to see. Any torrent matching
                        any of these tags will be hidden unless overridden by any of the whitelist
                        rules. The correct format for this field is the same used for tags on
                        Empornium itself: Tags are separated by spaces, and uses a period between
                        words within a tag. Character case does not matter. Blacklisted tags will be
                        <span class="nseHiddenTag">highlighted</span> when viewing
                        hidden torrents.
                    </div>

                    <div class="nseExplanationNode">
                        Example:<br />
                        <pre>scat piss.drinking jerk.off.instruction non.nude</pre>
                    </div>
                </div>
                <textarea class="nseTextArea" id="nseBlacklistTaglistArea" rows=10>${escapeHTML(nseBlacklistTaglist)}</textarea>
            </div>
            <div class="nseFieldDiv${nseHardPassEnabled ? '' : ' hidden'}">
                <span class="nseImageButton nseListHeader" id="nseTagHardPassHeader"><span class="nseEmoji">🚫</span> Hard Pass tag blacklist <small>(space-separated)</small></span><sup class="nseExplanationToggler" id="nseHPEToggler">[?]</sup><br />
                <div id="nseHPE" class="nseExplanationBox hidden">
                    <div class="nseExplanationNode">
                        <b>TL;DR</b>: <i>If any of these tags exist, hide the torrent <b>no matter what</b></i>
                    </div>

                    <div class="nseExplanationNode">
                        This is where you specify tags you don't want to see at all. Any torrent
                        matching any of these tags will be hidden unless overridden by individual
                        filtering (clicking the eye icon). The correct format for this field is the
                        same used for tags on Empornium itself: Tags are separated by spaces, and
                        uses a period between words within a tag. Character case does not matter.
                        Hard Pass tags will be <span class="nseHardPassTag">highlighted</span> when viewing hidden torrents. The torrent will be removed completely from the results if the Black Hole
                        option is enabled.
                    </div>

                    <div class="nseExplanationNode">
                        Example:<br />
                        <pre>virtual.reality scat puke blood enema</pre>
                    </div>
                </div>
                <textarea class="nseTextArea" id="nseHardPassTaglistArea" rows=10>${escapeHTML(nseHardPassTaglist)}</textarea>
            </div>
            <div class="nseFieldDiv">
                <span class="nseImageButton nseListHeader" id="nseTagWhitelistHeader"><span class="nseEmoji">👍</span> Tag whitelist <small>(space-separated)</small></span><sup class="nseExplanationToggler" id="nseWLEToggler">[?]</sup><br />
                <div id="nseWLE" class="nseExplanationBox hidden">
                    <div class="nseExplanationNode">
                        <b>TL;DR</b>: <i>If any of these tags exist, ignore all other rules and show the torrent</i>
                    </div>

                    <div class="nseExplanationNode">
                        This is where you specify tags you want to show regardless of all other
                        rules. In other words, no matter if the torrent matches on tags, title or
                        uploader blacklists &mdash; if it contains any of these whitelisted tags, it
                        will be shown regardless. The correct format for this field is the same used
                        for tags on Empornium itself: Tags are separated by spaces, and uses a
                        period between words within a tag. Character case does not matter.
                        Whitelisted tags will be <span class="nseWhitelistedTag">highlighted</span>.
                    </div>

                    <div class="nseExplanationNode">
                        Example:<br />
                        <pre>sasha.grey huge.ass gianna.michaels femdom</pre>
                    </div>
                </div>
                <textarea class="nseTextArea" id="nseWhitelistTaglistArea" rows=10>${escapeHTML(nseWhitelistTaglist)}</textarea>
            </div>
        </section>

        <section id="nseContent2">
            <div class="nseFieldDiv">
                <span class="nseImageButton nseListHeader" id="nseTitleBlacklistHeader"><span class="nseEmoji">👎</span> Title blacklist <small>(semicolon-separated)</small></span><sup class="nseExplanationToggler" id="nseTitleBLEToggler">[?]</sup><br />
                <div id="nseTitleBLE" class="nseExplanationBox hidden">
                    <div class="nseExplanationNode">
                        <b>TL;DR</b>: <i>If any of these phrases are in the title, hide the torrent</i>
                    </div>

                    <div class="nseExplanationNode">
                        This is where you specify title phrases you want to filter on. This is
                        useful for hiding untagged content with a recurring theme (for example
                        specific JAV series you don't care about, or re-encoded content).
                        Character case does not matter. <b>Title phrases are separated by
                        semicolons <span class="nseMonospace">;</span> &mdash; not spaces, unlike
                        tags or uploaders!</b>
                    </div>

                    <div class="nseExplanationNode">
                        Example:<br />
                        <pre>sdmm;hikr;princess peach;reencode</pre>
                    </div>
                </div>
                <textarea class="nseTextArea" id="nseBlacklistTitleListArea" rows=10>${escapeHTML(nseBlacklistTitleList)}</textarea>
            </div>
            <div class="nseFieldDiv${nseHardPassEnabled ? '' : ' hidden'}">
                <span class="nseImageButton nseListHeader" id="nseTitleHardPassHeader"><span class="nseEmoji">🚫</span> Hard Pass title blacklist <small>(semicolon-separated)</small></span><sup class="nseExplanationToggler" id="nseHPTEToggler">[?]</sup><br />
                <div id="nseHPTE" class="nseExplanationBox hidden">
                    <div class="nseExplanationNode">
                        <b>TL;DR</b>: <i>If any of these phrases exist in the title, hide the torrent <b>no matter what</b></i>
                    </div>

                    <div class="nseExplanationNode">
                        This is where you specify title phrases you don't want to see at all. Any torrent
                        matching any of these phrases in the title will be hidden unless overridden by individual filtering (clicking the eye icon). Character case does not matter. <b>Title phrases are separated by semicolons <span class="nseMonospace">;</span> &mdash; not spaces like tags or uploaders!</b> Hard Pass title phrases will be <span class="nseHardPassTag">highlighted</span> when viewing hidden torrents. The torrent will be removed completely from the results if the Black Hole
                        option is enabled.
                    </div>

                    <div class="nseExplanationNode">
                        Example:<br />
                        <pre>sdmm;hikr;princess peach;reencode</pre>
                    </div>
                </div>
                <textarea class="nseTextArea" id="nseHardPassTitleListArea" rows=10>${escapeHTML(nseHardPassTitleList)}</textarea>
            </div>
            <div class="nseFieldDiv">
                <span class="nseImageButton nseListHeader" id="nseTitleWhitelistHeader"><span class="nseEmoji">👍</span> Title whitelist <small>(semicolon-separated)</small></span><sup class="nseExplanationToggler" id="nseTitleWLEToggler">[?]</sup><br />
                <div id="nseTitleWLE" class="nseExplanationBox hidden">
                    <div class="nseExplanationNode">
                        <b>TL;DR</b>: <i>If any of these phrases are in the title, ignore all other rules and show the torrent</i>
                    </div>

                    <div class="nseExplanationNode">This is where you specify title phrases you want to show regardless of other rules. Character case does not matter. <b>Title phrases are separated by semicolons <span class="nseMonospace">;</span> &mdash; not spaces like tags or uploaders!</b>
                    </div>

                    <div class="nseExplanationNode">Example:<br /><pre>minipack;super mario;sdmm;moist</pre></div>
                </div>
                <textarea class="nseTextArea" id="nseWhitelistTitleListArea" rows=10>${escapeHTML(nseWhitelistTitleList)}</textarea>
            </div>
        </section>

        <section id="nseContent3">
            <div class="nseFieldDiv">
                <span class="nseImageButton nseListHeader" id="nseUploaderBlacklistHeader"><span class="nseEmoji">👎</span> Uploader blacklist <small>(space-separated)</small></span><sup class="nseExplanationToggler" id="nseUBLEToggler">[?]</sup><br />
                <div id="nseUBLE" class="nseExplanationBox hidden">
                    <div class="nseExplanationNode">
                        <b>TL;DR</b>: <i>If this torrent is uploaded by any of these users, hide it</i>
                    </div>

                    <div class="nseExplanationNode">
                        This is where you specify the names of uploaders you want to hide all
                        uploads from, unless overriden by a whitelist rule. Uploader names will be
                        <span class="nseHiddenUploader">highlighted</span> when viewing
                        hidden torrents. Character case does not matter. Note that filtering based
                        on usernames will not function on collage or user upload pages, as torrent 
                        uploaders are not exposed on those pages.
                    </div>

                    <div class="nseExplanationNode">
                        Example:<br />
                        <pre>SuperUploader2007 LowQualityUploadsIncorporated</pre>
                    </div>
                </div>
                <textarea class="nseTextArea" id="nseBlacklistUploadersArea" rows=10>${escapeHTML(nseBlacklistUploadersList)}</textarea>
            </div>
            <div class="nseFieldDiv">
                <span class="nseImageButton nseListHeader" id="nseUploaderWhitelistHeader"><span class="nseEmoji">👍</span> Uploader whitelist <small>(space-separated)</small></span><sup class="nseExplanationToggler" id="nseUWLEToggler">[?]</sup><br />
                <div id="nseUWLE" class="nseExplanationBox hidden">
                    <div class="nseExplanationNode">
                        <b>TL;DR</b>: <i>If this torrent is uploaded by any of these users, show it regardless of any other rules</i>
                    </div>

                    <div class="nseExplanationNode">
                        This is where you specify the names of uploaders you want to show all
                        uploads from, regardless of any blacklist rules. Uploader names will be
                        <span class="nseWhitelistedUploader">highlighted</span>. Character
                        case does not matter. Note that filtering based on usernames will not
                        function on collage or user upload pages, as torrent uploaders are not 
                        exposed on those pages.
                    </div>

                    <div class="nseExplanationNode">
                        Example:<br />
                        <pre>NobelPrizeWinningUploads ActuallyGreatUploader69 ceodoe</pre>
                    </div>
                </div>
                <textarea class="nseTextArea" id="nseWhitelistUploadersArea" rows=10>${escapeHTML(nseWhitelistUploadersList)}</textarea>
            </div>
        </section>

        <section id="nseContent4">
            <input class="nseRadioButton" id="nseSettingsTab1" type="radio" name="settingsTabs" checked>
            <label class="nseLabel" for="nseSettingsTab1"><span class="nseEmoji">🔍</span> Filtering</label>

            <input class="nseRadioButton" id="nseSettingsTab2" type="radio" name="settingsTabs">
            <label class="nseLabel" for="nseSettingsTab2"><span class="nseEmoji">🖥️</span> Interface</label>

            <input class="nseRadioButton" id="nseSettingsTab3" type="radio" name="settingsTabs">
            <label class="nseLabel" for="nseSettingsTab3"><span class="nseEmoji">🗃️</span> Data management</label>

            <input class="nseRadioButton" id="nseSettingsTab4" type="radio" name="settingsTabs">
            <label class="nseLabel" for="nseSettingsTab4"><span class="nseEmoji">ℹ️</span> About</label>

            <section id="nseSettingsContent1">
                <h3 class="nseH3">Filtering</h3>
                <b>Individual uploads</b><br />
                <input type="checkbox" id="nseCheckIndividualHide"${nseIndividualUploadHidingEnabled ? ' checked' : ''} />
                <label for="nseCheckIndividualHide" class="nseSettingsCheckbox">
                    <span class="nseEmoji">👁️</span> Enable individual upload filtering
                </label><br />
                <span class="nseExplanationSpan nseESOffset">(Click the eye icon next to the torrent name to blacklist/whitelist uploads</span><br />
                <span class="nseExplanationSpan nseESOffset">individually, ignoring <b>all</b> other rules. These filters are automatically saved)</span><br /><br />

                <input type="checkbox" id="nseCheckFilterAllButtonEnabled"${nseFilterAllButtonEnabled ? ' checked' : ''} />
                <label for="nseCheckFilterAllButtonEnabled" class="nseSettingsCheckbox">
                    <span class="nseEmoji">👁️</span> Enable "Filter all unfiltered results" button
                </label><br />
                <span class="nseExplanationSpan nseESOffset">(Requires individual upload filtering to be enabled to function)</span>
                <br /><br />


                <b>List management</b><br />
                <input type="checkbox" id="nseCheckRightClickManagementEnabled"${nseRightClickManagementEnabled ? ' checked' : ''} />
                <label for="nseCheckRightClickManagementEnabled" class="nseSettingsCheckbox">
                    <span class="nseEmoji">🖱️</span> Enable Right-Click Management (RCM)
                </label>
                                
                <div id="nseRCMCustomizationDiv" ${nseRightClickManagementEnabled ? '' : 'class="hidden"'}>
                    <span class="nseESOffset">
                        <input type="checkbox" id="nseCheckRCMTagsEnabled"${nseRCMTagsEnabled ? ' checked' : ''} />
                        <label for="nseCheckRCMTagsEnabled" class="nseSettingsCheckbox">
                            <span class="nseEmoji">🏷️</span> Enable for tags
                        </label><br />
                    </span>
                        
                    <span class="nseESOffset">
                        <input type="checkbox" id="nseCheckRCMTitlesEnabled"${nseRCMTitlesEnabled ? ' checked' : ''} />
                        <label for="nseCheckRCMTitlesEnabled" class="nseSettingsCheckbox">
                            <span class="nseEmoji">📚</span> Enable for titles
                        </label><br />
                    </span>
                    
                    <span class="nseESOffset">
                        <input type="checkbox" id="nseCheckRCMUploadersEnabled"${nseRCMUploadersEnabled ? ' checked' : ''} />
                        <label for="nseCheckRCMUploadersEnabled" class="nseSettingsCheckbox">
                            <span class="nseEmoji">👥</span> Enable for uploaders
                        </label>
                    </span>
                </div><br />

                <span class="nseExplanationSpan">Right-click a tag/title/uploader in the torrent list to add/remove from your lists.</span><br /><br />
                
                <b>Torrent site status</b><br />
                <input type="checkbox" id="nseCheckHideAnonUploads"${nseHideAnonUploadsEnabled ? ' checked' : ''} />
                <label for="nseCheckHideAnonUploads" class="nseSettingsCheckbox">
                    <span class="nseEmoji">👤</span> Hide all anonymous uploads
                </label>
                <span class="nseExplanationSpan">(Will still be overridden by whitelist rules)</span><br />

                <input type="checkbox" id="nseCheckHideReported"${nseHideReportedEnabled ? ' checked' : ''} />
                <label for="nseCheckHideReported" class="nseSettingsCheckbox">
                    <span class="nseEmoji">⛔</span> Hide reported uploads
                </label>
                <span class="nseExplanationSpan">(Hide torrents with active reports, whitelists will override)</span><br />

                <input type="checkbox" id="nseCheckHideWarned"${nseHideWarnedEnabled ? ' checked' : ''} />
                <label for="nseCheckHideWarned" class="nseSettingsCheckbox">
                    <span class="nseEmoji">⚔️</span> Hide warned uploads
                </label>
                <span class="nseExplanationSpan">(Hide torrents with active warning, whitelists will override)</span><br />

                <input type="checkbox" id="nseCheckHideUnseeded"${nseHideUnseededEnabled ? ' checked' : ''} />
                <label for="nseCheckHideUnseeded" class="nseSettingsCheckbox">
                    <span class="nseEmoji">🏜️</span> Hide unseeded uploads
                </label>
                <span class="nseExplanationSpan">(Hide torrents with zero seeders, whitelists will override)</span><br /><br />

                <b>Torrent personal status</b><br />
                <input type="checkbox" id="nseCheckHideGrabbed"${nseHideGrabbedEnabled ? ' checked' : ''} />
                <label for="nseCheckHideGrabbed" class="nseSettingsCheckbox">
                    <span class="nseEmoji">💾</span> Hide grabbed uploads
                </label>
                <span class="nseExplanationSpan">(Hide torrents you have previously grabbed)</span><br />

                <input type="checkbox" id="nseCheckHideLeeching"${nseHideLeechingEnabled ? ' checked' : ''} />
                <label for="nseCheckHideLeeching" class="nseSettingsCheckbox">
                    <span class="nseEmoji">⏬</span> Hide leeching uploads
                </label>
                <span class="nseExplanationSpan">(Hide torrents you are currently leeching)</span><br />

                <input type="checkbox" id="nseCheckHideSeeding"${nseHideSeedingEnabled ? ' checked' : ''} />
                <label for="nseCheckHideSeeding" class="nseSettingsCheckbox">
                    <span class="nseEmoji">⏫</span> Hide seeding uploads
                </label>
                <span class="nseExplanationSpan">(Hide torrents you are currently seeding)</span><br />

                <input type="checkbox" id="nseCheckHideSnatched"${nseHideSnatchedEnabled ? ' checked' : ''} />
                <label for="nseCheckHideSnatched" class="nseSettingsCheckbox">
                    <span class="nseEmoji">💽</span> Hide snatched uploads
                </label>
                <span class="nseExplanationSpan">(Hide torrents you have already downloaded/snatched)</span><br />

                <input type="checkbox" id="nseCheckHideBookmarked"${nseHideBookmarkedEnabled ? ' checked' : ''} />
                <label for="nseCheckHideBookmarked" class="nseSettingsCheckbox">
                    <span class="nseEmoji">⭐</span> Hide bookmarked uploads
                </label>
                <span class="nseExplanationSpan">(Hide torrents you have previously bookmarked)</span><br /><br />

                <input type="checkbox" id="nseCheckBypassWhitelists"${nseBypassWhitelistsEnabled ? ' checked' : ''} />
                <label for="nseCheckBypassWhitelists" class="nseSettingsCheckbox">
                    <span class="nseEmoji">💫</span> Bypass whitelists for personal status filtering
                </label><br />
                <span class="nseExplanationSpan nseESOffset">(Ignore all whitelists when filtering grabbed/leeching/seeding/snatched torrents)</span><br /><br />

                <b>Hard Pass</b><br />
                <input type="checkbox" id="nseCheckHardPassEnabled"${nseHardPassEnabled ? ' checked' : ''} />
                <label for="nseCheckHardPassEnabled" class="nseSettingsCheckbox">
                    <span class="nseEmoji">🚫</span> Hard Pass
                </label><span class="nseExplanationSpan">(Enable the Hard Pass blacklists, found in the "Tags" and "Titles" tabs)</span><br />
                <input type="checkbox" id="nseCheckRemoveHardPassResults"${nseRemoveHardPassResults ? ' checked' : ''} />
                <label for="nseCheckRemoveHardPassResults" class="nseSettingsCheckbox">
                    <span class="nseEmoji">⚫</span> Black Hole
                </label><span class="nseExplanationSpan">(Remove results instead of hiding them behind the toggle)</span><br /><br />
                <span class="nseExplanationSpan">Hard Pass enables extra blacklists that will make sure that torrents with the given tags or title phrases will be hidden no matter what. The only thing that can override Hard Pass is whitelisting a torrent through individual filtering when Black Hole is disabled. Enable the Black Hole option to remove results from the page entirely.</span><br /><br />
            </section>

            <section id="nseSettingsContent2">
                <h3 class="nseH3">Interface</h3>

                <div>
                    <input type="checkbox" id="nseCheckObliviousMode"${nseObliviousModeEnabled ? ' checked' : ''} />
                    <label for="nseCheckObliviousMode" class="nseSettingsCheckbox">
                        <span class="nseEmoji">❓</span> Oblivious
                    </label>
                    <span class="nseExplanationSpan">(Hide torrent tag lists)</span><br />

                    <input type="checkbox" id="nseCheckCustomCSS"${nseCustomCSSEnabled ? ' checked' : ''} />
                    <label for="nseCheckCustomCSS" class="nseSettingsCheckbox">
                        <span class="nseEmoji">📜</span> Custom CSS
                    </label>
                    <span class="nseExplanationSpan">(Define your own CSS rules)</span><br />
                    <div id="nseCustomCSSDiv" ${nseCustomCSSEnabled ? '' : 'class="hidden"'}>
                        Define your custom CSS below. Note that this code is injected at the very end of the built-in CSS, so use the !important tag liberally to overwrite existing rules. Do not escape backslashes, it will be done automatically. Avoid using backticks. <br />
                        <textarea class="nseTextArea" id="nseCustomCSSArea" rows=10>${escapeHTML(nseCustomCSS.replace(/\\\\/gi,"\\"))}</textarea>
                    </div>

                    <input type="checkbox" id="nseCheckScrollToNSEEnabled"${nseScrollToNSEEnabled ? ' checked' : ''} />
                    <label for="nseCheckScrollToNSEEnabled" class="nseSettingsCheckbox">
                        <span class="nseEmoji">⚓</span> Automatically scroll to NSE on page load
                    </label>
                    <span class="nseExplanationSpan">(Makes browsing several pages easier)</span><br />

                    <input type="checkbox" id="nseCheckEmojiEnabled"${nseEmojiEnabled ? ' checked' : ''} />
                    <label for="nseCheckEmojiEnabled" class="nseSettingsCheckbox">
                        <span class="nseEmoji">🖼️</span> Enable extended Unicode icons ("emoji")
                    </label>
                    <span class="nseExplanationSpan">(Disable if you see garbled characters)</span><br />
                    
                    <input type="checkbox" id="nseCheckUpdateToasts"${nseUpdateToastsEnabled ? ' checked' : ''} />
                    <label for="nseCheckUpdateToasts" class="nseSettingsCheckbox">
                        <span class="nseEmoji">❗</span> Notify me when NSE is updated
                    </label>
                    <span class="nseExplanationSpan">(Get changelog info on update)</span><br />

                    <input type="checkbox" id="nseCheckFloatingToggleButton"${nseFloatingToggleButtonEnabled ? ' checked' : ''} />
                    <label for="nseCheckFloatingToggleButton" class="nseSettingsCheckbox">
                        <span class="nseEmoji">🛟</span> Enable the floating toggle button on the bottom right of the page
                    </label><br />

                    <input type="checkbox" id="nseCheckOpenAllButton"${nseOpenAllButtonEnabled ? ' checked' : ''} />
                    <label for="nseCheckOpenAllButton" class="nseSettingsCheckbox">
                        <span class="nseEmoji">📂</span> Enable the "Open all unfiltered results" button
                    </label><br />
                    <span class="nseExplanationSpan nseESOffset">(Appears under the NSE options area. If your browser tells you it blocked Emp</span><br />
                    <span class="nseExplanationSpan nseESOffset">from opening popups, click the Preferences button and allow popups for Emp)</span><br />
                    
                    <input type="checkbox" id="nseCheckOpenAllGoNext"${nseOpenAllGoNextEnabled ? ' checked' : ''} />
                    <label for="nseCheckOpenAllGoNext" class="nseSettingsCheckbox">
                        <span class="nseEmoji">➡️</span> Automatically go to next results page after clicking "Open all" button
                    </label><br /><br />

                    <br />

                    User interface font family: <br />
                    <input type="text" class="nseInput" value="${escapeHTML(nseUIFont)}" id="nseUIFont" /> <span class="nseExplanationSpan">(Corresponds to the <a class="nseLink" href="https://developer.mozilla.org/en-US/docs/Web/CSS/font-family" target="_blank"><b><u>CSS font-family property</u></b></a>)</span>
                    <br /><br />

                    Filter list font family: <br />
                    <input type="text" class="nseInput" value="${escapeHTML(nseTextAreaFont)}" id="nseTextAreaFont" /> <span class="nseExplanationSpan">(Font for black/whitelists textareas)</span>
                    <br /><br />

                    
                    Highlight color for blacklisted elements: <br />
                    <input type="text" class="nseInput" value="${escapeHTML(nseBlacklistColor)}" id="nseBlacklistColor" /> <span class="nseExplanationSpan">(You can use any <a class="nseLink" href="https://developer.mozilla.org/en-US/docs/Web/CSS/color_value" target="_blank"><b><u>CSS color notation</u></b></a> here)</span>
                    <br /><br />
                    
                    Highlight color for Hard Pass tags: <br />
                    <input type="text" class="nseInput" value="${escapeHTML(nseHardPassColor)}" id="nseHardPassColor" />
                    <br /><br />
                    
                    Highlight color for whitelisted elements: <br />
                    <input type="text" class="nseInput" value="${escapeHTML(nseWhitelistColor)}" id="nseWhitelistColor" />
                    <br /><br />

                    Timeout for timed functions (milliseconds): <br />
                    <input type="text" class="nseInput" style="width: 50px;" value="${nseTimeout}" id="nseTimeout" /> <span class="nseExplanationSpan">(Used for GCD support and computing storage size)</span>
                    <br /><br />


                    Theme:<br />
                    <select name="nseThemeDropdown" id="nseThemeDropdown" class="nseInput">
                        <option value="nseThemeDefault" ${nseSelectedTheme=="nseThemeDefault" ? "selected='selected'" : ''}>Default</option>
                        <option value="nseThemeLegacy" ${nseSelectedTheme=="nseThemeLegacy" ? "selected='selected'" : ''}>Legacy</option>
                        <option value="nseThemeEdgy" ${nseSelectedTheme=="nseThemeEdgy" ? "selected='selected'" : ''}>Edgy</option>
                        <option value="nseThemeBaked" ${nseSelectedTheme=="nseThemeBaked" ? "selected='selected'" : ''}>Baked</option>
                        <option value="nseThemeDarkPurple" ${nseSelectedTheme=="nseThemeDarkPurple" ? "selected='selected'" : ''}>Dark Purple</option>
                        <option value="nseThemeCustom" ${nseSelectedTheme=="nseThemeCustom" ? "selected='selected'" : ''}>Custom</option>
                    </select>
                    <span id="nseThemeDescription" class="nseExplanationSpan">${nseThemeDescriptions[nseSelectedTheme]}</span>

                    <div id="nseCustomThemeDiv" ${nseSelectedTheme=="nseThemeCustom" ? '' : 'class="hidden"'}>
                        <p>
                            You can use any <a class="nseLink" href="https://developer.mozilla.org/en-US/docs/Web/CSS/color_value" target="_blank">CSS color notation</a> here.<br />
                            Examples: <span class="nseMonospace">#ffffff &mdash; rgb(0,0,255) &mdash; aquamarine</span>
                        </p>
                        <p>
                            Background color:<br />
                            <input type="text" class="nseInput" id="nseCustomThemeBgCol" value='${escapeHTML(nseCustomTheme.backgroundColor)}' />
                        </p>
                        <p>
                            Background highlight color:<br />
                            <input type="text" class="nseInput" id="nseCustomThemeBgHighCol" value='${escapeHTML(nseCustomTheme.backgroundHighlightColor)}' />
                        </p>
                        <p>
                            Foreground color:<br />
                            <input type="text" class="nseInput" id="nseCustomThemeForeCol" value='${escapeHTML(nseCustomTheme.foregroundColor)}' />
                        </p>
                        <p>
                            Accent color:<br />
                            <input type="text" class="nseInput" id="nseCustomThemeAccentCol" value='${escapeHTML(nseCustomTheme.accentColor)}' />
                        </p>
                        <p>
                            Highlight color:<br />
                            <input type="text" class="nseInput" id="nseCustomThemeHighCol" value='${escapeHTML(nseCustomTheme.highlightColor)}' />
                        </p>
                        <p>
                            Hidden torrent background color:<br />
                            <input type="text" class="nseInput" id="nseCustomThemeHiddenBgCol" value='${escapeHTML(nseCustomTheme.hiddenBackgroundColor)}' />
                        </p>

                        <p>Remember to click the [Save] button to save your changes!</p>
                    </div>
                </div>

                <div class="nseTopAiryDiv">
                    <b>Extras</b><br />
                    <input type="checkbox" id="nseCheckRenumberTorrents"${nseRenumberTorrentsEnabled ? ' checked' : ''} />
                    <label for="nseCheckRenumberTorrents" class="nseSettingsCheckbox">
                        <span class="nseEmoji">🔢</span> Renumber torrents on "Top X" pages
                    </label>
                    <span class="nseExplanationSpan">(Fixes torrent numbering after filtering)</span><br />
                    
                    <input type="checkbox" id="nseCheckHideCategoryIcons"${nseHideCategoryIconsEnabled ? ' checked' : ''} />
                    <label for="nseCheckHideCategoryIcons" class="nseSettingsCheckbox">
                        <span class="nseEmoji">🟪</span> Hide category icons
                    </label>
                    <span class="nseExplanationSpan">(Hides category icons/links in torrent lists)</span><br />
                    
                    <input type="checkbox" id="nseCheckArrowNavigation"${nseArrowNavigationEnabled ? ' checked' : ''} />
                    <label for="nseCheckArrowNavigation" class="nseSettingsCheckbox">
                        <span class="nseEmoji">⌨️</span> Navigate paginated torrent lists with keyboard arrow keys
                    </label><br />
                    <span class="nseExplanationSpan nseESOffset">(Note that NSE only runs on torrent lists, if you want</span><br />
                    <span class="nseExplanationSpan nseESOffset">arrow key navigation globally on Empornium, use <a class="nseLink" href="https://github.com/ceodoe/noshitempornium/raw/master/GlobalArrowKeyNavigation.user.js" target="_blank"><b><u>this script</u></b></a>)</span>
                </div>

                <div class="nseTopAiryDiv nseBtmAiryDiv">
                    <b>"Fun"</b><br />
                    <input type="checkbox" id="nseCheckRussianRouletteMode"${nseRussianRouletteEnabled ? ' checked' : ''} />
                    <label for="nseCheckRussianRouletteMode" class="nseSettingsCheckbox">
                        <span class="nseEmoji">🎲</span> Russian Roulette
                    </label>
                    <span class="nseExplanationSpan">(Randomly and silently show filtered torrents)</span><br />

                    ${nseEnableApril1stOption ? `<input type="checkbox" id="nseCheckApril1stAllYear"${nseEveryDayIsApril1st ? ' checked' : ''} />
                    <label for="nseCheckApril1stAllYear" class="nseSettingsCheckbox">
                        <span class="nseEmoji">🤪</span> Every day is April 1st
                    </label>
                    <span class="nseExplanationSpan">(For the masochists among us)</span>` : ''}
                </div>
            </section>

            <section id="nseSettingsContent3">
                <h3 class="nseH3">Data management</h3>
                <p>
                    <span class="nseExplanationSpan">Use these functions to import, export or reset all your NSE lists and settings.</span><br /><br />

                    NSE is currently using <span id="nseDataUsage"></span> of data in your LocalStorage.

                    <div class="nseNiceBox"><span class="nseEmoji">⤵️</span> Import NSE data<br />
                        <input type="file" accept=".json,text/plain" id="nseImportFilePicker" class="nseInput">
                    </div><br />
                    <span class="nseNiceButton" id="nseExportButton"><span class="nseEmoji">⤴️</span> Export NSE data</span> 
                    <span class="nseNiceButton" id="nseEraseDataButton"><span class="nseEmoji">🔄</span> Reset NSE data</span><br /><br />
                    
                    <span class="nseExplanationSpan"><b>IMPORTANT: Data overwritten or reset by the functions above is <i>not</i> recoverable!</b></span>
                </p>
            </section>

            <section id="nseSettingsContent4">
                <h3 class="nseH3">About</h3>
                <p>
                    Copyright &copy; 2015-2026 ceodoe. NoShitEmpornium v${GM_info.script.version} was made with ${nseEmojiEnabled ? '💕' : 'love'} by <a class="nseLink" href="/user.php?id=508194">ceodoe</a> of Empornium, and its code is licensed under the <a class="nseLink" href="https://www.gnu.org/licenses/gpl-3.0.txt" target="_blank">GNU General Public License v3.0</a>.
                </p>

                <h3 class="nseH3">Statistics</h3>
                <p>
                    <span class="nseExplanationSpan">This section is populated when the page loads, and does not reflect changes done thereafter.</span><br />
                    <br />
                    Number of blacklisted tags: <span class="nseHiddenTag">${nseBlacklistTags.length}</span><br />
                    ${nseHardPassEnabled ? `Number of Hard Pass tags: <span class="nseHiddenTag">${nseHardPassTags.length}</span><br />` : ""}
                    Number of blacklisted title phrases: <span class="nseHiddenTag">${nseBlacklistTitlePhrases.length}</span><br />
                    Number of blacklisted uploaders: <span class="nseHiddenTag">${nseBlacklistUploaders.length}</span><br />
                    ${nseIndividualUploadHidingEnabled ? `Number of individually blacklisted torrents: <span class="nseHiddenTag">${nseIndividualUploadHidingBlacklist.length}</span><br />` : ""}
                    <br />
                    Number of whitelisted tags: <span class="nseWhitelistedTag">${nseWhitelistTags.length}</span><br />
                    Number of whitelisted title phrases: <span class="nseWhitelistedTag">${nseWhitelistTitlePhrases.length}</span><br />
                    Number of whitelisted uploaders: <span class="nseWhitelistedTag">${nseWhitelistUploaders.length}</span><br />
                    ${nseIndividualUploadHidingEnabled ? `Number of individually whitelisted torrents: <span class="nseWhitelistedTag">${nseIndividualUploadHidingWhitelist.length}</span><br />` : ""}
                </p>

                <h3 class="nseH3">Resources</h3>
                <p>
                    <b>
                        <span class="nseEmoji">🧵</span> <a class="nseLink" href="/forum/thread/44258?postid=956045#post956045" target="_blank">Read the official thread on the Empornium forums</a><br />

                        <span class="nseEmoji">🐙</span> <a class="nseLink" href="https://github.com/ceodoe/noshitempornium" target="_blank">Report a bug or view commit history on GitHub</a><br />
                        
                        <span class="nseEmoji">📋</span> <a class="nseLink" href="https://github.com/ceodoe/noshitempornium/blob/master/CHANGELOG.md#latest-changes" target="_blank">Read the changelog</a><br />
                    </b>
                </p>

                <h3 class="nseH3">Contribute</h3>
                <p>
                    If you love NSE, consider a donation! I've spent a lot of time making this, and any sum is hugely appreciated. Credits on the site is also appreciated.<br /> <br />

                    Bitcoin (BTC): <span class="nseMonospace"><small>15YM9XCe5isbf1T8TBjku1BYmyNTj1ZyX9</small></span><br />
                    Bitcoin Cash (BCH): <span class="nseMonospace"><small>qqcuude6a6q09r0a6ujvvklzm6qjrxtr5vfwkxrk34</small></span><br />
                    Ethereum (ETH): <span class="nseMonospace"><small>0xD66eB1CafE88f299929b4FCedCCac3B3D9d7Bee1</small></span><br />
                    Stellar (XLM): <span class="nseMonospace"><small>GD7KXIYO3FTINLBXIJCBMOXVMO4DCXNSLFJTEAIILZAODEMDQRSOT532</small></span>
                    <br /><br />

                    You can also contribute by reporting bugs, submitting feature requests, pull requests, or just generally using NSE to its fullest. Thanks for using my software!
                </p>

                <p></p>
            </section>
        </section>

        <div class="nseSettingsControlDiv">
            <span id="nseSaveButton" class="nseNiceButton"><span class="nseEmoji">💾</span> Save</span>
            <span id="nseReloadButton" class="nseNiceButton"><span class="nseEmoji">🔃</span> Reload page and apply changes</span> 
            <span id="nseCloseOptionsButton" class="nseNiceButton"><span class="nseEmoji">❌</span> Close options</span>
        </div>

        <div class="nseSettingsControlDiv" id="nseSaveDiv" class="hidden">

        </div>
    </div>
</div>

${!nseUnfilteredPages.includes(currentPage) && (nseOpenAllButtonEnabled || (nseFilterAllButtonEnabled && nseIndividualUploadHidingEnabled)) ? `
    <div class="nseTopAiryDiv nseBtmAiryDiv nseCenterDiv">
    ${nseOpenAllButtonEnabled ? `
        <div style="display: inline;">
            <span class="nseNiceButton" id="nseOpenAllButton">
                <span class="nseEmoji">📂</span>
                Open all unfiltered results
            </span>
        </div>
    ` : ''}

    ${nseFilterAllButtonEnabled && nseIndividualUploadHidingEnabled ? `
        <div style="display: inline;">
            <span class="nseNiceButton" id="nseFilterAllButton">
                <span class="nseEmoji">👁</span>
                Filter all unfiltered results
            </span>
        </div>
    ` : ''}
    </div>
` : ''}


<div id="nseRCMBox" class="hidden">
    <div id="nseRCMClose">${nseEmojiEnabled ? '❌' : '<span class="nseHiddenTag"><b><big>X</big></b></span>'}</div>
    <p id="nseRCMBoxInfoText">Tag/uploader placeholder text</p>
    <p id="nseRCMBoxChoices">

    </p>
    <p><small>Your settings will be automatically saved when you choose one of the above options. Your changes will reflect in the torrent list once the page is <span class="nseSpanLink" onclick="location.reload();"><b>reloaded</b></a>.</small></p>
</div>
`;

htmlContent.hidden = true; htmlContent.classList.add("epc-engine"); referenceNode.after(htmlContent);

// Do this before filtering in case it takes a while to filter the page
if(nseScrollToNSEEnabled) {
    app.root?.scrollIntoView({block:"start"});
}

// Add floating toggle button if enabled
if(nseFloatingToggleButtonEnabled && !nseUnfilteredPages.includes(currentPage)) {
    document.querySelector("body").insertAdjacentHTML("afterbegin", `
        <div id="nseFloatyBoi">
            <span class="nseEmoji" alt="Toggle hidden torrents" title="Toggle hidden torrents">👁️</span>
        </div>
    `);
    document.querySelector("#nseFloatyBoi").addEventListener("click", function() { toggleTorrents(); });
}

// Set up elements for "Notification filters" page
if(currentPage == "Notification filters") {
    let textareas = document.querySelectorAll("textarea.long");

    for(let i = 0; i < textareas.length; i++) {
        let newElement = document.createElement("p");
        newElement.classList.add("min_padding");
        newElement.style.marginTop = "10px";
        
        if(textareas[i].name == "tags") {    
            newElement.innerHTML = `
                <span class="nseNiceButton" id="nseImportListButton${i}">
                    <span class="nseEmoji">⤵️</span>
                    Import your NSE tag whitelist into the above field
                </span>
            `;
        } else if(textareas[i].name == "nottags") {
            newElement.innerHTML = `
                <span class="nseNiceButton" id="nseImportListButton${i}">
                    <span class="nseEmoji">⤵️</span>
                    Import your NSE tag blacklist${nseHardPassEnabled ? " and Hard Pass list" : ""} into the above field
                </span>
            `;
        }

        newElement.onclick = function() {
            let coupledTextarea = this.parentNode.parentNode.querySelector("textarea.long");

            if(coupledTextarea.name == "tags") {
                coupledTextarea.innerHTML = document.getElementById("nseWhitelistTaglistArea").innerHTML;
            } else if(coupledTextarea.name == "nottags") {
                if(nseHardPassEnabled) {
                    coupledTextarea.innerHTML = document.getElementById("nseHardPassTaglistArea").innerHTML + " ";
                } else {
                    coupledTextarea.innerHTML = "";
                }

                coupledTextarea.innerHTML = coupledTextarea.innerHTML + document.getElementById("nseBlacklistTaglistArea").innerHTML;
            }
        };

        textareas[i].parentNode.querySelector("textarea.long + p").appendChild(newElement);
    }
}

// +---------------------+
// | Main filtering loop |
// +---------------------+
let count = 0;
let torrents = document.querySelectorAll("tr.torrent");

if(currentPage == "Requests") {
    torrents = document.querySelectorAll("#request_table tr");
}

let epIconSequence = 0;
function epFilterRows(torrents, appended) {
app.captureFilterBaseline(appended);
const matchConditional = app.resultFilters.conditionalMatcher();
if(torrents) {
    if(!nseUnfilteredPages.includes(currentPage)) { // Skip filtering where it doesn't apply
        for(let i = 0; i < torrents.length; i++) {
            let tagElement = torrents[i].querySelector("td > div.tags");
    
            if(!tagElement) {
                continue; // skip to next iteration if we can't get taglist
            }
    
            let russianRouletteBulletInChamber = false;
            if(nseRussianRouletteEnabled) {
                let randNum = Math.floor(Math.random() * 6) + 1; // 1/6 chance to fire
                if(randNum == 6) {
                    russianRouletteBulletInChamber = true;
                }
            }
    
            let uploaderElement, titleElement;

            if(currentPage == "Top 10") {
                uploaderElement = torrents[i].querySelector("td:nth-child(10) > a");
            } else {
                uploaderElement = torrents[i].querySelector("td.user > a");
            }
    
            if(currentPage == "Collage") {
                titleElement = torrents[i].querySelector("td > strong > a");
            } else {
                titleElement = torrents[i].querySelector("td > a");
            }
    
            const conditional = matchConditional?.(tagElement, titleElement, uploaderElement);
            let hideReason, passReason;
            let countMe = 1;
            let currentHidden = false;
            let currentWhitelisted = false;
            let currentBypassWhitelist = false;
            let currentForceHide = false;
            let currentForceShow = false;
    
            // Check if we are adding the hide button
            if(nseIndividualUploadHidingEnabled) {
                const resultID = titleElement && new URL(titleElement.href, location.href).searchParams.get("id");
                let torrentIconContainer = /^\d{1,15}$/.test(resultID || "") ? torrents[i].querySelector("td > span.torrent_icon_container") : null;
    
                if(torrentIconContainer) {
                    let nseToggleHideElement = document.createElement("span");
                    nseToggleHideElement.className = "icon";
                    nseToggleHideElement.innerHTML = `
                    <div class="icon_container">
                        <div class="icon_stack">
                            <i class="font_icon torrent_icons clickable nseToggleIcon" id="nseToggleIcon_${++epIconSequence}">
                                <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAC6npUWHRSYXcgcHJvZmlsZSB0eXBlIGV4aWYAAHja7ZdtktwoDIb/c4ocAUkIieNgPqpygz1+XrDb0z2T3SS1+2urTdlggSX5fWR6Joy/vs/wDQeVzCGpeS45RxyppMIVA4/nUfaVYtrX84avOXq1h3uCYRL0ct5avdZX2PXjgUcMOl7twa8Z9ssR3Y73ISvyGvfnJGHn007pclTGOcjF7TnV43LUroU7letMd1pnt+7Di8GgUlcEEuYhJHFf/cxAzrMu+75CFYl7zEJhd493hSAvr/foY3wW6EXkxyh8Vv8efRKf62WXT1rmSyMMfjpB+skudxh+Dix3Rvw6YfJw9VXkObvPOc63qylD0XxV1BabHm6w8IDksh/LaIZTMbbdCprHGhuQ99jigdaoEEP9GShRp0qTxu4bNaSYeLChZ24AsmwuxoUbGJGk1WiySZEuDliNRxCBme9caMctO14jR+ROWMoEZ4RH/raFf5r8kxbmbEsiin5rhbx41TXSWOTWFasAhObFTbfAj3bhj0/1s0o1YdmS2fGCNR6ni0Ppo7ZkcxasU/TnJ0TB+uUAEiG2IhkUf6KYSZQyRWM2IujoAFSROUviAwRIlTuS5CSC/cjYecXGM0Z7LStnXmbsTQChksXApkgFrJQU9WPJUUNVRZOqZjX1oEVrlpyy5pwtr02umlgytWxmbsWqiydXz27uXrwWLoI9UEsuVryUUiuHikAVvirWV1gOPuRIhx75sMOPctSG8mmpacvNmrfSaucuHdtEz92699LroDCwU4w0dORhw0cZdaLWpsw0deZp02eZ9aZ2Uf3S/oAaXdR4k1rr7KYGazB7uKC1nehiBmKcCMRtEUBB82IWnVLiRW4xi4XxUSgjSV1sQqdFDAjTINZJN7sPcr/FLaj/Fjf+Fbmw0P0X5ALQfeX2E2p9/c61Tez8CpemUfD1YX54Dex1/ajVf9u/Hb0dvR29Hb0dvR29Hf0PHE388YB/YsMPGOidZZTdxfYAAAGFaUNDUElDQyBwcm9maWxlAAB4nH2RPUjDQBiG37ZKpVYcLCLikKE6WRAVESetQhEqhFqhVQeTS/+gSUOS4uIouBYc/FmsOrg46+rgKgiCPyBOjk6KLlLid0mhRYx3HPfw3ve+3H0H+OtlppodY4CqWUYqERcy2VUh+IoQzX50Y0Zipj4nikl4jq97+Ph+F+NZ3nV/jh4lZzLAJxDPMt2wiDeIpzYtnfM+cYQVJYX4nHjUoAsSP3JddvmNc8FhP8+MGOnUPHGEWCi0sdzGrGioxJPEUUXVKN+fcVnhvMVZLVdZ8578heGctrLMdVpDSGARSxAhQEYVJZRhIUa7RoqJFJ3HPfyDjl8kl0yuEhg5FlCBCsnxg//B796a+YlxNykcBzpfbPtjGAjuAo2abX8f23bjBAg8A1day1+pA9OfpNdaWvQI6N0GLq5bmrwHXO4AA0+6ZEiOFKDlz+eB9zP6pizQdwuE1ty+Nc9x+gCkqVfJG+DgEBgpUPa6x7u72vv2b02zfz9/THKseNROhQAAAAZiS0dEAP8A/wD/oL2nkwAAAAlwSFlzAAALEwAACxMBAJqcGAAAAAd0SU1FB+QKChYVGrZwy10AAAF0SURBVDjL3dK/S9ZhFAXwj74ZvoXwllAKiSZYQ0uIQaND0BKUjQ1ODYIOBiKIEA1RNLWECIUQqIuL4BJFFoElmhjakk4a+YMgQYkIhVqu8PDw/gHRnZ7vufd7OPeew79WheR9ErcxF3g1zqMdF1CJPRyUIzqSvKvQiz94h5f4hvXoN6MeixjGC/wqR1qDFnxCX4IXQ91h3cAbvEZdTnIG27iCElbxAOcwH9/v0ZScpAc/Yn1wHNPoTIiPYgP34qcCurGLU8ncTXyIbXTgeabwetxjFgMJ/gjj2ewIbsECLmfNVdTiBL7iaeLsWjbbiqXKsLs1a37HReygAVdDWQEr2WxbuOxsWHo6aXZgM7lHETO4n5HUh5DGQ+BOHPdYMtSPn3iCwYjGOh5Hv4QtdKXJno1AjuFzqHmLqYhANT7ibhCV8BtfMAQVmdR2PMQ+XkWG1iLtTbiECYxiMl21okzCi3HoaxG22sB3QsGzMGMmbF/2f9dfX9xN/BNad7IAAAAASUVORK5CYII=" />
                            </i>
                        </div>
                    </div>
                    `;
        
                    nseToggleHideElement.title = "Change result visibility";
                    nseToggleHideElement.classList.add("nseToggleHideButton");
        
                    let actualIcon = nseToggleHideElement.querySelector("div > div > i");
                    let torrentID = resultID;
                    actualIcon.torrentID = torrentID;
                    actualIcon.onclick = function() {
                        let torrentParent = this.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode;

                        // Refresh lists, they might have been changed in other tabs
                        nseIndividualUploadHidingBlacklist = GM_getValue("nseIndividualUploadHidingBlacklist", new Array(0));
                        nseIndividualUploadHidingWhitelist = GM_getValue("nseIndividualUploadHidingWhitelist", new Array(0));
        
                        if(torrentParent) {
                            if(!torrentParent.getAttribute("isNSEHidden")) {
                                torrentParent.setAttribute("isNSEHidden", "0");
                            }
            
                            if(torrentParent.getAttribute("isNSEHidden") === "1") {
                                // Blacklisted, move to whitelist and unhide
                                let currindex = nseIndividualUploadHidingBlacklist.indexOf(this.torrentID);
                                if(currindex > -1) {
                                    nseIndividualUploadHidingBlacklist.splice(currindex, 1);
                                }
            
                                currindex = nseIndividualUploadHidingWhitelist.indexOf(this.torrentID);
                                if(currindex == -1) { // Only add if not already whitelisted to avoid duplicates
                                    nseIndividualUploadHidingWhitelist.push(this.torrentID);
                                }
            
                                if(currentPage == "Top 10") {
                                    let count = 0;
                                    let torrentLinks = document.querySelectorAll("tr.torrent > td > a");
                                    for(let i = 0; i < torrentLinks.length; i++) {
                                        if(new URL(torrentLinks[i].href).searchParams.get("id") === this.torrentID) {
                                            let currParent = torrentLinks[i].parentNode.parentNode;
                                            currParent.classList.toggle("hidden");
                                            currParent.setAttribute("isNSEHidden", "0");
                                            currParent.style.backgroundColor = null;

                                            let currIcon = currParent.querySelector(".nseToggleIcon");
                                            currIcon.classList.add("nseIndividuallyWhitelisted");
                                            currIcon.classList.remove("nseIndividuallyBlacklisted");
                                            currIcon.classList.remove("nseIndividuallyUntouched");

                                            count--;
                                        }
                                    }

                                    adjustHiddenHeaderCount(count);
                                } else {
                                    torrentParent.classList.toggle("hidden");
                                    torrentParent.setAttribute("isNSEHidden", "0");
                                    torrentParent.style.backgroundColor = null;
                                    
                                    this.classList.add("nseIndividuallyWhitelisted");
                                    this.classList.remove("nseIndividuallyBlacklisted");
                                    this.classList.remove("nseIndividuallyUntouched");

                                    adjustHiddenHeaderCount(-1);
                                }
            
                                
                            } else if(torrentParent.getAttribute("isNSEHidden") == "0") {
                                // Not hidden or is whitelisted, move to blacklist and hide
                                let currindex = nseIndividualUploadHidingWhitelist.indexOf(this.torrentID);
                                if(currindex > -1) {
                                    nseIndividualUploadHidingWhitelist.splice(currindex, 1);
                                }
            
                                currindex = nseIndividualUploadHidingBlacklist.indexOf(this.torrentID);
                                if(currindex == -1) { // Only add if not already blacklisted to avoid duplicates
                                    nseIndividualUploadHidingBlacklist.push(this.torrentID);
                                }

                                if(currentPage == "Top 10") {
                                    let count = 0;
                                    let torrentLinks = document.querySelectorAll("tr.torrent > td > a");
                                    for(let i = 0; i < torrentLinks.length; i++) {
                                        if(new URL(torrentLinks[i].href).searchParams.get("id") === this.torrentID) {
                                            let currParent = torrentLinks[i].parentNode.parentNode;
                                            currParent.classList.toggle("hidden");
                                            currParent.setAttribute("isNSEHidden", "1");
                                            currParent.style.backgroundColor = themes[nseSelectedTheme].hiddenBackgroundColor;

                                            let currIcon = currParent.querySelector(".nseToggleIcon");
                                            currIcon.classList.remove("nseIndividuallyWhitelisted");
                                            currIcon.classList.remove("nseIndividuallyUntouched");
                                            currIcon.classList.add("nseIndividuallyBlacklisted");

                                            count++;
                                        }
                                    }

                                    adjustHiddenHeaderCount(count);
                                } else {
                                    torrentParent.classList.toggle("hidden");
                                    torrentParent.setAttribute("isNSEHidden", "1");
                                    torrentParent.style.backgroundColor = themes[nseSelectedTheme].hiddenBackgroundColor;

                                    this.classList.remove("nseIndividuallyWhitelisted");
                                    this.classList.remove("nseIndividuallyUntouched");
                                    this.classList.add("nseIndividuallyBlacklisted");

                                    adjustHiddenHeaderCount(1);
                                }
                            }
            
                            //Save lists immediately after manipulating them
                            app.beforeFilterWrite();
                            GM_setValue("nseIndividualUploadHidingBlacklist", nseIndividualUploadHidingBlacklist);
                            GM_setValue("nseIndividualUploadHidingWhitelist", nseIndividualUploadHidingWhitelist);
                            app.afterFilterWrite();

                            if(nseRenumberTorrentsEnabled && currentPage == "Top 10") {
                                renumberTorrents();
                            }
                        }
                    };

                    // Clear list status on right-click
                    actualIcon.addEventListener('contextmenu', function(event) {
                        event.preventDefault();

                        let torrentParent = this.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode;

                        // Refresh lists, they might have been changed in other tabs
                        nseIndividualUploadHidingBlacklist = GM_getValue("nseIndividualUploadHidingBlacklist", new Array(0));
                        nseIndividualUploadHidingWhitelist = GM_getValue("nseIndividualUploadHidingWhitelist", new Array(0));
        
                        if(torrentParent) {
                            // Remove from both lists
                            let wasRemovedFromWL = false;
                            let wasRemovedFromBL = false;
                            
                            let currindex = nseIndividualUploadHidingWhitelist.indexOf(this.torrentID);
                            if(currindex > -1) {
                                nseIndividualUploadHidingWhitelist.splice(currindex, 1);
                                wasRemovedFromWL = true;
                            }

                            currindex = nseIndividualUploadHidingBlacklist.indexOf(this.torrentID);
                            if(currindex > -1) {
                                nseIndividualUploadHidingBlacklist.splice(currindex, 1);
                                wasRemovedFromBL = true;
                            }
        
                            if(wasRemovedFromWL || wasRemovedFromBL) {
                                if(currentPage == "Top 10") {
                                    let count = 0;
                                    let torrentLinks = document.querySelectorAll("tr.torrent > td > a");
                                    for(let i = 0; i < torrentLinks.length; i++) {
                                        if(new URL(torrentLinks[i].href).searchParams.get("id") === this.torrentID) {
                                            let currParent = torrentLinks[i].parentNode.parentNode;
                                            currParent.setAttribute("isNSEHidden", "0");
                                            currParent.style.backgroundColor = null;

                                            if(!wasRemovedFromWL) {
                                                currParent.classList.toggle("hidden");
                                            }

                                            let currIcon = currParent.querySelector(".nseToggleIcon");
                                            currIcon.classList.remove("nseIndividuallyWhitelisted");
                                            currIcon.classList.remove("nseIndividuallyBlacklisted");
                                            currIcon.classList.add("nseIndividuallyUntouched");

                                            count--;
                                        }
                                    }
                                    
                                    if(wasRemovedFromBL) {
                                        adjustHiddenHeaderCount(count);
                                    }
                                } else {
                                    if(!wasRemovedFromWL) {
                                        torrentParent.classList.toggle("hidden");
                                    }

                                    torrentParent.setAttribute("isNSEHidden", "0");
                                    torrentParent.style.backgroundColor = null;

                                    this.classList.remove("nseIndividuallyWhitelisted");
                                    this.classList.remove("nseIndividuallyBlacklisted");
                                    this.classList.add("nseIndividuallyUntouched");
                                    
                                    if(wasRemovedFromBL) {
                                        adjustHiddenHeaderCount(-1);
                                    }
                                }

                                // Save lists immediately after manipulating them
                                app.beforeFilterWrite();
                                GM_setValue("nseIndividualUploadHidingBlacklist", nseIndividualUploadHidingBlacklist);
                                GM_setValue("nseIndividualUploadHidingWhitelist", nseIndividualUploadHidingWhitelist);
                                app.afterFilterWrite();
                            }

                            if(nseRenumberTorrentsEnabled && currentPage == "Top 10") {
                                renumberTorrents();
                            }
                        }
                    }, false);

                    torrentIconContainer.appendChild(nseToggleHideElement);

                    // Check if torrent is black/whitelisted this way
                    let currentBLIndex = nseIndividualUploadHidingBlacklist.indexOf(torrentID);
                    if(currentBLIndex > -1) {
                    passReason ??= "Hidden individually";
                        if(russianRouletteBulletInChamber == false) {
                            actualIcon.classList.add("nseIndividuallyBlacklisted");
                            currentHidden = true;
                            currentForceHide = true;
                        }
                    }
        
                    let currentWLIndex = nseIndividualUploadHidingWhitelist.indexOf(torrentID);
                    if(currentWLIndex > -1) {
                        actualIcon.classList.add("nseIndividuallyWhitelisted");
                        currentWhitelisted = true;
                        currentForceShow = true;
                    }
        
                    if(currentForceHide == false && currentForceShow == false) {
                        // Torrent not acted upon
                        actualIcon.classList.add("nseIndividuallyUntouched");
                    }
                }
            }
 
            if(nseObliviousModeEnabled == true) {
                tagElement.classList.add("hidden");
            }
    
            // Check if filtered via options
            if(nseHideReportedEnabled) {
                if(titleElement.querySelector("span.reported") !== null) {
                    hideReason ??= "Reported result";
                    currentHidden = true;
                }
            }
    
            if(nseHideWarnedEnabled) {
                if(torrents[i].classList.contains("redbar")) {
                    hideReason ??= "Warned result";
                    currentHidden = true;
                }
            }
    
            if(nseHideUnseededEnabled) {
                let selector = "td:nth-child(8)";
    
                if(currentPage == "Collage") {
                    selector = "td:nth-child(7)";
                }
                
                let seeders = torrents[i].querySelector(selector);
                if(seeders.classList.contains("r00")) {
                    hideReason ??= "No seeders";
                    currentHidden = true;
                    
                }
            }
    
            let torrentIconElement = torrents[i].querySelector("td > span.torrent_icon_container > span.icon > a > div.icon_container > div.icon_stack > i");
    
            if(torrentIconElement) {
                if(nseHideSnatchedEnabled) {
                    if(torrentIconElement.classList.contains("snatched")) {
                    hideReason ??= "Activity filter · snatched";
                        currentHidden = true;
    
                        if(nseBypassWhitelistsEnabled) {
                            currentBypassWhitelist = true;
                        }
                    }
                }
    
                if(nseHideSeedingEnabled) {
                    if(torrentIconElement.classList.contains("seeding")) {
                    hideReason ??= "Activity filter · seeding";
                        currentHidden = true;
    
                        if(nseBypassWhitelistsEnabled) {
                            currentBypassWhitelist = true;
                        }
                    }
                }
    
                if(nseHideGrabbedEnabled) {
                    if(torrentIconElement.classList.contains("grabbed")) {
                    hideReason ??= "Activity filter · grabbed";
                        currentHidden = true;
    
                        if(nseBypassWhitelistsEnabled) {
                            currentBypassWhitelist = true;
                        }
                    }
                }
    
                if(nseHideLeechingEnabled) {
                    if(torrentIconElement.classList.contains("leeching")) {
                    hideReason ??= "Activity filter · leeching";
                        currentHidden = true;
    
                        if(nseBypassWhitelistsEnabled) {
                            currentBypassWhitelist = true;
                        }
                    }
                }
            }

            if(nseHideBookmarkedEnabled) {
                let bmElement = torrents[i].querySelector("i.bookmarked");
                if(bmElement) {
                    hideReason ??= "Bookmarked result";
                    currentHidden = true;
                    
                    if(nseBypassWhitelistsEnabled) {
                        currentBypassWhitelist = true;
                    }
                }
            }
    
            // Check uploaders
            // No uploaders on collage and user uploaded pages
            if(currentPage !== "Collage" && currentPage !== "Uploaded") { 
                if(!uploaderElement) { // If it is null, it's an anon upload
                    if(nseHideAnonUploadsEnabled) {
                        let anonName = torrents[i].querySelector("td > span.anon_name");
                        if(anonName && anonName.innerHTML == "anon") {
                    hideReason ??= "Anonymous uploader";
                            currentHidden = true;
                            if(russianRouletteBulletInChamber == false) {
                                anonName.classList.add("nseHiddenUploader");
                            }
                        }
                    }
                } else { // Not an anon upload
                    let uploader = uploaderElement.innerHTML.trim().toLowerCase();
    
                    let hiddenByUploader = false;
                    for(let l = 0; l < nseBlacklistUploaders.length; l++) {
                        if(uploader == nseBlacklistUploaders[l].trim().toLowerCase()) {
                    hideReason ??= "Blocked uploader · " + uploaderElement.textContent.trim();
                            hiddenByUploader = true;
                            currentHidden = true;
                            if(russianRouletteBulletInChamber == false) { 
                                uploaderElement.classList.add("nseHiddenUploader"); 
                            }
                            break;
                        }
                    }
    
                    // If hiddenByUploader is still false, that means no blacklisted uploader was found, check whitelist
                    // If hiddenByUploader is true, blacklisted uploader was found, and since usernames are unique, skip check
                    if(hiddenByUploader == false) {
                        if(currentBypassWhitelist == false) {
                            for(let m = 0; m < nseWhitelistUploaders.length; m++) {
                                if(uploader == nseWhitelistUploaders[m].trim().toLowerCase()) {
                                    currentWhitelisted = true;
                                    uploaderElement.classList.add("nseWhitelistedUploader");
                                    break;
                                }
                            }
                        }
                    }
                }
            }
    
            // Scan title for nseBlacklistTitlePhrases
            // ...For every blacklisted phrase:
            for(let tblCount = 0; tblCount < nseBlacklistTitlePhrases.length; tblCount++) {
                let currentTBLPhrase = nseBlacklistTitlePhrases[tblCount].trim().toLowerCase();
                let torrentTitle = titleElement.innerHTML.trim().toLowerCase();
    
                if(currentTBLPhrase != "") {
                    if(torrentTitle.includes(currentTBLPhrase)) {
                        currentHidden = true;
                        hideReason ??= "Blocked title · " + currentTBLPhrase;
                        if(russianRouletteBulletInChamber == false) { 
                            titleElement.innerHTML = titleElement.innerHTML + ` <color class="nseHiddenTitle">(${escapeHTML(currentTBLPhrase)})</color>`;
                        }
                    }
                }
            }

            // Scan title for nseHardPassTitlePhrases
            if(nseHardPassEnabled) {
                for(let tblCount = 0; tblCount < nseHardPassTitlePhrases.length; tblCount++) {
                    let currentTBLPhrase = nseHardPassTitlePhrases[tblCount].trim().toLowerCase();
                    let torrentTitle = titleElement.innerHTML.trim().toLowerCase();
        
                    if(currentTBLPhrase != "") {
                        if(torrentTitle.includes(currentTBLPhrase)) {
                            currentHidden = true;
                            currentForceHide = true;
                        passReason ??= "Hard Pass title · " + currentTBLPhrase;
                            if(russianRouletteBulletInChamber == false) { 
                                titleElement.innerHTML = titleElement.innerHTML + ` <color class="nseHardPassTitle">(${escapeHTML(currentTBLPhrase)})</color>`;

                                if(nseRemoveHardPassResults) {
                                    torrents[i].classList.add("nseHardPassRemove");
                                    countMe = 0;
                                }
                            }
                        }
                    }
                }
            }
    
            // Scan title for nseWhitelistTitlePhrases
            // ...For every whitelisted phrase:
            if(currentBypassWhitelist == false) {
                for(let tblCount = 0; tblCount < nseWhitelistTitlePhrases.length; tblCount++) {
                    let currentTWLPhrase = nseWhitelistTitlePhrases[tblCount].trim().toLowerCase();
                    let torrentTitle = titleElement.innerHTML.trim().toLowerCase();
    
                    if(currentTWLPhrase != "") {
                        if(torrentTitle.includes(currentTWLPhrase)) {
                            currentWhitelisted = true;
                            titleElement.innerHTML = titleElement.innerHTML + ` <color class="nseWhitelistedTitle">(${escapeHTML(currentTWLPhrase)})</color>`;
                        }
                    }
                }
            }
    
            // For every tag in the current torrent
            let tagList = tagElement.querySelectorAll("a");
            if(tagList) {
                for(let k = 0; k < tagList.length; k++) {
                    if(nseHardPassEnabled) {
                        if(nseHardPassTags.includes(tagList[k].innerHTML) === true) {
                    passReason ??= "Hard Pass tag · " + tagList[k].textContent.trim();
                            currentHidden = true;
                            currentForceHide = true;
                            if(russianRouletteBulletInChamber == false) { 
                                tagList[k].classList.add("nseHardPassTag");
        
                                if(nseRemoveHardPassResults) {
                                    torrents[i].classList.add("nseHardPassRemove");
                                    countMe = 0;
                                }
                            }
                        }
                    }
        
                    if(nseBlacklistTags.includes(tagList[k].innerHTML) === true) {
                    hideReason ??= "Blocked tag · " + tagList[k].textContent.trim();
                        currentHidden = true;
                        if(russianRouletteBulletInChamber == false) { 
                            tagList[k].classList.add("nseHiddenTag"); 
                        }
                    }
        
                    if(currentBypassWhitelist == false) {
                        if(nseWhitelistTags.includes(tagList[k].innerHTML) === true) {
                            currentWhitelisted = true;
                            tagList[k].classList.add("nseWhitelistedTag");
                        }
                    }
                }
            }
    
            if (conditional?.has("HIDE")) {
                currentHidden = true;
                hideReason ??= "Conditional rule " + (conditional.get("HIDE").line + 1);
            }
            if (conditional?.has("SHOW") && !currentBypassWhitelist) currentWhitelisted = true;
            if (conditional?.has("PASS")) {
                currentForceHide = true;
                passReason ??= "Hard Pass · conditional rule " + (conditional.get("PASS").line + 1);
                if (!currentForceShow && nseHardPassEnabled && nseRemoveHardPassResults) {
                    torrents[i].classList.add("nseHardPassRemove");
                    countMe = 0;
                }
            }

            // If forcing through individual filtering, ignore results
            if(currentForceShow) {
                currentHidden = false;
                currentWhitelisted = true;
            } else if(currentForceHide) {
                currentHidden = true;
                currentWhitelisted = false;
            }
    
            app.resultFilters.setEngineReason(torrents[i], !currentWhitelisted && currentHidden ? passReason || hideReason : null);
            if(currentWhitelisted === true) {
                torrents[i].classList.remove("nseHardPassRemove");
                torrents[i].classList.remove("hidden");
                torrents[i].setAttribute("isNSEHidden", "0");
            } else if(currentHidden === true) {
                if(russianRouletteBulletInChamber == false) {
                    torrents[i].style.backgroundColor = themes[nseSelectedTheme].hiddenBackgroundColor;
                    torrents[i].classList.add("hidden");
                    torrents[i].setAttribute("isNSEHidden", "1");
    
                    count += countMe;
                }
            }
        }
    } else if(currentPage == "Torrent details") {
        if(nseHideUnseededEnabled) {
            let seedersElement = document.querySelector("div.top_info > table.boxstat > tbody > tr > td:nth-child(4)");
            let seedersElement2 = document.querySelector("tr.group_torrent > td:nth-child(5)");
            let currSeeders = seedersElement2.innerHTML;

            if(currSeeders.trim() === "0") {
                seedersElement.classList.add("nseBlacklistIdentifier");
                seedersElement2.classList.add("nseBlacklistIdentifier");

                 // This has a div element also
                
            }
        }

        // Highlight if uploader is anon and user has NSE set to hide anon uploads
        let anonName = document.querySelectorAll(".anon_name");
        if(anonName.length) {
            if(nseHideAnonUploadsEnabled) {
                for(let anon = 0; anon < anonName.length; anon++) {
                    anonName[anon].classList.add("nseHiddenUploader");
                }
            }
        // Highlight if uploader is any of the lists
        } else {
            let uploaderElement = document.querySelector("table.boxstat > tbody > tr > td:nth-child(1) > a");
            let uploaderElement2 = document.querySelector(".torrent_table > tbody > tr:nth-child(5) > td > em > a");

            if(uploaderElement) {
                let uploader = uploaderElement.innerHTML.trim().toLowerCase();
    
                for(let l = 0; l < nseBlacklistUploaders.length; l++) {
                    if(uploader == nseBlacklistUploaders[l].trim().toLowerCase()) {
                        uploaderElement.classList.add("nseHiddenUploader"); 
                        uploaderElement2.classList.add("nseHiddenUploader"); 
                        break;
                    }
                }
    
                for(let m = 0; m < nseWhitelistUploaders.length; m++) {
                    if(uploader == nseWhitelistUploaders[m].trim().toLowerCase()) {
                        uploaderElement.classList.add("nseWhitelistedUploader");
                        uploaderElement2.classList.add("nseWhitelistedUploader");
                        break;
                    }
                }
            }
        }

        let titleElement2 = document.querySelector(".torrent_table > tbody > tr:nth-child(2) > td:nth-child(2) > strong");
        let titleElement = document.querySelector("#content > div:nth-child(1) > h2:nth-child(1)");
        let firstSpan = document.querySelector("#content > div:nth-child(1) > h2:nth-child(1) > span:nth-child(1)");
        let newSpan = titleElement.querySelector("[data-ep-detail-title]");
        if(!newSpan) {
            const text = Array.from(titleElement.childNodes).find(n => n.nodeType === 3 && n.textContent.trim());
            newSpan = document.createElement("span"); newSpan.dataset.epDetailTitle = "";
            if(text) { text.after(newSpan); newSpan.append(text); } else titleElement.append(newSpan);
        }
        titleElement = newSpan;

        // Scan title for nseBlacklistTitlePhrases
        // ...For every blacklisted phrase:
        for(let tblCount = 0; tblCount < nseBlacklistTitlePhrases.length; tblCount++) {
            let currentTBLPhrase = nseBlacklistTitlePhrases[tblCount].trim().toLowerCase();
            let torrentTitle = titleElement.innerHTML.trim().toLowerCase();

            if(currentTBLPhrase != "") {
                if(torrentTitle.includes(currentTBLPhrase)) {
                    titleElement.innerHTML = titleElement.innerHTML + ` <color class="nseHiddenTitle">(${escapeHTML(currentTBLPhrase)})</color>`;
                    titleElement2.innerHTML = titleElement2.innerHTML + ` <color class="nseHiddenTitle">(${escapeHTML(currentTBLPhrase)})</color>`;
                }
            }
        }
        
        // Scan title for nseHardPassTitlePhrases
        for(let tblCount = 0; tblCount < nseHardPassTitlePhrases.length; tblCount++) {
            let currentTBLPhrase = nseHardPassTitlePhrases[tblCount].trim().toLowerCase();
            let torrentTitle = titleElement.innerHTML.trim().toLowerCase();

            if(currentTBLPhrase != "") {
                if(torrentTitle.includes(currentTBLPhrase)) {
                    titleElement.innerHTML = titleElement.innerHTML + ` <color class="nseHardPassTitle">(${escapeHTML(currentTBLPhrase)})</color>`;
                    titleElement2.innerHTML = titleElement2.innerHTML + ` <color class="nseHardPassTitle">(${escapeHTML(currentTBLPhrase)})</color>`;
                }
            }
        }

        // Scan title for nseWhitelistTitlePhrases
        // ...For every whitelisted phrase:
        for(let tblCount = 0; tblCount < nseWhitelistTitlePhrases.length; tblCount++) {
            let currentTWLPhrase = nseWhitelistTitlePhrases[tblCount].trim().toLowerCase();
            let torrentTitle = titleElement.innerHTML.trim().toLowerCase();

            if(currentTWLPhrase != "") {
                if(torrentTitle.includes(currentTWLPhrase)) {
                    titleElement.innerHTML = titleElement.innerHTML + ` <color class="nseWhitelistedTitle">(${escapeHTML(currentTWLPhrase)})</color>`;
                    titleElement2.innerHTML = titleElement2.innerHTML + ` <color class="nseWhitelistedTitle">(${escapeHTML(currentTWLPhrase)})</color>`;
                }
            }
        }


        // Add individual filter icon to torrent details page, a lot of duplicated code, will function-ize later
        if(nseIndividualUploadHidingEnabled) {
            let torrentIconContainer = document.querySelector("td > span.torrent_icon_container");

            if(torrentIconContainer) {
                let nseToggleHideElement = document.createElement("span");
                nseToggleHideElement.className = "icon";
                nseToggleHideElement.innerHTML = `
                <div class="icon_container">
                    <div class="icon_stack">
                        <i class="font_icon torrent_icons clickable nseToggleIcon">
                            <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAC6npUWHRSYXcgcHJvZmlsZSB0eXBlIGV4aWYAAHja7ZdtktwoDIb/c4ocAUkIieNgPqpygz1+XrDb0z2T3SS1+2urTdlggSX5fWR6Joy/vs/wDQeVzCGpeS45RxyppMIVA4/nUfaVYtrX84avOXq1h3uCYRL0ct5avdZX2PXjgUcMOl7twa8Z9ssR3Y73ISvyGvfnJGHn007pclTGOcjF7TnV43LUroU7letMd1pnt+7Di8GgUlcEEuYhJHFf/cxAzrMu+75CFYl7zEJhd493hSAvr/foY3wW6EXkxyh8Vv8efRKf62WXT1rmSyMMfjpB+skudxh+Dix3Rvw6YfJw9VXkObvPOc63qylD0XxV1BabHm6w8IDksh/LaIZTMbbdCprHGhuQ99jigdaoEEP9GShRp0qTxu4bNaSYeLChZ24AsmwuxoUbGJGk1WiySZEuDliNRxCBme9caMctO14jR+ROWMoEZ4RH/raFf5r8kxbmbEsiin5rhbx41TXSWOTWFasAhObFTbfAj3bhj0/1s0o1YdmS2fGCNR6ni0Ppo7ZkcxasU/TnJ0TB+uUAEiG2IhkUf6KYSZQyRWM2IujoAFSROUviAwRIlTuS5CSC/cjYecXGM0Z7LStnXmbsTQChksXApkgFrJQU9WPJUUNVRZOqZjX1oEVrlpyy5pwtr02umlgytWxmbsWqiydXz27uXrwWLoI9UEsuVryUUiuHikAVvirWV1gOPuRIhx75sMOPctSG8mmpacvNmrfSaucuHdtEz92699LroDCwU4w0dORhw0cZdaLWpsw0deZp02eZ9aZ2Uf3S/oAaXdR4k1rr7KYGazB7uKC1nehiBmKcCMRtEUBB82IWnVLiRW4xi4XxUSgjSV1sQqdFDAjTINZJN7sPcr/FLaj/Fjf+Fbmw0P0X5ALQfeX2E2p9/c61Tez8CpemUfD1YX54Dex1/ajVf9u/Hb0dvR29Hb0dvR29Hf0PHE388YB/YsMPGOidZZTdxfYAAAGFaUNDUElDQyBwcm9maWxlAAB4nH2RPUjDQBiG37ZKpVYcLCLikKE6WRAVESetQhEqhFqhVQeTS/+gSUOS4uIouBYc/FmsOrg46+rgKgiCPyBOjk6KLlLid0mhRYx3HPfw3ve+3H0H+OtlppodY4CqWUYqERcy2VUh+IoQzX50Y0Zipj4nikl4jq97+Ph+F+NZ3nV/jh4lZzLAJxDPMt2wiDeIpzYtnfM+cYQVJYX4nHjUoAsSP3JddvmNc8FhP8+MGOnUPHGEWCi0sdzGrGioxJPEUUXVKN+fcVnhvMVZLVdZ8578heGctrLMdVpDSGARSxAhQEYVJZRhIUa7RoqJFJ3HPfyDjl8kl0yuEhg5FlCBCsnxg//B796a+YlxNykcBzpfbPtjGAjuAo2abX8f23bjBAg8A1day1+pA9OfpNdaWvQI6N0GLq5bmrwHXO4AA0+6ZEiOFKDlz+eB9zP6pizQdwuE1ty+Nc9x+gCkqVfJG+DgEBgpUPa6x7u72vv2b02zfz9/THKseNROhQAAAAZiS0dEAP8A/wD/oL2nkwAAAAlwSFlzAAALEwAACxMBAJqcGAAAAAd0SU1FB+QKChYVGrZwy10AAAF0SURBVDjL3dK/S9ZhFAXwj74ZvoXwllAKiSZYQ0uIQaND0BKUjQ1ODYIOBiKIEA1RNLWECIUQqIuL4BJFFoElmhjakk4a+YMgQYkIhVqu8PDw/gHRnZ7vufd7OPeew79WheR9ErcxF3g1zqMdF1CJPRyUIzqSvKvQiz94h5f4hvXoN6MeixjGC/wqR1qDFnxCX4IXQ91h3cAbvEZdTnIG27iCElbxAOcwH9/v0ZScpAc/Yn1wHNPoTIiPYgP34qcCurGLU8ncTXyIbXTgeabwetxjFgMJ/gjj2ewIbsECLmfNVdTiBL7iaeLsWjbbiqXKsLs1a37HReygAVdDWQEr2WxbuOxsWHo6aXZgM7lHETO4n5HUh5DGQ+BOHPdYMtSPn3iCwYjGOh5Hv4QtdKXJno1AjuFzqHmLqYhANT7ibhCV8BtfMAQVmdR2PMQ+XkWG1iLtTbiECYxiMl21okzCi3HoaxG22sB3QsGzMGMmbF/2f9dfX9xN/BNad7IAAAAASUVORK5CYII=" />
                        </i>
                    </div>
                </div>
                `;
    
                nseToggleHideElement.title = "Change result visibility";
                nseToggleHideElement.classList.add("nseToggleHideButton");
    
                let actualIcon = nseToggleHideElement.querySelector("div > div > i");
                let torrentID = window.location.href.match(/id=([0-9]+)/)[1];
                actualIcon.torrentID = torrentID;
                actualIcon.onclick = function() {   
                    // Refresh lists, they might have been changed in other tabs
                    nseIndividualUploadHidingBlacklist = GM_getValue("nseIndividualUploadHidingBlacklist", new Array(0));
                    nseIndividualUploadHidingWhitelist = GM_getValue("nseIndividualUploadHidingWhitelist", new Array(0));

                    if(nseIndividualUploadHidingBlacklist.includes(torrentID)) {
                        // Blacklisted, move to whitelist and unhide
                        let currindex = nseIndividualUploadHidingBlacklist.indexOf(this.torrentID);
                        if(currindex > -1) {
                            nseIndividualUploadHidingBlacklist.splice(currindex, 1);
                        }
    
                        currindex = nseIndividualUploadHidingWhitelist.indexOf(this.torrentID);
                        if(currindex == -1) { // Only add if not already whitelisted to avoid duplicates
                            nseIndividualUploadHidingWhitelist.push(this.torrentID);
                        }
    
                        this.classList.add("nseIndividuallyWhitelisted");
                        this.classList.remove("nseIndividuallyBlacklisted");
                        this.classList.remove("nseIndividuallyUntouched");
                    } else {
                        // Not hidden or is whitelisted, move to blacklist and hide
                        let currindex = nseIndividualUploadHidingWhitelist.indexOf(this.torrentID);
                        if(currindex > -1) {
                            nseIndividualUploadHidingWhitelist.splice(currindex, 1);
                        }
    
                        currindex = nseIndividualUploadHidingBlacklist.indexOf(this.torrentID);
                        if(currindex == -1) { // Only add if not already blacklisted to avoid duplicates
                            nseIndividualUploadHidingBlacklist.push(this.torrentID);
                        }
    
                        this.classList.remove("nseIndividuallyWhitelisted");
                        this.classList.remove("nseIndividuallyUntouched");
                        this.classList.add("nseIndividuallyBlacklisted");
                    }
    
                    //Save lists immediately after manipulating them
                    app.beforeFilterWrite();
                    GM_setValue("nseIndividualUploadHidingBlacklist", nseIndividualUploadHidingBlacklist);
                    GM_setValue("nseIndividualUploadHidingWhitelist", nseIndividualUploadHidingWhitelist);
                    app.afterFilterWrite();
                };

                // Clear list status on right-click
                actualIcon.addEventListener('contextmenu', function(event) {
                    event.preventDefault();

                    // Refresh lists, they might have been changed in other tabs
                    nseIndividualUploadHidingBlacklist = GM_getValue("nseIndividualUploadHidingBlacklist", new Array(0));
                    nseIndividualUploadHidingWhitelist = GM_getValue("nseIndividualUploadHidingWhitelist", new Array(0));

                    // Remove from both lists
                    let currindex = nseIndividualUploadHidingWhitelist.indexOf(this.torrentID);
                    if(currindex > -1) {
                        nseIndividualUploadHidingWhitelist.splice(currindex, 1);
                    }

                    currindex = nseIndividualUploadHidingBlacklist.indexOf(this.torrentID);
                    if(currindex > -1) {
                        nseIndividualUploadHidingBlacklist.splice(currindex, 1);
                    }

                    this.classList.remove("nseIndividuallyWhitelisted");
                    this.classList.remove("nseIndividuallyBlacklisted");
                    this.classList.add("nseIndividuallyUntouched");

                    //Save lists immediately after manipulating them
                    app.beforeFilterWrite();
                    GM_setValue("nseIndividualUploadHidingBlacklist", nseIndividualUploadHidingBlacklist);
                    GM_setValue("nseIndividualUploadHidingWhitelist", nseIndividualUploadHidingWhitelist);
                    app.afterFilterWrite();
                }, false);

                torrentIconContainer.appendChild(nseToggleHideElement);

                // Check if torrent is black/whitelisted this way
                let currentBLIndex = nseIndividualUploadHidingBlacklist.indexOf(torrentID);
                if(currentBLIndex > -1) {
                    actualIcon.classList.add("nseIndividuallyBlacklisted");
                }
    
                let currentWLIndex = nseIndividualUploadHidingWhitelist.indexOf(torrentID);
                if(currentWLIndex > -1) {
                    actualIcon.classList.add("nseIndividuallyWhitelisted");
                }

                if(currentBLIndex == -1 && currentWLIndex == -1) {
                    actualIcon.classList.add("nseIndividuallyUntouched");
                }
            }
        }
    } else if(currentPage == "My uploaded") {
        // Make sure colors function as expected on user uploads pages
        recolorTags();
    }
}



}
epFilterRows(torrents);

// +-----------------------------------------+
// | Event handler assignment and miscellany |
// +-----------------------------------------+

// Renumber if enabled
if(nseRenumberTorrentsEnabled && currentPage == "Top 10") {
    renumberTorrents();
}

// Add classes for Right-Click Management if enabled
if(nseRightClickManagementEnabled && currentPage !== "Notification filters") {
    if(currentPage == "Torrent details") {
        if(nseRCMTagsEnabled) {
            let currTaglist = document.querySelector("#torrent_tags");
            let observerOptions = {subtree: true, childList: true};
            let mObserver = new MutationObserver(function() {
                let tagList = document.querySelectorAll("ul#torrent_tags_list > li > a");        
                if(tagList !== null && tagList !== undefined) {
                    for(let i = 0; i < tagList.length; i++) {
                        tagList[i].classList.add("nseTagElement");
                    }
                }
            });

            if(currTaglist) mObserver.observe(currTaglist, observerOptions);
        }

        if(nseRCMTitlesEnabled) {
            // "Torrent Info" box
            let titleElement = document.querySelector(".group_torrent > td:nth-child(2) > strong");
            if(titleElement) titleElement.classList.add("nseTitleElement");

            // Header text
            titleElement = document.querySelector("#content > div:nth-child(1) > h2:nth-child(1)");
            if(titleElement) titleElement.classList.add("nseTitleElement");
        }

        if(nseRCMUploadersEnabled) {
            // First uploader element in torrent stats/controls near top of page
            let uploaderElement = document.querySelector("table.boxstat > tbody > tr > td:nth-child(1) > a");
            if(uploaderElement) {
                uploaderElement.classList.add("nseUploaderElement");
            }

            // Second uploader element in "Torrent Info" box
            uploaderElement = document.querySelector(".torrent_table > tbody > tr:nth-child(5) > td > em > a");
            if(uploaderElement) {
                uploaderElement.classList.add("nseUploaderElement");
            }
        }
    } else {
        for(let i = 0; i < torrents.length; i++) {
            // Tags
            if(nseRCMTagsEnabled) {
                let tagList = torrents[i].querySelectorAll("td > div.tags > a");
                if(tagList !== null && tagList !== undefined) {
                    for(let j = 0; j < tagList.length; j++) {
                        tagList[j].classList.add("nseTagElement");    
                    }
                }
            }
    
            // Titles
            if(nseRCMTitlesEnabled) {
                let titleElement;
                if(currentPage == "Collage") {
                    titleElement = torrents[i].querySelector("td > strong > a");
                } else {
                    titleElement = torrents[i].querySelector("td > a");
                }
                if(titleElement) titleElement.classList.add("nseTitleElement");
            }

            // Uploaders
            if(nseRCMUploadersEnabled) {
                let uploaderElement = torrents[i].querySelector("td.user > a");
    
                if(currentPage == "Top 10") {
                    uploaderElement = torrents[i].querySelector("td:nth-child(10) > a");
                }
        
                if(currentPage !== "Collage" && currentPage !== "Uploaded" && uploaderElement !== null) { 
                    uploaderElement.classList.add("nseUploaderElement");
                }
            }
        }
    }
}

// Keep torrent details taglist colored when it changes
if(currentPage == "Torrent details") {
    let currTaglist = document.querySelector("#torrent_tags");
    let observerOptions = {subtree: true, childList: true};
    let mObserver = new MutationObserver(function() { recolorTags(); });  
    if(currTaglist) mObserver.observe(currTaglist, observerOptions);
}

function recolorTags() {
    let tagList;
    if(currentPage == "Torrent details") {
        tagList = document.querySelectorAll("ul#torrent_tags_list > li > a");
    } else if(currentPage == "My uploaded") {    
        tagList = document.querySelectorAll("div.tags > a");
    } else if(nseUnfilteredPages.includes(currentPage)) {
        return;
    } else {
        tagList = document.querySelectorAll("a.nseTagElement");
    }
    
    if(tagList !== null && tagList !== undefined) {
        for(let i = 0; i < tagList.length; i++) {
            if(nseBlacklistTags.includes(tagList[i].innerHTML.trim())) {
                tagList[i].classList.remove("nseHardPassTag");
                tagList[i].classList.remove("nseWhitelistedTag");
                tagList[i].classList.add("nseHiddenTag");
            } else if(nseHardPassEnabled && nseHardPassTags.includes(tagList[i].innerHTML.trim())) {
                tagList[i].classList.remove("nseHiddenTag");
                tagList[i].classList.remove("nseWhitelistedTag");
                tagList[i].classList.add("nseHardPassTag");
            } else if(nseWhitelistTags.includes(tagList[i].innerHTML.trim())) {
                tagList[i].classList.remove("nseHiddenTag");
                tagList[i].classList.remove("nseHardPassTag");
                tagList[i].classList.add("nseWhitelistedTag");
            } else {
                tagList[i].classList.remove("nseHiddenTag");
                tagList[i].classList.remove("nseHardPassTag");
                tagList[i].classList.remove("nseWhitelistedTag");
            }
        }
    }
}

function recolorUploaders() {
    let uploaderElements;

    if(currentPage == "Top 10") {
        uploaderElements = document.querySelectorAll("td:nth-child(10) > a");
    } else if(nseUnfilteredPages.includes(currentPage) || currentPage == "Collage"|| currentPage == "Uploaded") {
        return;
    } else {
        uploaderElements = document.querySelectorAll("td.user > a");
    }

    if(uploaderElements) {
        for(let i = 0; i < uploaderElements.length; i++) {
            if(nseBlacklistUploaders.includes(uploaderElements[i].innerHTML.trim())) {
                uploaderElements[i].classList.remove("nseWhitelistedUploader");
                uploaderElements[i].classList.add("nseHiddenUploader");
            } else if(nseWhitelistUploaders.includes(uploaderElements[i].innerHTML.trim())) {
                uploaderElements[i].classList.remove("nseHiddenUploader");
                uploaderElements[i].classList.add("nseWhitelistedUploader");
            } else {
                uploaderElements[i].classList.remove("nseHiddenUploader");
                uploaderElements[i].classList.remove("nseWhitelistedUploader");
            }
        }
    }
}

// Remove categories if enabled
if(nseHideCategoryIconsEnabled && currentPage !== "Notification filters" && currentPage !== "Torrent details") {
    let selector = ".cats_col";
    if(currentPage == "Collage" || currentPage == "Uploaded") {
        selector = "#torrent_table > tbody > tr > td:nth-child(1)";
    } else if(currentPage == "Notifications") {
        selector = ".cats_cols";
    }

    let catsCols = document.querySelectorAll(selector);
    for(let i = 0; i < catsCols.length; i++) {
        catsCols[i].nextElementSibling.setAttribute("colspan", "2");
        catsCols[i].style.display = "none";
    }
}

// Remove Hard Pass results if Black Hole is enabled
if(nseHardPassEnabled && nseRemoveHardPassResults && !nseUnfilteredPages.includes(currentPage)) {
    let elementsToRemove = document.querySelectorAll(".nseHardPassRemove");
    if(elementsToRemove) {
        for(let i = 0; i < elementsToRemove.length; i++) {
            if(elementsToRemove[i]) {
                app.detachFilteredRow(elementsToRemove[i]);
            }
        }
    }
}

let headerNode = document.getElementById("nseHeaderText");

if(nseUnfilteredPages.includes(currentPage)) {
    headerNode.innerHTML = "Filtering is disabled on this page";
    headerNode.style.cursor = "auto";
} else {
    adjustHiddenHeaderCount(count);

    headerNode.onclick = function() {
        if(headerNode.innerHTML.match(/([0-9]+)/) !== null) {
            toggleTorrents();
        }
    };
}

document.getElementById("nseToggleOptionsNode").onclick = function() {
    document.getElementById("nseMainDiv").classList.toggle("hidden");
};

document.getElementById("nseCloseOptionsButton").onclick = function() { 
    document.getElementById("nseMainDiv").classList.add("hidden"); 
    app.root?.scrollIntoView({block:"start"});
};

document.getElementById("nseCheckCustomCSS").onclick = function() {
    if(this.checked) {
        document.getElementById("nseCustomCSSDiv").classList.remove("hidden");
    } else {
        document.getElementById("nseCustomCSSDiv").classList.add("hidden");
    }
};

document.getElementById("nseCheckRightClickManagementEnabled").onclick = function() {
    if(this.checked) {
        document.getElementById("nseRCMCustomizationDiv").classList.remove("hidden");
    } else {
        document.getElementById("nseRCMCustomizationDiv").classList.add("hidden");
    }
};

document.getElementById("nseThemeDropdown").onchange = function() {
    let selectedTheme = this.options[this.selectedIndex].value;
    let descriptionNode = document.getElementById("nseThemeDescription");

    if(selectedTheme == "nseThemeCustom") {
        document.getElementById("nseCustomThemeDiv").classList.remove("hidden");
    } else {
        document.getElementById("nseCustomThemeDiv").classList.add("hidden");
    }

    descriptionNode.innerHTML = nseThemeDescriptions[selectedTheme];
};

if(nseOpenAllButtonEnabled && !nseUnfilteredPages.includes(currentPage)) {
    document.getElementById("nseOpenAllButton").onclick = function() {
        let torrentLinks;

        if(currentPage == "Collage") {
            torrentLinks = document.querySelectorAll("tr.torrent > td > strong > a[href*='torrents.php?id=']");
        } else {
            torrentLinks = document.querySelectorAll("tr.torrent > td > a[href*='torrents.php?id=']");
        }
    
        if(torrentLinks) {
            let visitedLinks = [];
            for(let i = 0; i < torrentLinks.length; i++) {
                let hiddenStatus;

                if(currentPage == "Collage") {
                    hiddenStatus = torrentLinks[i].parentNode.parentNode.parentNode.getAttribute("isNSEHidden");
                } else {
                    hiddenStatus = torrentLinks[i].parentNode.parentNode.getAttribute("isNSEHidden");
                }

                if(hiddenStatus == 0 || hiddenStatus == "" || hiddenStatus == null) {
                    if(!visitedLinks.includes(torrentLinks[i].href)) {
                        window.open(torrentLinks[i].href, "_blank");
                        visitedLinks.push(torrentLinks[i].href);
                    }
                }
            }

            if(nseOpenAllGoNextEnabled) {
                nseGoForward();
            }
        }
    };
}

if(nseFilterAllButtonEnabled && nseIndividualUploadHidingEnabled && !nseUnfilteredPages.includes(currentPage)) {
    document.getElementById("nseFilterAllButton").onclick = function() {
        if(confirm(`Are you sure you want to filter all unfiltered results on this page?\n\nThis cannot be automatically undone, and you will have to manually unhide each torrent to undo it.`)) {
            for(let i = 0; i < torrents.length; i++) {
                if(!torrents[i].getAttribute("isNSEHidden") || torrents[i].getAttribute("isNSEHidden") === "0") {
                    torrents[i].querySelector(".nseToggleIcon").click();
                }
            }
        }
    };
}

// We like to have fun around here 😏
{
    let now = new Date();
    if(nseEveryDayIsApril1st || (now.getMonth() == 3 && now.getDate() == 1)) {
        let emojiElements = document.getElementsByClassName("nseEmoji");
        let normieArray = new Array("😂","🤣","😆", "🍆", "🍑", "💦", "💯", "😭", "🙃", "💩", "👌", "😏", "🙄", "🥵", "😱", "👀", "🤡");
        for(let i = 0; i < emojiElements.length; i++) {
            let randNum = Math.floor(Math.random() * normieArray.length);
            emojiElements[i].innerHTML = normieArray[randNum];
        }
    }
}

let explanationTogglers = new Array("nseBLE", "nseHPE", "nseHPTE", "nseWLE","nseTitleBLE", "nseTitleWLE", "nseUBLE", "nseUWLE");

for(let i = 0; i < explanationTogglers.length; i++) {
    document.getElementById(explanationTogglers[i] + "Toggler").onclick = function() {
        document.getElementById(this.id.substring(0, this.id.length - 7)).classList.toggle("hidden");
    };
}

if(currentPage !== "Notification filters") {
    document.addEventListener("contextmenu", function(event) {
        if(event.defaultPrevented || event.shiftKey || !nseRightClickManagementEnabled) return;
        // A browser can also dispatch a native context menu from the Menu key or Shift+F10.
        if (!app.settings.keyboardShortcuts && event.isTrusted && !event.pointerType &&
            (event.pointerId === -1 || event.button !== 2 && !event.ctrlKey)) return;
        const target = event.target.closest(".nseTagElement,.nseUploaderElement,div.tags>a,ul#torrent_tags_list>li>a,tr.torrent td.user>a");
        if(!target) return;
        const copy = target.cloneNode(true);
        for(const annotation of copy.querySelectorAll("color")) annotation.remove();
        const kind = target.matches(".nseTagElement,div.tags>a,ul#torrent_tags_list>li>a") ? "tag" : "uploader";
        if(kind === "tag" && !nseRCMTagsEnabled || kind === "uploader" && !nseRCMUploadersEnabled) return;
        event.preventDefault();
        showRCMBox(kind, copy.textContent.trim(), event.pageX, event.pageY);
        app.adoptRuleMenu(event, kind, copy.textContent.trim());
    });
    document.getElementById("nseRCMClose").onclick = function() {
        this.parentNode.classList.add("hidden");
    };
}

document.getElementById("nseExportButton").onclick = function() { exportSettings(); };
document.getElementById("nseImportFilePicker").onchange = function (event) { importSettings(event); };
document.getElementById("nseEraseDataButton").onclick = function () { resetSettings(); };
document.getElementById("nseSaveButton").onclick = function() { saveData(); };
document.getElementById("nseReloadButton").onclick = function() { location.reload(); };
// End event handler assignment section


// +-----------+
// | Functions |
// +-----------+
function toggleTorrents() {
    for(let k = 0; k < torrents.length; k++) {
        torrents[k].classList.toggle("hidden");
    }
}

function renumberTorrents() {
    let torrentTables = document.querySelectorAll("table.torrent_table");
    for(let i = 0; i < torrentTables.length; i++) {
        let currTorrents = torrentTables[i].querySelectorAll("tr.torrent");
        if(currTorrents) {
            let shownNum = 1;
            let hiddenNum = 1;
            for(let j = 0; j < currTorrents.length; j++) {
                if(currTorrents[j].classList.contains("hidden")) {
                    currTorrents[j].querySelector("td > strong").innerHTML = hiddenNum;
                    hiddenNum++;
                } else {
                    currTorrents[j].querySelector("td > strong").innerHTML = shownNum;
                    shownNum++;
                }
            }
        }
    }
}

function adjustHiddenHeaderCount(value) {
    let currNum = headerNode.innerHTML.match(/([0-9]+)/);
    
    if(currNum === null) {
        currNum = value;
    } else {
        currNum = currNum[0];
        currNum = Number(currNum) + value;
    }

    if(currNum === 0) {
        headerNode.innerHTML = "NoShitEmpornium";
        
        if(value !== 0) {
            toggleTorrents();
        }
    } else if(currNum === 1) {
        headerNode.innerHTML = "Toggle 1 hidden torrent";
    } else {
        headerNode.innerHTML = "Toggle " + currNum + " hidden torrents";
    }
}

function showRCMBox(boxType, elementValue, mouseX, mouseY) {
    let box = document.getElementById("nseRCMBox");
    let x = mouseX;
    let y = mouseY;

    // Make sure the box stays within page bounds
    if(x - 150 < 0) {
        x = 0;
    } else if(x + 320 > window.innerWidth) {
        x = window.innerWidth - 350;
    } else {
        x -= 150;
    }

    box.style.left = x + "px";
    box.style.top = y - 90 + "px";

    let nseRCMBoxInfoText = box.querySelector("#nseRCMBoxInfoText");
    if(boxType == "tag") {
        let infoText = `<b>Tag:</b> <span class="nseMonospace" id="nseRCMBoxTag">${elementValue}</span><br /><br />`;

        let currTagBlacklist = document.getElementById("nseBlacklistTaglistArea").value.split(" ");
        let currTagHardPassList = document.getElementById("nseHardPassTaglistArea").value.split(" ");
        let currTagWhitelist = document.getElementById("nseWhitelistTaglistArea").value.split(" ");
        let nseRCMBoxChoices = document.getElementById("nseRCMBoxChoices");

        if(currTagBlacklist.includes(elementValue)) { // Current tag is in blacklist
            infoText = infoText + `This tag was found in your <span class="nseBlacklistIdentifier">blacklist</span>!`;

            nseRCMBoxChoices.innerHTML = `
                <span class="nseRCMButton" id="nseRCMBoxBLRemove">${nseEmojiEnabled ? '➖' : '-'} Remove from blacklist</span><br /><br />
                ${nseHardPassEnabled ? 
                    `<span class="nseRCMButton" id="nseRCMBoxHPAdd">${nseEmojiEnabled ? '➕' : '+'} Move to Hard Pass</span><br /><br />` 
                : ''}
                <span class="nseRCMButton" id="nseRCMBoxWLAdd">${nseEmojiEnabled ? '➕' : '+'} Move to whitelist</span><br />
            `;

            document.getElementById("nseRCMBoxBLRemove").onclick = function() {
                let currTag = document.getElementById("nseRCMBoxTag").textContent;
                removeItemFromList("nseBlacklistTaglistArea", currTag);
                saveData();
                recolorTags();
                closeRCMBox();
            };

            if(nseHardPassEnabled) {
               document.getElementById("nseRCMBoxHPAdd").onclick = function() {
                    let currTag = document.getElementById("nseRCMBoxTag").textContent;
                    addItemToList("nseHardPassTaglistArea", "nseBlacklistTaglistArea", currTag);
                    saveData();
                    recolorTags();
                    closeRCMBox();
                }; 
            }

            document.getElementById("nseRCMBoxWLAdd").onclick = function() {
                let currTag = document.getElementById("nseRCMBoxTag").textContent;
                addItemToList("nseWhitelistTaglistArea", "nseBlacklistTaglistArea", currTag);
                saveData();
                recolorTags();
                closeRCMBox();
            };
        } else if(currTagWhitelist.includes(elementValue)) { // Current tag is in whitelist
            infoText = infoText + `This tag was found in your <span class="nseWhitelistIdentifier">whitelist</span>!`;

            nseRCMBoxChoices.innerHTML = `
                <span class="nseRCMButton" id="nseRCMBoxWLRemove">${nseEmojiEnabled ? '➖' : '-'} Remove from whitelist</span><br /><br />
                <span class="nseRCMButton" id="nseRCMBoxBLAdd">${nseEmojiEnabled ? '➕' : '+'} Move to blacklist</span><br /><br />
                ${nseHardPassEnabled ? 
                    `<span class="nseRCMButton" id="nseRCMBoxHPAdd">${nseEmojiEnabled ? '➕' : '+'} Move to Hard Pass</span><br />` 
                : ''}
            `;

            document.getElementById("nseRCMBoxWLRemove").onclick = function() {
                let currTag = document.getElementById("nseRCMBoxTag").textContent;
                removeItemFromList("nseWhitelistTaglistArea", currTag);
                saveData();
                recolorTags();
                closeRCMBox();
            };

            document.getElementById("nseRCMBoxBLAdd").onclick = function() {
                let currTag = document.getElementById("nseRCMBoxTag").textContent;
                addItemToList("nseBlacklistTaglistArea", "nseWhitelistTaglistArea", currTag);
                saveData();
                recolorTags();
                closeRCMBox();
            };

            if(nseHardPassEnabled) {
                document.getElementById("nseRCMBoxHPAdd").onclick = function() {
                     let currTag = document.getElementById("nseRCMBoxTag").textContent;
                     addItemToList("nseHardPassTaglistArea", "nseWhitelistTaglistArea", currTag);
                     saveData();
                     recolorTags();
                     closeRCMBox();
                 }; 
             }
        } else if(nseHardPassEnabled && currTagHardPassList.includes(elementValue)) {
                // Current tag is in Hard Pass and it is enabled
                infoText = infoText + `This tag was found in your <span class="nseBlacklistIdentifier">Hard Pass blacklist</span>!`;
    
                nseRCMBoxChoices.innerHTML = `
                    <span class="nseRCMButton" id="nseRCMBoxHPRemove">${nseEmojiEnabled ? '➖' : '-'} Remove from Hard Pass</span><br /><br />
                    <span class="nseRCMButton" id="nseRCMBoxBLAdd">${nseEmojiEnabled ? '➕' : '+'} Move to blacklist</span><br /><br />
                    <span class="nseRCMButton" id="nseRCMBoxWLAdd">${nseEmojiEnabled ? '➕' : '+'} Move to whitelist</span><br />
                `;
    
                document.getElementById("nseRCMBoxHPRemove").onclick = function() {
                    let currTag = document.getElementById("nseRCMBoxTag").textContent;
                    removeItemFromList("nseHardPassTaglistArea", currTag);
                    saveData();
                    recolorTags();
                    closeRCMBox();
                };
    
                document.getElementById("nseRCMBoxBLAdd").onclick = function() {
                    let currTag = document.getElementById("nseRCMBoxTag").textContent;
                    addItemToList("nseBlacklistTaglistArea", "nseHardPassTaglistArea", currTag);
                    saveData();
                    recolorTags();
                    closeRCMBox();
                };
    
                document.getElementById("nseRCMBoxWLAdd").onclick = function() {
                    let currTag = document.getElementById("nseRCMBoxTag").textContent;
                    addItemToList("nseWhitelistTaglistArea", "nseHardPassTaglistArea", currTag);
                    saveData();
                    recolorTags();
                    closeRCMBox();
                };
        } else { // Current tag is in no list
            infoText = infoText + "This tag was not found in any of your taglists.";

            nseRCMBoxChoices.innerHTML = `
                <span class="nseRCMButton" id="nseRCMBoxBLAdd">${nseEmojiEnabled ? '➕' : '+'} Add to blacklist</span><br /><br />
                ${nseHardPassEnabled ? 
                    `<span class="nseRCMButton" id="nseRCMBoxHPAdd">${nseEmojiEnabled ? '➕' : '+'} Add to Hard Pass</span><br /><br />` 
                : ''}
                <span class="nseRCMButton" id="nseRCMBoxWLAdd">${nseEmojiEnabled ? '➕' : '+'} Add to whitelist</span><br />
            `;

            document.getElementById("nseRCMBoxBLAdd").onclick = function() {
                let currTag = document.getElementById("nseRCMBoxTag").textContent;
                addItemToList("nseBlacklistTaglistArea", "nseWhitelistTaglistArea", currTag);
                saveData();
                recolorTags();
                closeRCMBox();
            };

            if(nseHardPassEnabled) {
                document.getElementById("nseRCMBoxHPAdd").onclick = function() {
                     let currTag = document.getElementById("nseRCMBoxTag").textContent;
                     addItemToList("nseHardPassTaglistArea", "nseWhitelistTaglistArea", currTag);
                     saveData();
                     recolorTags();
                     closeRCMBox();
                 }; 
             }

            document.getElementById("nseRCMBoxWLAdd").onclick = function() {
                let currTag = document.getElementById("nseRCMBoxTag").textContent;
                addItemToList("nseWhitelistTaglistArea", "nseBlacklistTaglistArea", currTag);
                saveData();
                recolorTags();
                closeRCMBox();
            };
        }

        nseRCMBoxInfoText.innerHTML = infoText;
    } else if(boxType == "uploader") {
        let infoText = "<b>Uploader:</b> <span class=\"nseMonospace\" id=\"nseRCMBoxUploader\">" + escapeHTML(elementValue) + "</span><br /><br />";

        let currUploaderBlacklist = document.getElementById("nseBlacklistUploadersArea").value.split(" ");
        let currUploaderWhitelist = document.getElementById("nseWhitelistUploadersArea").value.split(" ");
        let nseRCMBoxChoices = document.getElementById("nseRCMBoxChoices");

        if(currUploaderBlacklist.includes(elementValue)) { // Current uploader is in blacklist
            infoText = infoText + `This uploader was found in your <span class="nseBlacklistIdentifier">blacklist</span>!`;

            nseRCMBoxChoices.innerHTML = `
                <span class="nseRCMButton" id="nseRCMBoxBLRemove">${nseEmojiEnabled ? '➖' : '-'} Remove from blacklist</span><br /><br />
                <span class="nseRCMButton" id="nseRCMBoxWLAdd">${nseEmojiEnabled ? '➕' : '+'} Move to whitelist</span><br />
            `;

            document.getElementById("nseRCMBoxBLRemove").onclick = function() {
                let currTag = document.getElementById("nseRCMBoxUploader").textContent;
                removeItemFromList("nseBlacklistUploadersArea", currTag);
                saveData();
                recolorUploaders();
                closeRCMBox();
            };

            document.getElementById("nseRCMBoxWLAdd").onclick = function() {
                let currTag = document.getElementById("nseRCMBoxUploader").textContent;
                addItemToList("nseWhitelistUploadersArea", "nseBlacklistUploadersArea", currTag);
                saveData();
                recolorUploaders();
                closeRCMBox();
            };
        } else if(currUploaderWhitelist.includes(elementValue)) { // Current uploader is in whitelist
            infoText = infoText + `This uploader was found in your <span class="nseWhitelistIdentifier">whitelist</span>!`;

            nseRCMBoxChoices.innerHTML = `
                <span class="nseRCMButton" id="nseRCMBoxWLRemove">${nseEmojiEnabled ? '➖' : '-'} Remove from whitelist</span><br /><br />
                <span class="nseRCMButton" id="nseRCMBoxBLAdd">${nseEmojiEnabled ? '➕' : '+'} Move to blacklist</span><br />
            `;

            document.getElementById("nseRCMBoxWLRemove").onclick = function() {
                let currTag = document.getElementById("nseRCMBoxUploader").textContent;
                removeItemFromList("nseWhitelistUploadersArea", currTag);
                saveData();
                recolorUploaders();
                closeRCMBox();
            };

            document.getElementById("nseRCMBoxBLAdd").onclick = function() {
                let currTag = document.getElementById("nseRCMBoxUploader").textContent;
                addItemToList("nseBlacklistUploadersArea", "nseWhitelistUploadersArea", currTag);
                saveData();
                recolorUploaders();
                closeRCMBox();
            };
        } else { // Current uploader is in no list
            infoText = infoText + "This uploader was not found in any of your uploader lists.";

            nseRCMBoxChoices.innerHTML = `
                <span class="nseRCMButton" id="nseRCMBoxBLAdd">${nseEmojiEnabled ? '➕' : '+'} Add to blacklist</span><br /><br />
                <span class="nseRCMButton" id="nseRCMBoxWLAdd">${nseEmojiEnabled ? '➕' : '+'} Add to whitelist</span><br />
            `;

            document.getElementById("nseRCMBoxBLAdd").onclick = function() {
                let currTag = document.getElementById("nseRCMBoxUploader").textContent;
                addItemToList("nseBlacklistUploadersArea", "nseWhitelistUploadersArea", currTag);
                saveData();
                recolorUploaders();
                closeRCMBox();
            };

            document.getElementById("nseRCMBoxWLAdd").onclick = function() {
                let currTag = document.getElementById("nseRCMBoxUploader").textContent;
                addItemToList("nseWhitelistUploadersArea", "nseBlacklistUploadersArea", currTag);
                saveData();
                recolorUploaders();
                closeRCMBox();
            };
        }

        nseRCMBoxInfoText.innerHTML = infoText;
    } else if(boxType == "title") {
        let infoText = `Customize the title phrase you would like to filter in the text box below. You can use a semicolon <span class="nseMonospace">;</span> to separate multiple phrases:<br /><br />
        <input type="text" class="nseInput" id="nseRCMTitlePhraseText" value="${escapeHTML(elementValue)}"></input><br />`;
        nseRCMBoxInfoText.innerHTML = infoText;

        let nseRCMBoxChoices = document.getElementById("nseRCMBoxChoices");

        nseRCMBoxChoices.innerHTML = `
            <span class="nseRCMButton" id="nseRCMBoxBLAdd">${nseEmojiEnabled ? '➕' : '+'} Add phrase(s) to title blacklist</span><br /><br />
            ${nseHardPassEnabled ? `<span class="nseRCMButton" id="nseRCMBoxHPTAdd">${nseEmojiEnabled ? '➕' : '+'} Add phrase(s) to title Hard Pass</span><br /><br />` : ''}
            <span class="nseRCMButton" id="nseRCMBoxWLAdd">${nseEmojiEnabled ? '➕' : '+'} Add phrase(s) to title whitelist</span><br />
        `;

        document.getElementById("nseRCMBoxBLAdd").onclick = function() {
            let currTitlePhrase = document.getElementById("nseRCMTitlePhraseText").value;
            
            addItemToList("nseBlacklistTitleListArea", "nseWhitelistTitleListArea", currTitlePhrase);
            saveData();
            closeRCMBox();
        };

        if(document.getElementById("nseRCMBoxHPTAdd")) document.getElementById("nseRCMBoxHPTAdd").onclick = function() {
            let currTitlePhrase = document.getElementById("nseRCMTitlePhraseText").value;
            
            addItemToList("nseHardPassTitleListArea", "nseWhitelistTitleListArea", currTitlePhrase);
            saveData();
            closeRCMBox();
        };

        document.getElementById("nseRCMBoxWLAdd").onclick = function() {
            let currTitlePhrase = document.getElementById("nseRCMTitlePhraseText").value;
            
            addItemToList("nseWhitelistTitleListArea", "nseBlacklistTitleListArea", currTitlePhrase);
            saveData();
            closeRCMBox();
        };
    }
    
    box.classList.remove("hidden");
    return false;
}

function closeRCMBox() {
    document.getElementById("nseRCMBox").classList.add("hidden");
}

function removeItemFromList(tagListAreaName, tagName) {
    let currList = document.getElementById(tagListAreaName).value.trim().split(" ");

    let index = currList.indexOf(tagName);
    if (index > -1) {
        currList.splice(index, 1);
    }

    document.getElementById(tagListAreaName).value = currList.join(" ");
    
    // Show the refresh button because we've done changes
    document.getElementById("nseDynamicRefreshNode").classList.remove("hidden");
}

function addItemToList(tagListAreaName, oppositeTagListAreaName, filterValue) {
    let splitChar = " ";
    if(tagListAreaName == "nseWhitelistTitleListArea" || tagListAreaName == "nseBlacklistTitleListArea" || tagListAreaName == "nseHardPassTitleListArea") {
        splitChar = ";";
    } else {
        // Only do opposite removal for tags/uploaders
        removeItemFromList(oppositeTagListAreaName, filterValue);
    }

    let currList = document.getElementById(tagListAreaName).value.trim().split(splitChar);

    if(splitChar == ";") {
        // Since titles can include more than one phrase, iterate through an exploded array
        let titleArray = filterValue.split(splitChar);

        for(let l = 0; l < titleArray.length; l++) {
            let currPhrase = titleArray[l].trim();
            if(currPhrase != "") {
                currList.push(currPhrase);
            }
        }
    } else {
        currList.push(filterValue);    
    }
    
    document.getElementById(tagListAreaName).value = currList.join(splitChar).replace(/;/,';');

    // Show the refresh button because we did changes
    document.getElementById("nseDynamicRefreshNode").classList.remove("hidden");
}

function downloadFile(filename, text) {
    let element = document.createElement('a');
    element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(text));
    element.setAttribute("download", filename);
    element.style.display = "none";
    document.body.appendChild(element);
  
    element.click();
    document.body.removeChild(element);
}

function exportSettings(getSize = false) {
    if(!getSize) { saveData(); }

    let settingsNames = GM_listValues();
    let settings = {};

    for(let i = 0; i < settingsNames.length; i++) {
        settings[settingsNames[i]] = GM_getValue(settingsNames[i], null);
    }

    let jsonOutput = JSON.stringify(settings);

    if(getSize) {
        return String(jsonOutput.length);
    } else {
        downloadFile(`empornium-filters-${Date.now()}.json`, jsonOutput);
    }
}

async function importSettings(event) {
 const file = event.target.files && event.target.files[0]; if (!file) return;
 try { if(file.size > 8388608) throw new Error("Backup exceeds 8 MiB.");
 app.importData(await app.readFile(file)); app.toast("Import complete. Reload to apply filters.");
 } catch(error) { app.toast("Nothing imported: " + error.message); }
 event.target.value = "";
}

function resetSettings() {
    if(confirm("Reset all filter lists, individual visibility overrides, and filter preferences? Saved searches and image preferences will be kept.")) {
        let settingsNames = GM_listValues();

        for(let i = 0; i < settingsNames.length; i++) {
            GM_deleteValue(settingsNames[i]);
        }

        location.reload();
    }
}

function saveData() {
    app.beforeFilterWrite();
    let listsToSave = {
        nseTaglist: "nseBlacklistTaglistArea",
        nseHardPassTaglist: "nseHardPassTaglistArea",
        nseWhitelist: "nseWhitelistTaglistArea",
        nseBlacklistTitles: "nseBlacklistTitleListArea",
        nseHardPassTitles: "nseHardPassTitleListArea",
        nseWhitelistTitles: "nseWhitelistTitleListArea",
        nseUploaders: "nseBlacklistUploadersArea",
        nseWhitelistUploaders: "nseWhitelistUploadersArea"
    };

    // Convert to lower case, trim whitespace, remove duplicates and save filter lists
    for(const setting in listsToSave) {
        let strList = document.getElementById(listsToSave[setting]).value.trim().toLowerCase();
        let delimiter = " ";
        
        if(listsToSave[setting].includes("TitleList")) { 
            delimiter = ";";
        }
        
        // Empty diff lists
        let removedList = new Array(0);
        let addedList = new Array(0);

        // List from text boxes
        let freshList = strList.split(delimiter);

        // Stored list (might have changed since we made our cache at the start of the script)
        let storedList = GM_getValue(setting).split(delimiter);

        // Cached copy of stored list
        let cachedList;
        switch(setting) {
            case "nseTaglist":
                cachedList = nseBlacklistTags;
                break;
            case "nseHardPassTaglist":
                cachedList = nseHardPassTags;
                break;
            case "nseWhitelist":
                cachedList = nseWhitelistTags;
                break;
            case "nseBlacklistTitles":
                cachedList = nseBlacklistTitlePhrases;
                break;
            case "nseHardPassTitles":
                cachedList = nseHardPassTitlePhrases;
                break;
            case "nseWhitelistTitles":
                cachedList = nseWhitelistTitlePhrases;
                break;
            case "nseUploaders":
                cachedList = nseBlacklistUploaders;
                break;
            case "nseWhitelistUploaders":
                cachedList = nseWhitelistUploaders;
                break;
        }

        // Compute additions and removals from OG array
        freshList.forEach(function(item){
            if(cachedList.indexOf(item) == -1) {
                addedList.push(item);
            }
        });

        cachedList.forEach(function(item) {
            if(freshList.indexOf(item) == -1) {
                removedList.push(item);
            }
        });

        // Remove removals and add additions to the stored list
        removedList.forEach(function(item) {
            let foundIndex = storedList.indexOf(item);
            if(foundIndex > -1) {
                storedList.splice(foundIndex, 1);
            }
        });
        
        addedList.forEach(function(item) {
            let foundIndex = storedList.indexOf(item);
            if(foundIndex == -1) {
                if(item !== "" && item !== null) {
                    storedList.push(item);
                }
            }
        });

        // Turning it into a set and back into an array will automagically kill dupes
        storedList = [...new Set(storedList.filter(item => item.trim()))];
        storedList.sort();

        strList = storedList.join(delimiter);
        GM_setValue(setting, strList);

        // Reflect updated list in textarea
        document.getElementById(listsToSave[setting]).value = strList;

        // Update cached copy of list
        switch(setting) {
            case "nseTaglist":
                nseBlacklistTaglist = strList;
                nseBlacklistTags = storedList;
                break;
            case "nseHardPassTaglist":
                nseHardPassTaglist = strList;
                nseHardPassTags = storedList;
                break;
            case "nseWhitelist":
                nseWhitelistTaglist = strList;
                nseWhitelistTags = storedList;
                break;
            case "nseBlacklistTitles":
                nseBlacklistTitleList = strList;
                nseBlacklistTitlePhrases = storedList;
                break;
            case "nseHardPassTitles":
                nseHardPassTitleList = strList;
                nseHardPassTitlePhrases = storedList;
                break;
            case "nseWhitelistTitles":
                nseWhitelistTitleList = strList;
                nseWhitelistTitlePhrases = storedList;
                break;
            case "nseUploaders":
                nseBlacklistUploadersList = strList;
                nseBlacklistUploaders = storedList;
                break;
            case "nseWhitelistUploaders":
                nseWhitelistUploadersList = strList;
                nseWhitelistUploaders = storedList;
                break;
        }
    }

    let checkboxes = {
        nseObliviousModeEnabled: "nseCheckObliviousMode",
        nseRussianRouletteEnabled: "nseCheckRussianRouletteMode",
        nseHideAnonUploadsEnabled: "nseCheckHideAnonUploads",
        nseHideWarnedEnabled: "nseCheckHideWarned",
        nseHideReportedEnabled: "nseCheckHideReported",
        nseHideSnatchedEnabled: "nseCheckHideSnatched",
        nseHideSeedingEnabled: "nseCheckHideSeeding",
        nseHideLeechingEnabled: "nseCheckHideLeeching",
        nseHideGrabbedEnabled: "nseCheckHideGrabbed",
        nseHideBookmarkedEnabled: "nseCheckHideBookmarked",
        nseBypassWhitelistsEnabled: "nseCheckBypassWhitelists",
        nseIndividualUploadHidingEnabled: "nseCheckIndividualHide",
        nseFilterAllButtonEnabled: "nseCheckFilterAllButtonEnabled",
        nseRightClickManagementEnabled: "nseCheckRightClickManagementEnabled",
        nseRCMTagsEnabled: "nseCheckRCMTagsEnabled",
        nseRCMTitlesEnabled: "nseCheckRCMTitlesEnabled",
        nseRCMUploadersEnabled: "nseCheckRCMUploadersEnabled",
        nseEmojiEnabled: "nseCheckEmojiEnabled",
        nseScrollToNSEEnabled: "nseCheckScrollToNSEEnabled",
        nseHardPassEnabled: "nseCheckHardPassEnabled",
        nseRemoveHardPassResults: "nseCheckRemoveHardPassResults",
        nseHideUnseededEnabled: "nseCheckHideUnseeded",
        nseRenumberTorrentsEnabled: "nseCheckRenumberTorrents",
        nseHideCategoryIconsEnabled: "nseCheckHideCategoryIcons",
        nseArrowNavigationEnabled: "nseCheckArrowNavigation",
        nseUpdateToastsEnabled: "nseCheckUpdateToasts",
        nseFloatingToggleButtonEnabled: "nseCheckFloatingToggleButton",
        nseOpenAllButtonEnabled: "nseCheckOpenAllButton",
        nseOpenAllGoNextEnabled: "nseCheckOpenAllGoNext",
        nseCustomCSSEnabled: "nseCheckCustomCSS"
    };

    for(const setting in checkboxes) {
        GM_setValue(setting, document.getElementById(checkboxes[setting]).checked);
    }

    if(nseEnableApril1stOption) {
        GM_setValue("nseEveryDayIsApril1st", document.getElementById("nseCheckApril1stAllYear").checked);
    }

    let nseThemeDropdown = document.getElementById("nseThemeDropdown");
    GM_setValue("nseSelectedTheme", nseThemeDropdown.options[nseThemeDropdown.selectedIndex].value);

    nseCustomTheme = {
        backgroundColor: document.getElementById("nseCustomThemeBgCol").value,
        backgroundHighlightColor: document.getElementById("nseCustomThemeBgHighCol").value,
        foregroundColor: document.getElementById("nseCustomThemeForeCol").value,
        accentColor: document.getElementById("nseCustomThemeAccentCol").value,
        highlightColor: document.getElementById("nseCustomThemeHighCol").value,
        hiddenBackgroundColor: document.getElementById("nseCustomThemeHiddenBgCol").value
    };
    GM_setValue("nseCustomTheme", nseCustomTheme);

    GM_setValue("nseUIFont", document.getElementById("nseUIFont").value);
    GM_setValue("nseTextAreaFont", document.getElementById("nseTextAreaFont").value);

    GM_setValue("nseBlacklistColor", document.getElementById("nseBlacklistColor").value);    
    GM_setValue("nseHardPassColor", document.getElementById("nseHardPassColor").value);    
    GM_setValue("nseWhitelistColor", document.getElementById("nseWhitelistColor").value);

    GM_setValue("nseTimeout", Number(document.getElementById("nseTimeout").value));

    // We need to escape backslashes in the custom CSS as it will be included in a back-ticked CSS block
    let css = document.getElementById("nseCustomCSSArea").value;
    css = css.replace(/\\/gi, "\\\\");
    GM_setValue("nseCustomCSS", css);

    let time = new Date().toLocaleTimeString();
    document.getElementById("nseSaveDiv").innerHTML = "Saved at " + time + "!";
    document.getElementById("nseSaveDiv").classList.remove("hidden");
    app.afterFilterWrite();
}

function nseGoBack(event = null) {
    let prevLink = document.getElementsByClassName("pager_prev")[0];
    if(prevLink) {
        if(event) { event.preventDefault(); }
        prevLink.click();
    } else {
        let firstLink = document.getElementsByClassName("pager_first")[0];
        if(firstLink) {
            if(event) { event.preventDefault(); }
            firstLink.click();
        }
    }
}

function nseGoForward(event = null) {
    let nextLink = document.getElementsByClassName("pager_next")[0];
    if(nextLink) {
        if(event) { event.preventDefault(); }
        nextLink.click();
    } else {
        let lastLink = document.getElementsByClassName("pager_last")[0];
        if(lastLink) {
            if(event) { event.preventDefault(); }
            lastLink.click();
        }
    }
}

// +-----+
// | CSS |
// +-----+
GM_addStyle(`

.nseOuterDiv, #nseRCMBox {
    font-family: ${nseUIFont} !important;
    margin:auto;
    color: ${themes[nseSelectedTheme].foregroundColor};
    padding: 10px;
    border: 1px solid ${themes[nseSelectedTheme].accentColor};
    box-shadow: 0 1px 3px rgba(0,0,0,.1);
    background-color: ${themes[nseSelectedTheme].backgroundColor} !important;
    border-radius: 20px;
}

#nseOuter {
    width: min(600px, 100%); box-sizing: border-box;
    margin-top: 10px;
}

#nseOuter p:not(:last-child) {
    margin: 0 0 20px;
}

#nseOuter section {
    display: none;
    padding: 20px 0 0;
    border-top: 1px solid ${themes[nseSelectedTheme].accentColor};
}

#nseUpdateToast {
    font-family: ${nseUIFont} !important;
    z-index: 9001 !important;
    position: fixed;
    bottom: 0px;
    width: 100%;
    height: 80px;
    text-align: center;
    color: ${themes[nseSelectedTheme].foregroundColor};
    background-color: ${themes[nseSelectedTheme].backgroundColor};
    border-top: 3px solid ${themes[nseSelectedTheme].accentColor};
}

.nseRadioButton {
    display: none;
}

.nseLabel {
    display: inline-block;
    margin: 0 0 -1px;
    padding: 15px;
    font-weight: 600;
    text-align: center;
    color: ${themes[nseSelectedTheme].accentColor};
    background-color: ${themes[nseSelectedTheme].backgroundColor} !important;
    border: 1px solid ${themes[nseSelectedTheme].accentColor};
    margin-right: 5px;
}

.nseSettingsCheckbox {
    padding: 5px;
}

a.nseLink, a.nseLink:visited {
    color: ${themes[nseSelectedTheme].accentColor};
}

.nseSpanLink {
    color: ${themes[nseSelectedTheme].accentColor};
    cursor: pointer;
}

.nseLabel:hover {
    color: ${themes[nseSelectedTheme].highlightColor};
    background-color: ${themes[nseSelectedTheme].backgroundHighlightColor} !important;
}

.nseRadioButton:checked + .nseLabel {
    color: ${themes[nseSelectedTheme].accentColor};
    border: 1px solid ${themes[nseSelectedTheme].accentColor};
    border-top: 2px solid ${themes[nseSelectedTheme].accentColor};
    border-bottom: 1px solid ${themes[nseSelectedTheme].backgroundColor};
}

#nseTab1:checked ~ #nseContent1,#nseTab2:checked ~ #nseContent2,#nseTab3:checked ~ #nseContent3,#nseTab4:checked ~ #nseContent4 {
    display: block;
}

#nseSettingsTab1:checked ~ #nseSettingsContent1,#nseSettingsTab2:checked ~ #nseSettingsContent2,#nseSettingsTab3:checked ~ #nseSettingsContent3,#nseSettingsTab4:checked ~ #nseSettingsContent4 {
    display: block;
}

.nseExplanationSpan {
    font-size: 14px !important;
    color: ${themes[nseSelectedTheme].accentColor};
}

.nseESOffset {
    margin-left: 60px;
}

.nseListHeader {
    font-size: 18px;
}

.nseImageButton {
    position: relative;
    color: ${themes[nseSelectedTheme].foregroundColor};
    font-weight: bold;
}

.nseImageButton > a, .nseImageButton  > a:visited {
    color: ${themes[nseSelectedTheme].foregroundColor};
    text-decoration: none;
    border: 0;
}

.nseImageButton:before {
    font-weight: normal;
    margin-right: 5px;
}

.nseExplanationBox, #nseCustomThemeDiv, #nseCustomCSSDiv, .nseNiceBox {
    width: 97%;
    margin-top: 10px;
    border: 1px solid ${themes[nseSelectedTheme].accentColor};
    padding: 10px;
    border-radius: 10px;
}

#nseRCMCustomizationDiv {
    margin-top: 0px;
}

.nseNiceBox {
    width: 75%;
}

#nseHeader, .nseCenterDiv {
    width: 100%;
    margin: auto;
    text-align: center;
    font-size: 18px;
}

.nseExplanationToggler, ${currentPage !== "My uploaded" ? "#nseHeaderText," : ""} .nseNiceButton, .nseRCMButton, .nseLabel:hover {
    cursor: pointer;
}

#nseRCMBox {
    width: 300px;
    position: absolute;
    top: 0;
    left: 0;
    z-index: 9001;
}

#nseRCMClose {
    float: right;
    cursor: pointer;
}

.nseMonospace {
    font-family: Courier New;
    font-size: 16px;
}

.nseTextArea {
    font-family: ${nseTextAreaFont} !important;
    width: 99%;
    max-width: 99%;
}

.nseTextArea, .nseInput {
    color: ${themes[nseSelectedTheme].foregroundColor};
    background: none !important;
    background-color: ${themes[nseSelectedTheme].backgroundColor};
    border: 1px solid ${themes[nseSelectedTheme].accentColor};
}

.nseFieldDiv, .nseExplanationNode, .nseExplanationBox, #nseCustomThemeDiv, #nseCustomCSSDiv, .nseOuterDiv {
    margin-bottom: 10px;
}

.nseHiddenUploader, .nseHiddenTag, .nseHiddenTitle, .nseBlacklistIdentifier {
    color: ${nseBlacklistColor} !important;
    font-weight: bold !important;
}

.nseWhitelistedUploader, .nseWhitelistedTag, .nseWhitelistedTitle, .nseWhitelistIdentifier {
    color: ${nseWhitelistColor} !important;
    font-weight: bold !important;
}

.nseHiddenTag, .nseWhitelistedTag, .nseWhitelistedTitle, .nseHiddenTitle {
    display: inline;
}

.nseHardPassTag, .nseHardPassTitle {
    color: ${nseHardPassColor} !important;
    font-weight: bold !important;
}

.nseNiceButton, .nseRCMButton {
    background-color: ${themes[nseSelectedTheme].backgroundColor} !important;
    color: ${themes[nseSelectedTheme].foregroundColor} !important;
    border: 1px solid ${themes[nseSelectedTheme].accentColor};
    border-radius: 10px;
    padding: 5px;
    margin-left: 5px;
    margin-right: 5px;
    font-size: 16px;
}

.nseNiceButton:hover, .nseRCMButton:hover {
    background-color: ${themes[nseSelectedTheme].backgroundHighlightColor} !important;
}

.nseNiceButton, .nseRCMButton {
    padding-top: 3px;
}

.nseBtmAiryDiv {
    margin-bottom: 20px;
}

#nseSaveDiv, .nseTopAiryDiv {
    margin-top: 20px;
}

#nseSaveDiv, #nseDataUsage {
    font-weight: bold;
}

#nseMainDiv, .nseUpdateToastDiv {
    margin-top: 10px;
}

h3.nseH3 {
    color: ${themes[nseSelectedTheme].foregroundColor} !important;
}

.nseIndividuallyWhitelisted {
    border: 2px solid green;
    background-color: #CEF6D8;
}

.nseIndividuallyBlacklisted {
    border: 2px solid red;
    background-color: #F6CED8;
}

.nseIndividuallyUntouched {
    border: 2px solid gray;
    background-color: #EBEBEB;
}

.nseIndividuallyBlacklisted, .nseIndividuallyWhitelisted, .nseIndividuallyUntouched {
    border-radius: 5px;
}

.nseEmoji {
    display: ${nseEmojiEnabled ? 'inline-block' : 'none'};
}

.nseToggleHideButton {
    z-index: 1 !important;
}

#nseRCMTitlePhraseText {
    width: 95%;
}

.nseSettingsControlDiv {
    text-align: center;
}

#nseFloatyBoi {
    bottom: 72px;
    right: 16px;
    background-color: ${themes[nseSelectedTheme].backgroundColor} !important;
    color: ${themes[nseSelectedTheme].foregroundColor} !important;
    padding: 0.4em;
    border-radius: 0.8em;
    position: fixed;
    float: right;
    z-index: 1000;
    user-select: none;
    cursor: pointer;
}



`);
// End CSS section

// Integration bridge; original upstream filtering semantics stay in epFilterRows.
const epSeenRows = new WeakSet(torrents);
bridge.newRows = function(root, rows) {
    if(nseUnfilteredPages.includes(currentPage)) return;
    const selector = currentPage === "Requests" ? "#request_table tr" : "tr.torrent";
    const candidates = new Set(rows || (root.matches(selector) ? [root] : root.querySelectorAll(selector)));
    if(!rows) { const parent = root.closest(selector); if(parent) candidates.add(parent); }
    const fresh = Array.from(candidates).filter(row => !epSeenRows.has(row) &&
        row.querySelector("td > div.tags") && row.querySelector("td > a,td > strong > a"));
    if(!fresh.length) return;
    for(const row of fresh) epSeenRows.add(row);
    epFilterRows(fresh, rows);
    torrents = [...torrents, ...fresh];
    for(const row of fresh) {
        if(nseRightClickManagementEnabled) {
            if(nseRCMTagsEnabled) for(const tag of row.querySelectorAll("div.tags > a")) tag.classList.add("nseTagElement");
            if(nseRCMTitlesEnabled) row.querySelector("td > a,td > strong > a")?.classList.add("nseTitleElement");
            if(nseRCMUploadersEnabled) row.querySelector("td.user > a,td:nth-child(10) > a")?.classList.add("nseUploaderElement");
        }
        if(nseHideCategoryIconsEnabled) {
            const category = row.querySelector("td.cats_col");
            if(category?.nextElementSibling) { category.style.display = "none"; category.nextElementSibling.colSpan = 2; }
        }
        if(nseHardPassEnabled && nseRemoveHardPassResults && row.classList.contains("nseHardPassRemove")) {
            app.detachFilteredRow(row);
        }
    }
    adjustHiddenHeaderCount(count);
    if(nseRenumberTorrentsEnabled && currentPage === "Top 10") renumberTorrents();
};
bridge.flush = saveData;

// Refresh the existing engine; no navigation, replacement form, or extra handlers.
bridge.resultActions = !nseUnfilteredPages.includes(currentPage);
function epReloadFilterPreferences(syncInputs) {
    nseSavedVersion = GM_getValue("nseSavedVersion", nseVersionNum);
    nseBlacklistTaglist = GM_getValue("nseTaglist", "enter.tags.here separated.by.spaces no.newlines");
    nseHardPassTaglist = GM_getValue("nseHardPassTaglist", "enter.hard.pass.tags.here big.poopies gushing.blood");
    nseWhitelistTaglist = GM_getValue("nseWhitelist", "whitelist.tags go.here");
    nseBlacklistTitleList = GM_getValue("nseBlacklistTitles", "this is a title phrase;this is another title phrase");
    nseHardPassTitleList = GM_getValue("nseHardPassTitles", "this is a title phrase;this is another title phrase");
    nseWhitelistTitleList = GM_getValue("nseWhitelistTitles", "this is a title phrase;this is another title phrase");
    nseBlacklistUploadersList = GM_getValue("nseUploaders", "PutUserNamesHere SeparatedBySpaces NoNewlines");
    nseWhitelistUploadersList = GM_getValue("nseWhitelistUploaders", "PutUserNamesHere SeparatedBySpaces NoNewlines");
    nseIndividualUploadHidingEnabled = GM_getValue("nseIndividualUploadHidingEnabled", true);
    nseIndividualUploadHidingBlacklist = GM_getValue("nseIndividualUploadHidingBlacklist", new Array(0));
    nseIndividualUploadHidingWhitelist = GM_getValue("nseIndividualUploadHidingWhitelist", new Array(0));
    nseFilterAllButtonEnabled = GM_getValue("nseFilterAllButtonEnabled", true);
    nseRightClickManagementEnabled = GM_getValue("nseRightClickManagementEnabled", true);
    nseRCMTagsEnabled = GM_getValue("nseRCMTagsEnabled", true);
    nseRCMTitlesEnabled = GM_getValue("nseRCMTitlesEnabled", true);
    nseRCMUploadersEnabled = GM_getValue("nseRCMUploadersEnabled", true);
    nseHideAnonUploadsEnabled = GM_getValue("nseHideAnonUploadsEnabled", false);
    nseHideReportedEnabled = GM_getValue("nseHideReportedEnabled", false);
    nseHideWarnedEnabled = GM_getValue("nseHideWarnedEnabled", false);
    nseHideUnseededEnabled = GM_getValue("nseHideUnseededEnabled", false);
    nseHideGrabbedEnabled = GM_getValue("nseHideGrabbedEnabled", false);
    nseHideLeechingEnabled = GM_getValue("nseHideLeechingEnabled", false);
    nseHideSeedingEnabled = GM_getValue("nseHideSeedingEnabled", false);
    nseHideSnatchedEnabled = GM_getValue("nseHideSnatchedEnabled", false);
    nseHideBookmarkedEnabled = GM_getValue("nseHideBookmarkedEnabled", false);
    nseBypassWhitelistsEnabled = GM_getValue("nseBypassWhitelistsEnabled", false);
    nseHardPassEnabled = GM_getValue("nseHardPassEnabled", false);
    nseRemoveHardPassResults = GM_getValue("nseRemoveHardPassResults", false);
    nseObliviousModeEnabled = GM_getValue("nseObliviousModeEnabled", false);
    nseCustomCSSEnabled = GM_getValue("nseCustomCSSEnabled", false);
    nseCustomCSS = GM_getValue("nseCustomCSS", "/* With great power comes great responsibility */");
    nseScrollToNSEEnabled = GM_getValue("nseScrollToNSEEnabled", false);
    nseEmojiEnabled = GM_getValue("nseEmojiEnabled", true);
    nseUpdateToastsEnabled = GM_getValue("nseUpdateToastsEnabled", true);
    nseFloatingToggleButtonEnabled = GM_getValue("nseFloatingToggleButtonEnabled", true);
    nseOpenAllButtonEnabled = GM_getValue("nseOpenAllButtonEnabled", true);
    nseOpenAllGoNextEnabled = GM_getValue("nseOpenAllGoNextEnabled", false);
    nseUIFont = GM_getValue("nseUIFont", "Helvetica");
    nseTextAreaFont = GM_getValue("nseTextAreaFont", "Monospace");
    nseBlacklistColor = GM_getValue("nseBlacklistColor", "#F00");
    nseHardPassColor = GM_getValue("nseHardPassColor", "#A00");
    nseWhitelistColor = GM_getValue("nseWhitelistColor", "#0F0");
    nseTimeout = GM_getValue("nseTimeout", 1500);
    nseSelectedTheme = GM_getValue("nseSelectedTheme", "nseThemeDefault");
    nseCustomTheme = GM_getValue("nseCustomTheme", {
    backgroundColor: "#fff",
    backgroundHighlightColor: "#cfe7ff",
    foregroundColor: "#000",
    accentColor: "#0af",
    highlightColor: "#0071b0",
    hiddenBackgroundColor: "#aaf"
});
    nseRenumberTorrentsEnabled = GM_getValue("nseRenumberTorrentsEnabled", true);
    nseHideCategoryIconsEnabled = GM_getValue("nseHideCategoryIconsEnabled", false);
    nseArrowNavigationEnabled = GM_getValue("nseArrowNavigationEnabled", false);
    nseRussianRouletteEnabled = GM_getValue("nseRussianRouletteEnabled", false);
    nseEveryDayIsApril1st = GM_getValue("nseEveryDayIsApril1st", false);
    nseBlacklistTags = nseBlacklistTaglist.trim().split(/\s+/).filter(Boolean);
    nseHardPassTags = nseHardPassTaglist.trim().split(/\s+/).filter(Boolean);
    nseWhitelistTags = nseWhitelistTaglist.trim().split(/\s+/).filter(Boolean);
    nseBlacklistTitlePhrases = nseBlacklistTitleList.split(";").filter(Boolean);
    nseHardPassTitlePhrases = nseHardPassTitleList.split(";").filter(Boolean);
    nseWhitelistTitlePhrases = nseWhitelistTitleList.split(";").filter(Boolean);
    nseBlacklistUploaders = nseBlacklistUploadersList.split(/\s+/).filter(Boolean);
    nseWhitelistUploaders = nseWhitelistUploadersList.split(/\s+/).filter(Boolean);
    nseCustomTheme.hiddenBackgroundColor ||= "#aaf";
    themes.nseThemeCustom = {...nseCustomTheme};
    if(syncInputs) {
        const values = {"nseSavedVersion":nseSavedVersion,"nseTaglist":nseBlacklistTaglist,"nseHardPassTaglist":nseHardPassTaglist,"nseWhitelist":nseWhitelistTaglist,"nseBlacklistTitles":nseBlacklistTitleList,"nseHardPassTitles":nseHardPassTitleList,"nseWhitelistTitles":nseWhitelistTitleList,"nseUploaders":nseBlacklistUploadersList,"nseWhitelistUploaders":nseWhitelistUploadersList,"nseIndividualUploadHidingEnabled":nseIndividualUploadHidingEnabled,"nseIndividualUploadHidingBlacklist":nseIndividualUploadHidingBlacklist,"nseIndividualUploadHidingWhitelist":nseIndividualUploadHidingWhitelist,"nseFilterAllButtonEnabled":nseFilterAllButtonEnabled,"nseRightClickManagementEnabled":nseRightClickManagementEnabled,"nseRCMTagsEnabled":nseRCMTagsEnabled,"nseRCMTitlesEnabled":nseRCMTitlesEnabled,"nseRCMUploadersEnabled":nseRCMUploadersEnabled,"nseHideAnonUploadsEnabled":nseHideAnonUploadsEnabled,"nseHideReportedEnabled":nseHideReportedEnabled,"nseHideWarnedEnabled":nseHideWarnedEnabled,"nseHideUnseededEnabled":nseHideUnseededEnabled,"nseHideGrabbedEnabled":nseHideGrabbedEnabled,"nseHideLeechingEnabled":nseHideLeechingEnabled,"nseHideSeedingEnabled":nseHideSeedingEnabled,"nseHideSnatchedEnabled":nseHideSnatchedEnabled,"nseHideBookmarkedEnabled":nseHideBookmarkedEnabled,"nseBypassWhitelistsEnabled":nseBypassWhitelistsEnabled,"nseHardPassEnabled":nseHardPassEnabled,"nseRemoveHardPassResults":nseRemoveHardPassResults,"nseObliviousModeEnabled":nseObliviousModeEnabled,"nseCustomCSSEnabled":nseCustomCSSEnabled,"nseCustomCSS":nseCustomCSS,"nseScrollToNSEEnabled":nseScrollToNSEEnabled,"nseEmojiEnabled":nseEmojiEnabled,"nseUpdateToastsEnabled":nseUpdateToastsEnabled,"nseFloatingToggleButtonEnabled":nseFloatingToggleButtonEnabled,"nseOpenAllButtonEnabled":nseOpenAllButtonEnabled,"nseOpenAllGoNextEnabled":nseOpenAllGoNextEnabled,"nseUIFont":nseUIFont,"nseTextAreaFont":nseTextAreaFont,"nseBlacklistColor":nseBlacklistColor,"nseHardPassColor":nseHardPassColor,"nseWhitelistColor":nseWhitelistColor,"nseTimeout":nseTimeout,"nseSelectedTheme":nseSelectedTheme,"nseCustomTheme":nseCustomTheme,"nseRenumberTorrentsEnabled":nseRenumberTorrentsEnabled,"nseHideCategoryIconsEnabled":nseHideCategoryIconsEnabled,"nseArrowNavigationEnabled":nseArrowNavigationEnabled,"nseRussianRouletteEnabled":nseRussianRouletteEnabled,"nseEveryDayIsApril1st":nseEveryDayIsApril1st};
        const fields = {"nseTaglist":"nseBlacklistTaglistArea","nseHardPassTaglist":"nseHardPassTaglistArea","nseWhitelist":"nseWhitelistTaglistArea","nseBlacklistTitles":"nseBlacklistTitleListArea","nseHardPassTitles":"nseHardPassTitleListArea","nseWhitelistTitles":"nseWhitelistTitleListArea","nseUploaders":"nseBlacklistUploadersArea","nseWhitelistUploaders":"nseWhitelistUploadersArea","nseObliviousModeEnabled":"nseCheckObliviousMode","nseRussianRouletteEnabled":"nseCheckRussianRouletteMode","nseHideAnonUploadsEnabled":"nseCheckHideAnonUploads","nseHideWarnedEnabled":"nseCheckHideWarned","nseHideReportedEnabled":"nseCheckHideReported","nseHideSnatchedEnabled":"nseCheckHideSnatched","nseHideSeedingEnabled":"nseCheckHideSeeding","nseHideLeechingEnabled":"nseCheckHideLeeching","nseHideGrabbedEnabled":"nseCheckHideGrabbed","nseHideBookmarkedEnabled":"nseCheckHideBookmarked","nseBypassWhitelistsEnabled":"nseCheckBypassWhitelists","nseIndividualUploadHidingEnabled":"nseCheckIndividualHide","nseFilterAllButtonEnabled":"nseCheckFilterAllButtonEnabled","nseRightClickManagementEnabled":"nseCheckRightClickManagementEnabled","nseRCMTagsEnabled":"nseCheckRCMTagsEnabled","nseRCMTitlesEnabled":"nseCheckRCMTitlesEnabled","nseRCMUploadersEnabled":"nseCheckRCMUploadersEnabled","nseEmojiEnabled":"nseCheckEmojiEnabled","nseScrollToNSEEnabled":"nseCheckScrollToNSEEnabled","nseHardPassEnabled":"nseCheckHardPassEnabled","nseRemoveHardPassResults":"nseCheckRemoveHardPassResults","nseHideUnseededEnabled":"nseCheckHideUnseeded","nseRenumberTorrentsEnabled":"nseCheckRenumberTorrents","nseHideCategoryIconsEnabled":"nseCheckHideCategoryIcons","nseArrowNavigationEnabled":"nseCheckArrowNavigation","nseUpdateToastsEnabled":"nseCheckUpdateToasts","nseFloatingToggleButtonEnabled":"nseCheckFloatingToggleButton","nseOpenAllButtonEnabled":"nseCheckOpenAllButton","nseOpenAllGoNextEnabled":"nseCheckOpenAllGoNext","nseCustomCSSEnabled":"nseCheckCustomCSS","nseSelectedTheme":"nseThemeDropdown","nseUIFont":"nseUIFont","nseTextAreaFont":"nseTextAreaFont","nseBlacklistColor":"nseBlacklistColor","nseHardPassColor":"nseHardPassColor","nseWhitelistColor":"nseWhitelistColor","nseTimeout":"nseTimeout","nseCustomCSS":"nseCustomCSSArea","nseEveryDayIsApril1st":"nseCheckApril1stAllYear"};
        for(const [key, id] of Object.entries(fields)) {
            const input = document.getElementById(id); if(!input) continue;
            const value = values[key];
            if(value === undefined) continue;
            if(input.type === "checkbox") input.checked = value;
            else input.value = value;
        }
        const colors = {
            backgroundColor:"nseCustomThemeBgCol", backgroundHighlightColor:"nseCustomThemeBgHighCol",
            foregroundColor:"nseCustomThemeForeCol", accentColor:"nseCustomThemeAccentCol",
            highlightColor:"nseCustomThemeHighCol", hiddenBackgroundColor:"nseCustomThemeHiddenBgCol"
        };
        for(const [key,id] of Object.entries(colors)) document.getElementById(id).value = nseCustomTheme[key];
        document.getElementById("nseCustomCSSArea").value = nseCustomCSS.replace(/\\\\/g, "\\");
    }
}
bridge.validateDraft = function() {
    const fields = {"nseTaglist":"nseBlacklistTaglistArea","nseHardPassTaglist":"nseHardPassTaglistArea","nseWhitelist":"nseWhitelistTaglistArea","nseBlacklistTitles":"nseBlacklistTitleListArea","nseHardPassTitles":"nseHardPassTitleListArea","nseWhitelistTitles":"nseWhitelistTitleListArea","nseUploaders":"nseBlacklistUploadersArea","nseWhitelistUploaders":"nseWhitelistUploadersArea","nseObliviousModeEnabled":"nseCheckObliviousMode","nseRussianRouletteEnabled":"nseCheckRussianRouletteMode","nseHideAnonUploadsEnabled":"nseCheckHideAnonUploads","nseHideWarnedEnabled":"nseCheckHideWarned","nseHideReportedEnabled":"nseCheckHideReported","nseHideSnatchedEnabled":"nseCheckHideSnatched","nseHideSeedingEnabled":"nseCheckHideSeeding","nseHideLeechingEnabled":"nseCheckHideLeeching","nseHideGrabbedEnabled":"nseCheckHideGrabbed","nseHideBookmarkedEnabled":"nseCheckHideBookmarked","nseBypassWhitelistsEnabled":"nseCheckBypassWhitelists","nseIndividualUploadHidingEnabled":"nseCheckIndividualHide","nseFilterAllButtonEnabled":"nseCheckFilterAllButtonEnabled","nseRightClickManagementEnabled":"nseCheckRightClickManagementEnabled","nseRCMTagsEnabled":"nseCheckRCMTagsEnabled","nseRCMTitlesEnabled":"nseCheckRCMTitlesEnabled","nseRCMUploadersEnabled":"nseCheckRCMUploadersEnabled","nseEmojiEnabled":"nseCheckEmojiEnabled","nseScrollToNSEEnabled":"nseCheckScrollToNSEEnabled","nseHardPassEnabled":"nseCheckHardPassEnabled","nseRemoveHardPassResults":"nseCheckRemoveHardPassResults","nseHideUnseededEnabled":"nseCheckHideUnseeded","nseRenumberTorrentsEnabled":"nseCheckRenumberTorrents","nseHideCategoryIconsEnabled":"nseCheckHideCategoryIcons","nseArrowNavigationEnabled":"nseCheckArrowNavigation","nseUpdateToastsEnabled":"nseCheckUpdateToasts","nseFloatingToggleButtonEnabled":"nseCheckFloatingToggleButton","nseOpenAllButtonEnabled":"nseCheckOpenAllButton","nseOpenAllGoNextEnabled":"nseCheckOpenAllGoNext","nseCustomCSSEnabled":"nseCheckCustomCSS","nseSelectedTheme":"nseThemeDropdown","nseUIFont":"nseUIFont","nseTextAreaFont":"nseTextAreaFont","nseBlacklistColor":"nseBlacklistColor","nseHardPassColor":"nseHardPassColor","nseWhitelistColor":"nseWhitelistColor","nseTimeout":"nseTimeout","nseCustomCSS":"nseCustomCSSArea","nseEveryDayIsApril1st":"nseCheckApril1stAllYear"};
    const data = {};
    for(const [key,id] of Object.entries(fields)) {
        const input = document.getElementById(id); if(!input) continue;
        data[key] = input.type === "checkbox" ? input.checked : key === "nseTimeout" ? Number(input.value) : input.value;
    }
    data.nseCustomTheme = {
        backgroundColor:document.getElementById("nseCustomThemeBgCol").value,
        backgroundHighlightColor:document.getElementById("nseCustomThemeBgHighCol").value,
        foregroundColor:document.getElementById("nseCustomThemeForeCol").value,
        accentColor:document.getElementById("nseCustomThemeAccentCol").value,
        highlightColor:document.getElementById("nseCustomThemeHighCol").value,
        hiddenBackgroundColor:document.getElementById("nseCustomThemeHiddenBgCol").value
    };
    validateNSE(data, epSchema);
};
bridge.refresh = function(syncInputs = false) {
    epReloadFilterPreferences(syncInputs);
    app.restoreFilterBaseline();
    count = 0;
    torrents = document.querySelectorAll(currentPage === "Requests" ? "#request_table tr" : "tr.torrent");
    for(const row of torrents) epSeenRows.add(row);
    epFilterRows(torrents);
    if(currentPage === "Torrent details") recolorTags();
    if(nseHideCategoryIconsEnabled) for(const category of document.querySelectorAll(".cats_col,.cats_cols")) {
        if(category.nextElementSibling) category.nextElementSibling.colSpan = 2;
        category.style.display = "none";
    }
    if(nseHardPassEnabled && nseRemoveHardPassResults) {
        for(const row of document.querySelectorAll("tr.nseHardPassRemove")) app.detachFilteredRow(row);
    }
    if(!nseUnfilteredPages.includes(currentPage)) adjustHiddenHeaderCount(count);
    if(nseRenumberTorrentsEnabled && currentPage === "Top 10") renumberTorrents();
    app.syncGridFilters();
    app.schedule(document.querySelector("#content") || document.body);
};
bridge.openVisible = function() {
    if(nseUnfilteredPages.includes(currentPage)) return;
    const visited = new Set();
    for(const row of document.querySelectorAll(currentPage === "Requests" ? "#request_table tr" : "tr.torrent")) {
        if(row.getAttribute("isNSEHidden") === "1" || row.matches(".epc-version-hidden,.epc-filter-hidden")) continue;
        const title = row.querySelector(currentPage === "Collage" ? "td > strong > a" : "td > a");
        if(!title?.href) continue;
        const url = new URL(title.href, location.href);
        if(url.origin !== location.origin || !["/torrents.php","/requests.php"].includes(url.pathname) ||
           url.searchParams.get("action") === "download" || visited.has(url.href)) continue;
        visited.add(url.href); window.open(url.href,"_blank");
    }
    if(nseOpenAllGoNextEnabled) nseGoForward();
};
bridge.hideVisible = function() {
    if(!confirm("Hide the results currently shown? You can restore them with Undo changes.")) return;
    const visible = document.querySelectorAll("tr.torrent:not(.epc-version-hidden,.epc-filter-hidden)");
    for(const row of visible) {
        if(row.getAttribute("isNSEHidden") !== "1") row.querySelector(".nseToggleIcon")?.click();
    }
};
if(currentPage === "Torrent details") recolorTags();

}

})();
