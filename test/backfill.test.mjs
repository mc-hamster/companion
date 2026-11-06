import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {collagePageHTML} from './collage-backfill-fixture.mjs';
import { createApp } from '../src/app.mjs';
import { backfillURL, nextBackfillURL, backfillRetryAfter } from '../src/backfill.mjs';
import { validateNSE } from '../src/nse-settings.mjs';
import { validateSettings } from '../src/core.mjs';
import { domFixture, fixtureHTML, rowHTML, overlayHTML, memoryStorage, fakeClock, settle, until } from './helpers.mjs';

const origin = 'https://www.empornium.sx';
const search = origin + '/torrents.php?action=advanced&searchtext=sample&page=1';
const pageURL = page => origin + '/torrents.php?action=advanced&page=' + page + '&searchtext=sample';
const schema = JSON.parse(await readFile(new URL('../dist/nse-schema.json', import.meta.url)));
function pageHTML(ids, page, next, { numbered = 8, noNext = false, extra = '' } = {}) {
  let rows = '', overlays = '';
  for (const [index, id] of ids.entries()) {
    rows += rowHTML(id, { tags: id % 2 ? 'keep' : 'blocked' }).replace('overlib(overlay' + id + ')', 'overlib(overlay' + (index + 1) + ')');
    overlays += overlayHTML(index + 1, 'https://hamsterimg.net/images/image-' + id + '.jpg');
  }
  const links = Array.from({ length: numbered }, (_, i) => '<a class="pager_page" href="' + pageURL(i + 1) + '">' + (i + 1) + '</a>').join(' ') +
    (next && !noNext ? '<a class="pager_next" href="' + pageURL(next) + '">Next</a>' : '');
  return fixtureHTML(rows, overlays + extra).replace(/<a class="pager_prev"[\s\S]*?<\/a><a class="pager_next"[\s\S]*?<\/a>/, links);
}
const response = (url, html) => ({ ok: true, url, headers: new Map([['content-type', 'text/html; charset=utf-8']]), text: async () => html });
async function setup({ fetch, settings = {}, filter = false, timeout = 20000, url = search, initial = {}, numbered = 1, hidden, initialIDs = [1], html } = {}) {
  const f = domFixture(html||pageHTML(initialIDs, 1, 2, { numbered }), url), clock = fakeClock(), calls = [];
  if (hidden) Object.defineProperty(f.doc, 'hidden', {configurable:true,get:hidden});
  const storage = memoryStorage({ 'ep.settings': settings, ...initial });
  const app = createApp(f.win, storage, {
    Image: clock.env.Image, validateNSE: value => validateNSE(value, schema), backfillTimeoutMs: timeout, backfillIntervalMs:0, backfillRetryMs:1, backfillRateLimitMs:2, backfillRandom:()=>0,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return fetch ? fetch(url, options) : response(url, pageHTML([Number(new URL(url).searchParams.get('page'))], 0, null, { numbered: 0 }));
    },
    newRows: root => {
      if (!filter) return;
      for (const row of root.querySelectorAll('tr.torrent')) {
        const hidden = row.querySelector('.tags')?.textContent.includes('blocked');
        row.setAttribute('isNSEHidden', hidden ? '1' : '0'); row.classList.toggle('hidden', !!hidden);
      }
    }
  }).start();
  await settle();
  return { ...f, app, clock, storage, calls, close() { app.dispose(); f.close(); } };
}

test('backfill URLs retain the search and reject downloads, details, other origins and other searches', () => {
  assert.equal(backfillURL('?page=2&searchtext=sample&action=advanced', search), pageURL(2));
  for (const candidate of ['https://other.test/torrents.php?page=2', '/torrents.php?id=2',
    '/torrents.php?action=download&id=2', '/torrents.php?action=advanced&action=download&page=2&searchtext=sample',
    '/torrents.php?action=advanced&searchtext=other&page=2', '/torrents.php?action=advanced&searchtext=sample&page=Infinity',
    '/requests.php?page=2', 'javascript:alert(1)']) assert.equal(backfillURL(candidate, search), null, candidate);
});

test('numbered pager fallback moves forward in order and skips already loaded pages', () => {
  const f = domFixture(pageHTML([2], 2, null), pageURL(2));
  try {
    assert.equal(nextBackfillURL(f.doc, pageURL(2), search), pageURL(3));
    assert.equal(nextBackfillURL(f.doc, pageURL(2), search, new Set([pageURL(3)])), pageURL(4));
  } finally { f.close(); }
});

