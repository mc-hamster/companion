import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app.mjs';
import {domFixture,fixtureHTML,overlayHTML,memoryStorage,fakeClock,until,afterFrames} from './helpers.mjs';

async function setup(){
  const f=domFixture(fixtureHTML(undefined,overlayHTML(1,'https://hamsterimg.net/images/stats.jpg'))),clock=fakeClock();
  const app=createApp(f.win,memoryStorage({'ep.settings':{inlineThumbnails:true}}),{Image:clock.env.Image}).start();
  await until(()=>app.root?.dataset.epReady==='true');clock.images[0].succeed(160,90);await afterFrames(f.win);
  const record=[...app.media.thumbnails.values()][0];Object.defineProperty(record.image,'naturalWidth',{get:()=>160});
  Object.assign(app.media.pool.env,clock.env,{hidden:()=>f.doc.hidden});
  return{...f,clock,app,preview:app.preview,button:record.element.querySelector('button'),close(){app.dispose();f.close();}};
}

test('[HOV-10] loading stats quietly show elapsed time and actual retry attempts, then disappear on success',async()=>{
  const f=await setup();try{
    const p=f.preview;p.showFor(f.button);assert.equal(p.loadStats.hidden,true);
    const message=p.statusMessage;f.clock.tick(999);assert.equal(p.loadStats.hidden,true);
    f.clock.tick(1);assert.equal(p.loadStats.textContent,' · 1s');assert.equal(p.loadStats.getAttribute('aria-hidden'),'true');
    assert.equal(p.statusMessage,message);assert.match(p.statusMessage.textContent,/Loading larger/);assert.doesNotMatch(p.status.textContent,/%/);
    f.clock.images[1].fail();f.clock.tick(1000);assert.equal(f.clock.images.length,3);
    assert.equal(p.loadStats.textContent,' · 2s · try 2');f.clock.images[2].succeed(960,540);
    assert.equal(p.status.textContent,'');assert.equal(p.status.hidden,true);assert.equal(p.loadStats.hidden,true);assert.equal(p.statsTimer,null);
    f.clock.tick(5000);assert.equal(f.clock.images.length,3);assert.equal(f.clock.timers.size,0);
  }finally{f.close();}
});

test('[HOV-10] queued preview time continues through slot admission and pinning without extra requests or page scans',async()=>{
  const f=await setup();try{
    for(let i=0;i<3;i++)f.app.media.pool.request('https://other'+i+'.test/full.png',{lane:'large',priority:100});
    let scans=0;const scan=f.app.media.scan.bind(f.app.media);f.app.media.scan=(...args)=>{scans++;return scan(...args);};
    const p=f.preview;p.showFor(f.button);assert.match(p.status.textContent,/Waiting to load larger/);f.clock.tick(1000);
    assert.equal(p.loadStats.textContent,' · 1s');f.clock.images[1].succeed();assert.equal(f.clock.images.length,5);
    p.showFor(f.button,{pin:true});f.clock.tick(1000);assert.equal(p.loadStats.textContent,' · 2s');
    assert.equal(f.clock.images.length,5);await afterFrames(f.win);assert.equal(scans,0);
    p.hide(true);assert.equal(p.statsTimer,null);assert.equal(p.loadStats.textContent,'');
  }finally{f.close();}
});

test('[HOV-10] stats stop when hidden and resume only for a still-open pinned load; close/dispose cancel their timer',async()=>{
  const f=await setup();try{
    const p=f.preview;p.showFor(f.button,{pin:true});f.clock.tick(1000);assert.equal(p.loadStats.textContent,' · 1s');
    let hidden=true;Object.defineProperty(f.doc,'hidden',{get:()=>hidden});f.doc.dispatchEvent(new f.win.Event('visibilitychange'));
    assert.equal(p.statsTimer,null);f.clock.tick(2000);assert.equal(p.loadStats.textContent,' · 1s');
    hidden=false;f.doc.dispatchEvent(new f.win.Event('visibilitychange'));assert.equal(p.loadStats.textContent,' · 3s');
    p.hide(true);assert.equal(p.statsTimer,null);assert.equal(p.statsSession,null);f.clock.tick(1000);assert.equal(p.loadStats.textContent,'');
    p.showFor(f.button,{pin:true});p.dispose();assert.equal(p.statsTimer,null);assert.equal(p.statsSession,null);
  }finally{f.close();}
});

test('[HOV-10] title tooltips and cached originals stay quiet; failed loads stop the counter and retain the thumbnail',async()=>{
  const f=await setup();try{
    const p=f.preview,title=f.doc.querySelector('.fixture-title');p.showFor(title);assert.equal(p.statsTimer,null);assert.equal(p.loadStats.hidden,true);
    p.hide();f.app.settings.maxRetries=0;f.app.media.pool.settings=f.app.settings;f.app.media.pool.budget.maxRetries=0;
    p.showFor(f.button);f.clock.tick(1000);f.clock.images[1].fail();assert.match(p.status.textContent,/unavailable.*thumbnail/);
    assert.equal(p.loadStats.hidden,true);assert.equal(p.statsTimer,null);assert.match(p.image.src,/stats\.th\.jpg$/);
    f.clock.tick(31001);p.retry();f.clock.images.at(-1).succeed(960,540);p.hide(true);p.showFor(f.button,{pin:true});
    assert.equal(p.status.textContent,'');assert.equal(p.statsTimer,null);assert.equal(p.loadStats.hidden,true);
  }finally{f.close();}
});

test('[HOV-10] an unfinished larger image keeps elapsed feedback without replacing the thumbnail',async()=>{
  const f=await setup();try{
    const p=f.preview;p.showFor(f.button);f.clock.tick(1000);
    const entry=[...f.app.media.pool.entries.values()].find(e=>e.lane==='large');
    entry.image.naturalWidth=960;entry.image.naturalHeight=540;entry.status='partial';f.app.media.pool.emit(entry);
    assert.match(p.image.src,/stats\.th\.jpg$/);f.clock.tick(1000);assert.equal(p.loadStats.textContent,' · 2s');
    entry.image.succeed(960,540);assert.equal(p.status.hidden,true);assert.equal(p.statsTimer,null);assert.equal(f.clock.images.length,2);
  }finally{f.close();}
});
