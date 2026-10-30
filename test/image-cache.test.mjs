import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {PersistentImageCache,IMAGE_CACHE_HOSTS,cacheActivityWindows} from '../src/image-cache.mjs';
import {MediaPool,DEFAULTS} from '../src/core.mjs';
import {fakeClock,until,settle,domFixture,fixtureHTML,rowHTML,overlayHTML,memoryStorage} from './helpers.mjs';
import {createApp} from '../src/app.mjs';
const url='https://hamsterimg.net/images/persist.th.jpg';
const blob=(size=12)=>new Blob([new Uint8Array(size)],{type:'image/png'});
function setup({indexedDB=new IDBFactory(),request,limit=512}={}){
  let time=10000;const settings={persistentImages:true,persistentCacheMB:limit};
  const env={indexedDB,origin:'https://www.empornium.sx',now:()=>time,setTimeout,clearTimeout,request,
    encode:async b=>'data:'+b.type+';base64,'+Buffer.from(await b.arrayBuffer()).toString('base64')};
  const cache=new PersistentImageCache(env,()=>settings);return{cache,env,settings,tick:ms=>{time+=ms;}};
}
function load(cache,options={},source=url){return new Promise(resolve=>cache.load(source,options,resolve));}
test('[CACHE-01] actual image bytes survive closing/reopening the database without expiry',async()=>{
  const f=setup();let second;
  try{assert.equal(await f.cache.commit(url,blob()),true);f.cache.close();second=setup({indexedDB:f.env.indexedDB});second.tick(400*86400000);
    const cached=await second.cache.get(url);assert.equal(cached.size,12);assert.equal((await second.cache.stats()).count,1);
    assert.equal((await second.cache.get(url+'?_ep_retry=123')).size,12,'our retry tokens share the same key');
  }finally{f.cache.close();second?.cache.close();}
});
test('[CACHE-01] one network miss produces a reusable payload; subsequent navigation-style loads make no request',async()=>{
  let calls=0,details;const f=setup({request:d=>{calls++;details=d;queueMicrotask(()=>d.onload({status:200,response:blob(),finalUrl:d.url}));return{abort(){}};}});
  try{const first=await load(f.cache,{network:true});assert.equal(first.hit,false);assert.equal(details.anonymous,true);assert.equal(details.redirect,'error');assert.match(first.dataURL,/^data:image\/png;base64,/);
    await f.cache.commit(url,first.blob,first.epoch);const second=await load(f.cache,{network:true});assert.equal(second.hit,true);assert.equal(second.dataURL,first.dataURL);assert.equal(calls,1);
  }finally{f.cache.close();}
});
test('[CACHE-02] LRU byte pressure removes oldest bytes, touches protect recent images and replacements do not inflate accounting',async()=>{
  const f=setup({limit:30/(1024*1024)}),a=url,b=url.replace('persist','b'),c=url.replace('persist','c');
  try{await f.cache.commit(a,blob());f.tick(10);await f.cache.commit(b,blob());f.tick(10);await f.cache.get(a);await f.cache.flushTouches();f.tick(10);await f.cache.commit(c,blob());
    assert.equal(await f.cache.get(b),null);assert.ok(await f.cache.get(a));assert.ok(await f.cache.get(c));
    const s=await f.cache.stats();assert.equal(s.bytes,24);assert.equal(s.count,2);
    await f.cache.commit(c,blob(5));assert.equal((await f.cache.stats()).bytes,17);assert.equal((await f.cache.stats()).count,2);
  }finally{f.cache.close();}
});
test('[CACHE-02] concurrent tab-style writers preserve atomic byte/count totals',async()=>{
  const f=setup(),g=setup({indexedDB:f.env.indexedDB});
  try{await Promise.all(Array.from({length:20},(_,i)=>(i%2?f:g).cache.commit(url+'?image='+i,blob(10))));
    const s=await f.cache.stats();assert.equal(s.count,20);assert.equal(s.bytes,200);
  }finally{f.cache.close();g.cache.close();}
});
test('[CACHE-03] clear invalidates in-flight generations and never accepts stale writes',async()=>{
  let response;const f=setup({request:d=>{response=d;return{abort(){}};}});
  try{await f.cache.commit(url,blob());const pending=load(f.cache,{network:true,fresh:true});await until(()=>!!response);await f.cache.clear();response.onload({status:200,response:blob()});const result=await pending;
    assert.equal(await f.cache.commit(url,result.blob,result.epoch),false);assert.equal((await f.cache.stats()).count,0);assert.equal(await f.cache.get(url),null);
  }finally{f.cache.close();}
});
test('[CACHE-03] unavailable storage and permission/network failures fall back without breaking loading',async()=>{
  const bad=setup({indexedDB:{open(){throw Error('Blocked');}}});
  try{assert.equal(await load(bad.cache,{network:true}),null);assert.equal((await bad.cache.stats()).available,false);}finally{bad.cache.close();}
  let calls=0;const f=setup({request:d=>{calls++;queueMicrotask(()=>d.onerror());return{abort(){}};}});
  try{assert.equal(await load(f.cache,{network:true}),null);assert.equal(calls,1);}finally{f.cache.close();}
});
test('[CACHE-02] a quota failure prunes old data and retries once, then disables writes if quota remains exhausted',async()=>{
  const f=setup();try{await f.cache.commit(url,blob());const write=f.cache.write.bind(f.cache);let n=0;f.cache.write=async(...args)=>{if(++n===1)throw new DOMException('Full','QuotaExceededError');return write(...args);};
    assert.equal(await f.cache.commit(url+'?second',blob()),true);assert.equal(n,2);assert.equal((await f.cache.stats()).count,1);
    f.cache.write=async()=>{throw new DOMException('Full','QuotaExceededError');};assert.equal(await f.cache.commit(url+'?third',blob()),false);assert.equal(f.cache.writeBlocked,true);
  }finally{f.cache.close();}
});
test('[CACHE-03] cancellation ignores late transport callbacks and cache reads; unsafe/unknown destinations do not use privileged requests',async()=>{
  let d,calls=0,aborted=false;const f=setup({request:details=>{d=details;calls++;return{abort(){aborted=true;}};}});
  try{let returned=0;const cancel=f.cache.load(url,{network:true},()=>returned++);await until(()=>!!d);cancel();d.onload({status:200,response:blob()});await settle();assert.equal(returned,0);assert.equal(aborted,true);
    for(const source of['https://evil.test/a.jpg','https://hamsterimg.net/torrents.php?action=download','https://hamsterimg.net/images/a.jpg?action=view&action=download','https://hamsterimg.net/images/a.jpg?passkey=x'])assert.equal(await load(f.cache,{network:true},source),null);
    assert.equal(calls,1);assert.ok(IMAGE_CACHE_HOSTS.includes('hamsterimg.net'));
  }finally{f.cache.close();}
});
test('[CACHE-01] media pool stores only decoded successes and reads data URLs without re-training the host',async()=>{
  let calls=0;const f=setup({request:d=>{calls++;queueMicrotask(()=>d.onload({status:200,response:blob()}));return{abort(){}};}}),clock=fakeClock();
  let p=new MediaPool({...clock.env,imageCache:f.cache});
  try{const e=p.request(url,{cacheMode:'thumbnail',lane:'thumbnail'});await until(()=>e.image.src?.startsWith('data:'));e.image.succeed(160,90);await f.cache.writes;assert.equal((await f.cache.stats()).count,1);assert.equal(e.actualURL,url);p.dispose();
    p=new MediaPool({...clock.env,imageCache:f.cache});const cached=p.request(url,{cacheMode:'thumbnail',lane:'thumbnail'});await until(()=>cached.image.src?.startsWith('data:'));assert.equal(cached.cacheHit,true);assert.equal(cached.hostTimingIgnored,true);cached.image.succeed(160,90);assert.equal(calls,1);
  }finally{p.dispose();f.cache.close();}
});
test('[CACHE-03] corrupted cached bytes are invalidated and a forced retry bypasses saved images',async()=>{
  let calls=0;const f=setup({request:d=>{calls++;queueMicrotask(()=>d.onload({status:200,response:blob()}));return{abort(){}};}}),clock=fakeClock();
  const p=new MediaPool({...clock.env,imageCache:f.cache},{...DEFAULTS,maxRetries:0});
  try{await f.cache.commit(url,blob());const e=p.request(url,{cacheMode:'thumbnail'});await until(()=>e.image.src?.startsWith('data:'));e.image.fail();assert.equal(e.image.src,url);assert.equal(e.status,'loading','bad cached bytes fall back without charging another request');e.image.succeed(160,90);await f.cache.writes;assert.equal(await f.cache.get(url),null);
    clock.tick(31001);const retry=p.request(url,{cacheMode:'thumbnail',force:true,fresh:true});await until(()=>retry.image.src?.startsWith('data:'));retry.image.succeed(160,90);await f.cache.writes;assert.equal(calls,1);assert.ok(await f.cache.get(url));
  }finally{p.dispose();f.cache.close();}
});

