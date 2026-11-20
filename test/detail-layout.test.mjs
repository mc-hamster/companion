import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';
import { afterFrames, detailFixtureHTML, domFixture, fakeClock, fixtureHTML, memoryStorage, until } from './helpers.mjs';

async function openDetail(t, { enabled = false, html = detailFixtureHTML(), path = '/torrents.php?id=42',
  storage = memoryStorage({ 'ep.settings': enabled ? { reformatDetailPages: true } : {} }), Image } = {}) {
  const fixture = domFixture(html, 'https://www.empornium.sx' + path);
  const requests = [];
  const app = createApp(fixture.win, storage, { Image, fetch: (...args) => { requests.push(args); } }).start();
  t.after(() => { app.dispose(); fixture.close(); });
  await until(() => app.root?.dataset.epReady === 'true', 'Companion ready');
  return { ...fixture, app, storage, requests };
}

test('Getting started saves the same opt-in used by the detail toolbar', async t => {
  const storage = memoryStorage({ 'ep.onboardingDone': false, 'ep.settings': {} });
  const setup = await openDetail(t, { storage });
  const setting = '[data-welcome-setting=reformatDetailPages]';
  const choice = setup.doc.querySelector(setting);
  const toolbarSwitch = setup.app.controls.get('reformatDetailPages');
  assert.equal(choice.checked, false);
  choice.click();
  assert.equal(toolbarSwitch.checked, false);
  assert.equal(storage.get('ep.settings').reformatDetailPages, undefined);
  setup.app.onboarding.save.click();
  assert.equal(storage.get('ep.settings').reformatDetailPages, true);
  assert.equal(toolbarSwitch.checked, true);
  assert.ok(setup.doc.querySelector('.epc-detail-preview'));

  const reopened = await openDetail(t, { storage });
  reopened.app.paneButtons.get('settings').click();
  const gettingStarted = reopened.app.panes.settings.querySelector('.epc-settings-help');
  gettingStarted.click();
  const savedChoice = reopened.doc.querySelector(setting);
  assert.equal(savedChoice.checked, true);
  savedChoice.click();
  reopened.app.onboarding.save.click();
  assert.equal(storage.get('ep.settings').reformatDetailPages, false);
  assert.equal(reopened.app.controls.get('reformatDetailPages').checked, false);
  assert.equal(reopened.doc.querySelector('.epc-detail-preview'), null);
});

