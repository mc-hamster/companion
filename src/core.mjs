// SPDX-License-Identifier: GPL-3.0-or-later
// New companion implementation. Reference projects are attributed in THIRD_PARTY.md.
export const DEFAULTS = Object.freeze({
  enabled: true, previews: true, inlineThumbnails: true,
  thumbnailPlacement: 'title', categoryDisplay: 'keep', thumbnailMode: 'auto',
  thumbnailSize: 100, previewWidth: 440, hoverDelay: 140, hideDelay: 240,
  resultsView: 'list', gridCardWidth: 320, gridLargeImages: true, gridShowDetails: false, gridShowTags: false,
  concurrency: 8, maxRetries: 2, stallMs: 8000, timeoutMs: 24000, thumbnailTimeoutMs: 4500,
  cacheEntries: 24, cacheMegapixels: 48, preloadScreens: 0.8,
  persistentImages: true, persistentCacheMB: 512,
  recoverImages: true, recoverBackgrounds: true, legacyFallback: true,
  prepareGalleries: true, reserveImageSpace: true, compactBodyImages: false,
  progressBar: true, keyboardShortcuts: true, globalArrowNavigation: false, navigationScope: 'off', diagnostics: false,
  backfillEnabled: true, backfillPages: 5, backfillMode: 'off', groupVersions: true,
  favoriteTags: '', cautionTags: ''
});

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

export function isSaveShortcut(event) {
  return event.key.toLowerCase() === 's' && event.ctrlKey !== event.metaKey && !event.altKey && !event.shiftKey;
}

export function validateSettings(input = {}) {
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
    backfillMode: ['off', 'pages', 'all'], resultsView: ['list', 'grid']
  })) if (options.includes(input[key])) result[key] = input[key];
  if (result.thumbnailMode === 'small') result.thumbnailMode = 'auto';
  for (const key of ['favoriteTags', 'cautionTags']) {
    if (typeof input[key] === 'string') {
      if (input[key].length > 50000) throw new Error('Tag highlight list exceeds 50,000 characters.');
      result[key] = [...new Set(input[key].trim().toLocaleLowerCase().split(/\s+/).filter(Boolean))].join(' ');
    }
  }
  // A caution takes visual precedence if a manually edited list overlaps.
  const caution = new Set(result.cautionTags.split(' '));
  result.favoriteTags = result.favoriteTags.split(' ').filter(tag => !caution.has(tag)).join(' ');
  return result;
}

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

export function decodeEntities(value) {
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (m, entity) => {
    if (entity[0] === '#') {
      const code = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[entity.toLowerCase()] || m;
  });
}