test('[CACHE-03] disabling persistence skips cache transport and blocked image policy preserves native loading',async()=>{
  let calls=0;const f=setup({request:()=>{calls++;return{abort(){}};}});
  try{await f.cache.commit(url,blob());f.settings.persistentImages=false;assert.equal(await load(f.cache,{network:true}),null);assert.equal(calls,0);
    f.settings.persistentImages=true;f.cache.displayBlocked=true;assert.equal(await load(f.cache,{network:true}),null);assert.equal(calls,0);assert.equal((await f.cache.stats()).count,1,'disabling display does not erase saved files');
  }finally{f.cache.close();}
});
test('[CACHE-03] a transport failure switches that host to native loading for the rest of the page',async()=>{
  let calls=0;const f=setup({request:d=>{calls++;queueMicrotask(()=>d.onerror());return{abort(){}};}});
  try{assert.equal(await load(f.cache,{network:true}),null);assert.equal(await load(f.cache,{network:true},url+'?next'),null);assert.equal(calls,1);}finally{f.cache.close();}
});
test('[CACHE-02] replacement writes at capacity keep accurate size/counts and disabled writes leave old files readable',async()=>{
  const f=setup({limit:20/(1024*1024)});
  try{await f.cache.commit(url,blob(12));await f.cache.commit(url,blob(16));assert.equal((await f.cache.stats()).bytes,16);assert.equal((await f.cache.stats()).count,1);
    f.cache.write=async()=>{throw new DOMException('Blocked','SecurityError');};assert.equal(await f.cache.commit(url+'?b',blob(1)),false);assert.equal(f.cache.writeBlocked,true);assert.equal((await f.cache.get(url)).size,16);
  }finally{f.cache.close();}
});
test('[CACHE-03] an empty older database upgrades to a complete usable cache',async()=>{
  const indexedDB=new IDBFactory();await new Promise((resolve,reject)=>{const r=indexedDB.open('empornium-companion-images',1);r.onsuccess=()=>{r.result.close();resolve();};r.onerror=reject;});
  const f=setup({indexedDB});try{assert.equal(await load(f.cache,{network:true}),null);assert.equal((await f.cache.stats()).available,true);}finally{f.cache.close();}
});

test('[CACHE-03] privileged image transport upgrades legacy HTTP URLs and never accepts a plaintext final response',async()=>{
  let requested;const f=setup({request:d=>{requested=d.url;queueMicrotask(()=>d.onload({status:200,response:blob(),finalUrl:d.url}));return{abort(){}};}});
  try{const result=await load(f.cache,{network:true},url.replace('https:','http:'));assert.equal(requested,url);assert.equal(result.hit,false);}finally{f.cache.close();}
  const g=setup({request:d=>{queueMicrotask(()=>d.onload({status:200,response:blob(),finalUrl:d.url.replace('https:','http:')}));return{abort(){}};}});
  try{assert.equal(await load(g.cache,{network:true}),null);}finally{g.cache.close();}
});

