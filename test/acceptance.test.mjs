import test from 'node:test';
import assert from 'node:assert/strict';
import {boot,strictStorage,clickText,pane,field,rowHTML,overlayHTML,settle} from './acceptance-helpers.mjs';
import {createApp} from '../src/app.mjs';
import {readFile} from 'node:fs/promises';
import {domFixture,memoryStorage,fakeClock} from './helpers.mjs';

test('[PREF-03] a late autosave failure rolls back filter writes and keeps the draft retryable',async()=>{
  const f=await boot({nseTaglist:'original.tag'});
  try{
    pane(f,'filters');f.store.failNext('ep.preferenceUndo');
    await field(f,'#nseBlacklistTaglistArea','changed.tag');
    assert.equal(f.store.get('nseTaglist'),'original.tag','failed autosave must not partially replace filters');
    assert.equal(f.doc.getElementById('nseBlacklistTaglistArea').value,'changed.tag');
    assert.match(f.doc.querySelector('.epc-savebar [role=status]').textContent,/Could not save/);
    await field(f,'#nseBlacklistTaglistArea','changed.tag');assert.equal(f.store.get('nseTaglist'),'changed.tag');
    assert.equal(f.errors.length,0,f.errors.join('\n'));
  }finally{f.close();}
});

test('[SEA-06] failed quick-save leaves durable searches, visible shortcuts and export state consistent',async()=>{
  const f=await boot();
  try{
    f.doc.querySelector('#search_form [name=taglist]').value='new.tag';f.store.failNext('ep.searches');
    clickText(f.doc.querySelector('.epc-workspace'),'Save search');await settle();
    assert.deepEqual(f.store.get('ep.searches',[]),[]);
    assert.equal(f.doc.querySelectorAll('.epc-saved-shortcut').length,0);
    assert.match(f.doc.querySelector('.epc-notice').textContent,/Could not save/i);
    assert.equal(f.errors.length,0,'storage failure must be reported rather than escaping the click handler');
  }finally{f.close();}
});

test('[SEA-06] failed rename, deletion and deletion Undo preserve the prior library and retry controls',async()=>{
  const saved=[{id:'a',title:'Original',fields:[{name:'taglist',type:'textarea',value:'sample.tag',checked:false}]}];
  const f=await boot({'ep.searches':saved});
  try{
    pane(f,'searches');clickText(f.doc.querySelector('.epc-saved-list'),'Rename');
    f.doc.querySelector('[aria-label="Rename saved search"]').value='Renamed';f.store.failNext('ep.searches');
    clickText(f.doc.querySelector('.epc-saved-list'),'Save name');await settle();
    assert.equal(f.store.get('ep.searches')[0].title,'Original');
    assert.ok(f.doc.querySelector('[aria-label="Rename saved search"]'),'failed rename retains its draft');
    clickText(f.doc.querySelector('.epc-saved-list'),'Cancel');
    f.store.failNext('ep.searches');clickText(f.doc.querySelector('.epc-saved-list'),'Delete');await settle();
    assert.equal(f.store.get('ep.searches').length,1);assert.equal(f.doc.querySelector('.epc-saved-shortcut').textContent,'Original');
    clickText(f.doc.querySelector('.epc-saved-list'),'Delete');assert.equal(f.store.get('ep.searches').length,0);
    f.store.failNext('ep.searches');clickText(f.doc.querySelector('.epc-saved-list'),'Undo last deletion');await settle();
    assert.equal(f.store.get('ep.searches').length,0);assert.ok([...f.doc.querySelectorAll('button')].find(n=>n.textContent==='Undo last deletion'));
    clickText(f.doc.querySelector('.epc-saved-list'),'Undo last deletion');assert.equal(f.store.get('ep.searches').length,1);
    assert.equal(f.errors.length,0,f.errors.join('\n'));
  }finally{f.close();}
});

