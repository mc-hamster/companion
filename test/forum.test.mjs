import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { companionForumPage, isNSEPage } from '../src/core.mjs';
import { formatForumQuote, forumLiteralText, forumQuoteCredit, forumTableLayout, parseForumBBCode, writeForumBBCode } from '../src/forum-bbcode.mjs';
import { readForumVisualSource } from '../src/forum-editor.mjs';
import { domFixture, memoryStorage, until } from './helpers.mjs';
import { forumFixtureHTML } from './forum-fixture.mjs';

const bundle = await readFile(new URL('../dist/EmporniumCompanion.user.js', import.meta.url), 'utf8');
const site = 'https://www.empornium.sx';
const draftKey = 'ep.forum.draft.' + site + '.7.42';

function storedDraft(fixture) {
  return fixture.storage.get(fixture.win.sessionStorage.getItem(draftKey), null);
}

async function start(path, { storage = memoryStorage(), account = 7, fetch, session = {}, darkSystem = false } = {}) {
  const url = new URL(path, site);
  const fixture = domFixture(forumFixtureHTML(url, { account }), url.href);
  const { win, doc } = fixture;
  const menu = new Map();
  for (const [key, value] of Object.entries(session)) win.sessionStorage.setItem(key, value);
  Object.assign(win, {
    GM_getValue: storage.get, GM_setValue: storage.set, GM_listValues: storage.list, GM_deleteValue: storage.delete,
    GM_addStyle: css => doc.head.append(Object.assign(doc.createElement('style'), { textContent: css })),
    GM_registerMenuCommand: (name, action) => menu.set(name, action),
    matchMedia: () => ({ matches: darkSystem }),
    fetch: fetch || (() => assert.fail('Forum should not fetch before a user action'))
  });
  win.eval(bundle);
  await until(() => doc.readyState === 'complete');
  return { ...fixture, storage, menu };
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
    const toolbar = f.doc.querySelector('.epc-forum-control > .epc-toolbar');
    const toggle = toolbar.querySelector('.epc-toolbar-main .epc-toolbar-switch input');
    assert.equal(toggle.labels[0].textContent, 'Enable in forum');
    assert.equal(toggle.getAttribute('role'), 'switch');
    assert.equal(toggle.checked, false);
    const navigation = toolbar.querySelector('.epc-toolbar-context [aria-label="Forum navigation"]');
    assert.deepEqual([...navigation.querySelectorAll('a')].map(link => link.textContent), ['Boards', 'Unread', 'Subscriptions', 'Search']);
    assert.equal(navigation.closest('[hidden]'), null);
    const search = [...navigation.querySelectorAll('a')].find(a => a.textContent === 'Search');
    assert.equal(new URL(search.href).searchParams.get('forums[]'), '23');
    assert.equal(f.doc.querySelector('.epc-forum-jump'), null);
    toggle.click();
    assert.equal(f.storage.get('ep.forum.reader'), true);
    const jumps = [...f.doc.querySelectorAll('.epc-forum-jump')];
    assert.deepEqual(jumps.map(link => [link.lastElementChild.textContent, link.hash]), [
      ['Continue', '#post12'], ['Latest', '#post13']
    ]);
    assert.equal(f.doc.querySelector('.epc-forum-subject').textContent, 'Photo uploads stall on large files');
    assert.deepEqual([...f.doc.querySelectorAll('.epc-forum-count-heading')].map(cell => cell.textContent), ['Posts', 'Views']);
    toggle.click();
    assert.equal(navigation.closest('[hidden]'), null);
    assert.equal(f.doc.querySelector('.epc-forum-jump'), null);
    assert.match(f.doc.querySelector('.forum_list strong').textContent, /stall…$/);
    assert.ok(f.doc.querySelector('.epc-workspace .epc-toolbar'));
    assert.equal(f.doc.querySelector('.epc-engine'), null);
    assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});

