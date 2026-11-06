import test from 'node:test';import assert from 'node:assert/strict';
import {createApp} from '../src/app.mjs';import {cacheBytes} from '../src/image-cache.mjs';
import {domFixture,fixtureHTML,memoryStorage,until,settle} from './helpers.mjs';
async function setup({store=memoryStorage({'ep.settings':{inlineThumbnails:false}}),html=fixtureHTML(''),url}={}){
  const f=domFixture(html,url),listeners=new Set();let calls=0,pending;
  let state={available:true,saving:true,thumbnailCount:4,thumbnailFileBytes:2048,previewCount:1,previewBytes:1024,bytes:3072,limitBytes:512*1024*1024,hits:8,misses:3,downloads:2,recent:[[Math.floor(Date.now()/5000)*5000,5,3,2]]};
  const cache={subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},summary:()=>{calls++;return pending?new Promise(resolve=>{pending.resolve=resolve;}):Promise.resolve({...state});},enabled:()=>false,
    resetActivity:async()=>{state={...state,hits:0,misses:0,downloads:0,savedBytes:0,sizedHits:0,recent:[]};for(const fn of listeners)fn();},clear:async()=>{state={...state,thumbnailCount:0,thumbnailFileBytes:0,previewCount:0,previewBytes:0,bytes:0};for(const fn of listeners)fn();},flushTouches:async()=>{},close(){listeners.clear();}};
  const app=createApp(f.win,store,{imageCache:cache}).start();await until(()=>app.root?.dataset.epReady==='true');app.cacheDetails.open=true;await settle();
  return{...f,app,cache,listeners,calls:()=>calls,set:s=>{state={...state,...s};},emit:()=>{for(const fn of listeners)fn();},defer:()=>{pending={};return pending;},immediate:()=>{pending=null;},close(){app.dispose();f.close();}};
}
test('[CACHE-05] Settings shows one concise usage card with file sizes, budget and explicitly cumulative counters',async()=>{
  const f=await setup();try{assert.equal(f.calls(),0);f.app.openPane('settings');await until(()=>f.app.cacheUsage.getAttribute('aria-busy')==='false');
    assert.equal(f.app.cacheUsageFields.thumbnails.textContent,'4 · 2.0 KB');assert.equal(f.app.cacheUsageFields.previews.textContent,'1 · 1.0 KB');
    assert.equal(f.app.cacheUsageFields.total.textContent,'3.0 KB of 512 MB used');assert.equal(f.app.cacheActivityRows.all.hits.textContent,'8');assert.equal(f.app.cacheActivityRows.all.misses.textContent,'3');assert.equal(f.app.cacheActivityRows.all.downloads.textContent,'2');assert.equal(f.doc.querySelectorAll('.epc-cache-usage').length,1);
    f.app.closePane();const before=f.calls();for(let i=0;i<10;i++)f.emit();await settle(300);assert.equal(f.calls(),before);assert.equal(f.app.cacheUsageTimer,null,'closed Settings must not poll or schedule reads');assert.equal(f.app.cacheUsageClock,null);
  }finally{f.close();}
});
test('[CACHE-05] visible cache changes coalesce and Clear refreshes counts without resetting activity',async()=>{
  const f=await setup();try{f.app.openPane('settings');await until(()=>f.app.cacheUsage.getAttribute('aria-busy')==='false');const before=f.calls();f.set({thumbnailCount:10});for(let i=0;i<10;i++)f.emit();await until(()=>f.app.cacheUsageFields.thumbnails.textContent.startsWith('10 ·'));assert.equal(f.calls(),before+1);f.set({hits:1,downloads:1});f.emit();await until(()=>f.app.cacheActivityRows.all.hits.textContent==='1'&&f.app.cacheActivityRows.all.downloads.textContent==='1');f.set({hits:8,misses:3,downloads:2,recent:[[Math.floor(Date.now()/5000)*5000,5,3,2]]});
    [...f.doc.querySelectorAll('button')].find(b=>b.textContent==='Clear saved images').click();await until(()=>f.app.cacheUsageFields.total.textContent.startsWith('0 B'));assert.equal(f.app.cacheUsageFields.thumbnails.textContent,'0 · 0 B');assert.equal(f.app.cacheActivityRows.all.hits.textContent,'8');assert.equal(f.app.cacheActivityRows.all.misses.textContent,'3');assert.equal(f.app.cacheActivityRows.all.downloads.textContent,'2');
  }finally{f.close();}
});
test('[CACHE-05] closing/switching Settings ignores stale reads and unavailable storage is not reported as an empty cache',async()=>{
  const f=await setup();try{const pending=f.defer();f.app.openPane('settings');await until(()=>!!pending.resolve);f.app.openPane('searches');pending.resolve({available:true,thumbnailCount:999});await settle();assert.equal(f.app.cacheUsageFields.thumbnails.textContent,'—');
    f.immediate();f.set({available:false});f.app.openPane('settings');await until(()=>f.app.cacheUsage.getAttribute('aria-busy')==='false');assert.equal(f.app.cacheUsageFields.total.textContent,'Saved image storage unavailable.');assert.equal(f.app.cacheUsageFields.thumbnails.textContent,'—');
  }finally{f.close();}
});
test('[CACHE-05] cache byte formatting is compact at zero, KB, MB and GB',()=>{
  assert.equal(cacheBytes(0),'0 B');assert.equal(cacheBytes(509),'509 B');assert.equal(cacheBytes(1536),'1.5 KB');assert.equal(cacheBytes(512*1024**2),'512 MB');assert.equal(cacheBytes(1024**3),'1.0 GB');
});

