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

test('section navigation and older template graphics stay in the original description', async t => {
  const cdn = 'https://hamsterimg.net/images/2017/06/30/';
  const html = detailFixtureHTML().replace(/<a [^>]*id="preview-link"[\s\S]*?(?=<a id="reveal-example")/,
    `<a id="nav" href="#screens"><img src="${cdn}nav-screens.png"></a>
    <img id="logo" src="${cdn}s7s-artwork-black66f39.png" width="980" height="504">
    <img id="icon" src="${cdn}header-icon27e75.th.png">
    <img id="label" src="${cdn}screens-s7s.png">
    <img id="photo" src="${cdn}coastal-panorama.png" width="1800" height="240">
    <a id="photo-link" href="#screens"><img id="linked-preview" src="${cdn}coast.webp"></a>
    <img id="animation" src="${cdn}preview.mp4.gif" width="360" height="203">
    <div id="screens"><img id="sheet" src="${cdn}contact-sheet.jpg" width="1024" height="3124"></div>`);
  const { app, doc } = await openDetail(t, { enabled: true, html, path: '/torrents.php?id=736569' });
  const gallery = doc.querySelector('.epc-detail-preview-images');
  const original = doc.querySelector('#descbox');
  assert.deepEqual([...gallery.querySelectorAll('img')].map(img => img.id), ['', 'photo', 'linked-preview', 'animation', 'sheet']);
  assert.equal(original.querySelector('#nav').getAttribute('href'), '#screens');
  assert.equal(original.querySelectorAll('#logo, #icon, #label').length, 3);
  assert.ok(gallery.querySelector('#photo-link'));
  app.controls.get('reformatDetailPages').click();
  assert.ok(original.querySelector('#screens #sheet'));
  assert.equal(original.querySelectorAll('#nav, #logo, #icon, #label').length, 4);
});

test('collage promotions and legacy section art stay out of preview galleries', async t => {
  const cdn = 'https://hamsterimg.net/images/';
  const html = detailFixtureHTML().replace(/<a [^>]*id="preview-link"[\s\S]*?(?=<a id="reveal-example")/,
    `<a id="collage-logo" href="/collage?id=864"><img src="${cdn}2016/02/09/PET-18-LOGO.png" width="480" height="159"></a>
    <img id="description-label" src="${cdn}2015/10/02/Description.png">
    <img id="screens-label" src="${cdn}2015/10/02/Screens.png">
    <img id="sheet" src="${cdn}2016/10/14/contact-sheet.jpg" width="1024" height="2934">
    <a id="collage-card" href="https://empornium.sx/collages.php?id=12"><img src="${cdn}fi/A/5/collection-card.jpg"></a>
    <a id="pretty-collage-card" href="/collage/8"><img src="${cdn}collection-card.jpg"></a>
    <img id="banner" src="${cdn}2015/08/31/aerobanner.0537023001441002133.gif">
    <a href="https://example.test/collage/8"><img id="external" src="${cdn}another-preview.jpg"></a>
    <img id="png" src="${cdn}2026/11/20/Screens.png" width="900" height="60">`);
  const { app, doc } = await openDetail(t, { enabled: true, html, path: '/torrents.php?id=375894' });
  const gallery = doc.querySelector('.epc-detail-preview-images');
  const original = doc.querySelector('#descbox');
  assert.deepEqual([...gallery.querySelectorAll('img')].map(img => img.id), ['', 'sheet', 'external', 'png']);
  assert.equal(original.querySelectorAll('#collage-logo, #collage-card, #pretty-collage-card, #description-label, #screens-label, #banner').length, 6);
  app.controls.get('reformatDetailPages').click();
  assert.equal(original.querySelector('#collage-logo').getAttribute('href'), '/collage?id=864');
  assert.ok(original.querySelector('#collage-logo img'));
  assert.ok(original.querySelector('#collage-card img'));
  assert.ok(original.querySelector('#sheet'));
});

