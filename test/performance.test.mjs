import test from 'node:test';
import assert from 'node:assert/strict';
import { coalesceScanRoots } from '../src/scheduling.mjs';
import { createApp } from '../src/app.mjs';
import { domFixture, fixtureHTML, rowHTML, overlayHTML, memoryStorage, fakeClock, settle } from './helpers.mjs';

async function setup(rows = rowHTML(1) + rowHTML(2), extra = '', settings = {}, configure) {
  const f = domFixture(fixtureHTML(rows, extra)), clock = fakeClock(), storage = memoryStorage({
    'ep.settings': { inlineThumbnails: false, recoverImages: false, ...settings } });
  configure?.(f);
  const app = createApp(f.win, storage, { Image: clock.env.Image }).start(); await settle(85);
  return { ...f, app, clock, storage, close() { app.dispose(); f.close(); } };
}
function columnGeometry(f, widths, hiddenCategory = false) {
  const native = f.win.HTMLElement.prototype.getBoundingClientRect;
  f.win.HTMLElement.prototype.getBoundingClientRect = function() {
    const rect = native.call(this);
    const width = this.matches('table.torrent_table') ? widths.reduce((a,b)=>a+b,0) :
      this.matches('td') && this.closest('tr.torrent') ?
        hiddenCategory && this.cellIndex === 0 ? 0 : widths[this.cellIndex] + (hiddenCategory && this.cellIndex === 1 ? widths[0] : 0) : rect.width;
    return { ...rect, width, right: rect.left + width };
  };
}
function countMethod(object, method) {
  const original = object[method].bind(object), counter = { calls: 0 };
  object[method] = (...args) => { counter.calls++; return original(...args); };
  return counter;
}

test('overlapping scan roots reduce to connected outer subtrees', () => {
  const f = domFixture();
  try {
    const content = f.doc.getElementById('content'), row = f.doc.querySelector('.torrent_table tr'), tag = f.doc.querySelector('.tags a');
    const detached = f.doc.createElement('div');
    assert.deepEqual(coalesceScanRoots([tag, row, content, detached]), [content]);
    assert.deepEqual(coalesceScanRoots([tag, row]), [row]);
  } finally { f.close(); }
});

test('image source and style bursts perform one local scan and zero result regrouping', async () => {
  const f = await setup(undefined, '<img id="native" src="https://x.test/native.jpg">');
  try {
    const groups = countMethod(f.app.versions, 'refresh'), lists = countMethod(f.app, 'syncGridFilters');
    const scans = countMethod(f.app.media, 'scan'), image = f.doc.getElementById('native');
    for (let i = 0; i < 30; i++) { image.src = 'https://x.test/native-' + i + '.jpg'; image.style.opacity = i % 2 ? '.9' : '1'; }
    await settle(85);
    assert.equal(groups.calls, 0); assert.equal(lists.calls, 0); assert.equal(scans.calls, 1);
    assert.equal(f.app.media.records.get(image).source, 'https://x.test/native-29.jpg');
  } finally { f.close(); }
});

test('nested result mutations are scanned once per subtree and title edits still regroup', async () => {
  const f = await setup(rowHTML(1, { title: 'Mountain Walk [720p]' }) + rowHTML(2, { title: 'Mountain Walk [1080p]' }));
  try {
    const scans = countMethod(f.app.media, 'scan');
    const row = f.doc.querySelector('.torrent_table tr'), tag = row.querySelector('.tags a');
    tag.classList.add('native-update'); row.style.backgroundColor = 'blue';
    row.querySelector('.tags').classList.add('native-tag-update');
    await settle(85); assert.equal(scans.calls, 1);
    row.querySelector('.fixture-title').textContent = 'A different release [720p]';
    await settle(85); assert.equal(f.doc.querySelector('.epc-version-control'), null);
  } finally { f.close(); }
});

test('expanding one cached group does not scan the whole result list or tag collection', async () => {
  const f = await setup(rowHTML(1, { title: 'Mountain Walk [720p]' }) + rowHTML(2, { title: 'Mountain Walk [1080p]' }));
  try {
    const groups = countMethod(f.app.versions, 'refresh'), tags = countMethod(f.app.tags, 'refresh');
    const scans = countMethod(f.app.media, 'scan');
    const button = f.doc.querySelector('.epc-version-control'); button.click(); await settle(85);
    assert.equal(groups.calls, 0); assert.equal(tags.calls, 0); assert.equal(scans.calls, 0);
    assert.equal(button.getAttribute('aria-expanded'), 'true'); assert.match(f.app.filterSummary.textContent, /^2 shown/);
  } finally { f.close(); }
});