test('[CACHE-06] Reset stats clears only usage counters and keeps the existing saved-file summary',async()=>{
  const f=await setup();try{f.app.openPane('settings');await until(()=>f.app.cacheUsage.getAttribute('aria-busy')==='false');
    const button=f.doc.querySelector('[aria-label="Reset cache usage statistics"]');assert.ok(button);button.click();
    await until(()=>f.app.cacheActivityRows.all.hits.textContent==='0'&&f.app.cacheActivityRows.all.misses.textContent==='0'&&f.app.cacheActivityRows.all.downloads.textContent==='0');
    assert.equal(button.disabled,false);for(const row of Object.values(f.app.cacheActivityRows))assert.equal(row.hitRate.textContent,'—');assert.equal(f.app.cacheUsageFields.thumbnails.textContent,'4 · 2.0 KB');assert.equal(f.app.cacheUsageFields.total.textContent,'3.0 KB of 512 MB used');
    f.cache.resetActivity=async()=>{throw Error('Blocked');};button.click();await until(()=>f.app.cacheUsageFields.activity.textContent.includes('Could not reset'));
    assert.equal(button.disabled,false);assert.equal(f.app.cacheUsageFields.thumbnails.textContent,'4 · 2.0 KB');
  }finally{f.close();}
});

test('[CACHE-07] one four-window activity table shows hits, misses and downloads with individual header tooltips',async()=>{
  const f=await setup();try{f.app.openPane('settings');await until(()=>f.app.cacheUsage.getAttribute('aria-busy')==='false');
    const table=f.doc.querySelector('table[aria-label="Cache activity"]');assert.ok(table);assert.equal(table.querySelectorAll('tbody tr').length,4);
    const headers=[...table.querySelectorAll('thead th')];
    assert.deepEqual(headers.map(x=>x.textContent),['Period','Hits','Misses','Hit rate','Downloads','Saved']);
    for (const [index, description] of [/Rolling time window/, /memory or saved files/, /no usable image/, /Hits ÷/, /decoded successfully/, /image data reused/].entries()) {
      assert.match(headers[index].title, description);
    }
    for(const key of['five','fifteen','hour']){assert.equal(f.app.cacheActivityRows[key].hits.textContent,'5');assert.equal(f.app.cacheActivityRows[key].misses.textContent,'3');assert.equal(f.app.cacheActivityRows[key].downloads.textContent,'2');}
    assert.equal(f.app.cacheActivityRows.five.hitRate.textContent,'62.5%');assert.equal(f.app.cacheActivityRows.all.hitRate.textContent,'72.7%');
    f.set({hits:0,misses:5});await f.app.refreshCacheUsage();assert.equal(f.app.cacheActivityRows.all.hitRate.textContent,'0%');
    f.set({hits:5,misses:0});await f.app.refreshCacheUsage();assert.equal(f.app.cacheActivityRows.all.hitRate.textContent,'100%');assert.ok(f.app.cacheUsageClock);f.app.closePane();assert.equal(f.app.cacheUsageClock,null);
  }finally{f.close();}
});