test('[CACHE-03] duplicate transport completion/error callbacks deliver one result and abort errors stay contained',async()=>{
  let callbacks=0;const f=setup({request:d=>{queueMicrotask(()=>{d.onerror();d.onload({status:200,response:blob()});});return{abort(){throw Error('Already finished');}};}});
  try{const cancel=f.cache.load(url,{network:true},()=>callbacks++);await until(()=>callbacks===1);await settle();assert.equal(callbacks,1);assert.doesNotThrow(cancel);}finally{f.cache.close();}
});

test('[CACHE-01] a missing small variant does not disable caching the successful original fallback',async()=>{
  const small=url,full=url.replace('.th.','.');let calls=0;
  const f=setup({request:d=>{calls++;queueMicrotask(()=>d.onload(d.url===small?{status:404,response:new Blob(['missing'],{type:'text/html'})}:{status:200,response:blob()}));return{abort(){}};}}),clock=fakeClock();
  const p=new MediaPool({...clock.env,imageCache:f.cache});
  try{const e=p.request(full,{cacheMode:'thumbnail',lane:'thumbnail',smallFirst:true,smallCandidates:[small],candidates:[small,full]});await until(()=>e.status==='retrying');clock.tick(251);await until(()=>e.image.src?.startsWith('data:'));e.image.succeed(900,600);await f.cache.writes;
    assert.equal(calls,2);assert.equal(e.actualURL,full);assert.ok(await f.cache.get(full));assert.equal(f.cache.nativeOnly.size,0);
  }finally{p.dispose();f.cache.close();}
});


test('[CACHE-03] document navigation aborts manager transfers while BFCache keeps the existing page usable',async()=>{
  for(const persisted of[false,true]){
    let aborted=0;const f=domFixture(fixtureHTML(rowHTML(1),overlayHTML(1,url.replace('.th.','.')))),clock=fakeClock();
    const cache={enabled:()=>true,load:()=>()=>aborted++,flushTouches:async()=>{},close(){}};
    const app=createApp(f.win,memoryStorage({'ep.settings':{inlineThumbnails:true}}),{Image:clock.env.Image,imageCache:cache}).start();
    try{await until(()=>app.media.pool.active===1);f.win.dispatchEvent(new f.win.PageTransitionEvent('pagehide',{persisted}));
      assert.equal(app.media.pool.disposed,!persisted);assert.equal(aborted,persisted?0:1);
      if(persisted){f.win.dispatchEvent(new f.win.PageTransitionEvent('pageshow',{persisted:true}));await settle();assert.equal(app.media.pool.active,1);}
    }finally{app.dispose();f.close();}
  }
});

test('[CACHE-01] successful variant hints flush before navigation instead of waiting for the debounce',async()=>{
  const f=domFixture(fixtureHTML(rowHTML(1),overlayHTML(1,url.replace('.th.','.')))),clock=fakeClock(),storage=memoryStorage({'ep.settings':{inlineThumbnails:true}});
  const app=createApp(f.win,storage,{Image:clock.env.Image}).start();
  try{await until(()=>clock.images.length===1);clock.images[0].succeed(160,90);assert.equal(storage.get('ep.thumbnailHistory',null),null);
    f.win.dispatchEvent(new f.win.PageTransitionEvent('pagehide',{persisted:false}));assert.equal(storage.get('ep.thumbnailHistory')[0][1].src,url);assert.equal(app.media.historyTimer,null);
  }finally{app.dispose();f.close();}
});

