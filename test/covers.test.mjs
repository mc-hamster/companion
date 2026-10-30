import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app.mjs';
import {domFixture,fixtureHTML,memoryStorage,fakeClock,until,settle} from './helpers.mjs';

const cover=(id,source='https://hamsterimg.net/images/cover-'+id+'.gif',extra='')=>'<article class="torrent_grid__torrent '+extra+'" data-cover-id="'+id+'"><a class="cover-link" href="/torrents.php?id='+id+'"><div class="torrent__cover" style="width:190px;height:194px;background-image:url('+source+')"></div></a><div class="torrent_grid__torrent__info"><a href="/torrents.php?id='+id+'"><h3>Neutral cover '+id+'</h3></a><a class="download" href="/torrents.php?action=download&id='+id+'">Download</a></div></article>';
async function setup(markup,settings={}){
  const f=domFixture(fixtureHTML('', '<div class="torrent_grid">'+markup+'</div>')),clock=fakeClock(),storage=memoryStorage({'ep.settings':{inlineThumbnails:false,...settings}});
  const app=createApp(f.win,storage,{Image:clock.env.Image}).start();await until(()=>app.root?.dataset.epReady==='true');
  return{...f,clock,app,storage,close(){app.dispose();f.close();}};
}

test('[COV-01] cover art starts with two per-host slots and warms offscreen cards without original background assignments',async()=>{
  const f=await setup(Array.from({length:28},(_,i)=>cover(i+1)).join(''));
  try{
    assert.ok(f.doc.documentElement.classList.contains('epc-cover-art'));
    assert.equal(f.clock.images.length,2);assert.ok(f.clock.images.every(i=>/\.th\.gif$/.test(i.src)));
    assert.equal(f.app.media.records.size,28);
    for(let i=0;i<28;i++){assert.ok(f.clock.images[i]);f.clock.images[i].succeed(160,90);assert.ok(f.app.media.pool.active<=6);}
    assert.equal(f.clock.images.length,28);assert.equal([...f.app.media.records.values()].every(r=>r.state==='ready'),true);
    assert.equal(f.doc.querySelectorAll('.epc-cover-image').length,28);
    assert.match(f.doc.querySelector('.torrent__cover').style.backgroundImage,/cover-1\.gif/,'native source is preserved for disable/restore');
    assert.equal(f.doc.querySelectorAll('a button').length,0,'no nested control changes normal card navigation');
  }finally{f.close();}
});

test('[COV-02] cover hover upgrades only after success, keeps small pixels on failure, and preserves link navigation',async()=>{
  const f=await setup(cover(1),{maxRetries:0});
  try{
    const record=[...f.app.media.records.values()][0],link=f.doc.querySelector('.cover-link'),preview=f.app.preview;
    f.clock.images[0].succeed(160,90);Object.defineProperty(record.image,'naturalWidth',{get:()=>160});
    link.dispatchEvent(new f.win.MouseEvent('pointerenter'));await settle(10);
    assert.equal(preview.element.dataset.mode,'zoom');assert.match(preview.image.src,/cover-1\.th\.gif$/);
    assert.match(preview.status.textContent,/Loading larger image/);assert.match(f.clock.images[1].src,/cover-1\.gif$/);
    f.clock.images[1].fail();assert.match(preview.image.src,/cover-1\.th\.gif$/);assert.match(preview.status.textContent,/Larger image unavailable/);
    link.dispatchEvent(new f.win.MouseEvent('pointerleave',{clientX:900,clientY:900}));assert.equal(preview.open,false);
    f.app.media.pool.budget.get(record.source).last-=31001;link.dispatchEvent(new f.win.MouseEvent('pointerenter'));await settle(10);
    preview.retry();await until(()=>f.clock.images.length===3);f.clock.images.at(-1).succeed(960,540);assert.equal(preview.element.dataset.state,'ready');assert.match(preview.image.src,/cover-1\.gif(?:\?|$)/);
    preview.frame.click();assert.equal(preview.pinned,true);preview.hide(true);
    let prevented;f.win.addEventListener('click',event=>{prevented=event.defaultPrevented;event.preventDefault();},{once:true});
    link.dispatchEvent(new f.win.MouseEvent('click',{bubbles:true,cancelable:true}));assert.equal(prevented,false);assert.equal(preview.pinned,false);
    assert.equal(f.app.preview.bound.has(f.doc.querySelector('.download')),false);
  }finally{f.close();}
});