test('one click backfills five pages, deduplicates results and continues at the next unread page', async () => {
  const f = await setup({ numbered: 8, fetch: async url => {
    const page = Number(new URL(url).searchParams.get('page'));
    return response(url, pageHTML([page - 1, page], page, page < 8 ? page + 1 : null));
  } });
  try {
    assert.equal(f.calls.length, 0, 'no result pages are fetched before a click');
    await f.app.backfill.run();
    assert.deepEqual(f.calls.map(c => Number(new URL(c.url).searchParams.get('page'))), [2, 3, 4, 5, 6]);
    assert.equal(f.doc.querySelectorAll('tr.torrent').length, 6);
    assert.equal(f.app.backfill.nextURL, pageURL(7));
    assert.equal(f.doc.querySelector('.pager_next').href, pageURL(7));
    assert.equal(f.doc.querySelectorAll('.epc-backfilled-page').length, 5);
    assert.ok(f.calls.every(c => c.options.credentials === 'same-origin' && c.options.redirect === 'error'));
    await f.app.backfill.run();
    assert.equal(f.doc.querySelectorAll('tr.torrent').length, 8);
    assert.equal(f.app.backfill.nextURL, null); assert.equal(f.app.backfill.button.disabled, true);
    assert.match(f.app.backfill.status.textContent, /No more pages/);
    assert.equal(f.doc.querySelector('.pager_next').hasAttribute('href'), false);
  } finally { f.close(); }
});

test('backfill uses original pager fallback and continues beyond a duplicate-only page', async () => {
  const f = await setup({ numbered: 8, settings: { backfillPages: 2 }, fetch: async url => {
    const n = Number(new URL(url).searchParams.get('page'));
    return response(url, pageHTML(n === 2 ? [1] : [3], n, null, { numbered: 0 }));
  } });
  try {
    await f.app.backfill.run();
    assert.equal(f.calls.length, 2); assert.equal(f.app.backfill.nextURL, pageURL(4));
    assert.deepEqual([...f.doc.querySelectorAll('tr.torrent')].map(row => row.dataset.fixtureId), ['1', '3']);
  } finally { f.close(); }
});

test('appended preview data survives overlay-name collisions and media restarts without executing scripts', async () => {
  const f = await setup({ fetch: async url => response(url, pageHTML([3], 2, null, { numbered: 0,
    extra: '<script>window.backfillExecuted=true</script>' })) });
  try {
    await f.app.backfill.run();
    const row = f.doc.querySelector('[data-fixture-id="3"]'), link = row.querySelector('.fixture-title');
    assert.equal(f.win.backfillExecuted, undefined); assert.equal(row.querySelector('script'), null);
    assert.equal(link.hasAttribute('onmouseover'), false);
    assert.notEqual(link.dataset.epOverlay, 'overlay1');
    assert.equal(f.app.media.definitions.get('overlay1').src, 'https://hamsterimg.net/images/image-1.jpg');
    assert.equal(f.app.media.definitions.get(link.dataset.epOverlay).src, 'https://hamsterimg.net/images/image-3.jpg');
    assert.match(f.app.media.thumbnails.get(row).lastEntry.actualURL, /image-3\.th\.jpg$/);
    f.app.restartMedia(); await settle();
    assert.equal(f.app.media.definitions.get(link.dataset.epOverlay).src, 'https://hamsterimg.net/images/image-3.jpg');
    assert.equal(f.app.media.thumbnails.has(row), true);
  } finally { f.close(); }
});

test('a missing thumbnail on a backfilled grid page does not delay other thumbnails on its host', async () => {
  const ids = Array.from({ length: 50 }, (_, index) => index + 2);
  const f = await setup({ settings: { resultsView: 'grid', backfillPages: 1 }, fetch: async url =>
    response(url, pageHTML(ids, 2, null, { numbered: 0 })) });
  try {
    f.clock.images[0].succeed(160, 90);
    const requests = [];
    f.app.media.pool.env.imageCache = {
      enabled: () => true,
      load(url, options, done) {
        requests.push(url);
        const missing = /\/image-[2-7]\.th\.jpg$/.test(url);
        const timer = f.clock.env.setTimeout(() => done(missing ? { failure: true, status: 404 } : null), 1);
        return () => f.clock.env.clearTimeout(timer);
      }
    };
    await f.app.backfill.run();
    for (let step = 0; step < 50; step++) {
      f.clock.tick(2);
      for (const image of f.clock.images) if (image.onload && !image.naturalWidth) image.succeed(160, 90);
    }
    const records = [...f.app.media.thumbnails.values()].filter(record => record.row.dataset.epBackfillPage);
    assert.equal(records.length, 50);
    assert.equal(records.filter(record => record.state === 'ready').length, 44);
    assert.equal(records.filter(record => record.status.textContent === 'Thumbnail unavailable').length, 6);
    assert.equal(requests.length, 50);
    assert.ok(requests.every(url => /\.th\.jpg$/.test(url)));
    assert.equal(f.app.media.pool.hosts.get('hamsterimg.net').constrained, false);
  } finally { f.close(); }
});

