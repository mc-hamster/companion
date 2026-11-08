import test from 'node:test';
import assert from 'node:assert/strict';
import {boot,strictStorage,clickText,pane,field,rowHTML,fixtureHTML,settle} from './acceptance-helpers.mjs';
import {until} from './helpers.mjs';
import {validateSettings} from '../src/core.mjs';
const dialog=f=>f.doc.querySelector('.epc-onboarding');
const mode=(f,value)=>{const input=dialog(f).querySelector('[name="welcome-backfill"][value="'+value+'"]');input.checked=true;input.dispatchEvent(new f.win.Event('change',{bubbles:true}));};
const fresh=()=>strictStorage({'ep.onboardingDone':false});
const resultPage=(url,last=8)=>{
  const n=Number(new URL(url).searchParams.get('page'));
  const html=fixtureHTML(rowHTML(n+10,{title:'Landscape '+n}), '').replace(/<a class="pager_prev"[\s\S]*?<\/a><a class="pager_next"[\s\S]*?<\/a>/,
    n<last?'<a class="pager_next" href="/torrents.php?page='+(n+1)+'">Next</a>':'');
  return {ok:true,url,headers:new Map([['content-type','text/html']]),text:async()=>html};
};
test('[ONB-01] first use introduces Companion, shows Settings guidance and defers automatic backfill until Finish',async()=>{
  const store=fresh(),calls=[];const f=await boot({}, {store,fetch:async url=>{calls.push(url);return resultPage(url);}});
  try{
    const d=dialog(f);assert.ok(d?.open);assert.match(d.textContent,/These options—and much more—are available in Settings anytime/);
    assert.equal(d.querySelector('#epc-welcome-title').textContent, 'Welcome to Companion');
    assert.equal(d.querySelector('[name="welcome-backfill"]:checked').value,'pages');
    assert.equal(d.querySelector('input[type=number]').value,'3');assert.equal(calls.length,0);
    clickText(d,'Start browsing');await until(()=>calls.length===3&&!f.doc.querySelector('[data-ep-backfill][aria-busy=true]'),'three additional pages',6000);
    assert.equal(store.get('ep.onboardingDone'),true);assert.equal(store.get('ep.settings').backfillMode,'pages');
    assert.equal(store.get('ep.settings').backfillPages,3);assert.equal(dialog(f),null);
    await settle(80);assert.equal(calls.length,3,'DOM scans must not trigger another automatic batch');
  }finally{f.close();}
});
test('[ONB-01] Not now preserves defaults, never fetches and does not reopen on another load',async()=>{
  const store=fresh(),calls=[];let f=await boot({}, {store,fetch:async url=>{calls.push(url);return resultPage(url);}});
  try{clickText(dialog(f),'Not now');await settle();assert.equal(dialog(f),null);assert.equal(calls.length,0);assert.equal(store.get('ep.onboardingDone'),true);}finally{f.close();}
  f=await boot({}, {store});try{assert.equal(dialog(f),null);pane(f,'settings');clickText(f.doc.querySelector('.epc-pane[data-pane=settings]'),'Getting started');assert.ok(dialog(f));assert.equal(dialog(f).querySelector('[name="welcome-backfill"]:checked').value,'off');assert.equal(dialog(f).querySelector('[data-welcome-setting=keyboardShortcuts]').checked,false);}finally{f.close();}
});