test('recognizes metadata icon rows and matching section header sets on new listings', async t => {
  const cdn = 'https://hamsterimg.net/images/';
  const html = detailFixtureHTML().replace(/<a [^>]*id="preview-link"[\s\S]*?(?=<a id="reveal-example")/,
    `<table><tr>
      <td><div><img id="resolution-icon" src="${cdn}2018/03/16/resolution.png">1920 × 1080</div></td>
      <td><div><img id="duration-icon" src="${cdn}2018/03/16/duration.png">12:40</div></td>
      <td><div><img id="size-icon" src="${cdn}2017/05/29/size.png">840 MiB</div></td>
    </tr><tr><td><img id="resolution-photo" src="${cdn}new-upload/resolution.png">Resolution comparison</td></tr></table>
    <img id="description-header" src="${cdn}another-template/Description.png">
    <img id="info-header" src="${cdn}another-template/info.png">
    <img id="screens-header" src="${cdn}another-template/screens.png">
    <img id="screens" src="${cdn}new-upload/Screens.png">
    <img id="signature" src="${cdn}older-template/S7S0123456789abcdef.gif">
    <img id="animated-preview" src="${cdn}new-upload/preview.gif">`);
  const { doc } = await openDetail(t, { enabled: true, html });
  assert.deepEqual([...doc.querySelectorAll('.epc-detail-preview-images img')].map(image => image.id),
    ['', 'resolution-photo', 'screens', 'animated-preview']);
  assert.equal(doc.querySelectorAll('#descbox #resolution-icon, #descbox #duration-icon, #descbox #size-icon').length, 3);
  assert.equal(doc.querySelectorAll('#descbox #description-header, #descbox #info-header, #descbox #screens-header, #descbox #signature').length, 4);
});

test('recognizes filename variants for grouped media badges without mistaking a single role for a group', async t => {
  const cdn = 'https://hamsterimg.net/images/';
  const inlineBadges = ['720p_small71347d5e6545043b', 'codec_hevc', 'mp4_small9dfd7fe55e0fad20', '24_fps_small'];
  const cellBadges = ['ico-format', 'ico-res', 'ico-date', 'ico-length', 'ico-size'];
  const badge = (name, width) => `<img class="fixture-badge" src="${cdn}icons/${name}.png" width="${width}">`;
  const html = detailFixtureHTML().replace(/<a [^>]*id="preview-link"[\s\S]*?(?=<a id="reveal-example")/,
    `<table><tr><td><span>${inlineBadges.map(name => badge(name, 100)).join('')}Format MP4, 24 fps</span>
      <table><tr><td><img id="portrait" src="${cdn}cast-portrait.jpg" width="200">Cast portrait</td></tr></table>
    </td></tr><tr><td><table><tr>
      ${cellBadges.map(name => `<td>${badge(name, 44)}Video details</td>`).join('')}
    </tr></table></td></tr>
    <tr><td><img id="format-preview" src="${cdn}samples/format.png">Format example
      <img id="mp4-preview" src="${cdn}samples/mp4.png"></td></tr></table>
    <img id="animation" src="${cdn}preview.gif"><img id="sheet" src="${cdn}contact-sheet.jpg">`);
  const { doc } = await openDetail(t, { enabled: true, html });
  assert.equal(doc.querySelectorAll('#descbox .fixture-badge').length, 9);
  assert.deepEqual([...doc.querySelectorAll('.epc-detail-preview-images img')].map(image => image.id),
    ['', 'portrait', 'format-preview', 'mp4-preview', 'animation', 'sheet']);
});

test('keeps likely banners accessible below the gallery after their images load', async t => {
  const cdn = 'https://hamsterimg.net/images/';
  const html = detailFixtureHTML().replace(/<a [^>]*id="preview-link"[\s\S]*?(?=<a id="reveal-example")/,
    `<a id="leading-link" href="${cdn}full.png"><img id="leading" src="${cdn}Gemini_Generated_Image_abcdef.md.png"></a>
    <img id="wide" src="${cdn}sunset-panorama.png">
    <img id="sheet" src="${cdn}contact-sheet.jpg">
    <img id="trailing" src="${cdn}image0123456789abcdef.png">`);
  const { app, doc, win } = await openDetail(t, { enabled: true, html });
  const gallery = doc.querySelector('.epc-detail-preview > .epc-detail-preview-images');
  const visibleImages = () => [...gallery.querySelectorAll('img')].map(image => image.id);
  assert.deepEqual(visibleImages(), ['', 'leading', 'wide', 'sheet', 'trailing']);
  const loadImage = (id, naturalWidth, naturalHeight) => {
    const image = doc.getElementById(id);
    Object.defineProperties(image, { naturalWidth: { value: naturalWidth }, naturalHeight: { value: naturalHeight } });
    image.dispatchEvent(new win.Event('load'));
  };
  loadImage('trailing', 672, 83);
  loadImage('leading', 500, 190);
  loadImage('wide', 1800, 140);
  loadImage('sheet', 1024, 2934);
  assert.deepEqual(visibleImages(), ['', 'wide', 'sheet']);
  const other = doc.querySelector('.epc-detail-other-images');
  assert.equal(other.querySelector('summary').textContent, 'Other images');
  assert.equal(other.open, false);
  other.querySelector('summary').click();
  assert.equal(other.open, true);
  assert.deepEqual([...other.querySelectorAll('img')].map(image => image.id), ['leading', 'trailing']);
  assert.equal(other.querySelector('#leading-link').getAttribute('href'), cdn + 'full.png');
  app.controls.get('reformatDetailPages').click();
  assert.equal(doc.querySelector('.epc-detail-other-images'), null);
  assert.deepEqual([...doc.querySelectorAll('#descbox .body img[id]')].slice(0, 4).map(image => image.id),
    ['leading', 'wide', 'sheet', 'trailing']);
});