test('new rows respect active filters and Show filtered before thumbnail or native-image requests', async () => {
  const f = await setup({ filter: true, fetch: async url => response(url,
    pageHTML([2, 3], 2, null, { numbered: 0 }).replace('</div></td>', '</div><img src="/native-icon.jpg" onerror="window.backfillExecuted=true"></td>')) });
  try {
    await f.app.backfill.run();
    const hidden = f.doc.querySelector('[data-fixture-id="2"]');
    assert.equal(f.app.media.thumbnails.get(hidden).state, 'deferred');
    assert.equal(hidden.querySelector('img[data-ep-backfill-src]').hasAttribute('src'), false);
    assert.equal(f.clock.images.some(image => /image-2/.test(image.src)), false);
    f.app.toggleFiltered.click(); await settle();
    assert.equal(hidden.classList.contains('epc-revealed'), true);
    assert.equal(hidden.querySelector('img[data-ep-backfill-src]'), null);
    for(let i=0;i<f.clock.images.length;i++)f.clock.images[i].succeed();
    assert.ok(f.clock.images.some(image => /image-2\.th\.jpg/.test(image.src)));
    assert.equal(hidden.querySelector('[onerror]'), null);
  } finally { f.close(); }
});

test('partial failure keeps completed pages and retries only the failed cursor', async () => {
  let fail = true;
  const f = await setup({ fetch: async url => {
    const n = Number(new URL(url).searchParams.get('page'));
    if (n === 3 && fail) throw new Error('network');
    return response(url, pageHTML([n], n, n < 3 ? n + 1 : null, { numbered: 0 }));
  } });
  try {
    await f.app.backfill.run();
    assert.equal(f.app.backfill.nextURL, pageURL(3)); assert.equal(f.app.backfill.button.disabled, false);
    assert.match(f.app.backfill.status.textContent, /1 page kept/);
    fail = false; await f.app.backfill.run();
    assert.deepEqual(f.calls.map(c => Number(new URL(c.url).searchParams.get('page'))), [2, 3, 3, 3, 3]);
    assert.equal(f.doc.querySelectorAll('tr.torrent').length, 3);
  } finally { f.close(); }
});

test('Stop discards late responses and a second click cannot run a parallel backfill', async () => {
  let resolvePage;
  const f = await setup({ fetch: url => new Promise(resolve => { resolvePage = () => resolve(response(url, pageHTML([2], 2, null, { numbered: 0 }))); }) });
  try {
    const first = f.app.backfill.run(); await f.app.backfill.run(); await until(()=>f.calls.length===1);
    assert.equal(f.calls.length, 1); assert.equal(f.app.backfill.button.textContent, 'Stop loading');
    f.app.backfill.stop(); resolvePage(); await first;
    assert.equal(f.doc.querySelectorAll('tr.torrent').length, 1);
    assert.equal(f.app.backfill.nextURL, pageURL(2)); assert.equal(f.app.backfill.busy, false);
    assert.equal(f.calls[0].options.signal.aborted, true);
    assert.match(f.app.backfill.status.textContent, /stopped/);
  } finally { f.close(); }
});

