import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detailFixtureHTML, domFixture, memoryStorage, until } from './helpers.mjs';

const bundle = await readFile(new URL('../dist/EmporniumCompanion.user.js', import.meta.url), 'utf8');
const site = 'https://www.empornium.sx';
const inline = '.epc-forum-inline-editor';

async function start(t, { settings = {}, account = true, html = detailFixtureHTML(), path = '/torrents.php?id=42',
  visual = false, session = {}, storageItems = {} } = {}) {
  if (account) html = html.replace('<div id="content">', '<div id="userinfo_username"><a href="/user.php?id=7">Tester</a></div><div id="content">');
  const fixture = domFixture(html, site + path);
  t.after(fixture.close);
  const { win, doc } = fixture;
  const storage = memoryStorage({ 'ep.settings': settings, 'ep.forum.visual': visual, ...storageItems });
  for (const [key, value] of Object.entries(session)) win.sessionStorage.setItem(key, value);
  Object.assign(win, {
    GM_getValue: storage.get, GM_setValue: storage.set, GM_listValues: storage.list, GM_deleteValue: storage.delete,
    GM_addStyle: css => doc.head.appendChild(Object.assign(doc.createElement('style'), { textContent: css })),
    GM_registerMenuCommand() {}
  });
  win.eval(bundle);
  await until(() => doc.querySelector('.epc-workspace[data-ep-ready="true"]'));
  return { ...fixture, storage };
}

const mode = (editor, label) => [...editor.querySelectorAll('.epc-forum-modes button')].find(button => button.textContent === label);

test('torrent replies retain native quoting, preview fields, and submission across detail layouts', async t => {
  const { doc, win, errors } = await start(t);
  const form = doc.getElementById('quickpostform');
  const source = doc.getElementById('quickpost');
  const textArea = doc.getElementById('quickreplytext');
  const editor = form.querySelector(inline);
  const nativeTools = form.querySelector('.bb_holder');
  assert.equal(mode(editor, 'BBCode').getAttribute('aria-pressed'), 'true');
  assert.equal(nativeTools.classList.contains('epc-forum-inline-hidden'), false);
  source.value = '[b]Coastal notes[/b]';
  mode(editor, 'Visual').click();
  assert.equal(editor.querySelector('.ProseMirror strong').textContent, 'Coastal notes');
  assert.equal(nativeTools.classList.contains('epc-forum-inline-hidden'), true);

  // The native quote handler writes the value and focuses the textarea without dispatching input.
  source.value += '\n[quote=Riley,t42,100]The tide was exceptionally low.[/quote]';
  source.focus();
  const quote = editor.querySelector('.ProseMirror blockquote a');
  assert.equal(quote.textContent, 'Riley');
  assert.equal(quote.getAttribute('href'), '/torrents.php?id=42&postid=100#post100');
  assert.equal(doc.activeElement, editor.querySelector('.ProseMirror'));

  form.querySelector('#post_preview').addEventListener('click', () => textArea.classList.toggle('hidden'));
  form.querySelector('#post_preview').click();
  source.value += '\n[quote=Riley,t42,100]A quote added while previewing.[/quote]';
  form.querySelector('#post_preview').click();
  await until(() => editor.querySelectorAll('.ProseMirror blockquote').length === 2);
  doc.querySelector('[data-setting=reformatDetailPages]').click();
  await until(() => doc.querySelector('[data-ep-detail-layout]'));
  assert.equal(form.querySelector(inline), editor);

  let submitted;
  form.addEventListener('submit', event => {
    event.preventDefault();
    submitted = Object.fromEntries(new win.FormData(form));
  });
  form.querySelector('[type=submit]').click();
  assert.deepEqual(submitted, {
    action: 'add_comment', auth: 'fixture-comment-token', groupid: '42', body: source.value
  });
  assert.match(submitted.body, /\[b\]Coastal notes\[\/b\].*A quote added while previewing\./s);
  assert.deepEqual(errors, []);
});

test('native torrent comment edits keep BBCode and the picker result stays with its editor', async t => {
  const picture = 'https://hamsterimg.net/images/field.png';
  const id = '892a44d3-ae62-43dd-802c-af2b8ccb4200';
  const jobKey = 'ep.forum.hamster.request.' + id;
  const { doc, storage, errors } = await start(t, {
    settings: { reformatDetailPages: true }, visual: true,
    session: { 'ep.forum.hamster.torrent.42.edit.100.7': id },
    storageItems: { [jobKey]: { action: 'browse', started: Date.now(), origin: site, account: '7',
      context: 'torrent.42.edit.100', result: { images: [{ href: picture, thumbnail: picture, name: 'Field' }] } } }
  });
  const content = doc.getElementById('content100');
  const bar = doc.getElementById('bar100');
  const original = content.innerHTML;
  bar.innerHTML = '<input type="button" value="Post" onclick="SaveEdit(100)">';
  content.innerHTML = '<div id="editcont100"><textarea id="editbox100" name="body">[b]Coastal notes[/b]</textarea></div>';
  const source = content.querySelector('textarea');
  await until(() => content.querySelector('.epc-forum-editor-image'));
  assert.equal(doc.getElementById('quickpost').value, '');
  assert.equal(storage.get(jobKey, null), null);
  assert.match(source.value, /\[img\]https:\/\/hamsterimg\.net\/images\/field\.png\[\/img\]/);

  mode(content, 'BBCode').click();
  source.value = '[b]Updated coastal notes[/b]';
  mode(content, 'Visual').click();
  assert.equal(content.querySelector('.ProseMirror strong').textContent, 'Updated coastal notes');
  bar.innerHTML = '<input type="button" value="Post" onclick="SaveEdit(100)">';
  let saved;
  bar.firstElementChild.addEventListener('click', () => {
    saved = source.value;
    content.innerHTML = original;
  });
  bar.firstElementChild.click();
  await until(() => !source.classList.contains('epc-forum-inline-hidden'));
  assert.equal(saved, '[b]Updated coastal notes[/b]');
  assert.equal(content.innerHTML, original);
  assert.equal(doc.querySelectorAll(inline).length, 1);
  assert.deepEqual(errors, []);
});

test('torrent comment editors require a signed-in detail page and an eligible native form', async t => {
  for (const options of [
    { account: false },
    { path: '/torrents.php?action=advanced&id=42' },
    { html: detailFixtureHTML().replace('name="action" value="add_comment"', 'name="action" value="unrelated"') },
    { html: detailFixtureHTML().replace('id="quickpost" name="body"', 'id="quickpost" name="body" readonly') }
  ]) {
    const { doc, errors } = await start(t, options);
    assert.equal(doc.querySelector(inline), null);
    assert.deepEqual(errors, []);
  }
});
