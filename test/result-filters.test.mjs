import test from 'node:test';
import assert from 'node:assert/strict';
import { compileConditionalRules } from '../src/conditional-rules.mjs';
import { boot, clickText, field, fixtureHTML, overlayHTML, pane, rowHTML, settle, strictStorage } from './acceptance-helpers.mjs';
import { until } from './helpers.mjs';

const result = (f, id) => f.doc.querySelector('[data-fixture-id="' + id + '"]');
const outsideView = row => row.classList.contains('epc-filter-hidden');

test('conditional expressions support precedence, grouping, literal phrases and line errors', () => {
  const [hide, show] = compileConditionalRules(
    '# Example\nhide: $TA{archive} OR $UP{Studio} AND NOT $TI{special AND rare}\nSHOW: ($TA{archive} OR $TA{sample}) AND $UP{studio}');
  const row = { tags: new Set(['archive']), title: 'special and rare', uploader: 'another' };
  assert.equal(hide.action, 'HIDE');
  assert.equal(hide.test(row), true);
  assert.equal(hide.test({ ...row, tags: new Set(), uploader: 'studio' }), false);
  assert.equal(show.test(row), false);
  assert.equal(show.test({ ...row, uploader: 'studio' }), true);
  assert.throws(() => compileConditionalRules('HIDE: $TA{sample}\nSHOW: ($UP{studio}'), /Line 2.*closing parenthesis/);
  assert.throws(() => compileConditionalRules('HIDE: $TA{sample} $TI{trailer}'), /AND or OR/);
});