test('an open image stays navigable when late dimensions identify it as artwork', async t => {
  const html = detailFixtureHTML().replace(/<a [^>]*id="preview-link"[\s\S]*?(?=<a id="reveal-example")/,
    '<img id="late-banner" src="/banner.png"><img id="first-preview" src="/preview-a.jpg">' +
    '<img id="last-preview" src="/preview-b.jpg">');
  const clock = fakeClock();
  const { app, doc, win } = await openDetail(t, { enabled: true, html, Image: clock.env.Image });
  const banner = doc.getElementById('late-banner');
  banner.click();
  assert.equal(app.preview.galleryIndex.textContent, '2 of 4');
  Object.defineProperties(banner, { naturalWidth: { value: 672 }, naturalHeight: { value: 83 } });
  banner.dispatchEvent(new win.Event('load'));
  assert.equal(banner.closest('details'), null);
  assert.equal(app.preview.galleryIndex.textContent, '2 of 4');

  app.preview.element.querySelector('[aria-label="Next image"]').click();
  assert.equal(app.preview.metadata.galleryImage.id, 'first-preview');
  assert.equal(app.preview.galleryIndex.textContent, '2 of 3');
  const other = banner.closest('.epc-detail-other-images');
  assert.ok(other);
  assert.equal(other.open, false);
  app.preview.element.querySelector('[aria-label="Next image"]').click();
  assert.equal(app.preview.metadata.galleryImage.id, 'last-preview');
});

test('small standalone graphics and thin strips move out of the main gallery while previews stay visible', async t => {
  const html = detailFixtureHTML().replace(/<a [^>]*id="preview-link"[\s\S]*?(?=<a id="reveal-example")/,
    '<img id="first-preview" src="/first.jpg"><img id="photo" src="/second.jpg">' +
    '<img id="tiny-icon" src="/detail-decoration.png"><img id="sheet" src="/sheet.png">' +
    '<img id="thin-strip" src="/divider.gif"><img id="wide-preview" src="/wide-panorama.png">' +
    '<a href="/full-scene.jpg"><img id="linked-thumb" src="/tiny.png"></a>' +
    '<img id="host-thumb" src="https://hamsterimg.net/images/garden.th.png">');
  const { app, doc, win } = await openDetail(t, { enabled: true, html });
  for (const [id, naturalWidth, naturalHeight] of [
    ['thin-strip', 720, 100], ['tiny-icon', 50, 51], ['sheet', 900, 2600],
    ['wide-preview', 1500, 108], ['linked-thumb', 54, 42], ['host-thumb', 55, 46]
  ]) {
    const image = doc.getElementById(id);
    Object.defineProperties(image, { naturalWidth: { value: naturalWidth }, naturalHeight: { value: naturalHeight } });
    image.dispatchEvent(new win.Event('load'));
  }
  const ids = selector => [...doc.querySelectorAll(selector)].map(image => image.id);
  assert.deepEqual(ids('.epc-detail-preview > .epc-detail-preview-images img'),
    ['', 'first-preview', 'photo', 'sheet', 'wide-preview', 'linked-thumb', 'host-thumb']);
  assert.deepEqual(ids('.epc-detail-other-images img'), ['tiny-icon', 'thin-strip']);
  assert.equal(doc.querySelector('.epc-detail-other-images').open, false);
  app.controls.get('reformatDetailPages').click();
  assert.equal(doc.querySelectorAll('#descbox #tiny-icon,#descbox #thin-strip').length, 2);
});

