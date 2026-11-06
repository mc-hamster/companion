import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,MediaPool,validateSettings} from '../src/core.mjs';
import {fakeClock} from './helpers.mjs';
const setup=(settings={})=>{const clock=fakeClock();return{clock,pool:new MediaPool(clock.env,{...DEFAULTS,...settings})};};
const state=(pool,host='a.test')=>pool.hosts.get(host);
function batch(pool,clock,count,host='a.test',ms=160){
  const base=clock.images.length;
  for(let i=0;i<count;i++)pool.request('https://'+host+'/'+base+'-'+i+'.th.png',{lane:'thumbnail'});
  for(let guard=0;guard<100&&pool.active;guard++){
    const running=clock.images.filter(i=>i.onload&&i.naturalWidth===0);clock.tick(ms);for(const image of running)image.succeed(160,96);
  }
}

test('[HOST-01] responsive hosts start at two, grow gradually to six and retain the global ceiling',()=>{
  const{clock,pool}=setup();try{
    for(let i=0;i<50;i++)pool.request('https://a.test/'+i+'.th.png',{lane:'thumbnail'});
    assert.equal(pool.active,2);assert.equal(state(pool).limit,2);
    let peak=2;for(let guard=0;guard<50&&pool.active;guard++){const images=clock.images.filter(i=>i.onload&&!i.naturalWidth);clock.tick(160);for(const image of images){image.succeed(160,96);peak=Math.max(peak,pool.active);}}
    assert.equal(clock.images.length,50);assert.equal(pool.active,0);assert.equal(state(pool).limit,6);assert.ok(peak<=6);assert.equal(clock.timers.size,0);
  }finally{pool.dispose();}
});

test('[HOST-02] latency growth backs off and stale successful completions cannot immediately reopen capacity',()=>{
  const{clock,pool}=setup();try{
    batch(pool,clock,4);assert.equal(state(pool).limit,3);
    const entries=[0,1,2].map(i=>pool.request('https://a.test/slow-'+i+'.th.png',{lane:'thumbnail'}));
    const images=clock.images.slice(-3);clock.tick(320);images[2].succeed();assert.equal(state(pool).limit,2);
    images[0].succeed();images[1].succeed();assert.equal(state(pool).limit,2);assert.ok(state(pool).growAfter>clock.env.now());
    assert.ok(entries.every(e=>e.status==='ready'));assert.equal(pool.active,0);
  }finally{pool.dispose();}
});

test('[HOST-03] errors cool down only the actual failing host and one wake timer resumes its queue',()=>{
  const{clock,pool}=setup({maxRetries:0});try{
    pool.request('https://a.test/1.th.png');pool.request('https://a.test/2.th.png');pool.request('https://a.test/3.th.png');
    clock.images[0].fail();clock.images[1].fail();assert.equal(state(pool).limit,1);assert.ok(state(pool).until>clock.env.now());
    const healthy=pool.request('https://b.test/ok.th.png');assert.equal(healthy.status,'loading');clock.images.at(-1).succeed();
    assert.equal(clock.images.length,3);clock.tick(1001);assert.equal(clock.images.length,4);clock.images[3].succeed();
    assert.equal(pool.active,0);assert.equal(clock.timers.size,0);
  }finally{pool.dispose();}
});

test('[HOST-03] variant fallback uses its destination host and cancellation neither penalizes nor trains hosts',()=>{
  const{clock,pool}=setup();try{
    const entry=pool.request('https://original.test/image.png',{lane:'thumbnail',smallFirst:true,
      smallCandidates:['https://small.test/image.th.png'],candidates:['https://small.test/image.th.png','https://original.test/image.png']});
    clock.images[0].fail();clock.tick(0);assert.equal(entry.hostKey,'original.test');assert.equal(state(pool,'small.test').thumbnail,0);
    assert.equal(pool.activeLanes.large,1);clock.tick(160);clock.images[1].succeed();assert.equal(state(pool,'original.test').limit,2);
    const next=pool.request('https://other.test/cancel.png',{lane:'large',priority:100});const image=clock.images.at(-1),late=image.onload;
    const unsubscribe=pool.subscribe(next,()=>{});unsubscribe();late();assert.equal(state(pool,'other.test').limit,2);assert.equal(state(pool,'other.test').failures.length,0);
    assert.equal(pool.active,0);assert.equal(pool.activeLanes.large,0);
  }finally{pool.dispose();}
});