test('Companion settings persist theme, text size, and long-quote folding', async () => {
  const storage = memoryStorage();
  const initial = await start('/forum/thread/42?theme=site-light', { storage });
  try {
    const { doc, win } = initial;
    const control = doc.querySelector('.epc-forum-control');
    const trigger = control.querySelector('.epc-toolbar .epc-navigation button[data-pane="settings"]');
    const panel = control.querySelector(':scope > .epc-panel');
    trigger.click();
    assert.equal(panel.hidden, false);
    assert.equal(doc.querySelector('#content > h2').nextElementSibling, control);
    const settings = control.querySelector('[aria-label="Forum settings"]');
    const [theme, size] = settings.querySelectorAll('select');
    theme.value = 'plum';
    theme.dispatchEvent(new win.Event('change', { bubbles: true }));
    size.value = 'large';
    size.dispatchEvent(new win.Event('change', { bubbles: true }));
    const collapse = [...settings.querySelectorAll('label')].find(label => label.textContent === 'Collapse long quotes');
    collapse.querySelector('input').click();
    control.querySelector('.epc-forum-toggle').click();
    assert.equal(panel.hidden, false);
    assert.equal(doc.documentElement.dataset.epForumPalette, 'plum');
    assert.equal(doc.documentElement.dataset.epForumTheme, 'dark');
    assert.equal(doc.documentElement.dataset.epForumTextSize, 'large');
    assert.equal(doc.querySelector('.epc-forum-folded-quote').open, true);
  } finally { initial.close(); }

  const restored = await start('/forum/thread/42?theme=site-light', { storage });
  try {
    const { doc } = restored;
    assert.equal(doc.querySelector('.epc-forum-toggle').checked, true);
    assert.equal(doc.documentElement.dataset.epForumPalette, 'plum');
    assert.equal(doc.documentElement.dataset.epForumTextSize, 'large');
    assert.equal(doc.querySelector('.epc-forum-folded-quote').open, true);
    const collapse = [...doc.querySelectorAll('.epc-forum-control .epc-setting')].find(label => label.textContent === 'Collapse long quotes');
    collapse.querySelector('input').click();
    assert.equal(doc.querySelector('.epc-forum-folded-quote').open, false);
  } finally { restored.close(); }
});

test('the shared Settings pane toggles and restores focus on close', async () => {
  const f = await start('/forum/thread/42');
  try {
    const { doc, win } = f;
    const workspace = doc.querySelector('.epc-workspace.epc-forum-control');
    const trigger = workspace.querySelector('.epc-toolbar-main .epc-navigation button[data-pane="settings"]');
    const panel = workspace.querySelector(':scope > .epc-panel');
    const pane = panel.querySelector('.epc-pane[data-pane="settings"]');
    assert.equal(panel.hidden, true);
    assert.equal(trigger.getAttribute('aria-controls'), pane.id);
    trigger.click();
    assert.equal(panel.hidden, false);
    assert.equal(pane.hidden, false);
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    doc.body.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    assert.equal(panel.hidden, false);
    panel.querySelector('.epc-panel-heading button').click();
    assert.equal(panel.hidden, true);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(doc.activeElement, trigger);

    f.menu.get('Companion settings')();
    assert.equal(panel.hidden, false);
    f.storage.set('ep.settings', { keyboardShortcuts: false });
    pane.querySelector('select').focus();
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(panel.hidden, false);
    f.storage.set('ep.settings', { keyboardShortcuts: true });
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(panel.hidden, true);
    assert.equal(doc.activeElement, trigger);
    trigger.click();
    trigger.click();
    assert.equal(panel.hidden, true);
  } finally { f.close(); }
});