test('recognizes thin JPEG separators and compact headings even in the middle of the gallery', async t => {
  const divider = 'https://fapping.empornium.sx/images/2014/02/06/hr.jpg';
  const motto = 'https://hamsterimg.net/images/2015/08/31/oldempmotto.png';
  const header = 'https://fapping.empornium.sx/images/2014/01/16/transinfo.png';
  const html = detailFixtureHTML().replace(/<a [^>]*id="preview-link"[\s\S]*?(?=<a id="reveal-example")/,
    `<img id="first" src="/first.jpg"><img id="second" src="/second.jpg">
    <img id="divider" src="${divider}">
    <a href="${motto}"><img id="motto" src="${motto}"></a>
    <img id="header" src="${header}">
    <a href="/larger.jpg"><img id="linked-thumb" src="/small.png"></a>
    <img id="wide-jpeg" src="/wide.jpg"><img id="sheet" src="/sheet.png">`);
  const { doc, win } = await openDetail(t, { enabled: true, html });
  for (const [id, naturalWidth, naturalHeight] of [
    ['header', 273, 106], ['divider', 801, 2], ['motto', 425, 85], ['linked-thumb', 273, 106],
    ['wide-jpeg', 900, 90], ['sheet', 900, 2600]
  ]) {
    const image = doc.getElementById(id);
    Object.defineProperties(image, { naturalWidth: { value: naturalWidth }, naturalHeight: { value: naturalHeight } });
    image.dispatchEvent(new win.Event('load'));
  }
  const ids = selector => [...doc.querySelectorAll(selector)].map(image => image.id);
  assert.deepEqual(ids('.epc-detail-other-images img'), ['divider', 'motto', 'header']);
  assert.deepEqual(ids('.epc-detail-preview > .epc-detail-preview-images img'),
    ['', 'first', 'second', 'linked-thumb', 'wide-jpeg', 'sheet']);
});

test('moves standalone decoration into Other images when the cover is the only other gallery image', async t => {
  const html = detailFixtureHTML().replace(/<a [^>]*id="preview-link"[\s\S]*?(?=<a id="reveal-example")/,
    '<img id="divider" src="/horizontal-line.jpg">');
  const { doc, win } = await openDetail(t, { enabled: true, html });
  const divider = doc.getElementById('divider');
  Object.defineProperties(divider, { naturalWidth: { value: 801 }, naturalHeight: { value: 2 } });
  divider.dispatchEvent(new win.Event('load'));
  assert.equal(divider.closest('details')?.classList.contains('epc-detail-other-images'), true);
  assert.equal(doc.querySelectorAll('.epc-detail-preview > .epc-detail-preview-images img').length, 1);
});

