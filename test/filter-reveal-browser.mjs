import {fixtureHTML,rowHTML,overlayHTML} from './helpers.mjs';

export function filterRevealHTML(url,sha){
  const profile=(url.searchParams.get('qa')||'reveal').replace(/[^\w-]/g,'').slice(0,64),origin='http://127.0.0.1:8765';
  const mode=url.searchParams.get('mode')||'ordinary';
  const samples=[['Mountain Walk [720p]','landscape'],['Mountain Walk [1080p]','blocked'],['Mountain Walk [2160p]','landscape'],['Valley Study','blocked']];
  if(mode==='removed') samples[1][1]='hard';
  if(mode==='all-removed') for(const sample of samples) sample[1]='hard';
  const rows=samples.map(([title,tags],i)=>rowHTML(i+1,{title,tags})).join('');
  const defs=samples.map((_,i)=>overlayHTML(i+1,origin+'/qa-image/'+profile+'/full-'+(i+1)+'.svg',origin+'/qa-image/'+profile+'/small-'+(i+1)+'.svg')).join('');
  const cards=samples.map(([title],i)=>'<div class="torrent_grid__torrent" data-card="'+(i+1)+'"><a href="/torrents.php?id='+(i+1)+'"><div class="torrent__cover" style="background-image:url('+origin+'/qa-image/'+profile+'/full-'+(i+1)+'.svg)"></div>'+title+'</a></div>').join('');
  const setup=`const prefix=${JSON.stringify('ep-reveal:'+profile+':')};
    const get=(key,fallback)=>{const raw=localStorage.getItem(prefix+key);return raw===null?fallback:JSON.parse(raw)};
    window.GM_getValue=get;window.GM_setValue=(key,value)=>localStorage.setItem(prefix+key,JSON.stringify(value));
    window.GM_listValues=()=>Object.keys(localStorage).filter(k=>k.startsWith(prefix)).map(k=>k.slice(prefix.length));
    window.GM_deleteValue=key=>localStorage.removeItem(prefix+key);window.GM_registerMenuCommand=()=>{};
    window.GM_addStyle=css=>{const style=document.createElement('style');style.textContent=css;document.head.append(style)};
    if(!get('initialized',false)){GM_setValue('initialized',true);GM_setValue('ep.mediaRevision',2);GM_setValue('nseTaglist','blocked');GM_setValue('ep.settings',{thumbnailSize:64});GM_setValue('nseHardPassEnabled',true);GM_setValue('nseHardPassTaglist','hard');GM_setValue('nseRemoveHardPassResults',true)}`;
  const css='body{font:14px system-ui;background:#eef2f8;color:#17213a;margin:20px}h2{font-size:22px}a{color:#285de0}.username,#search_box,#filter_slidetoggle,.linkbox,.pager_prev,.pager_next{display:none}.torrent_table{width:100%;border-collapse:collapse;margin-top:18px;background:white}.torrent_table td{padding:14px;border-bottom:1px solid #d0d9e6}.torrent_table td:not(:nth-child(2)){display:none}.tags{font-size:12px;margin-top:8px}.tags a{margin-right:6px}.torrent_icon_container{float:right}.reveal-explanation{padding:12px;border-left:4px solid #617fb2;background:white}';
  return fixtureHTML(rows,defs).replace('<head>','<head><meta charset="utf-8"><meta name="qa-artifact" content="'+sha+'"><title>Show filtered — visibility regression</title>')
    .replace('<table class="torrent_table">','<section class="fixture-covers">'+cards+'</section><table class="torrent_table">')
    .replace('<h2>Local test page</h2>','<h2>Show filtered — visibility check</h2><p class="reveal-explanation">Two blocked results:one alternate version and one separate result. Show filtered must display both; the two unfiltered versions keep their normal grouping.</p>')
    .replace('</head>','<style>'+css+'.fixture-covers{display:flex;gap:12px;flex-wrap:wrap}.torrent_grid__torrent{width:160px;padding:8px;background:white}.torrent__cover{height:90px;width:160px;position:relative;background-size:cover}'+(url.searchParams.has('strict-theme')?'#content table.torrent_table tr.hidden{display:none!important}':'')+'</style><script>'+setup+'</script><script src="'+(url.searchParams.has('baseline282')?'/reveal-282-baseline.js':url.searchParams.has('baseline')?'/reveal-baseline.js':'/EmporniumCompanion.js')+'"></script></head>');
}