test('pinned cache statistics stay visible outside Settings and persist across page loads', async () => {
  const store = memoryStorage({'ep.settings':{inlineThumbnails:false}});
  const first = await setup({store});
  try {
    const { app } = first;
    assert.equal(app.cachePinned.hidden, true);
    app.openPane('settings');
    app.cachePinButton.click();
    assert.equal(app.cachePinButton.textContent, 'Unpin statistics');
    assert.ok(app.cachePinned.contains(app.cacheActivityTable));
    assert.equal(first.doc.querySelectorAll('.epc-cache-activity').length, 1);
    app.openPane('searches');
    app.closePane();
    assert.equal(app.panel.hidden, true);
    assert.equal(app.cachePinned.hidden, false);
    first.set({hits: 12}); first.emit();
    await until(() => app.cacheActivityRows.all.hits.textContent === '12');
    assert.ok(app.cacheUsageClock);
  } finally { first.close(); }

  const second = await setup({store, html:'<!doctype html><main id="content">Profile</main>', url:'https://www.empornium.sx/user.php?id=10'});
  try {
    const { app } = second;
    assert.equal(app.panel.hidden, true);
    assert.equal(app.cachePinned.hidden, false);
    assert.ok(app.cachePinned.contains(app.cacheActivityTable));
    assert.equal(app.cacheActivityRows.all.hits.textContent, '8');
    const unpin = app.cachePinned.querySelector('button');
    unpin.focus(); unpin.click();
    assert.equal(app.cachePinned.hidden, true);
    assert.ok(app.cacheDetails.contains(app.cacheActivityTable));
    assert.equal(second.doc.activeElement, app.paneButtons.get('settings'));
    assert.equal(app.cacheUsageClock, null);
    second.emit();
    assert.equal(app.cacheUsageTimer, null);
  } finally { second.close(); }

  const third = await setup({store});
  try {
    assert.equal(third.app.cachePinned.hidden, true);
    assert.equal(third.app.cachePinButton.textContent, 'Pin statistics');
    assert.equal(third.calls(), 0);
  } finally { third.close(); }
});
test('[CACHE-07] rolling totals age from a local snapshot without database polling and stop when closed',async()=>{
  const f=await setup(),originalNow=Date.now;let tick,serial=90000,cleared=0;const timeout=f.win.setTimeout.bind(f.win),clear=f.win.clearTimeout.bind(f.win);
  try{f.win.setTimeout=(fn,ms)=>ms===5000?(tick=fn,serial++):timeout(fn,ms);f.win.clearTimeout=id=>{if(id>=90000)cleared++;else clear(id);};
    const now=Math.floor(originalNow()/5000)*5000;f.set({savedBytes:4096,sizedHits:4,recent:[[now,2,1,1,1024,2]]});f.app.openPane('settings');await until(()=>f.app.cacheUsage.getAttribute('aria-busy')==='false');const reads=f.calls();
    Date.now=()=>now+305000;tick();assert.equal(f.app.cacheActivityRows.five.hits.textContent,'0');assert.equal(f.app.cacheActivityRows.fifteen.hits.textContent,'2');assert.equal(f.app.cacheActivityRows.five.hitRate.textContent,'—');assert.equal(f.app.cacheActivityRows.fifteen.hitRate.textContent,'66.7%');assert.equal(f.app.cacheActivityRows.five.savedBytes.textContent,'0 B');assert.equal(f.app.cacheActivityRows.fifteen.savedBytes.textContent,'1.0 KB');assert.equal(f.app.cacheActivityRows.all.savedBytes.textContent,'≥4.0 KB');assert.equal(f.app.cacheActivityRows.all.hits.textContent,'8');assert.equal(f.calls(),reads);
    Date.now=()=>now+3605000;tick();assert.equal(f.app.cacheActivityRows.hour.hits.textContent,'0');assert.equal(f.app.cacheActivityRows.hour.hitRate.textContent,'—');assert.equal(f.app.cacheActivityRows.hour.savedBytes.textContent,'0 B');assert.equal(f.app.cacheUsageClock,null);assert.equal(f.calls(),reads);assert.ok(cleared>0);
  }finally{Date.now=originalNow;f.close();}
});
test('[CACHE-07] unavailable usage hides stale totals and legacy tracking is explained',async()=>{
  const f=await setup();try{f.set({historyPartial:true});f.app.openPane('settings');await until(()=>f.app.cacheUsage.getAttribute('aria-busy')==='false');assert.match(f.app.cacheUsageFields.activity.textContent,/Older totals predate miss tracking/);assert.equal(f.app.cacheActivityRows.all.hitRate.textContent,'—');assert.match(f.app.cacheActivityRows.all.hitRate.title,/older hits/);assert.equal(f.app.cacheActivityRows.five.hitRate.textContent,'62.5%');
    f.set({activityAvailable:false});await f.app.refreshCacheUsage();assert.equal(f.app.cacheActivityTable.hidden,true);assert.equal(f.app.cacheUsageFields.activity.textContent,'Usage history unavailable.');assert.equal(f.app.cacheUsageClock,null);
  }finally{f.close();}
});