test('floating thread controls jump to page positions and retain the draft launcher', async () => {
  const f = await start('/forum/thread/42', { storage: memoryStorage({ 'ep.forum.reader': true }) });
  try {
    const { doc, win } = f;
    const actions = doc.querySelector('[aria-label="Thread controls"]');
    const calls = [];
    win.scrollTo = options => calls.push(['page', options.top, options.behavior]);
    Object.defineProperty(doc.scrollingElement || doc.documentElement, 'scrollHeight', { value: 1800 });
    doc.querySelector('.epc-forum-unread-marker').scrollIntoView = options => calls.push(['unread', options.block, options.behavior]);
    for (const label of ['Jump to top', 'Jump to bottom', 'Jump to first unread post']) {
      actions.querySelector('button[aria-label="' + label + '"]').click();
    }
    assert.deepEqual(calls, [['page', 0, 'smooth'], ['page', 1800, 'smooth'], ['unread', 'start', 'smooth']]);
    const reply = actions.querySelector('.epc-forum-launch');
    reply.click();
    const panel = doc.querySelector('.epc-forum-compose');
    const size = label => [...panel.querySelectorAll('.epc-forum-compose-sizes button')].find(button => button.textContent === label);
    assert.equal(panel.dataset.size, 'compact');
    assert.equal(reply.hidden, true);
    assert.equal(actions.hidden, false);
    changeBody(f, 'An unfinished reply');
    size('Wide').click();
    assert.equal(size('Wide').getAttribute('aria-pressed'), 'true');
    size('Full').click();
    assert.equal(panel.dataset.size, 'full');
    assert.equal(doc.getElementById('wrapper').hasAttribute('inert'), true);
    doc.querySelector('.epc-forum-minimize').click();
    assert.equal(reply.textContent, 'Resume draft');
    assert.equal(reply.hidden, false);
    assert.equal(doc.getElementById('wrapper').hasAttribute('inert'), false);
    reply.click();
    assert.equal(doc.getElementById('quickpost').value, 'An unfinished reply');
    assert.equal(panel.dataset.size, 'full');
    assert.equal(f.storage.get('ep.forum.composerSize'), 'full');
    size('Compact').click();
    assert.equal(doc.getElementById('wrapper').hasAttribute('inert'), false);
  } finally { f.close(); }
});

test('the composer layout overrides the native inline reply form display', async () => {
  const f = await start('/forum/thread/42', { storage: memoryStorage({ 'ep.forum.reader': true }) });
  try {
    const { doc } = f;
    const form = doc.querySelector('.epc-forum-compose > #quickpostform');
    assert.equal(form.style.display, 'block');
    // jsdom cannot resolve an important stylesheet declaration over a normal inline style.
    const layout = [...doc.styleSheets].flatMap(sheet => [...sheet.cssRules])
      .find(rule => rule.selectorText === '.epc-forum-compose > form');
    assert.ok(layout);
    assert.equal(layout.style.getPropertyValue('display'), 'flex');
    assert.equal(layout.style.getPropertyPriority('display'), 'important');
  } finally { f.close(); }
});

test('empty pagination wrappers disappear while links on multipage threads remain available', async () => {
  const storage = memoryStorage({ 'ep.forum.reader': true });
  const single = await start('/forum/thread/42?single-page', { storage });
  const multiple = await start('/forum/thread/42', { storage });
  try {
    const pagers = [...single.doc.querySelectorAll('.linkbox.pager')];
    assert.equal(pagers.length, 2);
    assert.ok(pagers.every(pager => pager.classList.contains('epc-forum-empty-pager')));
    assert.ok(pagers.every(pager => single.win.getComputedStyle(pager).display === 'none'));
    assert.equal(multiple.doc.querySelectorAll('.epc-forum-pager a[href="?page=2"]').length, 3);
    single.doc.querySelector('.epc-forum-toggle').click();
    assert.ok(pagers.every(pager => pager.className === 'linkbox pager'));
  } finally { single.close(); multiple.close(); }
});