test('the detail layout is opt-in, applies immediately, and restores native markup when disabled', async t => {
  const html = detailFixtureHTML().replace('<table id="personal_collages">',
    '<table id="personal_collages"><tr class="colhead"><td>Collage name</td><td># torrents</td></tr>');
  const { app, doc, storage, requests } = await openDetail(t, { html, storage: memoryStorage({ nseSelectedTheme: 'nseThemeLegacy' }) });
  const root = doc.querySelector('.details');
  const title = root.querySelector('h2');
  const details = root.querySelector('#details_top');
  const next = details.nextSibling;
  const description = root.querySelector('#descbox');
  const discussion = root.querySelector('.main_column');
  const discussionChildren = [...discussion.children];
  const original = ['#details_top', '#descbox', '.spoiler', '#quickpostform', '#bookmarklink_torrent_42']
    .map(selector => ({ selector, node: doc.querySelector(selector), parent: doc.querySelector(selector).parentElement }));
  const composer = doc.querySelector('#quickpostform textarea');
  composer.value = 'An unfinished reply';
  const toggle = app.controls.get('reformatDetailPages');
  assert.equal(toggle.getAttribute('role'), 'switch');
  assert.ok(toggle.closest('.epc-toolbar'));
  assert.equal(toggle.closest('label').hidden, false);
  assert.equal(app.toolbar.querySelector('[data-pane=filters],.epc-result-actions,.epc-layout-switch,.epc-view-options,[data-ep-reveal]'), null);
  assert.equal(app.toolbar.querySelector('[data-setting=animatedCovers]'), null);
  assert.ok(app.toolbar.querySelector('[data-pane=searches]'));
  assert.ok(app.toolbar.querySelector('[data-pane=settings]'));
  assert.equal(toggle.checked, false);
  assert.equal(root.hasAttribute('data-ep-detail-layout'), false);
  assert.equal(doc.querySelector('.epc-detail-nav'), null);

  toggle.click();
  await until(() => root.hasAttribute('data-ep-detail-layout'), 'Reformatted layout');
  assert.equal(storage.get('ep.settings').reformatDetailPages, true);
  assert.equal(root.querySelector('.epc-detail-nav'), null);
  assert.ok(root.classList.contains('epc-detail-panels'));
  assert.equal(root.style.getPropertyValue('--epc-bg'), '#23395a');
  assert.deepEqual([...discussion.children], discussionChildren);
  assert.ok(doc.querySelector('#personal_collages[data-ep-collage-count]'));
  assert.equal(details.previousElementSibling, root.querySelector('.epc-detail-preview'));
  assert.equal(details.parentElement, root);
  assert.equal(description.parentElement, original.find(item => item.node === description).parent);
  assert.ok(details.compareDocumentPosition(composer) & doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING);
  const other = await openDetail(t, { path: '/torrents.php?id=43', storage });
  assert.equal(other.app.controls.get('reformatDetailPages').checked, true);
  assert.ok(other.doc.querySelector('[data-ep-detail-layout] > .epc-detail-preview'));

  toggle.click();
  await until(() => !root.hasAttribute('data-ep-detail-layout'), 'Native layout');
  assert.equal(storage.get('ep.settings').reformatDetailPages, false);
  assert.equal(doc.querySelector('.epc-detail-preview'), null);
  assert.equal(root.classList.contains('epc-detail-panels'), false);
  assert.equal(root.style.getPropertyValue('--epc-bg'), '');
  assert.deepEqual([...discussion.children], discussionChildren);
  assert.equal(doc.querySelector('#personal_collages[data-ep-collage-count]'), null);
  assert.equal(title.hasAttribute('id'), false);
  assert.equal(title.hasAttribute('tabindex'), false);
  assert.ok(doc.querySelector('#native-description'));
  assert.equal(details.nextSibling, next);
  for (const { selector, node, parent } of original) {
    assert.equal(doc.querySelector(selector), node);
    assert.equal(node.parentElement, parent);
  }
  assert.equal(composer.value, 'An unfinished reply');
  assert.equal(doc.querySelector('.spoiler img').hasAttribute('src'), false);
  const reopened = await openDetail(t, { storage });
  assert.equal(reopened.app.controls.get('reformatDetailPages').checked, false);
  assert.equal(reopened.doc.querySelector('.epc-detail-preview'), null);
  assert.deepEqual(requests, []);
});

test('the gallery starts with the cover and the layout switch restores the original image, link, and retry control', async t => {
  const { app, doc } = await openDetail(t, { enabled: true });
  const description = doc.querySelector('#descbox');
  const originalBox = description.closest('.box');
  const preview = doc.querySelector('.epc-detail-preview');
  const gallery = preview.querySelector('.epc-detail-preview-images');
  const toggle = app.controls.get('reformatDetailPages');
  const cover = doc.querySelector('#coverimage');
  const coverImage = gallery.querySelector('img');
  const link = doc.querySelector('#preview-link');
  const image = link.querySelector('img');
  const picture = image.parentElement;
  const source = picture.querySelector('source');
  assert.ok(originalBox.hasAttribute('data-ep-detail-original-hidden'));
  assert.ok(doc.querySelector('#native-description').hasAttribute('data-ep-detail-original-hidden'));
  assert.ok(cover.hasAttribute('data-ep-detail-original-hidden'));
  assert.ok(cover.previousElementSibling.hasAttribute('data-ep-detail-original-hidden'));
  assert.equal(preview.querySelector('.epc-detail-original-control'), null);
  assert.equal(gallery.children.length, 3);
  assert.equal(coverImage.getAttribute('src'), '/coast-cover.svg');
  assert.equal(gallery.querySelector('#preview-link'), link);
  assert.equal(gallery.querySelector('picture'), picture);
  assert.equal(gallery.querySelector('source'), source);
  assert.equal(image.getAttribute('src'), '/coast-wide.svg');
  assert.equal(preview.querySelector('#contact-sheet img').hasAttribute('src'), false);
  assert.ok(gallery.querySelector('#description-divider'));
  assert.ok(description.querySelector('#torrentsigbox img'));
  assert.equal(app.media.visible(description.querySelector('#torrentsigbox img')), false);
  const imageRecord = app.media.records.get(image);
  app.media.showRetry(imageRecord);
  const retry = imageRecord.retryButton;
  assert.ok(gallery.contains(retry));

  toggle.click();
  assert.equal(originalBox.hasAttribute('data-ep-detail-original-hidden'), false);
  assert.equal(cover.hasAttribute('data-ep-detail-original-hidden'), false);
  assert.equal(cover.querySelector('img'), coverImage);
  assert.equal(description.querySelector('#preview-link'), link);
  assert.equal(description.querySelector('picture'), picture);
  assert.equal(description.querySelector('source'), source);
  assert.ok(description.querySelector('#contact-sheet'));
  assert.equal(link.nextElementSibling, retry);
  assert.equal(retry.nextElementSibling.id, 'description-divider');
  assert.equal(gallery.children.length, 0);

  toggle.click();
  const updatedGallery = doc.querySelector('.epc-detail-preview-images');
  assert.equal(updatedGallery.querySelector('img'), coverImage);
  assert.equal(updatedGallery.querySelector('#preview-link img'), image);
  assert.ok(updatedGallery.contains(retry));
  assert.ok(originalBox.hasAttribute('data-ep-detail-original-hidden'));
});

