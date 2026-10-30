import {fixtureHTML,rowHTML,overlayHTML} from './helpers.mjs';
import {escapeHTML} from '../src/core.mjs';

function browserSetup(profile,nativeLayout=false) {
  const prefix='ep-qa:'+profile+':';let fault='';let backup='';let lastHovered;
  const get=(key,fallback)=>{const raw=localStorage.getItem(prefix+key);return raw===null?fallback:JSON.parse(raw);};
  window.GM_getValue=get;window.GM_setValue=(key,value)=>{if(fault===key){fault='';document.getElementById('qa-fault-status').textContent='Write fault triggered';throw new Error('Injected storage failure');}localStorage.setItem(prefix+key,JSON.stringify(value));};
  window.GM_listValues=()=>Object.keys(localStorage).filter(k=>k.startsWith(prefix)).map(k=>k.slice(prefix.length));
  window.GM_deleteValue=key=>localStorage.removeItem(prefix+key);window.GM_registerMenuCommand=()=>{};
  window.GM_addStyle=css=>{const style=document.createElement('style');style.textContent=css;document.head.append(style);};
  if(get('qa.initialized',false)!==true){
    GM_setValue('qa.initialized',true);GM_setValue('ep.mediaRevision',2);
    GM_setValue('ep.settings',{thumbnailSize:64,stallMs:1000,timeoutMs:4000,thumbnailTimeoutMs:1500,favoriteTags:'panorama',cautionTags:'handheld',...(nativeLayout?{recoverImages:false,recoverBackgrounds:false}:{})});
    GM_setValue('ep.searches',[{id:'landscape',title:'Landscapes',fields:[{name:'taglist',type:'textarea',value:'landscape',checked:false},{name:'filter_cat[1]',type:'checkbox',value:'1',checked:true}]}]);
  }
  const originalClick=HTMLAnchorElement.prototype.click;
  const blobs=new Map(),create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);blobs.set(url,blob);return url;};
  HTMLAnchorElement.prototype.click=function(){
    if(this.download&&blobs.has(this.href)){blobs.get(this.href).text().then(text=>{backup=text;localStorage.setItem(prefix+'qa.backup',text);document.getElementById('qa-transfer').textContent='Backup captured locally ('+text.length+' characters); no file downloaded.';});return;}
    return originalClick.call(this);
  };
  document.addEventListener('pointerover',event=>{const button=event.target.closest?.('.epc-thumb-button');if(button)lastHovered=button.closest('tr');});
  document.addEventListener('contextmenu',event=>{const title=event.target.closest?.('.fixture-title');if(title)setTimeout(()=>{document.getElementById('qa-title-context').textContent=JSON.stringify({defaultPrevented:event.defaultPrevented,title:title.textContent,href:title.href});},0);});
  addEventListener('error',event=>{if(event.error){const out=document.getElementById('qa-errors');if(out)out.textContent+=event.message+'\n';}});
  addEventListener('unhandledrejection',event=>{const out=document.getElementById('qa-errors');if(out)out.textContent+=String(event.reason)+'\n';});
  document.addEventListener('DOMContentLoaded',()=>{
    const form=document.getElementById('search_form'),params=new URLSearchParams(location.search);
    if(form){form.method='get';form.action='/torrents.php';for(const control of form.elements){
      if(params.has(control.name)){if(control.type==='checkbox')control.checked=true;else control.value=params.get(control.name);}
      if(control.type==='hidden'||control.tagName==='BUTTON')continue;
      const label=document.createElement('label');label.textContent=control.name;control.before(label);label.append(control);
    }}
    document.getElementById('qa-inspect').onclick=()=>{const entries=Object.fromEntries(GM_listValues().filter(k=>!k.startsWith('qa.')).map(k=>[k,get(k)]));document.getElementById('qa-state').textContent=JSON.stringify(entries,null,2);};
    document.getElementById('qa-fail').onclick=()=>{fault=document.getElementById('qa-fault-key').value;document.getElementById('qa-fault-status').textContent='Next '+fault+' write will fail';};
    document.getElementById('qa-restore').onclick=()=>{
      const json=backup||localStorage.getItem(prefix+'qa.backup');if(!json)return;
      const files=new DataTransfer();files.items.add(new File([json],'qa-backup.json',{type:'application/json'}));
      const picker=document.querySelector('.epc-workspace input[type=file]');picker.files=files.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
    };
    document.getElementById('qa-gallery').onclick=()=>{const gallery=document.getElementById('qa-gallery-content');gallery.classList.remove('hidden');for(const image of gallery.querySelectorAll('[data-src]'))image.src=image.dataset.src;};
    document.getElementById('qa-remove').onclick=()=>{document.getElementById('qa-removal').textContent='Hover a result now; removal in two seconds.';setTimeout(()=>{lastHovered?.remove();document.getElementById('qa-removal').textContent='Hovered result removed';},2000);};
    document.getElementById('qa-page-fail').onclick=()=>fetch('/qa-control?profile='+encodeURIComponent(profile)+'&fault=page3',{method:'POST'}).then(()=>document.getElementById('qa-fault-status').textContent='Page 3 will fail once');
    document.getElementById('qa-page-delay').onclick=()=>fetch('/qa-control?profile='+encodeURIComponent(profile)+'&fault=delay',{method:'POST'}).then(()=>document.getElementById('qa-fault-status').textContent='Next backfill page delayed');
    document.getElementById('qa-network-inspect').onclick=()=>fetch('/qa-network?profile='+encodeURIComponent(profile)).then(r=>r.json()).then(data=>document.getElementById('qa-network').textContent=JSON.stringify(data,null,2));
    document.getElementById('qa-reset').onclick=()=>{for(const key of Object.keys(localStorage))if(key.startsWith(prefix))localStorage.removeItem(key);location.href='/torrents.php?qa='+encodeURIComponent(profile);};
    document.getElementById('qa-empty').onclick=()=>{for(const key of Object.keys(localStorage))if(key.startsWith(prefix))localStorage.removeItem(key);GM_setValue('qa.initialized',true);location.reload();};
    document.getElementById('qa-change-image').onclick=()=>{const image=document.querySelector('#qa-gallery-content img');if(image)image.src='/qa-image/'+profile+'/changed-gallery.svg';const cover=document.querySelector('.qa-cover');if(cover)cover.style.backgroundImage='url(/qa-image/'+profile+'/changed-cover.svg)';};
    document.getElementById('qa-layout-narrow')?.addEventListener('click',()=>document.getElementById('content').style.maxWidth='720px');
    document.getElementById('qa-layout-wide')?.addEventListener('click',()=>document.getElementById('content').style.maxWidth='');
  });
}