test('[CACHE-08] Saved shows known reused bytes, lower bounds or unavailable data without extra controls',async()=>{
  const f=await setup();try{const now=Math.floor(Date.now()/5000)*5000;f.set({hits:4,misses:1,downloads:1,savedBytes:4096,sizedHits:4,recent:[[now,2,1,1,2048,2]]});f.app.openPane('settings');await until(()=>f.app.cacheUsage.getAttribute('aria-busy')==='false');
    assert.equal(f.app.cacheActivityRows.five.savedBytes.textContent,'2.0 KB');assert.equal(f.app.cacheActivityRows.all.savedBytes.textContent,'4.0 KB');assert.match(f.app.cacheUsageFields.activity.textContent,/Saved estimates/);
    f.set({hits:5});await f.app.refreshCacheUsage();assert.equal(f.app.cacheActivityRows.all.savedBytes.textContent,'≥4.0 KB');
    f.set({savedBytes:0,sizedHits:0});await f.app.refreshCacheUsage();assert.equal(f.app.cacheActivityRows.all.savedBytes.textContent,'—');assert.match(f.app.cacheActivityRows.all.savedBytes.title,/unknown|unmeasured/);
    f.doc.querySelector('[aria-label="Reset cache usage statistics"]').click();await until(()=>f.app.cacheActivityRows.all.hits.textContent==='0');assert.equal(f.app.cacheActivityRows.all.savedBytes.textContent,'0 B');assert.equal(f.app.cacheActivityRows.five.savedBytes.textContent,'0 B');assert.equal(f.app.cacheUsageFields.thumbnails.textContent,'4 · 2.0 KB');
  }finally{f.close();}
});
