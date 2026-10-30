import test from 'node:test';
import assert from 'node:assert/strict';
import {MediaPool,DEFAULTS} from '../src/core.mjs';
import {fakeClock} from './helpers.mjs';

// Experimental values above8 are injected directly, without raising production validation limits.
for(const concurrency of [6,8,12,16])test('[PERF-04] '+concurrency+' experimental slots retain bounded work and reserved hover capacity',()=>{
  const clock=fakeClock(),pool=new MediaPool(clock.env,{...DEFAULTS,concurrency});
  try{
    let peak=0;pool.listeners.add(()=>{peak=Math.max(peak,pool.active);assert.ok(pool.active<=concurrency+3);});
    const thumbnails=Array.from({length:50},(_,i)=>pool.request('https://images'+i+'.test/small-'+i+'.png',{lane:'thumbnail'}));
    assert.equal(pool.active,concurrency);assert.equal(clock.images.length,concurrency);
    const ordinary=[0,1].map(i=>pool.request('https://images.test/full-'+i+'.png',{lane:'large',priority:5}));
    assert.equal(pool.active,concurrency+2);
    const hover=pool.request('https://images.test/hover.png',{lane:'large',priority:100});
    assert.equal(hover.status,'loading');assert.equal(pool.active,concurrency+3);
    const queued=pool.request('https://images.test/queued.png',{lane:'large',priority:5});assert.equal(queued.status,'queued');
    for(let i=0;i<clock.images.length;i++)clock.images[i].succeed(160,96);
    assert.equal([...thumbnails,...ordinary,hover,queued].every(e=>e.status==='ready'),true);
    assert.equal(clock.images.length,54,'no duplicated successful image transfers');
    assert.equal(pool.active,0);assert.equal(pool.queue.length,0);assert.equal(peak,concurrency+3);
  }finally{pool.dispose();}
});