test('the reformatted view shows all 94 images on entry and retains spoilers, embeds, and description links', async t => {
  const lead = Array.from({ length: 5 }, (_, index) => `<img src="/lead-${index}.jpg" width="600" height="380">`).join('');
  const sheets = Array.from({ length: 89 }, (_, index) => `<a id="sheet-${index}" href="/full-${index}.jpg">
    <img src="/sheet-${index}.jpg" width="180" height="120" onclick="lightbox.init(this)">Sheet ${index + 1}</a>`).join('');
  const html = detailFixtureHTML().replace(/<a [^>]*id="preview-link"[\s\S]*?(?=<a id="reveal-example")/, `<div>${lead}</div>${sheets}
    <div class="youtube" data-embed="fixture"><img src="/poster.jpg"></div>
    <a id="sheet-album" href="/sheet-album">Full contact-sheet album</a>`);
  const { app, doc, requests } = await openDetail(t, { enabled: true, html });
  const preview = doc.querySelector('.epc-detail-preview');
  const gallery = preview.querySelector('.epc-detail-preview-images');
  const original = doc.querySelector('#descbox');
  const lastSheet = gallery.querySelector('#sheet-88');
  const firstSheet = gallery.querySelector('#sheet-0');
  const spoiler = preview.querySelector('#contact-sheet');
  const spoilerControl = preview.querySelector('#reveal-example');
  const embed = preview.querySelector('.youtube');
  const album = preview.querySelector('.epc-detail-preview-links #sheet-album');
  const visible = () => [...doc.querySelectorAll('.epc-detail-preview-images img')].filter(image => image.getClientRects().length).length;

  assert.equal(gallery.querySelectorAll('img').length, 95);
  assert.equal(visible(), 95);
  assert.equal(gallery.querySelector('img').getAttribute('src'), '/coast-cover.svg');
  assert.equal(preview.querySelector('.epc-detail-gallery-control'), null);
  assert.equal(lastSheet.getAttribute('href'), '/full-88.jpg');
  assert.equal(lastSheet.querySelector('img').getAttribute('onclick'), 'lightbox.init(this)');
  assert.ok(firstSheet.querySelector('img'));

  assert.equal(spoilerControl.nextSibling, spoiler);
  assert.ok(spoiler.classList.contains('hidden'));
  const deferred = spoiler.querySelector('img');
  assert.equal(deferred.hasAttribute('src'), false);
  spoilerControl.addEventListener('click', event => {
    event.preventDefault();
    spoilerControl.nextElementSibling.classList.remove('hidden');
    deferred.src = deferred.dataset.src;
  });
  spoilerControl.click();
  assert.equal(spoiler.classList.contains('hidden'), false);
  assert.equal(deferred.getAttribute('src'), '/coast-contact-sheet.svg');
  assert.equal(embed.querySelector('img').getAttribute('src'), '/poster.jpg');
  assert.equal(album.getAttribute('href'), '/sheet-album');

  const toggle = app.controls.get('reformatDetailPages');
  toggle.click();
  assert.equal(original.querySelector('#sheet-0'), firstSheet);
  assert.equal(original.querySelector('#sheet-88'), lastSheet);
  assert.equal(original.querySelector('#contact-sheet'), spoiler);
  assert.equal(original.querySelector('.youtube'), embed);
  assert.equal(original.querySelector('#sheet-album'), album);
  assert.equal(spoilerControl.nextElementSibling, spoiler);
  toggle.click();
  assert.equal(visible(), 95);
  assert.deepEqual(requests, []);
});