test('timed-out, login, non-HTML and redirected responses leave the cursor retryable', async () => {
  const cases = [
    async (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    async url => response(url, '<form><input type="password"></form>'),
    async url => ({ ...response(url, '{}'), headers: new Map([['content-type', 'application/json']]) }),
    async url => ({ ...response(url, ''), url: origin + '/login.php' })
  ];
  for (const fetch of cases) {
    const f = await setup({ fetch, timeout: 15 });
    try {
      await f.app.backfill.run();
      assert.equal(f.app.backfill.busy, false); assert.equal(f.app.backfill.nextURL, pageURL(2));
      assert.equal(f.doc.querySelectorAll('tr.torrent').length, 1);
      assert.match(f.app.backfill.status.textContent, /Try Load more again/);
    } finally { f.close(); }
  }
});

test('legacy fork preferences import, clamp and round-trip through Companion backups', async () => {
  const f = await setup({ initial: { nseBackfillButtonEnabled: false, nseBackfillPageLimit: 7 } });
  try {
    assert.equal(f.app.settings.backfillEnabled, false); assert.equal(f.app.settings.backfillPages, 7);
    f.app.importData(JSON.stringify({ nseBackfillButtonEnabled: true, nseBackfillPageLimit: 30 }));
    assert.equal(f.app.settings.backfillEnabled, true); assert.equal(f.app.settings.backfillPages, 15);
    const backup = f.app.exportData();
    assert.equal(backup.nse.nseBackfillPageLimit, 15); assert.equal(backup.settings.backfillPages, 15);
    backup.settings.backfillPages = 3;
    f.app.importData(JSON.stringify(backup));
    assert.equal(f.app.settings.backfillPages, 3, 'Companion setting takes precedence over legacy compatibility fields');
    assert.equal(validateSettings({ backfillPages: 1.9 }).backfillPages, 1);
  } finally { f.close(); }
});

test('backfill remains available with media disabled and stays off detail/other pages', async () => {
  const f = await setup({ settings: { enabled: false, backfillPages: 1 } });
  try { await f.app.backfill.run(); assert.equal(f.doc.querySelectorAll('tr.torrent').length, 2); assert.equal(f.clock.images.length, 0); }
  finally { f.close(); }
  for (const url of [origin + '/torrents.php?id=1', origin + '/top10.php']) {
    const f = await setup({ url });
    try { assert.equal(f.app.backfill.button.hidden, true); await f.app.backfill.run(); assert.equal(f.calls.length, 0); }
    finally { f.close(); }
  }
});

test('backfill preferences autosave and Undo restores them without fetching any pages', async () => {
  const f = await setup();
  try {
    const pages = f.app.controls.get('backfillPages'); pages.value = '2';
    pages.dispatchEvent(new f.win.Event('change', { bubbles: true })); await settle();
    assert.equal(f.storage.get('ep.settings').backfillPages, 2);
    const enabled = f.app.controls.get('backfillEnabled'); enabled.checked = false;
    enabled.dispatchEvent(new f.win.Event('change', { bubbles: true })); await settle();
    assert.equal(f.app.backfill.button.hidden, true); assert.equal(f.calls.length, 0);
    f.app.preferences.undo();
    assert.equal(f.app.settings.backfillPages, 5); assert.equal(f.app.settings.backfillEnabled, true);
    assert.equal(f.app.backfill.button.hidden, false);
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test('an empty results page stops backfill even if the original pager still lists later pages', async () => {
  const f = await setup({ numbered: 8, fetch: async url => response(url, pageHTML([], 2, 3)) });
  try {
    await f.app.backfill.run();
    assert.equal(f.calls.length, 1); assert.equal(f.app.backfill.nextURL, null);
    assert.equal(f.doc.querySelectorAll('tr.torrent').length, 1);
    assert.match(f.app.backfill.status.textContent, /0 results added.*No more pages/);
  } finally { f.close(); }
});

test('a failed filter pass rolls back the new page and leaves its results retryable', async () => {
  const f = await setup();
  try {
    f.app.options.newRows = () => { throw new Error('filter failure'); };
    await f.app.backfill.run();
    assert.equal(f.doc.querySelectorAll('tr.torrent').length, 1);
    assert.equal(f.app.backfill.nextURL, pageURL(2));
    assert.equal(f.app.backfill.seenIDs.has('2'), false);
    f.app.options.newRows = () => {};
    await f.app.backfill.run();
    assert.equal(f.doc.querySelectorAll('tr.torrent').length, 2);
  } finally { f.close(); }
});


test('[BFL-07] automatic N-page mode runs once after readiness and allows a later manual batch', async()=>{
  const f=await setup({settings:{backfillMode:'pages',backfillPages:2},fetch:async url=>{const n=Number(new URL(url).searchParams.get('page'));return response(url,pageHTML([n],n,n<8?n+1:null,{numbered:0}));}});
  try{await until(()=>f.calls.length===2&&!f.app.backfill.busy);for(let i=0;i<4;i++)f.app.syncGridFilters();await settle();assert.equal(f.calls.length,2);
    await f.app.backfill.run();assert.equal(f.calls.length,4);
  }finally{f.close();}
});
test('[BFL-07] all-pages mode continues beyond the fifteen-page batch ceiling with only one fetch in flight', async()=>{
  let active=0,peak=0;const f=await setup({settings:{backfillMode:'all',backfillPages:1},fetch:async url=>{active++;peak=Math.max(peak,active);await settle(1);active--;const n=Number(new URL(url).searchParams.get('page'));return response(url,pageHTML([n],n,n<18?n+1:null,{numbered:0}));}});
  try{await until(()=>!f.app.backfill.busy&&f.calls.length===17,'all pages through page18',6000);assert.equal(peak,1);assert.equal(f.doc.querySelectorAll('tr.torrent').length,18);assert.equal(f.app.backfill.nextURL,null);}finally{f.close();}
});
test('[BFL-08] automatic loading waits in a hidden tab, resumes between pages and Stop prevents a restart',async()=>{
  let hidden=true;const f=await setup({hidden:()=>hidden,settings:{backfillMode:'all'},fetch:async url=>{hidden=true;const n=Number(new URL(url).searchParams.get('page'));return response(url,pageHTML([n],n,n+1,{numbered:0}));}});
  try{assert.equal(f.calls.length,0);hidden=false;f.doc.dispatchEvent(new f.win.Event('visibilitychange'));
    await until(()=>f.calls.length===1&&!!f.app.backfill.cancelForeground,'pause between pages');assert.match(f.app.backfill.message,/paused/);
    hidden=false;f.doc.dispatchEvent(new f.win.Event('visibilitychange'));await until(()=>f.calls.length===2&&!!f.app.backfill.cancelForeground);
    f.app.backfill.stop();hidden=false;f.doc.dispatchEvent(new f.win.Event('visibilitychange'));await settle();assert.equal(f.calls.length,2);assert.equal(f.app.backfill.busy,false);assert.equal(f.app.backfill.cancelForeground,null);
  }finally{f.close();}
});
test('[BFL-08] automatic failures do not retry on scans or focus and disposal releases a background wait',async()=>{
  const f=await setup({settings:{backfillMode:'pages'},fetch:async()=>{throw Error('Offline');}});
  try{await until(()=>f.calls.length===3&&!f.app.backfill.busy);for(let i=0;i<3;i++)f.app.backfill.maybeAutomatic();await settle();assert.equal(f.calls.length,3);assert.match(f.app.backfill.message,/Could not load/);}finally{f.close();}
  let hidden=false;const g=await setup({hidden:()=>hidden,settings:{backfillMode:'all'},fetch:async url=>{hidden=true;return response(url,pageHTML([2],2,3,{numbered:0}));}});
  try{await until(()=>!!g.app.backfill.cancelForeground);g.app.dispose();assert.equal(g.app.backfill.cancelForeground,null);hidden=false;g.doc.dispatchEvent(new g.win.Event('visibilitychange'));await settle();assert.equal(g.calls.length,1);}finally{g.close();}
});

test('[BFL-07] backup roundtrip preserves automatic mode while setup completion remains specific to the installation',async()=>{
  const f=await setup({settings:{backfillMode:'all',backfillPages:9,backfillEnabled:false}});
  const g=await setup({initial:{'ep.onboardingDone':false}});
  try{const backup=f.app.exportData();assert.equal(backup.settings.backfillMode,'all');assert.equal(JSON.stringify(backup).includes('ep.onboardingDone'),false);
    g.app.importData(JSON.stringify(backup),false);assert.equal(g.app.settings.backfillMode,'all');assert.equal(g.app.settings.backfillPages,9);assert.equal(g.storage.get('ep.onboardingDone'),false);assert.equal(g.calls.length,0);
  }finally{f.close();g.close();}
});

test('[PERF-01] backfill scans only newly inserted rows rather than rescanning the accumulated table',async()=>{
  const f=await setup({settings:{backfillPages:2,resultsView:'grid'},fetch:async url=>{const n=Number(new URL(url).searchParams.get('page'));return response(url,pageHTML([n],n,n+1,{numbered:0}));}});
  try{
    const roots=[],scan=f.app.media.scan.bind(f.app.media);f.app.media.scan=root=>{roots.push(root);return scan(root);};
    const decorated=[],decorate=f.app.grid.decorateRows.bind(f.app.grid);
    f.app.grid.decorateRows=(rows,labels)=>{decorated.push(...rows);decorate(rows,labels);};
    const groupScopes=[],collect=f.app.versions.collectCandidates.bind(f.app.versions);
    f.app.versions.collectCandidates=rows=>{groupScopes.push(...rows);return collect(rows);};
    await f.app.backfill.run();await settle();
    assert.ok(roots.some(root=>root.dataset.fixtureId==='2'));assert.ok(roots.some(root=>root.dataset.fixtureId==='3'));
    assert.equal(roots.some(root=>root.matches('body,table,tbody')),false,'owned append mutations must not trigger a second broad scan');
    assert.deepEqual(decorated.map(row=>row.dataset.fixtureId),['2','3']);
    assert.deepEqual(groupScopes.map(row=>row.dataset.fixtureId),['2','3']);
  }finally{f.close();}
});

test('backfill counts request and processing time toward the minimum interval between starts', async () => {
  let now = 100000;
  const starts = [], waits = [];
  const f = await setup({ fetch: async url => {
    starts.push(now);
    const page = Number(new URL(url).searchParams.get('page'));
    now += page === 3 ? 1200 : 300;
    return response(url, pageHTML([page], page, page < 4 ? page + 1 : null, { numbered: 0 }));
  } });
  try {
    const controller = f.app.backfill, sync = f.app.syncGridFilters.bind(f.app);
    delete f.app.options.backfillIntervalMs;
    controller.now = () => now;
    controller.wait = async (ms, generation) => { waits.push(ms); now += ms; return controller.active(generation); };
    f.app.syncGridFilters = (...args) => { now += 125; return sync(...args); };
    // A second manual batch also respects the prior request start.
    f.app.settings.backfillPages = 1;
    await controller.run();
    f.app.settings.backfillPages = 2;
    await controller.run();
    assert.deepEqual(waits, [575, 0]);
    assert.deepEqual(starts, [100000, 101000, 102325]);
  } finally { f.close(); }
});

test('a backfilled variant can form a group and collapse an existing duplicate', async () => {
  const initial = pageHTML([1, 2], 1, 2).replace(/Example [12]/g, 'Mountain Walk');
  const appended = pageHTML([3], 2, null, { numbered: 0 }).replace('Example 3', 'Mountain Walk [1080p]');
  const f = await setup({ html: initial, fetch: async url => response(url, appended) });
  try {
    assert.match(f.app.filterSummary.textContent, /^2 shown/);
    await f.app.backfill.run();
    const control = f.doc.querySelector('.epc-version-control');
    assert.equal(control.textContent, 'Show 3 versions');
    assert.deepEqual([...f.doc.querySelectorAll('.epc-version-hidden')].map(row => row.dataset.fixtureId), ['2', '3']);
    assert.match(f.app.filterSummary.textContent, /^1 shown · 2 grouped/);
    control.click();
    assert.match(f.app.filterSummary.textContent, /^3 shown/);
  } finally { f.close(); }
});

test('[BFL-08] Stop or disposal during foreground admission cannot start a stale request',async()=>{
  for(const dispose of [false,true]){
    const f=await setup({settings:{backfillPages:1}});
    try{const pending=f.app.backfill.run();if(dispose)f.app.dispose();else f.app.backfill.stop();await pending;assert.equal(f.calls.length,0);assert.equal(f.doc.querySelectorAll('tr.torrent').length,1);}finally{f.close();}
  }
});

function virtualPacing(f){
  let time=Date.UTC(2026,9,29);const waits=[];f.app.backfill.now=()=>time;
  f.app.options.backfillRetryMs=2000;f.app.options.backfillRateLimitMs=10000;f.app.options.backfillIntervalMs=1000;
  f.app.backfill.wait=async(ms,generation)=>{waits.push(ms);time+=ms;return f.app.backfill.active(generation);};return waits;
}
test('[BFL-09] six-page 260-result list recovers page4 twice without skipping, duplicates or parallel requests',async()=>{
  let failed=0,active=0,peak=0;const f=await setup({initialIDs:Array.from({length:50},(_,i)=>i+1),numbered:6,fetch:async url=>{
    active++;peak=Math.max(peak,active);await Promise.resolve();active--;const n=Number(new URL(url).searchParams.get('page'));
    if(n===4&&failed++<2)return{ok:false,status:503,headers:new Map()};
    return response(url,pageHTML(Array.from({length:n===6?10:50},(_,i)=>(n-1)*50+i+1),n,n<6?n+1:null,{numbered:6}));
  }});
  try{f.app.settings.backfillMode='all';const waits=virtualPacing(f);await f.app.backfill.run();
    assert.deepEqual(f.calls.map(c=>Number(new URL(c.url).searchParams.get('page'))),[2,3,4,4,4,5,6]);
    assert.deepEqual(waits,[1000,1000,2000,4000,1000,1000]);assert.equal(peak,1);
    assert.equal(f.doc.querySelectorAll('tr.torrent').length,260);assert.equal(f.app.backfill.seenIDs.size,260);
    assert.equal(f.doc.querySelectorAll('a.pager_page.epc-backfilled-page').length,5);assert.match(f.app.backfill.status.textContent,/210 results added from 5 pages.*No more pages/);
  }finally{f.close();}
});
test('[BFL-09] Retry-After seconds/date and rate-limit backoff are never shortened',async()=>{
  const now=Date.UTC(2026,9,29);assert.equal(backfillRetryAfter('120',now),120000);assert.equal(backfillRetryAfter(new Date(now+90000).toUTCString(),now),90000);
  for(const value of ['',null,'-1','nonsense'])assert.equal(backfillRetryAfter(value,now),0);
  let tries=0;const f=await setup({fetch:async url=>++tries<3?{ok:false,status:429,headers:new Map([['retry-after','120']])}:response(url,pageHTML([2],2,null,{numbered:0}))});
  try{const waits=virtualPacing(f);await f.app.backfill.run();assert.deepEqual(waits,[120000,120000]);assert.equal(f.calls.length,3);assert.equal(f.doc.querySelectorAll('tr.torrent').length,2);}finally{f.close();}
});
test('[BFL-09] retry budget exhausts after three total attempts; explicit resume starts at the failed page',async()=>{
  let fail=true;const f=await setup({fetch:async url=>{const n=Number(new URL(url).searchParams.get('page'));return n===3&&fail?{ok:false,status:502,headers:new Map()}:response(url,pageHTML([n],n,n<4?n+1:null,{numbered:0}));}});
  try{f.app.settings.backfillMode='all';virtualPacing(f);await f.app.backfill.run();
    assert.deepEqual(f.calls.map(c=>Number(new URL(c.url).searchParams.get('page'))),[2,3,3,3]);assert.equal(f.app.backfill.nextURL,pageURL(3));assert.equal(f.doc.querySelectorAll('tr.torrent').length,2);
    assert.match(f.app.backfill.message,/HTTP 502.*retry limit/);assert.equal(f.app.backfill.status.querySelector('a').href,pageURL(3));
    f.app.backfill.maybeAutomatic();assert.equal(f.calls.length,4);fail=false;await f.app.backfill.run();
    assert.deepEqual(f.calls.map(c=>Number(new URL(c.url).searchParams.get('page'))),[2,3,3,3,3,4]);assert.equal(f.doc.querySelectorAll('tr.torrent').length,4);
  }finally{f.close();}
});
test('[BFL-10] access/login/invalid response and row-processing errors do not automatically retry',async()=>{
  for(const status of[401,403,404]){
    const f=await setup({fetch:async()=>({ok:false,status,headers:new Map()})});
    try{virtualPacing(f);await f.app.backfill.run();assert.equal(f.calls.length,1);assert.match(f.app.backfill.message,new RegExp('HTTP '+status));assert.equal(f.doc.querySelectorAll('tr.torrent').length,1);}finally{f.close();}
  }
  const f=await setup({fetch:async url=>response(url,pageHTML([2],2,null,{numbered:0}))});
  try{virtualPacing(f);f.app.options.newRows=()=>{throw Error('sensitive arbitrary error text');};await f.app.backfill.run();assert.equal(f.calls.length,1);assert.match(f.app.backfill.message,/could not be processed/);assert.doesNotMatch(f.app.backfill.message,/sensitive/);}finally{f.close();}
});
test('[BFL-09] Stop during retry backoff cancels the timer and preserves the cursor without another request',async()=>{
  const f=await setup({fetch:async()=>({ok:false,status:503,headers:new Map()})});
  try{f.app.options.backfillRetryMs=10000;const run=f.app.backfill.run();await until(()=>!!f.app.backfill.cancelDelay);
    assert.match(f.app.backfill.message,/Retrying/);f.app.backfill.stop();await run;assert.equal(f.calls.length,1);assert.equal(f.app.backfill.cancelDelay,null);assert.equal(f.app.backfill.nextURL,pageURL(2));
    f.doc.dispatchEvent(new f.win.Event('visibilitychange'));await settle();assert.equal(f.calls.length,1);
  }finally{f.close();}
});
test('[BFL-09] a retry deadline reached in the background waits for foreground before issuing another request',async()=>{
  let hidden=false,tries=0;const f=await setup({hidden:()=>hidden,fetch:async url=>{if(++tries===1){hidden=true;return{ok:false,status:503,headers:new Map()};}return response(url,pageHTML([2],2,null,{numbered:0}));}});
  try{const run=f.app.backfill.run();await until(()=>!!f.app.backfill.cancelForeground);assert.equal(f.calls.length,1);hidden=false;f.doc.dispatchEvent(new f.win.Event('visibilitychange'));await run;assert.equal(f.calls.length,2);}finally{f.close();}
});
test('[BFL-09] Stop cannot bypass a server cooldown, and disposal clears its UI wake timer',async()=>{
  const f=await setup({fetch:async()=>({ok:false,status:429,headers:new Map([['retry-after','60']])})});
  try{const run=f.app.backfill.run();await until(()=>!!f.app.backfill.cancelDelay);f.app.backfill.stop();await run;assert.equal(f.app.backfill.button.disabled,true);
    await f.app.backfill.run();assert.equal(f.calls.length,1);assert.ok(f.app.backfill.cooldownTimer);f.app.dispose();assert.equal(f.app.backfill.cancelDelay,null);
  }finally{f.close();}
});

const collageURL=origin+'/collage/2591?sort=added';
const collageHTML=(ids,page,next)=>{const u=new URL(collageURL);u.searchParams.set('page',page);return collagePageHTML(u,ids,next);};
test('a five-page collage batch skips idle gaps and repeated batches share the pacing allowance', async () => {
  const starts = [];
  const f = await setup({url: collageURL, html: collageHTML([1], 1, 2), fetch: async url => {
    starts.push(f.app.backfill.now());
    const page = Number(new URL(url).searchParams.get('page'));
    return response(url, collageHTML([page], page, page < 8 ? page + 1 : null));
  }});
  try {
    const waits = virtualPacing(f);
    await f.app.backfill.run();
    assert.equal(f.app.backfill.pages, 5);
    assert.deepEqual(waits, [0, 0, 0, 0], 'Each fast request still yields between pages');
    await f.app.backfill.run();
    assert.deepEqual(waits, [0, 0, 0, 0, 1000, 1000]);
    assert.deepEqual(starts.map(time => time - starts[0]), [0, 0, 0, 0, 0, 1000, 2000]);
    assert.equal(f.app.backfill.pages, 7);
  } finally { f.close(); }
});

test('[BFL-11] collage URLs keep the collage and ordering identity and reject mutations or page zero',()=>{
  assert.equal(backfillURL('?page=2&sort=added#discog_table',collageURL),origin+'/collage/2591?page=2&sort=added');
  for(const candidate of['/collage','/collage/99?page=2&sort=added','?page=0&sort=added','?page=2&sort=other','?page=2&sort=added&action=delete','/collage/2591/manage?page=2&sort=added','/torrents.php?page=2&sort=added'])assert.equal(backfillURL(candidate,collageURL),null,candidate);
});
test('[BFL-11] collage backfill appends synchronized unique rows and covers in order with independent overlay names',async()=>{
  const f=await setup({url:collageURL,html:collageHTML([1,2],1,2),fetch:async url=>{const page=Number(new URL(url).searchParams.get('page'));return response(url,collageHTML(page===2?[2,3,4]:[4,5,6],page,page<3?page+1:null));}});
  try{assert.equal(f.app.backfill.button.hidden,false);assert.equal(f.calls.length,0);await f.app.backfill.run();assert.deepEqual(f.calls.map(x=>Number(new URL(x.url).searchParams.get('page'))),[2,3]);
    assert.deepEqual([...f.doc.querySelectorAll('tr.torrent')].map(r=>r.id),['1','2','3','4','5','6']);assert.deepEqual([...f.doc.querySelectorAll('.torrent_grid__torrent')].map(c=>c.dataset.coverId),['1','2','3','4','5','6']);
    assert.equal(f.doc.querySelectorAll('.torrent_grid__torrent>svg').length,6);assert.equal(f.doc.querySelector('.torrent_grid__torrent[data-cover-id="3"]>svg').outerHTML,'<svg viewBox="0 0 1 1"></svg>');
    assert.ok(f.app.media.records.has(f.doc.querySelector('[data-cover-id="3"] .torrent__cover')));assert.equal(f.app.backfill.nextURL,null);assert.equal(f.app.backfill.button.hidden,true);
    assert.ok(f.doc.querySelector('[id="3"] .fixture-title').dataset.epOverlay);assert.equal(f.doc.querySelectorAll('#torrent_table th').length,7);
  }finally{f.close();}
});
test('[BFL-11] appended collage covers wait for filtering and Show filtered restores their shared thumbnails',async()=>{
  const f=await setup({url:collageURL,html:collageHTML([1,2],1,2),filter:true,fetch:async url=>response(url,collageHTML([2,3,4],2,null))});
  try{await f.app.backfill.run();const card=f.doc.querySelector('[data-cover-id="4"]'),cover=card.querySelector('.torrent__cover');assert.equal(card.classList.contains('epc-filter-hidden'),true);assert.equal(cover.style.backgroundImage,'');assert.ok(cover.dataset.epBackfillBackground);assert.equal(f.clock.images.some(i=>/small-4/.test(i.src)),false);
    f.app.toggleFiltered.click();await settle();assert.equal(card.classList.contains('epc-filter-hidden'),false);assert.ok(cover.style.backgroundImage);assert.ok(f.app.media.records.has(cover));for(let i=0;i<f.clock.images.length;i++)f.clock.images[i].succeed();assert.ok(f.clock.images.some(i=>/small-4/.test(i.src)));f.app.toggleFiltered.click();assert.equal(card.classList.contains('epc-filter-hidden'),true);
  }finally{f.close();}
});
test('[BFL-11] cover sanitization removes executable nodes/styles and row-processing failure rolls back both representations',async()=>{
  let bad=true;const f=await setup({url:collageURL,html:collageHTML([1],1,2),fetch:async url=>response(url,collageHTML([3],2,null).replace('data-cover-id="3"','data-cover-id="3" onclick="window.bad=true" style="background:url(https://evil.test/a)"').replace('<div class="torrent_grid__torrent"','<div class="torrent_grid__torrent"'))});
  try{f.app.options.newRows=root=>{if(bad&&root.querySelector('[id="3"]'))throw Error('Injected filter failure');};await f.app.backfill.run();assert.equal(f.doc.querySelector('[data-cover-id="3"]'),null);assert.equal(f.doc.querySelector('[id="3"]'),null);assert.equal(f.app.backfill.seenIDs.has('3'),false);bad=false;await f.app.backfill.run();
    const card=f.doc.querySelector('[data-cover-id="3"]');assert.ok(card);assert.equal(card.hasAttribute('onclick'),false);assert.equal(card.hasAttribute('style'),false);assert.equal(card.querySelector('script,form,iframe'),null);assert.equal(f.win.bad,undefined);
  }finally{f.close();}
});
test('[BFL-11] automatic All mode follows collage pagination with the existing bounded transient retry policy',async()=>{
  let attempts=0;const f=await setup({url:collageURL,html:collageHTML([1],1,2),settings:{backfillMode:'all'},fetch:async url=>{if(++attempts===1)return{ok:false,status:503,headers:new Map()};const n=Number(new URL(url).searchParams.get('page'));return response(url,collageHTML([n],n,n<3?n+1:null));}});
  try{await until(()=>f.app.backfill.pages===2&&!f.app.backfill.busy);assert.equal(attempts,3);assert.equal(f.doc.querySelectorAll('tr.torrent').length,3);assert.equal(f.doc.querySelectorAll('.torrent_grid__torrent').length,3);assert.equal(f.app.backfill.autoStarted,true);
  }finally{f.close();}
});
