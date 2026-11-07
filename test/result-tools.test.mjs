import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVersionTitle, positiveTagTerms, matchesTagTerm } from '../src/result-tools.mjs';
import { createApp } from '../src/app.mjs';
import { validateSettings } from '../src/core.mjs';
import { domFixture, fixtureHTML, rowHTML, overlayHTML, memoryStorage, fakeClock, settle } from './helpers.mjs';

test('technical resolution, codec and container differences identify the same release', () => {
  const titles = ['[Studio] Mountain Walk 2026.10.19 [1080p, x265, MP4]',
    '[Studio] Mountain Walk 2026.10.19 (2160p H.264 MKV)',
    '[Studio] Mountain Walk 2026.10.19 1280x720 60fps 5Mbps MP4'];
  const parsed = titles.map(parseVersionTitle);
  assert.equal(new Set(parsed.map(item => item.key)).size, 1);
  assert.match(parsed[0].label, /1080P.*X265.*MP4/);
  assert.match(parsed[2].label, /1280X720.*60FPS.*5MBPS.*MP4/);
  assert.equal(parseVersionTitle('Mountain Walk [720]').key, parseVersionTitle('Mountain Walk 1080p').key);
});

test('dates, word order, parts, studios, cuts, fixes and censoring keep releases separate', () => {
  const names = ['Studio A - Walk Home 2025.01.01', 'Studio A - Walk Home 2025.01.02',
    'Studio A - Home Walk 2025.01.01', 'Studio B - Walk Home 2025.01.01',
    'Studio A - Walk Home 2025.01.01 Part 1', 'Studio A - Walk Home 2025.01.01 Part 2',
    'Studio A - Walk Home 2025.01.01 [Part 720]', 'Studio A - Walk Home 2025.01.01 [Part 1080]',
    'Studio A - Walk Home 2025.01.01 [uncensored]', 'Studio A - Walk Home 2025.01.01 FIXED',
    'Studio A - Walk Home 2025.01.01 BTS'];
  assert.equal(new Set(names.map(name => parseVersionTitle(name + ' [1080p]').key)).size, names.length);
  assert.notEqual(parseVersionTitle('Mountain 4Ktest [720p]').key, parseVersionTitle('Mountain [1080p]').key);
  assert.equal(parseVersionTitle('2026 [1080p]').key, '');
  assert.equal(parseVersionTitle('HD Hands [720p]').title, 'HD Hands');
});

test('positive search highlighting handles boolean groups, negation and wildcards', () => {
  assert.deepEqual(positiveTagTerms('(landscape OR panorama.*) AND NOT (night OR rain) -fog +sun'), ['landscape', 'panorama.*', 'sun']);
  assert.deepEqual(positiveTagTerms('!(night | rain) landscape -fog'), ['landscape']);
  assert.deepEqual(positiveTagTerms('NOT NOT landscape'), ['landscape']);
  assert.deepEqual(positiveTagTerms('not.a.tag or.example'), ['not.a.tag', 'or.example']);
});

test('wildcard search terms match literal tag segments without regular-expression evaluation', () => {
  assert.equal(matchesTagTerm('studio.example', 'studio.*'), true);
  assert.equal(matchesTagTerm('studioxexample', 'studio.example'), false);
  assert.equal(matchesTagTerm('abc', 'ab*bc'), false);
  assert.equal(matchesTagTerm('abbc', 'ab*bc'), true);
  assert.equal(matchesTagTerm('a'.repeat(500) + 'c', '*a'.repeat(250) + 'b'), false);
});

async function setup(rows, initial = {}, url) {
  const f = domFixture(fixtureHTML(rows, [1, 2, 3, 4].map(i => overlayHTML(i, 'https://x.test/' + i + '.jpg')).join('')), url);
  const storage = memoryStorage({ 'ep.settings': { inlineThumbnails: false }, ...initial }), clock = fakeClock();
  const app = createApp(f.win, storage, { Image: clock.env.Image }).start(); await settle();
  return { ...f, app, storage, clock, close() { app.dispose(); f.close(); } };
}

