import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';
import { validateSettings } from '../src/core.mjs';
import { domFixture, fixtureHTML, rowHTML, overlayHTML, memoryStorage, fakeClock, settle, until } from './helpers.mjs';
import { boot, strictStorage, clickText, pane, field } from './acceptance-helpers.mjs';

async function setup(settings = {}, options = {}) {
  const rows = options.rows || rowHTML(1) + rowHTML(2);
  const extra = [1, 2, 3].map(id => overlayHTML(id, 'https://hamsterimg.net/images/grid-' + id + '.jpg', 'https://hamsterimg.net/images/grid-' + id + '.th.jpg')).join('');
  const f = domFixture(fixtureHTML(rows, extra)), clock = fakeClock();
  const storage = memoryStorage({ 'ep.settings': { resultsView: 'grid', ...settings } });
  if (options.hidden) Object.defineProperty(f.doc, 'hidden', { configurable: true, get: options.hidden });
  const app = createApp(f.win, storage, { Image: clock.env.Image, ...options.app }).start();
  await until(() => app.root?.dataset.epReady === 'true');
  return { ...f, app, clock, storage, close() { app.dispose(); f.close(); } };
}
const completedSmall = async f => {
  for (const image of [...f.clock.images]) if (image.src.includes('.th.')) image.succeed(160, 100);
  await settle();
};

test('grid settings validate, retain list by default and use a separate larger card width', () => {
  const defaults = validateSettings();
  assert.equal(defaults.resultsView, 'list'); assert.equal(defaults.gridCardWidth, 320); assert.equal(defaults.gridLargeImages, true);
  const checked = validateSettings({ resultsView: 'invalid', gridCardWidth: 900, gridLargeImages: 'yes', thumbnailSize: 72 });
  assert.equal(checked.resultsView, 'list'); assert.equal(checked.gridCardWidth, 600); assert.equal(checked.thumbnailSize, 72); assert.equal(checked.gridLargeImages, true);
});

test('grid preserves native result identity and controls, labels metadata and reversibly toggles with persistence', async () => {
  const f = await setup({ thumbnailPlacement: 'category', gridLargeImages: false });
  try {
    const table = f.doc.querySelector('table.torrent_table'), row = table.querySelector('tr.torrent'), link = row.querySelector('.fixture-title');
    assert.ok(table.classList.contains('epc-result-grid'));
    assert.equal(table.style.getPropertyValue('--epc-grid-width'), '320px');
    assert.equal(row.cells[5].dataset.epGridLabel, 'Size');
    assert.equal(row.cells[1].dataset.epGridCell, 'title'); assert.ok(row.cells[1].querySelector('.epc-thumbnail'));
    const image = f.app.media.thumbnails.get(row).image;
    f.app.grid.toggle.click(); assert.equal(f.storage.get('ep.settings').resultsView, 'list');
    assert.equal(table.classList.contains('epc-result-grid'), false); assert.equal(row.cells[5].hasAttribute('data-ep-grid-label'), false);
    assert.equal(f.doc.querySelector('.fixture-title'), link); assert.ok(row.cells[0].contains(image));
    f.app.grid.toggle.click(); assert.equal(f.storage.get('ep.settings').resultsView, 'grid');
    assert.equal(f.app.media.thumbnails.get(row).image, image); assert.ok(row.cells[1].contains(image));
  } finally { f.close(); }
});

test('grid completes thumbnails first, upgrades automatically and keeps thumbnail pixels until success', async () => {
  const f = await setup({ thumbnailMode: 'original' });
  try {
    assert.equal(f.clock.images.length, 2); assert.ok(f.clock.images.every(image => image.src.includes('.th.')));
    f.clock.images[0].succeed(160, 90); await settle(); assert.equal(f.clock.images.length, 2);
    f.clock.images[1].succeed(160, 90); await until(() => f.clock.images.length > 2);
    const row = f.doc.querySelector('tr.torrent'), record = f.app.media.thumbnails.get(row);
    assert.equal(record.image.hidden, false); assert.match(record.status.textContent, /Loading larger/);
    f.clock.images[2].succeed(1200, 800);
    assert.equal(record.image.hidden, true); assert.ok(record.gridUpgrade.image.isConnected); assert.equal(record.status.hidden, true);
    const small = record.image;
    f.app.grid.toggle.click(); assert.equal(small.hidden, false); assert.equal(record.gridUpgrade, null);
    assert.equal(f.app.media.pool.activeLanes.large, 0);
  } finally { f.close(); }
});