test('[HOST-04] host backoff still reserves a large hover slot and respects cooldown without bypasses',()=>{
  const{clock,pool}=setup({maxRetries:0});try{
    pool.request('https://a.test/small-1.th.png');pool.request('https://a.test/small-2.th.png');
    pool.request('https://a.test/large1.png',{lane:'large'});pool.request('https://a.test/large2.png',{lane:'large'});
    const hover=pool.request('https://a.test/hover.png',{lane:'large',priority:100});assert.equal(hover.status,'loading');assert.equal(pool.active,5);
    clock.images[0].fail();const another=pool.request('https://a.test/other.png',{lane:'large',priority:100});assert.equal(another.status,'queued');
    for(const image of clock.images.slice(1))image.succeed();assert.equal(another.status,'queued');clock.tick(251);assert.equal(another.status,'loading');clock.images.at(-1).succeed();
    assert.equal(pool.active,0);assert.equal(clock.timers.size,0);
  }finally{pool.dispose();}
});

test('[HOST-04] partial animation completion, instantaneous cache hits and hidden-page samples do not grow host limits',()=>{
  const{clock,pool}=setup({stallMs:1000,timeoutMs:3000});try{
    for(let i=0;i<8;i++){pool.request('https://a.test/cache-'+i+'.th.png');clock.images.at(-1).succeed();}
    assert.equal(state(pool).limit,2);const entry=pool.request('https://a.test/partial.th.gif');const image=clock.images.at(-1);
    image.naturalWidth=160;clock.tick(3000);assert.equal(entry.status,'partial');image.succeed();assert.equal(state(pool).limit,2);
    let hidden=true;clock.env.hidden=()=>hidden;const held=pool.request('https://b.test/held.th.png');assert.equal(held.status,'queued');
    hidden=false;pool.pump();hidden=true;clock.tick(160);clock.images.at(-1).succeed();assert.equal(state(pool,'b.test').good,0);
    assert.equal(pool.active,0);
  }finally{pool.dispose();}
});

test('[HOST-04] page-local host history is bounded and a lower ceiling drains without cancelling active images',()=>{
  const{clock,pool}=setup();try{
    batch(pool,clock,24);pool.settings={...pool.settings,concurrency:1};
    pool.request('https://a.test/lower1.th.png');pool.request('https://a.test/lower2.th.png');assert.equal(pool.active,1);
    clock.images.at(-1).succeed();assert.equal(pool.active,1);clock.images.at(-1).succeed();
    for(let i=0;i<180;i++){pool.request('https://host'+i+'.test/a.th.png');clock.images.at(-1).succeed();}
    assert.ok(pool.hosts.size<=128);assert.equal(pool.active,0);assert.equal(clock.timers.size,0);
  }finally{pool.dispose();}
  assert.equal(pool.hosts.size,0);assert.equal(pool.activeLanes.thumbnail,0);
});

test('[HOST-04] learned limits persist in bounded batches without asset URLs, expire and survive storage failure',()=>{
  const clock=fakeClock(),writes=[];clock.env.saveHosts=history=>writes.push(history);
  const pool=new MediaPool(clock.env,{...DEFAULTS});
  try{
    batch(pool,clock,12);assert.ok(writes.length<=2,'learning writes are batched, not one per image');
    clock.tick(501);assert.ok(writes.length);const history=writes.at(-1);
    assert.ok(history.every(h=>!JSON.stringify(h).includes('.png')));assert.ok(history[0].limit>2);
    const next=new MediaPool({...clock.env,hostHistory:history});
    assert.equal(state(next).limit,history[0].limit);next.dispose();
    const stale=new MediaPool({...clock.env,hostHistory:[{...history[0],time:clock.env.now()-86400001}]});assert.equal(stale.hosts.size,0);stale.dispose();
    const malformed=new MediaPool({...clock.env,hostHistory:[{...history[0],host:'a.test/path'},{...history[0],limit:200}]});assert.equal(malformed.hosts.size,0);malformed.dispose();
    clock.env.saveHosts=()=>{throw Error('Quota');};assert.doesNotThrow(()=>{batch(pool,clock,12);clock.tick(501);});
  }finally{pool.dispose();}
  assert.equal(clock.timers.size,0);
});

