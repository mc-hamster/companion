import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { companionForumPage, isNSEPage } from '../src/core.mjs';
import { formatForumQuote, forumLiteralText, forumQuoteCredit, writeForumBBCode } from '../src/forum-bbcode.mjs';
import { readForumVisualSource } from '../src/forum-editor.mjs';
import { domFixture, memoryStorage, until } from './helpers.mjs';
import { forumFixtureHTML } from './forum-fixture.mjs';

const bundle = await readFile(new URL('../dist/EmporniumCompanion.user.js', import.meta.url), 'utf8');
const site = 'https://www.empornium.sx';
const draftKey = 'ep.forum.draft.' + site + '.7.42';

function storedDraft(fixture) {
  return fixture.storage.get(fixture.win.sessionStorage.getItem(draftKey), null);
}

async function start(path, { storage = memoryStorage(), account = 7, fetch, session = {} } = {}) {
  const url = new URL(path, site);
  const fixture = domFixture(forumFixtureHTML(url, { account }), url.href);
  const { win, doc } = fixture;
  for (const [key, value] of Object.entries(session)) win.sessionStorage.setItem(key, value);
  Object.assign(win, {
    GM_getValue: storage.get, GM_setValue: storage.set, GM_listValues: storage.list, GM_deleteValue: storage.delete,
    GM_addStyle: css => doc.head.append(Object.assign(doc.createElement('style'), { textContent: css })),
    GM_registerMenuCommand() {},
    fetch: fetch || (() => assert.fail('Forum should not fetch before a user action'))
  });
  win.eval(bundle);
  await until(() => doc.readyState === 'complete');
  return { ...fixture, storage };
}

function changeBody(fixture, value) {
  const field = fixture.doc.getElementById('quickpost');
  field.value = value;
  field.dispatchEvent(new fixture.win.Event('input', { bubbles: true }));
}

test('forum enhancements are gated to authenticated browsing routes and stay out of the filter engine', async () => {
  for (const path of ['/forum', '/forum/23', '/forum/thread/42?postid=12', '/forum/search', '/forum/23/unread',
    '/userhistory.php?action=subscriptions&page=2']) {
    const url = new URL(path, site);
    assert.ok(companionForumPage(url), path);
    assert.equal(isNSEPage(url.href), false, path);
  }
  for (const path of ['/forum/23/new', '/forum/post/12/get', '/forum/catchup', '/forum/thread/42/reply',
    '/userhistory.php?action=thread_subscribe', '/userhistory.php?action=subscriptions&action=catchup']) {
    assert.equal(companionForumPage(new URL(path, site)), null, path);
  }
  const guest = await start('/forum', { account: 0 });
  try {
    assert.equal(guest.doc.querySelector('.epc-forum-header'), null);
    assert.equal(guest.doc.head.querySelector('style:last-child').textContent.includes('.epc-forum-dock'), false);
  } finally { guest.close(); }
});