test('disabled grid upgrades and list mode never automatically request originals', async () => {
  for (const settings of [{ gridLargeImages: false }, { resultsView: 'list' }]) {
    const f = await setup(settings);
    try { await completedSmall(f); assert.equal(f.clock.images.length, 2); }
    finally { f.close(); }
  }
});

test('an original failure preserves the small image and does not retry through redraws', async () => {
  const f = await setup({ maxRetries: 0 });
  try {
    await completedSmall(f); await until(() => f.clock.images.length > 2);
    const record = [...f.app.media.thumbnails.values()][0], original = f.clock.images[2]; original.fail();
    assert.equal(record.image.hidden, false); assert.equal(record.element.dataset.gridImage, 'failed');
    assert.match(record.status.textContent, /showing thumbnail/);
    const count = f.clock.images.length; f.app.syncGridFilters(); await settle(); assert.equal(f.clock.images.length, count);
  } finally { f.close(); }
});

test('grid images load with list thumbnails disabled; changing card width preserves a completed upgrade', async () => {
  const f = await setup({ inlineThumbnails: false });
  try {
    await completedSmall(f); await until(() => f.clock.images.length > 2); f.clock.images[2].succeed(1200, 800);
    const record = [...f.app.media.thumbnails.values()][0], image = record.gridUpgrade.image;
    f.app.controls.get('gridCardWidth').value = 420; f.app.dirty = true; f.app.preferences.flush();
    assert.equal(record.gridUpgrade.image, image); assert.equal(f.doc.querySelector('table.torrent_table').style.getPropertyValue('--epc-grid-width'), '420px');
    f.app.grid.toggle.click(); assert.equal(f.app.media.thumbnails.size, 0);
  } finally { f.close(); }
});

test('grid skips hidden and collapsed versions, upgrades new rows, and waits while the tab is hidden', async () => {
  let hidden = true;
  const f = await setup({}, { hidden: () => hidden, rows: rowHTML(1, { title: 'Mountain Walk [720p]' }) + rowHTML(2, { title: 'Mountain Walk [1080p]' }) });
  try {
    assert.equal(f.clock.images.length, 0); hidden = false; f.doc.dispatchEvent(new f.win.Event('visibilitychange'));
    await until(() => f.clock.images.length === 1); await completedSmall(f); await until(() => f.clock.images.length === 2);
    assert.ok(f.doc.querySelector('[data-fixture-id="2"]').classList.contains('epc-version-hidden'));
    const body = f.doc.querySelector('table.torrent_table>tbody'); body.insertAdjacentHTML('beforeend', rowHTML(3));
    await until(() => !!f.app.media.thumbnails.get(f.doc.querySelector('[data-fixture-id="3"]')));
    const record = f.app.media.thumbnails.get(f.doc.querySelector('[data-fixture-id="3"]'));
    assert.equal(record.row.cells[1].dataset.epGridCell, 'title');
    for (const image of [...f.clock.images]) if (image.src.endsWith('grid-3.th.jpg')) image.succeed(160, 90);
    // Finish another active large image so the next original gets its bounded slot.
    for (const image of [...f.clock.images]) if (image.src.endsWith('grid-1.jpg')) image.succeed(1200, 800);
    await until(() => !!record.gridUpgrade);
    record.row.classList.add('hidden'); record.row.setAttribute('isNSEHidden', '1'); f.app.syncGridFilters(); await settle();
    assert.equal(record.gridUpgrade, null);
    f.app.revealingFiltered = true; f.app.syncGridFilters(); await until(() => !!record.gridUpgrade);
    assert.equal(record.row.classList.contains('epc-revealed'), true);
  } finally { f.close(); }
});