test('[CACHE-04] newer large previews are evicted before older small thumbnails',async()=>{
  const f=setup({limit:40/(1024*1024)}),a=url,b=url+'?b',preview=url.replace('.th.','.'),c=url+'?c';
  try{await f.cache.commit(a,blob(12),f.cache.epoch,'thumbnail');f.tick(10);await f.cache.commit(b,blob(12),f.cache.epoch,'thumbnail');f.tick(10);await f.cache.commit(preview,blob(12),f.cache.epoch,'preview');
    f.tick(10);await f.cache.get(preview,'preview');await f.cache.flushTouches();f.tick(10);await f.cache.commit(c,blob(12),f.cache.epoch,'thumbnail');
    assert.equal(await f.cache.get(preview),null);for(const u of[a,b,c])assert.equal((await f.cache.get(u)).size,12);
    assert.equal((await f.cache.stats()).bytes,36);assert.equal((await f.cache.stats()).thumbnailBytes,36);
  }finally{f.cache.close();}
});
test('[CACHE-04] an oversized preview is declined without evicting thumbnails or other useful previews',async()=>{
  const f=setup({limit:40/(1024*1024)}),a=url,b=url+'?b',oldPreview=url+'?old',newPreview=url+'?new';
  try{await f.cache.commit(a,blob(10),f.cache.epoch,'thumbnail');await f.cache.commit(b,blob(10),f.cache.epoch,'thumbnail');await f.cache.commit(oldPreview,blob(8),f.cache.epoch,'preview');
    const before=await f.cache.stats();assert.equal(await f.cache.commit(newPreview,blob(30),f.cache.epoch,'preview'),false);assert.deepEqual(await f.cache.stats(),before);
    assert.ok(await f.cache.get(a));assert.ok(await f.cache.get(b));assert.ok(await f.cache.get(oldPreview));assert.equal(await f.cache.get(newPreview),null);
  }finally{f.cache.close();}
});
test('[CACHE-04] a large file labeled as a thumbnail does not receive small-thumbnail protection',async()=>{
  const size=512*1024+1,f=setup({limit:(size+10)/(1024*1024)});
  try{await f.cache.commit(url,blob(20),f.cache.epoch,'thumbnail');assert.equal(await f.cache.commit(url+'?huge',blob(size),f.cache.epoch,'thumbnail'),false);assert.equal((await f.cache.get(url)).size,20);assert.equal((await f.cache.stats()).bytes,20);}finally{f.cache.close();}
});
test('[CACHE-04] quota pressure from a preview preserves thumbnails and leaves thumbnail writes enabled',async()=>{
  const f=setup({limit:100/(1024*1024)});
  try{await f.cache.commit(url,blob(20),f.cache.epoch,'thumbnail');await f.cache.commit(url+'?preview',blob(10),f.cache.epoch,'preview');
    const write=f.cache.write.bind(f.cache);f.cache.write=async(...args)=>{if(args[3]==='preview')throw new DOMException('Full','QuotaExceededError');return write(...args);};
    assert.equal(await f.cache.commit(url+'?large',blob(50),f.cache.epoch,'preview'),false);assert.equal(f.cache.previewWriteBlocked,true);assert.equal(f.cache.writeBlocked,false);assert.equal((await f.cache.get(url)).size,20);
    assert.equal(await f.cache.commit(url+'?small',blob(8),f.cache.epoch,'thumbnail'),true);assert.equal((await f.cache.stats()).thumbnailBytes,28);
  }finally{f.cache.close();}
});
test('[CACHE-04] an image used as a small thumbnail stays protected when also used as a preview',async()=>{
  const f=setup();try{await f.cache.commit(url,blob(20),f.cache.epoch,'preview');assert.equal((await f.cache.stats()).thumbnailBytes,0);await f.cache.get(url);await load(f.cache);await f.cache.flushTouches();assert.equal((await f.cache.stats()).thumbnailBytes,0,'unknown callers must not reclassify a known preview');
    await f.cache.get(url,'thumbnail');await f.cache.flushTouches();assert.equal((await f.cache.stats()).thumbnailBytes,20);
    await f.cache.get(url,'preview');await f.cache.flushTouches();await f.cache.get(url);await f.cache.flushTouches();assert.equal((await f.cache.stats()).thumbnailBytes,20);
  }finally{f.cache.close();}
});
test('[CACHE-04] shrinking the cache removes previews first and thumbnails only as the last resort',async()=>{
  const f=setup({limit:100/(1024*1024)});try{await f.cache.commit(url,blob(20),f.cache.epoch,'thumbnail');f.tick(1);await f.cache.commit(url+'?new',blob(20),f.cache.epoch,'thumbnail');await f.cache.commit(url+'?preview',blob(10),f.cache.epoch,'preview');
    await f.cache.prune(25);assert.equal(await f.cache.get(url+'?preview'),null);assert.equal(await f.cache.get(url),null);assert.ok(await f.cache.get(url+'?new'));assert.equal((await f.cache.stats()).thumbnailBytes,20);
  }finally{f.cache.close();}
});
test('[CACHE-04] the v1 cache upgrades metadata in place without deleting old image bytes',async()=>{
  const indexedDB=new IDBFactory(),large=url.replace('.th.','.');
  await new Promise((resolve,reject)=>{const r=indexedDB.open('empornium-companion-images',1);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('images');d.createObjectStore('meta',{keyPath:'url'}).createIndex('used','used');d.createObjectStore('stats');};r.onerror=reject;r.onsuccess=()=>{const d=r.result,t=d.transaction(['images','meta','stats'],'readwrite');
    t.objectStore('images').put(blob(20),url);t.objectStore('meta').put({url,size:20,used:1});t.objectStore('images').put(blob(600000),large);t.objectStore('meta').put({url:large,size:600000,used:999999});t.objectStore('stats').put({bytes:600020,count:2},'total');t.oncomplete=()=>{d.close();resolve();};t.onerror=reject;};});
  const f=setup({indexedDB});try{assert.equal((await f.cache.get(url)).size,20);assert.equal((await f.cache.get(large)).size,600000);assert.equal((await f.cache.open()).version,6);assert.equal((await f.cache.stats()).thumbnailBytes,20);
    await f.cache.prune(30);assert.equal((await f.cache.get(url)).size,20);assert.equal(await f.cache.get(large),null);assert.equal((await f.cache.stats()).bytes,20);
  }finally{f.cache.close();}
});

