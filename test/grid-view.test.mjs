import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createApp } from '../src/app.mjs';
import { validateSettings } from '../src/core.mjs';
import { PersistentImageCache } from '../src/image-cache.mjs';
import { domFixture, fixtureHTML, rowHTML, overlayHTML, memoryStorage, fakeClock, settle, until } from './helpers.mjs';
import { boot, strictStorage, clickText, pane, field } from './acceptance-helpers.mjs';

async function setup(settings = {}, options = {}) {
  const ids = Array.from({ length: options.count || 3 }, (_, i) => i + 1);
  const rows = options.rows || (options.count ? ids : [1, 2]).map(id => rowHTML(id)).join('');
  const extra = options.definitions || ids.map(id => overlayHTML(id, 'https://hamsterimg.net/images/grid-' + id + '.jpg', 'https://hamsterimg.net/images/grid-' + id + '.th.jpg')).join('');
  const f = domFixture(fixtureHTML(rows, extra)), clock = fakeClock();
  if (options.positions) {
    const rect = f.win.HTMLElement.prototype.getBoundingClientRect;
    f.win.HTMLElement.prototype.getBoundingClientRect = function () {
      const original = rect.call(this), row = this.closest('tr[data-fixture-id]');
      if (!row) return original;
      const top = options.positions[Number(row.dataset.fixtureId) - 1] - f.win.scrollY;
      return { ...original, top, bottom: top + original.height };
    };
  }
  const storage = memoryStorage({ 'ep.settings': { resultsView: 'grid', ...settings } });
  if (options.hidden) Object.defineProperty(f.doc, 'hidden', { configurable: true, get: options.hidden });
  if (options.motion) {
    const motion = new f.win.EventTarget();
    Object.defineProperty(motion, 'matches', { get: options.motion });
    f.win.matchMedia = () => motion;
  }
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
  assert.equal(defaults.gridShowTags, false);
  assert.equal(defaults.gridSpacing, 'standard'); assert.equal(defaults.gridAutoplayGifs, false);
  assert.equal(defaults.resultsView, 'list'); assert.equal(defaults.gridCardWidth, 320); assert.equal(defaults.gridShowDetails, false);
  const checked = validateSettings({ resultsView: 'invalid', gridCardWidth: 900, gridLargeImages: true, thumbnailSize: 72 });
  assert.equal(checked.resultsView, 'list'); assert.equal(checked.gridCardWidth, 600); assert.equal(checked.thumbnailSize, 72);
  assert.equal(Object.hasOwn(checked, 'gridLargeImages'), false);
});

test('Grid warms off-screen covers, plays only visible cards, and follows reduced motion', async () => {
  let reduced = false, hidden = false;
  const originals = [1, 2].map(id => 'https://hamsterimg.net/images/cover-' + id + '.GIF?v=1');
  const definitions = originals.map((url, index) => overlayHTML(index + 1, url, url.replace('.GIF', '.th.jpg'))).join('');
  const f = await setup({ maxRetries: 0 }, { definitions, positions: [10, 1500], motion: () => reduced, hidden: () => hidden });
  const playback = row => f.doc.querySelector('[data-fixture-id="' + row + '"] .epc-grid-gif-playback');
  const scrollTo = top => {
    Object.defineProperty(f.win, 'scrollY', { value: top, configurable: true });
    f.win.dispatchEvent(new f.win.Event('scroll'));
  };
  try {
    await completedSmall(f);
    assert.ok(f.clock.images.every(image => image.src.includes('.th.jpg')));
    await field(f, '[data-setting=gridAutoplayGifs]', true);
    await until(() => originals.every(url => f.clock.images.some(image => image.src === url)));
    assert.equal(f.app.media.loadCounts().animation.pending, 2);
    scrollTo(1450);
    await until(() => f.app.media.viewportTop === 1450);
    f.clock.images.find(image => image.src === originals[0]).succeed();
    assert.equal(playback(1), null);
    assert.equal(f.app.media.pool.readyImages.get(originals[0]).listeners.size, 0);
    f.clock.images.find(image => image.src === originals[1]).succeed();
    assert.equal(playback(2)?.src, originals[1]);
    assert.equal(f.app.media.loadCounts().animation.ready, 2);
    scrollTo(0);
    await until(() => !!playback(1) && !playback(2));
    assert.equal(playback(1).src, originals[0]);
    assert.equal(f.clock.images.filter(image => originals.includes(image.src)).length, 2);
    reduced = true;
    f.app.media.reducedMotion.dispatchEvent(new f.win.Event('change'));
    assert.equal(playback(1), null);
    reduced = false;
    f.app.media.reducedMotion.dispatchEvent(new f.win.Event('change'));
    assert.equal(playback(1)?.src, originals[0]);

    hidden = true; f.doc.dispatchEvent(new f.win.Event('visibilitychange'));
    await until(() => !playback(1));
    hidden = false; f.doc.dispatchEvent(new f.win.Event('visibilitychange'));
    await until(() => !!playback(1));
    await field(f, '[data-setting=gridAutoplayGifs]', false);
    assert.equal(playback(1), null);
  } finally { f.close(); }
});