test('site-provided description banners stay in the original while real screens remain in the gallery', async t => {
  const banners = ['cast', 'plot', 'info', 'screens'].map((name, index) => {
    const root = index === 3 ? 'https://www.empornium.me' : '';
    return `<img class="bbcode icon" src="${root}/static/common/icons/${name}11.png" alt="${name}">`;
  }).join('');
  const html = detailFixtureHTML({ cover: false }).replace(/<a [^>]*id="preview-link"[\s\S]*?(?=<a id="reveal-example")/,
    `${banners}<img src="/images/2026/11/20/screens.jpg" alt="screens">
    <img src="https://example.test/static/common/icons/info.png" alt="info">`);
  const { app, doc } = await openDetail(t, { enabled: true, html });
  const gallery = doc.querySelector('.epc-detail-preview-images');
  const original = doc.querySelector('#descbox');
  assert.deepEqual([...gallery.querySelectorAll('img')].map(image => image.getAttribute('src')),
    ['/images/2026/11/20/screens.jpg', 'https://example.test/static/common/icons/info.png']);
  assert.equal(original.querySelectorAll('img.bbcode.icon').length, 4);
  app.controls.get('reformatDetailPages').click();
  assert.equal(original.querySelectorAll('img.bbcode.icon').length, 4);
  assert.ok(original.querySelector('img[src="/images/2026/11/20/screens.jpg"]'));
});

test('studio template banners stay in the original while all contact sheets and screenshots move to the gallery', async t => {
  const cdn = 'https://hamsterimg.net/images/2026/11/20/';
  const roles = ['sceneinfo', 'thestory', 'mediainfo', 'screenshots'];
  const shots = Array.from({ length: 9 }, (_, i) => `<img id="shot-${i}" src="${cdn}shot-${i}.webp" width="1280" height="720">`);
  for (const { id, studio, banner, hash } of [
    { id: 1166907, studio: 'privatesociety', banner: 'banner_1x', hash: '0123456789abcdef' },
    { id: 1166938, studio: 'nubilesnet', banner: 'banner', hash: '' }
  ]) {
    const headers = roles.map(role => `<img src="${cdn}${studio}_h_${role}${hash}.md.png" width="600">`).join('');
    const html = detailFixtureHTML().replace(/<a [^>]*id="preview-link"[\s\S]*?(?=<a id="reveal-example")/,
      `<img id="studio-banner" src="${cdn}${studio}_${banner}.png?v=1" width="900">${shots.join('')}
      <a id="studio-artwork" href="${cdn}cast-card-large.webp">
        <img id="cast-header" src="${cdn}${studio}_h_cast${hash}.png" width="600">
        <img id="cast-card" src="${cdn}cast-card.webp" width="1600" height="800"></a>
      ${headers}
      <img id="sheet" src="${cdn}${studio}_screenshots.jpg" width="1216" height="2074">
      <img id="panorama" src="${cdn}coastal_banner.png" width="1500" height="300">`);
    const { app, doc } = await openDetail(t, { enabled: true, html, path: '/torrents.php?id=' + id });
    const gallery = doc.querySelector('.epc-detail-preview-images');
    const original = doc.querySelector('#descbox');
    const images = [...gallery.querySelectorAll('img')];
    const studioImages = () => original.querySelectorAll(`img[src*="/${studio}_"]`);
    assert.equal(images[0].getAttribute('src'), '/coast-cover.svg');
    assert.deepEqual(images.slice(1).map(image => image.id), shots.map((_, i) => `shot-${i}`).concat('cast-card', 'sheet', 'panorama'));
    assert.equal(studioImages().length, 6);
    assert.ok(original.querySelector('#studio-artwork #cast-header'));

    app.controls.get('reformatDetailPages').click();
    assert.ok(original.querySelector('#studio-artwork #cast-card'));
    assert.ok(original.querySelector('#sheet'));
    assert.equal(studioImages().length, 7);
  }
});