test('[CACHE-05] usage summary counts actual thumbnail and preview files/bytes without reading image Blobs',async()=>{
  const f=setup();try{await f.cache.commit(url,blob(12),f.cache.epoch,'thumbnail');await f.cache.commit(url+'?large-thumb',blob(600000),f.cache.epoch,'thumbnail');await f.cache.commit(url+'?preview',blob(20),f.cache.epoch,'preview');
    const db=await f.cache.open(),transaction=db.transaction.bind(db),stores=[];db.transaction=(names,...args)=>{stores.push(names);return transaction(names,...args);};
    const s=await f.cache.summary();assert.equal(s.thumbnailCount,2);assert.equal(s.thumbnailFileBytes,600012);assert.equal(s.previewCount,1);assert.equal(s.previewBytes,20);assert.equal(s.bytes,600032);assert.equal(s.thumbnailBytes,12);
    assert.equal(stores.some(names=>names==='images'||Array.isArray(names)&&names.includes('images')),false,'summary must read metadata counters only');
  }finally{f.cache.close();}
});
test('[CACHE-05] replacements, role changes, pruning, removal and clear keep summary counters consistent',async()=>{
  const f=setup();try{await f.cache.commit(url,blob(12),f.cache.epoch,'thumbnail');await f.cache.commit(url+'?p',blob(20),f.cache.epoch,'preview');await f.cache.commit(url+'?p',blob(18),f.cache.epoch,'preview');
    let s=await f.cache.summary();assert.equal(s.thumbnailCount,1);assert.equal(s.previewCount,1);assert.equal(s.bytes,30);
    await f.cache.get(url+'?p','thumbnail');s=await f.cache.summary();assert.equal(s.thumbnailCount,2);assert.equal(s.previewCount,0);assert.equal(s.thumbnailFileBytes,30);
    await f.cache.remove(url);s=await f.cache.summary();assert.equal(s.thumbnailCount,1);assert.equal(s.bytes,18);await f.cache.prune(0);s=await f.cache.summary();assert.equal(s.thumbnailCount,0);assert.equal(s.bytes,0);
    f.cache.recordActivity('hit');await f.cache.clear();s=await f.cache.summary();assert.equal(s.thumbnailCount,0);assert.equal(s.previewCount,0);assert.equal(s.hits,1,'clearing files does not rewrite this-page history');
  }finally{f.cache.close();}
});
test('[CACHE-05] hit/download activity counts decoded disk/network and memory reuse, not inspection reads',async()=>{
  let calls=0;const f=setup({request:d=>{calls++;queueMicrotask(()=>d.onload({status:200,response:blob()}));return{abort(){}};}}),clock=fakeClock();let p=new MediaPool({...clock.env,imageCache:f.cache}),g;
  try{const e=p.request(url,{cacheMode:'thumbnail'});await until(()=>e.image.src?.startsWith('data:'));e.image.succeed(160,90);await f.cache.writes;assert.equal((await f.cache.summary()).savedBytes,0,'a download alone is not a saving');
    p.request(url,{cacheMode:'thumbnail'});let s=await f.cache.summary();assert.equal(s.hits,1);assert.equal(s.downloads,1);assert.equal(s.misses,1);assert.equal(s.savedBytes,12);assert.equal(s.sizedHits,1);await f.cache.summary();assert.equal((await f.cache.summary()).hits,1);
    p.dispose();g=setup({indexedDB:f.env.indexedDB});p=new MediaPool({...clock.env,imageCache:g.cache});const again=p.request(url,{cacheMode:'thumbnail'});await until(()=>again.image.src?.startsWith('data:'));again.image.succeed(160,90);s=await g.cache.summary();assert.equal(s.hits,2);assert.equal(s.downloads,1);assert.equal(s.savedBytes,24);assert.equal(s.sizedHits,2);assert.equal(calls,1);
  }finally{p.dispose();f.cache.close();g?.cache.close();}
});
test('[CACHE-05] schema upgrade reconstructs summary counts from old metadata without altering cached files',async()=>{
  const indexedDB=new IDBFactory();await new Promise((resolve,reject)=>{const r=indexedDB.open('empornium-companion-images',2);r.onupgradeneeded=()=>{const db=r.result;db.createObjectStore('images');const m=db.createObjectStore('meta',{keyPath:'url'});m.createIndex('used','used');m.createIndex('evict',['tier','used']);db.createObjectStore('stats');};r.onerror=reject;r.onsuccess=()=>{const db=r.result,t=db.transaction(['images','meta','stats'],'readwrite');for(const[k,kind,size,tier]of[[url,'thumbnail',12,1],[url+'?p','preview',20,0]]){t.objectStore('images').put(blob(size),k);t.objectStore('meta').put({url:k,kind,size,tier,used:1});}t.objectStore('stats').put({bytes:32,count:2,thumbnailBytes:12},'total');t.oncomplete=()=>{db.close();resolve();};t.onerror=reject;};});
  const f=setup({indexedDB});try{const s=await f.cache.summary();assert.equal(s.thumbnailCount,1);assert.equal(s.previewCount,1);assert.equal(s.thumbnailFileBytes,12);assert.equal(s.previewBytes,20);assert.equal((await f.cache.get(url)).size,12);}finally{f.cache.close();}
});
test('[CACHE-06] cumulative batches survive reopening and repeated summaries never count them twice',async()=>{
  const f=setup();let g;try{await f.cache.open();f.cache.recordActivity('hit');f.cache.recordActivity('download');await f.cache.flushActivity();f.cache.close();
    g=setup({indexedDB:f.env.indexedDB});assert.equal((await g.cache.summary()).hits,1);assert.equal((await g.cache.summary()).downloads,1);
    g.cache.recordActivity('hit');const s=await g.cache.summary();assert.equal(s.hits,2);assert.equal(s.downloads,1);assert.deepEqual(await g.cache.summary(),s);
  }finally{f.cache.close();g?.cache.close();}
});
test('[CACHE-06] two tab writers accumulate exact totals without lost increments',async()=>{
  const f=setup(),g=setup({indexedDB:f.env.indexedDB});try{await Promise.all([f.cache.open(),g.cache.open()]);
    for(let i=0;i<30;i++){f.cache.recordActivity('hit');g.cache.recordActivity('download');}
    await Promise.all([f.cache.flushActivity(),g.cache.flushActivity()]);const s=await f.cache.summary();assert.equal(s.hits,30);assert.equal(s.downloads,30);
    assert.equal((await g.cache.summary()).hits,30);
  }finally{f.cache.close();g.cache.close();}
});
test('[CACHE-06] pagehide starts a write-only journal synchronously and the next page replays interrupted compaction',async()=>{
  const f=setup();let g;try{await f.cache.open();f.cache.compactActivity=()=>Promise.resolve(null);f.cache.recordActivity('download');
    const db=f.cache.db,transaction=db.transaction.bind(db);let writes=0;db.transaction=(stores,...args)=>{if(stores==='activity')writes++;return transaction(stores,...args);};
    const flushed=f.cache.flushActivity();assert.equal(writes,1,'journal transaction must start before yielding');await flushed;f.cache.close();
    g=setup({indexedDB:f.env.indexedDB});assert.equal((await g.cache.summary()).downloads,1);assert.equal((await g.cache.summary()).downloads,1);
  }finally{f.cache.close();g?.cache.close();}
});
test('[CACHE-06] Clear saved images keeps history; Reset stats keeps images and starts a new persisted history',async()=>{
  const f=setup();let g;try{await f.cache.commit(url,blob(),undefined,'thumbnail');f.cache.recordActivity('hit');f.cache.recordActivity('download');await f.cache.summary();
    await f.cache.clear();assert.equal((await f.cache.summary()).downloads,1);assert.equal((await f.cache.summary()).count,0);
    await f.cache.commit(url,blob(),undefined,'thumbnail');await f.cache.resetActivity();const s=await f.cache.summary();assert.equal(s.hits,0);assert.equal(s.downloads,0);assert.equal(s.thumbnailCount,1);assert.equal((await f.cache.get(url)).size,12);
    f.cache.recordActivity('hit');await f.cache.flushActivity();f.cache.close();g=setup({indexedDB:f.env.indexedDB});assert.equal((await g.cache.summary()).hits,1);assert.equal((await g.cache.summary()).downloads,0);
  }finally{f.cache.close();g?.cache.close();}
});
test('[CACHE-06] reset epochs discard stale-tab journals and notifications discard pending old usage',async()=>{
  const f=setup(),g=setup({indexedDB:f.env.indexedDB});try{await Promise.all([f.cache.open(),g.cache.open()]);g.cache.recordActivity('download');
    await f.cache.resetActivity();await g.cache.flushActivity();assert.equal((await f.cache.summary()).downloads,0,'stale epoch cannot restore history');
    g.cache.recordActivity('hit');await f.cache.resetActivity();g.cache.acceptActivityReset({epoch:f.cache.activityGeneration,since:10000});
    assert.equal(g.cache.pendingActivity.hits,0);g.cache.recordActivity('hit');await g.cache.flushActivity();assert.equal((await f.cache.summary()).hits,1);
  }finally{f.cache.close();g.cache.close();}
});
test('[CACHE-06] a journal abort restores its delta once and retries only on a later explicit flush',async()=>{
  const f=setup();try{await f.cache.open();const db=f.cache.db,transaction=db.transaction.bind(db);let calls=0;
    db.transaction=(stores,...args)=>{const tx=transaction(stores,...args);if(stores==='activity'&&++calls===1)queueMicrotask(()=>tx.abort());return tx;};
    f.cache.recordActivity('hit');assert.equal(await f.cache.flushActivity(),false);assert.equal(f.cache.pendingActivity.hits,1);assert.equal(f.cache.activityTimer,null);
    await f.cache.flushActivity();assert.equal((await f.cache.summary()).hits,1);assert.equal(calls,2);
  }finally{f.cache.close();}
});
test('[CACHE-06] failed reset preserves saved files, prior history and unsaved deltas',async()=>{
  const f=setup();try{await f.cache.commit(url,blob());f.cache.recordActivity('download');await f.cache.summary();f.cache.recordActivity('hit');
    const db=f.cache.db,transaction=db.transaction.bind(db);let fail=true;
    db.transaction=(stores,...args)=>{if(fail&&Array.isArray(stores)&&stores.includes('activity')){fail=false;throw Error('Storage blocked');}return transaction(stores,...args);};
    await assert.rejects(f.cache.resetActivity(),/Storage blocked/);const s=await f.cache.summary();assert.equal(s.hits,1);assert.equal(s.downloads,1);assert.equal(s.count,1);
  }finally{f.cache.close();}
});
test('[CACHE-06] event bursts use one batch timer and leave no idle stats timer',async()=>{
  const f=setup(),clock=fakeClock();f.env.setTimeout=clock.env.setTimeout;f.env.clearTimeout=clock.env.clearTimeout;
  try{const opened=f.cache.open();await opened;let timers=0;const schedule=f.env.setTimeout;f.env.setTimeout=(...args)=>{timers++;return schedule(...args);};
    for(let i=0;i<100;i++)f.cache.recordActivity('hit');assert.equal(timers,1);await f.cache.flushActivity();assert.equal(f.cache.activityTimer,null);assert.equal((await f.cache.summary()).hits,100);assert.equal(timers,1);
  }finally{f.cache.close();}
});