test('[COV-03] hidden cover art remains unrequested and foreground recovery resumes queued work',async()=>{
  const f=await setup(cover(1)+cover(2,undefined,'hidden'),{concurrency:1});
  try{
    assert.equal(f.clock.images.length,1);f.clock.images[0].succeed();assert.equal(f.clock.images.length,1);
    let hidden=true;Object.defineProperty(f.doc,'hidden',{get:()=>hidden});
    const card=f.doc.querySelector('[data-cover-id="2"]');card.classList.remove('hidden');await settle();assert.equal(f.clock.images.length,1);
    hidden=false;f.doc.dispatchEvent(new f.win.Event('visibilitychange'));await settle();assert.equal(f.clock.images.length,2);
    assert.match(f.clock.images[1].src,/cover-2\.th\.gif$/);
  }finally{f.close();}
});

test('[COV-03] replacing or removing a cover releases listeners and stale requests; disabling restores native backgrounds',async()=>{
  const f=await setup(cover(1),{concurrency:1});
  try{
    const element=f.doc.querySelector('.torrent__cover'),link=f.doc.querySelector('.cover-link'),stale=f.clock.images[0];
    element.style.backgroundImage='url(https://hamsterimg.net/images/replaced.jpg)';await settle();
    assert.equal(f.app.media.records.size,1);assert.equal(f.doc.querySelectorAll('.epc-cover-image').length,1);
    assert.match(f.clock.images.at(-1).src,/replaced\.th\.jpg$/);stale.succeed();
    assert.equal(f.app.media.records.get(element).state,'loading');
    const previous={...f.app.settings};f.app.settings.recoverBackgrounds=false;f.app.media.updateSettings(previous);await settle();
    assert.equal(f.doc.documentElement.classList.contains('epc-cover-art'),false);assert.equal(f.doc.querySelector('.epc-cover-image'),null);
    assert.match(element.style.backgroundImage,/replaced\.jpg/);assert.equal(f.app.media.pool.active,0);assert.equal(f.app.preview.bound.has(link),false);
    f.app.settings.recoverBackgrounds=true;f.app.media.updateSettings({...previous,recoverBackgrounds:false});await settle();
    assert.ok(f.app.media.records.get(element));element.closest('article').remove();await settle();
    assert.equal(f.app.media.records.size,0);assert.equal(f.app.media.pool.active,0);assert.equal(f.app.media.pool.queue.length,0);assert.equal(f.app.preview.bound.has(link),false);
  }finally{f.close();}
});

test('[COV-01] supplied legacy 300px covers stay in the small lane instead of guessing unsupported thumbnail paths',async()=>{
  const f=await setup(cover(1,'https://fapping.empornium.sx/images/resize/300/date/cover.jpg'));
  try{
    assert.equal(f.clock.images[0].src,'https://fapping.empornium.sx/images/resize/300/date/cover.jpg');
    const record=[...f.app.media.records.values()][0];assert.equal(f.app.media.pool.transferLane(record.lastEntry),'thumbnail');
    assert.equal(record.source,'https://fapping.empornium.sx/images/date/cover.jpg');
  }finally{f.close();}
});

