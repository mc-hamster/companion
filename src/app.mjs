// SPDX-License-Identifier: GPL-3.0-or-later
import { DEFAULTS, validateSettings, escapeHTML, safeImageURL, canonicalImageURL,
  legacyOriginal, fullSizeURL, thumbnailCandidates, parseOverlayDefinitions,
  imageState, editableTarget, SEARCH_NAMES, validateSearches, MediaPool } from './core.mjs';
import { mountFilterControls, adoptRuleMenu, styleRowControls, applyWorkspaceTheme, adoptNotificationControls, optionGroup, setupSettingsSearch } from './workspace.mjs';
import { PreferencesController, captureFilterBaseline, restoreFilterBaseline } from './preferences.mjs';
import { BackfillController } from './backfill.mjs';
import { OnboardingController } from './onboarding.mjs';
import { PersistentImageCache, cacheBytes, cacheActivityWindows } from './image-cache.mjs';
import { createSavedSearchEditor } from './search-editor.mjs';
import { VersionGroups, TagHighlights } from './result-tools.mjs';
import { ResultGrid, gridCardSizeChoices } from './grid-view.mjs';
import { coalesceScanRoots, presentationMutation, mutationChangesResults } from './scheduling.mjs';

const SETTINGS_KEY = 'ep.settings';
const SEARCH_KEY = 'ep.searches';
const OWN = '.epc-root,.epc-thumbnail,.epc-cover-image,.epc-cover-status,.epc-media-retry,.epc-engine,.epc-version-control,.epc-version-columns,#nseOuter,#nseFloatyBoi';
const searchSignature = fields => JSON.stringify(fields.map(field => [field.name, field.type, field.value, !!field.checked]));

