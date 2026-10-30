import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, validateSettings, safeImageURL, canonicalImageURL, retryURL, legacyOriginal,
  thumbnailCandidates, parseOverlayDefinitions, imageState, RetryBudget, MediaPool } from '../src/core.mjs';
import { fakeClock } from './helpers.mjs';

test('URL gate rejects downloads, credentials and non-images', () => {
  for (const value of ['magnet:?xt=abc', '/torrents.php?action=download&id=4', '/a.torrent',
    'https://user:secret@example.test/a.jpg', '/x.jpg?passkey=secret', 'javascript:alert(1)']) {
    assert.equal(safeImageURL(value, 'https://www.empornium.sx'), null);
  }
  assert.equal(safeImageURL('/x.jpg?a=1&amp;b=2', 'https://www.empornium.sx'), 'https://www.empornium.sx/x.jpg?a=1&b=2');
});
test('legacy fallback is restricted and preserves existing queries', () => {
  assert.equal(legacyOriginal('https://fapping.empornium.sx/images/resize/350/date/a.jpg?token=abc'), 'https://fapping.empornium.sx/images/date/a.jpg?token=abc');
  assert.equal(legacyOriginal('https://unrelated.test/images/resize/350/a.jpg'), null);
  const url = 'https://images.test/a.jpg?signature=abc&size=2';
  assert.equal(canonicalImageURL(retryURL(url, '1&2')), url);
});
test('overlay parser treats scripts and HTML as data', () => {
  const payload = '<img src="https://images.test/a.gif"><p>Info &amp; more</p><script>bad()</script>';
  const result = parseOverlayDefinitions('var overlay7 = ' + JSON.stringify(payload) + '; globalThis.bad = true;', 'https://www.empornium.sx');
  assert.equal(result.length, 1); assert.equal(result[0].src, 'https://images.test/a.gif');
  assert.equal(result[0].summary, 'Info & more');
  assert.equal(parseOverlayDefinitions('var overlay8 = evil();', 'https://www.empornium.sx').length, 0);
});
test('thumbnail modes prefer supplied variants and limit guessed variants', () => {
  const url = 'https://hamsterimg.net/images/a.jpg';
  assert.deepEqual(thumbnailCandidates(url, 'small'), ['https://hamsterimg.net/images/a.th.jpg', url]);
  assert.deepEqual(thumbnailCandidates(url), ['https://hamsterimg.net/images/a.th.jpg', url]);
  assert.deepEqual(thumbnailCandidates(url, 'original'), [url]);
});
test('settings clamp values and distinguish hidden/unrequested/streaming images', () => {
  const s = validateSettings({ concurrency: 90, maxRetries: -8, timeoutMs: 3000, stallMs: 8000 });
  assert.equal(s.concurrency, 8); assert.equal(s.maxRetries, 0); assert.equal(s.timeoutMs, 9000);
  assert.equal(imageState({ deferred: true }), 'deferred');
  assert.equal(imageState({ hasSource: true, width: 100, complete: false }), 'streaming');
  assert.equal(imageState({ hasSource: true, width: 0, complete: true }), 'failed');
});
test('manual retry cooldown and automatic URL budget survive repeat hovers', () => {
  let now = 0; const b = new RetryBudget(() => now, 1);
  assert.equal(b.consume('https://x.test/a.jpg'), true); assert.equal(b.consume('https://x.test/a.jpg'), true);
  assert.equal(b.consume('https://x.test/a.jpg?_ep_retry=1'), false);
  assert.equal(b.manual('https://x.test/a.jpg'), false);
  now = 30001; assert.equal(b.manual('https://x.test/a.jpg'), true);
  assert.equal(b.manual('https://x.test/a.jpg'), false);
});
test('pool deduplicates requests and honors preview priority when a slot opens', () => {
  const c = fakeClock(), p = new MediaPool(c.env, { ...DEFAULTS, concurrency: 1 });
  const a = p.request('https://x.test/a.jpg');
  assert.equal(p.request(a.url, { priority: 100 }), a);
  const b = p.request('https://x.test/b.jpg', { priority: 2 });
  const d = p.request('https://x.test/d.jpg', { priority: 100 });
  assert.equal(c.images.length, 1); c.images[0].succeed();
  assert.equal(c.images[1].src, d.url); c.images[1].succeed();
  assert.equal(c.images[2].src, b.url); p.dispose(); assert.equal(c.timers.size, 0);
});
test('never-answering image stalls then retries with bounded attempts', () => {
  const c = fakeClock(), p = new MediaPool(c.env, { ...DEFAULTS, maxRetries: 1, stallMs: 1000, timeoutMs: 3000 });
  const entry = p.request('https://x.test/stuck.jpg', { priority: 100 });
  c.tick(1000); assert.equal(entry.status, 'stalled');
  c.tick(2700); assert.equal(entry.attempts, 2); assert.match(entry.actualURL, /_ep_retry=/);
  c.tick(3000); assert.equal(entry.status, 'failed');
  for (let i = 0; i < 10; i++) p.request(entry.url, { priority: 100 });
  assert.equal(c.images.length, 2); p.dispose();
});
test('legacy resize error moves to original and displays first frame before completion', () => {
  const c = fakeClock(), p = new MediaPool(c.env);
  const entry = p.request('https://fapping.empornium.sx/images/resize/350/a.gif');
  c.images[0].fail(); c.tick(700);
  assert.equal(c.images[1].src, 'https://fapping.empornium.sx/images/a.gif');
  c.images[1].naturalWidth = 640; c.images[1].naturalHeight = 480; c.tick(160);
  assert.equal(entry.status, 'streaming');
  c.tick(DEFAULTS.timeoutMs); assert.equal(entry.status, 'partial'); assert.equal(p.active, 0);
  c.images[1].succeed(); assert.equal(entry.status, 'ready'); p.dispose();
});
test('explicit retry keeps subscribers and cross-tier reuse avoids a duplicate transfer', () => {
  const c = fakeClock(), p = new MediaPool(c.env);
  const a = p.request('https://x.test/a.jpg'); let updates = 0;
  const unsubscribe = p.subscribe(a, () => updates++);
  c.images[0].succeed();
  assert.equal(p.request(a.url, { tier: 'original' }), a);
  const next = p.request(a.url, { force: true }); c.images[1].succeed();
  assert.notEqual(a, next); assert.ok(updates >= 4); unsubscribe(); assert.equal(next.listeners.size, 0); p.dispose();
});
test('circuit breaker resumes deferred jobs without requiring another hover', () => {
  const c = fakeClock(), p = new MediaPool(c.env, { ...DEFAULTS, concurrency: 1, maxRetries: 0 });
  for (let i = 0; i < 7; i++) p.request('https://x.test/' + i + '.jpg');
  for (let i = 0; i < 6; i++) { c.images[i].fail(); if (i < 5) c.tick(1001); }
  assert.equal(c.images.length, 6); c.tick(15001);
  assert.equal(c.images.length, 7); p.dispose();
});
test('decoded cache evicts idle entries and releases timers', () => {
  const c = fakeClock(), p = new MediaPool(c.env, { ...DEFAULTS, cacheEntries: 2 });
  for (let i = 0; i < 5; i++) { p.request('https://x.test/' + i + '.jpg'); c.images.at(-1).succeed(); }
  assert.ok(p.entries.size <= 2); assert.equal(c.timers.size, 0); p.dispose();
});
test('two slow originals cannot block independently paced small thumbnails or consume their slots', () => {
  const c = fakeClock(), p = new MediaPool(c.env);
  p.request('https://x.test/slow-a.gif', { lane: 'large', priority: 100 });
  p.request('https://x.test/slow-b.gif', { lane: 'large', priority: 100 });
  for (let i = 0; i < 10; i++) p.request('https://x.test/' + i + '.th.jpg', { lane: 'thumbnail', smallFirst: true });
  assert.equal(c.images.length, 4); assert.equal(p.active, 4);
  for (let i=2;i<c.images.length;i++) c.images[i].succeed();
  assert.equal(c.images.length, 12); assert.ok(p.active <= 4);
  assert.equal(c.images[0].naturalWidth, 0); p.dispose();
});
test('a failed small candidate falls back after brief host cooldown in the large-image lane', () => {
  const c = fakeClock(), p = new MediaPool(c.env);
  const url = 'https://hamsterimg.net/images/a.jpg';
  const entry = p.request(url, { candidates: thumbnailCandidates(url), smallFirst: true, lane: 'thumbnail' });
  assert.equal(p.transferLane(entry), 'thumbnail'); c.images[0].fail(); c.tick(251);
  assert.equal(c.images[1].src, url); assert.equal(p.transferLane(entry), 'large'); p.dispose();
});
test('visible demand overtakes preloads and disconnected rows are not requested', () => {
  const c = fakeClock(), p = new MediaPool(c.env, { ...DEFAULTS, concurrency: 1 });
  p.request('https://x.test/first.jpg');
  let visible = false, connected = true;
  p.request('https://x.test/a.jpg', { priorityFor: () => visible ? 80 : 20 });
  p.request('https://x.test/b.jpg', { priority: 40 });
  p.request('https://x.test/removed.jpg', { priority: 100, eligible: () => connected });
  connected = false; visible = true;
  c.images[0].succeed(); assert.equal(c.images[1].src, 'https://x.test/a.jpg');
  c.images[1].succeed(); assert.equal(c.images[2].src, 'https://x.test/b.jpg');
  c.images[2].succeed(); assert.equal(c.images.length, 3); p.dispose();
});
test('direct inline image target is not transferred twice or erased by cache eviction', () => {
  const c = fakeClock(), p = new MediaPool(c.env, { ...DEFAULTS, cacheEntries: 0 });
  let assignments = 0, erased = false;
  const target = { naturalWidth: 0, naturalHeight: 0, set src(value) { assignments++; this.url = value; },
    removeAttribute() { erased = true; } };
  p.request('https://x.test/a.th.jpg', { target });
  target.naturalWidth = 100; target.naturalHeight = 80; target.onload();
  assert.equal(assignments, 1); assert.equal(erased, false); assert.equal(p.entries.size, 0); p.dispose();
});
test('a hover has a reserved slot even while body recovery occupies both large-image slots', () => {
  const c = fakeClock(), p = new MediaPool(c.env);
  p.request('https://x.test/body-a.jpg', { lane: 'large', priority: 80 });
  p.request('https://x.test/body-b.jpg', { lane: 'large', priority: 80 });
  const preview = p.request('https://x.test/hover.jpg', { lane: 'large', priority: 100 });
  assert.equal(preview.status, 'loading'); assert.equal(c.images.length, 3); p.dispose();
});
test('abandoned previews free their slot without spending the failure retry budget', () => {
  const c = fakeClock(), p = new MediaPool(c.env);
  for (let i = 0; i < 8; i++) {
    const entry = p.request('https://x.test/hover.jpg', { lane: 'large', priority: 100 });
    const unsubscribe = p.subscribe(entry, () => {});
    unsubscribe(); assert.equal(p.active, 0);
  }
  assert.equal(p.budget.get('https://x.test/hover.jpg').attempts, 0);
  const entry = p.request('https://x.test/hover.jpg', { lane: 'large', priority: 100 });
  assert.equal(entry.status, 'loading'); p.dispose();
});
test('automatic rescue allows one fresh attempt and cannot loop after another failure', () => {
  const c = fakeClock(), p = new MediaPool(c.env, { ...DEFAULTS, maxRetries: 0 });
  const url = 'https://x.test/a.jpg';
  p.request(url); c.images[0].fail();
  p.request(url, { force: true, rescue: true, singleAttempt: true }); c.tick(251); c.images[1].fail();
  for (let i = 0; i < 5; i++) p.request(url, { force: true, rescue: true, singleAttempt: true });
  assert.equal(c.images.length, 2); assert.equal(p.budget.get(url).attempts, 1);
  const other = 'https://x.test/other.jpg';
  p.request(other, { lane: 'large', priority: 100 }); c.tick(251); c.images[2].fail();
  const rescue = p.request(other, { lane: 'large', priority: 100, force: true, rescue: true, singleAttempt: true });
  c.tick(1001);
  const unsubscribe = p.subscribe(rescue, () => {}); unsubscribe();
  assert.equal(p.budget.get(other).attempts, 1);
  p.request(other); assert.equal(c.images.length, 4);
  p.dispose();
});