test('group expansion preserves original links, tags, status and row handlers; disabling restores order', async () => {
  const f = await setup(rowHTML(1, { title: 'Mountain Walk [720p]' }) + rowHTML(2, { title: 'Different release' }) +
    rowHTML(3, { title: 'Mountain Walk [1080p]', extra: 'icon_torrent_warned' }));
  try {
    const row = f.doc.querySelector('[data-fixture-id="3"]'), title = row.querySelector('.fixture-title');
    let clicks = 0; title.addEventListener('click', event => { event.preventDefault(); clicks++; });
    const button = f.doc.querySelector('.epc-version-control'); assert.equal(button.textContent, 'Show 2 versions');
    assert.equal(row.classList.contains('epc-version-hidden'), true);
    assert.match(f.doc.querySelector('.epc-result-summary').textContent, /2 shown · 1 grouped/);
    button.click(); assert.equal(row.classList.contains('epc-version-hidden'), false);
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(f.doc.querySelector('[data-fixture-id="1"]').nextElementSibling, row);
    title.click(); assert.equal(clicks, 1); assert.ok(row.querySelector('.icon_torrent_warned'));
    button.click(); f.app.settings.groupVersions = false; f.app.syncGridFilters();
    assert.deepEqual([...f.doc.querySelectorAll('tr.torrent')].map(row => row.dataset.fixtureId), ['1', '2', '3']);
    assert.equal(f.doc.querySelector('.epc-version-control'), null); assert.equal(row.id, '');
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('filtering the representative promotes an eligible version; revealing filters keeps expansion state', async () => {
  const f = await setup(rowHTML(1, { title: 'Mountain Walk [720p]' }) + rowHTML(2, { title: 'Mountain Walk [1080p]' }) +
    rowHTML(3, { title: 'Mountain Walk [2160p]' }));
  try {
    f.doc.querySelector('.epc-version-control').click();
    const first = f.doc.querySelector('[data-fixture-id="1"]'); first.classList.add('hidden'); first.setAttribute('isNSEHidden', '1');
    f.app.syncGridFilters();
    assert.equal(f.doc.querySelector('.epc-version-control').closest('tr').dataset.fixtureId, '2');
    assert.equal(f.doc.querySelector('.epc-version-control').getAttribute('aria-expanded'), 'true');
    f.app.toggleFiltered.click();
    assert.equal(f.doc.querySelector('.epc-version-control').closest('tr').dataset.fixtureId, '2');
    assert.equal(first.classList.contains('epc-version-member'),false,'explicitly revealed result stays outside the group');
    assert.equal(f.doc.querySelectorAll('.epc-version-hidden').length, 0);
    assert.equal(first.getAttribute('isNSEHidden'), '1');
    for (const row of f.doc.querySelectorAll('tr.torrent')) { row.classList.add('hidden'); row.setAttribute('isNSEHidden', '1'); }
    f.app.syncGridFilters();
    assert.equal(f.doc.querySelector('.epc-version-control'),null);
    assert.match(f.app.filterSummary.textContent, /^3 shown · 3 revealed/);
    f.app.toggleFiltered.click();
    for(const row of f.doc.querySelectorAll('tr.torrent')){row.classList.remove('hidden');row.setAttribute('isNSEHidden','0');}
    f.app.syncGridFilters();assert.equal(f.doc.querySelector('.epc-version-control').getAttribute('aria-expanded'),'true');
  } finally { f.close(); }
});

test('new rows join existing groups without stealing focus, and same names in other tables or categories stay separate', async () => {
  const f = await setup(rowHTML(1, { title: 'Mountain Walk [720p]' }) + rowHTML(2, { title: 'Mountain Walk [1080p]' }));
  try {
    const button = f.doc.querySelector('.epc-version-control'); button.click(); button.focus();
    f.doc.querySelector('.torrent_table tbody').insertAdjacentHTML('beforeend', rowHTML(3, { title: 'Mountain Walk [2160p]' }));
    f.doc.querySelector('#content').insertAdjacentHTML('beforeend', '<table><tbody>' + rowHTML(4, { title: 'Mountain Walk [480p]' }) + '</tbody></table>');
    await settle();
    assert.equal(f.doc.activeElement, button); assert.equal(button.textContent, 'Hide 3 versions');
    assert.equal(f.doc.querySelectorAll('.epc-version-control').length, 1);
    assert.equal(f.doc.querySelector('[data-fixture-id="4"]').classList.contains('epc-version-member'), false);
    f.doc.querySelector('[data-fixture-id="3"] [title]').title = 'Pictures / Images'; f.app.syncGridFilters();
    assert.equal(button.textContent, 'Hide 2 versions');
    assert.equal(f.doc.querySelector('[data-fixture-id="3"]').classList.contains('epc-version-member'), false);
  } finally { f.close(); }
});

test('[FLT-08] revealing a filtered version leaves unfiltered versions grouped and preserves their expansion choice',async()=>{
  const f=await setup(rowHTML(1,{title:'Mountain Walk [720p]'})+rowHTML(2,{title:'Mountain Walk [1080p]'})+
    rowHTML(3,{title:'Mountain Walk [2160p]'}));
  try{
    const second=f.doc.querySelector('[data-fixture-id="2"]');second.classList.add('hidden');second.setAttribute('isNSEHidden','1');f.app.syncGridFilters();
    assert.equal(f.doc.querySelector('.epc-version-control').getAttribute('aria-expanded'),'false');
    f.app.toggleFiltered.click();assert.equal(second.classList.contains('epc-version-hidden'),false);
    assert.equal(f.doc.querySelectorAll('.epc-version-hidden').length,1);assert.equal(f.doc.querySelector('.epc-version-control').textContent,'Show 2 versions');
    f.doc.querySelector('.epc-version-control').click();f.app.toggleFiltered.click();
    assert.equal(f.doc.querySelector('.epc-version-control').getAttribute('aria-expanded'),'true');
    assert.equal(second.classList.contains('hidden'),true);assert.equal(second.classList.contains('epc-revealed'),false);
  }finally{f.close();}
});

test('collapsed alternate thumbnails stay unrequested and expand through the existing pool', async () => {
  const f = await setup(rowHTML(1, { title: 'Mountain Walk [720p]' }) + rowHTML(2, { title: 'Mountain Walk [1080p]' }),
    { 'ep.settings': { inlineThumbnails: true } });
  try {
    assert.equal(f.clock.images.length, 1); assert.equal(f.clock.images[0].src, 'https://x.test/1.jpg');
    f.doc.querySelector('.epc-version-control').click();
    assert.equal(f.clock.images.length, 2); assert.equal(f.clock.images[1].src, 'https://x.test/2.jpg');
    f.doc.querySelector('.epc-version-control').click(); f.doc.querySelector('.epc-version-control').click();
    assert.equal(f.clock.images.length, 2, 'expanding again reuses the in-flight image');
  } finally { f.close(); }
});

test('favorites, cautions and search matches coexist without changing filter visibility or original tooltips', async () => {
  const f = await setup(rowHTML(1, { tags: 'favorite caution query.tag excluded' }),
    { 'ep.settings': { inlineThumbnails: false, favoriteTags: 'favorite', cautionTags: 'caution' } },
    'https://www.empornium.sx/torrents.php?taglist=query.*%20-excluded');
  try {
    const [favorite, caution, query, excluded] = f.doc.querySelectorAll('.tags a');
    assert.equal(favorite.dataset.epTagTone, 'favorite'); assert.equal(caution.dataset.epTagTone, 'caution');
    assert.equal(query.classList.contains('epc-tag-match'), true); assert.equal(excluded.classList.contains('epc-tag-match'), false);
    assert.match(favorite.title, /Favorite tag/); assert.match(query.title, /search tag/);
    assert.equal(f.doc.querySelector('.torrent_table tr').classList.contains('hidden'), false);
    favorite.classList.add('nseHiddenTag'); f.app.tags.refresh(); assert.match(favorite.title, /Blocked tag.*Favorite/);
    f.app.settings.favoriteTags = ''; favorite.classList.remove('nseHiddenTag'); f.app.tags.refresh();
    assert.equal(favorite.hasAttribute('title'), false); assert.equal(favorite.hasAttribute('data-ep-tag-tone'), false);
  } finally { f.close(); }
});

test('highlight preferences survive unrelated settings changes, export/restore and preference Undo', async () => {
  const f = await setup(undefined, { 'ep.settings': { favoriteTags: 'sample.tag', cautionTags: 'other', inlineThumbnails: false } });
  try {
    const width = f.app.controls.get('thumbnailSize'); width.value = '80'; f.app.dirty = true; f.app.preferences.flush();
    assert.equal(f.app.settings.favoriteTags, 'sample.tag');
    const backup = f.app.exportData(); f.app.tags.choose('sample.tag', 'caution');
    assert.equal(f.app.settings.favoriteTags, ''); assert.match(f.app.settings.cautionTags, /sample.tag/);
    f.app.importData(JSON.stringify(backup)); assert.equal(f.app.settings.favoriteTags, 'sample.tag');
    f.app.tags.choose('sample.tag', 'caution'); f.app.preferences.undo();
    assert.equal(f.app.settings.favoriteTags, 'sample.tag');
  } finally { f.close(); }
});

test('highlight selection handles storage failure without changing the appearance', async () => {
  const f = await setup();
  try {
    const set = f.storage.set; f.storage.set = (key, value) => { if (key === 'ep.settings') throw new Error('Quota'); return set(key, value); };
    f.app.tags.choose('sample.tag', 'favorite');
    assert.equal(f.app.settings.favoriteTags, ''); assert.equal(f.doc.querySelector('.tags a').hasAttribute('data-ep-tag-tone'), false);
    assert.match(f.app.notice.textContent, /Could not save/);
  } finally { f.close(); }
});

test('highlight settings normalize duplicates and resolve overlapping categories without evaluating tag text', () => {
  const settings = validateSettings({ favoriteTags: ' A.TAG a.tag shared', cautionTags: 'shared caution', groupVersions: false });
  assert.equal(settings.favoriteTags, 'a.tag'); assert.equal(settings.cautionTags, 'shared caution'); assert.equal(settings.groupVersions, false);
});