test('[COV-03] native absolute cover positioning survives management and preference changes',async()=>{
  const markup=cover(1).replace('width:190px','position:absolute;width:190px')+cover(2);
  const f=await setup(markup);
  try{
    const [absolute,staticCover]=f.doc.querySelectorAll('.torrent__cover');
    assert.equal(absolute.classList.contains('epc-cover-positioned'),false);
    assert.equal(f.win.getComputedStyle(absolute).position,'absolute');
    assert.equal(staticCover.classList.contains('epc-cover-positioned'),true);
    f.app.settings.recoverBackgrounds=false;f.app.media.updateSettings({...f.app.settings,recoverBackgrounds:true});await settle();
    assert.equal(f.win.getComputedStyle(absolute).position,'absolute');
    assert.equal(staticCover.classList.contains('epc-cover-positioned'),false);
    assert.equal(f.doc.querySelectorAll('.epc-cover-image').length,0);
  }finally{f.close();}
});

test('[COV-02] hovering an absolute cover uses its pixels rather than its empty anchor for pointer geometry',async()=>{
  const f=await setup(cover(1).replace('width:190px','position:absolute;width:190px'));
  try{
    const link=f.doc.querySelector('.cover-link'),element=f.doc.querySelector('.torrent__cover');
    link.getBoundingClientRect=()=>({left:0,right:0,top:0,bottom:0,width:0,height:0});
    element.getBoundingClientRect=()=>({left:80,right:270,top:160,bottom:354,width:190,height:194});
    f.clock.images[0].succeed();Object.defineProperty(element.querySelector('img'),'naturalWidth',{get:()=>160});
    link.dispatchEvent(new f.win.MouseEvent('pointerenter',{clientX:100,clientY:200}));await settle();
    f.win.dispatchEvent(new f.win.MouseEvent('pointermove',{clientX:100,clientY:200}));
    assert.equal(f.app.preview.open,true,'moving inside the cover must not cancel its loading preview');
    await settle();assert.equal(f.app.preview.element.style.left,'74px');assert.equal(f.app.preview.element.style.top,'154px');
    f.win.dispatchEvent(new f.win.MouseEvent('pointermove',{clientX:900,clientY:700}));assert.equal(f.app.preview.open,false);
  }finally{f.close();}
});

test('[COV-01] failed cover thumbnail falls back through the large lane and respects its full deadline',async()=>{
  const f=await setup(cover(1),{thumbnailTimeoutMs:1500,timeoutMs:4000});
  try{
    const record=[...f.app.media.records.values()][0];
    f.clock.images[0].fail();await until(()=>f.clock.images.length===2);assert.match(f.clock.images[1].src,/cover-1\.gif$/);
    assert.equal(f.app.media.pool.transferLane(record.lastEntry),'large');
    await settle(1700);assert.notEqual(record.state,'retrying');assert.equal(f.clock.images.length,2);
    f.clock.images[1].succeed(960,540);
    assert.equal(record.state,'ready');assert.match(record.image.src,/cover-1\.gif$/);assert.equal(record.status.hidden,true);
  }finally{f.close();}
});

test('[COV-02] neighboring cards under an enlargement cannot steal its hover or start an original transfer',async()=>{
  const f=await setup(cover(1)+cover(2));
  try{
    for(const image of [...f.clock.images])image.succeed();
    const [first,second]=f.doc.querySelectorAll('.cover-link'),preview=f.app.preview;
    first.dispatchEvent(new f.win.MouseEvent('pointerenter',{clientX:40,clientY:40}));await settle();
    const count=f.clock.images.length;
    first.dispatchEvent(new f.win.MouseEvent('pointerleave',{clientX:260,clientY:40,relatedTarget:second}));
    second.dispatchEvent(new f.win.MouseEvent('pointerenter',{clientX:260,clientY:40}));await settle();
    assert.equal(preview.anchor,first);assert.equal(f.clock.images.length,count);
    f.win.dispatchEvent(new f.win.MouseEvent('pointermove',{clientX:900,clientY:700}));
    second.dispatchEvent(new f.win.MouseEvent('pointerenter',{clientX:600,clientY:40}));await settle();
    assert.equal(preview.anchor,second);assert.equal(f.clock.images.length,count+1);
  }finally{f.close();}
});
