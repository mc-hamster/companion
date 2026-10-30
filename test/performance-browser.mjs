// Local-only browser benchmark. Instrumentation never enters the release bundle.
import { fixtureHTML, rowHTML, overlayHTML } from './helpers.mjs';

const sample = id => rowHTML(id, { title: 'Benchmark Scene ' + Math.floor((id - 1) / 3) + ' [2026.10.19] [' +
  [720, 1080, 2160][(id - 1) % 3] + 'p]', tags: Array.from({ length: 20 }, (_, tag) => 'tag.' + tag).join(' ') });

function probe() {
  const stats = {}, events = [], longTasks = [];
  let app, phase = 'initial';
  const entry = name => stats[phase] ||= {}, add = (name, elapsed) => {
    const table = entry(), value = table[name] ||= { calls: 0, ms: 0, maxMs: 0 };
    value.calls++; value.ms += elapsed; value.maxMs = Math.max(value.maxMs, elapsed);
  };
  const wrap = (type, method) => {
    const original = type.prototype[method]; if (!original) return;
    type.prototype[method] = function (...args) {
      const begin = performance.now();
      try { return original.apply(this, args); } finally { add(type.name + '.' + method, performance.now() - begin); }
    };
  };
  try { new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, ms: e.duration })))).observe({ type: 'longtask', buffered: true }); } catch {}
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const settle = async () => { await frame(); await frame(); await new Promise(resolve => setTimeout(resolve, 50)); };
  const run = async () => {
    const result = document.getElementById('perf-output'), button = document.getElementById('perf-run');
    button.disabled = true; result.textContent = 'Running…';
    while (!app?.filtersReady) await new Promise(resolve => setTimeout(resolve, 20));
    await settle();
    const perform = async (name, work) => {
      phase = name; stats[phase] = {}; const begin = performance.now();
      await work(); await settle();
      events.push({ phase: name, elapsedMs: performance.now() - begin, begin, end: performance.now() });
    };
    await perform('idle', () => new Promise(resolve => setTimeout(resolve, 1000)));
    await perform('image-updates', async () => {
      const image = document.getElementById('perf-native-image');
      for (let i = 0; i < 30; i++) {
        image.src = '/perf-image.svg?frame=' + i; image.style.opacity = i % 2 ? '.99' : '1';
        await frame(); await frame();
      }
    });
    await perform('scroll', async () => {
      for (let i = 0; i < 30; i++) { window.scrollTo(0, i % 2 ? 0 : 1000); await frame(); await frame(); }
    });
    await perform('group-toggle', async () => {
      const toggle = document.querySelector('.epc-version-control');
      for (let i = 0; i < 10; i++) { toggle?.click(); await frame(); await frame(); }
    });
    await perform('tag-change', async () => {
      for (let i = 0; i < 6; i++) { app.tags.choose('tag.0', i % 2 ? 'favorite' : 'caution'); await frame(); await frame(); }
    });
    await perform('append-50', async () => {
      document.querySelector('table.torrent_table tbody').append(document.getElementById('perf-append').content.cloneNode(true));
    });
    await perform('idle-after', () => new Promise(resolve => setTimeout(resolve, 1000)));
    phase = 'finished'; window.scrollTo(0, 0);
    const rounded = Object.fromEntries(Object.entries(stats).map(([key, methods]) => [key,
      Object.fromEntries(Object.entries(methods).map(([name, value]) => [name, { calls: value.calls, ms: Math.round(value.ms * 100) / 100, maxMs: Math.round(value.maxMs * 100) / 100 }]))]));
    const output = { rows: Number(document.body.dataset.perfRows), variant: document.body.dataset.perfVariant,
      userAgent: navigator.userAgent, methods: rounded, phases: events.map(e => ({ phase: e.phase, elapsedMs: Math.round(e.elapsedMs),
        longTasks: longTasks.filter(t => t.start >= e.begin && t.start < e.end).length })) };
    result.textContent = JSON.stringify(output, null, 2); result.dataset.complete = 'true'; button.disabled = false;
  };
  window.epBench = {
    install(types) {
      const NativeObserver = window.MutationObserver;
      window.MutationObserver = class {
        constructor(callback) { return new NativeObserver((...args) => {
          const begin = performance.now(); try { callback(...args); } finally { add('DOM observer callbacks', performance.now() - begin); }
        }); }
      };
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => raf(time => {
        const begin = performance.now(); try { callback(time); } finally { add('Animation frame callbacks', performance.now() - begin); }
      });
      for (const [name, methods] of Object.entries({ CompanionApp: ['syncGridFilters', 'ensureSavedSearchUI', 'updateHealth'],
        VersionGroups: ['refresh'], TagHighlights: ['refresh'], PageMedia: ['scan', 'prepareThumbnails'], PreviewController: ['scan'] })) {
        for (const method of methods) wrap(types[name], method);
      }
    },
    attach(value) { app = value; }
  };
  document.addEventListener('DOMContentLoaded', () => document.getElementById('perf-run').addEventListener('click', run));
}