test('setup and Settings share grid preferences, including disabling automatic larger images', async () => {
  const store = strictStorage({ 'ep.onboardingDone': false }), f = await boot({}, { store });
  try {
    const dialog = f.doc.querySelector('.epc-onboarding');
    dialog.querySelector('[name=welcome-backfill][value=off]').checked = true;
    dialog.querySelector('[data-welcome-setting=resultsView]').value = 'grid';
    dialog.querySelector('[data-welcome-setting=gridCardWidth]').value = 420;
    dialog.querySelector('[data-welcome-setting=gridLargeImages]').checked = false;
    clickText(dialog, 'Start browsing'); await settle();
    assert.equal(store.get('ep.settings').resultsView, 'grid'); assert.equal(store.get('ep.settings').gridCardWidth, 420);
    assert.equal(store.get('ep.settings').gridLargeImages, false);
    pane(f, 'settings'); await field(f, '[data-setting=gridLargeImages]', true);
    assert.equal(store.get('ep.settings').gridLargeImages, true);
    clickText(f.doc.querySelector('[data-pane=settings].epc-pane'), 'Getting started');
    const replay = f.doc.querySelector('.epc-onboarding');
    assert.equal(replay.querySelector('[data-welcome-setting=resultsView]').value, 'grid');
    assert.equal(replay.querySelector('[data-welcome-setting=gridCardWidth]').value, '420');
    assert.equal(replay.querySelector('[data-welcome-setting=gridLargeImages]').checked, true);
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('an upgrade finishing in a hidden tab is usable on return without another request', async () => {
  let hidden = false; const f = await setup({}, { hidden: () => hidden });
  try {
    await completedSmall(f); await until(() => f.clock.images.length > 2);
    hidden = true; f.doc.dispatchEvent(new f.win.Event('visibilitychange'));
    const record = [...f.app.media.thumbnails.values()][0]; f.clock.images[2].succeed(1200, 800);
    assert.equal(record.image.hidden, true); const image = record.gridUpgrade.image, count = f.clock.images.length;
    hidden = false; f.doc.dispatchEvent(new f.win.Event('visibilitychange')); await settle();
    assert.equal(record.gridUpgrade.image, image); assert.equal(f.clock.images.length, count);
  } finally { f.close(); }
});

test('compiled grid backfill retains filtering, grouping, reveal and the current layout', async () => {
  const f = await boot({ 'ep.settings': { resultsView: 'grid', gridLargeImages: false, inlineThumbnails: false, backfillPages: 1 }, nseTaglist: 'blocked' }, {
    url: 'https://www.empornium.sx/torrents.php?page=1',
    fetch: async url => ({ ok: true, url, headers: new Map([['content-type', 'text/html']]), text: async () =>
      fixtureHTML(rowHTML(2) + rowHTML(3, { tags: 'blocked' }), overlayHTML(2, 'https://hamsterimg.net/images/new.jpg'))
        .replace(/<a class="pager_prev"[\s\S]*?<\/a><a class="pager_next"[\s\S]*?<\/a>/, '') })
  });
  try {
    clickText(f.doc.querySelector('.epc-toolbar'), 'Backfill results');
    await until(() => !!f.doc.querySelector('[data-fixture-id="3"]'));
    const table = f.doc.querySelector('table.torrent_table'), row = table.querySelector('[data-fixture-id="3"]');
    assert.equal(table.classList.contains('epc-result-grid'), true); assert.equal(row.cells[1].dataset.epGridCell, 'title');
    assert.equal(row.classList.contains('hidden'), true); assert.equal(table.querySelectorAll('tr.torrent').length, 3);
    clickText(f.doc.querySelector('.epc-toolbar'), 'Show filtered'); await settle();
    assert.equal(row.classList.contains('epc-revealed'), true); assert.equal(row.classList.contains('hidden'), false);
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('a failed layout write preserves the current grid and can be retried', async () => {
  const store = strictStorage({ 'ep.settings': { resultsView: 'grid', inlineThumbnails: false, gridLargeImages: false } });
  const f = await boot({}, { store });
  try {
    store.failNext('ep.settings'); const toggle = f.doc.querySelector('[data-ep-grid-toggle]'); toggle.click();
    assert.equal(store.get('ep.settings').resultsView, 'grid'); assert.equal(f.doc.querySelector('table.torrent_table').classList.contains('epc-result-grid'), true);
    assert.equal(toggle.textContent, 'List view');
    toggle.click(); assert.equal(store.get('ep.settings').resultsView, 'list');
    assert.equal(f.doc.querySelector('table.torrent_table').classList.contains('epc-result-grid'), false);
  } finally { f.close(); }
});

test('switching from an unfinished original-mode list cancels the old transfer and starts small first', async () => {
  const f = await setup({ resultsView: 'list', thumbnailMode: 'original', gridLargeImages: false });
  try {
    const previous = [...f.app.media.thumbnails.values()].map(record => record.lastEntry);
    assert.ok(f.clock.images.every(image => !image.src.includes('.th.')));
    f.app.grid.toggle.click(); await settle();
    assert.ok(previous.every(entry => entry.cancelled));
    assert.ok([...f.app.media.thumbnails.values()].every(record => record.lastEntry.actualURL.includes('.th.')));
    await completedSmall(f); assert.equal(f.app.media.pool.activeLanes.large, 0);
  } finally { f.close(); }
});

test('grid size presets save numeric widths and retain a custom width through other edits and restore', async () => {
  const f = await setup({ gridCardWidth: 400, gridLargeImages: false });
  try {
    const select = f.app.controls.get('gridCardWidth'); assert.equal(select.tagName, 'SELECT');
    assert.deepEqual([...select.options].map(option => option.textContent), ['Compact · 240px', 'Balanced · 320px', 'Large · 420px', 'Extra large · 540px', 'Current · 400px']);
    assert.equal(select.value, '400');
    await field(f, '[data-setting=previews]', false); assert.equal(f.storage.get('ep.settings').gridCardWidth, 400);
    await field(f, '[data-setting=gridCardWidth]', 240);
    assert.equal(f.storage.get('ep.settings').gridCardWidth, 240); assert.equal(typeof f.storage.get('ep.settings').gridCardWidth, 'number');
    assert.equal(f.doc.querySelector('table.torrent_table').style.getPropertyValue('--epc-grid-width'), '240px');
    f.app.importData(JSON.stringify({ ...f.app.exportData(), settings: { ...f.app.settings, gridCardWidth: 488 } }), false);
    assert.equal(select.value, '488'); assert.equal(select.selectedOptions[0].textContent, 'Current · 488px');
    await field(f, '[data-setting=previews]', true); assert.equal(f.storage.get('ep.settings').gridCardWidth, 488);
  } finally { f.close(); }
});

test('layout and card size survive navigation, a new storage session and switching back to list', async () => {
  let store = strictStorage({ 'ep.settings': { inlineThumbnails: false, gridLargeImages: false } });
  let f = await boot({}, { store, url: 'https://www.empornium.sx/torrents.php?searchtext=first&page=1' });
  try {
    clickText(f.doc.querySelector('.epc-toolbar'), 'Grid view'); await field(f, '[data-setting=gridCardWidth]', 540);
  } finally { f.close(); }
  // New document, different search/page, same durable manager data.
  f = await boot({}, { store, url: 'https://www.empornium.sx/torrents.php?searchtext=second&page=2' });
  try {
    assert.equal(f.doc.querySelector('[data-ep-grid-toggle]').textContent, 'List view');
    assert.equal(f.doc.querySelector('table.torrent_table').classList.contains('epc-result-grid'), true);
    assert.equal(f.doc.querySelector('[data-setting=gridCardWidth]').value, '540');
  } finally { f.close(); }
  // Fresh manager/storage object and window, as after restarting the browser.
  store = strictStorage(Object.fromEntries(Object.entries(store.snapshot()).map(([key, value]) => [key, JSON.parse(value)])));
  f = await boot({}, { store, url: 'https://www.empornium.sx/torrents.php?searchtext=third' });
  try {
    assert.equal(f.doc.querySelector('table.torrent_table').classList.contains('epc-result-grid'), true);
    assert.equal(f.doc.querySelector('[data-setting=gridCardWidth]').value, '540');
    clickText(f.doc.querySelector('.epc-toolbar'), 'List view');
  } finally { f.close(); }
  f = await boot({}, { store });
  try {
    assert.equal(f.doc.querySelector('[data-ep-grid-toggle]').textContent, 'Grid view');
    assert.equal(f.doc.querySelector('table.torrent_table').classList.contains('epc-result-grid'), false);
    assert.equal(f.doc.querySelector('[data-setting=gridCardWidth]').value, '540');
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});