test('[CACHE-06] failed compaction retains the journal for one exact replay on the next page',async()=>{
  const f=setup();let g;try{await f.cache.open();const db=f.cache.db,transaction=db.transaction.bind(db);let blocked=true;
    db.transaction=(stores,...args)=>{if(blocked&&Array.isArray(stores)&&stores.includes('activity'))throw Error('Interrupted compaction');return transaction(stores,...args);};
    f.cache.recordActivity('download');await f.cache.flushActivity();assert.equal(await f.cache.compactActivity(),null);f.cache.close();
    g=setup({indexedDB:f.env.indexedDB});assert.equal((await g.cache.summary()).downloads,1);assert.equal((await g.cache.summary()).downloads,1);
  }finally{f.cache.close();g?.cache.close();}
});
test('[CACHE-06] resetting during an in-flight batch cannot resurrect pre-reset history',async()=>{
  const f=setup();try{await f.cache.open();f.cache.recordActivity('download');const writing=f.cache.flushActivity(),resetting=f.cache.resetActivity();f.cache.recordActivity('hit');
    await Promise.all([writing,resetting]);const s=await f.cache.summary();assert.equal(s.downloads,0);assert.equal(s.hits,1);
  }finally{f.cache.close();}
});

test('[CACHE-07] misses count unsuccessful managed lookups independently of successful transfers',async()=>{
  let requests=0;const f=setup({request:d=>{requests++;queueMicrotask(()=>d.onerror());return{abort(){}};}});
  try{assert.equal(await load(f.cache,{network:true}),null);let s=await f.cache.summary();assert.equal(s.misses,1);assert.equal(s.downloads,0);assert.equal(s.hits,0);
    assert.equal(await load(f.cache,{network:false},url+'?lookup-only'),null);assert.equal((await f.cache.summary()).misses,2);
    await load(f.cache,{network:true,fresh:true},url+'?forced');assert.equal((await f.cache.summary()).misses,2,'forced bypass is not a cache lookup');
    await load(f.cache,{network:true},'https://unsupported.test/a.jpg');assert.equal((await f.cache.summary()).misses,2);
    f.settings.persistentImages=false;await load(f.cache,{network:true},url+'?off');assert.equal((await f.cache.summary()).misses,2);assert.equal(requests,1);
  }finally{f.cache.close();}
});
test('[CACHE-07] rolling windows expire buckets independently and never expire all-history totals',()=>{
  const now=7200000,recent=[[now-3605000,1,1,1],[now-3600000,2,2,2],[now-900000,3,3,3],[now-300000,4,4,4],[now,5,5,5],[now+5000,20,20,20]];
  const activity={hits:100,misses:90,downloads:80,recent};let windows=cacheActivityWindows(activity,now);
  assert.deepEqual(windows.five,{hits:9,misses:9,downloads:9,savedBytes:0,sizedHits:0});assert.equal(windows.fifteen.hits,12);assert.equal(windows.hour.hits,14);assert.deepEqual(windows.all,{hits:100,misses:90,downloads:80,savedBytes:0,sizedHits:0});
  windows=cacheActivityWindows(activity,now+5000);assert.equal(windows.five.hits,25);assert.equal(windows.fifteen.hits,29);assert.equal(windows.hour.hits,32);
  assert.equal(cacheActivityWindows(activity,now+3610000).hour.hits,0);assert.deepEqual(activity.recent,recent,'window inspection must not mutate stored history');
});
test('[CACHE-07] per-window hit/miss/download counts persist across pages and combine concurrent tabs',async()=>{
  const f=setup(),g=setup({indexedDB:f.env.indexedDB});let h;
  try{await Promise.all([f.cache.open(),g.cache.open()]);f.cache.recordActivity('hit');g.cache.recordActivity('miss');g.cache.recordActivity('download');await Promise.all([f.cache.flushActivity(),g.cache.flushActivity()]);
    const s=await f.cache.summary();assert.deepEqual(cacheActivityWindows(s,10000).five,{hits:1,misses:1,downloads:1,savedBytes:0,sizedHits:0});f.cache.close();g.cache.close();
    h=setup({indexedDB:f.env.indexedDB});h.tick(305000);const next=await h.cache.summary();const windows=cacheActivityWindows(next,315000);assert.equal(windows.five.misses,0);assert.equal(windows.fifteen.misses,1);assert.equal(windows.all.misses,1);
  }finally{f.cache.close();g.cache.close();h?.cache.close();}
});
test('[CACHE-07] schema 4 history keeps old totals without fabricating misses or recent timestamps',async()=>{
  const indexedDB=new IDBFactory();await new Promise((resolve,reject)=>{const r=indexedDB.open('empornium-companion-images',4);
    r.onupgradeneeded=()=>{const db=r.result;db.createObjectStore('images');const meta=db.createObjectStore('meta',{keyPath:'url'});meta.createIndex('used','used');meta.createIndex('evict',['tier','used']);db.createObjectStore('stats');db.createObjectStore('activity',{keyPath:'id'});};r.onerror=reject;
    r.onsuccess=()=>{const db=r.result;db.onversionchange=()=>db.close();const t=db.transaction(['stats','activity'],'readwrite');t.objectStore('stats').put({hits:7,downloads:4,since:100},'activityTotals');t.objectStore('activity').put({id:'old-pagehide',hits:2,downloads:1,since:200,epoch:0});t.oncomplete=resolve;t.onerror=reject;};
  });
  const f=setup({indexedDB});try{let s=await f.cache.summary();assert.equal((await f.cache.open()).version,6);assert.equal(s.hits,9);assert.equal(s.downloads,5);assert.equal(s.misses,0);assert.equal(s.historyPartial,true);assert.deepEqual(s.recent,[]);
    f.cache.recordActivity('miss');s=await f.cache.summary();assert.deepEqual(cacheActivityWindows(s,10000).five,{hits:0,misses:1,downloads:0,savedBytes:0,sizedHits:0});assert.equal(s.hits,9);
    await f.cache.resetActivity();s=await f.cache.summary();assert.equal(s.historyPartial,false);assert.equal(s.misses,0);assert.deepEqual(s.recent,[]);
  }finally{f.cache.close();}
});
test('[CACHE-07] recent storage is bounded to one hour while all history remains complete',async()=>{
  const f=setup();try{await f.cache.open();for(let i=0;i<1500;i++){f.cache.recordActivity('miss');f.tick(5000);}
    assert.ok(f.cache.pendingActivity.recent.size<=721);const s=await f.cache.summary();assert.equal(s.misses,1500);assert.ok(s.recent.length<=721);assert.equal(cacheActivityWindows(s,7510000).hour.misses,720);assert.equal(cacheActivityWindows(s,7510000).five.misses,60);
    f.tick(3605000);const aged=await f.cache.summary();assert.deepEqual(aged.recent,[]);assert.equal(aged.misses,1500);
  }finally{f.cache.close();}
});
test('[CACHE-07] aborted journal replay restores miss timestamps and counts only once',async()=>{
  const f=setup();try{await f.cache.open();const db=f.cache.db,transaction=db.transaction.bind(db);let attempts=0;
    db.transaction=(stores,...args)=>{const tx=transaction(stores,...args);if(stores==='activity'&&++attempts===1)queueMicrotask(()=>tx.abort());return tx;};
    f.cache.recordActivity('miss');assert.equal(await f.cache.flushActivity(),false);f.tick(10000);f.cache.recordActivity('miss');await f.cache.flushActivity();const s=await f.cache.summary();assert.equal(s.misses,2);assert.deepEqual(s.recent,[[10000,0,1,0,0,0],[20000,0,1,0,0,0]]);assert.equal((await f.cache.summary()).misses,2);
  }finally{f.cache.close();}
});
test('[CACHE-07] Reset stats clears every window and stale miss batches while preserving saved images',async()=>{
  const f=setup(),g=setup({indexedDB:f.env.indexedDB});try{await f.cache.commit(url,blob());await g.cache.open();f.cache.recordActivity('hit');f.cache.recordActivity('miss');f.cache.recordActivity('download');await f.cache.summary();g.cache.recordActivity('miss');
    await f.cache.resetActivity();await g.cache.flushActivity();const s=await f.cache.summary();for(const counts of Object.values(cacheActivityWindows(s,10000)))assert.deepEqual(counts,{hits:0,misses:0,downloads:0,savedBytes:0,sizedHits:0});assert.equal(s.count,1);
    f.cache.recordActivity('miss');assert.equal(cacheActivityWindows(await f.cache.summary(),10000).five.misses,1);
  }finally{f.cache.close();g.cache.close();}
});
test('[CACHE-07] unusable cached bytes count a miss but cache inspection and canceled reads do not',async()=>{
  const f=setup();try{await f.cache.commit(url,blob());await f.cache.get(url);await f.cache.summary();assert.equal((await f.cache.summary()).misses,0);
    f.env.encode=async()=>{throw Error('Unreadable');};assert.equal(await load(f.cache,{network:false}),null);assert.equal((await f.cache.summary()).misses,1);
    const get=f.cache.get.bind(f.cache);let resolve;f.cache.get=()=>new Promise(r=>{resolve=r;});let callbacks=0;const cancel=f.cache.load(url+'?cancelled',{},()=>callbacks++);await until(()=>!!resolve);cancel();resolve(null);await settle();assert.equal((await f.cache.summary()).misses,1);assert.equal(callbacks,0);f.cache.get=get;
  }finally{f.cache.close();}
});

