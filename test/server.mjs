// Neutral, local-only browser fixture. No external assets or account information.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import {createHash} from 'node:crypto';
import { fixtureHTML, rowHTML, overlayHTML } from './helpers.mjs';
import { escapeHTML } from '../src/core.mjs';
import { performanceHTML, instrumentPerformanceBundle } from './performance-browser.mjs';
import { qaBrowserHTML } from './qa-browser.mjs';
import {collagePageHTML} from './collage-backfill-fixture.mjs';
import { collageBrowserHTML } from './collage-browser.mjs';
import {persistentCacheHTML} from './persistent-cache-browser.mjs';
import {onboardingHTML} from './onboarding-browser.mjs';
import {filterRevealHTML} from './filter-reveal-browser.mjs';
const counts = new Map();
const progressClients = new Set();
const qaProfiles=new Map(),qaRequests=new Map();
try { watch(new URL('../docs/qa-progress.json',import.meta.url),()=>{for(const response of progressClients)response.write('data: changed\n\n');}); } catch {}
const svg = label => '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">' +
  '<defs><linearGradient id="g"><stop stop-color="#16517b"/><stop offset="1" stop-color="#6c4fb0"/></linearGradient></defs>' +
  '<rect width="960" height="540" rx="20" fill="url(#g)"/><circle cx="760" cy="110" r="170" fill="#ffffff" opacity=".1"/>' +
  '<path d="M0 400L240 190L460 370L650 240L960 480V540H0" fill="#b6e0f2" opacity=".4"/>' +
  '<text x="55" y="90" fill="white" font-family="sans-serif" font-size="42">' + label + '</text></svg>';
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8765');
  if(url.pathname==='/cache-priority-bundle.js'){res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-store');const source=await readFile(new URL('../dist/EmporniumCompanion.user.js',import.meta.url),'utf8');res.end(source.replace("GM_registerMenuCommand('Empornium Companion settings'","window.installCachePriority(epApp);\nGM_registerMenuCommand('Empornium Companion settings'"));return;}
  if(url.pathname==='/qa-cache-control'){const profile=url.searchParams.get('profile'),state=qaProfiles.get(profile)||{};state.offlineImages=url.searchParams.get('offline')==='1';qaProfiles.set(profile,state);res.end('Ready');return;}
  if(url.pathname==='/torrents.php'&&url.searchParams.has('persistent-cache')){const artifact=await readFile(new URL('../dist/EmporniumCompanion.user.js',import.meta.url));res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(persistentCacheHTML(url,createHash('sha256').update(artifact).digest('hex')));return;}
  if(url.pathname==='/qa-welcome-narrow'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>360px setup check</title><h1 style="font:16px system-ui">Setup at 360px</h1><iframe title="Narrow getting started" style="width:360px;height:700px;border:1px solid #aaa" src="/torrents.php?welcome=1&amp;qa=welcome290-narrow1"></iframe>');return;}
  if(url.pathname==='/backfill-290-baseline.js'){res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-store');res.end(await readFile(new URL('../dist/EmporniumCompanion-2.9.0.user.js',import.meta.url)));return;}
  if(url.pathname==='/qa-backfill-report'){
    const pages=(qaRequests.get(url.searchParams.get('profile'))||[]).filter(r=>r.type==='page');
    const intervals=pages.slice(1).map((r,i)=>r.at-pages[i].at);
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Backfill request report</title><pre id="report">'+escapeHTML(JSON.stringify({pages,intervals},null,2))+'</pre>');return;
  }
  if(url.pathname==='/torrents.php'&&url.searchParams.has('welcome')){
    const profile=url.searchParams.get('qa')||'welcome',page=Number(url.searchParams.get('page')||1);
    if(url.searchParams.has('native-pager')){
      const list=qaRequests.get(profile)||[],attempt=list.filter(r=>r.page===page&&r.type==='page').length+1;
      const failure=page===4&&(url.searchParams.has('fail403')?403:url.searchParams.has('fail429')?(attempt===1?429:0):attempt<=2?503:0);
      list.push({type:'page',page,attempt,status:failure||200,at:Date.now()});qaRequests.set(profile,list);
      if(failure){res.writeHead(failure,{'Content-Type':'text/plain','Retry-After':url.searchParams.has('fail429')?'12':'1'});res.end('Injected transient page failure');return;}
    }
    const artifact=await readFile(new URL(url.searchParams.has('baseline290')?'../dist/EmporniumCompanion-2.9.0.user.js':'../dist/EmporniumCompanion.user.js',import.meta.url));res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');const html=onboardingHTML(url,createHash('sha256').update(artifact).digest('hex'));const send=()=>{if(!res.destroyed)res.end(html)};if(url.searchParams.has('slow')&&page>1)setTimeout(send,500);else send();return;
  }
  if(url.pathname==='/reveal-282-baseline.js'){res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-store');res.end(await readFile('/tmp/ep-companion-2.8.2-baseline.js'));return;}
  if(url.pathname==='/reveal-baseline.js'){res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-store');res.end(await readFile('/tmp/ep-companion-2.8.1-baseline.js'));return;}
  if(url.pathname==='/torrents.php'&&url.searchParams.has('filter-reveal')){const artifact=await readFile(url.searchParams.has('baseline282')?'/tmp/ep-companion-2.8.2-baseline.js':url.searchParams.has('baseline')?'/tmp/ep-companion-2.8.1-baseline.js':new URL('../dist/EmporniumCompanion.user.js',import.meta.url));res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(filterRevealHTML(url,createHash('sha256').update(artifact).digest('hex')));return;}
  if(url.pathname==='/collage-baseline.js'){res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-store');res.end(await readFile('/tmp/ep-companion-2.7.6-baseline.js'));return;}
  if(url.pathname.startsWith('/collage/')&&url.searchParams.has('collage-backfill')){const page=Number(url.searchParams.get('page')||1),sha=createHash('sha256').update(await readFile(new URL('../dist/EmporniumCompanion.user.js',import.meta.url))).digest('hex');res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(collagePageHTML(url,page===1?[1,2]:page===2?[2,3,4]:[4,5,6],page<3?page+1:null,{bundle:true,sha}));return;}
  if(url.pathname.startsWith('/collage/')){const profile=(url.searchParams.get('qa')||'cover').replace(/[^\w-]/g,'').slice(0,64);res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(collageBrowserHTML(url,profile));return;}
  if (url.pathname === '/qa-progress') { res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await readFile(new URL('qa-dashboard.html',import.meta.url)));return; }
  if (url.pathname === '/qa-resize') { res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Responsive 800-row QA fixture</title><button id="width-narrow" onclick="document.getElementById(\'resize-frame\').style.width=\'360px\'">360px width</button><button id="width-wide" onclick="document.getElementById(\'resize-frame\').style.width=\'560px\'">560px width</button><iframe title="800-row resize fixture" id="resize-frame" style="display:block;width:560px;height:620px;border:1px solid #aaa" src="/torrents.php?cpu-bench=1&rows=800"></iframe>');return; }
  if (url.pathname === '/qa-narrow') { res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>360px QA viewport</title><h1 style="font:18px system-ui">360px browser viewport</h1><iframe title="Narrow acceptance fixture" id="qa-frame" style="width:360px;height:620px;border:1px solid #aaa" src="/torrents.php?qa=acceptance-narrow&narrow=1"></iframe>');return; }
  if (url.pathname === '/qa-progress.json') { res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(await readFile(new URL('../docs/qa-progress.json',import.meta.url)));return; }
  if (url.pathname === '/qa-progress-events') { res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write('retry: 60000\n\ndata: connected\n\n');while(progressClients.size>=2){const oldest=progressClients.values().next().value;progressClients.delete(oldest);oldest.end();}progressClients.add(res);req.on('close',()=>progressClients.delete(res));return; }
  if(url.pathname==='/qa-old-bundle.js'){res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-store');res.end(await readFile('/tmp/ep-companion-2.7.0-baseline.js','utf8'));return;}
  if(url.pathname==='/qa-control') { const profile=url.searchParams.get('profile'),state=qaProfiles.get(profile)||{};if(url.searchParams.get('fault')==='page3')state.failPage3=true;else state.delay=true;qaProfiles.set(profile,state);res.end('Ready');return; }
  if(url.pathname==='/qa-network') { res.setHeader('Content-Type','application/json');res.end(JSON.stringify(qaRequests.get(url.searchParams.get('profile'))||[]));return; }
  if(url.pathname.startsWith('/qa-image/')) {const [, ,profile,name]=url.pathname.split('/');const list=qaRequests.get(profile)||[];list.push({type:'image',path:name});qaRequests.set(profile,list);res.setHeader('Cache-Control','no-store');const attempt=(counts.get(url.pathname)||0)+1;counts.set(url.pathname,attempt);if(qaProfiles.get(profile)?.offlineImages||name.startsWith('broken')||name.startsWith('full-flaky')&&attempt===1){res.writeHead(503);res.end('Injected image failure');return;}const send=()=>{if(!res.destroyed){res.setHeader('Content-Type','image/svg+xml');const asset=svg(name.startsWith('small')?'Small image':'Original image');res.end(name.startsWith('small')?asset.replace('width="960" height="540"','width="160" height="90"'):asset);}};setTimeout(send,url.searchParams.has('delay')?Math.min(8000,Math.max(0,Number(url.searchParams.get('delay'))||0)):name.startsWith('full')?2200:60);return;}
  const cookieProfile=/\bepqa=([\w-]+)/.exec(req.headers.cookie||'')?.[1];
  const qaProfile=url.searchParams.get('qa')||cookieProfile;
  if(url.pathname==='/torrents.php'&&qaProfile&&!['cpu-bench','bench','result-tools','searches','backfill'].some(k=>url.searchParams.has(k))) {
    const profile=qaProfile.replace(/[^\w-]/g,'').slice(0,64)||'default',state=qaProfiles.get(profile)||{},page=Number(url.searchParams.get('page')||1);
    const list=qaRequests.get(profile)||[];list.push({type:'page',page,query:url.search});qaRequests.set(profile,list);res.setHeader('Set-Cookie','epqa='+profile+'; Path=/; SameSite=Lax');res.setHeader('Cache-Control','no-store');
    if(page===3&&state.failPage3){state.failPage3=false;res.writeHead(503);res.end('Injected page failure');return;}
    const artifact=await readFile(url.searchParams.get('qa-version')==='2.7.0'?'/tmp/ep-companion-2.7.0-baseline.js':new URL('../dist/EmporniumCompanion.user.js',import.meta.url));const sha=createHash('sha256').update(artifact).digest('hex');
    const send=()=>{if(!res.destroyed){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(qaBrowserHTML(url,profile).replace('<head>','<head><meta name="qa-artifact" content="'+sha+'">').replace(/src="(\/EmporniumCompanion.js|\/qa-old-bundle.js)"/,'src="$1?build='+sha+'"'));}};
    if(state.delay&&page>1){state.delay=false;setTimeout(send,1800);}else send();return;
  }
  if (url.pathname === '/perf-bundle.js') {
    try {
      const source = url.searchParams.has('control291') ? new URL('../dist/EmporniumCompanion-2.9.1.user.js', import.meta.url) : url.searchParams.has('baseline') ? '/tmp/ep-companion-2.7.0-baseline.js' : new URL('../dist/EmporniumCompanion.user.js', import.meta.url);
      res.setHeader('Content-Type', 'text/javascript'); res.setHeader('Cache-Control', 'no-store');
      res.end(instrumentPerformanceBundle(await readFile(source, 'utf8')));
    } catch { res.writeHead(404); res.end('Save the 2.7.0 baseline in /tmp before comparison.'); }
    return;
  }
  if (url.searchParams.has('cpu-bench')) {
    const count = Math.min(800, Math.max(50, Number(url.searchParams.get('rows')) || 50));
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    let html=performanceHTML(count,url.searchParams.has('baseline'),url.searchParams.has('fixed'));
    if(url.searchParams.has('control291'))html=html.replace('/perf-bundle.js','/perf-bundle.js?control291=1').replace('data-perf-variant="current"','data-perf-variant="2.9.1"');
    const source=url.searchParams.has('control291')?new URL('../dist/EmporniumCompanion-2.9.1.user.js',import.meta.url):new URL('../dist/EmporniumCompanion.user.js',import.meta.url);
    if(!url.searchParams.has('baseline'))html=html.replace('<head>','<head><meta name="qa-artifact" content="'+createHash('sha256').update(await readFile(source)).digest('hex')+'">');
    res.end(html);return;
  }
  if (url.pathname === '/EmporniumCompanion.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.setHeader('Cache-Control','no-store');
    res.end(await readFile(new URL('../dist/EmporniumCompanion.user.js', import.meta.url))); return;
  }
  if (url.pathname.endsWith('.svg') || url.pathname.endsWith('.jpg')) {
    const count = (counts.get(url.pathname) || 0) + 1; counts.set(url.pathname, count);
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname.startsWith('/bench-image-')) {
      const tiny = url.pathname.includes('.th.');
      const id = Number(url.pathname.match(/image-(\d+)/)?.[1]);
      setTimeout(() => {
        if (res.destroyed) return;
        res.setHeader('Content-Type', 'image/svg+xml');
        const asset = svg(tiny ? 'Small thumbnail' : 'Large original');
        res.end(tiny ? asset.replace('width="960" height="540"', 'width="160" height="90"') : asset);
      }, tiny ? 100 : id <= 2 ? 3000 : 1200);
      return;
    }
    if (url.pathname.includes('broken')) { res.writeHead(503); res.end('Simulated unavailable image'); return; }
    if (url.pathname.includes('flaky') && count < 3) { res.writeHead(503); res.end('Simulated temporary failure'); return; }
    const send = () => { if (!res.destroyed) { res.setHeader('Content-Type', 'image/svg+xml'); res.end(svg(url.pathname.includes('flaky') ? 'Recovered image' : 'Local preview')); } };
    if (url.pathname.includes('slow')) setTimeout(send, 2200); else if (url.pathname.includes('stalled')) setTimeout(send, 15000); else send();
    return;
  }
  const origin = 'http://127.0.0.1:8765';
  if (url.searchParams.has('result-tools')) {
    const samples = [
      ['Mountain Walk 2026.10.19 [720p, MP4]', 'landscape panorama'],
      ['Valley Light 2026.09.10 [1080p, x264]', 'landscape handheld'],
      ['Mountain Walk 2026.10.19 [1080p, x265]', 'landscape panorama'],
      ['Valley Light 2026.09.11 [1080p, x264]', 'landscape morning'],
      ['Mountain Walk 2026.10.19 [2160p, AV1]', 'landscape panorama'],
      ['Valley Light 2026.09.10 [2160p, x265]', 'landscape handheld']
    ];
    const rows = samples.map(([title, tags], i) => rowHTML(i + 1, { title, tags })).join('');
    const overlays = samples.map((_, i) => overlayHTML(i + 1, origin + '/bench-image-' + (i + 1) + '.svg', origin + '/bench-image-' + (i + 1) + '.th.svg')).join('');
    let html = fixtureHTML(rows, overlays).replace('<head>', '<head><meta charset="utf-8"><title>Versions and tag highlights — local test</title>')
      .replace('<h2>Local test page</h2>', '<h2>Versions and tag highlights</h2><p class="fixture-intro">Local test data. Alternate formats share a versions button; releases with different dates stay separate.</p>')
      .replace('<tbody>', '<thead><tr><th></th><th>Name</th><th>Files</th><th>Comments</th><th>Added</th><th>Size</th><th>Snatches</th><th>Seeds</th><th>Peers</th><th>Uploader</th></tr></thead><tbody>');
    html = html.replace('</head>', '<style>body{font:14px system-ui;background:#f0f3f8;margin:24px;color:#17213a}a{color:#285de0}.username,#search_box,#filter_slidetoggle,.linkbox,.pager_prev,.pager_next{display:none}.fixture-intro{color:#526079}table{border-collapse:collapse;width:100%;margin:18px 0}td,th{padding:12px 6px;border-bottom:1px solid #d5dce8;text-align:left}th{font-size:11px;color:#58677d}.cats_col{width:24px}.cats_col>div{font-size:10px}.torrent_icon_container{float:right}.tags{font-size:12px;margin-top:8px}.tags a{margin-right:8px}td:nth-child(2){min-width:280px}td:not(:nth-child(2)){font-size:11px}h2{font-size:22px}.epc-version-control{clear:none}body[data-dark]{background:#171e2a;color:#e6edfa}body[data-dark] a{color:#9dd6ff}</style>' +
      '<script>const store=new Map([["ep.settings",{thumbnailSize:64,favoriteTags:"panorama",cautionTags:"handheld"}],["ep.mediaRevision",2]]);' +
      'window.GM_getValue=(key,fallback)=>store.has(key)?store.get(key):fallback;window.GM_setValue=(key,value)=>store.set(key,value);window.GM_listValues=()=>[...store.keys()];window.GM_deleteValue=key=>store.delete(key);window.GM_registerMenuCommand=()=>{};window.GM_addStyle=css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)};' +
      '</script><script src="/EmporniumCompanion.js"></script></head>');
    if (url.searchParams.has('dark')) html = html.replace('<body id="torrents">', '<body id="torrents" data-dark>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(html); return;
  }
  if (url.searchParams.has('searches') || url.searchParams.get('action') === 'advanced' && !url.searchParams.has('backfill')) {
    const saved = [
      { id: 'landscapes', title: 'Landscapes', date: '2026-10-19', fields: [
        { name: 'taglist', type: 'textarea', value: 'landscape', checked: false },
        { name: 'filter_cat[1]', type: 'checkbox', value: '1', checked: true }] },
      { id: 'panoramas', title: 'Panoramas', date: '2026-10-19', fields: [
        { name: 'taglist', type: 'textarea', value: 'wide', checked: false }] },
      { id: 'freeleech', title: 'Freeleech', date: '2026-10-19', fields: [
        { name: 'filter_freeleech', type: 'checkbox', value: '1', checked: true }] }
    ];
    const rows = [1, 2, 3].map(i => rowHTML(i, { title: 'Local result ' + i, tags: 'landscape sample.tag' })).join('');
    const overlays = [1, 2, 3].map(i => overlayHTML(i, origin + '/bench-image-' + i + '.svg',
      origin + '/bench-image-' + i + '.th.svg')).join('');
    const query = [...url.searchParams].filter(([key]) => key !== 'searches').map(([key, value]) => key + '=' + value).join(' · ') || 'All results';
    let html = fixtureHTML(rows, overlays).replace('<head>', '<head><meta charset="utf-8"><title>Saved searches — local test</title>')
      .replace('<h2>Local test page</h2>', '<h2>Saved searches — local browser test</h2><p id="fixture-query">Current results: ' + escapeHTML(query) + '</p>')
      .replace('<div id="search_box">', '<div id="search_box" class="hidden">')
      .replace('<div id="filter_slidetoggle">Search filters</div>', '<button type="button" id="filter_slidetoggle">Search form</button>');
    html = html.replace('</head>', '<style>body{font:14px system-ui;background:#f0f3f8;margin:20px;color:#17213a}a{color:#285de0}.username,.pager_prev,.pager_next{display:none}td{padding:8px;border-bottom:1px solid #d5dce8}td:not(:nth-child(2)){display:none}.torrent_table{width:100%}.torrent_icon_container{float:right}.tags{font-size:12px;margin-top:7px}h2{font-size:20px}#search_box{padding:12px;background:white;border:1px solid #ccd5e5}#search_form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}#search_form label{display:flex;flex-direction:column;gap:4px;font-size:12px}#search_form input,#search_form textarea,#search_form select{font:inherit;padding:5px}#search_form input[type=checkbox]{align-self:start}#fixture-query{overflow-wrap:anywhere}#filter_slidetoggle{margin:8px 0}</style>' +
      '<script>const store=new Map([["ep.settings",{thumbnailSize:64}],["ep.searches",' + JSON.stringify(saved) + '],["ep.searchDrawerOpen",false]]);' +
      'window.GM_getValue=(key,fallback)=>store.has(key)?store.get(key):fallback;window.GM_setValue=(key,value)=>store.set(key,value);window.GM_listValues=()=>[...store.keys()];window.GM_deleteValue=key=>store.delete(key);window.GM_registerMenuCommand=()=>{};window.GM_addStyle=css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)};' +
      'document.addEventListener("DOMContentLoaded",()=>{const form=document.getElementById("search_form"),params=new URLSearchParams(location.search);const names={searchtext:"Keywords",title:"Title",sizeall:"Minimum size",sizerange:"Size range",filelist:"File name",taglist:"Tags",sizetype:"Size unit",order_by:"Order by",order_way:"Order direction","filter_cat[1]":"Category 1","filter_cat[2]":"Category 2",filter_freeleech:"Freeleech only",limit_matches:"Limit matches"};for(const control of Array.from(form.elements)){if(params.has(control.name)){if(control.type==="checkbox")control.checked=true;else control.value=params.get(control.name)}if(!names[control.name])continue;const label=document.createElement("label");label.textContent=names[control.name];control.before(label);label.append(control)}document.getElementById("filter_slidetoggle").onclick=()=>document.getElementById("search_box").classList.toggle("hidden")});' +
      '</script><script src="/EmporniumCompanion.js"></script></head>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(html); return;
  }
  if (url.searchParams.has('backfill')) {
    const page = Number(url.searchParams.get('page') || 1), total = 4;
    let rows = '', overlays = '';
    for (let slot = 1; slot <= 3; slot++) {
      const id = (page - 1) * 2 + slot;
      rows += rowHTML(id, { title: 'Result ' + id, tags: id % 2 ? 'landscape' : 'blocked' })
        .replace('overlib(overlay' + id + ')', 'overlib(overlay' + slot + ')');
      overlays += overlayHTML(slot, origin + '/bench-image-' + id + '.svg',
        origin + '/bench-image-' + id + '.th.svg');
    }
    const href = n => '/torrents.php?backfill=1&page=' + n;
    const pager = Array.from({ length: total }, (_, i) => '<a class="pager_page" href="' + href(i + 1) + '">' + (i + 1) + '</a>').join(' · ') +
      (page < total ? ' · <a class="pager_next" href="' + href(page + 1) + '">Next</a>' : '');
    let html = fixtureHTML(rows, overlays).replace(/<a class="pager_prev"[\s\S]*?<\/a><a class="pager_next"[\s\S]*?<\/a>/, pager)
      .replace('<head>', '<head><meta charset="utf-8"><title>Companion backfill test</title>')
      .replace('<h2>Local test page</h2>', '<h2>Backfill results — local browser test</h2><p>Four pages overlap by one result each. Even-numbered results match the blocked tag rule.</p>');
    if (page === 1) html = html.replace('</head>', '<style>body{font:14px system-ui;background:#f0f3f8;margin:20px;color:#17213a}a{color:#285de0}#search_box,.username,.pager_prev{display:none}td{padding:8px;border-bottom:1px solid #d5dce8}td:not(:nth-child(2)){display:none}.torrent_table{width:100%}.torrent_icon_container{float:right}.tags{font-size:12px;margin-top:7px}.tags a{margin-right:5px}h2{font-size:20px}.pager_page,.pager_next{display:inline-block;padding:5px 8px}</style>' +
      '<script>const store=new Map([["nseTaglist","blocked"],["ep.settings",{thumbnailSize:64}]]);' +
      'window.GM_getValue=(key,fallback)=>store.has(key)?store.get(key):fallback;window.GM_setValue=(key,value)=>store.set(key,value);window.GM_listValues=()=>[...store.keys()];window.GM_deleteValue=key=>store.delete(key);window.GM_registerMenuCommand=()=>{};window.GM_addStyle=css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)};' +
      '</script><script src="/EmporniumCompanion.js"></script></head>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(html); return;
  }
  const benchmark = url.searchParams.has('bench');
  if (benchmark) {
    const baseline = url.searchParams.get('bench') === 'baseline';
    const ahead = url.searchParams.get('bench') === 'ahead', total = ahead ? 50 : 12;
    let rows = '', overlays = '';
    for (let i = 1; i <= total; i++) {
      rows += rowHTML(i, { title: 'Result ' + i, tags: 'example.tag' });
      overlays += overlayHTML(i, origin + '/bench-image-' + i + '.svg?run=' + Date.now(),
        origin + '/bench-image-' + i + '.th.svg?run=' + Date.now());
    }
    const html = fixtureHTML(rows, overlays).replace('<head>', '<head><meta charset="utf-8"><title>Thumbnail policy comparison</title>')
      .replace('</head>', '<style>body{font:14px system-ui;background:#f0f3f8;margin:20px;color:#17213a}a{color:#285de0}#search_box,.tags,.username,.pager_prev,.pager_next{display:none}td{padding:5px;border-bottom:1px solid #d5dce8}td:not(:nth-child(2)){display:none}.torrent_table{width:100%}.torrent_icon_container{float:right}.epc-thumbnail{margin-bottom:0}h2{font-size:20px}#fixture-metrics{display:block;background:white;border:1px solid #c8d3e4;padding:12px;margin:12px 0;font-weight:650}' + (ahead ? '.torrent_table td{height:130px}' : '') + '</style>' +
        '<script>const begin=performance.now(),store=new Map();let ready=0;' +
        'store.set("ep.settings",{thumbnailSize:52,thumbnailMode:"' + (baseline ? 'original' : 'auto') + '",concurrency:' + (baseline ? '2' : '6') + '});store.set("ep.mediaRevision",2);' +
        'window.GM_getValue=(key,fallback)=>store.has(key)?store.get(key):fallback;window.GM_setValue=(key,value)=>store.set(key,value);window.GM_listValues=()=>[...store.keys()];window.GM_deleteValue=key=>store.delete(key);window.GM_registerMenuCommand=()=>{};window.GM_addStyle=css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)};' +
        'document.addEventListener("load",e=>{if(e.target.matches?.(".epc-thumbnail img")){ready++;const out=document.getElementById("fixture-metrics");if(out){out.dataset.ready=ready;out.dataset.elapsed=Math.round(performance.now()-begin);out.dataset.scrollAtLoad=window.scrollY;out.textContent="' + (ahead ? 'Long page' : baseline ? 'Original images / 2 slots' : 'Small images / 6 slots') + ': "+ready+"/' + total + ' ready in "+out.dataset.elapsed+" ms"+' + (ahead ? '(window.scrollY===0?" · before scrolling":" · after scrolling")' : '""') + ';}}},true);' +
        '</script><script src="/EmporniumCompanion.js"></script></head>')
      .replace('<h2>Local test page</h2>', '<h2>' + (ahead ? 'Automatic loading across 50 results' : 'Thumbnail loading comparison') + '</h2><output id="fixture-metrics">Waiting for thumbnails…</output>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(html); return;
  }
  const rows = rowHTML(1, { title: 'A preview that loads normally', tags: 'landscape sample.tag' }) +
    rowHTML(2, { title: 'A slower preview', tags: 'slow sample.tag' }) +
    rowHTML(3, { title: 'Unavailable image — retry controls', tags: 'unavailable sample.tag' });
  const extra = overlayHTML(1, origin + '/normal.svg') + overlayHTML(2, origin + '/slow.svg') + overlayHTML(3, origin + '/broken.svg') +
    '<section class="fixture-images"><h2>Page image recovery</h2><p>The first picture fails twice, then recovers automatically.</p>' +
    '<img id="flaky" src="/flaky-' + Date.now() + '.jpg" alt="Image that recovers">' +
    '<div class="torrent_grid__torrent"><a href="/torrents.php?id=1"><div class="torrent__cover" style="background-image:url(/cover.svg)"></div>Collage cover</a></div>' +
    '<button id="reveal-gallery" type="button">Reveal deferred gallery</button><div id="gallery" class="hidden spoiler"><img data-src="/gallery.svg" alt="Deferred gallery image"></div></section>';
  let html = fixtureHTML(rows, extra).replace('<head>', '<head><meta charset="utf-8"><title>Empornium Companion — local test</title>');
  html = html.replace('</head>', '<style>body{font:14px system-ui;background:#151c28;color:#dce6f8;margin:24px}a{color:#9dd6ff}button,input,select,textarea{font:inherit}#search_form{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;max-width:850px}#search_form input[type=checkbox]{justify-self:start}table{border-collapse:collapse;width:100%;margin:18px 0}td{padding:10px;border-bottom:1px solid #3b475c}.tags{font-size:12px;margin-top:8px}.tags a{margin-right:8px}.cats_col{width:50px}.torrent_icon_container{float:right}.fixture-images{margin-top:36px}.fixture-images>img{width:350px;display:block}.torrent__cover{height:160px;width:280px;background-size:cover;margin-top:24px}.fixture-images button{margin:20px 0}.epc-saved{color:#17212f}h2{font-size:22px}</style>' +
    '<script>const store=new Map();' +
    'store.set("ep.settings",{stallMs:1000,timeoutMs:4000,thumbnailSize:100,hoverDelay:0,diagnostics:true});' +
    'window.GM_getValue=(key,fallback)=>store.has(key)?store.get(key):fallback;' +
    'window.GM_setValue=(key,value)=>store.set(key,value);window.GM_listValues=()=>[...store.keys()];' +
    'window.GM_deleteValue=key=>store.delete(key);window.GM_registerMenuCommand=()=>{};' +
    'window.GM_addStyle=css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)};' +
    '</script><script src="/EmporniumCompanion.js"></script></head>');
  html = html.replace('</body>', '<script>document.getElementById("reveal-gallery").onclick=()=>{const g=document.getElementById("gallery");g.classList.remove("hidden");for(const img of g.querySelectorAll("[data-src]"))img.src=img.dataset.src};</script></body>');
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(html);
});
server.listen(8765, '127.0.0.1', () => console.log('Fixture: http://127.0.0.1:8765/torrents.php'));