test('[HOV-02] repeated successful reloads after cache eviction do not exhaust the failure budget', () => {
  const c=fakeClock(),p=new MediaPool(c.env,{...DEFAULTS,cacheEntries:1});
  const url='https://x.test/revisited.jpg';
  for(let cycle=0;cycle<6;cycle++) {
    const entry=p.request(url,{priority:100,lane:'large'});
    assert.equal(entry.status,'loading','successful revisit '+cycle+' starts normally');
    c.images.at(-1).succeed();assert.equal(entry.status,'ready');
    c.tick(1);
    p.request('https://x.test/displace-'+cycle+'.jpg');c.images.at(-1).succeed();p.trim();
    assert.equal(p.entries.has(url+'|normal'),false);
  }
  // A genuinely failing source still has its original bounded retry policy.
  const bad=p.request('https://x.test/unavailable.jpg',{priority:100});
  for(let i=0;i<3;i++){c.images.at(-1).fail();c.tick(4000);}
  assert.equal(bad.status,'failed');assert.equal(bad.attempts,3);p.dispose();
});

test('[IMG-01] a supplied small image hands off to a large fallback with the full image deadline', () => {
  const c=fakeClock(),p=new MediaPool(c.env,{...DEFAULTS,stallMs:1000});
  const url='https://x.test/original.svg',small='https://x.test/supplied-small.svg';
  const entry=p.request(url,{candidates:[small,url],smallCandidates:[small],smallFirst:true,lane:'thumbnail',timeoutMs:1500,fullTimeoutMs:4000});
  assert.equal(p.transferLane(entry),'thumbnail','explicit small variants need no filename convention');
  c.images[0].fail();c.tick(0);assert.equal(p.transferLane(entry),'large');
  c.tick(2200);assert.notEqual(entry.status,'retrying','original must not inherit the short deadline');
  assert.equal(c.images.length,2,'no premature third transfer');c.images[1].succeed();
  assert.equal(entry.status,'ready');p.dispose();
});
