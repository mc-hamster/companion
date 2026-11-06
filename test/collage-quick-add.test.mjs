import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { domFixture, memoryStorage, rowHTML, until } from './helpers.mjs';

const bundle = await readFile(new URL('../dist/EmporniumCompanion.user.js', import.meta.url), 'utf8');
const origin = 'https://www.empornium.sx';
const torrent = '/torrents.php?id=42';
const form = id => `<div id="addtorrent"><form action="/collage/${id}/add" method="post">
  <input type="hidden" name="token" value="fixture-token"><input name="url"><button>+</button>
</form></div>`;
const page = (content, account = 7, title = 'Fixture') => `<!doctype html><body id="torrents">
  <ul id="userinfo_username"><li><a href="/user.php?id=${account}">Account</a></li></ul>
  <div id="content"><h2>${title}</h2>${content}</div></body>`;
const details = (membership = '', account) => page(
  '<table><tr class="torrentdetails"><td>Torrent details</td></tr></table>' + membership, account);
const member = id => `<table id="personal_collages"><tr class="personal_rows hidden">
  <td><a href="/collage/${id}">Collection</a></td></tr></table>`;
const response = (url, html) => ({ ok: true, url, text: async () => html });

async function open(t, path, html, storage, fetch = async () => { throw new Error('Unexpected request'); }) {
  const f = domFixture(html, origin + path);
  t.after(f.close);
  Object.assign(f.win, {
    GM_getValue: storage.get, GM_setValue: storage.set, GM_deleteValue: storage.delete, GM_listValues: storage.list,
    GM_addStyle() {}, GM_registerMenuCommand() {}, fetch
  });
  f.win.eval(bundle);
  await until(() => f.doc.querySelector('.epc-workspace[data-ep-ready="true"]'), 'Built Companion readiness');
  const tools = f.doc.querySelector('.epc-collage-tools');
  return { ...f, tools, button: tools?.querySelector('button'), select: tools?.querySelector('select'),
    status: f.doc.querySelector('.epc-collage-status') };
}

async function pin(t, id, title, storage) {
  const collage = await open(t, '/collage/' + id, page(form(id), 7, title), storage);
  assert.equal(collage.button.textContent, 'Pin for quick add');
  collage.button.click();
  assert.equal(collage.button.textContent, 'Unpin collage');
  return collage;
}

test('built quick add pins only eligible collages and shows add only on real torrent details', async t => {
  const storage = memoryStorage();
  const collection = await pin(t, 15, 'Collection', storage);
  const locked = await open(t, '/collage/16', page('Locked'), storage);
  const listing = page(`<table class="torrent_table">${rowHTML(42)}</table>`);
  const search = await open(t, '/torrents.php', listing, storage);
  const listWithID = await open(t, torrent, listing, storage);
  const edit = await open(t, torrent + '&action=edit', details(), storage);
  for (const f of [locked, search, listWithID, edit]) assert.equal(f.tools, null);
  const detail = await open(t, torrent, details(), storage);
  assert.equal(detail.button.textContent, 'Add to Collection');
  assert.equal(detail.select.hidden, true);
  const otherAccount = await open(t, torrent, details('', 8), storage);
  assert.equal(otherAccount.tools.hidden, true);
  collection.button.click();
  detail.win.dispatchEvent(new detail.win.Event('focus'));
  assert.equal(detail.tools.hidden, true);
});

test('the destination selector remembers the chosen collage and detects existing membership', async t => {
  const storage = memoryStorage();
  await pin(t, 15, 'Collection', storage);
  await pin(t, 16, 'Second collection', storage);
  let requests = 0;
  const fetch = async () => { requests++; };
  const detail = await open(t, torrent, details(member(16)), storage, fetch);
  assert.equal(detail.select.hidden, false);
  detail.select.value = '16';
  detail.select.dispatchEvent(new detail.win.Event('change'));
  assert.equal(detail.button.textContent, 'Already in Second collection');
  assert.equal(detail.button.disabled, true);
  detail.button.click();
  const next = await open(t, '/torrents.php?id=43', details(), storage, fetch);
  assert.equal(next.button.textContent, 'Add to Second collection');
  assert.equal(requests, 0);
});

test('quick add uses a fresh same-origin form once and reports success only after verifying membership', async t => {
  const storage = memoryStorage();
  await pin(t, 15, 'Collection', storage);
  const requests = [];
  let verify;
  const detail = await open(t, torrent + '&unrelated=value#comments', details(), storage, (url, options) => {
    requests.push({ url, options });
    if (url === origin + '/collage/15') return response(url, page(form(15)));
    if (url === origin + '/collage/15/add') return { type: 'opaqueredirect' };
    return new Promise(resolve => { verify = () => resolve(response(url, details(member(15)))); });
  });
  detail.button.click();
  detail.button.click();
  await until(() => verify, 'Membership verification request');
  assert.equal(detail.button.disabled, true);
  assert.equal(detail.status.textContent, 'Adding to Collection…');
  assert.deepEqual(requests.map(({ url }) => url), [origin + '/collage/15', origin + '/collage/15/add', origin + torrent]);
  const { method, body, credentials, mode, redirect } = requests[1].options;
  assert.equal(method, 'POST');
  assert.equal(body.toString(), new URLSearchParams({ token: 'fixture-token', url: origin + torrent }).toString());
  assert.deepEqual({ credentials, mode, redirect }, { credentials: 'same-origin', mode: 'same-origin', redirect: 'manual' });
  verify();
  await until(() => detail.button.textContent === 'Added to Collection', 'Verified success');
  assert.equal(detail.button.disabled, true);
  assert.equal([...storage.data.values()].some(value => String(value).includes('fixture-token')), false);
});

test('an unconfirmed add checks for membership before a second POST', async t => {
  const storage = memoryStorage();
  await pin(t, 15, 'Collection', storage);
  let posts = 0, checks = 0;
  const detail = await open(t, torrent, details(), storage, (url, options) => {
    if (options.method === 'POST') { posts++; throw new Error('Connection lost'); }
    if (url === origin + '/collage/15') return response(url, page(form(15)));
    if (++checks === 1) return { ok: false };
    return response(url, details(member(15)));
  });
  detail.button.click();
  await until(() => detail.status.textContent.startsWith('Could not confirm'), 'Unconfirmed status');
  detail.button.click();
  await until(() => detail.button.textContent === 'Already in Collection', 'Recovered membership');
  assert.equal(posts, 1);
  assert.equal(checks, 2);
});

test('quick add declines a changed account or an unexpected form destination', async t => {
  const storage = memoryStorage();
  await pin(t, 15, 'Collection', storage);
  let posts = 0;
  for (const html of [page(form(15), 8), page(form(15).replace('/collage/15/add', 'https://other.test/collage/15/add'))]) {
    const detail = await open(t, torrent, details(), storage, (url, options) => {
      if (options.method === 'POST') posts++;
      return response(url, html);
    });
    detail.button.click();
    await until(() => !detail.button.disabled, 'Rejected attempt');
    assert.match(detail.status.textContent, /Could not reach|not accepting/);
  }
  assert.equal(posts, 0);
});
