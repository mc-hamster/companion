// Neutral, persistent browser fixture for the actual built setup and auto-loader.
import {fixtureHTML,rowHTML,overlayHTML} from './helpers.mjs';
export function onboardingHTML(url,sha){
  const profile=(url.searchParams.get('qa')||'welcome').replace(/[^\w-]/g,'').slice(0,64);
  const page=Number(url.searchParams.get('page')||1),last=url.searchParams.has('long')?18:6;
  const next=new URL(url);next.searchParams.set('page',String(page+1));
  const native=url.searchParams.has('native-pager');
  const ids=native?Array.from({length:page===6?10:50},(_,i)=>(page-1)*50+i+1):[page];
  const rows=ids.map(id=>rowHTML(id,{title:'Landscape view '+id,tags:page%2?'landscape':'road'})).join('');
  const linkTo=n=>{const target=new URL(url);target.searchParams.set('page',String(n));return target.pathname+target.search.replace(/&/g,'&amp;')};
  const pager=native?Array.from({length:6},(_,i)=>i+1).map(n=>n===page?'<strong>'+((n-1)*50+1)+'-'+Math.min(n*50,260)+'</strong>':'<a class="pager pager_page" href="'+linkTo(n)+'">'+((n-1)*50+1)+'-'+Math.min(n*50,260)+'</a>').join(' | ')+(page<6?' | <a class="pager pager_next" href="'+linkTo(page+1)+'">Next &gt;</a> | <a class="pager pager_last" href="'+linkTo(6)+'">Last &gt;&gt;</a>':''):null;
  const image='http://127.0.0.1:8765/qa-image/'+profile+'/small-'+page+'.svg';
  const setup=`const prefix=${JSON.stringify('ep-welcome:'+profile+':')};
    const get=(key,fallback)=>{const raw=localStorage.getItem(prefix+key);return raw===null?fallback:JSON.parse(raw)};
    let failWrite=${url.searchParams.has('storagefail')};window.GM_getValue=get;window.GM_setValue=(key,value)=>{if(failWrite&&key==='ep.onboardingDone'){failWrite=false;throw Error('Injected storage failure')}localStorage.setItem(prefix+key,JSON.stringify(value))};
    window.GM_listValues=()=>Object.keys(localStorage).filter(k=>k.startsWith(prefix)).map(k=>k.slice(prefix.length));
    window.GM_deleteValue=key=>localStorage.removeItem(prefix+key);window.GM_registerMenuCommand=()=>{};
    window.GM_addStyle=css=>{const style=document.createElement('style');style.textContent=css;document.head.append(style)};
    ${url.searchParams.has('native-pager')?`if(!get('fixture-initialized',false)){GM_setValue('fixture-initialized',true);GM_setValue('ep.onboardingDone',true);GM_setValue('ep.settings',{backfillMode:'all',backfillPages:2,thumbnailSize:64})}`:''}
    ${url.searchParams.has('existing')?`if(!get('fixture-initialized',false)){GM_setValue('fixture-initialized',true);GM_setValue('ep.settings',{thumbnailSize:88,previews:false,groupVersions:false,backfillPages:7,backfillMode:'off',cacheEntries:52,concurrency:4});GM_setValue('nseTaglist','blocked');}`:''}`;
  return fixtureHTML(rows,ids.map(id=>overlayHTML(id,image,image)).join(''))
    .replace('<head>','<head><meta charset="utf-8"><meta name="qa-artifact" content="'+sha+'"><title>Getting started — browser verification</title>')
    .replace('<h2>Local test page</h2>','<h2>Companion setup · neutral test page</h2><p>Page '+page+' of '+last+'. Settings are saved only in this local test profile.</p>')
    .replace(/<a class="pager_prev"[\s\S]*?<\/a><a class="pager_next"[\s\S]*?<\/a>/,pager!==null?pager:page<last?'<a class="pager_next" href="'+next.pathname+next.search.replace(/&/g,'&amp;')+'">Next page</a>':'')
    .replace('</head>','<style>body{font:14px system-ui;background:#eef2f8;color:#17213a;margin:20px}a{color:#285de0}.username,#search_box,#filter_slidetoggle,.linkbox{display:none}.torrent_table{width:100%;border-collapse:collapse;margin-top:18px;background:white}.torrent_table td{padding:14px;border-bottom:1px solid #d0d9e6}.torrent_table td:not(:nth-child(2)){display:none}.tags{font-size:12px;margin-top:8px}.tags a{margin-right:6px}.torrent_icon_container{float:right}</style><script>'+setup+'</script><script src="'+(url.searchParams.has('baseline290')?'/backfill-290-baseline.js':'/EmporniumCompanion.js')+'"></script></head>');
}