test('[HOV-08] removing a hovered result closes the transient preview without another mouse movement',async()=>{
  const f=await boot({'ep.settings':{inlineThumbnails:true}});
  try{
    const button=f.doc.querySelector('.epc-thumb-button');
    button.dispatchEvent(new f.win.MouseEvent('pointerenter',{clientX:40,clientY:40}));await settle(15);
    assert.equal(f.doc.querySelector('.epc-preview').hidden,false);
    button.closest('tr').remove();await settle(80);
    assert.equal(f.doc.querySelector('.epc-preview').hidden,true,'removed result must not leave an orphan hover');
  }finally{f.close();}
});

test('[PERF-02] removed native results release preview bindings and table-layout references',async()=>{
  const f=domFixture(),clock=fakeClock(),store=memoryStorage({'ep.settings':{inlineThumbnails:true}});
  f.doc.querySelector('#content').insertAdjacentHTML('beforeend',overlayHTML(1,'https://x.test/one.jpg'));
  const app=createApp(f.win,store,{Image:clock.env.Image}).start();await settle(90);
  try{
    const row=f.doc.querySelector('.torrent_table tr'),links=[...row.querySelectorAll('a,button')];
    assert.ok(links.some(link=>app.preview.bound.has(link)));
    row.remove();await settle(90);
    assert.equal(links.some(link=>app.preview.bound.has(link)),false,'removed rows must leave the preview binding map');
    assert.equal(app.media.pool.active,0,'removed images must release active slots');
    assert.equal(app.media.pool.queue.length,0,'removed images must leave no ineligible queue entries');
  }finally{app.dispose();f.close();}
});

test('[HOV-08] a pinned preview retains working Retry and Close after its originating row is removed',async()=>{
  const f=domFixture(),clock=fakeClock(),store=memoryStorage({'ep.settings':{inlineThumbnails:true}});
  f.doc.querySelector('#content').insertAdjacentHTML('beforeend',overlayHTML(1,'https://hamsterimg.net/images/pin.jpg'));
  const app=createApp(f.win,store,{Image:clock.env.Image}).start();await settle(90);
  try{
    const button=f.doc.querySelector('.epc-thumb-button');button.click();assert.equal(app.preview.pinned,true);
    button.closest('tr').remove();await settle(90);assert.equal(app.preview.open,true);
    const before=clock.images.length;app.preview.retry();assert.equal(clock.images.length,before+1);
    clock.images.at(-1).succeed();assert.equal(app.preview.element.dataset.state,'ready');
    app.preview.pin();assert.equal(app.preview.open,false);assert.equal(app.preview.anchor,null);
  }finally{app.dispose();f.close();}
});

test('[BOOT-02] [PREF-01] [TAG-04] rules, highlight lists and customized settings survive a cloned-storage reload',async()=>{
  const store=strictStorage({'ep.settings':{inlineThumbnails:false,thumbnailSize:88,concurrency:4}});
  let f=await boot({}, {store});
  try{
    pane(f,'filters');await field(f,'#nseBlacklistTaglistArea','blocked.tag');
    const liked = f.doc.querySelector('[data-tag-category=favorite]');
    liked.querySelector('textarea').value = 'sample.tag';
    [...liked.querySelectorAll('button')].find(button => button.textContent === 'Save tags').click(); f.close();
    f=await boot({}, {store});pane(f,'settings');
    assert.equal(f.doc.querySelector('[data-setting=thumbnailSize]').value,'88');assert.equal(store.get('ep.settings').concurrency,4);
    pane(f,'filters');assert.equal(f.doc.getElementById('nseBlacklistTaglistArea').value,'blocked.tag');
    assert.equal(f.doc.querySelector('.tags a').dataset.epTagTone,'favorite');
    assert.equal(f.errors.length,0,f.errors.join('\n'));
  }finally{f.close();}
});

