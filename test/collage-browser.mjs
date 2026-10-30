import {fixtureHTML} from './helpers.mjs';

// Neutral native-shaped cover cards. Runs the release bundle before body parsing.
function setup(profile,options={}){
  const begin=performance.now(),prefix='ep-collage:'+profile+':';
  const get=(key,fallback)=>{const value=localStorage.getItem(prefix+key);return value===null?fallback:JSON.parse(value);};
  window.GM_getValue=get;window.GM_setValue=(key,value)=>localStorage.setItem(prefix+key,JSON.stringify(value));
  window.GM_listValues=()=>Object.keys(localStorage).filter(k=>k.startsWith(prefix)).map(k=>k.slice(prefix.length));
  window.GM_deleteValue=key=>localStorage.removeItem(prefix+key);window.GM_registerMenuCommand=()=>{};
  window.GM_addStyle=css=>{const style=document.createElement('style');style.textContent=css;document.head.append(style);};
  if(!get('qa.initialized',false)){GM_setValue('qa.initialized',true);GM_setValue('ep.onboardingDone',true);GM_setValue('ep.mediaRevision',2);GM_setValue('ep.settings',{hoverDelay:0,maxRetries:options.retry?1:0,stallMs:options.slow?8000:1000,timeoutMs:options.slow?12000:5000,thumbnailTimeoutMs:1500});}
  let smallFinished=0,fullFinished=0,lastElapsed=0,atScroll=0;
  const images=[];
  const publish=()=>{
    const out=document.getElementById('cover-metrics');if(!out)return;
    out.dataset.small=smallFinished;out.dataset.full=fullFinished;out.dataset.elapsed=lastElapsed;out.dataset.scroll=atScroll;
    out.textContent=smallFinished+'/28 small covers ready · '+fullFinished+' original responses · '+lastElapsed+' ms · scroll '+atScroll+'px';
    document.getElementById('cover-network').textContent=JSON.stringify(images);
  };
  const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.name.includes('/qa-image/'+profile+'/')){
    const path=new URL(entry.name).pathname.split('/').at(-1);images.push({path,ms:Math.round(entry.responseEnd-begin),duration:Math.round(entry.duration)});
    if(path.startsWith('small'))smallFinished++;if(path.startsWith('full'))fullFinished++;
    lastElapsed=Math.round(entry.responseEnd-begin);atScroll=window.scrollY;publish();
  }});observer.observe({type:'resource',buffered:true});
  addEventListener('error',event=>{if(event.error){const out=document.getElementById('cover-errors');if(out)out.textContent+=event.message+'\n';}});
  addEventListener('unhandledrejection',event=>{const out=document.getElementById('cover-errors');if(out)out.textContent+=String(event.reason)+'\n';});
  document.addEventListener('DOMContentLoaded',()=>{
    publish();
    document.getElementById('cover-toggle').onclick=()=>document.querySelector('.torrent_grid__torrent:last-child')?.classList.toggle('hidden');
    document.getElementById('cover-change').onclick=()=>{const cover=document.querySelector('.torrent__cover');if(cover){cover.dataset.thumbnail='/qa-image/'+profile+'/small-changed.svg';cover.style.backgroundImage='url(/qa-image/'+profile+'/full-changed.svg)';}};
    document.getElementById('cover-remove').onclick=()=>document.querySelector('.torrent_grid__torrent')?.remove();
    document.getElementById('cover-inspect').onclick=()=>fetch('/qa-network?profile='+encodeURIComponent(profile)).then(r=>r.json()).then(requests=>document.getElementById('cover-network').textContent=JSON.stringify(requests));
  });
}

export function collageBrowserHTML(url,profile){
  const retry=url.searchParams.has('retry-upgrade'),slow=retry||url.searchParams.has('slow-upgrade');
  const image=(kind,id)=>'/qa-image/'+profile+'/'+(kind==='full'&&retry?'full-flaky':kind)+'-'+id+'.svg'+(kind==='full'&&slow?'?delay=4000':'');
  const cards=Array.from({length:28},(_,i)=>{const id=i+1;return '<article class="torrent_grid__torrent'+(id===28&&url.searchParams.has('hidden')?' hidden':'')+'" data-cover-id="'+id+'">'+
    '<a class="cover-link" href="/torrents.php?id='+id+'"><div class="torrent__cover" data-thumbnail="'+image(url.searchParams.has('fail-small')&&id===1?'broken-small':'small',id)+'" style="background-image:url('+image(url.searchParams.has('fail-large')&&id===1?'broken-full':'full',id)+')"></div></a>'+
    '<div class="torrent_grid__torrent__info"><a href="/torrents.php?id='+id+'"><h3>Landscape study '+id+'</h3></a><span>Neutral local cover</span></div></article>';}).join('');
  const driver='<section class="epc-root qa-cover-driver"><p>28 neutral covers · native absolute positioning · local controlled responses</p><output id="cover-metrics">Waiting for covers…</output><div><button id="cover-toggle">Hide/show last cover</button> <button id="cover-change">Change first cover</button> <button id="cover-remove">Remove first cover</button> <button id="cover-inspect">Inspect requests</button></div><details><summary>Request evidence</summary><pre id="cover-network"></pre><pre id="cover-errors"></pre></details></section>';
  const css='body{font:14px system-ui;background:#edf2f8;color:#17213a;margin:18px}a{color:#285de0}h2{font-size:22px}.username,#search_box,#filter_slidetoggle,.linkbox,.pager_prev,.pager_next,.torrent_table{display:none}.torrent_grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:18px;margin-top:22px}.torrent_grid__torrent{position:relative;height:265px;border-radius:7px;background:white;box-shadow:0 1px 5px #0002;overflow:hidden}.torrent__cover{position:absolute;top:0;left:0;width:100%;height:194px;background-size:cover;background-position:50% 50%}.torrent_grid__torrent__info{position:absolute;top:194px;left:12px;right:12px}.torrent_grid__torrent__info h3{font-size:14px;margin:10px 0 5px}.torrent_grid__torrent__info span{font-size:12px;color:#617086}.qa-cover-driver output{display:block;padding:12px;background:white;border:1px solid #cbd6e5;border-radius:5px;margin:12px 0}.qa-cover-driver button{font:12px system-ui;padding:5px}.qa-cover-driver pre{white-space:pre-wrap;font-size:11px}.epc-cover-image{border:0}';
  return fixtureHTML('',driver+'<h2>Cover Art</h2><div class="torrent_grid">'+cards+'</div>').replace('<head>','<head><meta charset="utf-8"><title>Collage cover loading — local QA</title>')
    .replace('<h2>Local test page</h2>','<h2>Collage cover loading</h2>')
    .replace('</head>','<style>'+css+'</style><script>('+setup.toString()+')('+JSON.stringify(profile)+','+JSON.stringify({retry,slow})+')</script><script src="'+(url.searchParams.has('baseline')?'/collage-baseline.js':'/EmporniumCompanion.js')+'"></script></head>');
}