test('highlight changes use the tag index and removed rows release indexed elements', async () => {
  const f = await setup();
  try {
    const query = f.doc.querySelectorAll.bind(f.doc); let fullQueries = 0;
    f.doc.querySelectorAll = selector => { if (selector.includes('#content div.tags')) fullQueries++; return query(selector); };
    f.app.tags.choose('sample.tag', 'favorite'); assert.equal(fullQueries, 0);
    assert.equal(f.app.tags.index.get('sample.tag').size, 2);
    f.doc.querySelector('.torrent_table tr').remove(); await settle(85);
    assert.equal(f.app.tags.index.get('sample.tag').size, 1);
    const remaining = f.doc.querySelector('.tags a'); remaining.textContent = 'renamed.tag'; await settle(85);
    assert.equal(f.app.tags.index.has('sample.tag'), false); assert.equal(f.app.tags.index.get('renamed.tag').size, 1);
  } finally { f.close(); }
});

test('saving highlight-only preferences leaves media and version membership intact', async () => {
  const f = await setup();
  try {
    const media = countMethod(f.app.media, 'updateSettings'), groups = countMethod(f.app.versions, 'refresh');
    const field = f.doc.createElement('textarea'); field.value = 'sample.tag';
    f.app.controls.set('favoriteTags', field); f.app.dirty = true;
    assert.equal(f.app.preferences.flush(), true); await settle(85);
    assert.equal(media.calls, 0); assert.equal(groups.calls, 0);
    assert.equal(f.doc.querySelector('.tags a').dataset.epTagTone, 'favorite');
  } finally { f.close(); }
});

test('queued and completed thumbnails leave scroll observation while new results still warm', async () => {
  const f = await setup(undefined, overlayHTML(1, 'https://x.test/a.jpg') + overlayHTML(2, 'https://x.test/b.jpg'), { inlineThumbnails: true });
  try {
    assert.equal(f.app.media.near.size, 0); assert.equal(f.clock.images.length, 2);
    for (const image of f.clock.images) image.succeed();
    f.win.dispatchEvent(new f.win.Event('scroll')); await settle(45);
    assert.equal(f.app.media.near.size, 0); assert.equal(f.clock.images.length, 2);
    f.doc.querySelector('.torrent_table tbody').insertAdjacentHTML('beforeend', rowHTML(3) + overlayHTML(3, 'https://x.test/c.jpg'));
    await settle(85); assert.equal(f.clock.images.length, 3);
  } finally { f.close(); }
});

test('finishing queued thumbnails does not remeasure the viewport for every image', async () => {
  const ids = Array.from({ length: 12 }, (_, i) => i + 1);
  const f = await setup(ids.map(id => rowHTML(id)).join(''),
    ids.map(id => overlayHTML(id, 'https://hamsterimg.net/' + id + '.jpg')).join(''), { inlineThumbnails: true });
  try {
    assert.ok(f.app.media.pool.queue.length);
    let reads = 0;
    for (const key of ['scrollY', 'innerHeight']) {
      const value = f.win[key];
      Object.defineProperty(f.win, key, { configurable: true, get() { reads++; return value; } });
    }
    for (let i = 0; i < f.clock.images.length; i++) f.clock.images[i].succeed();
    assert.equal(f.clock.images.length, ids.length);
    assert.equal(f.app.media.pool.queue.length, 0);
    assert.equal(reads, 0);
  } finally { f.close(); }
});

test('replacement search forms are adopted even when no torrent rows change', async () => {
  const f = await setup();
  try {
    const current = f.doc.getElementById('search_form'), replacement = current.cloneNode(true);
    current.replaceWith(replacement); await settle(85);
    replacement.elements.taglist.value = 'replacement.tag'; f.app.quickSaveSearch.click();
    assert.equal(f.app.searches[0].fields.find(field => field.name === 'taglist').value, 'replacement.tag');
  } finally { f.close(); }
});

test('startup defers scans until filters finish, then processes the final page once', async () => {
  const f = domFixture(), clock = fakeClock(), storage = memoryStorage({ 'ep.settings': { inlineThumbnails: false } });
  const app = createApp(f.win, storage, { waitForFilters: true, Image: clock.env.Image }).start();
  try {
    const scans = countMethod(app.media, 'scan');
    await settle(85); assert.equal(scans.calls, 0);
    app.filtersFinished(); await settle(85); assert.equal(scans.calls, 1);
  } finally { app.dispose(); f.close(); }
});

test('bursts of image health updates share one frame and settled pages do no scan work', async () => {
  const f = await setup();
  try {
    const health = countMethod(f.app, 'updateHealth'), scans = countMethod(f.app.media, 'scan');
    const groups = countMethod(f.app.versions, 'refresh'), tags = countMethod(f.app.tags, 'refresh');
    for (let i = 0; i < 40; i++) f.app.scheduleHealth();
    await settle(85); assert.equal(health.calls, 1);
    await settle(85); assert.equal(health.calls, 1);
    assert.equal(scans.calls, 0); assert.equal(groups.calls, 0); assert.equal(tags.calls, 0);
  } finally { f.close(); }
});