test('onboarding and Keyboard & menus share one shortcut preference and reference', async () => {
  const store = fresh(), f = await boot({}, { store });
  try {
    const welcomeToggle = '[data-welcome-setting=keyboardShortcuts]';
    const settingsToggle = '[data-setting=keyboardShortcuts]';
    const welcomeList = dialog(f).querySelector('.epc-shortcut-list');
    assert.equal(dialog(f).querySelector(welcomeToggle).checked, false);
    assert.equal(welcomeList.hidden, true);
    await field(f, welcomeToggle, true);
    assert.equal(welcomeList.hidden, false);
    assert.match(welcomeList.textContent, /Ctrl\+S \/ Cmd\+S/);
    assert.equal(store.get('ep.settings').keyboardShortcuts, false, 'setup keeps a draft until submitted');
    mode(f, 'off');
    clickText(dialog(f), 'Start browsing');
    assert.equal(store.get('ep.settings').keyboardShortcuts, true);

    pane(f, 'settings');
    const keyboard = f.doc.querySelector('[data-option-group=interaction]');
    assert.equal(keyboard.querySelector(settingsToggle).checked, true);
    const settingsList = keyboard.querySelector('.epc-shortcut-list');
    assert.equal(settingsList.textContent, welcomeList.textContent);
    await field(f, settingsToggle, false);
    assert.equal(store.get('ep.settings').keyboardShortcuts, false);
    assert.equal(settingsList.hidden, false, 'Settings keeps the reference available');
    assert.equal(keyboard.querySelector('[data-setting=navigationScope]').disabled, true);
    clickText(f.doc.querySelector('.epc-pane[data-pane=settings]'), 'Getting started');
    assert.equal(dialog(f).querySelector(welcomeToggle).checked, false);
    assert.equal(dialog(f).querySelector('.epc-shortcut-list').hidden, true);
  } finally { f.close(); }
});
test('[ONB-02] replay prefills custom values, cancels without writes and preserves unrelated preferences and searches',async()=>{
  const original={thumbnailSize:88,previews:false,inlineThumbnails:false,groupVersions:false,concurrency:4,cacheEntries:52,backfillPages:7,backfillMode:'off',favoriteTags:'landscape',cautionTags:'road'};
  const store=strictStorage({'ep.settings':original,nseTaglist:'blocked',nseWhitelist:'allowed','ep.searches':[{id:'saved',title:'Landscape',fields:[{name:'taglist',type:'textarea',value:'landscape',checked:false}]}]});
  const f=await boot({}, {store});
  try{
    pane(f,'settings');clickText(f.doc.querySelector('.epc-pane[data-pane=settings]'),'Getting started');
    assert.equal(dialog(f).querySelector('select').value,'88');assert.equal(dialog(f).querySelectorAll('input[type=checkbox]')[0].checked,false);
    const before=store.snapshot();mode(f,'all');clickText(dialog(f),'Cancel');assert.deepEqual(store.snapshot(),before);
    clickText(f.doc.querySelector('.epc-pane[data-pane=settings]'),'Getting started');clickText(dialog(f),'Save changes');
    assert.equal(store.get('ep.settings').cacheEntries,52);assert.equal(store.get('ep.settings').concurrency,4);assert.equal(store.get('ep.settings').thumbnailSize,88);
    assert.equal(store.get('ep.settings').backfillPages,7);assert.equal(store.get('ep.settings').inlineThumbnails,false);
    assert.equal(store.get('nseTaglist'),'blocked');assert.equal(store.get('nseWhitelist'),'allowed');assert.equal(store.get('ep.searches')[0].title,'Landscape');
    assert.equal(f.doc.querySelector('[data-setting=thumbnailSize]').value,'88');assert.equal(f.errors.length,0,f.errors.join('\n'));
  }finally{f.close();}
});
test('[ONB-02] existing preferences on first upgrade are prefilled instead of replaced with suggested defaults',async()=>{
  const f=await boot({'ep.onboardingDone':false,'ep.settings':{thumbnailSize:140,backfillPages:12,previews:false,groupVersions:false}});
  try{assert.equal(dialog(f).querySelector('select').value,'140');assert.equal(dialog(f).querySelector('input[type=number]').value,'12');assert.equal(dialog(f).querySelector('[name="welcome-backfill"]:checked').value,'off');clickText(dialog(f),'Start browsing');assert.equal(f.store.get('ep.settings').backfillPages,12);}finally{f.close();}
});
test('[ONB-03] invalid count blocks Finish; hidden count is ignored for manual mode; tags use existing live filters',async()=>{
  const store=fresh(),f=await boot({}, {store,rows:rowHTML(1,{tags:'blocked'})+rowHTML(2)});
  try{
    const d=dialog(f),count=d.querySelector('input[type=number]');count.value='0';clickText(d,'Start browsing');assert.ok(dialog(f));assert.equal(store.get('ep.onboardingDone'),false);
    mode(f,'off');const tags=d.querySelectorAll('textarea');tags[0].value='blocked';tags[1].value='sample.tag';tags[2].value='warning';
    clickText(d,'Start browsing');await settle();assert.equal(dialog(f),null);assert.equal(store.get('ep.settings').backfillMode,'off');assert.equal(store.get('nseTaglist'),'blocked');
    assert.equal(f.doc.querySelector('[data-fixture-id="1"]').classList.contains('hidden'),true);
    assert.equal(store.get('ep.settings').favoriteTags,'sample.tag');assert.equal(store.get('ep.settings').cautionTags,'warning');
    pane(f,'filters');assert.equal(f.doc.querySelector('[data-setting=favoriteTags]').value,'sample.tag');assert.equal(f.errors.length,0,f.errors.join('\n'));
  }finally{f.close();}
});
test('[ONB-03] failed persistence rolls back completion and preferences, retains the draft and allows retry',async()=>{
  const store=fresh(),calls=[],f=await boot({}, {store,fetch:async url=>{calls.push(url);return resultPage(url);}});
  try{
    const before=store.snapshot();store.failNext('nseTaglist');clickText(dialog(f),'Start browsing');await settle();
    assert.ok(dialog(f));assert.match(dialog(f).querySelector('[role=alert]').textContent,/Could not save/);
    assert.deepEqual(store.snapshot(),before);assert.equal(calls.length,0);
    mode(f,'off');clickText(dialog(f),'Start browsing');assert.equal(dialog(f),null);assert.equal(store.get('ep.onboardingDone'),true);
  }finally{f.close();}
});
test('[ONB-03] Escape dismisses setup safely, and ordinary arrow navigation never runs inside the dialog',async()=>{
  const f=await boot({}, {store:fresh()});
  try{const d=dialog(f);d.dispatchEvent(new f.win.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.ok(dialog(f));
    d.dispatchEvent(new f.win.Event('cancel',{cancelable:true}));assert.equal(dialog(f),null);assert.equal(f.store.get('ep.onboardingDone'),true);
  }finally{f.close();}
});
test('[BFL-07] backfill mode is validated and defaults to manual',()=>{
  assert.equal(validateSettings({}).backfillMode,'off');assert.equal(validateSettings({backfillMode:'unsafe'}).backfillMode,'off');
  assert.equal(validateSettings({backfillMode:'all',backfillPages:4.9}).backfillMode,'all');assert.equal(validateSettings({backfillPages:4.9}).backfillPages,4);
});

test('[ONB-01] a first-use page opened in the background waits for foreground before showing setup',async()=>{
  let hidden=true;const f=await boot({}, {store:fresh(),hidden:()=>hidden});
  try{assert.equal(dialog(f),null);hidden=false;f.doc.dispatchEvent(new f.win.Event('visibilitychange'));assert.ok(dialog(f)?.open);assert.equal(f.doc.querySelectorAll('.epc-onboarding').length,1);f.doc.dispatchEvent(new f.win.Event('visibilitychange'));assert.equal(f.doc.querySelectorAll('.epc-onboarding').length,1);}finally{f.close();}
});