test('cancel confirms a draft, clears the current reply and stops a pending quote', async () => {
  let request, deliver;
  const quote = new Promise(resolve => { deliver = resolve; });
  const storage = memoryStorage({ 'ep.forum.reader': true, 'ep.forum.composerSize': 'full' });
  const f = await start('/forum/thread/42', { storage, fetch: (_url, options) => { request = options; return quote; } });
  try {
    const { doc, win } = f;
    const launcher = doc.querySelector('.epc-forum-launch');
    launcher.click();
    const panel = doc.querySelector('.epc-forum-compose');
    const size = label => [...panel.querySelectorAll('.epc-forum-compose-sizes button')].find(button => button.textContent === label);
    const cancel = [...panel.querySelectorAll('button')].find(button => button.textContent === 'Cancel reply');
    const confirm = doc.querySelector('.epc-forum-discard');
    const source = doc.getElementById('quickpost');
    assert.equal(panel.dataset.size, 'full');
    changeBody(f, 'A draft to discard');
    await until(() => storedDraft(f)?.body === 'A draft to discard');
    const savedKey = win.sessionStorage.getItem(draftKey);
    doc.getElementById('subscribebox').checked = true;
    cancel.click();
    assert.equal(confirm.open, true);
    doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(confirm.open, false);
    assert.equal(doc.activeElement, source);
    assert.equal(source.value, 'A draft to discard');

    size('Compact').click();
    doc.querySelector('#post12 .epc-forum-quote').click();
    await until(() => request);
    size('Full').click();
    cancel.click();
    confirm.querySelector('.epc-forum-discard-confirm').click();
    assert.equal(request.signal.aborted, true);
    assert.equal(confirm.open, false);
    assert.equal(panel.hidden, true);
    assert.equal(doc.getElementById('wrapper').hasAttribute('inert'), false);
    assert.equal(doc.activeElement, launcher);
    assert.equal(storedDraft(f), null);
    assert.equal(storage.get(savedKey, null), null);
    assert.equal(doc.getElementById('subscribebox').checked, false);
    deliver({ ok: true, json: async () => 'A late quote' });
    await new Promise(resolve => setImmediate(resolve));
    launcher.click();
    assert.equal(source.value, '');
    cancel.click();
    assert.equal(confirm.open, false);
    assert.equal(panel.hidden, true);
    assert.equal(launcher.textContent, 'Reply');
    assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});

test('the forum follows the site palette even when the system setting differs', async () => {
  const dark = await start('/forum/23?theme=site-dark', { darkSystem: false });
  const light = await start('/forum/23?theme=site-light', { darkSystem: true });
  try {
    assert.equal(dark.doc.documentElement.dataset.epForumTheme, 'dark');
    assert.equal(light.doc.documentElement.dataset.epForumTheme, 'light');
    dark.doc.querySelector('.epc-forum-toggle').click();
    assert.equal(dark.doc.documentElement.dataset.epForumTheme, 'dark');
  } finally { dark.close(); light.close(); }
});

test('awards sit directly beside the avatar and return to the native cell in Classic view', async () => {
  const f = await start('/forum/thread/42', { storage: memoryStorage({ 'ep.forum.reader': true }) });
  try {
    const post = f.doc.getElementById('post12');
    const avatar = post.querySelector('img.epc-forum-author-avatar');
    const awards = avatar.nextElementSibling;
    assert.ok(awards.matches('.epc-forum-awards'));
    assert.equal(awards.querySelector('summary').textContent, 'Awards');
    assert.equal(awards.querySelector('.badges a').textContent, 'Site contributor');
    assert.equal(post.querySelector('.postbody .badges'), null);
    f.doc.querySelector('.epc-forum-toggle').click();
    assert.equal(avatar.closest('td').className, 'avatar');
    assert.ok(post.querySelector('td.avatar .badges a'));
  } finally { f.close(); }
});

test('topics load from a compact menu on demand and post links retain their native destinations', async () => {
  const requests = [];
  const f = await start('/forum/thread/42', {
    storage: memoryStorage({ 'ep.forum.reader': true }),
    fetch: async url => {
      requests.push(url);
      return { ok: true, text: async () => forumFixtureHTML(new URL(url)) };
    }
  });
  try {
    const post = f.doc.getElementById('post12');
    const link = post.querySelector('a.post_id');
    assert.equal(link.textContent, 'Post link');
    assert.equal(link.href, site + '/forum/thread/42?postid=12#post12');
    const topics = f.doc.querySelector('.epc-toolbar-context .epc-forum-nav .epc-forum-topics');
    assert.equal(topics.open, false);
    assert.deepEqual(requests, []);
    topics.open = true;
    await until(() => topics.querySelector('.epc-forum-topics-list a'));
    assert.deepEqual(requests, [site + '/forum/23']);
    f.doc.querySelector('.epc-forum-toggle').click();
    assert.equal(link.textContent, '#12');
    assert.equal(f.doc.querySelector('.epc-forum-topics'), null);
  } finally { f.close(); }
});

test('the image panel keeps URL insertion available in BBCode mode', async () => {
  const f = await start('/forum/thread/42', { storage: memoryStorage({ 'ep.forum.reader': true }) });
  try {
    f.doc.querySelector('.epc-forum-launch').click();
    f.doc.querySelector('.epc-forum-source-images').click();
    const panel = f.doc.querySelector('.epc-forum-media');
    assert.equal(panel.hidden, false);
    assert.match(panel.textContent, /Connect Hamsterimg/);
    assert.match(panel.textContent, /Recent uploads/);
    assert.match(panel.textContent, /My images/);
    [...panel.querySelectorAll('button')].find(button => button.textContent === 'From URL').click();
    panel.querySelector('input[aria-label="Image URL"]').value = 'https://example.test/image.png';
    [...panel.querySelectorAll('button')].find(button => button.textContent === 'Insert image').click();
    assert.equal(f.doc.getElementById('quickpost').value, '[img]https://example.test/image.png[/img]');
    assert.equal(panel.hidden, true);
  } finally { f.close(); }
});

test('script-generated file changes and paste events cannot start an upload', async () => {
  const f = await start('/forum/thread/42', { storage: memoryStorage({
    'ep.forum.reader': true,
    ['ep.forum.hamster.key.' + site + '.7']: 'chv_fixture_demo_key_only_0123456789'
  }) });
  try {
    f.doc.querySelector('.epc-forum-launch').click();
    const image = new f.win.File(['test'], 'test.png', { type: 'image/png' });
    const paste = new f.win.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { files: [image] } });
    f.doc.getElementById('quickpost').dispatchEvent(paste);
    assert.equal(f.doc.querySelector('.epc-forum-media').hidden, true);
    f.doc.querySelector('.epc-forum-source-images').click();
    const picker = f.doc.querySelector('.epc-forum-media input[type="file"]');
    Object.defineProperty(picker, 'files', { value: [image] });
    picker.dispatchEvent(new f.win.Event('change', { bubbles: true }));
    assert.equal(f.doc.querySelector('.epc-forum-upload-queue'), null);
    assert.equal(f.doc.getElementById('quickpost').value, '');
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
  assert.equal(readForumVisualSource('[mediainfo]Keep as BBCode[/mediainfo]'), null);
  assert.equal(readForumVisualSource('[u]Unclosed'), null);
  assert.equal(readForumVisualSource('[url=javascript:bad]An unsafe link[/url]'), null);
});