test('List autoplay enables inline covers independently from Grid playback', async () => {
  const originals = ['https://hamsterimg.net/images/list-visible.gif', 'https://hamsterimg.net/images/list-offscreen.gif'];
  const definitions = originals.map((url, index) => overlayHTML(index + 1, url, url.replace('.gif', '.th.jpg'))).join('');
  const f = await setup({ resultsView: 'list', inlineThumbnails: false }, { definitions, positions: [10, 1500] });
  const playback = () => f.doc.querySelector('.epc-grid-gif-playback');
  try {
    assert.equal(f.app.media.thumbnails.size, 0);
    await field(f, '[data-setting=listAutoplayGifs]', true);
    await until(() => originals.every(url => f.clock.images.some(image => image.src === url)));
    for (const image of f.clock.images.filter(image => originals.includes(image.src))) image.succeed();
    assert.equal(f.app.media.thumbnails.size, 2);
    assert.equal(playback()?.src, originals[0]);
    assert.equal(f.app.media.loadCounts().animation.ready, 2);
    assert.equal(f.doc.querySelectorAll('.epc-grid-gif-playback').length, 1);
    f.app.grid.layoutButtons.get('grid').click();
    await until(() => !playback());
    assert.equal(f.app.settings.gridAutoplayGifs, false);
    f.app.grid.layoutButtons.get('list').click();
    await until(() => playback()?.src === originals[0]);
    assert.equal(f.clock.images.filter(image => originals.includes(image.src)).length, 2);
    await field(f, '[data-setting=listAutoplayGifs]', false);
    assert.equal(f.app.media.thumbnails.size, 0);
  } finally { f.close(); }
});

test('reduced motion disables both autoplay choices in Settings and Getting started without clearing them', async () => {
  let reduced = true;
  const f = await setup({ listAutoplayGifs: true }, { motion: () => reduced });
  const keys = ['gridAutoplayGifs', 'listAutoplayGifs'];
  const settings = keys.map(key => f.app.controls.get(key));
  const settingsNote = f.doc.getElementById('epc-cover-motion-settings');
  const changeMotion = value => {
    reduced = value;
    f.app.media.reducedMotion.dispatchEvent(new f.win.Event('change'));
  };
  try {
    assert.equal(settingsNote.hidden, false);
    assert.ok(settings.every(control => control.disabled && control.getAttribute('aria-describedby') === settingsNote.id));
    settings[0].click();
    assert.deepEqual(settings.map(control => control.checked), [false, true]);

    f.app.onboarding.show();
    const welcome = keys.map(key => f.doc.querySelector('[data-welcome-setting=' + key + ']'));
    const welcomeNote = f.doc.getElementById('epc-cover-motion-welcome');
    assert.equal(welcomeNote.hidden, false);
    assert.ok(welcome.every(control => control.disabled && control.getAttribute('aria-describedby') === welcomeNote.id));
    changeMotion(false);
    assert.ok([...settings, ...welcome].every(control => !control.disabled && !control.hasAttribute('aria-describedby')));
    assert.ok(settingsNote.hidden && welcomeNote.hidden);
    welcome[0].click();
    changeMotion(true);
    assert.ok([...settings, ...welcome].every(control => control.disabled));
    f.app.onboarding.finish();
    assert.deepEqual(settings.map(control => control.checked), [true, true]);
    assert.deepEqual(keys.map(key => f.storage.get('ep.settings')[key]), [true, true]);
  } finally { f.close(); }
});