export function captureSearch(form) {
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

export function applySearch(form, saved, append = false) {
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

export class CompanionApp {
  constructor(win, storage, options = {}) {
    this.win = win; this.doc = win.document; this.storage = storage; this.options = options;
    const storedSettings = storage.get(SETTINGS_KEY, {});
    const savedSettings = storedSettings && typeof storedSettings === 'object' ? { ...storedSettings } : {};
    this.hasExistingPreferences = Object.keys(savedSettings).length > 0 || storage.list().some(key => key.startsWith('nse'));
    this.onboardingComplete = storage.get('ep.onboardingDone', false) === true;
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
    this.log.push({ time: new Date().toISOString(), type: 'application', message: text.slice(0, 240) });
    this.log = this.log.slice(-200);
    if (this.notice) this.notice.textContent = text;
  }
  record(entry, kind) {
    if (!this.settings.diagnostics) return;
    if (!this.assetIds.has(entry.url)) this.assetIds.set(entry.url, ++this.nextAssetId);
    const url = new URL(entry.url);
    this.log.push({ time: new Date().toISOString(), asset: this.assetIds.get(entry.url), host: url.host,
      kind, state: entry.status, attempts: entry.attempts,
      elapsedMs: entry.started ? Date.now() - entry.started : 0,
      legacyResize: !!legacyOriginal(entry.url), dimensions: entry.dimensions });
    this.log = this.log.slice(-200);
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
    this.on(this.win, 'focus', () => this.refreshSavedSearches());
    this.on(this.doc, 'visibilitychange', () => {
      if(this.doc.hidden)this.cancelCacheUsage();
      else{this.refreshSavedSearches();void this.refreshCacheUsage();}
    });
    this.observer = new this.win.MutationObserver(mutations => {
      if (this.media.coverGatePending) this.media.syncCoverGate();
      if (!this.filtersReady) { if (!this.mounted && this.doc.body) this.mount(); return; }
      let removed = false;
      for (const mutation of mutations) {
        if (mutation.target.nodeType === 1 && mutation.target.closest?.(OWN)) continue;
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
    this.on(this.doc, 'DOMContentLoaded', () => { this.mount(); this.schedule(this.doc.body); });
    this.on(this.win, 'pageshow', event => { if (event.persisted && this.doc.body) this.schedule(this.doc.body); });
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
    this.root.setAttribute('aria-label', 'Empornium Companion');
    this.toolbar = this.node('header', null, 'epc-toolbar');
    this.launcher = this.node('strong', 'Companion', 'epc-brand');
    this.filterSummary = this.node('span', '', 'epc-result-summary');
    this.toolbar.append(this.launcher, this.filterSummary);
    this.panel = this.node('section', null, 'epc-panel'); this.panel.hidden = true;
    const heading = this.node('header', null, 'epc-panel-heading');
    this.paneHeading = this.node('strong', 'Companion');
    heading.append(this.paneHeading, this.button('Close', () => this.closePane()));
    this.panel.append(heading);
    this.panes = {}; this.paneButtons = new Map();
    const navigation = this.node('nav', null, 'epc-navigation'); navigation.setAttribute('aria-label', 'Companion tools');
    for (const [key, title] of [['filters', 'Filters'], ['searches', 'Searches'], ['images', 'Images'], ['settings', 'Settings']]) {
      const pane = this.node('section', null, 'epc-pane'); pane.hidden = true;
      pane.dataset.pane = key; pane.id = 'epc-pane-' + key;
      const button = this.button(title, () => this.openPane(key));
      button.dataset.pane = key; button.setAttribute('aria-controls', pane.id); button.setAttribute('aria-expanded', 'false');
      this.paneButtons.set(key, button); this.panes[key] = pane;
      if (key !== 'images') navigation.append(button);
      this.panel.append(pane);
    }
    this.toolbar.append(navigation);
    this.notice = this.node('p', '', 'epc-notice'); this.notice.setAttribute('role', 'status');
    this.health = this.node('span', '', 'epc-health');
    this.toggleFiltered = this.button('Show filtered', () => {
      this.revealingFiltered = !this.revealingFiltered;
      this.toggleFiltered.setAttribute('aria-pressed', String(this.revealingFiltered));
      this.toggleFiltered.textContent = this.revealingFiltered ? 'Hide filtered' : 'Show filtered';
      this.syncGridFilters(); this.media.demandListener?.();
    });
    this.toggleFiltered.setAttribute('aria-pressed', 'false');
    this.toolbar.append(this.toggleFiltered, this.health);
    this.grid.mount();
    this.backfill.mount();
    this.panes.filters.append(this.node('p', 'Loading filter preferences…', 'epc-filter-placeholder'));
    this.panes.searches.append(this.node('p', 'Click a name to run its search. More lets you edit saved criteria here.', 'epc-caption'));
    const displaySection=this.node('section',null,'epc-settings-section');displaySection.dataset.settingsGroup='Appearance';
    displaySection.append(this.node('h3','Appearance'));
    const settings = this.node('div', null, 'epc-basic-settings');displaySection.append(settings);
    this.basicAppearance = this.node('div'); settings.append(this.basicAppearance);
    const browsingSection=this.node('section',null,'epc-settings-section');browsingSection.dataset.settingsGroup='Browsing';browsingSection.append(this.node('h3','Browsing'));
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
    resetUsage.title='Reset activity and savings in every time window. Saved images stay in the cache.';
    cacheHeading.append(this.node('strong','Image cache'));this.cacheUsage.append(cacheHeading);
    this.cacheDetails=optionGroup(this,this.cacheUsage,'Statistics & storage',{key:'cache-details'});
    const cacheActions=this.node('div',null,'epc-actions');cacheActions.append(resetUsage);resetUsage.dataset.optionItem='';
    const usageList=this.node('dl');this.cacheUsageFields={};
    for(const[key,label]of[['thumbnails','Thumbnails'],['previews','Previews']]){
      const row=this.node('div'),value=this.node('dd','—');row.append(this.node('dt',label),value);usageList.append(row);this.cacheUsageFields[key]=value;
    }
    this.cacheUsageFields.total=this.node('p','Reading saved images…','epc-caption');
    this.cacheUsageFields.activity=this.node('p','','epc-caption');
    this.cacheActivityTable=this.node('table',null,'epc-cache-activity');this.cacheActivityTable.setAttribute('aria-label','Cache activity');
    this.cacheActivityTable.title='Hits: usable memory/saved-image reuse. Misses: managed lookups with no usable saved image, including failed downloads; forced bypass and unsupported/disabled caching are excluded. Downloads: successful managed transfers. Recent windows have 5-second precision. All history is since tracking began or Reset stats. Clearing saved images keeps history.';
    const activityHead=this.node('thead'),headRow=this.node('tr');
    for(const label of['Period','Hits','Misses','Hit rate','Downloads','Saved']){const cell=this.node('th',label);cell.scope='col';if(label==='Hit rate')cell.title='Hits ÷ (hits + misses). Downloads are excluded.';if(label==='Saved')cell.title='Estimated image data reused from cache, not measured network traffic. ≥ means some hits have unknown sizes; — means no sizes are known yet.';headRow.append(cell);}activityHead.append(headRow);
    const activityBody=this.node('tbody');this.cacheActivityRows={};
    for(const[key,label]of[['five','5 min'],['fifteen','15 min'],['hour','1 hour'],['all','All history']]){
      const row=this.node('tr'),heading=this.node('th',label);heading.scope='row';row.append(heading);this.cacheActivityRows[key]={};
      for(const name of['hits','misses','hitRate','downloads','savedBytes']){const cell=this.node('td','—');this.cacheActivityRows[key][name]=cell;row.append(cell);}activityBody.append(row);
    }
    this.cacheActivityTable.append(activityHead,activityBody);
    this.cacheUsage.insertBefore(this.cacheUsageFields.total,this.cacheDetails);
    this.cacheDetails.append(usageList,this.cacheActivityTable,this.cacheUsageFields.activity,cacheActions);
    this.cacheDetails.addEventListener('toggle',()=>{if(this.cacheDetails.open)void this.refreshCacheUsage();else{this.win.clearTimeout(this.cacheUsageClock);this.cacheUsageClock=null;}});
    this.cacheUsage.dataset.settingsGroup='Image cache';this.cacheActivityTable.dataset.optionItem='';
    this.panes.settings.append(this.cacheUsage);
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
    this.controls = new Map();
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
      ['gridLargeImages', 'Automatically load larger images in grid view', 'checkbox'],
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
      ['progressBar', 'Thumbnail progress bar', 'checkbox'],
      ['navigationScope', 'Arrow key pagination', ['off', 'results', 'site']],
      ['diagnostics', 'Keep a local diagnostic history', 'checkbox'],
      ['backfillEnabled', 'Show Backfill results action', 'checkbox'],
      ['backfillMode', 'Load more pages', ['off', 'pages', 'all']],
      ['backfillPages', 'Additional pages per batch', 'number', 1, 15],
      ['groupVersions', 'Group alternate video versions', 'checkbox']
    ];
    for (const [key, label, type, min, max] of schema) {
      const row = this.node('label', null, 'epc-setting');
      row.dataset.optionItem = ''; row.append(this.node('span', label));
      const control = this.node(Array.isArray(type) ? 'select' : 'input');
      if (Array.isArray(type)) {
        for (const value of type) {
          const label = key === 'thumbnailMode' ? ({ auto: 'Small first', supplied: 'Page preview', original: 'Full original' })[value] :
            key === 'navigationScope' ? ({ off: 'Off', results: 'Results only', site: 'Across site' })[value] :
            key === 'backfillMode' ? ({ off: 'When I click Backfill', pages: 'Automatically load a few pages', all: 'Automatically load all pages' })[value] :
            key === 'resultsView' ? ({ list: 'List', grid: 'Grid' })[value] : value;
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
      if(type==='checkbox')row.classList.add('epc-setting-toggle');
      const parent = ['thumbnailSize','previews','resultsView','gridCardWidth','gridLargeImages'].includes(key) ? settings : ['backfillMode','backfillPages','groupVersions'].includes(key)?browsing :
        ['persistentImages','persistentCacheMB'].includes(key)?this.cacheDetails:key.startsWith('backfill') ? this.optionGroups.results :
        key === 'diagnostics' ? this.optionGroups.diagnostics : key === 'navigationScope' ? this.optionGroups.interaction :
        imageKeys.has(key) ? this.optionGroups.images : this.optionGroups.loading;
      parent.append(row);
      if(type==='checkbox'&&(parent===settings||parent===browsing))row.prepend(control);
    }
    settings.append(this.controls.get('previews').closest('label'));
    settings.append(this.node('p', 'Grid cards show thumbnails first, then optionally load larger images. Card width is separate from list thumbnail width; larger images use more data.', 'epc-caption'));
    this.syncSettingsUI();
    const retry = this.button('Retry visible images', () => this.media.retryVisible()); retry.dataset.optionItem = '';
    this.optionGroups.loading.append(retry);
    const cacheStatus=this.node('p','Saved thumbnails and previews stay until you clear them or storage needs space.','epc-caption');
    const clearSaved=this.button('Clear saved images',async()=>{
      try{this.cancelCacheUsage();await this.imageCache.clear();cacheStatus.textContent='Saved image cache cleared. Images already on this page stay visible.';void this.refreshCacheUsage();}
      catch{cacheStatus.textContent='Browser image storage is unavailable.';}
    });clearSaved.dataset.optionItem='';this.cacheDetails.append(cacheStatus,clearSaved);
    const backup = optionGroup(this, this.panes.settings, 'Backup & restore', { key: 'backup',searchable:true });
    const picker = this.node('input'); picker.type = 'file'; picker.accept = '.json,application/json';
    picker.setAttribute('aria-label', 'Import companion or legacy settings JSON');
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
      this.button('Export everything', () => {
        this.download('empornium-companion-backup.json', JSON.stringify(this.exportData(), null, 2));
      }), picker,
      this.button('Restore previous import', () => {
        const previous = this.storage.get('ep.previousImport', null);
        if (!previous) { this.toast('No previous import is available.'); return; }
        try { this.importData(JSON.stringify(previous), false); this.toast('Previous data restored. Your preferences are active.'); }
        catch (e) { this.toast(e.message); }
      })
    );
    for(const item of backup.querySelectorAll('button,input'))item.dataset.optionItem='';
    const setupHelp=this.button('Getting started',()=>this.onboarding.show());setupHelp.classList.add('epc-settings-help');this.panes.settings.append(setupHelp);
    const diagnostics = this.optionGroups.diagnostics;
    this.diagnosticList = this.node('pre', '', 'epc-log');
    diagnostics.append(this.button('Show recent events', () => {
      this.diagnosticList.textContent = this.log.length ? JSON.stringify(this.log.slice(-30), null, 2) : 'No events recorded. Enable local diagnostic history in settings.';
    }), this.button('Export diagnostic history', () => this.download('empornium-image-diagnostics.json', JSON.stringify(this.log, null, 2))),
    this.button('Clear history', () => { this.log = []; this.diagnosticList.textContent = ''; }), this.diagnosticList);
    for (const button of diagnostics.querySelectorAll('button')) button.dataset.optionItem = '';
    this.saveBar = this.node('footer', null, 'epc-savebar');
    this.saveStatus = this.node('span', 'Changes save automatically', 'epc-caption');
    this.saveStatus.setAttribute('role', 'status');
    this.undoPreferences = this.button('Undo changes', () => this.preferences.undo());
    this.undoPreferences.hidden = !this.preferences.checkpoint;
    this.saveBar.append(this.saveStatus, this.undoPreferences); this.panel.append(this.saveBar);
    this.savedShortcuts = this.node('nav', null, 'epc-saved-shortcuts');
    this.savedShortcuts.setAttribute('aria-label', 'Saved searches'); this.savedShortcuts.hidden = true;
    this.root.append(this.toolbar, this.savedShortcuts, this.notice, this.panel); this.doc.body.append(this.root);
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
    this.progress = this.node('div', null, 'epc-root epc-progress'); this.progress.hidden = true;
    this.progress.setAttribute('role', 'progressbar'); this.progress.setAttribute('aria-label', 'Thumbnails ready');
    this.progressBar = this.node('div'); this.progress.append(this.progressBar); this.doc.body.append(this.progress);
    this.preview.build();
  }
  attachWorkspace() {
    if (!this.root) return;
    const anchor = this.doc.querySelector('#search_box') || this.doc.querySelector('#content h2');
    const table = this.doc.querySelector('#content .torrent_table,#content .torrent_grid');
    if (anchor && this.workspaceAnchor !== anchor) { anchor.after(this.root); this.workspaceAnchor = anchor; }
    else if (!anchor && table && this.workspaceAnchor !== table) { table.before(this.root); this.workspaceAnchor = table; }
  }
  openPane(key) {
    if (key === 'images') key = 'settings';
    this.preferences.flush();
    if (!this.panes?.[key]) return;
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
    this.storage.set('ep.searchDrawerOpen', key === 'searches');
    if(key==='settings')void this.refreshCacheUsage();
    else this.cancelCacheUsage();
    this.media.demandListener?.();
  }
  cancelCacheUsage(){this.win.clearTimeout(this.cacheUsageTimer);this.win.clearTimeout(this.cacheUsageClock);this.cacheUsageTimer=this.cacheUsageClock=null;this.cacheUsageSnapshot=null;this.cacheUsageVersion=(this.cacheUsageVersion||0)+1;}
  syncSettingsUI(){
    const mode=this.controls?.get('backfillMode')?.value,pages=this.controls?.get('backfillPages');if(!pages)return;
    const row=pages.closest('[data-option-item]');row.querySelector('span').textContent=mode==='off'?'Pages per click':'Additional pages';
    const searching=!!this.settingsSearch?.value.trim();if(!searching)row.hidden=mode==='all';
    if(mode==='all'&&!pages.checkValidity())pages.value=this.settings.backfillPages;
    if(this.cacheUsage?.hidden){this.win.clearTimeout(this.cacheUsageClock);this.cacheUsageClock=null;}
  }
  scheduleCacheUsage(){
    if(this.disposed||this.doc.hidden||this.activePane!=='settings'||this.panel?.hidden||this.cacheUsageTimer)return;
    this.cacheUsageTimer=this.win.setTimeout(()=>{this.cacheUsageTimer=null;void this.refreshCacheUsage();},250);
  }
  async refreshCacheUsage(){
    if(this.disposed||this.doc.hidden||this.activePane!=='settings'||this.panel?.hidden||!this.cacheUsage)return;
    this.win.clearTimeout(this.cacheUsageTimer);this.cacheUsageTimer=null;
    const version=this.cacheUsageVersion=(this.cacheUsageVersion||0)+1;this.cacheUsage.setAttribute('aria-busy','true');
    let s;try{s=await this.imageCache.summary?.();}catch{}
    if(this.disposed||this.doc.hidden||version!==this.cacheUsageVersion||this.activePane!=='settings'||this.panel.hidden)return;
    const fields=this.cacheUsageFields;
    this.cacheUsage.setAttribute('aria-busy','false');
    if(!s?.available){fields.thumbnails.textContent=fields.previews.textContent='—';fields.total.textContent='Saved image storage unavailable.';fields.activity.textContent='';this.cacheActivityTable.hidden=true;this.win.clearTimeout(this.cacheUsageClock);this.cacheUsageClock=null;this.cacheUsageSnapshot=null;return;}
    fields.thumbnails.textContent=s.thumbnailCount.toLocaleString()+' · '+cacheBytes(s.thumbnailFileBytes);
    fields.previews.textContent=s.previewCount.toLocaleString()+' · '+cacheBytes(s.previewBytes);
    fields.total.textContent=cacheBytes(s.bytes)+' of '+cacheBytes(s.limitBytes)+' used'+(s.saving?'':' · Saving off');
    this.cacheUsageSnapshot=s;this.renderCacheActivity();
  }
  renderCacheActivity(){
    this.win.clearTimeout(this.cacheUsageClock);this.cacheUsageClock=null;
    const s=this.cacheUsageSnapshot;if(!s||this.disposed||this.doc.hidden||this.activePane!=='settings'||this.panel.hidden||this.cacheUsage.hidden)return;
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
    if(this.cacheDetails.open&&s.recent?.some(row=>row[0]+5000>now-3600000))this.cacheUsageClock=this.win.setTimeout(()=>this.renderCacheActivity(),5000);
  }
  closePane() {
    this.preferences.flush();
    const trigger = this.paneButtons.get(this.activePane);
    this.panel.hidden = true; this.activePane = null;
    this.cancelCacheUsage();
    for (const button of this.paneButtons.values()) button.setAttribute('aria-expanded', 'false');
    this.storage.set('ep.searchDrawerOpen', false); trigger?.focus();
    this.media.demandListener?.();
  }
  markDirty(target, event) { this.preferences.changed(target, event); this.refreshOptionSummaries?.(); }
  applyChanges() { return this.preferences.flush(); }
  captureFilterBaseline() { this.versions?.captureOrder(); captureFilterBaseline(this); }
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
    this.grid?.refresh();
    this.backfill?.sync();
    this.backfill?.maybeAutomatic();
    if(previous.persistentCacheMB!==this.settings.persistentCacheMB)void this.imageCache.prune(this.imageCache.limit());
    if (previous.groupVersions !== this.settings.groupVersions) {
      this.syncGridFilters(false); this.media.prepareThumbnails(); this.updateHealth();
    }
    if (previous.favoriteTags !== this.settings.favoriteTags || previous.cautionTags !== this.settings.cautionTags) this.tags.refresh();
    const other = new Set(['groupVersions', 'favoriteTags', 'cautionTags', 'backfillEnabled', 'backfillPages', 'backfillMode',
      'navigationScope', 'globalArrowNavigation', 'diagnostics', 'persistentImages', 'persistentCacheMB']);
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
      this.panes.filters.replaceChildren(this.node('p', 'Filtering is available on torrent lists and detail pages.'));
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
  importData(text, keepUndo = true, { completeOnboarding = false } = {}) {
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { throw new SyntaxError('The backup file is not valid JSON.'); }
    let searches, settings, nse, drawer;
    if (Array.isArray(parsed)) searches = validateSearches(parsed);
    else if (!parsed || typeof parsed !== 'object') throw new Error('Expected a JSON object or saved-search array.');
    else if (parsed.format === 'empornium-companion') {
      if (parsed.version !== 1) throw new Error('Unsupported backup version.');
      settings = validateSettings(parsed.settings);
      searches = validateSearches(parsed.searches);
      nse = this.options.validateNSE?.(parsed.nse || {}) || parsed.nse;
      drawer = !!parsed.searchDrawerOpen;
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
      for (const key of this.storage.list()) if (/^nse/.test(key)) changes.set(key, undefined);
      for (const [key, value] of Object.entries(nse)) changes.set(key, value);
    }
    if (!changes.size) throw new Error('No compatible settings were found.');
    this.preferences.cancel();
    const old = new Map(Array.from(changes.keys(), key => [key, this.storage.get(key, undefined)]));
    const previous = this.exportData();
    try {
      if (keepUndo) this.storage.set('ep.previousImport', previous);
      for (const [key, value] of changes) value === undefined ? this.storage.delete(key) : this.storage.set(key, value);
    } catch (error) {
      for (const [key, value] of old) {
        try { value === undefined ? this.storage.delete(key) : this.storage.set(key, value); } catch {}
      }
      throw error;
    }
    if (settings) {
      const before = this.settings; this.settings = settings;
      for (const [key, control] of this.controls || []) {
        if (control.type === 'checkbox') control.checked = settings[key]; else control.value = settings[key];
      }
      if (this.mounted) this.updateMediaPreferences(before);
    }
    if (nse && this.mounted) { this.refreshFilters(true); this.applyAppearance(); }
    if (searches) { this.searches = searches; this.renderSavedSearches(); }
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
      this.savedDrawer = this.node('div', null, 'epc-root epc-saved');
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
      const tools = this.node('div', null, 'epc-quick-search');
      this.quickSaveSearch = this.button('Save search', () => this.saveCurrentSearch());
      tools.append(this.quickSaveSearch); this.toolbar.insertBefore(tools, this.health);
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
    this.quickSaveSearch.textContent = saved ? 'Search saved' : 'Save search';
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
      this.savedShortcuts.replaceChildren(this.node('strong', 'Saved searches'));
      for (const saved of searches) {
        const link = this.searchLink(saved); link.className = 'epc-saved-shortcut';
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
            if(e.isComposing || this.composing) return;
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
    if (this.onboarding?.open) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' &&
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
    if (editableTarget(event.target) || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
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
  syncGridFilters(refreshTags = true) {
    const visibility = new Map(Array.from(this.removedFilterIDs, id => [id, true]));
    this.batchDOM(() => {
      for (const [row, marker] of this.detachedFilterRows) {
        if (!marker.isConnected) continue;
        if (this.revealingFiltered && !row.isConnected) {
          marker.after(row); this.schedule(row, false);
        } else if (!this.revealingFiltered && row.isConnected) this.detachFilteredRow(row);
      }
      for (const row of this.doc.querySelectorAll('tr.torrent')) {
        const filtered = row.getAttribute('isNSEHidden') === '1';
        const revealed = !!this.revealingFiltered && filtered;
        // Native themes may hide .hidden with a more specific !important rule.
        // Keep the filter identity in isNSEHidden; remove the native hiding class
        // while revealing, just as the site's own visibility toggle does.
        const wasRevealed = row.classList.contains('epc-revealed');
        const hidden = filtered && !revealed;
        if ((filtered || wasRevealed) && row.classList.contains('hidden') !== hidden) row.classList.toggle('hidden', hidden);
        if (wasRevealed !== revealed) row.classList.toggle('epc-revealed', revealed);
      }
    });
    for (const row of this.doc.querySelectorAll('tr.torrent')) {
      const link = row.querySelector('a[href*="torrents.php?id="]');
      if (!link) continue;
      const id = new URL(link.href).searchParams.get('id');
      visibility.set(id, !row.classList.contains('epc-revealed') && (row.classList.contains('hidden') || row.classList.contains('nseHardPassRemove')));
    }
    for (const card of this.doc.querySelectorAll('.torrent_grid__torrent')) {
      const link = card.querySelector('a[href*="torrents.php?id="]');
      const id = link && new URL(link.href).searchParams.get('id');
      if (visibility.has(id)) card.classList.toggle('epc-filter-hidden', visibility.get(id));
    }
    this.batchDOM(() => this.versions?.refresh()); this.grid?.refresh(); if (refreshTags) this.tags?.refresh();
    this.media?.scheduleGridUpgrades();
    if (this.filterSummary) {
      const rows = Array.from(this.doc.querySelectorAll('tr.torrent'));
      const removed = [...this.detachedFilterRows.keys()].filter(row => !row.isConnected).length;
      const filtered = rows.filter(row => row.getAttribute('isNSEHidden') === '1').length;
      const grouped = this.versions?.collapsed || 0;
      const shown = rows.filter(row => !row.hidden && !row.classList.contains('epc-version-hidden') &&
        (row.classList.contains('epc-revealed') || !row.classList.contains('nseHardPassRemove') && !row.classList.contains('hidden'))).length;
      this.resultCounts = { total: rows.length, shown, grouped, filtered, removed }; this.renderResultSummary();
      this.toggleFiltered.disabled = !filtered && !removed;
      this.toggleFiltered.hidden = !filtered && !removed || !this.storage.get('nseFloatingToggleButtonEnabled', true);
      styleRowControls(this);
    }
    this.backfill?.sync();
  }
  groupVisibilityChanged(difference) {
    if (this.resultCounts) {
      this.resultCounts.shown += difference; this.resultCounts.grouped -= difference; this.renderResultSummary();
    }
    this.scheduleHealth();
    this.media?.scheduleGridUpgrades();
  }
  renderResultSummary() {
    if (!this.resultCounts || !this.filterSummary) return;
    const { total, shown, grouped, filtered, removed } = this.resultCounts;
    const caption = total || removed ? shown + ' shown' + (grouped ? ' · ' + grouped + ' grouped' : '') +
      ' · ' + filtered + ' filtered' + (removed ? ' · ' + removed + ' removed' : '') : '';
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
  updateHealth() {
    if (!this.health) return;
    const counts = this.media.counts();
    this.health.textContent = counts.failed + ' failed · ' + counts.waiting + ' loading · ' + counts.deferred + ' deferred';
    const thumbs = Array.from(this.media.thumbnails.values()).filter(record =>
      !record.row.closest('.hidden:not(.epc-revealed),[hidden],.epc-filter-hidden,.epc-version-hidden'));
    const ready = thumbs.filter(t => t.state === 'ready' || t.state === 'partial').length;
    const busy = thumbs.some(t => ['loading', 'streaming', 'queued', 'retrying', 'stalled'].includes(t.state));
    this.progress.hidden = !this.settings.progressBar || !busy;
    this.progress.setAttribute('aria-valuemin', '0');
    this.progress.setAttribute('aria-valuemax', String(thumbs.length));
    this.progress.setAttribute('aria-valuenow', String(ready));
    this.progress.setAttribute('aria-valuetext', ready + ' of ' + thumbs.length + ' thumbnails ready');
    this.progressBar.style.width = thumbs.length ? ready / thumbs.length * 100 + '%' : '0%';
    this.launcher.title = 'Empornium Companion: ' + counts.failed + ' images need attention';
    if (thumbs.length) this.health.textContent = ready + '/' + thumbs.length + ' thumbnails' + (counts.failed ? ' · ' + counts.failed + ' need attention' : '');
    if (!this.settings.diagnostics) {
      this.health.hidden = !counts.failed && !busy;
      this.health.textContent = counts.failed ? counts.failed + (counts.failed === 1 ? ' image unavailable' : ' images unavailable') : 'Loading previews…';
      this.launcher.title = 'Empornium Companion';
    } else this.health.hidden = false;
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
    this.updateHealth();
    for (const [key, control] of this.controls) {
      if (control.type === 'checkbox') control.checked = this.settings[key]; else control.value = this.settings[key];
    }
    this.schedule(this.doc.body);
    applyWorkspaceTheme(this);
  }
  dispose() {
    this.disposed = true; this.observer?.disconnect(); this.backfill?.dispose(); this.preview?.dispose(); this.media?.dispose();
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
    this.root?.remove(); this.progress?.remove(); this.savedDrawer?.remove(); this.searchFeedback?.remove();
    this.doc.getElementById('nseRCMBox')?.remove();
  }
}

// Media and preview controllers follow; they share one request scheduler.

export class PageMedia {
  constructor(app) {
    this.app = app; this.win = app.win; this.doc = app.doc;
    this.definitions = new Map(); this.scriptText = new WeakMap(); this.knownVariants = new Map();
    this.records = new Map(); this.thumbnails = new Map(); this.near = new Map();
    this.nativeTimers = new Set(); this.disposed = false;
    this.syncCoverGate();
    this.pool = new MediaPool({
      Image: app.options.Image || this.win.Image, now: () => Date.now(),
      imageCache: app.imageCache,
      hostHistory: app.storage.get('ep.hostHistory', []), saveHosts: history => app.storage.set('ep.hostHistory', history),
      setTimeout: this.win.setTimeout.bind(this.win), clearTimeout: this.win.clearTimeout.bind(this.win),
      hidden: () => this.doc.hidden, report: error => app.report(error)
    }, app.settings);
    this.pool.listeners.add(entry => {
      app.record(entry, 'scheduled'); app.scheduleHealth();
      if (['ready','streaming','partial'].includes(entry.status)) app.preview?.acceptRecovered(entry);
    });
    const history = app.storage.get('ep.thumbnailHistory', []);
    this.thumbnailHistory = new Map((Array.isArray(history) ? history : []).filter(item =>
      Array.isArray(item) && item.length === 2 && typeof item[1] === 'object' && item[1] &&
      Date.now() - item[1].time < 7 * 86400000 && safeImageURL(item[1].src, this.win.location.href)));
    this.makeObserver();
    this.resizeListener = () => { this.makeObserver(); this.app.preview?.position(); };
    this.win.addEventListener('resize', this.resizeListener, { passive: true });
    this.demandListener = () => {
      if (this.demandPending) return;
      this.demandPending = true;
      this.win.requestAnimationFrame(() => {
        this.demandPending = false;
        if (this.disposed) return;
        for (const [target, callback] of this.near) if (this.visible(target, true)) callback();
        this.prepareThumbnails();
        this.pool.pump();
        this.planAutomaticRecovery();
      });
    };
    this.win.addEventListener('scroll', this.demandListener, { passive: true });
    this.doc.addEventListener('visibilitychange', this.demandListener);
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
    this.syncCoverGate();
    this.pool.settings = settings; this.pool.budget.maxRetries = settings.maxRetries;
    for (const [element, record] of this.records) if (record.kind === 'background' &&
        (!settings.recoverBackgrounds || record.coverArt && settings.thumbnailMode !== previous.thumbnailMode)) {
      this.clearRecord(record); this.clearCover(record); this.intersection?.unobserve(element); this.near.delete(element);
      this.records.delete(element); this.pool.abandon(record.lastEntry);
    }
    for (const [row, record] of this.thumbnails) {
      if (settings.resultsView !== previous.resultsView || settings.gridLargeImages !== previous.gridLargeImages ||
          settings.thumbnailMode !== previous.thumbnailMode || !this.thumbnailsEnabled(row)) this.clearGridUpgrade(record);
      if (!this.thumbnailsEnabled(row)) {
        record.unsubscribe?.(); this.intersection?.unobserve(record.element); this.near.delete(record.element);
        this.pool.abandon(record.lastEntry);
        record.element.remove(); this.thumbnails.delete(row); continue;
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
      const enteringGrid = settings.resultsView === 'grid' && previous.resultsView !== 'grid';
      if (settings.thumbnailMode !== previous.thumbnailMode || enteringGrid &&
          !record.lastEntry?.key.endsWith('|thumbnail:auto') && !['ready', 'partial'].includes(record.state)) {
        record.unsubscribe?.(); record.unsubscribe = null; this.pool.abandon(record.lastEntry);
        record.state = 'deferred'; this.loadThumbnail(record);
      }
    }
    if (settings.preloadScreens !== previous.preloadScreens) this.makeObserver();
    this.pool.trim(); this.pool.pump();
    this.scheduleGridUpgrades();
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
      Math.max(record.failedAt, this.pool.budget.get(record.source).last) + 31000));
    this.recoveryTimer = this.pool.env.setTimeout(() => this.resumeAutomaticRecovery(),
      Math.max(0, deadline - this.pool.env.now()));
  }
  resumeAutomaticRecovery(online = false) {
    if (this.disposed || !this.app.settings.maxRetries || this.doc.hidden || this.win.navigator.onLine === false) return;
    const now = this.pool.env.now();
    for (const record of this.failedRecords()) {
      if (!online && now < Math.max(record.failedAt, this.pool.budget.get(record.source).last) + 31000) continue;
      record.autoRecoveryAttempted = true;
      if (record.kind === 'image') this.recover(record, true, true, true);
      else if (record.kind === 'background') this.loadBackground(record, true, true);
      else this.loadThumbnail(record, true, true);
    }
    this.planAutomaticRecovery();
  }
  displayed(element) {
    if (!element?.isConnected || !element.getClientRects().length || element.closest('.hidden:not(.epc-revealed),[hidden],.epc-filter-hidden,.epc-version-hidden')) return false;
    const style = this.win.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }
  visible(element, ahead = false) {
    if (!this.displayed(element)) return false;
    const rect = element.getBoundingClientRect(), margin = ahead ? this.win.innerHeight * this.app.settings.preloadScreens : 0;
    return rect.bottom >= -margin && rect.top <= this.win.innerHeight + margin;
  }
  thumbnailPriority(record) {
    const rect = record.element.getBoundingClientRect(), height = Math.max(1, this.win.innerHeight);
    if (rect.bottom >= 0 && rect.top <= height) return 80;
    const distance = Math.max(rect.top - height, -rect.bottom, 0) / height;
    return distance <= this.app.settings.preloadScreens ? 40 - distance : 10 / (1 + distance);
  }
  prepareThumbnails(rows) {
    if (this.disposed || !this.app.filtersReady || this.doc.hidden) return;
    // Warm the current result list as slots finish, even when the user stays at
    // the top. Nearby rows lead; filtering and closed galleries still apply.
    const records = (rows ? rows.map(row => this.thumbnails.get(row)).filter(Boolean) : [...this.thumbnails.values()])
      .filter(record => this.thumbnailsEnabled(record.row) && record.state === 'deferred' && this.displayed(record.element));
    records.sort((a, b) => this.thumbnailPriority(b) - this.thumbnailPriority(a));
    for (const record of records) this.loadThumbnail(record);
    if (!rows && this.app.settings.recoverBackgrounds) {
      const covers = [...this.records.values()].filter(record => record.coverArt && record.state === 'deferred' && this.displayed(record.element));
      covers.sort((a,b)=>this.thumbnailPriority(b)-this.thumbnailPriority(a));
      for (const record of covers) this.loadBackground(record);
    }
    this.pool.pump();
    this.scheduleGridUpgrades();
  }
  thumbnailsEnabled(row) {
    return this.app.settings.inlineThumbnails || this.app.settings.resultsView === 'grid' &&
      (row ? row.closest('table')?.classList.contains('epc-result-grid') : true);
  }
  gridUpgradeEligible(record) {
    return !this.disposed && this.app.settings.enabled && this.app.settings.resultsView === 'grid' &&
      this.app.settings.gridLargeImages && this.app.filtersReady &&
      record.row.closest('table')?.classList.contains('epc-result-grid') && this.displayed(record.element);
  }
  scheduleGridUpgrades() {
    if (this.disposed || this.gridFrame || this.app.settings.resultsView !== 'grid' ||
        !this.app.settings.enabled || !this.app.settings.gridLargeImages) return;
    this.gridFrame = this.win.requestAnimationFrame(() => {
      this.gridFrame = null;
      if (this.disposed) return;
      const records = [...this.thumbnails.values()];
      for (const record of records) if (record.gridUpgrade && !this.gridUpgradeEligible(record)) this.clearGridUpgrade(record);
      if (this.doc.hidden) return;
      this.gridThumbnailsPending = records.some(record => this.thumbnailsEnabled(record.row) &&
        this.displayed(record.element) && !['ready', 'partial', 'failed'].includes(record.state));
      // Finish the thumbnail pass before spending slots on automatic originals.
      if (this.gridThumbnailsPending) return;
      for (const record of records) {
        if (record.state !== 'ready' || record.gridUpgrade || !this.gridUpgradeEligible(record)) continue;
        if (fullSizeURL(record.source) === canonicalImageURL(record.lastEntry.actualURL)) continue;
        this.loadGridUpgrade(record);
      }
      this.pool.pump();
    });
  }
  clearGridUpgrade(record) {
    const upgrade = record.gridUpgrade; if (!upgrade) return;
    record.gridUpgrade = null;
    upgrade.unsubscribe?.();
    if (upgrade.image) { upgrade.image.onload = upgrade.image.onerror = null; upgrade.image.remove(); }
    this.pool.abandon(upgrade.entry);
    record.image.hidden = false;
    record.status.hidden = record.state === 'ready' || record.state === 'partial';
    delete record.element.dataset.gridImage;
  }
  loadGridUpgrade(record) {
    const upgrade = { entry: null, unsubscribe: null, image: null }; record.gridUpgrade = upgrade;
    const active = () => record.gridUpgrade === upgrade && this.gridUpgradeEligible(record);
    const entry = this.pool.request(fullSizeURL(record.source), {
      lane: 'large', cacheMode: 'preview', priority: 15,
      priorityFor: () => Math.min(30, this.thumbnailPriority(record)),
      eligible: () => active() && !this.doc.hidden && !this.gridThumbnailsPending,
      target: this.app.options.Image ? null : this.app.node('img')
    });
    upgrade.entry = entry;
    if (!entry) { record.gridUpgrade = null; return; }
    const update = item => {
      if (!active()) return;
      record.element.dataset.gridImage = item.status;
      const fail = () => {
        record.element.dataset.gridImage = 'failed';
        record.status.textContent = 'Larger image unavailable · showing thumbnail'; record.status.hidden = false;
      };
      if (item.status === 'ready' && item.image?.naturalWidth) {
        if (upgrade.image) return;
        const adopt = item.image instanceof this.win.HTMLImageElement && !item.image.isConnected;
        const image = adopt ? item.image : this.app.node('img'); upgrade.image = image;
        const show = () => {
          if (!active()) return;
          image.onload = image.onerror = null; image.alt = ''; image.draggable = false; image.hidden = false;
          image.dataset.epImageSource = item.actualURL;
          record.image.after(image); record.image.hidden = true; record.status.hidden = true;
          // A preview must not move this live card image out of the page.
          if (image === item.image) item.target = image;
        };
        if (adopt) show();
        else {
          image.onload = show; image.onerror = fail; image.decoding = 'async';
          image.src = item.displayURL || item.actualURL;
          if (!(item.image instanceof this.win.HTMLImageElement)) show();
        }
      } else if (['failed', 'partial'].includes(item.status)) fail();
      else { record.status.textContent = 'Loading larger image…'; record.status.hidden = false; }
    };
    upgrade.unsubscribe = this.pool.subscribe(entry, update);
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
    if (def.thumbnail) {
      const key = fullSizeURL(def.src);
      if (!this.knownVariants.has(key)) this.knownVariants.set(key, new Set());
      this.knownVariants.get(key).add(def.thumbnail);
    }
  }
  scan(root) {
    if (this.disposed || !this.app.settings.enabled || root.closest?.(OWN)) return;
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
    if (!root.matches?.('img,source')) this.prepareThumbnails();
    this.app.scheduleHealth();
  }
  rememberVariant(src) {
    if (!/\.(th|md)\.[^/.?]+(?:\?|$)/i.test(src)) return;
    const key = fullSizeURL(src);
    if (!this.knownVariants.has(key)) this.knownVariants.set(key, new Set());
    this.knownVariants.get(key).add(src);
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
    if (this.thumbnails.has(row) || row.closest('#nseOuter')) return;
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
    const record = { element: host, row, image, status, link, source: definition.src, state: 'deferred', unsubscribe: null };
    this.thumbnails.set(row, record);
    if (this.app.settings.resultsView === 'grid') this.gridThumbnailsPending = true;
    // Hover offers a temporary enlargement; clicking either image opens controls.
    this.app.preview.bind(button, { ...definition, title: this.app.preview.titleOf(link), href: link.href });
    this.watchNear(host, () => this.loadThumbnail(record));
  }
  thumbnailOptions(source, rescueEntry, mode = this.app.settings.thumbnailMode) {
    const smallCandidates = (rescueEntry ? [...rescueEntry.smallCandidates] :
      [this.thumbnailHistory.get(canonicalImageURL(source))?.src,
        ...Array.from(this.knownVariants.get(fullSizeURL(source)) || [])].filter(Boolean))
      .filter(candidate => mode !== 'auto' || candidate !== fullSizeURL(source));
    const candidates = rescueEntry ? [canonicalImageURL(rescueEntry.actualURL)] :
      thumbnailCandidates(source, mode, smallCandidates);
    const smallFirst = /\.(?:th|md)\.[^/.?]+(?:\?|$)/i.test(candidates[0]) ||
      candidates[0] !== fullSizeURL(source) && smallCandidates.includes(candidates[0]);
    return { candidates, smallCandidates, smallFirst, cacheMode: 'thumbnail',
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
  loadThumbnail(record, force = false, rescue = false) {
    if (!force && record.state !== 'deferred') return;
    if (!this.app.filtersReady || this.disposed || !this.thumbnailsEnabled(record.row) || !this.displayed(record.element) || this.doc.hidden) return;
    this.clearGridUpgrade(record);
    if (this.app.settings.resultsView === 'grid') this.gridThumbnailsPending = true;
    const options = this.thumbnailOptions(record.source, rescue ? record.lastEntry : null,
      record.row.closest('table')?.classList.contains('epc-result-grid') ? 'auto' : this.app.settings.thumbnailMode);
    const { smallFirst } = options;
    const entry = this.pool.request(record.source, {
      ...options,
      priority: this.thumbnailPriority(record),
      priorityFor: () => this.thumbnailPriority(record),
      eligible: () => !this.disposed && this.app.filtersReady && this.thumbnailsEnabled(record.row) &&
        !this.doc.hidden && this.displayed(record.element),
      force,
      rescue, singleAttempt: rescue, fresh: rescue,
      // Use the real inline element: no detached preload followed by a second
      // assignment/transfer. The test Image adapter remains injectable.
      target: this.app.options.Image ? null : record.image
    });
    if (!entry) return;
    // Queued thumbnails use pool eligibility and distance priority. They no
    // longer need an intersection/scroll callback that reads their layout.
    this.near.delete(record.element); this.intersection?.unobserve(record.element);
    record.unsubscribe?.();
    const update = item => {
      if (this.disposed || !record.element.isConnected) return;
      record.state = item.status;
      this.trackRecovery(record, item);
      record.status.textContent = ({ queued: 'Waiting', loading: 'Loading', retrying: 'Retrying',
        stalled: 'Slow load', failed: record.autoRecoveryAttempted || !this.app.settings.maxRetries ? 'Unavailable' : 'Retrying soon',
        streaming: 'Loading', partial: '', ready: '' })[item.status] || '';
      if (item.image?.naturalWidth && ['streaming', 'partial', 'ready'].includes(item.status)) {
        const displayURL=item.displayURL||item.actualURL;
        if (record.image.getAttribute('src') !== displayURL) record.image.src = displayURL;
        record.image.dataset.epImageSource=item.actualURL;
        record.status.hidden = true;
      } else record.status.hidden = false;
      record.element.dataset.state = item.status;
      if (['ready', 'failed', 'partial'].includes(item.status)) { record.unsubscribe?.(); record.unsubscribe = null; }
      if (item.status === 'ready') this.rememberThumbnail(record,item);
      if (['ready', 'failed', 'partial'].includes(item.status)) this.scheduleGridUpgrades();
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
    this.app.preview?.unbind(record.link);
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
      const thumb = safeImageURL(element.getAttribute('data-thumbnail'), this.win.location.href);
      const resized = legacyOriginal(supplied) && Number(new URL(supplied).pathname.match(/\/resize\/(\d+)\//)?.[1]) <= 350;
      if (!this.knownVariants.has(source)) this.knownVariants.set(source, new Set());
      for (const value of [thumb, resized ? supplied : null].filter(Boolean)) this.knownVariants.get(source).add(value);
      const image = record.image = this.app.node('img'); image.className = 'epc-cover-image'; image.alt = ''; image.draggable = false; image.decoding = 'async';
      const status = record.status = this.app.node('span', 'Waiting', 'epc-cover-status'); status.setAttribute('aria-hidden','true');
      const position = this.win.getComputedStyle(element).position;
      if (!position || position === 'static') element.classList.add('epc-cover-positioned');
      element.classList.add('epc-managed-cover'); element.append(image,status); this.bindCover(record);
    } else this.watchNear(element, () => this.loadBackground(record));
  }
  loadBackground(record, force = false, rescue = false) {
    if (!force && record.state !== 'deferred') return;
    if (!this.app.filtersReady || this.disposed || !this.app.settings.recoverBackgrounds ||
        !(record.coverArt ? this.displayed(record.element) : this.visible(record.element, true)) || this.doc.hidden) return;
    const entry = this.pool.request(record.source, {
      ...(record.coverArt ? this.thumbnailOptions(record.originalSource, rescue ? record.lastEntry : null) : { lane: 'large' }),
      priority: record.coverArt ? this.thumbnailPriority(record) : this.visible(record.element) ? 30 : 5,
      ...(record.coverArt ? { priorityFor: () => this.thumbnailPriority(record), target: this.app.options.Image ? null : record.image } : {}), force,
      eligible: () => !this.disposed && this.app.settings.recoverBackgrounds && !this.doc.hidden &&
        (record.coverArt ? this.displayed(record.element) : this.visible(record.element, true)), rescue, singleAttempt: rescue, fresh: rescue });
    if (!entry) return;
    record.unsubscribe?.();
    const update = item => {
      if (this.disposed || !record.element.isConnected) return;
      record.state = item.status;
      this.trackRecovery(record, item);
      if (record.coverArt) {
        if(item.status==='ready')this.rememberThumbnail(record,item);
        record.status.textContent = ({queued:'Waiting',loading:'Loading…',retrying:'Retrying…',stalled:'Slow load',failed:'Unavailable'})[item.status] || '';
        record.status.hidden = ['streaming','partial','ready'].includes(item.status) && !!item.image?.naturalWidth;
      }
      if (item.image?.naturalWidth && ['streaming', 'partial', 'ready'].includes(item.status)) {
        record.appliedURL = item.actualURL;
        if (record.coverArt) { const displayURL=item.displayURL||item.actualURL;if(record.image.getAttribute('src')!==displayURL)record.image.src=displayURL;record.image.dataset.epImageSource=item.actualURL; }
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
  counts() {
    const counts = { failed: 0, waiting: 0, deferred: 0 };
    for (const record of [...this.records.values(), ...this.thumbnails.values()]) {
      if (!record.element.isConnected) continue;
      if (record.state === 'failed' && this.visible(record.element)) counts.failed++;
      else if (record.state === 'deferred') counts.deferred++;
      else if (['queued', 'loading', 'streaming', 'retrying', 'stalled'].includes(record.state)) counts.waiting++;
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
      this.clearGridUpgrade(record);
      record.unsubscribe?.(); record.element.remove(); this.intersection?.unobserve(record.element); this.near.delete(record.element); this.thumbnails.delete(row);
      this.pool.abandon(record.lastEntry);
    }
  }
  dispose() {
    this.disposed = true; this.intersection?.disconnect(); this.pool.dispose();
    if (this.gridFrame) this.win.cancelAnimationFrame(this.gridFrame);
    this.doc.documentElement?.classList.remove('epc-cover-art');
    this.pool.env.clearTimeout(this.recoveryTimer);
    this.win.removeEventListener('resize', this.resizeListener);
    this.win.removeEventListener('scroll', this.demandListener);
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
      this.clearGridUpgrade(record);
      record.unsubscribe?.(); record.element.remove();
      record.row.classList.remove('epc-category-keep', 'epc-category-overlay', 'epc-category-hide');
    }
    this.records.clear(); this.thumbnails.clear(); this.near.clear();
  }
}

export class PreviewController {
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
    this.pinButton = this.app.button('Pin (P)', () => this.pin());
    this.retryButton = this.app.button('Retry (R)', () => this.retry());
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
    this.pinButton.textContent = this.pinned ? 'Unpin (P)' : 'Pin (P)';
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
    if(titleHover&&readyThumbnail&&!options.force)this.app.imageCache.recordActivity?.('hit',thumbnail.lastEntry.cacheBytes);
    const entry = titleHover && readyThumbnail && !options.force ? thumbnail.lastEntry : this.app.media.pool.request(source, {
      ...(titleHover ? this.app.media.thumbnailOptions(source) : { lane: 'large', keepAlive: true,
        cacheMode: thumbnail?.image.naturalWidth && !/\.gif(?:\?|$)/i.test(source) ? 'network' : 'lookup' }), priority: 100, force: !!options.force,
      eligible: () => this.open && version === this.version,
      fresh: !!options.force, ...(!titleHover ? { candidates: Array.from(new Set([source, item.metadata.src])) } : {}) });
    if (!entry) {
      previousUnsubscribe?.();
      this.clearLoadStats(); this.setStatusText('Retry limit reached. Try again after a short pause.'); this.position(); return;
    }
    const update = current => {
      if (!this.open || version !== this.version) return;
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
      this.element.dataset.state = pendingView ? 'loading' : current.status; this.position();
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
    this.open = false; this.pinned = false; this.inside = false; this.zoom = false; this.titleHover = false;
    if (this.element) this.element.hidden = true;
    if (restoreFocus) this.anchor?.focus({ preventScroll: true });
    if (!this.anchor?.isConnected) { this.anchor = null; this.metadata = null; this.dismissed = null; }
    this.app.media.pool.trim();
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

export function createApp(win, storage, options = {}) {
  return new CompanionApp(win, storage, options);
}