test('the board exposes distinct native jumps, scoped search, and full titles when enabled', async () => {
  const f = await start('/forum/23');
  try {
    const toggle = f.doc.querySelector('.epc-forum-toggle');
    assert.equal(toggle.textContent, 'Enable Companion Forum');
    assert.equal(f.doc.querySelector('.epc-forum-jump'), null);
    toggle.click();
    assert.equal(f.storage.get('ep.forum.reader'), true);
    const jumps = [...f.doc.querySelectorAll('.epc-forum-jump')];
    assert.deepEqual(jumps.map(link => [link.lastElementChild.textContent, link.hash]), [
      ['Continue', '#post12'], ['Latest', '#post13']
    ]);
    assert.equal(f.doc.querySelector('.epc-forum-subject').textContent, 'Photo uploads stall on large files');
    const search = [...f.doc.querySelectorAll('.epc-forum-nav a')].find(a => a.textContent === 'Search');
    assert.equal(new URL(search.href).searchParams.get('forums[]'), '23');
    toggle.click();
    assert.equal(f.doc.querySelector('.epc-forum-jump'), null);
    assert.match(f.doc.querySelector('.forum_list strong').textContent, /stall…$/);
    assert.equal(f.doc.querySelector('.epc-workspace'), null);
    assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});

test('Visual round-trips nested attribution, lists, code, spoilers, links, and spacing', () => {
  const source = '[quote=Jordan,f42,13]Start\n[quote=Riley,f42,12][b][i]Nested[/i][/b][/quote]\nEnd[/quote]\n' +
    '\n[*]First\n[*][url=https://example.test/report]Second[/url]\n[spoiler=Details]A detail[/spoiler]\n' +
    '[code=js]\nif (ok) log("[table]");\n[/code]\n' + forumLiteralText('Literal [b] and [/plain]');
  const document = readForumVisualSource(source);
  assert.ok(document);
  assert.equal(writeForumBBCode(document.toJSON()), source);
  assert.deepEqual(forumQuoteCredit('Riley,f42,12'), { author: 'Riley', href: '/forum/thread/42?postid=12#post12' });
  assert.equal(readForumVisualSource('[table][tr][td]Keep as BBCode[/td][/tr][/table]'), null);
  assert.equal(readForumVisualSource('[u]Unclosed'), null);
  assert.equal(readForumVisualSource('[url=javascript:bad]An unsafe link[/url]'), null);
});

test('reader and composer preserve post ids, source, native form fields, and a rejected draft', async () => {
  const calls = [];
  const f = await start('/forum/thread/42?postid=11#post11', {
    storage: memoryStorage({ 'ep.forum.reader': true }),
    fetch: async (url, options) => {
      calls.push({ url: new URL(url), options });
      if (url.includes('action=preview')) return { ok: true, text: async () => '<strong>Rendered reply</strong>' };
      return { ok: false, url, redirected: false };
    }
  });
  try {
    const { doc, win } = f;
    assert.equal(doc.getElementById('post11').closest('details').open, true);
    assert.ok(doc.getElementById('post13').querySelector('.epc-forum-folded-quote'));
    assert.equal(doc.querySelector('.epc-forum-unread-marker').nextElementSibling.id, 'post13');
    const origin = doc.getElementById('quickpostform');
    assert.equal(origin.closest('.epc-forum-compose').hidden, true);
    doc.querySelector('.epc-forum-launch').click();
    const mode = label => [...doc.querySelectorAll('.epc-forum-modes button')].find(button => button.textContent === label);
    changeBody(f, '[b]A formatted reply[/b]');
    mode('Visual').click();
    assert.equal(doc.querySelector('.ProseMirror strong').textContent, 'A formatted reply');
    mode('BBCode').click();
    const advanced = '[table][tr][td]Legacy layout[/td][/tr][/table]';
    changeBody(f, advanced);
    mode('Visual').click();
    assert.equal(mode('BBCode').getAttribute('aria-pressed'), 'true');
    assert.equal(doc.getElementById('quickpost').value, advanced);
    assert.equal(calls.length, 0);
    mode('Preview').click();
    await until(() => doc.querySelector('iframe').srcdoc.includes('Rendered reply'));
    assert.equal(calls[0].options.body.get('body'), advanced);
    assert.equal(doc.querySelector('iframe').getAttribute('sandbox'), '');
    doc.getElementById('subscribebox').checked = true;
    origin.querySelector('[name="merge"]').checked = true;
    origin.dispatchEvent(new win.SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await until(() => doc.querySelector('.epc-forum-compose-status').textContent.includes('confirm'));
    assert.equal(calls[1].options.body.get('token'), 'fixture-token');
    assert.equal(calls[1].options.body.get('subscribe'), '1');
    assert.equal(calls[1].options.body.get('merge'), '1');
    assert.equal(calls[1].options.body.get('body'), advanced);
    assert.equal(storedDraft(f).body, advanced);
    doc.querySelector('.epc-forum-toggle').click();
    assert.equal(doc.getElementById('quickpostform'), origin);
    assert.equal(origin.closest('.epc-forum-dock'), null);
    assert.equal(doc.getElementById('quickpost').value, advanced);
    assert.equal(doc.querySelector('.epc-forum-folded-quote'), null);
    assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});

test('selected quotes are attributed locally and a reload restores only the current account and thread', async () => {
  const storage = memoryStorage({ 'ep.forum.reader': true });
  const f = await start('/forum/thread/42', { storage });
  try {
    const body = f.doc.querySelector('#post12 .post_content');
    const range = f.doc.createRange();
    range.setStart(body.firstChild, 0);
    range.setEnd(body.firstChild, 15);
    f.win.getSelection().addRange(range);
    f.doc.dispatchEvent(new f.win.Event('selectionchange'));
    const action = f.doc.querySelector('.epc-forum-selection');
    await until(() => !action.hidden);
    action.click();
    const source = formatForumQuote('Riley', '42', '12', 'Uploads over 50') + '\n';
    await until(() => f.doc.getElementById('quickpost').value === source);
    f.doc.querySelector('.epc-forum-minimize').click();
    assert.equal(storedDraft(f).body, source);
    assert.equal(f.doc.querySelector('.epc-forum-launch').textContent, 'Resume draft');
  } finally { f.close(); }
  const restores = await start('/forum/thread/42?page=2', { storage });
  const other = await start('/forum/thread/42', { storage, account: 8 });
  const anotherThread = await start('/forum/thread/43', { storage });
  const locked = await start('/forum/thread/42?locked', { storage });
  try {
    assert.match(restores.doc.getElementById('quickpost').value, /Riley,f42,12/);
    assert.equal(other.doc.getElementById('quickpost').value, '');
    assert.equal(anotherThread.doc.getElementById('quickpost').value, '');
    assert.equal(locked.doc.querySelector('.epc-forum-dock'), null);
  } finally { restores.close(); other.close(); anotherThread.close(); locked.close(); }
});

test('two tabs can each save and reload a different draft for the same thread', async () => {
  const storage = memoryStorage({ 'ep.forum.reader': true });
  const first = await start('/forum/thread/42', { storage });
  const second = await start('/forum/thread/42?page=2', { storage });
  let firstSession, secondSession;
  try {
    first.doc.querySelector('.epc-forum-launch').click();
    second.doc.querySelector('.epc-forum-launch').click();
    changeBody(first, 'Reply to the first post');
    changeBody(second, 'Separate reply to a later post');
    first.doc.querySelector('.epc-forum-minimize').click();
    second.doc.querySelector('.epc-forum-minimize').click();
    firstSession = { ...first.win.sessionStorage };
    secondSession = { ...second.win.sessionStorage };
  } finally { first.close(); second.close(); }

  const restoredFirst = await start('/forum/thread/42', { storage, session: firstSession });
  const restoredSecond = await start('/forum/thread/42?page=2', { storage, session: secondSession });
  try {
    assert.equal(restoredFirst.doc.getElementById('quickpost').value, 'Reply to the first post');
    assert.equal(restoredSecond.doc.getElementById('quickpost').value, 'Separate reply to a later post');
    restoredFirst.doc.querySelector('.epc-forum-launch').click();
    changeBody(restoredFirst, '');
    restoredFirst.doc.querySelector('.epc-forum-minimize').click();
    firstSession = { ...restoredFirst.win.sessionStorage };
  } finally { restoredFirst.close(); restoredSecond.close(); }

  const cleared = await start('/forum/thread/42', { storage, session: firstSession });
  const fromNewTab = await start('/forum/thread/42', { storage });
  try {
    assert.equal(cleared.doc.getElementById('quickpost').value, '');
    assert.equal(fromNewTab.doc.getElementById('quickpost').value, 'Separate reply to a later post');
  } finally { cleared.close(); fromNewTab.close(); }
});

test('drafts from the first forum alpha are restored and moved to the tab on save', async () => {
  const storage = memoryStorage({ 'ep.forum.reader': true, [draftKey]: { body: 'Older draft', revision: 'original' } });
  const f = await start('/forum/thread/42', { storage });
  try {
    assert.equal(f.doc.getElementById('quickpost').value, 'Older draft');
    f.doc.querySelector('.epc-forum-launch').click();
    changeBody(f, 'Edited draft');
    f.doc.querySelector('.epc-forum-minimize').click();
    assert.equal(storage.get(draftKey, null), null);
    assert.equal(storedDraft(f).body, 'Edited draft');
  } finally { f.close(); }
});