test('saving from an older tab preserves hover and filter changes made in another tab', async () => {
  const store = strictStorage({ 'ep.settings': { inlineThumbnails: false, previews: false } });
  const first = await boot({}, { store }), second = await boot({}, { store });
  try {
    pane(first, 'settings'); pane(second, 'settings');
    await field(first, '[data-setting=previews]', true);
    await field(first, '#nseCheckHideReported', true);
    await field(second, '[data-setting=thumbnailSize]', '120');
    pane(second, 'filters');
    await field(second, '#nseBlacklistTaglistArea', 'landscape');
    assert.equal(store.get('ep.settings').previews, true);
    assert.equal(store.get('ep.settings').thumbnailSize, 120);
    assert.equal(store.get('nseHideReportedEnabled'), true);
    assert.equal(store.get('nseTaglist'), 'landscape');
    first.win.dispatchEvent(new first.win.Event('focus'));
    assert.equal(first.doc.querySelector('[data-setting=thumbnailSize]').value, '120');
  } finally { first.close(); second.close(); }
});

test('preference Undo leaves unrelated changes from another tab in place', async () => {
  const store = strictStorage({ 'ep.settings': { inlineThumbnails: false } });
  const first = await boot({}, { store }), second = await boot({}, { store });
  try {
    pane(first, 'settings'); pane(second, 'settings');
    await field(first, '[data-setting=previews]', false);
    await field(second, '[data-setting=thumbnailSize]', '120');
    clickText(first.doc.querySelector('.epc-workspace'), 'Undo changes');
    assert.equal(store.get('ep.settings').previews, true);
    assert.equal(store.get('ep.settings').thumbnailSize, 120);
  } finally { first.close(); second.close(); }
});

test('simultaneous saves from independent manager snapshots retain both preferences on reload', async () => {
  const initial = { 'ep.settings': { inlineThumbnails: false, previews: false }, 'ep.mediaRevision': 2 };
  const store = strictStorage(initial), cached = strictStorage(initial);
  const secondStore = { ...cached, set(key, value) { cached.set(key, value); store.set(key, value); } };
  const first = await boot({}, { store }), second = await boot({}, { store: secondStore });
  try {
    pane(first, 'settings'); pane(second, 'settings');
    await field(first, '[data-setting=previews]', true);
    await field(second, '[data-setting=thumbnailSize]', '120');
    const reloaded = await boot({}, { store });
    try {
      assert.equal(reloaded.doc.querySelector('[data-setting=previews]').checked, true);
      assert.equal(reloaded.doc.querySelector('[data-setting=thumbnailSize]').value, '120');
    } finally { reloaded.close(); }
  } finally { first.close(); second.close(); }
});

test('a rule draft cannot overwrite newer rules saved in another tab', async () => {
  const store = strictStorage({ 'ep.settings': { inlineThumbnails: false } });
  const first = await boot({}, { store }), second = await boot({}, { store });
  try {
    pane(first, 'filters'); pane(second, 'filters');
    const draft = first.doc.querySelector('.epc-conditional-advanced textarea');
    draft.value = 'HIDE: $TA{first}';
    draft.dispatchEvent(new first.win.Event('input', { bubbles: true }));
    const other = second.doc.querySelector('.epc-conditional-advanced textarea');
    other.value = 'HIDE: $TA{second}';
    other.dispatchEvent(new second.win.Event('input', { bubbles: true }));
    clickText(other.closest('details'), 'Apply rule text');
    first.win.dispatchEvent(new first.win.Event('focus'));
    const apply = clickText(draft.closest('details'), 'Apply rule text');
    assert.equal(apply.disabled, true);
    assert.equal(draft.value, 'HIDE: $TA{first}');
    assert.equal(store.get('ep.settings').conditionalRules, 'HIDE: $TA{second}');
  } finally { first.close(); second.close(); }
});

test('[SEA-01] saved complete criteria survive a reload with JSON-cloned manager storage',async()=>{
  const store=strictStorage({'ep.settings':{inlineThumbnails:false}});let f=await boot({}, {store});
  try{
    const form=f.doc.getElementById('search_form');form.elements.searchtext.value='landscape';form.elements.taglist.value='panorama';form.elements['filter_cat[2]'].checked=true;form.elements.order_by.value='size';
    clickText(f.doc.querySelector('.epc-workspace'),'Save search');f.close();f=await boot({}, {store});
    const link=f.doc.querySelector('.epc-saved-shortcut'),url=new URL(link.href);
    assert.equal(url.searchParams.get('taglist'),'panorama');assert.equal(url.searchParams.get('filter_cat[2]'),'1');
    assert.equal(url.searchParams.get('order_by'),'size');assert.equal(url.searchParams.has('authkey'),false);
    assert.equal(f.doc.querySelector('.epc-panel').hidden,true);
  }finally{f.close();}
});

