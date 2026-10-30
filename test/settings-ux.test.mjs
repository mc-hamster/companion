import test from 'node:test';import assert from 'node:assert/strict';
import {createApp} from '../src/app.mjs';import {domFixture,fixtureHTML,memoryStorage,until,settle} from './helpers.mjs';
async function boot(settings={}){
 const f=domFixture(fixtureHTML('')),store=memoryStorage({'ep.settings':{inlineThumbnails:false,...settings},nseTaglist:'keep.me'});let reads=0;
 const cache={enabled:()=>false,subscribe:()=>()=>{},summary:async()=>{reads++;return{available:true,saving:true,thumbnailCount:4,thumbnailFileBytes:2048,previewCount:0,previewBytes:0,bytes:2048,limitBytes:536870912,hits:2,misses:1,downloads:1,savedBytes:2048,sizedHits:2,recent:[[Math.floor(Date.now()/5000)*5000,2,1,1,2048,2]]};},flushTouches:async()=>{},close(){}};
 const app=createApp(f.win,store,{imageCache:cache}).start();await until(()=>app.root?.dataset.epReady==='true');app.openPane('settings');await until(()=>app.cacheUsage.getAttribute('aria-busy')==='false');
 return{...f,app,store,reads:()=>reads,close(){app.dispose();f.close();}};
}
test('[UI-04] Settings groups everyday choices and keeps cache metrics collapsed with no aging clock',async()=>{
 const f=await boot();try{assert.deepEqual([...f.doc.querySelectorAll('.epc-settings-section>h3')].map(n=>n.textContent),['Appearance','Browsing']);assert.equal(f.app.cacheDetails.open,false);assert.equal(f.app.cacheUsageClock,null);assert.equal(f.app.advancedSettings.open,false);
  for(const key of['previews','thumbnailSize','backfillMode','backfillPages','groupVersions'])assert.ok(f.app.controls.get(key).closest('.epc-basic-settings'));for(const key of f.app.controls.keys())assert.equal(f.doc.querySelectorAll('[data-setting="'+key+'"]').length,1);
  f.app.cacheDetails.open=true;await until(()=>!!f.app.cacheUsageClock);f.app.cacheDetails.open=false;await until(()=>f.app.cacheUsageClock===null);assert.equal(f.app.cacheUsageFields.total.textContent,'2.0 KB of 512 MB used');
 }finally{f.close();}
});
test('[UI-04] backfill mode saves in context, hides irrelevant page count, and preserves unrelated preferences',async()=>{
 const f=await boot({backfillEnabled:false});try{const mode=f.app.controls.get('backfillMode'),pages=f.app.controls.get('backfillPages');mode.value='all';mode.dispatchEvent(new f.win.Event('change',{bubbles:true}));await until(()=>f.store.get('ep.settings').backfillMode==='all');assert.equal(pages.closest('label').hidden,true);assert.equal(f.store.get('ep.settings').backfillEnabled,true);assert.equal(f.store.get('nseTaglist'),'keep.me');
  mode.value='pages';mode.dispatchEvent(new f.win.Event('change',{bubbles:true}));await until(()=>f.store.get('ep.settings').backfillMode==='pages');assert.equal(pages.closest('label').hidden,false);assert.equal(pages.closest('label').querySelector('span').textContent,'Additional pages');mode.value='off';mode.dispatchEvent(new f.win.Event('change',{bubbles:true}));await settle();assert.equal(pages.closest('label').querySelector('span').textContent,'Pages per click');
 }finally{f.close();}
});
test('[UI-04] top-level search finds cache and advanced settings and restores disclosures without saving',async()=>{
 const f=await boot({backfillMode:'all'});try{const input=f.app.settingsSearch,before=JSON.stringify([...f.store.data]);input.value='cache';input.dispatchEvent(new f.win.Event('input',{bubbles:true}));assert.equal(f.app.cacheDetails.open,true);assert.equal(f.app.controls.get('persistentCacheMB').closest('label').hidden,false);assert.equal(f.app.optionGroups.loading.open,true);
  input.value='versions';input.dispatchEvent(new f.win.Event('input',{bubbles:true}));assert.equal(f.app.controls.get('groupVersions').closest('label').hidden,false);assert.equal(f.app.controls.get('backfillPages').closest('label').hidden,true);
  input.value='';input.dispatchEvent(new f.win.Event('input',{bubbles:true}));assert.equal(f.app.cacheDetails.open,false);assert.equal(f.app.advancedSettings.open,false);assert.equal(f.app.controls.get('backfillPages').closest('label').hidden,true);assert.equal(JSON.stringify([...f.store.data]),before);
 }finally{f.close();}
});