test('native typography, layout, media, named anchors, and table spacing round-trip in Visual mode', () => {
  for (const source of [
    '[font=Georgia][size=4][color=#13579b]Type[/color][/size][/font] [sup]2[/sup] [sub]i[/sub]',
    '[colour=red]Color alias[/colour]\n[center]Centered[/center]\n[align=justify]Paragraph[/align]\n[bg=#dbe8fa,75%,left]Panel[/bg]',
    '[#=notes]Notes[/#]\n[url=#notes]Jump to notes[/url]\n[url]https://example.test/[/url]',
    '[img=120,80]https://example.test/image.png[/img]\n[video=https://youtu.be/0123456789a]\n[hr]\n[cast] [details] [info] [plot] [screens]',
    '[table=#eff,75%]\n[tr][th] Header [/th][td=50%] [b]Cell[/b] [/td][/tr]\n[tr][td] Row 2 [/td][td] [/td][/tr]\n[/table]\n'
  ]) {
    const doc = readForumVisualSource(source);
    assert.ok(doc, source);
    assert.equal(writeForumBBCode(doc.toJSON()), source);
  }
  assert.ok(readForumVisualSource('[color=red][b]Nested in native order[/b][/color]'));
  assert.equal(readForumVisualSource('[img]javascript:bad[/img]'), null);
  assert.equal(readForumVisualSource('[table][tr][td]First[/td][/tr][tr][/tr][/table]'), null);
});

