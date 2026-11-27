import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HAMSTER_JOB_PREFIX, hamsterAssetURL, hamsterGalleryImage, hamsterKey, hamsterServiceBase,
  readHamsterRequest, uploadHamsterImage
} from '../src/hamster-media.mjs';
import { domFixture, memoryStorage } from './helpers.mjs';

const tracker = 'https://www.empornium.sx';
const service = hamsterServiceBase(new URL(tracker));
const key = 'chv_fixture_demo_key_only_0123456789';

test('Hamsterimg requests are scoped to the originating tracker account and expire', () => {
  const id = '892a44d3-ae62-43dd-802c-af2b8ccb4200';
  const name = HAMSTER_JOB_PREFIX + id;
  const job = { origin: tracker, account: '7', thread: '42', action: 'browse', started: 12000 };
  const storage = memoryStorage({ [name]: job });
  assert.deepEqual(readHamsterRequest(storage, id, service, 12001), job);
  assert.equal(readHamsterRequest(storage, id, service, 4000000), null);
  assert.equal(readHamsterRequest(storage, '../wrong', service, 12001), null);
  storage.set(name, { ...job, origin: 'https://example.test' });
  assert.equal(readHamsterRequest(storage, id, service, 12001), null);
  assert.equal(hamsterKey('chv_example_***'), '');
  assert.equal(hamsterKey(' ' + key + ' '), key);
});

test('Hamsterimg accepts topic, post edit, and torrent comment jobs with valid contexts', () => {
  const id = '892a44d3-ae62-43dd-802c-af2b8ccb4200';
  const name = HAMSTER_JOB_PREFIX + id;
  const job = { origin: tracker, account: '7', action: 'browse', started: 12000 };
  const storage = memoryStorage();
  for (const context of ['topic.23', 'edit.42', 'torrent.42.comment', 'torrent.42.edit.100']) {
    const scoped = { ...job, context };
    storage.set(name, scoped);
    assert.deepEqual(readHamsterRequest(storage, id, service, 12001), scoped);
  }
  for (const scope of [{ context: 'topic.0' }, { context: 'edit.42/other' }, { context: 'topic.23', thread: '42' },
    { context: 'torrent.42.edit' }, { context: 'torrent.42.edit.0' }, { context: 'torrent.0.comment' }]) {
    storage.set(name, { ...job, ...scope });
    assert.equal(readHamsterRequest(storage, id, service, 12001), null);
  }
});

test('Hamsterimg gallery results use the original link and the signed-in owner', () => {
  const f = domFixture('<article data-type="image" data-media="image"></article>', service.href);
  try {
    const tile = f.doc.querySelector('article');
    const profile = new URL('/tester', service);
    const href = service.origin + '/images/field.png';
    const preview = service.origin + '/images/field.th.png';
    const file = { type: 'image', url: href, thumb: { url: preview }, title: 'Field', user: { url: profile.href } };
    tile.setAttribute('data-object', encodeURIComponent(JSON.stringify(file)));
    tile.dataset.privacy = 'private_but_link';
    assert.deepEqual(hamsterGalleryImage(tile, service, profile), { href, thumbnail: preview, name: 'Field' });
    tile.dataset.privacy = 'private';
    assert.equal(hamsterGalleryImage(tile, service, profile), null);
    tile.dataset.privacy = 'public';
    tile.setAttribute('data-object', JSON.stringify({ ...file, user: { url: '/another' } }));
    assert.equal(hamsterGalleryImage(tile, service, profile), null);
    tile.setAttribute('data-object', JSON.stringify({ ...file, user: { url: '/tester?id=another' } }));
    assert.equal(hamsterGalleryImage(tile, service, profile), null);
    assert.equal(hamsterAssetURL('https://hamsterimg.net.example.test/file.png', service), '');
    assert.equal(hamsterAssetURL('https://hamsterimg.net:4443/file.png', service), '');
  } finally { f.close(); }
});

test('an upload sends a file and personal key only to the documented endpoint', async () => {
  const f = domFixture('<main></main>', tracker);
  try {
    const { win } = f;
    const file = new win.File(['fixture image'], 'layout.png', { type: 'image/png' });
    const href = service.origin + '/images/layout.png';
    const upload = responder => uploadHamsterImage({
      win, service, key, file, signal: new win.AbortController().signal, progress: () => {},
      request(details) {
        assert.equal(details.url, service.origin + '/api/1/upload');
        assert.equal(details.method, 'POST');
        assert.deepEqual(details.headers, { 'X-API-Key': key });
        assert.equal(details.data.get('source').name, 'layout.png');
        assert.equal(details.data.has('key'), false);
        assert.equal(details.anonymous, true);
        assert.equal(details.redirect, 'error');
        responder(details);
        return { abort() {} };
      }
    });
    assert.deepEqual(await upload(details => details.onload({ status: 200,
      response: { status_code: 200, image: { type: 'image', url: href } }
    })), { href, thumbnail: href, name: 'layout.png' });
    await assert.rejects(upload(details => details.onload({ status: 403 })), /rejected the key/);
    await assert.rejects(upload(details => details.onload({ status: 200, finalUrl: 'https://example.test/' })), /unexpected upload address/);
  } finally { f.close(); }
});