test('finds consecutive headers after a duplicate cover and keeps real animated previews', async t => {
  const cases = [
    {
      media: '<img src="/coast-cover.svg">' +
        '<img id="first" src="/aK3bc.png" width="350"><img id="second" src="/xe7P0.png" width="350">' +
        '<img id="preview" src="/scene.jpg"><img id="sheet" src="/sheet.jpg">',
      sizes: [['second', 375, 137], ['first', 386, 135], ['preview', 1920, 1080], ['sheet', 1290, 2004]],
      main: ['', 'preview', 'sheet']
    },
    {
      media: '<img id="first" src="/uploader.gif" width="300"><p><img id="second" src="/studio.png">Description</p>' +
        '<img id="preview" src="/recording.mp4.gif" width="320"><img id="panorama" src="/coastal-panorama.png" width="350">' +
        '<img src="/uploader.gif" width="175">',
      sizes: [['second', 215, 80], ['first', 524, 144], ['preview', 360, 140], ['panorama', 410, 182]],
      main: ['', 'preview', 'panorama']
    }
  ];
  for (const { media, sizes, main } of cases) {
    const html = detailFixtureHTML().replace(/<a [^>]*id="preview-link"[\s\S]*?(?=<a id="reveal-example")/, media);
    const { app, doc, win } = await openDetail(t, { enabled: true, html });
    for (const [id, naturalWidth, naturalHeight] of sizes) {
      const image = doc.getElementById(id);
      Object.defineProperties(image, { naturalWidth: { value: naturalWidth }, naturalHeight: { value: naturalHeight } });
      image.dispatchEvent(new win.Event('load'));
    }
    const ids = selector => [...doc.querySelectorAll(selector)].map(image => image.id);
    assert.deepEqual(ids('.epc-detail-preview > .epc-detail-preview-images img'), main);
    assert.deepEqual(ids('.epc-detail-other-images img'), ['first', 'second']);
    assert.equal(doc.querySelector('.epc-detail-other-images').open, false);
    app.controls.get('reformatDetailPages').click();
    assert.ok(doc.querySelector('#descbox #first'));
    assert.ok(doc.querySelector('#descbox #second'));
    assert.equal(doc.querySelector('.epc-detail-other-images'), null);
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

test('different originals that share a thumbnail each remain in the detail gallery', async t => {
  const html = detailFixtureHTML().replace(/<a [^>]*id="preview-link"[\s\S]*?(?=<a id="reveal-example")/,
    '<a id="first-original" href="/first.jpg"><img src="/shared-thumb.jpg"></a>' +
    '<a id="second-original" href="/second.jpg"><img src="/shared-thumb.jpg"></a>' +
    '<a href="/first.jpg"><img src="/different-thumb.jpg"></a>');
  const clock = fakeClock();
  const { app, doc, win } = await openDetail(t, { enabled: true, html, Image: clock.env.Image });
  const gallery = doc.querySelector('.epc-detail-preview > .epc-detail-preview-images');
  const links = [...gallery.querySelectorAll('a')];
  assert.deepEqual(links.map(link => link.getAttribute('href')), ['/first.jpg', '/second.jpg']);
  for (const link of links) Object.defineProperty(link.querySelector('img'), 'naturalWidth', { value: 240 });
  links[0].click();
  await until(() => clock.images.some(image => image.src.endsWith('/first.jpg')), 'First original request');
  clock.images.find(image => image.src.endsWith('/first.jpg')).succeed();
  assert.ok(app.preview.image.src.endsWith('/first.jpg'));

  app.preview.element.querySelector('[aria-label="Next image"]').click();
  assert.equal(app.preview.galleryIndex.textContent, '3 of 3');
  assert.ok(app.preview.image.src.endsWith('/shared-thumb.jpg'));
  await until(() => clock.images.some(image => image.src.endsWith('/second.jpg')), 'Second original request');
  clock.images.find(image => image.src.endsWith('/second.jpg')).succeed();
  await afterFrames(win);
  assert.ok(app.preview.image.src.endsWith('/second.jpg'));
  app.controls.get('reformatDetailPages').click();
  assert.equal(doc.querySelectorAll('#descbox a[href="/first.jpg"], #descbox a[href="/second.jpg"]').length, 3);
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

test('an arriving original preserves the contact sheet zoom and pan point', async t => {
  const clock = fakeClock();
  const html = detailFixtureHTML().replace('href="#panorama"', 'href="/full-sheet.jpg"');
  const { app, doc, win, errors } = await openDetail(t, { enabled: true, html, Image: clock.env.Image });
  const link = doc.querySelector('#preview-link');
  Object.defineProperty(link.querySelector('img'), 'naturalWidth', { value: 240 });
  const viewer = app.preview;
  link.click();
  await afterFrames(win);
  const frame = viewer.frame;
  Object.defineProperties(frame, { clientWidth: { value: 550 }, clientHeight: { value: 480 } });
  frame.style.maxHeight = '480px';
  frame.getBoundingClientRect = () => ({ left: 0, top: 0, width: 550, height: 480 });
  const sizeImage = (image, width, height) => {
    Object.defineProperties(image, { naturalWidth: { value: width }, naturalHeight: { value: height } });
    image.getBoundingClientRect = () => {
      const fitWidth = Math.min(width, frame.clientWidth, frame.clientHeight * width / height);
      const displayedWidth = parseFloat(frame.style.getPropertyValue('--epc-gallery-image-width')) || fitWidth;
      return { left: Math.max(0, (frame.clientWidth - displayedWidth) / 2) - frame.scrollLeft,
        top: -frame.scrollTop, width: displayedWidth, height: displayedWidth * height / width };
    };
  };
  sizeImage(viewer.image, 240, 600);
  viewer.layoutGalleryZoom();
  viewer.galleryZoomIn.click();
  frame.scrollTop = 144;
  const before = viewer.image.getBoundingClientRect();
  const original = doc.createElement('img');
  original.src = '/full-sheet.jpg';
  sizeImage(original, 1800, 4500);
  viewer.displayLoaded({ image: original, actualURL: original.src }, viewer.version, () => {});
  assert.equal(viewer.image, original);
  assert.ok(frame.hasAttribute('data-ep-magnified'));
  assert.ok(Math.abs(original.getBoundingClientRect().width - before.width) < 1);
  assert.ok(Math.abs(frame.scrollTop - 144) < 1);
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('the detail lightbox navigates the current gallery and pans a magnified contact sheet', async t => {
  const clock = fakeClock();
  const html = detailFixtureHTML().replace('href="#panorama"', 'href="/coast-original.jpg"')
    .replace('<img id="description-divider"', '<a id="large-sheet" href="/full-sheet.jpg"><img src="/sheet-thumb.jpg" alt="Contact sheet"></a><img id="description-divider"');
  const storage = memoryStorage({ 'ep.settings': { reformatDetailPages: true, recoverImages: false, persistentImages: false } });
  const { app, doc, win } = await openDetail(t, { html, storage, Image: clock.env.Image });
  const viewer = app.preview;
  const sheet = doc.querySelector('#large-sheet');
  sheet.querySelector('img').alt = 'https://example.test/images/a-very-long-contact-sheet-source.jpg';
  sheet.click();
  assert.equal(viewer.galleryControls.hidden, false);
  assert.equal(viewer.galleryIndex.textContent, '3 of 4');
  assert.equal(viewer.title.textContent, 'Image gallery');
  assert.equal(viewer.galleryControls.nextElementSibling, viewer.frame);
  await until(() => clock.images.some(image => image.src.endsWith('/full-sheet.jpg')), 'Full contact sheet request');
  clock.images.find(image => image.src.endsWith('/full-sheet.jpg')).succeed(1800, 3600);
  await afterFrames(win);
  Object.defineProperty(viewer.frame, 'clientWidth', { value: 724 });
  Object.defineProperties(viewer.image, { naturalWidth: { value: 1800 }, naturalHeight: { value: 3600 } });
  viewer.layoutGalleryZoom();
  assert.equal(viewer.galleryFit.textContent, 'Actual size');
  viewer.galleryFit.click();
  assert.equal(viewer.frame.getAttribute('data-ep-magnified'), '');
  assert.equal(viewer.frame.style.getPropertyValue('--epc-gallery-image-width'), '1800px');
  assert.equal(viewer.galleryFit.textContent, 'Fit');

  const wheel = () => new win.WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
  const pan = wheel();
  viewer.frame.dispatchEvent(pan);
  assert.equal(pan.defaultPrevented, false);
  assert.equal(viewer.galleryIndex.textContent, '3 of 4');
  const pointer = (target, type, x, y, pointerType) => {
    const event = new win.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: pointerType } });
    target.dispatchEvent(event);
  };
  viewer.frame.scrollLeft = 300;
  viewer.frame.scrollTop = 504;
  pointer(viewer.image, 'pointerdown', 120, 150, 'mouse');
  pointer(viewer.frame, 'pointermove', 90, 100, 'mouse');
  assert.ok(viewer.frame.hasAttribute('data-ep-panning'));
  assert.equal(viewer.frame.scrollLeft, 330);
  assert.equal(viewer.frame.scrollTop, 554);
  pointer(viewer.frame, 'pointerup', 90, 100, 'mouse');
  assert.equal(viewer.frame.hasAttribute('data-ep-panning'), false);
  viewer.image.click();
  assert.ok(viewer.frame.hasAttribute('data-ep-magnified'));
  viewer.galleryFit.click();
  assert.equal(viewer.frame.hasAttribute('data-ep-magnified'), false);
  assert.equal(viewer.frame.scrollTop, 0);
  const advance = wheel();
  viewer.frame.dispatchEvent(advance);
  assert.equal(advance.defaultPrevented, true);
  assert.equal(viewer.galleryIndex.textContent, '4 of 4');
  viewer.element.querySelector('[aria-label="Next image"]').click();
  assert.equal(viewer.galleryIndex.textContent, '1 of 4');
  viewer.element.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  assert.equal(viewer.galleryIndex.textContent, '4 of 4');
  pointer(viewer.frame, 'pointerdown', 20, 20, 'touch');
  pointer(viewer.frame, 'pointerup', 90, 20, 'touch');
  assert.equal(viewer.galleryIndex.textContent, '3 of 4');
  app.settings.keyboardShortcuts = false;
  viewer.element.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(viewer.open, false);
  assert.equal(doc.activeElement, sheet);
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
