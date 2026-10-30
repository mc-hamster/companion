import {fixtureHTML,rowHTML,overlayHTML} from './helpers.mjs';
export function persistentCacheHTML(url,sha){
  if(url.searchParams.has('cache-frame')){
    const inner=new URL(url);inner.searchParams.delete('cache-frame');
    return '<!doctype html><title>Cache card at 360px — QA</title><h1 style="font:16px system-ui">Cache Settings at 360px</h1><iframe title="Narrow cache Settings" style="width:360px;height:1000px;border:1px solid #aaa" src="'+inner.href.replace(/&/g,'&amp;')+'"></iframe>';
  }
  const profile=(url.searchParams.get('qa')||'disk').replace(/[^\w-]/g,'').slice(0,64),origin='http://127.0.0.1:8765';
  const asset=(kind,i)=>origin+'/qa-image/'+profile+'/'+kind+'-'+i+'.svg';
  const rows=[1,2,3,4].map(i=>rowHTML(i,{title:'Landscape cached view '+i})).join('');
  const defs=[1,2,3,4].map(i=>overlayHTML(i,asset('full',i),asset('small',i))).join('');
  const cards=[1,2,3,4].map(i=>'<article class="torrent_grid__torrent"><a href="/torrents.php?id='+i+'"><div class="torrent__cover" data-thumbnail="'+asset('small',i)+'" style="background-image:url('+asset('full',i)+')"></div></a></article>').join('');
  const next=new URL(url);next.searchParams.set('view',url.searchParams.get('view')==='second'?'third':'second');
  const priority=url.searchParams.has('cache-priority');
  const priorityButtons=priority?'<button id="priority-seed">Seed priority test</button> <button id="priority-large">Try oversized preview</button> <button id="priority-small">Save another small thumbnail</button><pre id="priority-result"></pre>':'';
  const clockButtons=url.searchParams.has('usage-clock')?'<button id="clock-six">Advance 6 minutes</button> <button id="clock-ten">Advance 10 minutes</button> <button id="clock-hour">Advance 1 hour</button>':'';
  const driver='<section class="epc-root"><p>Real IndexedDB, neutral local images, mock manager image transport.</p><button id="cache-stats">Inspect saved cache</button> <button id="cache-block">Block image host</button> <button id="cache-unblock">Unblock image host</button> <a id="cache-next" href="'+next.href.replace(/&/g,'&amp;')+'">Navigate to another test page</a><output id="cache-info"></output>'+priorityButtons+clockButtons+'</section>';
  const setup=`${url.searchParams.has('usage-clock')?'const realNow=Date.now.bind(Date);let clockOffset=0;Date.now=()=>realNow()+clockOffset;':''}
    const prefix=${JSON.stringify('disk-qa:'+profile+':')};
    window.GM_getValue=(k,f)=>{const v=localStorage.getItem(prefix+k);return v===null?f:JSON.parse(v)};
    window.GM_setValue=(k,v)=>localStorage.setItem(prefix+k,JSON.stringify(v));window.GM_listValues=()=>Object.keys(localStorage).filter(k=>k.startsWith(prefix)).map(k=>k.slice(prefix.length));window.GM_deleteValue=k=>localStorage.removeItem(prefix+k);window.GM_registerMenuCommand=()=>{};
    window.GM_addStyle=css=>{const s=document.createElement('style');s.textContent=css;document.head.append(s)};
    GM_setValue('ep.onboardingDone',true);GM_setValue('ep.mediaRevision',2);if(!GM_getValue('ep.settings',null))GM_setValue('ep.settings',{thumbnailSize:64});
    window.GM_xmlhttpRequest=d=>{const c=new AbortController();fetch(d.url,{signal:c.signal,credentials:'omit',redirect:'error'}).then(async r=>d.onload({status:r.status,finalUrl:r.url,response:await r.blob()})).catch(e=>{if(e.name==='AbortError')d.onabort?.();else d.onerror?.();});return{abort:()=>c.abort()}};
    ${priority?`window.installCachePriority=app=>document.addEventListener('DOMContentLoaded',()=>{
      const cache=app.imageCache,out=document.getElementById('priority-result'),small=i=>${JSON.stringify(origin+'/qa-image/'+profile+'/small-')}+i+'.svg',full=${JSON.stringify(asset('full',1))};
      const report=async(accepted)=>{const thumbs=[];for(let i=1;i<=5;i++)thumbs.push(!!await cache.get(small(i)));out.textContent=JSON.stringify({accepted,thumbs,preview:!!await cache.get(full),stats:await cache.stats(),version:(await cache.open()).version});};
      document.getElementById('priority-seed').onclick=async()=>{await cache.clear();cache.limit=()=>3000;for(let i=1;i<=4;i++)await cache.commit(small(i),await(await fetch(small(i))).blob(),cache.epoch,'thumbnail');await cache.commit(full,await(await fetch(full)).blob(),cache.epoch,'preview');await report(true);};
      document.getElementById('priority-large').onclick=async()=>{const svg='<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"></svg><!--'+'x'.repeat(1500)+'-->';await report(await cache.commit(full+'?oversized=1',new Blob([svg],{type:'image/svg+xml'}),cache.epoch,'preview'));};
      document.getElementById('priority-small').onclick=async()=>{await report(await cache.commit(small(5),await cache.get(small(1)),cache.epoch,'thumbnail'));};
    });`:''}
    document.addEventListener('DOMContentLoaded',()=>{
      ${url.searchParams.has('usage-clock')?"for(const[id,minutes]of[['clock-six',6],['clock-ten',10],['clock-hour',60]])document.getElementById(id).onclick=()=>{clockOffset+=minutes*60000;};":''}
      const info=document.getElementById('cache-info');
      document.getElementById('cache-stats').onclick=()=>{const r=indexedDB.open('empornium-companion-images');r.onsuccess=()=>{const db=r.result,t=db.transaction('stats','readonly'),q=t.objectStore('stats').get('total');q.onsuccess=()=>{info.textContent=JSON.stringify(q.result||{count:0,bytes:0});info.dataset.count=q.result?.count||0;};t.oncomplete=()=>db.close();};};
      for(const [id,offline]of[['cache-block',1],['cache-unblock',0]])document.getElementById(id).onclick=()=>fetch('/qa-cache-control?profile='+${JSON.stringify(profile)}+'&offline='+offline).then(()=>{info.textContent=offline?'Image host blocked':'Image host unblocked';});
    });`;
  const css='body{font:14px system-ui;background:#eef2f8;color:#17213a;margin:20px}a{color:#285de0}.username,#search_box,#filter_slidetoggle,.linkbox,.pager_prev,.pager_next{display:none}.torrent_grid{display:flex;gap:14px;margin:16px 0}.torrent_grid__torrent{width:160px;height:90px;position:relative;background:white}.torrent__cover{position:absolute;inset:0;background-size:cover}.torrent_table{width:100%;background:white;border-collapse:collapse;margin-top:16px}.torrent_table td{padding:12px;border-bottom:1px solid #ccd6e8}.torrent_table td:not(:nth-child(2)){display:none}.torrent_icon_container{float:right}.tags{font-size:12px;margin-top:8px}output{display:block;margin:8px 0}';
  return fixtureHTML(rows,defs).replace('<head>','<head>'+(url.searchParams.has('csp')?'<meta http-equiv="Content-Security-Policy" content="img-src \'self\'">':'')+'<meta charset="utf-8"><meta name="qa-artifact" content="'+sha+'"><title>Persistent image cache — browser QA</title>')
    .replace('<h2>Local test page</h2>','<h2>Persistent image cache · '+(url.searchParams.get('view')||'first')+' page</h2>'+driver+'<div class="torrent_grid">'+cards+'</div>')
    .replace('</head>','<style>'+css+'</style><script>'+setup+'</script><script src="'+(priority?'/cache-priority-bundle.js':'/EmporniumCompanion.js')+'"></script></head>');
}
