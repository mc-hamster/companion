import {readFile} from 'node:fs/promises';
import {domFixture,fixtureHTML,rowHTML,overlayHTML,fakeClock,settle,until} from './helpers.mjs';
const bundle=await readFile(new URL('../dist/EmporniumCompanion.user.js',import.meta.url),'utf8');
export function strictStorage(initial={}) {
  const wire=new Map(Object.entries({'ep.onboardingDone':true,...initial}).map(([k,v])=>[k,JSON.stringify(v)]));let fault;
  return {get:(k,d)=>wire.has(k)?JSON.parse(wire.get(k)):d,
    set:(k,v)=>{if(fault===k){fault=null;throw Error('Injected storage failure: '+k);}wire.set(k,JSON.stringify(v));},
    delete:k=>wire.delete(k),list:()=>[...wire.keys()],failNext:key=>fault=key,
    snapshot:()=>Object.fromEntries([...wire].sort()), wire};
}
export async function boot(initial={},options={}) {
  const rows=options.rows ?? rowHTML(1)+rowHTML(2);
  const f=domFixture(fixtureHTML(rows,overlayHTML(1,'https://hamsterimg.net/images/qa.jpg')+(options.extra||'')),options.url);
  const store=options.store||strictStorage({'ep.settings':{inlineThumbnails:false},...initial}),clock=fakeClock(),w=f.win;
  w.GM_getValue=store.get;w.GM_setValue=store.set;w.GM_listValues=store.list;w.GM_deleteValue=store.delete;
  w.GM_registerMenuCommand=()=>{};w.GM_addStyle=css=>{const s=f.doc.createElement('style');s.textContent=css;f.doc.head.append(s);};
  if(options.hidden)Object.defineProperty(f.doc,'hidden',{configurable:true,get:options.hidden});
  w.Image=clock.env.Image;w.confirm=()=>true;if(options.fetch)w.fetch=options.fetch;
  w.eval(bundle);
  if (/^(?:www\.)?empornium\./.test(w.location.hostname)||['localhost','127.0.0.1'].includes(w.location.hostname)) {
    await until(()=>f.doc.querySelector('.epc-workspace[data-ep-ready="true"]'),'Acceptance fixture readiness');
  } else await settle(20);
  return {...f,store,clock};
}
export function clickText(root,text){const button=[...root.querySelectorAll('button')].find(n=>n.textContent===text);if(!button)throw Error('Missing button '+text);button.click();return button;}
export function pane(f,name){f.doc.querySelector('.epc-navigation [data-pane="'+name+'"]').click();}
export async function field(f,selector,value){const input=f.doc.querySelector(selector);if(!input)throw Error('Missing '+selector);if(input.type==='checkbox')input.checked=value;else input.value=value;input.dispatchEvent(new f.win.Event('change',{bubbles:true}));await settle(80);return input;}
export {rowHTML,overlayHTML,fixtureHTML,settle};
