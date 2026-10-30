import { JSDOM, VirtualConsole } from 'jsdom';
import { escapeHTML } from '../src/core.mjs';

export function rowHTML(id = 1, { title = 'Example ' + id, tags = 'sample.tag', uploader = 'ExampleUser', extra = '' } = {}) {
  return '<tr class="torrent rowa" data-fixture-id="' + id + '">' +
    '<td class="cats_col"><div title="Category">CAT</div></td><td>' +
    '<span class="torrent_icon_container"><span class="icon"><a href="/torrents.php?id=' + id + '"><div class="icon_container"><div class="icon_stack"><i class="font_icon torrent_icons ' + extra + '"></i></div></div></a></span></span> ' +
    '<a class="fixture-title" href="/torrents.php?id=' + id + '" onmouseover="return overlib(overlay' + id + ')" onmouseout="return nd()">' + escapeHTML(title) + '</a>' +
    '<div class="tags">' + tags.split(' ').map(t => '<a href="/torrents.php?taglist=' + t + '">' + t + '</a>').join(' ') + '</div></td>' +
    '<td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td class="r00">0</td><td>6</td>' +
    '<td class="user">' + (uploader ? '<a href="/user.php?id=10">' + uploader + '</a>' : '<span class="anon_name">anon</span>') + '</td></tr>';
}
export function overlayHTML(id, url, thumbnail) {
  return '<script>var overlay' + id + ' = ' + JSON.stringify('<img src="' + url + '"' +
    (thumbnail ? ' data-thumbnail="' + thumbnail + '"' : '') + '><p>Sample dimensions and information</p>') + ';</script>';
}
export const searchHTML = '<form id="search_form"><input type="hidden" name="action" value="advanced">' +
  '<input name="searchtext"><input name="title"><input name="sizeall"><input name="sizerange"><input name="filelist">' +
  '<textarea name="taglist"></textarea><select name="sizetype"><option value="mb">MB</option><option value="gb">GB</option></select>' +
  '<select name="order_by"><option value="time">Time</option><option value="size">Size</option></select>' +
  '<select name="order_way"><option value="desc">Descending</option><option value="asc">Ascending</option></select>' +
  '<input type="checkbox" name="filter_cat[1]" value="1"><input type="checkbox" name="filter_cat[2]" value="1">' +
  '<input type="checkbox" name="filter_freeleech" value="1"><input type="checkbox" name="limit_matches" value="1">' +
  '<input type="hidden" name="authkey" value="secret"><button>Search</button></form>';
export function fixtureHTML(rows = rowHTML(1) + rowHTML(2), extra = '') {
  return '<!doctype html><html><head><meta name="ep-companion-fixture" content="local-test-only">' +
    '<style>.hidden,[hidden]{display:none!important}</style></head><body id="torrents">' +
    '<a class="username" href="/user.php?id=10">ExampleUser</a><div id="content"><div class="thin"><h2>Local test page</h2>' +
    '<div id="search_box">' + searchHTML + '</div><div id="filter_slidetoggle">Search filters</div><div class="linkbox"></div>' +
    '<table class="torrent_table"><tbody>' + rows + '</tbody></table>' + extra +
    '<a class="pager_prev" href="/torrents.php?page=1">Previous</a><a class="pager_next" href="/torrents.php?page=3">Next</a>' +
    '</div></div></body></html>';
}
export function memoryStorage(initial = {}) {
  const data = new Map(Object.entries({'ep.onboardingDone':true,...initial}));
  return { data, get: (k, d) => data.has(k) ? data.get(k) : d, set: (k, v) => data.set(k, v),
    list: () => [...data.keys()], delete: k => data.delete(k) };
}
export function fakeClock() {
  let now = 100000, serial = 0;
  const timers = new Map(), images = [];
  class Image {
    naturalWidth = 0; naturalHeight = 0;
    set src(value) { this._src = value; images.push(this); }
    get src() { return this._src; }
    removeAttribute() {}
    succeed(width = 320, height = 200) { this.naturalWidth = width; this.naturalHeight = height; this.onload?.(); }
    fail() { this.onerror?.(); }
  }
  const env = { Image, now: () => now, hidden: () => false,
    setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id) };
  const tick = ms => {
    const end = now + ms;
    for (let guard = 0; guard < 10000; guard++) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
      if (guard === 9999) throw new Error('Runaway fake timers.');
    }
    now = end;
  };
  return { env, images, timers, tick };
}
export function domFixture(html = fixtureHTML(), url = 'https://www.empornium.sx/torrents.php') {
  const errors = [];
  const console = new VirtualConsole(); console.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: console });
  const win = dom.window;
  win.HTMLElement.prototype.getClientRects = function() {
    return this.closest('.hidden:not(.epc-revealed),[hidden],.epc-filter-hidden') ? [] : [this.getBoundingClientRect()];
  };
  win.HTMLElement.prototype.getBoundingClientRect = function() {
    const wide = this.classList.contains('epc-preview') ? 440 : 200;
    const tall = this.classList.contains('epc-preview') ? 550 : 100;
    return { top: 10, left: 10, right: 10 + wide, bottom: 10 + tall, width: wide, height: tall, x: 10, y: 10 };
  };
  win.HTMLElement.prototype.scrollIntoView = function() {};
  win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  win.ResizeObserver = class { observe() {} disconnect() {} };
  win.URL.createObjectURL = () => 'blob:local-fixture'; win.URL.revokeObjectURL = () => {};
  return { dom, win, doc: win.document, errors, close: () => win.close() };
}
export const settle = (ms = 45) => new Promise(resolve => setTimeout(resolve, ms));
export async function until(predicate, message = 'Expected condition', timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (predicate()) return; await settle(10); }
  throw new Error(message + ' did not become true within ' + timeout + ' ms');
}
export async function afterFrames(win, count = 2) {
  for (let frame = 0; frame < count; frame++) await new Promise(resolve => win.requestAnimationFrame(resolve));
}