test('header load progress separates thumbnails, visible animation, and failures', async () => {
  const original = 'https://hamsterimg.net/images/progress.gif';
  const f = await setup({ gridAutoplayGifs: true, maxRetries: 0 }, {
    rows: rowHTML(1), definitions: overlayHTML(1, original, original.replace('.gif', '.th.jpg'))
  });
  try {
    const gauge = f.doc.querySelector('.epc-toolbar-main .epc-load-gauge');
    const panel = f.doc.getElementById('epc-load-detail');
    const status = key => panel.querySelector('[data-load-kind=' + key + '] .epc-load-count').textContent;
    await until(() => gauge.textContent === '0%');
    assert.equal(panel.hidden, true);
    gauge.focus();
    assert.equal(panel.hidden, false);
    assert.match(status('thumbnail'), /0\/1 ready.*1 pending/);
    assert.match(status('animation'), /0\/1 ready.*1 pending/);
    await completedSmall(f);
    assert.equal(gauge.textContent, '50%');
    assert.match(status('thumbnail'), /1\/1 ready/);
    f.clock.images.find(image => image.src === original).fail();
    await until(() => gauge.textContent === '100%');
    assert.match(status('animation'), /0\/1 ready.*1 failed/);
    assert.match(gauge.getAttribute('aria-label'), /1 failed/);
    gauge.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(panel.hidden, true);
  } finally { f.close(); }
});

test('autoplay saves GIF covers as previews and reuses them after navigation', async () => {
  const indexedDB = new IDBFactory(), original = 'https://hamsterimg.net/images/autoplay.gif';
  const requests = [], definitions = overlayHTML(1, original, original.replace('.gif', '.th.jpg'));
  for (const reopened of [false, true]) {
    const imageCache = new PersistentImageCache({
      indexedDB, origin: 'https://www.empornium.sx', now: Date.now, setTimeout, clearTimeout,
      request: ({ url, onload }) => {
        requests.push(url);
        onload({ status: 200, response: new Blob(['fixture'], { type: url === original ? 'image/gif' : 'image/jpeg' }) });
      },
      encode: async blob => 'data:' + blob.type + ';base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64')
    }, validateSettings);
    const f = await setup({ gridAutoplayGifs: true }, { rows: rowHTML(1), definitions, app: { imageCache } });
    try {
      await until(() => f.clock.images.some(image => image.src.startsWith('data:image/gif')));
      f.clock.images.find(image => image.src.startsWith('data:image/gif')).succeed();
      assert.match(f.doc.querySelector('.epc-grid-gif-playback').src, /^data:image\/gif/);
      const entry = f.app.media.pool.readyImages.get(original);
      assert.equal(entry.cacheHit, reopened);
      assert.equal((await f.app.imageCache.summary()).previewCount, 1);
      assert.equal(requests.filter(url => url === original).length, 1);
    } finally { f.close(); }
  }
});

test('a stalled autoplay download streams the cover directly and restores the thumbnail if it fails', async () => {
  const original = 'https://hamsterimg.net/images/slow.gif';
  const thumbnail = 'https://hamsterimg.net/images/slow.th.jpg';
  let managedRequest, aborted = false;
  const imageCache = new PersistentImageCache({
    indexedDB: new IDBFactory(), origin: 'https://www.empornium.sx', now: Date.now, setTimeout, clearTimeout,
    request: request => {
      if (request.url === original) {
        managedRequest = request;
        return { abort() { aborted = true; } };
      }
      request.onload({ status: 200, response: new Blob(['fixture'], { type: 'image/jpeg' }) });
    },
    encode: async blob => 'data:' + blob.type + ';base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64')
  }, validateSettings);
  const f = await setup({ gridAutoplayGifs: true, stallMs: 1000, maxRetries: 0 }, {
    rows: rowHTML(1), definitions: overlayHTML(1, original, thumbnail), app: { imageCache }
  });
  try {
    const playback = () => f.doc.querySelector('.epc-grid-gif-playback');
    const poster = f.doc.querySelector('.epc-thumb-button img');
    await until(() => !!managedRequest && f.clock.images.some(image => image.src.startsWith('data:image/jpeg')));
    f.clock.images.find(image => image.src.startsWith('data:image/jpeg')).succeed();
    assert.equal(playback(), null);
    await until(() => aborted && f.clock.images.some(image => image.src === original));
    const cover = f.clock.images.find(image => image.src === original);
    cover.naturalWidth = 640;
    cover.naturalHeight = 480;
    await until(() => playback()?.src === original);
    assert.equal(f.app.media.pool.entries.get(original + '|normal').status, 'streaming');
    managedRequest.onload({ status: 200, response: new Blob(['late'], { type: 'image/gif' }) });
    await settle();
    assert.equal(playback()?.src, original);
    cover.fail();
    assert.equal(playback(), null);
    assert.match(poster.src, /^data:image\/jpeg/);
  } finally { f.close(); }
});