test('[HOV-07] disabling inline thumbnails cancels transfers with no remaining consumer',async()=>{
  const f=await boot({'ep.settings':{inlineThumbnails:true}});
  try{
    const image=f.doc.querySelector('.epc-thumb-button img');assert.equal(typeof image.onload,'function');pane(f,'settings');
    await field(f,'[data-setting=inlineThumbnails]',false);
    assert.equal(f.doc.querySelector('.epc-thumb-button'),null);
    assert.equal(image.onload,null,'turning thumbnails off must release its request');
    assert.equal(f.errors.length,0,f.errors.join('\n'));
  }finally{f.close();}
});

test('[SEA-05] rename respects IME and Escape keeps the Searches panel open',async()=>{
  const saved=[{id:'a',title:'Original',fields:[{name:'taglist',type:'textarea',value:'sample.tag',checked:false}]}];
  const f=await boot({'ep.searches':saved});
  try{
    pane(f,'searches');clickText(f.doc.querySelector('.epc-saved-list'),'Rename');const input=f.doc.querySelector('[aria-label="Rename saved search"]');input.value='Draft';
    input.dispatchEvent(new f.win.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));
    assert.equal(f.store.get('ep.searches')[0].title,'Original');
    input.dispatchEvent(new f.win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    assert.equal(f.doc.querySelector('.epc-panel').hidden,false);assert.equal(f.doc.querySelector('[aria-label="Rename saved search"]'),null);
    assert.equal(f.store.get('ep.searches')[0].title,'Original');
  }finally{f.close();}
});

test('[BOOT-04] unsupported origins stay untouched and the release declares no-frame execution',async()=>{
  assert.match(await readFile(new URL('../dist/EmporniumCompanion.user.js',import.meta.url),'utf8'),/^\/\/ @noframes$/m);
  const f=await boot({}, {url:'https://example.test/torrents.php'});
  try{assert.equal(f.doc.querySelector('.epc-workspace'),null);assert.equal(f.doc.querySelector('.epc-preview'),null);assert.equal(f.errors.length,0);}
  finally{f.close();}
});

test('[HOV-04] clicking the actual Unpin button does not bubble into re-pinning the enlargement',async()=>{
  const f=await boot({'ep.settings':{inlineThumbnails:true}});
  try{
    f.doc.querySelector('.epc-thumb-button').click();
    assert.equal(f.doc.querySelector('.epc-preview').dataset.mode,'controls');
    clickText(f.doc.querySelector('.epc-preview'),'Unpin (P)');
    assert.equal(f.doc.querySelector('.epc-preview').dataset.mode,'zoom');
    assert.equal(f.doc.querySelector('.epc-preview .epc-actions').hidden,true);
    assert.equal(f.errors.length,0,f.errors.join('\n'));
  }finally{f.close();}
});

test('[HOV-06] clicking another tool dismisses a transient keyboard preview before that tool handles the click',async()=>{
  const f=await boot({'ep.settings':{inlineThumbnails:true}});
  try{
    f.doc.querySelector('.epc-thumb-button').focus();await settle(20);
    assert.equal(f.doc.querySelector('.epc-preview').hidden,false);
    const tools=f.doc.querySelector('.epc-navigation [data-pane=searches]');
    tools.dispatchEvent(new f.win.MouseEvent('pointerdown',{bubbles:true}));
    assert.equal(f.doc.querySelector('.epc-preview').hidden,true,'an outside click must dismiss before another action is intercepted');
    tools.click();assert.equal(f.doc.querySelector('.epc-pane[data-pane=searches]').hidden,false);
  }finally{f.close();}
});