test('[HOST-03] a constrained host shares its reduced budget across small, fallback and hover work',()=>{
  const{clock,pool}=setup();try{
    batch(pool,clock,4);assert.equal(state(pool).limit,3);
    const bad=pool.request('https://a.test/missing.th.png');clock.images.at(-1).fail();
    const fallback=pool.request('https://a.test/original.png',{lane:'large',priority:100});
    const small=pool.request('https://a.test/next.th.png');clock.tick(251);
    assert.equal(state(pool).thumbnail+state(pool).large,2);assert.equal(fallback.status,'loading');assert.equal(small.status,'loading');
    const held=pool.request('https://a.test/held.png',{lane:'large',priority:100});assert.equal(held.status,'queued');
    pool.cancel(bad);for(const image of clock.images.filter(i=>i.onload&&!i.naturalWidth))image.succeed();
    assert.equal(held.status,'loading');clock.images.at(-1).succeed();
  }finally{pool.dispose();}
});

test('a full-size fallback cannot hold the only thumbnail slot on a constrained host', () => {
  const {clock, pool} = setup();
  try {
    const original = 'https://a.test/slow.gif';
    const fallback = pool.request(original, {smallFirst: true,
      candidates: ['https://a.test/slow.th.gif', original], timeoutMs: 4500, fullTimeoutMs: 24000});
    clock.tick(4500);
    assert.equal(state(pool).limit, 1);
    assert.equal(fallback.status, 'queued', 'The failed thumbnail starts a host cooldown');
    clock.tick(251);
    assert.equal(fallback.activeLane, 'large');
    const first = pool.request('https://a.test/first.th.png');
    const second = pool.request('https://a.test/second.th.png', {singleAttempt: true});
    const anotherOriginal = pool.request('https://a.test/another.gif', {lane: 'large', priority: 100});
    assert.equal(first.status, 'loading');
    assert.equal(second.status, 'queued');
    assert.equal(anotherOriginal.status, 'queued');
    first.image.succeed();
    assert.equal(second.status, 'loading');
    second.image.fail();
    const third = pool.request('https://a.test/third.th.png');
    assert.equal(third.status, 'queued', 'The thumbnail reserve still respects host cooldowns');
    clock.tick(state(pool).until - clock.env.now() + 1);
    assert.equal(third.status, 'loading');
    third.image.succeed();
    assert.equal(fallback.status, 'loading');
    assert.equal(anotherOriginal.status, 'queued');
  } finally { pool.dispose(); }
});

test('[HOST-02] a stable serial RTT change can establish a new baseline and resume cautious growth',()=>{
  const{clock,pool}=setup();try{
    batch(pool,clock,4);batch(pool,clock,1,'a.test',500);assert.equal(state(pool).limit,2);
    batch(pool,clock,1,'a.test',500);assert.equal(state(pool).limit,1);
    batch(pool,clock,20,'a.test',500);assert.equal(state(pool).baseline,500,'continued serial traffic must not postpone recovery forever');
    batch(pool,clock,4,'a.test',500);assert.equal(state(pool).limit,2);
    assert.equal(validateSettings({concurrency:2.9}).concurrency,2);assert.equal(pool.active,0);assert.equal(clock.timers.size,0);
  }finally{pool.dispose();}
});

test('[HOST-04] switching away and returning does not turn interrupted timing into host slowdown',()=>{
  const{clock,pool}=setup();try{
    batch(pool,clock,4);assert.equal(state(pool).limit,3);
    const entry=pool.request('https://a.test/interrupted.th.png');let hidden=true;clock.env.hidden=()=>hidden;pool.pump();
    clock.tick(1000);hidden=false;pool.pump();clock.images.at(-1).succeed();
    assert.equal(entry.status,'ready');assert.equal(state(pool).limit,3);assert.equal(state(pool).good,0);
  }finally{pool.dispose();}
});

test('[HOST-04] background watchdog expiry does not penalize a host but actual image errors still do',()=>{
  const{clock,pool}=setup({maxRetries:0,stallMs:1000,timeoutMs:3000});try{
    pool.request('https://a.test/timing.th.png');let hidden=true;clock.env.hidden=()=>hidden;pool.pump();clock.tick(3000);
    assert.equal(state(pool).limit,2);assert.equal(state(pool).failures.length,0);
    const actual=pool.request('https://b.test/error.png',{lane:'large',priority:100});assert.equal(actual.status,'loading');clock.images.at(-1).fail();
    assert.equal(state(pool,'b.test').limit,1);assert.equal(state(pool,'b.test').failures.length,1);
  }finally{pool.dispose();}
});