export function qaBrowserHTML(url,profile) {
  const nativeLayout=url.searchParams.has('native-layout');
  const pageSize=nativeLayout?50:6,totalPages=nativeLayout?Math.min(12,Math.max(6,Number(url.searchParams.get('layout-pages'))||6)):3;
  const page=Number(url.searchParams.get('page')||1),start=(page-1)*(pageSize-1)+1;
  const samples=Array.from({length:pageSize},(_,i)=>{
    const id=start+i;
    return {id,title:id===1?'Mountain Walk [2026.10.19] [720p]':id===2?'Mountain Walk [2026.10.19] [1080p]':id===7?'Mountain Walk [2026.10.19] [2160p]':'Valley Scene '+id+' [1080p]',
      tags:id===3?'blocked landscape':id===4?'hard panorama':id===5?'handheld landscape':'landscape panorama'};
  });
  const image=(kind,id)=>'http://127.0.0.1:8765/qa-image/'+profile+'/'+kind+'-'+id+'.svg';
  const rows=samples.map(s=>rowHTML(s.id,{title:s.title,tags:s.tags})).join('');
  const defs=samples.map(s=>overlayHTML(s.id,image(s.id===4&&url.searchParams.has('large-fail')||s.id===5&&!url.searchParams.has('small-fallback')?'broken':'full',s.id),image(s.id===5?'broken-small':'small',s.id))).join('');
  const parameters=new URLSearchParams(url.searchParams);
  const href=p=>{const next=new URLSearchParams(parameters);next.set('page',p);return '/torrents.php?'+next;};
  const pager=Array.from({length:totalPages},(_,i)=>'<a class="pager_page" href="'+escapeHTML(href(i+1))+'">'+(i+1)+'</a>').join(' · ')+(page<totalPages?' · <a class="pager_next" href="'+escapeHTML(href(page+1))+'">Next</a>':'');
  const driver='<section class="epc-root qa-driver"><h1>Persistent browser acceptance fixture</h1><p>Profile '+escapeHTML(profile)+' · page '+page+' · local data only</p><div class="qa-tools">'+
    '<button id="qa-inspect">Inspect saved test data</button><select id="qa-fault-key" aria-label="Storage fault key"><option>ep.searches</option><option>ep.settings</option></select><button id="qa-fail">Fail next storage write</button><span id="qa-fault-status" role="status"></span>'+
    '<button id="qa-restore">Restore captured test backup</button><span id="qa-transfer" role="status"></span><button id="qa-gallery">Reveal test gallery</button><button id="qa-remove">Remove hovered row in 2 seconds</button><span id="qa-removal"></span>'+
    '<button id="qa-page-fail">Fail page 3 once</button><button id="qa-page-delay">Delay next backfill page</button><button id="qa-network-inspect">Inspect fixture requests</button><button id="qa-reset">Reset this test profile</button><button id="qa-empty">Fresh empty profile</button><button id="qa-change-image">Change gallery and cover</button>'+(nativeLayout?'<button id="qa-layout-narrow">720px table</button><button id="qa-layout-wide">Full-width table</button>':'')+'</div>'+
    '<details><summary>Persisted test data</summary><pre id="qa-state"></pre></details><details><summary>Fixture requests</summary><pre id="qa-network"></pre></details><details><summary>Uncaught script errors</summary><pre id="qa-errors"></pre></details><details><summary>Title menu probe</summary><pre id="qa-title-context"></pre></details></section>';
  let html=fixtureHTML(rows,defs).replace('<body id="torrents">','<body id="torrents">'+driver)
    .replace(/<a class="pager_prev"[\s\S]*?<\/a><a class="pager_next"[\s\S]*?<\/a>/,pager)
    .replace('<head>','<head><meta charset="utf-8"><title>Companion persistent QA fixture</title>')
    .replace('<h2>Local test page</h2>','<h2>Results</h2><p id="qa-criteria">Server criteria: '+escapeHTML([...url.searchParams].map(([k,v])=>k+'='+v).join(' · '))+'</p>')
    .replace('</form>','<input type="hidden" name="qa" value="'+escapeHTML(profile)+'"></form>')
    .replace('</body>','<section id="qa-gallery-content" class="hidden spoiler"><h2>Deferred gallery</h2><img data-src="'+image('gallery',1)+'" alt="Deferred neutral landscape"><div class="torrent__cover qa-cover" style="height:150px;width:260px;background-size:cover;background-image:url('+image('cover',1)+')"></div></section></body>');
  if(url.searchParams.has('narrow'))html=html.replace('</head>','<style>.qa-driver{display:none}body{margin:8px!important}.qa-table-scroll{overflow-x:auto}</style></head>').replace('<table class="torrent_table">','<div class="qa-table-scroll"><table class="torrent_table">').replace('</table>','</table></div>');
  if(nativeLayout)html=html.replace('<tbody>','<tbody><tr class="colhead_dark"><td class="small cats_col"></td><td width="100%">Name</td><td>Files</td><td>Comm</td><td>Time</td><td>Size</td><td>↻</td><td>↑</td><td>↓</td><td>Uploader</td></tr><tr class="colhead"><td colspan="10">Monday 19th October 2026</td></tr>')
    .replace(/<td>3<\/td><td>4<\/td>/g,'<td class="nobr">'+(page>=7?'18 days 23 hours ago':'18 mins ago')+'</td><td class="nobr">19.54 GiB</td>')
    .replace('</head>','<style>.torrent_table .colhead_dark td{font-size:16px!important;white-space:nowrap;font-weight:700;background:#9db8cf}.torrent_table .colhead td{text-align:center;background:#9db8cf}.torrent_table .nobr{white-space:nowrap}.torrent_table .cats_col{width:48px}</style></head>');
  return html.replace('</head>','<style>body{font:14px system-ui;background:#f0f3f8;color:#17213a;margin:18px}a{color:#285de0}.username,.pager_prev{display:none}.qa-driver{padding:12px;border:1px solid #bdc9dd;border-radius:7px;margin-bottom:16px}.qa-driver h1{font-size:18px;margin:0}.qa-tools{display:flex;gap:6px;flex-wrap:wrap}.qa-driver pre{font-size:11px;white-space:pre-wrap;max-height:240px;overflow:auto}#search_form{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;padding:8px;background:white}#search_form label{display:flex;flex-direction:column;font-size:11px}#search_form input,#search_form textarea,#search_form select{font:inherit;max-width:100%;padding:4px}#search_form [type=checkbox]{align-self:start}.torrent_table{border-collapse:collapse;width:100%}td{padding:10px 5px;border-bottom:1px solid #cbd5e6}td:not(:nth-child(2)){font-size:11px}.cats_col{width:30px}.tags{margin-top:8px;font-size:12px}.tags a{margin-right:7px}.torrent_icon_container{float:right}#qa-gallery-content img{max-width:90%}</style>'+
    '<script>('+browserSetup.toString()+')('+JSON.stringify(profile)+','+nativeLayout+');</script><script src="'+(url.searchParams.get('qa-version')==='2.7.0'?'/qa-old-bundle.js':'/EmporniumCompanion.js')+'"></script></head>');
}