test('Grid loads the same full cover as hover and admits covers regardless of filename extension', async () => {
  const supplied = ['https://hamsterimg.net/images/animation.md.webp?v=1', 'https://hamsterimg.net/images/animation', 'https://hamsterimg.net/images/animation.jpg'];
  const original = supplied[0].replace('.md.webp', '.webp');
  const definitions = supplied.map((url, index) => overlayHTML(index + 1, url,
    'https://hamsterimg.net/images/poster-' + index + '.th.jpg')).join('');
  const f = await setup({ gridAutoplayGifs: true }, { definitions, count: 3 });
  try {
    const animated = [original, supplied[1]];
    await until(() => animated.every(url => f.clock.images.some(image => image.src === url)));
    assert.ok(!f.clock.images.some(image => image.src === supplied[0] || image.src === supplied[2]));
    for (const image of f.clock.images.filter(image => animated.includes(image.src))) image.succeed();
    await until(() => f.clock.images.some(image => image.src === supplied[2]));
    f.clock.images.find(image => image.src === supplied[2]).succeed();
    assert.deepEqual([...f.doc.querySelectorAll('[data-ep-grid-playing] .epc-grid-gif-playback')].map(image => image.src), [...animated, supplied[2]]);
    const first = f.doc.querySelector('[data-fixture-id="1"] .epc-thumb-button');
    first.dispatchEvent(new f.win.MouseEvent('pointerenter'));
    await until(() => f.app.preview.image?.src === original);
    assert.equal(f.clock.images.filter(image => image.src === original).length, 1);
  } finally { f.close(); }
});

test('grid preserves native result identity and controls, labels metadata and reversibly toggles with persistence', async () => {
  const f = await setup({ thumbnailPlacement: 'category' });
  try {
    const table = f.doc.querySelector('table.torrent_table'), row = table.querySelector('tr.torrent'), link = row.querySelector('.fixture-title');
    assert.ok(table.classList.contains('epc-result-grid'));
    assert.equal(table.style.getPropertyValue('--epc-grid-width'), '320px');
    assert.equal(row.cells[5].dataset.epGridLabel, 'Size');
    assert.equal(row.cells[1].dataset.epGridCell, 'title'); assert.ok(row.cells[1].querySelector('.epc-thumbnail'));
    assert.equal(table.dataset.epGridDetails, 'false'); assert.ok(link.hasAttribute('data-ep-grid-title'));
    assert.equal(table.dataset.epGridTags, 'false');
    const fullTitle = link.textContent;
    await field(f, '[data-setting=gridShowDetails]', true);
    assert.equal(table.dataset.epGridDetails, 'true'); assert.equal(link.textContent, fullTitle);
    assert.equal(table.dataset.epGridTags, 'false', 'showing details does not show tags');
    await field(f, '[data-setting=gridShowTags]', true);
    assert.equal(table.dataset.epGridTags, 'true'); assert.equal(table.dataset.epGridDetails, 'true');
    const image = f.app.media.thumbnails.get(row).image;
    f.app.grid.layoutButtons.get('list').click(); assert.equal(f.storage.get('ep.settings').resultsView, 'list');
    assert.equal(table.classList.contains('epc-result-grid'), false); assert.equal(row.cells[5].hasAttribute('data-ep-grid-label'), false);
    assert.equal(table.hasAttribute('data-ep-grid-details'), false); assert.equal(link.hasAttribute('data-ep-grid-title'), false);
    assert.equal(table.hasAttribute('data-ep-grid-tags'), false);
    assert.equal(f.doc.querySelector('.fixture-title'), link); assert.ok(row.cells[0].contains(image));
    f.app.grid.layoutButtons.get('grid').click(); assert.equal(f.storage.get('ep.settings').resultsView, 'grid');
    assert.equal(table.dataset.epGridDetails, 'true');
    assert.equal(table.dataset.epGridTags, 'true');
    assert.equal(f.app.media.thumbnails.get(row).image, image); assert.ok(row.cells[1].contains(image));
  } finally { f.close(); }
});

test('grid keeps sorting controls and hides static cells in the same header', async () => {
  const rows = '<tr class="colhead_dark"><th>Category</th><th><a href="?sort=name">Name</a></th><th>Files</th></tr>' + rowHTML(1);
  const f = await boot({ 'ep.settings': { resultsView: 'grid' } }, { rows });
  try {
    const header = f.doc.querySelector('.colhead_dark');
    assert.equal(header.dataset.epGridHeader, 'sortable');
    const [category, sort, files] = header.cells;
    assert.equal(f.win.getComputedStyle(category).display, 'none');
    assert.equal(f.win.getComputedStyle(files).display, 'none');
    assert.notEqual(f.win.getComputedStyle(sort).display, 'none');
    assert.equal(sort.querySelector('a').getAttribute('href'), '?sort=name');

    clickText(f.doc.querySelector('.epc-toolbar'), 'List');
    assert.notEqual(f.win.getComputedStyle(category).display, 'none');
    assert.notEqual(f.win.getComputedStyle(files).display, 'none');
  } finally { f.close(); }
});

