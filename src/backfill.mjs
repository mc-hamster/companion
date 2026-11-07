// SPDX-License-Identifier: GPL-3.0-or-later
// Backfill behavior contributed by mc-hamster; integrated with Companion's
// existing filtering/media controllers. See THIRD_PARTY.md for pinned sources.
import { parseOverlayDefinitions, safeImageURL } from './core.mjs';
import { companionIcon } from './workspace.mjs';

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

export function backfillRetryAfter(value, now = Date.now()) {
  if (typeof value !== 'string' || !value.trim()) return 0;
  const raw = value.trim();
  const ms = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now;
  return Number.isFinite(ms) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER - now, ms)) : 0;
}

export function backfillURL(value, base, search = base) {
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

export function nextBackfillURL(source, current, search, loaded = new Set()) {
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

export function torrentID(row, base) {
  for (const link of row.querySelectorAll('a[href]')) {
    try {
      const url = new URL(link.getAttribute('href'), base), id = url.searchParams.get('id');
      if (url.origin === new URL(base).origin && url.pathname === '/torrents.php' &&
          !url.searchParams.has('action') && /^\d{1,15}$/.test(id || '')) return id;
    } catch {}
  }
  return null;
}

export class BackfillController {
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
    this.app.contextActions.append(this.button);
    this.app.toolbarStatus.append(this.status);
    this.sync();
  }
  sync() {
    if (!this.button || this.disposed) return;
    const available = this.supported();
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
  }
}