export function performanceHTML(count, baseline = false, fixed = false) {
  const origin = 'http://127.0.0.1:8765';
  const rows = Array.from({ length: count }, (_, i) => sample(i + 1)).join('');
  const defs = Array.from({ length: count + 50 }, (_, i) => overlayHTML(i + 1, origin + '/perf-image.svg?image=' + i)).join('');
  let html = fixtureHTML(rows, defs).replace('<body id="torrents">', '<body id="torrents" data-perf-rows="' + count + '" data-perf-variant="' + (baseline ? '2.7.0' : 'current') + '">');
  if (fixed) html = html.replace('<tbody>', '<colgroup><col style="width:4%"><col style="width:52%">' + '<col style="width:5.5%">'.repeat(8) + '</colgroup><tbody>')
    .replace('</head>', '<style>.torrent_table{table-layout:fixed;width:100%}.torrent_table td{overflow-wrap:anywhere}</style></head>');
  html = html.replace('</head>', '<meta charset="utf-8"><title>Companion CPU benchmark</title><style>body{font:13px system-ui;margin:16px}.tags a{margin-right:6px}td{padding:6px;border-bottom:1px solid #ccc}.epc-root#perf-dashboard{padding:12px;border:1px solid #777}#perf-output{max-height:280px;overflow:auto}#search_box,.username,.pager_prev,.pager_next{display:none}</style>' +
    '<script>(' + probe.toString() + ')();const store=new Map([["ep.settings",{inlineThumbnails:false,recoverImages:false,recoverBackgrounds:false,favoriteTags:"tag.1",cautionTags:"tag.2"}],["ep.mediaRevision",2]]);' +
    'window.GM_getValue=(k,f)=>store.has(k)?store.get(k):f;window.GM_setValue=(k,v)=>store.set(k,v);window.GM_listValues=()=>[...store.keys()];window.GM_deleteValue=k=>store.delete(k);window.GM_registerMenuCommand=()=>{};window.GM_addStyle=css=>{const s=document.createElement("style");s.textContent=css;document.head.append(s)};</script>' +
    '<script src="/perf-bundle.js' + (baseline ? '?baseline=1' : '') + '"></script></head>');
  html = html.replace('<div id="content">', '<section class="epc-root" id="perf-dashboard"><h1>CPU benchmark: ' + count + ' rows / ' + count * 20 + ' tags</h1><button id="perf-run">Run performance checks</button><pre id="perf-output">Ready</pre></section><div id="content">');
  return html.replace('</body>', '<img id="perf-native-image" src="/perf-image.svg" width="1" height="1" alt=""><template id="perf-append">' + Array.from({ length: 50 }, (_, i) => sample(count + i + 1)).join('') + '</template></body>');
}

export function instrumentPerformanceBundle(bundle) {
  return bundle.replace('const epApp = createApp(', 'window.epBench.install({CompanionApp,VersionGroups,TagHighlights,PageMedia,PreviewController});\nconst epApp = createApp(')
    .replace('GM_registerMenuCommand(\'Empornium Companion settings\'', 'window.epBench.attach(epApp);\nGM_registerMenuCommand(\'Empornium Companion settings\'');
}