test('grid warms all 50 thumbnails and only requests an original when a preview opens', async () => {
  const positions = Array.from({ length: 50 }, (_, i) => 10 + 250 * i);
  const f = await setup({ thumbnailMode: 'original', gridLargeImages: true }, { count: 50, positions });
  try {
    for (let index = 0; index < 50; index++) {
      assert.match(f.clock.images[index]?.src, /\.th\.jpg$/);
      f.clock.images[index].succeed(160, 90);
    }
    await settle();
    assert.equal(f.clock.images.length, 50);
    const last = [...f.app.media.thumbnails.values()].at(-1);
    assert.equal(last.state, 'ready');
    assert.equal(f.win.scrollY, 0);
    Object.defineProperty(f.win, 'scrollY', { value: positions.at(-1) });
    f.win.dispatchEvent(new f.win.Event('scroll'));
    await settle();
    assert.equal(f.clock.images.length, 50);

    last.element.querySelector('button').click();
    assert.match(f.clock.images[50]?.src, /grid-50\.jpg$/);
    assert.match(last.image.src, /grid-50\.th\.jpg$/);
    f.clock.images[50].succeed(1200, 800);
    assert.equal(f.app.preview.element.dataset.state, 'ready');
    assert.match(last.image.src, /grid-50\.jpg$/);
    assert.equal(last.status.hidden, true);
    assert.equal(f.clock.images.length, 51);
  } finally { f.close(); }
});

test('a full image loaded in List fills its Grid card without another thumbnail request', async () => {
  const original = 'https://hamsterimg.net/images/list-original.jpg';
  const f = await boot({ 'ep.settings': { thumbnailMode: 'original', maxRetries: 0 } }, {
    rows: rowHTML(2), extra: overlayHTML(2, original)
  });
  try {
    const thumb = () => f.doc.querySelector('tr.torrent .epc-thumb-button img');
    await until(() => thumb()?.getAttribute('src') === original);
    const loaded = thumb();
    Object.defineProperty(loaded, 'naturalWidth', {
      get() { return this.getAttribute('src') === original ? 960 : 0; }
    });
    loaded.dispatchEvent(new f.win.Event('load'));

    clickText(f.doc.querySelector('.epc-toolbar'), 'Grid');
    await until(() => thumb()?.getAttribute('src') === original);
    assert.equal(f.doc.querySelector('.epc-thumb-status').hidden, true);
    thumb().closest('button').click();

    const preview = f.doc.querySelector('.epc-preview-frame img');
    assert.equal(preview.naturalWidth, 960);
    assert.equal(preview.getAttribute('src'), original);
  } finally { f.close(); }
});

test('a larger image that loads first fills the card while its small image is still pending', async () => {
  const f = await setup({}, { rows: rowHTML(1) });
  try {
    const record = [...f.app.media.thumbnails.values()][0], small = f.clock.images[0];
    assert.match(small.src, /grid-1\.th\.jpg$/);
    record.element.querySelector('button').click();
    await until(() => f.clock.images.length === 2);
    f.clock.images[1].succeed(1200, 800);
    assert.match(record.image.src, /grid-1\.jpg$/);
    assert.equal(record.status.hidden, true);
    assert.equal(record.element.dataset.state, 'ready');
    small.succeed(160, 90);
    assert.match(record.image.src, /grid-1\.jpg$/);
  } finally { f.close(); }
});