export function safeImageURL(value, base) {
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

export function canonicalImageURL(value) {
  const url = new URL(value);
  url.searchParams.delete('_ep_retry');
  url.hash = '';
  return url.href;
}

export function retryURL(value, nonce) {
  const url = new URL(value);
  url.searchParams.set('_ep_retry', String(nonce));
  return url.href;
}

export function legacyOriginal(value) {
  const url = new URL(value);
  if (!/^(?:fapping|jerking|cache)\.empornium\.(?:sx|me|is|ph)$/i.test(url.hostname)) return null;
  if (!/^\/images\/resize\/\d+\//.test(url.pathname)) return null;
  url.pathname = url.pathname.replace(/^\/images\/resize\/\d+\//, '/images/');
  return url.href;
}

export function isFriendlyImageHost(host) {
  return /^(?:hamsterimg\.net|hamster\.is|(?:fapping|jerking|cache)\.empornium\.(?:sx|me|is|ph))$/i.test(host);
}

export function fullSizeURL(value) {
  const original = legacyOriginal(value) || value;
  const url = new URL(original);
  if (isFriendlyImageHost(url.hostname)) url.pathname = url.pathname.replace(/\.(?:th|md)(\.[^/.]+)$/i, '$1');
  return url.href;
}

export function thumbnailCandidates(value, mode = 'auto', known = []) {
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
export function parseOverlayDefinitions(text, base) {
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

export function imageState({ hasSource, complete, width, deferred, stalled }) {
  if (!hasSource) return deferred ? 'deferred' : 'empty';
  if (complete) return width > 0 ? 'ready' : 'failed';
  return stalled && !width ? 'stalled' : width > 0 ? 'streaming' : 'loading';
}

export function editableTarget(target) {
  return !!target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]');
}

export function isNSEPage(location) {
  const url = new URL(location);
  if (url.pathname === '/torrents.php') return true;
  if (/^\/collage(?:s\.php|\/)/.test(url.pathname)) return true;
  if (url.pathname === '/requests.php') return true;
  if (url.pathname === '/user.php') return url.searchParams.get('action') === 'notify';
  return url.pathname === '/top10.php' && !['users', 'tags', 'taggers'].includes(url.searchParams.get('type'));
}

export const SEARCH_NAMES = /^(?:searchtext|title|sizeall|sizerange|filelist|taglist|filter_freeleech|limit_matches|order_by|order_way|sizeunit|sizeselect|sizeunits|sizetype|autocomplete_toggle|searchstr|filter_cat\[\d+\])$/;
export function validSearchFields(fields) {
  if (!Array.isArray(fields) || fields.length > 500) throw new Error('Invalid saved search fields.');
  return fields.map(field => {
    if (!field || !SEARCH_NAMES.test(field.name) || typeof field.value !== 'string' ||
        field.value.length > 20000 || !['text', 'textarea', 'checkbox', 'radio', 'select-one', 'select-multiple', 'number', 'hidden'].includes(field.type)) {
      throw new Error('Invalid saved search field.');
    }
    return { name: field.name, value: field.value, type: field.type, checked: !!field.checked };
  });
}

export function validateSearches(input) {
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

export class RetryBudget {
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
export class MediaPool {
  constructor(env, settings = DEFAULTS) {
    this.env = env; this.settings = settings; this.entries = new Map(); this.queue = [];
    this.active = 0; this.sequence = 0; this.hosts = new Map(); this.activeLanes = { thumbnail: 0, large: 0 };
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
  request(url, options = {}) {
    const canonical = canonicalImageURL(url), tier = options.tier || 'normal', key = canonical + '|' + tier;
    let entry = this.entries.get(key);
    if ((!entry || entry.status === 'failed') && !options.force) {
      const shared = Array.from(this.entries.values()).find(e => !e.cancelled &&
        ['loading', 'streaming', 'stalled', 'ready', 'partial'].includes(e.status) &&
        canonicalImageURL(e.actualURL) === canonical);
      if (shared) {
        if(shared.status==='ready'&&(shared.cacheMode||options.cacheMode))this.env.imageCache?.recordActivity?.('hit',shared.cacheBytes);
        shared.keepAlive ||= !!options.keepAlive; shared.touched = this.env.now();
        shared.priority = Math.max(shared.priority, options.priority || 0);
        if (shared.image && shared.priority >= 50) shared.image.fetchPriority = 'high';
        return shared;
      }
    }
    if (entry && !options.force) {
      if(entry.status==='ready'&&(entry.cacheMode||options.cacheMode))this.env.imageCache?.recordActivity?.('hit',entry.cacheBytes);
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
      if (entry.status === 'queued') this.pump();
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
    entry.cacheFresh = !!options.force;
    entry.target = options.target || null;
    entry.eligible = options.eligible;
    entry.priorityFor = options.priorityFor;
    entry.timeoutMs = options.timeoutMs || this.settings.timeoutMs;
    entry.fullTimeoutMs = options.fullTimeoutMs || entry.timeoutMs;
    entry.smallFirst = !!options.smallFirst;
    entry.smallCandidates = new Set(options.smallCandidates || []);
    entry.singleAttempt = !!options.singleAttempt; entry.rescue = !!options.rescue;
    entry.rescueBase = this.budget.get(canonical).rescueFrom || 0;
    if (options.failedAlready && this.settings.legacyFallback) {
      const original = legacyOriginal(canonical);
      if (original) { entry.candidates = [original, ...candidates.filter(c => c !== original)]; entry.actualURL = original; }
    }
    entry.bustFirst = !!options.fresh;
    this.entries.set(key, entry); this.queue.push(entry); this.emit(entry); this.pump(); this.trim();
    return entry;
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
          live.touched = this.env.now();
          if (live.image) live.image.fetchPriority = 'low';
          reschedule = ['queued', 'loading', 'streaming', 'stalled', 'retrying'].includes(live.status);
        } else if (live.priority >= 90 && ['queued', 'loading', 'streaming', 'stalled', 'retrying'].includes(live.status)) {
          // Moving away is not a host failure. Refund only the cancelled in-flight
          // attempt, retaining failures already charged to this URL.
          if (!live.released) {
            const budget = this.budget.get(live.url);
            budget.attempts = Math.max(live.rescue ? live.rescueBase : 0, budget.attempts - 1);
          }
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
    if (!entry.released) {
      const budget = this.budget.get(entry.url);
      budget.attempts = Math.max(entry.rescue ? entry.rescueBase : 0, budget.attempts - 1);
    }
    this.cancel(entry); this.entries.delete(entry.key); this.pump();
  }
  pump() {
    if (this.disposed) return;
    const hidden = this.env.hidden();
    if (hidden && !this.wasHidden) for (const e of this.entries.values()) if (!e.released) e.hostTimingIgnored = true;
    this.wasHidden = hidden;
    this.env.clearTimeout(this.wakeTimer); this.wakeTimer = null;
    for (const entry of this.queue) if (entry.priorityFor) entry.priority = entry.priorityFor();
    this.queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
    while (this.active < this.settings.concurrency + 3 && this.queue.length) {
      const index = this.queue.findIndex(e => !e.cancelled &&
        (!e.eligible || e.eligible()) && this.hasSlot(e) &&
        (e.priority >= 90 || !this.env.hidden()));
      if (index < 0) {
        // One deadline timer for eligible host cooldowns; no idle polling.
        const now = this.env.now(); let deadline = Infinity;
        for (const e of this.queue) if (!e.cancelled && (!e.eligible || e.eligible()) && (e.priority >= 90 || !this.env.hidden())) {
          const host = this.hostFor(e); if (host.until > now) deadline = Math.min(deadline, host.until);
        }
        if (Number.isFinite(deadline)) this.wakeTimer = this.env.setTimeout(() => this.pump(), deadline - now + 1);
        break;
      }
      const entry = this.queue.splice(index, 1)[0];
      if (!this.budget.consume(entry.url)) { entry.status = 'failed'; entry.reason = 'Retry limit reached. Try again after a short pause.'; this.emit(entry); continue; }
      this.load(entry);
    }
  }
  hasSlot(entry) {
    const lane = this.transferLane(entry), host = this.hostFor(entry);
    if (this.env.now() < host.until) return false;
    if (this.activeLanes[lane] >= (lane === 'thumbnail' ? this.settings.concurrency : entry.priority >= 90 ? 3 : 2)) return false;
    if (host.constrained && host.thumbnail + host.large >= Math.min(host.limit, this.settings.concurrency)) return false;
    // Ordinary large images have their own bounded lane. A hover can use one
    // extra host slot without displacing active thumbnail pixels.
    return lane === 'thumbnail' ? host.thumbnail < Math.min(host.limit, this.settings.concurrency) :
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
    if (entry.hostSampled || outcome !== 'error' && (this.env.hidden() || entry.hostTimingIgnored)) return;
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
  load(entry) {
    this.active++; entry.released = false; entry.attempts++; entry.status = 'loading';
    entry.started = this.env.now(); entry.cancelled = false;
    entry.activeLane = this.transferLane(entry); entry.hostState = this.hostFor(entry);
    entry.hostGeneration = entry.hostState.generation; entry.hostSampled = false;
    entry.hostTimingIgnored = this.env.hidden();
    this.activeLanes[entry.activeLane]++; entry.hostState[entry.activeLane]++;
    const image = entry.target || new this.env.Image(); entry.image = image;
    const loadVersion = entry.loadVersion = (entry.loadVersion || 0) + 1;
    entry.displayURL = null; entry.cacheResult = null; entry.cacheHit = false;entry.cacheBytes=0;
    const timeoutMs = this.transferLane(entry) === 'large' ? entry.fullTimeoutMs : entry.timeoutMs;
    image.decoding = 'async'; image.fetchPriority = entry.priority >= 50 ? 'high' : 'low';
    let url = entry.candidates[entry.candidateIndex] || entry.url;
    const repeated = entry.lastCandidate === url;
    entry.lastCandidate = url;
    const cacheFresh = !!entry.bustFirst || !!entry.cacheFresh || !!entry.cacheFault || repeated;
    if (repeated || entry.bustFirst) url = retryURL(url, this.env.now() + '-' + entry.sequence);
    entry.bustFirst = false; entry.actualURL = url;
    const failed = (reason, outcome = 'error') => {
      if (entry.cancelled || entry.status === 'ready' || entry.status === 'failed') return;
      entry.abortTransfer?.(); entry.abortTransfer = null;
      if (entry.cacheHit) { void this.env.imageCache?.remove(entry.actualURL); entry.cacheFault = true; }
      this.hostFeedback(entry, outcome); this.clearTimers(entry); this.release(entry); image.onload = image.onerror = null;
      image.removeAttribute?.('src');
      const before = entry.candidateIndex;
      if (entry.candidateIndex + 1 < entry.candidates.length) entry.candidateIndex++;
      else if (this.settings.legacyFallback) {
        const original = legacyOriginal(entry.url);
        if (original && !entry.candidates.includes(original)) { entry.candidates.push(original); entry.candidateIndex = entry.candidates.length - 1; }
      }
      if (!entry.singleAttempt && this.budget.get(entry.url).attempts < this.settings.maxRetries + 1) {
        entry.status = 'retrying'; entry.reason = reason;
        this.emit(entry);
        if (entry.cancelled || this.disposed) { this.pump(); return; }
        const timer = this.env.setTimeout(() => {
          if (entry.cancelled || this.disposed) return;
          entry.status = 'queued'; this.queue.push(entry); this.emit(entry); this.pump();
        }, entry.candidateIndex !== before ? 0 : Math.min(4000, 700 * 2 ** (entry.attempts - 1)));
        entry.timers.push(timer);
      } else {
        if (entry.rescue) this.budget.get(entry.url).attempts = this.settings.maxRetries + 1;
        entry.status = 'failed'; entry.reason = reason; this.emit(entry);
      }
      this.pump();
    };
    image.onload = () => {
      if (entry.cancelled) return;
      if (!image.naturalWidth) { failed('The image could not be displayed.'); return; }
      this.hostFeedback(entry, 'success'); this.clearTimers(entry); this.release(entry);
      entry.dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      // Completed loads begin a new failure streak. Retain manual/rescue guards,
      // but do not charge later cache misses for earlier successful transfers.
      this.budget.get(entry.url).attempts = 0;
      if(entry.cacheResult){entry.cacheBytes=entry.cacheResult.blob?.size||0;this.env.imageCache.recordActivity?.(entry.cacheResult.hit?'hit':'download',entry.cacheBytes);}
      if (entry.cacheResult && !entry.cacheResult.hit) void this.env.imageCache.commit(entry.actualURL, entry.cacheResult.blob, entry.cacheResult.epoch, entry.cacheResult.kind);
      entry.cacheResult = null; entry.abortTransfer = null;
      entry.status = 'ready'; entry.reason = ''; this.emit(entry); this.pump(); this.trim();
    };
    image.onerror = () => {
      if (entry.cancelled || entry.loadVersion !== loadVersion) return;
      if (entry.displayURL?.startsWith('data:')) {
        // Corrupt saved bytes or a page CSP must never break ordinary images.
        if (entry.cacheHit && !this.env.imageCache.displayBlocked) {
          this.env.imageCache.recordActivity?.('miss');void this.env.imageCache.remove(entry.actualURL);
        }
        entry.cacheFault = true; entry.cacheDisabled = true; entry.cacheHit = false; entry.cacheResult = null;
        entry.abortTransfer?.(); entry.abortTransfer = null;
        entry.displayURL = url; image.src = url; return;
      }
      failed('The image request failed.');
    };
    entry.timers.push(this.env.setTimeout(() => {
      if (entry.cancelled || entry.status !== 'loading') return;
      if (image.naturalWidth) {
        entry.dimensions = { width: image.naturalWidth, height: image.naturalHeight };
        entry.status = 'streaming'; entry.reason = 'The full image is still loading.';
      } else { this.hostFeedback(entry, 'slow'); entry.status = 'stalled'; entry.reason = 'Still waiting for the image host.'; }
      this.emit(entry); this.pump();
    }, this.settings.stallMs));
    entry.timers.push(this.env.setTimeout(() => {
      if (entry.cancelled || entry.status === 'ready') return;
      if (image.naturalWidth) {
        // Preserve a usable progressive image/animation. Do not wait for decode(),
        // which waits for every frame of an animation before resolving.
        entry.dimensions = { width: image.naturalWidth, height: image.naturalHeight };
        entry.hostSampled = true; entry.status = 'partial'; this.release(entry); this.emit(entry); this.pump();
      } else failed('The image did not respond in time.', 'timeout');
    }, timeoutMs));
    this.emit(entry);
    if (entry.cancelled || this.disposed) return;
    const assign = displayURL => {
      if (entry.cancelled || this.disposed || entry.loadVersion !== loadVersion || entry.image !== image) return;
      entry.displayURL = displayURL;
      if (image.dataset) image.dataset.epImageSource = url;
      image.src = displayURL;
    };
    if (entry.cacheMode && !entry.cacheDisabled && this.env.imageCache?.enabled()) {
      entry.abortTransfer = this.env.imageCache.load(url, {
        kind: entry.cacheMode === 'thumbnail' ? 'thumbnail' : 'preview',
        network: entry.cacheMode === 'network' || entry.cacheMode === 'thumbnail' &&
          (this.transferLane(entry) === 'thumbnail' || !/\.gif(?:\?|$)/i.test(url)),
        candidates: entry.cacheMode === 'thumbnail' && entry.smallFirst ? entry.candidates.slice(entry.candidateIndex + 1) : [],
        fresh: cacheFresh
      }, result => {
        if (entry.cancelled || this.disposed || entry.loadVersion !== loadVersion || entry.image !== image) return;
        if (!result) { assign(url); return; }
        if (result.failure) { failed('The image host returned HTTP ' + result.status + '.'); return; }
        entry.cacheHit = result.hit; entry.cacheResult = result;
        if (result.hit) {
          entry.hostTimingIgnored = true;
          if (result.key) {
            url = result.key; entry.actualURL = url; entry.lastCandidate = url;
            entry.candidateIndex = Math.max(0, entry.candidates.findIndex(candidate => canonicalImageURL(candidate) === url));
          }
        }
        assign(result.dataURL);
      });
    } else assign(url);
    // A bounded check on active requests only, not a scan of the page. Image
    // elements have no byte-progress event, and metadata can arrive before load.
    const firstFrame = () => {
      if (entry.cancelled || ['ready', 'failed', 'partial'].includes(entry.status)) return;
      if (image.naturalWidth) {
        entry.dimensions = { width: image.naturalWidth, height: image.naturalHeight };
        entry.status = 'streaming'; entry.reason = 'The full image is still loading.'; this.emit(entry);
      } else entry.timers.push(this.env.setTimeout(firstFrame, 160));
    };
    entry.timers.push(this.env.setTimeout(firstFrame, 80));
  }
  release(entry) { if (!entry.released) { entry.released = true; this.active = Math.max(0, this.active - 1);
    this.activeLanes[entry.activeLane]--; entry.hostState[entry.activeLane]--; } }
  clearTimers(entry) { for (const timer of entry.timers) this.env.clearTimeout(timer); entry.timers = []; }
  cancel(entry) {
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
        const budget = this.budget.get(entry.url);
        budget.attempts = Math.max(entry.rescue ? entry.rescueBase : 0, budget.attempts - 1);
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
    this.hosts.clear();
  }
}