test('compiled rules combine with native filters and invalid edits keep the saved rules active', async () => {
  const conditionalRules = [
    'HIDE: $UP{STUDIO} AND NOT $TA{Keep}',
    'SHOW: $TI{Special & Rare}',
    'PASS: $TA{hard}'
  ].join('\n');
  const f = await boot({
    'ep.settings': { conditionalRules, inlineThumbnails: false },
    nseTaglist: 'blocked',
    nseIndividualUploadHidingWhitelist: ['5']
  }, { rows: [
    rowHTML(1, { uploader: 'Studio' }),
    rowHTML(2, { uploader: 'Studio', tags: 'KEEP' }),
    rowHTML(3, { title: 'Special & Rare', tags: 'blocked' }),
    rowHTML(4, { title: 'Special & Rare', tags: 'hard' }),
    rowHTML(5, { tags: 'hard' })
  ].join('') });
  try {
    assert.deepEqual([1, 2, 3, 4, 5].map(id => result(f, id).classList.contains('hidden')), [true, false, false, true, false]);
    pane(f, 'filters');
    const rules = f.doc.querySelector('[data-option-group=conditional-rules]');
    rules.open = true;
    const advanced = rules.querySelector('details'); advanced.open = true;
    const input = advanced.querySelector('textarea');
    input.value = 'HIDE: $TA{broken} AND';
    input.dispatchEvent(new f.win.Event('input', { bubbles: true }));
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.match(f.doc.getElementById('epc-conditional-status').textContent, /Line 1/);
    await field(f, '[data-setting=seenMode]', 'dim');
    assert.equal(f.store.get('ep.settings').seenMode, 'dim');
    assert.equal(f.store.get('ep.settings').conditionalRules, conditionalRules);
    assert.equal(input.value, 'HIDE: $TA{broken} AND');
    assert.equal(result(f, 1).classList.contains('hidden'), true);
    input.value = ''; input.dispatchEvent(new f.win.Event('input', { bubbles: true }));
    clickText(advanced, 'Apply rule text');
    assert.equal(result(f, 1).classList.contains('hidden'), false);
    assert.equal(result(f, 3).classList.contains('hidden'), true, 'native blocked tag remains active');
    assert.equal(result(f, 4).classList.contains('hidden'), false);
    result(f, 2).querySelector('.tags a').dispatchEvent(new f.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    clickText(f.doc.getElementById('nseRCMBox'), 'Hide this tag for Studio');
    assert.equal(f.store.get('ep.settings').conditionalRules, 'HIDE: $TA{KEEP} AND $UP{Studio}');
    assert.equal(result(f, 2).classList.contains('hidden'), true);
    assert.equal(result(f, 1).classList.contains('hidden'), false);
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('the rule form creates, edits, and removes rules with their conditions intact', async () => {
  const f = await boot({}, { rows: rowHTML(1, { tags: 'trailer', uploader: 'Studio' }) +
    rowHTML(2, { uploader: 'Studio' }) + rowHTML(3, { tags: 'trailer', uploader: 'Other' }) });
  try {
    pane(f, 'filters');
    const section = f.doc.querySelector('[data-option-group=conditional-rules]');
    section.open = true;
    clickText(section, 'Add a rule');
    const builder = section.querySelector('.epc-conditional-builder');
    clickText(builder, 'Save rule');
    assert.equal(builder.querySelector('input').getAttribute('aria-invalid'), 'true');
    builder.querySelector('input').value = 'trailer';
    clickText(builder, 'Add condition');
    const second = builder.querySelectorAll('.epc-conditional-row')[1];
    const match = second.querySelector('select');
    match.value = 'UP'; match.dispatchEvent(new f.win.Event('change', { bubbles: true }));
    second.querySelector('input').value = 'Studio';
    f.store.failNext('ep.settings');
    clickText(builder, 'Save rule');
    assert.equal(builder.hidden, false, 'the form retains the draft on storage failure');
    assert.equal(result(f, 1).classList.contains('hidden'), false);
    clickText(builder, 'Save rule');
    assert.equal(builder.hidden, true);
    assert.equal(f.store.get('ep.settings').conditionalRules, 'HIDE: $TA{trailer} AND $UP{Studio}');
    const hidden = () => [1, 2, 3].map(id => result(f, id).classList.contains('hidden'));
    assert.deepEqual(hidden(), [true, false, false]);
    assert.match(section.querySelector('.epc-conditional-list li').textContent, /Hide when tag “trailer” is present and uploader is “Studio”/);
    clickText(section.querySelector('.epc-conditional-list'), 'Edit');
    assert.deepEqual([...builder.querySelectorAll('input')].map(input => input.value), ['trailer', 'Studio']);
    [...builder.querySelectorAll('select')].find(select => select.querySelector('option[value=OR]')).value = 'OR';
    clickText(builder, 'Save rule');
    assert.deepEqual(hidden(), [true, true, true]);
    clickText(section.querySelector('.epc-conditional-list'), 'Remove');
    assert.deepEqual(hidden(), [false, false, false]);
    assert.equal(f.store.get('ep.settings').conditionalRules, '');
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('Freeleech view composes with existing filters in Grid and remembers Bookmarks separately', async () => {
  const rows = rowHTML(1, { extra: 'sitewide_leech' }) + rowHTML(2, { extra: 'unlimited_leech' }) +
    rowHTML(3).replace('class="fixture-title"', 'class="fixture-title" title="A documentary about freeleech"') +
    rowHTML(4, { tags: 'blocked', extra: 'sitewide_leech' });
  const store = strictStorage({ 'ep.settings': { resultsView: 'grid', inlineThumbnails: false }, nseTaglist: 'blocked' });
  let f = await boot({}, { store, rows });
  try {
    const select = await field(f, '[data-setting=freeleechView]', 'sitewide');
    assert.equal(select.closest('label').hidden, false);
    assert.deepEqual([1, 2, 3, 4].map(id => outsideView(result(f, id))), [false, true, true, false]);
    assert.equal(f.win.getComputedStyle(result(f, 2)).display, 'none');
    assert.ok(result(f, 1).querySelector('[data-ep-freeleech=sitewide]'));
    assert.ok(result(f, 2).querySelector('[data-ep-freeleech=unlimited]'));
    assert.equal(result(f, 4).classList.contains('hidden'), true);
    f.doc.querySelector('[data-ep-reveal]').click();
    assert.equal(result(f, 4).classList.contains('hidden'), false);
    assert.equal(outsideView(result(f, 2)), true);
  } finally { f.close(); }
  f = await boot({}, { store, rows, url: 'https://www.empornium.sx/bookmarks.php?type=torrents' });
  try {
    assert.equal(f.doc.querySelector('[data-setting=bookmarkFreeleechView]').value, 'all');
    await field(f, '[data-setting=bookmarkFreeleechView]', 'freeleech');
    assert.deepEqual([1, 2, 3].map(id => outsideView(result(f, id))), [false, false, true]);
    assert.equal(store.get('ep.settings').freeleechView, 'sitewide');
    assert.equal(store.get('ep.settings').bookmarkFreeleechView, 'freeleech');
  } finally { f.close(); }
});

test('detail opens record separate seen entries and Filters can undo seen and existing ignores', async () => {
  const store = strictStorage({
    'ep.settings': { seenMode: 'hide', inlineThumbnails: false },
    nseIndividualUploadHidingBlacklist: ['2']
  });
  const details = await Promise.all([1, 3].map(id => boot({}, { store, rows: '',
    url: 'https://www.empornium.sx/torrents.php?id=' + id, extra: '<ul id="torrent_tags_list"><li><a>sample</a></li></ul>' })));
  try {
    assert.ok(store.get('ep.seen.1'));
    assert.ok(store.get('ep.seen.3'));
  } finally { for (const detail of details) detail.close(); }
  const f = await boot({}, { store, rows: rowHTML(1) + rowHTML(2) + rowHTML(3) + rowHTML(4),
    url: 'http://127.0.0.1:8765/torrents.php' });
  try {
    assert.equal(outsideView(result(f, 1)), true);
    assert.equal(result(f, 2).classList.contains('hidden'), true);
    pane(f, 'filters');
    const history = f.doc.querySelector('[data-option-group=result-history]');
    history.open = true;
    await until(() => history.querySelector('.epc-history-list button'));
    history.querySelector('a[href$="id=1"]').nextElementSibling.click();
    assert.equal(store.get('ep.seen.1'), undefined);
    assert.equal(outsideView(result(f, 1)), false);
    const list = history.querySelector('select:not([data-setting])');
    list.value = 'ignored'; list.dispatchEvent(new f.win.Event('change', { bubbles: true }));
    clickText(history.querySelector('.epc-history-list'), 'Unignore');
    assert.deepEqual(store.get('nseIndividualUploadHidingBlacklist'), []);
    assert.equal(result(f, 2).classList.contains('hidden'), false);
    await field(f, '[data-setting=seenMode]', 'dim');
    assert.equal(outsideView(result(f, 3)), false);
    assert.equal(result(f, 3).classList.contains('epc-seen-dim'), true);
    store.set('ep.seen.4', { title: 'Opened in another tab', time: 1 });
    f.win.dispatchEvent(new f.win.Event('focus'));
    assert.equal(result(f, 4).classList.contains('epc-seen-dim'), true);
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('backfilled rows apply all three filters before warming their thumbnails', async () => {
  const store = strictStorage({
    'ep.settings': { resultsView: 'grid', seenMode: 'hide', freeleechView: 'sitewide', backfillPages: 1,
      conditionalRules: 'HIDE: $TA{skip.this}' },
    'ep.seen.2': { title: 'Seen already', time: 1 }
  });
  const source = id => 'https://hamsterimg.net/images/new-' + id + '.jpg';
  const appended = rowHTML(2, { extra: 'sitewide_leech' }) + rowHTML(3, { extra: 'unlimited_leech' }) +
    rowHTML(4, { extra: 'sitewide_leech', tags: 'skip.this' }) + rowHTML(5, { extra: 'sitewide_leech' });
  const definitions = [2, 3, 4, 5].map(id => overlayHTML(id, source(id))).join('');
  const f = await boot({}, {
    store, rows: rowHTML(1, { extra: 'sitewide_leech' }),
    fetch: async url => ({ ok: true, url, headers: new Map([['content-type', 'text/html']]), text: async () => fixtureHTML(appended, definitions) })
  });
  try {
    clickText(f.doc.querySelector('.epc-toolbar'), 'Load more');
    await until(() => /new-5\.th\.jpg$/.test(result(f, 5)?.querySelector('.epc-thumbnail img')?.src || ''));
    assert.equal(outsideView(result(f, 2)), true);
    assert.equal(outsideView(result(f, 3)), true);
    assert.equal(result(f, 4).classList.contains('hidden'), true);
    for (const id of [2, 3, 4]) assert.equal(result(f, id).querySelector('.epc-thumbnail img').hasAttribute('src'), false);
    assert.match(f.doc.querySelector('.epc-result-summary').textContent, /2 shown.*2 filtered/);
    f.doc.querySelector('[data-ep-reveal]').click();
    await settle();
    assert.equal(outsideView(result(f, 2)), false);
    assert.equal(outsideView(result(f, 3)), true);
    assert.equal(result(f, 4).classList.contains('hidden'), false);
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});