test('grid reuses a cached original when the preview is requested again', async () => {
  const indexedDB = new IDBFactory();
  const original = 'https://hamsterimg.net/images/grid-1.jpg';
  const requests = [];
  for (const reopened of [false, true]) {
    const imageCache = new PersistentImageCache({
      indexedDB, origin: 'https://www.empornium.sx', now: Date.now, setTimeout, clearTimeout,
      request: ({ url, onload }) => {
        requests.push(url);
        onload({ status: 200, response: new Blob(['fixture'], { type: 'image/jpeg' }) });
      },
      encode: async blob => 'data:' + blob.type + ';base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64')
    }, validateSettings);
    const f = await setup({}, { rows: rowHTML(1), app: { imageCache } });
    try {
      await until(() => f.clock.images.length === 1);
      f.clock.images[0].succeed(160, 90);
      await settle();
      assert.equal(f.clock.images.length, 1);
      const record = [...f.app.media.thumbnails.values()][0];
      Object.defineProperty(record.image, 'naturalWidth', { value: 160 });
      record.element.querySelector('button').click();
      await until(() => f.clock.images.length === 2);
      assert.match(f.clock.images[1].src, /^data:image\/jpeg/);
      f.clock.images[1].succeed(1200, 800);
      assert.equal([...f.app.media.pool.entries.values()].find(entry => entry.url === original).cacheHit, reopened);
      assert.equal((await f.app.imageCache.summary()).previewCount, 1);
      assert.equal(requests.filter(url => url === original).length, 1);
    } finally { f.close(); imageCache.close(); }
  }
});

test('missing grid thumbnails leave a placeholder and preserve the requested original’s retry budget', async () => {
  const f = await setup({ maxRetries: 1 }, {
    definitions: overlayHTML(1, 'https://hamsterimg.net/images/grid-1.jpg') +
      overlayHTML(2, 'https://other.test/images/unsized.jpg')
  });
  try {
    const [first, second] = f.app.media.thumbnails.values();
    assert.equal(f.clock.images.length, 1);
    assert.equal(second.status.textContent, 'Thumbnail unavailable');
    f.app.preview.showFor(second.link);
    assert.equal(f.clock.images.length, 1, 'title hover stays on thumbnails');
    f.app.preview.hide();
    f.clock.images[0].fail();
    await until(() => f.clock.images.length === 2);
    assert.match(f.clock.images[1]?.src, /grid-1\.th\.jpg/);
    f.clock.images[1].fail();
    assert.equal(first.status.textContent, 'Thumbnail unavailable');
    assert.equal(f.clock.images.length, 2);
    first.element.querySelector('button').click();
    await until(() => f.clock.images.length === 3);
    assert.match(f.clock.images[2]?.src, /grid-1\.jpg$/);
    f.clock.images[2].succeed(960, 540);
    assert.match(first.image.src, /grid-1\.jpg$/);
    assert.equal(first.status.hidden, true);
  } finally { f.close(); }
});

test('grid images load with list thumbnails disabled and changing card width preserves thumbnails', async () => {
  const f = await setup({ inlineThumbnails: false });
  try {
    await completedSmall(f);
    const record = [...f.app.media.thumbnails.values()][0], image = record.image;
    f.app.controls.get('gridCardWidth').value = 420; f.app.dirty = true; f.app.preferences.flush();
    assert.equal(record.image, image); assert.equal(f.doc.querySelector('table.torrent_table').style.getPropertyValue('--epc-grid-width'), '420px');
    f.app.grid.layoutButtons.get('list').click(); assert.equal(f.app.media.thumbnails.size, 0);
  } finally { f.close(); }
});

test('grid skips collapsed versions, warms new rows, and waits while the tab is hidden', async () => {
  let hidden = true;
  const f = await setup({}, { hidden: () => hidden, rows: rowHTML(1, { title: 'Mountain Walk [720p]' }) + rowHTML(2, { title: 'Mountain Walk [1080p]' }) });
  try {
    assert.equal(f.clock.images.length, 0); hidden = false; f.doc.dispatchEvent(new f.win.Event('visibilitychange'));
    await until(() => f.clock.images.length === 1); await completedSmall(f);
    assert.ok(f.doc.querySelector('[data-fixture-id="2"]').classList.contains('epc-version-hidden'));
    const body = f.doc.querySelector('table.torrent_table>tbody'); body.insertAdjacentHTML('beforeend', rowHTML(3));
    await until(() => f.clock.images.length === 2);
    const record = f.app.media.thumbnails.get(f.doc.querySelector('[data-fixture-id="3"]'));
    assert.equal(record.row.cells[1].dataset.epGridCell, 'title');
    assert.match(f.clock.images[1].src, /grid-3\.th\.jpg$/);
    f.clock.images[1].succeed(160, 90);
    assert.equal(record.state, 'ready');
  } finally { f.close(); }
});

