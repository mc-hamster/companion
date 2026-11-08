// Local experiment only. No production defaults or live-host traffic are changed.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fixtureHTML,rowHTML,overlayHTML} from './helpers.mjs';

const ports=[8770,8771,8772],trials=new Map();
const bundle=await readFile(new URL('../dist/EmporniumCompanion.user.js',import.meta.url),'utf8');
const sha=createHash('sha256').update(bundle).digest('hex');
const fixed=await readFile('/tmp/ep-companion-fixed-2.7.7.js','utf8');
const fixedSha=createHash('sha256').update(fixed).digest('hex');
function instrument(source){
  const replace=(from,to)=>{if(!source.includes(from))throw Error('Benchmark anchor missing: '+from);source=source.replace(from,to);};
  // Values above8 are experimental and exist only in this served copy.
  replace('concurrency: [1, 8]','concurrency: [1, 16]');
  replace('const epApp = createApp(','window.bench.install({MediaPool});\nconst epApp = createApp(');
  replace("GM_registerMenuCommand('Companion settings'","window.bench.attach(epApp);\nGM_registerMenuCommand('Companion settings'");
  return source;
}
const experimental=instrument(fixed),adaptiveBundle=instrument(bundle);
function png(){
  const w=160,h=96,raw=Buffer.alloc((w*3+1)*h);let seed=42;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const at=y*(w*3+1)+1+x*3;raw[at]=25+(seed&63);raw[at+1]=70+((seed>>>8)&63);raw[at+2]=120+((seed>>>16)&63);}
  const crc=b=>{let n=0xffffffff;for(const v of b){n^=v;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;};
  const chunk=(name,data)=>{const type=Buffer.from(name),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);type.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([type,data])),out.length-4);return out;};
  const size=Buffer.alloc(13);size.writeUInt32BE(w);size.writeUInt32BE(h,4);size[8]=8;size[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',size),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const asset=png();
function probe(config){
  const start=performance.now(),stats={rafMs:0,observerMs:0,peakScheduled:0,longTasks:[],readyTimes:[],gaps:[]};let app,finished=false,lastFrame=start;
  const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=fn=>raf(time=>{const begin=performance.now();try{return fn(time);}finally{stats.rafMs+=performance.now()-begin;}});
  const NativeObserver=MutationObserver;window.MutationObserver=class{constructor(fn){return new NativeObserver((...args)=>{const begin=performance.now();try{return fn(...args);}finally{stats.observerMs+=performance.now()-begin;}});}};
  const frame=time=>{if(finished)return;stats.gaps.push(time-lastFrame);lastFrame=time;raf(frame);};raf(frame);
  try{new PerformanceObserver(list=>stats.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true});}catch{}
  document.addEventListener('load',event=>{if(event.target.matches?.('.epc-thumbnail img'))stats.readyTimes.push(performance.now()-start);},true);
  const store=new Map([['ep.mediaRevision',2],['ep.settings',{concurrency:config.slots,maxRetries:0,thumbnailTimeoutMs:6000,timeoutMs:10000,groupVersions:false,recoverImages:false,recoverBackgrounds:false,hoverDelay:0}]]);
  if(config.mode){store.get('ep.settings').maxRetries=2;const key='ep-adaptive-bench:'+config.historyKey;
    if(config.mode==='adaptiveWarm')store.set('ep.hostHistory',JSON.parse(localStorage.getItem(key)||'[]'));
    if(config.mode==='adaptiveCold')localStorage.removeItem(key);
    const set=store.set.bind(store);store.set=(name,value)=>{if(name==='ep.hostHistory')localStorage.setItem(key,JSON.stringify(value));return set(name,value);};
  }
  GM_getValue=(key,fallback)=>store.has(key)?structuredClone(store.get(key)):fallback;GM_setValue=(key,value)=>store.set(key,structuredClone(value));GM_listValues=()=>[...store.keys()];GM_deleteValue=key=>store.delete(key);GM_registerMenuCommand=()=>{};
  GM_addStyle=css=>{const style=document.createElement('style');style.textContent=css;document.head.append(style);};
  window.bench={install({MediaPool}){const load=MediaPool.prototype.load;MediaPool.prototype.load=function(entry){try{return load.call(this,entry);}finally{stats.peakScheduled=Math.max(stats.peakScheduled,this.active);}};},attach(value){app=value;}};
  const check=()=>{
    if(finished)return;
    const records=[...(app?.media.thumbnails.values()||[])],terminal=records.filter(r=>['ready','failed','partial'].includes(r.state));
    if(records.length===50&&terminal.length===50||performance.now()-start>20000){
      // Give final paint/load/long-task deliveries two frames to settle.
      finished=true;raf(()=>raf(async()=>{
        const server=await fetch('/stats?id='+config.id).then(r=>r.json());const sorted=stats.gaps.filter(n=>n>0).sort((a,b)=>a-b);
        app.media.pool.flushHosts?.();
        const result={...config,artifact:config.sha,ready:records.filter(r=>r.state==='ready').length,failed:records.filter(r=>r.state==='failed').length,
          allMs:Math.round(performance.now()-start),first6Ms:Math.round(stats.readyTimes[5]||0),lastImageMs:Math.round(Math.max(0,...stats.readyTimes)),
          callbackMs:+(stats.rafMs+stats.observerMs).toFixed(2),rafMs:+stats.rafMs.toFixed(2),observerMs:+stats.observerMs.toFixed(2),
          longTasks:stats.longTasks.filter(t=>t.start>=start).length,longTaskMs:Math.round(stats.longTasks.filter(t=>t.start>=start).reduce((n,t)=>n+t.ms,0)),
          frameGapP95:+(sorted[Math.floor(sorted.length*.95)]||0).toFixed(1),peakScheduled:stats.peakScheduled,server,
          hosts:[...(app.media.pool.hosts||[])].map(([host,h])=>({host,limit:h.limit,constrained:h.constrained,baseline:Math.round(h.baseline),cooldown:Math.max(0,h.until-Date.now())}))};
        document.getElementById('result').textContent=JSON.stringify(result);parent.postMessage({kind:'trial',result},location.origin);
      }));
    }else setTimeout(check,30);
  };document.addEventListener('DOMContentLoaded',check);
}
function trialHTML(url){
  const slots=Number(url.searchParams.get('slots')),profile=url.searchParams.get('profile'),id=url.searchParams.get('id');
  const mode=url.searchParams.get('mode')||'',isAdaptive=mode.startsWith('adaptive');
  if(![6,8,12,16].includes(slots)||!['single','distributed','slow','limited','mixed'].includes(profile))throw Error('Invalid trial');
  const origin=i=>'http://127.0.0.1:'+(profile==='single'?8770:ports[(i-1)%3]);
  const image=(i,kind)=>origin(i)+'/image/'+id+'/'+profile+'/'+kind+'-'+i+'.png';
  const rows=Array.from({length:50},(_,i)=>rowHTML(i+1,{title:'Neutral image '+(i+1)})).join('');
  const defs=Array.from({length:50},(_,i)=>overlayHTML(i+1,image(i+1,'full'),image(i+1,'small'))).join('');
  return fixtureHTML(rows,defs+'<pre class="epc-root" id="result"></pre>').replace('</head>',
    '<style>body{font:13px system-ui;margin:12px}.username,#search_box,#filter_slidetoggle,.pager_prev,.pager_next{display:none}table{width:100%;border-collapse:collapse}td{padding:8px;border-bottom:1px solid #ddd}td:not(:nth-child(2)){display:none}.torrent_icon_container{float:right}.tags{font-size:11px}</style><script>('+probe.toString()+')('+JSON.stringify({slots,profile,id,mode,historyKey:url.searchParams.get('historyKey'),sha:isAdaptive?sha:fixedSha})+')</script><script src="/'+(isAdaptive?'adaptive':'experiment')+'.js"></script></head>');
}
function dashboard(adaptive=false){
  return '<!doctype html><meta charset="utf-8"><title>Thumbnail concurrency experiment</title><style>body{font:14px system-ui;margin:20px;color:#17213a;background:#eef2f8}button{padding:8px}table{border-collapse:collapse;width:100%;background:white}td,th{padding:9px;text-align:left;border-bottom:1px solid #ccd5e5}iframe{width:100%;height:290px;border:1px solid #ccd5e5;margin-top:14px}pre{white-space:pre-wrap}#state{padding:12px;background:white;margin:12px 0}</style><h1>Thumbnail concurrency experiment</h1><p>Local PNGs only · 50 thumbnails per trial · 3 repetitions · 6/8/12/16 slots · production script unchanged</p><button id="run">Run comparison</button><div id="state">Ready</div><table><thead><tr><th>Profile</th><th>Slots</th><th>Runs</th><th>Last image, median ms</th><th>Callback work, median ms</th><th>Ready</th><th>429s</th><th>Peak host requests</th></tr></thead><tbody id="summary"></tbody></table><iframe id="trial" title="Current thumbnail trial"></iframe><details><summary>Raw measurements</summary><pre id="results">[]</pre></details><script>'+String.raw`
  const comparison=location.pathname==='/adaptive',total=comparison?60:48;
  const results=[],queue=[];let running=false,frame=document.getElementById('trial');
  const median=values=>{const a=values.sort((a,b)=>a-b);return a[Math.floor(a.length/2)];};
  const render=()=>{document.getElementById('results').textContent=JSON.stringify(results);const groups=new Map();for(const r of results){const key=r.profile+':'+(r.mode||r.slots);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}document.getElementById('summary').replaceChildren(...[...groups].map(([key,rows])=>{const tr=document.createElement('tr');for(const value of [rows[0].profile,rows[0].mode||rows[0].slots,rows.length,median(rows.map(r=>r.lastImageMs)),median(rows.map(r=>r.callbackMs)).toFixed(2),rows.map(r=>r.ready+'/50').join(', '),rows.reduce((n,r)=>n+r.server.rejected,0),Math.max(...rows.map(r=>r.server.peakHost))]){const td=document.createElement('td');td.textContent=value;tr.append(td);}return tr;}));};
  const next=()=>{if(!queue.length){running=false;frame.src='about:blank';document.getElementById('state').textContent='Complete: '+results.length+' trials';document.getElementById('state').dataset.complete='true';return;}const job=queue.shift();document.getElementById('state').textContent='Trial '+(results.length+1)+'/'+total+' · '+job.profile+' · '+(job.mode||job.slots+' slots');frame.src='/torrents.php?'+new URLSearchParams(job);};
  addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==frame.contentWindow||e.data.kind!=='trial'||!running)return;results.push(e.data.result);render();setTimeout(next,180);});
  document.getElementById('run').onclick=()=>{if(running)return;running=true;results.length=0;for(let rep=0;rep<3;rep++)for(const profile of(comparison?['single','distributed','slow','limited','mixed']:['single','distributed','slow','limited']))for(const value of(comparison?['fixed6','fixed8','adaptiveCold','adaptiveWarm']:(rep%2?[16,12,8,6]:[6,8,12,16]))){const mode=comparison?value:'',slots=comparison?(value==='fixed6'?6:8):value;queue.push({profile,slots,mode,historyKey:rep+'-'+profile,id:Date.now()+'-'+rep+'-'+profile+'-'+(mode||slots)});}next();};
  if(comparison){document.querySelector('h1').textContent='Adaptive image-host pacing';document.querySelector('h1+p').textContent='60 local trials · fixed6/fixed8 versus automatic cold/learned limits · default retries enabled · five host profiles';}
  `+'</script>';
}
const handler=async(req,res)=>{
  try{const url=new URL(req.url,'http://127.0.0.1:8770');res.setHeader('Cache-Control','no-store');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Timing-Allow-Origin','*');
    if(url.pathname==='/report'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await readFile(new URL('../docs/qa/concurrency-summary-2026-10-23.html',import.meta.url)));return;}
    if(url.pathname==='/adaptive-report'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await readFile(new URL('../docs/qa/adaptive-summary-280.html',import.meta.url)));return;}
    if(url.pathname==='/adaptive-method'){res.setHeader('Content-Type','text/plain; charset=utf-8');res.end(await readFile(new URL('../docs/ADAPTIVE-HOSTS.md',import.meta.url)));return;}
    if(url.pathname==='/adaptive-results.json'){res.setHeader('Content-Type','application/json');res.end(await readFile(new URL('../docs/qa/adaptive-hosts-280.json',import.meta.url)));return;}
    if(url.pathname==='/results.json'){res.setHeader('Content-Type','application/json');res.end(await readFile(new URL('../docs/qa/concurrency-2026-10-23.json',import.meta.url)));return;}
    if(url.pathname==='/method'){res.setHeader('Content-Type','text/plain; charset=utf-8');res.end(await readFile(new URL('../docs/CONCURRENCY-EXPERIMENT.md',import.meta.url)));return;}
    if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(dashboard());return;}
    if(url.pathname==='/adaptive'){res.setHeader('Content-Type','text/html');res.end(dashboard(true));return;}
    if(url.pathname==='/experiment.js'){res.setHeader('Content-Type','text/javascript');res.end(experimental);return;}
    if(url.pathname==='/adaptive.js'){res.setHeader('Content-Type','text/javascript');res.end(adaptiveBundle);return;}
    if(url.pathname==='/torrents.php'){res.setHeader('Content-Type','text/html');res.end(trialHTML(url));return;}
    if(url.pathname==='/stats'){res.setHeader('Content-Type','application/json');const t=trials.get(url.searchParams.get('id'));res.end(JSON.stringify(t?{...t,hosts:Object.fromEntries(t.hosts)}:{}));return;}
    if(url.pathname.startsWith('/image/')){
      const [,,id,profile,name]=url.pathname.split('/');let t=trials.get(id);if(!t){t={requests:0,rejected:0,bytes:0,active:0,peak:0,peakHost:0,hosts:new Map()};trials.set(id,t);}
      const host=req.headers.host;t.requests++;const active=(t.hosts.get(host)||0)+1;t.hosts.set(host,active);t.active++;t.peak=Math.max(t.peak,t.active);t.peakHost=Math.max(t.peakHost,active);
      let released=false;const release=()=>{if(released)return;released=true;t.active--;t.hosts.set(host,t.hosts.get(host)-1);};res.on('close',release);
      if((profile==='limited'||profile==='mixed'&&host.endsWith(':8770'))&&active>2){t.rejected++;res.writeHead(429,{'Retry-After':'1'});res.end('Simulated host limit');release();return;}
      const delay=160+(profile==='slow'?Math.max(0,active-2)*140:0);
      setTimeout(()=>{if(!res.destroyed){res.setHeader('Content-Type','image/png');t.bytes+=asset.length;res.end(asset);}release();},name.startsWith('full')?500:delay);return;
    }res.writeHead(404);res.end();
  }catch(error){res.writeHead(500);res.end(String(error));}
};
for(const port of ports)http.createServer(handler).listen(port,'127.0.0.1',()=>console.log('Local benchmark '+port+' · PNG '+asset.length+' bytes · artifact '+sha.slice(0,12)));