test('[PREF-02] numeric preference validation preserves other values and safely clamps on blur',async()=>{
  const f=await boot({'ep.settings':{inlineThumbnails:false,thumbnailSize:88,concurrency:4}});
  try{
    pane(f,'settings');const input=await field(f,'[data-setting=thumbnailSize]','999');
    assert.equal(f.store.get('ep.settings').thumbnailSize,88);assert.equal(input.getAttribute('aria-invalid'),'true');
    input.dispatchEvent(new f.win.FocusEvent('focusout',{bubbles:true}));await settle(80);
    assert.equal(f.store.get('ep.settings').thumbnailSize,300);assert.equal(f.store.get('ep.settings').concurrency,4);
    assert.equal(f.errors.length,0,f.errors.join('\n'));
  }finally{f.close();}
});

test('[HOV-02] returning after original-cache eviction still displays the upgraded image',async()=>{
  const f=domFixture(),clock=fakeClock(),store=memoryStorage({'ep.settings':{inlineThumbnails:true}});
  f.doc.querySelector('#content').insertAdjacentHTML('beforeend',overlayHTML(1,'https://hamsterimg.net/images/evict.jpg'));
  const app=createApp(f.win,store,{Image:clock.env.Image}).start();await settle(90);
  try{
    const row=f.doc.querySelector('.torrent_table tr'),record=app.media.thumbnails.get(row),button=record.element.querySelector('button');clock.images[0].succeed(160,90);
    Object.defineProperty(record.image,'naturalWidth',{get:()=>160});
    button.dispatchEvent(new f.win.MouseEvent('pointerenter',{clientX:40,clientY:40}));await settle(10);clock.images[1].succeed(900,600);
    button.dispatchEvent(new f.win.MouseEvent('pointerleave',{clientX:900,clientY:900}));
    app.media.pool.settings.cacheEntries=1;
    const other=app.media.pool.request('https://x.test/other.jpg',{lane:'large',keepAlive:true});clock.images.at(-1).succeed();app.media.pool.trim();
    assert.equal(app.media.pool.entries.has('https://hamsterimg.net/images/evict.jpg|normal'),false);
    button.dispatchEvent(new f.win.MouseEvent('pointerenter',{clientX:40,clientY:40}));await settle(10);
    assert.equal(app.preview.image.hidden,false);assert.match(app.preview.image.src,/evict\.jpg$/);
    assert.equal(app.preview.image.src,record.image.src);
    assert.equal(app.preview.element.dataset.state,'loading');
  }finally{app.dispose();f.close();}
});

test('[PERF-02] repeated result insertion and removal keeps DOM-owning maps and active work bounded',async()=>{
  const f=domFixture(),clock=fakeClock(),store=memoryStorage({'ep.settings':{inlineThumbnails:true}});
  const app=createApp(f.win,store,{Image:clock.env.Image}).start();await settle(90);
  try {
    const baseline={bound:app.preview.bound.size,thumbs:app.media.thumbnails.size,records:app.media.records.size,index:app.tags.originals.size};
    const table=f.doc.querySelector('.torrent_table');
    for(let batch=0;batch<10;batch++){
      const tbody=f.doc.createElement('tbody');tbody.innerHTML=Array.from({length:10},(_,i)=>rowHTML(100+batch*10+i)).join('');
      const definitions=f.doc.createElement('div');definitions.innerHTML=Array.from({length:10},(_,i)=>overlayHTML(100+batch*10+i,'https://x.test/churn-'+batch+'-'+i+'.jpg')).join('');
      f.doc.querySelector('#content').append(definitions);table.append(tbody);await settle(45);
      assert.equal(app.media.thumbnails.size,baseline.thumbs+10);
      tbody.remove();definitions.remove();await settle(45);
      assert.deepEqual({bound:app.preview.bound.size,thumbs:app.media.thumbnails.size,records:app.media.records.size,index:app.tags.originals.size},baseline,'batch '+batch+' releases DOM owners');
      assert.equal(app.media.pool.active,0);assert.equal(app.media.pool.queue.length,0);
    }
  } finally{app.dispose();f.close();}
});