test('setup and Settings share the grid layout, width, spacing and GIF opt-in', async () => {
  const store = strictStorage({ 'ep.onboardingDone': false }), f = await boot({}, { store });
  try {
    const dialog = f.doc.querySelector('.epc-onboarding');
    dialog.querySelector('[name=welcome-backfill][value=off]').checked = true;
    dialog.querySelector('[data-welcome-setting=resultsView]').value = 'grid';
    dialog.querySelector('[data-welcome-setting=gridCardWidth]').value = 420;
    dialog.querySelector('[data-welcome-setting=gridSpacing]').value = 'compact';
    const autoplay = dialog.querySelector('[data-welcome-setting=gridAutoplayGifs]');
    assert.equal(autoplay.checked, false); autoplay.checked = true;
    const listAutoplay = dialog.querySelector('[data-welcome-setting=listAutoplayGifs]');
    assert.equal(listAutoplay.checked, false); listAutoplay.checked = true;
    clickText(dialog, 'Start browsing'); await settle();
    assert.equal(store.get('ep.settings').resultsView, 'grid'); assert.equal(store.get('ep.settings').gridCardWidth, 420);
    assert.equal(store.get('ep.settings').gridSpacing, 'compact'); assert.equal(store.get('ep.settings').gridAutoplayGifs, true);
    assert.equal(store.get('ep.settings').listAutoplayGifs, true);
    assert.equal(f.doc.querySelector('.epc-result-grid').dataset.epGridSpacing, 'compact');
    pane(f, 'settings'); await field(f, '[data-setting=gridCardWidth]', 540);
    await field(f, '[data-setting=gridSpacing]', 'standard');
    assert.equal(f.doc.querySelector('.epc-result-grid').dataset.epGridSpacing, 'standard');
    clickText(f.doc.querySelector('[data-pane=settings].epc-pane'), 'Getting started');
    const replay = f.doc.querySelector('.epc-onboarding');
    assert.equal(replay.querySelector('[data-welcome-setting=resultsView]').value, 'grid');
    assert.equal(replay.querySelector('[data-welcome-setting=gridCardWidth]').value, '540');
    assert.equal(replay.querySelector('[data-welcome-setting=gridSpacing]').value, 'standard');
    assert.equal(replay.querySelector('[data-welcome-setting=gridAutoplayGifs]').checked, true);
    assert.equal(replay.querySelector('[data-welcome-setting=listAutoplayGifs]').checked, true);
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('compiled grid backfill retains filtering, grouping, reveal and the current layout', async () => {
  const f = await boot({ 'ep.settings': { resultsView: 'grid', inlineThumbnails: false, backfillPages: 1 }, nseTaglist: 'blocked' }, {
    url: 'https://www.empornium.sx/torrents.php?page=1',
    fetch: async url => ({ ok: true, url, headers: new Map([['content-type', 'text/html']]), text: async () =>
      fixtureHTML(rowHTML(2) + rowHTML(3, { tags: 'blocked' }), overlayHTML(2, 'https://hamsterimg.net/images/new.jpg'))
        .replace(/<a class="pager_prev"[\s\S]*?<\/a><a class="pager_next"[\s\S]*?<\/a>/, '') })
  });
  try {
    const footer = f.doc.querySelector('.epc-results-end');
    assert.equal(footer.previousElementSibling, f.doc.querySelector('.epc-result-grid'));
    clickText(footer, 'Load more');
    await until(() => !!f.doc.querySelector('[data-fixture-id="3"]'));
    const table = f.doc.querySelector('table.torrent_table'), row = table.querySelector('[data-fixture-id="3"]');
    assert.equal(table.classList.contains('epc-result-grid'), true); assert.equal(row.cells[1].dataset.epGridCell, 'title');
    assert.equal(row.classList.contains('hidden'), true); assert.equal(table.querySelectorAll('tr.torrent').length, 3);
    f.doc.querySelector('[data-ep-reveal]').click(); await settle();
    assert.equal(row.classList.contains('epc-revealed'), true); assert.equal(row.classList.contains('hidden'), false);
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('a failed layout write preserves the current grid and can be retried', async () => {
  const store = strictStorage({ 'ep.settings': { resultsView: 'grid', inlineThumbnails: false } });
  const f = await boot({}, { store });
  try {
    store.failNext('ep.settings'); const toggle = f.doc.querySelector('[data-ep-layout="list"]'); toggle.click();
    assert.equal(store.get('ep.settings').resultsView, 'grid'); assert.equal(f.doc.querySelector('table.torrent_table').classList.contains('epc-result-grid'), true);
    assert.equal(toggle.getAttribute('aria-pressed'), 'false');
    toggle.click(); assert.equal(store.get('ep.settings').resultsView, 'list');
    assert.equal(f.doc.querySelector('table.torrent_table').classList.contains('epc-result-grid'), false);
  } finally { f.close(); }
});

test('Appearance can apply saved Grid options to results currently shown as List', async () => {
  const f = await boot({ 'ep.settings': { resultsView: 'list', gridSpacing: 'compact', gridAutoplayGifs: true } });
  try {
    pane(f, 'settings');
    const settings = f.doc.querySelector('.epc-pane[data-pane=settings]');
    assert.equal(f.doc.querySelector('.epc-result-grid'), null);
    const spacing = settings.querySelector('[data-setting=gridSpacing]');
    assert.equal(spacing.closest('label').hidden, true);
    const button = clickText(settings, 'Switch to Grid');
    assert.equal(spacing.closest('label').hidden, false);
    assert.equal(f.store.get('ep.settings').resultsView, 'grid');
    assert.equal(f.doc.querySelector('.epc-result-grid').dataset.epGridSpacing, 'compact');
    assert.equal(button.hidden, true);
  } finally { f.close(); }
});

test('switching from an unfinished original-mode list cancels the old transfer and starts small first', async () => {
  const f = await setup({ resultsView: 'list', thumbnailMode: 'original' });
  try {
    const previous = [...f.app.media.thumbnails.values()].map(record => record.lastEntry);
    assert.ok(f.clock.images.every(image => !image.src.includes('.th.')));
    f.app.grid.layoutButtons.get('grid').click(); await settle();
    assert.ok(previous.every(entry => entry.cancelled));
    assert.ok([...f.app.media.thumbnails.values()].every(record => record.lastEntry.actualURL.includes('.th.')));
    await completedSmall(f); assert.equal(f.app.media.pool.activeLanes.large, 0);
  } finally { f.close(); }
});

test('grid size presets save numeric widths and retain a custom width through other edits and restore', async () => {
  const f = await setup({ gridCardWidth: 400 });
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
  let store = strictStorage({ 'ep.settings': { inlineThumbnails: false } });
  let f = await boot({}, { store, url: 'https://www.empornium.sx/torrents.php?searchtext=first&page=1' });
  try {
    clickText(f.doc.querySelector('.epc-toolbar'), 'Grid'); await field(f, '[data-setting=gridCardWidth]', 540);
    assert.equal(f.win.getComputedStyle(f.doc.querySelector('tr.torrent .tags')).display, 'none');
    await field(f, '[data-setting=gridShowDetails]', true);
    assert.equal(f.win.getComputedStyle(f.doc.querySelector('tr.torrent .tags')).display, 'none');
    await field(f, '[data-setting=gridShowTags]', true);
    assert.notEqual(f.win.getComputedStyle(f.doc.querySelector('tr.torrent .tags')).display, 'none');
  } finally { f.close(); }
  // New document, different search/page, same durable manager data.
  f = await boot({}, { store, url: 'https://www.empornium.sx/torrents.php?searchtext=second&page=2' });
  try {
    assert.equal(f.doc.querySelector('[data-ep-layout="grid"]').getAttribute('aria-pressed'), 'true');
    assert.equal(f.doc.querySelector('table.torrent_table').classList.contains('epc-result-grid'), true);
    assert.equal(f.doc.querySelector('[data-setting=gridCardWidth]').value, '540');
    assert.equal(f.doc.querySelector('table.torrent_table').dataset.epGridDetails, 'true');
    assert.equal(f.doc.querySelector('table.torrent_table').dataset.epGridTags, 'true');
  } finally { f.close(); }
  // Fresh manager/storage object and window, as after restarting the browser.
  store = strictStorage(Object.fromEntries(Object.entries(store.snapshot()).map(([key, value]) => [key, JSON.parse(value)])));
  f = await boot({}, { store, url: 'https://www.empornium.sx/torrents.php?searchtext=third' });
  try {
    assert.equal(f.doc.querySelector('table.torrent_table').classList.contains('epc-result-grid'), true);
    assert.equal(f.doc.querySelector('[data-setting=gridCardWidth]').value, '540');
    assert.equal(f.doc.querySelector('[data-setting=gridShowDetails]').checked, true);
    assert.equal(f.doc.querySelector('[data-setting=gridShowTags]').checked, true);
    assert.notEqual(f.win.getComputedStyle(f.doc.querySelector('tr.torrent .tags')).display, 'none');
    clickText(f.doc.querySelector('.epc-toolbar'), 'List');
  } finally { f.close(); }
  f = await boot({}, { store });
  try {
    assert.equal(f.doc.querySelector('[data-ep-layout="list"]').getAttribute('aria-pressed'), 'true');
    assert.equal(f.doc.querySelector('table.torrent_table').classList.contains('epc-result-grid'), false);
    assert.equal(f.doc.querySelector('[data-setting=gridCardWidth]').value, '540');
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});