test('an older listing keeps its screenshot label and Personal Collages status', async t => {
  const sheets = Array.from({ length: 31 }, (_, i) => `<a href="/sheet-${i}.jpg"><img data-src="/sheet-${i}.jpg"></a>`).join('');
  const html = detailFixtureHTML()
    .replace('<a id="reveal-example"', '<strong>SCREENSHOTS</strong><a id="reveal-example"')
    .replace(/<img data-src="\/coast-contact-sheet\.svg"[^>]*>/, sheets)
    .replace('<table id="personal_collages">', '<table id="personal_collages"><tr class="colhead"><td>This torrent is in 3 personal collages</td><td># torrents</td></tr>');
  const { app, doc } = await openDetail(t, { enabled: true, html, path: '/torrents.php?id=357402' });
  const gallery = doc.querySelector('.epc-detail-spoiler-gallery');
  const control = gallery.querySelector('#reveal-example');
  const spoiler = gallery.querySelector('#contact-sheet');
  const label = gallery.querySelector('strong');
  assert.equal(label.textContent, 'SCREENSHOTS');
  assert.equal(control.nextSibling, spoiler);
  assert.equal(spoiler.querySelectorAll('img[data-src]:not([src])').length, 31);
  assert.equal(doc.querySelector('#personal_collages').hasAttribute('data-ep-collage-count'), false);
  app.controls.get('reformatDetailPages').click();
  assert.ok(doc.querySelector('#descbox').contains(label));
  assert.equal(control.nextElementSibling, spoiler);
});

test('other-upload cards after the uploader promotion heading stay in the original description', async t => {
  const cards = [101, 102, 103].map(id =>
    `<a href="/torrents.php?id=${id}"><strong>Other upload</strong><br><img src="/promo-${id}.jpg"></a>`).join('<br><br>');
  const html = detailFixtureHTML().replace('<div id="torrentsigbox">',
    `<hr><br>Please check my other uploads:<br><br>${cards}<hr><a href="/torrents.php?id=104">Related release</a><div id="torrentsigbox">`);
  const { app, doc } = await openDetail(t, { enabled: true, html, path: '/torrents.php?id=357402' });
  const preview = doc.querySelector('.epc-detail-preview');
  const original = doc.querySelector('#descbox');
  assert.equal(preview.querySelectorAll('img[src^="/promo-"]').length, 0);
  assert.equal(original.querySelectorAll('a[href*="torrents.php?id="] img').length, 3);
  assert.ok(preview.querySelector('a[href="/torrents.php?id=104"]'));
  assert.ok(preview.querySelector('img[src="/coast-wide.svg"]'));
  app.controls.get('reformatDetailPages').click();
  assert.equal(original.querySelectorAll('img[src^="/promo-"]').length, 3);
});

test('the gallery shows a cover once when the description repeats its original or thumbnail', async t => {
  const coverURL = 'https://hamsterimg.net/images/coast.jpg';
  const html = detailFixtureHTML().replace('/coast-cover.svg', coverURL)
    .replace(/<a [^>]*id="preview-link"[\s\S]*?(?=<a id="reveal-example")/,
      `<img src="${coverURL}" alt="Repeated cover">
       <a href="${coverURL}"><img src="https://hamsterimg.net/images/coast.th.jpg?_ep_retry=2" alt="Cover thumbnail">
       <img src="/contact-sheet.jpg" alt="Contact sheet"></a>`);
  const { app, doc } = await openDetail(t, { enabled: true, html });
  const gallery = doc.querySelector('.epc-detail-preview-images');
  assert.deepEqual([...gallery.querySelectorAll('img')].map(image => image.getAttribute('src')),
    [coverURL, '/contact-sheet.jpg']);

  app.controls.get('reformatDetailPages').click();
  assert.equal(doc.querySelector('#coverimage img').getAttribute('src'), coverURL);
  assert.equal(doc.querySelectorAll('#descbox img[alt^="Cover"],#descbox img[alt="Repeated cover"]').length, 2);
  assert.ok(doc.querySelector('#descbox a img[src="/contact-sheet.jpg"]'));
});