test('the full native toolbar is immediately available in BBCode and the Visual tools use the site fonts', async () => {
  const f = await start('/forum/thread/42', { storage: memoryStorage({ 'ep.forum.reader': true }) });
  try {
    const { doc } = f;
    const native = doc.querySelector('.epc-forum-source-tools');
    assert.equal(native.open, true);
    assert.equal(doc.getElementById('fixture-bold').tabIndex, 0);
    doc.querySelector('.epc-forum-launch').click();
    changeBody(f, '[*][url=https://example.test/]Linked bullet[/url]');
    doc.querySelector('.epc-forum-modes button').click();
    const bullet = doc.querySelector('.ProseMirror li');
    assert.equal(bullet.textContent, 'Linked bullet');
    assert.equal(f.win.getComputedStyle(bullet).listStylePosition, 'outside');
    const tools = doc.querySelector('.epc-forum-format');
    for (const name of ['sup', 'sub', 'color', 'image', 'video', 'table', 'anchor', 'horizontal_rule', 'bg', 'smilies']) {
      assert.ok(tools.querySelector('[data-format="' + name + '"]'), name);
    }
    assert.deepEqual([...tools.querySelector('select[aria-label="Font"]').options].map(option => option.value),
      ['', 'Georgia', 'Verdana', 'default']);
    doc.querySelector('.epc-forum-toggle').click();
    assert.equal(doc.querySelector('.epc-forum-source-tools'), null);
    assert.equal(doc.getElementById('fixture-bold').hasAttribute('tabindex'), false);
    assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});

test('table and cell options use native BBCode while retaining other table attributes', async () => {
  const f = await start('/forum/thread/42', { storage: memoryStorage({ 'ep.forum.reader': true }) });
  try {
    const { doc, win } = f;
    doc.querySelector('.epc-forum-launch').click();
    changeBody(f, '[table=70%,https://example.test/background.png,center,nopad][tr][th]Heading[/th][td=50%,vab]Cell[/td][/tr][/table]');
    doc.querySelector('.epc-forum-modes button').click();
    assert.equal(doc.querySelector('.epc-forum-table-tools').hidden, false);
    const setInput = (selector, value) => {
      const input = doc.querySelector(selector);
      input.value = value;
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
    };
    const apply = () => doc.querySelector('[data-format="apply-tool"]').click();
    doc.querySelector('[data-format="table-options"]').click();
    doc.querySelector('.epc-forum-color-grid button[aria-label="Mint"]').click();
    setInput('input[aria-label="Width"]', '85%');
    setInput('select[aria-label="Borders"]', 'nball');
    apply();
    doc.querySelector('[data-format="cell-options"]').click();
    doc.querySelector('.epc-forum-color-grid button[aria-label="Sky"]').click();
    apply();
    const result = parseForumBBCode(doc.getElementById('quickpost').value).content[0];
    assert.deepEqual(forumTableLayout(result.attrs.label), {
      values: { width: '85%', alignment: 'center', padding: 'nopad', color: '#8ed8b7', border: 'nball' },
      extra: ['https://example.test/background.png']
    });
    assert.deepEqual(forumTableLayout(result.content[0].content[1].attrs.label).values, {
      width: '50%', vertical: 'vab', color: '#6bbaf0'
    });
    assert.equal(result.content[0].content[0].type, 'table_header');
    assert.equal(doc.querySelector('.ProseMirror table').style.getPropertyValue('--epc-forum-cell-border').trim(), 'transparent');
    assert.equal(doc.querySelector('.ProseMirror td').style.backgroundColor, 'rgb(107, 186, 240)');
    doc.querySelector('[data-format="table-options"]').click();
    assert.ok(doc.querySelector('[aria-label="Recent colors"] [aria-label="Recent #6bbaf0"]'));
  } finally { f.close(); }
});

test('Visual loads native smilie image markup and inserts its BBCode', async () => {
  const pages = [];
  const f = await start('/forum/thread/42', {
    storage: memoryStorage({ 'ep.forum.reader': true }),
    fetch: async url => {
      const request = new URL(url);
      assert.equal(request.origin, site);
      assert.equal(request.pathname, '/ajax.php');
      assert.equal(request.searchParams.get('action'), 'get_smilies');
      const offset = request.searchParams.get('indexfrom');
      pages.push(offset);
      return { ok: true, text: async () => '<smilies>' + (offset === '0'
        ? '<smiley><bbcode>:smile1:</bbcode><url><![CDATA[<img class="bbcode smiley" src="/static/common/smileys/smile1.gif" alt=":smile1:" />]]></url></smiley>' +
          '<smiley><bbcode>:invalid:</bbcode><url><![CDATA[<img src="javascript:void(0)" />]]></url></smiley>'
        : '<smiley><bbcode>:wave:</bbcode><url>/static/common/smileys/wave.gif</url></smiley>') +
        '<maxsmilies>3</maxsmilies></smilies>' };
    }
  });
  try {
    const { doc } = f;
    doc.querySelector('.epc-forum-launch').click();
    doc.querySelector('.epc-forum-modes button').click();
    doc.querySelector('[data-format="smilies"]').click();
    const first = doc.querySelector('.epc-forum-smiley-grid');
    await until(() => first.querySelector('img'));
    assert.deepEqual([...first.querySelectorAll('img')].map(img => img.src), [site + '/static/common/smileys/smile1.gif']);
    const more = doc.querySelector('[data-format="more-smilies"]');
    assert.equal(more.hidden, false);
    more.click();
    await until(() => first.children.length === 2);
    assert.deepEqual(pages, ['0', '2']);
    assert.equal(more.hidden, true);
    first.querySelector('[aria-label=":smile1:"]').click();
    assert.equal(doc.querySelector('.ProseMirror .epc-forum-editor-smiley').src, site + '/static/common/smileys/smile1.gif');
    assert.equal(doc.getElementById('quickpost').value.trim(), ':smile1:');
    const reopenPicker = async () => {
      doc.querySelector('.epc-forum-toggle').click();
      doc.querySelector('.epc-forum-toggle').click();
      doc.querySelector('.epc-forum-launch').click();
      doc.querySelector('[data-format="smilies"]').click();
      await until(() => doc.querySelector('.epc-forum-smiley-grid img'));
    };
    await reopenPicker();
    assert.deepEqual(pages, ['0', '2']);
    const key = 'ep.forum.smilies.v1.0';
    const cached = JSON.parse(f.win.localStorage.getItem(key));
    cached.savedAt -= 25 * 60 * 60 * 1000;
    f.win.localStorage.setItem(key, JSON.stringify(cached));
    await reopenPicker();
    assert.deepEqual(pages, ['0', '2', '0']);
    assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});

test('reader and composer preserve post ids, source, native form fields, and a rejected draft', async () => {
  const calls = [];
  const f = await start('/forum/thread/42?postid=11#post11', {
    storage: memoryStorage({ 'ep.forum.reader': true }),
    fetch: async (url, options) => {
      calls.push({ url: new URL(url), options });
      if (url.includes('action=preview')) return { ok: true, text: async () =>
        '<strong>Rendered reply</strong><br><strong>Clue</strong>: <a onclick="BBCode.spoiler(this);">Show</a>' +
        '<blockquote class="hidden spoiler">A clue</blockquote>' };
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
    const advanced = '[mediainfo]Original MediaInfo[/mediainfo]';
    changeBody(f, advanced);
    mode('Visual').click();
    assert.equal(mode('BBCode').getAttribute('aria-pressed'), 'true');
    assert.equal(doc.getElementById('quickpost').value, advanced);
    assert.equal(calls.length, 0);
    mode('Preview').click();
    await until(() => doc.querySelector('iframe').srcdoc.includes('Rendered reply'));
    assert.match(doc.querySelector('iframe').srcdoc, /<details><summary>Clue<\/summary><blockquote class="spoiler">A clue/);
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
    assert.ok(locked.doc.querySelector('[aria-label="Thread controls"] button[aria-label="Jump to top"]'));
    assert.equal(locked.doc.querySelector('.epc-forum-launch'), null);
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