test('large lists stabilize metadata widths with a flexible title and restore native layout when grouping is disabled', async () => {
  const rows = Array.from({ length: 201 }, (_, i) => rowHTML(i + 1)).join('');
  const widths=[40,540,40,60,80,70,30,30,30,80];
  const f = await setup(rows,'',{},f=>columnGeometry(f,widths));
  try {
    const table = f.doc.querySelector('table.torrent_table');
    const columns = table.querySelector('colgroup.epc-version-columns');
    assert.ok(columns); assert.equal(table.classList.contains('epc-stable-columns'), true);
    assert.equal(columns.children.length, 10);
    assert.deepEqual([...columns.children].map(col=>col.style.width),widths.map((width,index)=>index===1?'':width+'px'));
    assert.equal(table.style.getPropertyValue('--epc-table-min-width'),'640px');
    f.app.versions.stabilizeLayouts(); assert.equal(table.querySelectorAll('colgroup').length, 1);
    f.app.settings.groupVersions = false; f.app.syncGridFilters();
    assert.equal(table.querySelector('colgroup'), null); assert.equal(table.classList.contains('epc-stable-columns'), false);
    assert.equal(table.style.getPropertyValue('--epc-table-min-width'),'');
    const native = f.doc.createElement('colgroup'); table.prepend(native); f.app.settings.groupVersions = true;
    f.app.versions.stabilizeLayouts(); assert.equal(table.querySelector('colgroup'), native);
    assert.equal(table.classList.contains('epc-stable-columns'), false);
  } finally { f.close(); }
});

test('[LAYOUT-02] hidden category and spanning title retain the correct metadata column positions',async()=>{
  const rows=Array.from({length:201},(_,i)=>rowHTML(i+1)).join('');
  const f=await setup(rows,'',{},f=>{
    for(const row of f.doc.querySelectorAll('tr.torrent')){row.cells[0].hidden=true;row.cells[1].colSpan=2;}
    columnGeometry(f,[40,540,40,60,80,70,30,30,30,80],true);
  });
  try{
    const table=f.doc.querySelector('table.torrent_table'),cols=[...table.querySelector('colgroup').children];
    assert.equal(cols.length,10);assert.equal(cols[0].style.width,'');assert.equal(cols[1].style.width,'');
    assert.deepEqual(cols.slice(2).map(c=>c.style.width),['40px','60px','80px','70px','30px','30px','30px','80px']);
    assert.equal(table.style.getPropertyValue('--epc-table-min-width'),'600px');
    f.app.settings.groupVersions=false;f.app.syncGridFilters();
    assert.equal(table.querySelector('colgroup'),null);assert.equal(table.style.getPropertyValue('--epc-table-min-width'),'');
    assert.equal(table.querySelector('tr.torrent').cells[1].colSpan,2,'native category/title spans are not rewritten by layout ownership');
  }finally{f.close();}
});

test('[LAYOUT-02] a backfill batch measures the completed native table once and Stop restores layout',async()=>{
  const widths=[40,540,40,60,80,70,30,30,30,80],rows=Array.from({length:201},(_,i)=>rowHTML(i+1)).join('');
  const f=await setup(rows,'',{},f=>columnGeometry(f,widths));
  try{
    const table=f.doc.querySelector('table.torrent_table');let reads=0;
    f.app.options.fetch=async url=>{
      reads++;assert.equal(table.classList.contains('epc-stable-columns'),false,'fetched rows must join native automatic layout');
      f.app.versions.stabilizeLayouts();assert.equal(table.querySelector('colgroup'),null,'do not freeze an incomplete batch');
      widths[4]=130;
      return {ok:true,url,redirected:false,headers:{get:()=> 'text/html'},text:async()=>fixtureHTML(rowHTML(202),overlayHTML(202,'https://x.test/202.jpg'))};
    };
    await f.app.backfill.run();assert.equal(reads,1);
    assert.equal(table.querySelectorAll('tr.torrent').length,202);
    assert.equal(table.querySelector('colgroup').children[4].style.width,'130px','new time-column width must be captured after backfill');
    assert.equal(table.style.getPropertyValue('--epc-table-min-width'),'690px');
    f.app.backfill.busy=true;f.app.versions.releaseLayout(table);assert.equal(table.querySelector('colgroup'),null);
    f.app.backfill.stop();assert.ok(table.querySelector('colgroup'),'Stop keeps loaded rows readable and stabilized');
  }finally{f.close();}
});