test('[CACHE-08] decoded disk and shared memory hits reuse actual payload sizes without retaining Blobs',async()=>{
  const f=setup(),clock=fakeClock(),p=new MediaPool({...clock.env,imageCache:f.cache});try{await f.cache.commit(url,blob(1536));
    const e=p.request(url,{cacheMode:'thumbnail'});await until(()=>e.image.src?.startsWith('data:'));e.image.succeed(160,90);assert.equal(e.cacheResult,null);assert.equal(e.cacheBytes,1536);
    assert.equal(p.request(url,{cacheMode:'thumbnail'}),e);assert.equal(p.request(url,{cacheMode:'thumbnail',tier:'hover'}),e);
    const s=await f.cache.summary();assert.equal(s.hits,3);assert.equal(s.downloads,0);assert.equal(s.savedBytes,4608);assert.equal(s.sizedHits,3);assert.equal(cacheActivityWindows(s,10000).five.savedBytes,4608);
  }finally{p.dispose();f.cache.close();}
});
test('[CACHE-08] savings persist across pages and concurrent writers and age independently of all history',async()=>{
  const f=setup(),g=setup({indexedDB:f.env.indexedDB});let h;
  try{await Promise.all([f.cache.open(),g.cache.open()]);f.cache.recordActivity('hit',1024);g.cache.recordActivity('hit',2048);g.cache.recordActivity('download',8000);g.cache.recordActivity('miss',8000);await Promise.all([f.cache.flushActivity(),g.cache.flushActivity()]);
    let s=await f.cache.summary();assert.equal(s.savedBytes,3072);assert.equal(s.sizedHits,2);assert.equal(cacheActivityWindows(s,10000).five.savedBytes,3072);f.cache.close();g.cache.close();
    h=setup({indexedDB:f.env.indexedDB});h.tick(305000);s=await h.cache.summary();assert.equal(cacheActivityWindows(s,315000).five.savedBytes,0);assert.equal(cacheActivityWindows(s,315000).fifteen.savedBytes,3072);
    h.tick(3605000);s=await h.cache.summary();assert.equal(cacheActivityWindows(s,3920000).hour.savedBytes,0);assert.equal(s.savedBytes,3072);assert.equal(s.sizedHits,2);
  }finally{f.cache.close();g.cache.close();h?.cache.close();}
});
test('[CACHE-08] older sized-unknown history is retained without inventing saved bytes',async()=>{
  const f=setup();try{await f.cache.open();const db=f.cache.db;await new Promise((resolve,reject)=>{const tx=db.transaction(['stats','activity'],'readwrite');tx.objectStore('stats').put({hits:5,misses:2,downloads:2,recent:[[10000,3,1,1]],since:1000},'activityTotals');tx.objectStore('activity').put({id:'old-final-batch',epoch:0,hits:1,misses:0,downloads:0,recent:[[10000,1,0,0]],since:1000});tx.oncomplete=resolve;tx.onerror=reject;});
    let s=await f.cache.summary();assert.equal(s.hits,6);assert.equal(s.savedBytes,0);assert.equal(s.sizedHits,0);assert.equal(s.historyPartial,false,'existing hit-rate validity is unaffected');assert.equal(cacheActivityWindows(s,10000).five.hits,4);
    f.cache.recordActivity('hit',100);s=await f.cache.summary();assert.equal(s.hits,7);assert.equal(s.savedBytes,100);assert.equal(s.sizedHits,1);assert.equal(cacheActivityWindows(s,10000).five.sizedHits,1);
  }finally{f.cache.close();}
});
test('[CACHE-08] abort/replay preserves byte deltas once; Clear keeps savings and Reset rejects old-tab savings',async()=>{
  const f=setup(),g=setup({indexedDB:f.env.indexedDB});try{await f.cache.commit(url,blob());await g.cache.open();const db=f.cache.db,transaction=db.transaction.bind(db);let fail=true;
    db.transaction=(stores,...args)=>{const tx=transaction(stores,...args);if(stores==='activity'&&fail){fail=false;queueMicrotask(()=>tx.abort());}return tx;};
    f.cache.recordActivity('hit',512);assert.equal(await f.cache.flushActivity(),false);assert.equal(f.cache.pendingActivity.savedBytes,512);await f.cache.flushActivity();assert.equal((await f.cache.summary()).savedBytes,512);
    await f.cache.clear();assert.equal((await f.cache.summary()).savedBytes,512);await f.cache.commit(url,blob());g.cache.recordActivity('hit',2048);await f.cache.resetActivity();await g.cache.flushActivity();
    const s=await f.cache.summary();assert.equal(s.savedBytes,0);assert.equal(s.sizedHits,0);assert.equal(s.count,1);assert.equal(cacheActivityWindows(s,10000).five.savedBytes,0);
  }finally{f.cache.close();g.cache.close();}
});
test('[CACHE-08] unknown, invalid, failed and canceled image sizes do not fabricate savings',async()=>{
  const f=setup(),clock=fakeClock(),p=new MediaPool({...clock.env,imageCache:f.cache});try{await f.cache.commit(url,blob(100));const e=p.request(url,{cacheMode:'thumbnail'});await until(()=>e.image.src?.startsWith('data:'));e.image.fail();e.image.succeed(160,90);await f.cache.writes;let s=await f.cache.summary();assert.equal(s.savedBytes,0);assert.equal(s.sizedHits,0);
    p.request(url,{cacheMode:'thumbnail'});for(const size of[undefined,0,-1,NaN,Infinity,1.5])f.cache.recordActivity('hit',size);
    s=await f.cache.summary();assert.equal(s.savedBytes,0);assert.equal(s.sizedHits,0);assert.ok(s.hits>0);
  }finally{p.dispose();f.cache.close();}
});
