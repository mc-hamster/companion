import test from 'node:test';
import assert from 'node:assert/strict';
import {MediaPool,DEFAULTS} from '../src/core.mjs';
import {createApp} from '../src/app.mjs';
import {domFixture,fixtureHTML,rowHTML,overlayHTML,memoryStorage,fakeClock,until} from './helpers.mjs';
const full='https://images.test/original.jpg';
const warm=(p,url=full)=>{const e=p.request(url,{lane:'large',priority:100,keepAlive:true,eligible:()=>true});const off=p.subscribe(e,()=>{});off();return e;};
test('[HOV-11] leaving retains the same transfer, clears hover closures, demotes priority and reuses completed pixels',()=>{
  const c=fakeClock(),p=new MediaPool(c.env);
  try{const e=warm(p),image=e.image;assert.equal(e.cancelled,false);assert.equal(p.active,1);assert.equal(e.listeners.size,0);assert.equal(e.eligible,null);assert.equal(e.priorityFor,null);assert.equal(e.priority,10);assert.equal(image.fetchPriority,'low');
    const again=p.request(full,{lane:'large',priority:100,keepAlive:true});assert.equal(again,e);assert.equal(image.fetchPriority,'high');const off=p.subscribe(again,()=>{});off();
    assert.equal(c.images.length,1);image.succeed(960,540);assert.equal(e.status,'ready');assert.equal(p.active,0);assert.equal(p.request(full,{priority:100}),e);assert.equal(c.images.length,1);
  }finally{p.dispose();}
});
test('[HOV-11] retained failures keep their bounded retries and queued retries respect background visibility',()=>{
  let hidden=false;const c=fakeClock();c.env.hidden=()=>hidden;const p=new MediaPool(c.env,{...DEFAULTS,maxRetries:1});
  try{const e=warm(p);e.image.fail();assert.equal(e.status,'retrying');hidden=true;c.tick(701);assert.equal(e.status,'queued');assert.equal(c.images.length,1);
    hidden=false;p.pump();assert.equal(c.images.length,2);c.images[1].fail();c.tick(60000);assert.equal(e.status,'failed');assert.equal(c.images.length,2);assert.equal(e.listeners.size,0);
  }finally{p.dispose();}
});
test('[HOV-11] fresh hover requests outrank queued warming without increasing the large-image ceiling',()=>{
  const c=fakeClock(),p=new MediaPool(c.env);
  try{const a=p.request('https://images.test/a.png',{lane:'large',priority:80}),b=p.request('https://images.test/b.png',{lane:'large',priority:80});
    const kept=warm(p);const queued=warm(p,'https://images.test/queued.jpg');assert.equal(queued.status,'queued');assert.equal(queued.eligible,null);
    const foreground=p.request('https://images.test/new.jpg',{lane:'large',priority:100,keepAlive:true});const off=p.subscribe(foreground,()=>{});
    assert.equal(p.activeLanes.large,3);a.image.succeed();assert.equal(foreground.status,'loading');assert.equal(queued.status,'queued');assert.equal(p.activeLanes.large,3);
    b.image.succeed();kept.image.succeed();assert.equal(queued.status,'loading');assert.ok(p.activeLanes.large<=3);off();
  }finally{p.dispose();}
});
test('[HOV-11] rapid hover sweeps have a bounded retained queue and evictions do not penalize hosts',()=>{
  const c=fakeClock(),p=new MediaPool(c.env,{...DEFAULTS,cacheEntries:4});
  try{for(let i=0;i<40;i++){warm(p,'https://images.test/full-'+i+'.jpg');assert.ok(p.entries.size<=4);assert.ok(p.activeLanes.large<=3);assert.ok(p.queue.length<=4);}
    for(const h of p.hosts.values())assert.equal(h.failures.length,0);
    for(let i=0;i<c.images.length;i++)if(c.images[i].onload)c.images[i].succeed(160,90);
    assert.equal(p.active,0);assert.ok(p.entries.size<=4);
  }finally{p.dispose();assert.equal(c.timers.size,0);}
});
test('[HOV-11] live thumbnail consumers do not evict retained originals; idle megapixel pressure still does',()=>{
  const c=fakeClock(),p=new MediaPool(c.env,{...DEFAULTS,cacheEntries:2,cacheMegapixels:8});
  try{for(let i=0;i<12;i++){const e=p.request('https://thumb'+i+'.test/small.png');p.subscribe(e,()=>{});}
    const kept=warm(p);kept.image.succeed(960,540);assert.equal(p.entries.get(kept.key),kept,'live page rows are outside the idle cache budget');
    const large=warm(p,'https://images.test/huge.jpg');large.image.naturalWidth=5000;large.image.naturalHeight=5000;c.tick(81);
    assert.equal(p.entries.has(large.key),false,'offscreen dimensions trigger megapixel trimming');assert.equal(large.cancelled,true);
    for(const h of p.hosts.values())assert.equal(h.failures.length,0);
  }finally{p.dispose();}
});
test('[HOV-11] shared requests inherit retention and pool disposal still aborts unfinished work',()=>{
  const c=fakeClock(),p=new MediaPool(c.env);
  const original=p.request('https://images.test/logical.jpg',{lane:'large',candidates:[full],priority:80});
  const shared=p.request(full,{lane:'large',priority:100,keepAlive:true});assert.equal(shared,original);p.subscribe(shared,()=>{})();assert.equal(shared.cancelled,false);
  p.dispose();assert.equal(shared.cancelled,true);assert.equal(shared.image.onload,null);assert.equal(c.timers.size,0);assert.equal(p.active,0);
});
test('[HOV-11] offscreen completion never reopens or overwrites a different preview, and rehover makes no new request',async()=>{
  const f=domFixture(fixtureHTML(rowHTML(1)+rowHTML(2),overlayHTML(1,'https://hamsterimg.net/images/a.jpg')+overlayHTML(2,'https://hamsterimg.net/images/b.jpg'))),c=fakeClock();
  const app=createApp(f.win,memoryStorage({'ep.settings':{inlineThumbnails:true}}),{Image:c.env.Image}).start();
  try{await until(()=>app.root?.dataset.epReady==='true');const rows=[...app.media.thumbnails.values()];
    for(let i=0;i<2;i++){c.images[i].succeed(160,90);Object.defineProperty(rows[i].image,'naturalWidth',{get:()=>160});}
    const buttons=rows.map(r=>r.element.querySelector('button')),preview=app.preview;let scans=0;const scan=app.media.scan.bind(app.media);app.media.scan=(...args)=>{scans++;return scan(...args);};
    preview.showFor(buttons[0]);const a=c.images[2];preview.hide();assert.equal(preview.open,false);assert.equal(typeof a.onload,'function');assert.equal(preview.statsTimer,null);
    preview.showFor(buttons[1]);const b=c.images[3],smallB=preview.image.src;a.succeed(960,540);assert.equal(preview.image.src,smallB);preview.hide();b.succeed(960,540);
    assert.equal(preview.open,false);assert.equal(preview.image.hasAttribute('src'),false);assert.equal(c.images.length,4);
    preview.showFor(buttons[0]);assert.match(preview.image.src,/\/a\.jpg$/);preview.hide();preview.showFor(buttons[1]);assert.match(preview.image.src,/\/b\.jpg$/);
    assert.equal(c.images.length,4);assert.equal(scans,0);assert.equal(f.errors.length,0,f.errors.join('\n'));
  }finally{app.dispose();f.close();}
});

test('[HOV-11] later ordinary thumbnail completions do not displace an explicitly retained original',()=>{
  const c=fakeClock(),p=new MediaPool(c.env,{...DEFAULTS,cacheEntries:2});
  try{const kept=warm(p);for(let i=0;i<50;i++){c.tick(1);const e=p.request('https://images.test/small-'+i+'.th.jpg');const off=p.subscribe(e,()=>{});e.image.succeed(160,90);off();assert.equal(p.entries.get(kept.key),kept);assert.equal(kept.cancelled,false);assert.ok(p.entries.size<=2);}
    kept.image.succeed(960,540);assert.equal(kept.status,'ready');assert.equal(p.entries.get(kept.key),kept);
  }finally{p.dispose();}
});
