import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';
import { detailFixtureHTML, domFixture, fixtureHTML, memoryStorage, until } from './helpers.mjs';

async function openDetail(t, { enabled = false, html = detailFixtureHTML(), path = '/torrents.php?id=42' } = {}) {
  const fixture = domFixture(html, 'https://www.empornium.sx' + path);
  const storage = memoryStorage({ 'ep.settings': enabled ? { reformatDetailPages: true } : {} });
  const requests = [];
  const app = createApp(fixture.win, storage, { fetch: (...args) => { requests.push(args); } }).start();
  t.after(() => { app.dispose(); fixture.close(); });
  await until(() => app.root?.dataset.epReady === 'true', 'Companion ready');
  return { ...fixture, app, storage, requests };
}

test('the detail layout is opt-in, applies immediately, and restores native markup when disabled', async t => {
  const { app, doc, storage, requests } = await openDetail(t);
  const root = doc.querySelector('.details');
  const title = root.querySelector('h2');
  const original = ['#details_top', '#descbox', '.spoiler', '#quickpostform', '#bookmarklink_torrent_42']
    .map(selector => ({ selector, node: doc.querySelector(selector), parent: doc.querySelector(selector).parentElement }));
  const composer = doc.querySelector('#quickpostform textarea');
  composer.value = 'An unfinished reply';
  app.openPane('settings');
  const toggle = app.controls.get('reformatDetailPages');
  assert.equal(toggle.checked, false);
  assert.equal(root.hasAttribute('data-ep-detail-layout'), false);
  assert.equal(doc.querySelector('.epc-detail-nav'), null);

  toggle.click();
  await until(() => root.hasAttribute('data-ep-detail-layout'), 'Reformatted layout');
  assert.equal(storage.get('ep.settings').reformatDetailPages, true);
  const nav = root.querySelector('.epc-detail-nav');
  assert.deepEqual([...nav.children].map(link => link.textContent),
    ['Overview', 'Description', 'Torrent info', 'Files', 'Tags', 'Collages', 'Discussion']);
  assert.equal(nav.children[1].hash, '#native-description');
  assert.equal(nav.children[6].hash, '#post100');
  assert.equal(title.id, 'epc-detail-overview');
  assert.equal(doc.querySelectorAll('.epc-detail-nav').length, 1);

  toggle.click();
  await until(() => !root.hasAttribute('data-ep-detail-layout'), 'Native layout');
  assert.equal(storage.get('ep.settings').reformatDetailPages, false);
  assert.equal(doc.querySelector('.epc-detail-nav,[data-ep-detail-target]'), null);
  assert.equal(title.hasAttribute('id'), false);
  assert.equal(title.hasAttribute('tabindex'), false);
  assert.ok(doc.querySelector('#native-description'));
  for (const { selector, node, parent } of original) {
    assert.equal(doc.querySelector(selector), node);
    assert.equal(node.parentElement, parent);
  }
  assert.equal(composer.value, 'An unfinished reply');
  assert.equal(doc.querySelector('.spoiler img').hasAttribute('src'), false);
  assert.deepEqual(requests, []);
});

test('Files opens the matching native list once and points to Show Info when the panel is hidden', async t => {
  const { doc, requests } = await openDetail(t, { enabled: true, html: detailFixtureHTML({ collages: false, comments: false }) });
  const jumps = [...doc.querySelectorAll('.epc-detail-nav a')];
  assert.equal(jumps.some(link => link.textContent === 'Collages'), false);
  const discussion = jumps.find(link => link.textContent === 'Discussion');
  assert.equal(doc.getElementById(discussion.hash.slice(1)).textContent, 'Post reply');
  const files = jumps.find(link => link.textContent === 'Files');
  const details = doc.querySelector('#details_top');
  const fileList = doc.querySelector('#files_42');
  const nativeToggle = fileList.parentElement.querySelector('a');
  let opened = 0;
  nativeToggle.addEventListener('click', event => {
    event.preventDefault();
    fileList.classList.toggle('hidden');
    opened++;
  });
  details.classList.add('hidden');
  files.click();
  assert.equal(doc.activeElement, doc.querySelector('#slide_button'));
  assert.equal(opened, 0);
  details.classList.remove('hidden');
  files.click();
  files.click();
  assert.equal(opened, 1);
  assert.equal(fileList.classList.contains('hidden'), false);
  assert.equal(doc.querySelector('#files_41').classList.contains('hidden'), true);
  assert.equal(files.hash.slice(1), nativeToggle.id);
  assert.deepEqual(requests, []);
});

test('an opted-in detail layout requires both the detail URL and recognizable native panels', async t => {
  const fixtures = [
    { html: fixtureHTML() },
    { path: '/torrents.php?action=advanced&id=42' },
    { path: '/torrents.php?id=42&id=41' }
  ];
  for (const options of fixtures) {
    const { doc } = await openDetail(t, { enabled: true, ...options });
    assert.equal(doc.querySelector('[data-ep-detail-layout],.epc-detail-nav'), null);
  }
  const { doc } = await openDetail(t, { enabled: true, path: '/torrents.php?action=view&id=42' });
  assert.ok(doc.querySelector('[data-ep-detail-layout] > .epc-detail-nav'));
});