test('a small gallery uses the image proportions and updates its sizing when a sheet loads', async t => {
  const html = detailFixtureHTML({ cover: false }).replace(/<a [^>]*id="preview-link"[\s\S]*?(?=<a id="reveal-example")/,
    '<img src="/first.jpg" width="500" height="700"><img src="/second.jpg" width="868" height="948">' +
    '<img id="pending-sheet" src="/third.jpg">');
  const { doc, win } = await openDetail(t, { enabled: true, html });
  const gallery = doc.querySelector('.epc-detail-preview-images');
  const pending = gallery.querySelector('#pending-sheet');
  const declared = 500 / 700 + 868 / 948;
  assert.ok(gallery.hasAttribute('data-ep-adaptive-gallery'));
  assert.equal(gallery.style.getPropertyValue('--epc-gallery-count'), '3');
  assert.equal(Number(gallery.style.getPropertyValue('--epc-gallery-ratios')), declared + 1);

  Object.defineProperties(pending, { naturalWidth: { value: 1932 }, naturalHeight: { value: 3356 } });
  pending.dispatchEvent(new win.Event('load'));
  assert.equal(Number(gallery.style.getPropertyValue('--epc-gallery-ratios')), declared + 1932 / 3356);
  assert.ok(gallery.style.getPropertyValue('--epc-gallery-tracks').endsWith(`minmax(0,${(1932 / 3356) / (declared + 1932 / 3356) * 3}fr)`));

  const tallOnly = detailFixtureHTML({ cover: false }).replace(/<a [^>]*id="preview-link"[\s\S]*?(?=<a id="reveal-example")/,
    '<img src="/tall.jpg" width="1278" height="3758">');
  const single = await openDetail(t, { enabled: true, html: tallOnly });
  const singleGallery = single.doc.querySelector('.epc-detail-preview-images');
  assert.ok(singleGallery.hasAttribute('data-ep-single-image'));
  assert.equal(singleGallery.style.getPropertyValue('--epc-gallery-tracks'), 'minmax(0,1fr)');
});

test('gallery hover reuses the thumbnail and clicking opens a larger preview with its linked original', async t => {
  const clock = fakeClock();
  const html = detailFixtureHTML().replace('href="#panorama"', 'href="/coast-original.jpg"');
  const storage = memoryStorage({ 'ep.settings': { reformatDetailPages: true, recoverImages: false, persistentImages: false } });
  const { app, doc, win } = await openDetail(t, { html, storage, Image: clock.env.Image });
  const link = doc.querySelector('#preview-link');
  const tile = link.querySelector('img');
  let nativeClicks = 0;
  tile.addEventListener('click', event => { nativeClicks++; event.preventDefault(); });
  Object.defineProperties(tile, { naturalWidth: { value: 300 }, naturalHeight: { value: 160 } });
  const viewer = app.preview;
  link.dispatchEvent(new win.MouseEvent('pointerenter', { clientX: 30, clientY: 28 }));
  await until(() => viewer.open && viewer.zoom, 'Gallery hover');
  await afterFrames(win);
  const hoverWidth = parseFloat(viewer.element.style.width);
  assert.equal(viewer.image.src, tile.src);
  assert.equal(clock.images.length, 0);

  viewer.frame.click();
  assert.equal(viewer.pinned, true);
  assert.equal(nativeClicks, 0);
  assert.equal(viewer.image.src, tile.src);
  await until(() => clock.images.some(image => image.src === 'https://www.empornium.sx/coast-original.jpg'), 'Original image request');
  clock.images.find(image => image.src.endsWith('/coast-original.jpg')).succeed(1200, 640);
  await afterFrames(win);
  assert.ok(parseFloat(viewer.element.style.width) > hoverWidth);
  assert.ok(viewer.image.src.endsWith('/coast-original.jpg'));

  viewer.hide(true);
  tile.click();
  assert.equal(viewer.pinned, true);
  assert.equal(nativeClicks, 0);
  app.controls.get('reformatDetailPages').click();
  assert.equal(viewer.open, false);
  tile.click();
  assert.equal(nativeClicks, 1);
  assert.equal(viewer.open, false);
});

test('the disclosure below Tags opens each edition and restores the original tables on opt-out', async t => {
  const { app, doc, requests } = await openDetail(t, { enabled: true, html: detailFixtureHTML({ collages: false, comments: false }) });
  const details = doc.querySelector('#details_top');
  const summary = doc.querySelector('.epc-detail-files');
  const table = details.querySelector('.torrent_table');
  const fileList = doc.querySelector('#files_42');
  const editions = [...summary.querySelectorAll(':scope > details')];
  const current = editions.find(edition => edition.open);
  const currentFiles = current.querySelector('.epc-detail-file-table>table');
  const nativeToggle = [...table.querySelectorAll('.torrentdetails a')].at(-1);
  nativeToggle.addEventListener('click', event => {
    event.preventDefault();
    fileList.classList.toggle('hidden');
  });
  assert.equal(summary.previousElementSibling, doc.querySelector('#tag_container'));
  assert.equal(summary.firstElementChild.textContent, 'File list');
  assert.equal(summary.open, false);
  assert.ok(table.hasAttribute('data-ep-detail-original-hidden'));
  assert.ok(table.previousElementSibling.hasAttribute('data-ep-detail-original-hidden'));
  assert.equal(editions[0].open, false);
  assert.equal(current.firstElementChild.textContent, '2160p');
  assert.match(currentFiles.textContent, /Moonlit-Coast-2160p-Original-Field-Recording\.mp4/);
  assert.equal(fileList.querySelector('table'), null);
  assert.equal(currentFiles.closest('.hidden'), null);
  summary.open = true;
  assert.ok(details.contains(nativeToggle));
  details.classList.add('hidden');
  assert.ok(summary.contains(currentFiles));
  details.classList.remove('hidden');
  app.controls.get('reformatDetailPages').click();
  assert.equal(doc.querySelector('.epc-detail-files'), null);
  assert.equal(table.hasAttribute('data-ep-detail-original-hidden'), false);
  assert.equal(fileList.parentElement, nativeToggle.closest('td'));
  assert.equal(fileList.querySelector('table'), currentFiles);
  nativeToggle.click();
  assert.equal(fileList.classList.contains('hidden'), false);
  assert.equal(doc.querySelector('#files_41').classList.contains('hidden'), true);
  assert.deepEqual(requests, []);
});

test('a listing ID can differ from its single native file list ID', async t => {
  const { doc } = await openDetail(t, { enabled: true, path: '/torrents.php?id=1166865',
    html: detailFixtureHTML({ editions: [[42, '2160p']] }) });
  const summary = doc.querySelector('.epc-detail-files');
  assert.match(summary.querySelector('.epc-detail-file-table').textContent, /Moonlit-Coast-2160p-Original-Field-Recording\.mp4/);
  assert.equal(doc.getElementById('files_42').querySelector('table'), null);
  assert.equal(summary.querySelector('details'), null);
});

test('an opted-in detail layout requires both the detail URL and recognizable native panels', async t => {
  const fixtures = [
    { html: fixtureHTML() },
    { path: '/torrents.php?action=advanced&id=42' },
    { path: '/torrents.php?id=42&id=41' }
  ];
  for (const options of fixtures) {
    const { app, doc } = await openDetail(t, { enabled: true, ...options });
    assert.equal(doc.querySelector('[data-ep-detail-layout],.epc-detail-preview'), null);
    assert.ok(app.controls.get('reformatDetailPages').closest('.epc-panel,[hidden]'));
  }
  const { doc } = await openDetail(t, { enabled: true, path: '/torrents.php?action=view&id=42' });
  assert.ok(doc.querySelector('[data-ep-detail-layout] > .epc-detail-preview'));
});
