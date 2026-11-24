import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { domFixture, fixtureHTML, rowHTML, overlayHTML, memoryStorage, fakeClock, settle, until } from './helpers.mjs';
const bundle = await readFile(new URL('../dist/EmporniumCompanion.user.js', import.meta.url), 'utf8');
test('release metadata and versioned installable match the package and tested canonical artifact', async () => {
  const {version,repository,homepage}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.ok(bundle.split('\n').includes('// @version      '+version));
  assert.equal(await readFile(new URL('../dist/EmporniumCompanion-'+version+'.user.js',import.meta.url),'utf8'),bundle);
  const header=bundle.slice(0,bundle.indexOf('// ==/UserScript==')+'// ==/UserScript=='.length)+'\n';
  assert.equal(await readFile(new URL('../dist/EmporniumCompanion.meta.js',import.meta.url),'utf8'),header);
  const repoURL=repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
  const downloadBase=repoURL.replace('https://github.com/', 'https://raw.githubusercontent.com/')+'/main/dist/';
  assert.ok(header.split('\n').includes('// @updateURL    '+downloadBase+'EmporniumCompanion.meta.js'));
  assert.ok(header.split('\n').includes('// @downloadURL  '+downloadBase+'EmporniumCompanion.user.js'));
  assert.ok(header.split('\n').includes('// @homepageURL  '+homepage));
  assert.ok(header.split('\n').includes('// @supportURL   '+repoURL+'/issues'));
  const readme=await readFile(new URL('../README.md',import.meta.url),'utf8');
  assert.ok(readme.includes('('+downloadBase+'EmporniumCompanion.user.js)'));
});
const branding = /\bnse\w*|noshitempornium/i;
function authoredInterfaceText(doc) {
  const roots = doc.querySelectorAll('.epc-workspace,.epc-preview,#nseRCMBox,.nseToggleHideButton,.epc-notification-control');
  const pieces = [];
  const visit = node => {
    if (node.nodeType === 3) { pieces.push(node.textContent); return; }
    if (node.nodeType !== 1 || node.matches('[data-ep-attribution],script,style')) return;
    for (const name of ['title', 'aria-label', 'aria-description', 'placeholder', 'alt']) {
      if (node.hasAttribute(name)) pieces.push(node.getAttribute(name));
    }
    for (const child of node.childNodes) visit(child);
  };
  for (const root of roots) if (!root.closest('.epc-engine')) visit(root);
  return pieces.join('\n');
}
async function setup(initial = {}, rows = rowHTML(1) + rowHTML(2), extra = '', url, options = {}) {
  const f = domFixture(fixtureHTML(rows, overlayHTML(1, 'https://x.test/a.jpg') + extra), url);
  const storage = memoryStorage({ 'ep.settings': { inlineThumbnails: false }, ...initial }), clock = fakeClock();
  const win = f.win;
  win.GM_getValue = storage.get; win.GM_setValue = storage.set; win.GM_listValues = storage.list;
  const menuCommands = [];
  win.GM_deleteValue = storage.delete; win.GM_registerMenuCommand = name => menuCommands.push(name);
  win.GM_addStyle = css => { const style = win.document.createElement('style'); style.textContent = css; win.document.head.append(style); };
  win.Image = clock.env.Image;
  win.confirm = () => true;
  if (options.touch) win.matchMedia = query => ({ matches: query === '(any-pointer: coarse)', addEventListener() {}, removeEventListener() {} });
  if (options.fetch) win.fetch = options.fetch;
  for (let i = 0; i < (options.injections ?? 1); i++) win.eval(bundle);
  await until(() => f.doc.querySelector('.epc-workspace[data-ep-ready="true"]'), 'Built userscript readiness');
  return { ...f, storage, clock, menuCommands };
}
test('built artifact is self-contained and restricted to Empornium and the Hamsterimg picker', () => {
  assert.doesNotMatch(bundle, /@require|GM_download|eval\(/);
  assert.doesNotMatch(bundle, /epBench|cpu-bench|perf-dashboard/, 'profiling hooks stay in the local fixture');
  const matches = bundle.match(/^\/\/ @match.*$/gm);
  assert.ok(matches.length >= 6);
  assert.ok(matches.every(line => /(?:empornium\.(?:sx|me|is|ph)|emparadise\.rs)/.test(line) ||
    line === '// @match        https://hamsterimg.net/*'));
});
test('userscript metadata uses one pattern per PHP browse page on each explicit mirror', () => {
  const matches = [...bundle.matchAll(/^\/\/ @match\s+(\S+)$/gm)].map(([, pattern]) =>
    new RegExp('^' + pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'));
  for (const domain of ['empornium.sx', 'empornium.me', 'empornium.is', 'empornium.ph', 'emparadise.rs']) {
    for (const prefix of ['', 'www.']) {
      const origin = 'https://' + prefix + domain;
      for (const path of ['/torrents.php', '/torrents.php?id=1', '/torrents.php?action=advanced&page=2',
        '/top10.php?type=torrents', '/bookmarks.php?type=torrents', '/collages.php', '/collage/42?page=2',
        '/requests.php', '/user.php?action=notify', '/user.php?id=10&action=notify',
        '/forum', '/forum/', '/forum?page=2', '/forum/23/unread', '/forum/thread/42?postid=12',
        '/userhistory.php?action=subscriptions', '/userhistory.php?page=2&action=subscriptions']) {
        assert.equal(matches.filter(pattern => pattern.test(origin + path)).length, 1, origin + path);
      }
      for (const path of ['/', '/index.php', '/login.php', '/register.php', '/forums.php', '/user.php?id=10']) {
        assert.ok(!matches.some(pattern => pattern.test(origin + path)), origin + path);
      }
    }
    assert.ok(!matches.some(pattern => pattern.test('https://other.' + domain + '/torrents.php')));
  }
  assert.equal(matches.length, 151);
});
test('an ordinary Hamsterimg page does not start Companion or read its storage', () => {
  const f = domFixture('<main>Image library</main>', 'https://hamsterimg.net/tester');
  try {
    const actions = [];
    f.win.GM_getValue = () => actions.push('read');
    f.win.GM_addStyle = () => actions.push('style');
    f.win.eval(bundle);
    assert.deepEqual(actions, []);
    assert.equal(f.doc.querySelector('.epc-hamster-picker'), null);
  } finally { f.close(); }
});
test('the built script leaves logged-out screens and pages without browsing features untouched', async t => {
  const landing = '<main><h1>Welcome</h1><a href="/">Home</a> <a href="/login.php">Login</a></main>';
  const signIn = '<main id="content"><h2>Sign in</h2><form action="/login.php"><input type="password"></form></main>';
  const pages = [
    ['/', landing], ['/login.php', signIn], ['/forums.php', fixtureHTML()], ['/user.php?id=10', fixtureHTML()],
    ['/user.php?action=edit', fixtureHTML()], ['/torrents.php?id=1&action=edit', fixtureHTML()],
    ['/torrents.php.old', fixtureHTML()], ['/bookmarks.php/backup', fixtureHTML()],
    ['/torrents.php?action=download&id=1', fixtureHTML()], ['/torrents.php?action=advanced&action=download', fixtureHTML()],
    ['/forum/thread/42/reply', fixtureHTML()], ['/forum/post/12/get', fixtureHTML()], ['/forum/catchup/23', fixtureHTML()],
    ['/forum/23/new', fixtureHTML()], ['/userhistory.php?action=thread_subscribe', fixtureHTML()],
    ['/collage/42/manage', fixtureHTML()], ['/top10.php?type=users', fixtureHTML()], ['/bookmarks.php?type=artist', fixtureHTML()],
    ['/torrents.php', landing, true],
    ['/torrents.php?page=2', '<form id="search_form"></form>' + signIn, true]
  ];
  for (const [path, html, beforeBody] of pages) await t.test(path, async () => {
    const f = domFixture(html, 'https://empornium.sx' + path);
    try {
      const body = f.doc.body;
      if (beforeBody) body.remove();
      const effects = [];
      const storage = memoryStorage();
      Object.assign(f.win, {
        GM_getValue(key, fallback) { effects.push('storage read'); return storage.get(key, fallback); },
        GM_setValue: () => effects.push('storage write'), GM_listValues: storage.list, GM_deleteValue: storage.delete,
        GM_addStyle: () => effects.push('stylesheet'), GM_registerMenuCommand: () => effects.push('menu command')
      });
      f.doc.addEventListener('ep-companion:running', () => effects.push('startup event'));
      f.win.eval(bundle);
      if (beforeBody) f.doc.documentElement.append(body);
      await until(() => f.doc.readyState === 'complete');
      assert.deepEqual(effects, []);
      assert.equal(f.doc.querySelector('.epc-workspace'), null);
    } finally { f.close(); }
  });
});
test('duplicate userscript injection renders only one thumbnail per result', async () => {
  const f = await setup({ 'ep.settings': { inlineThumbnails: true } }, rowHTML(1), overlayHTML(1, 'https://x.test/a.jpg', 'https://x.test/a-small.jpg'), undefined, { injections: 2 });
  try {
    const row = f.doc.querySelector('tr.torrent');
    assert.equal(row.querySelectorAll('.epc-thumbnail').length, 1);
    await until(() => row.querySelector('.epc-thumbnail img')?.hasAttribute('src'), 'Thumbnail source');
    assert.equal(f.doc.querySelectorAll('.epc-workspace').length, 1);
  } finally { f.close(); }
});
test('[CACHE-03] persistent image access declares only supported hosts and no wildcard/cookie/download privileges',()=>{
  const connects=bundle.match(/^\/\/ @connect.*$/gm)||[];
  assert.equal(connects.length,7);assert.ok(connects.every(line=>/hamsterimg\.net|hamster\.is|empornium\.(?:sx|me|is|ph)|emparadise\.rs/.test(line)));
  assert.doesNotMatch(bundle,/^\/\/ @connect\s+\*/m);assert.doesNotMatch(bundle,/^\/\/ @grant\s+(?:GM_cookie|GM_download)/m);
  assert.match(bundle,/^\/\/ @grant\s+GM_xmlhttpRequest/m);
});
test('full NSE engine mounts, defaults to empty lists, and keeps companion data on reset', async () => {
  const f = await setup({ 'ep.searches': [] });
  assert.ok(f.doc.getElementById('nseOuter'));
  assert.equal(f.doc.querySelectorAll('.nseToggleIcon').length, 2);
  assert.equal(f.doc.getElementById('nseBlacklistTaglistArea').value, '');
  assert.equal(f.storage.get('nseTaglist'), undefined);
  assert.equal(f.errors.length, 0, f.errors.join('\n'));
  assert.doesNotMatch(f.doc.querySelector('.epc-notice').textContent, /failed/i);
  f.doc.querySelector('.fixture-title').focus(); await settle(10);
  assert.equal(f.win.getComputedStyle(f.doc.querySelector('.epc-preview')).display, 'none');
  f.doc.querySelector('.fixture-title').dispatchEvent(new f.win.MouseEvent('pointerenter'));
  await until(() => !f.doc.querySelector('.epc-preview').hidden, 'Title tooltip readiness');
  assert.equal(f.win.getComputedStyle(f.doc.querySelector('.epc-preview')).display, 'block');
  f.storage.set('nseTaglist', 'sample.tag');
  f.doc.getElementById('nseEraseDataButton').click();
  assert.ok(f.storage.get('ep.settings')); assert.deepEqual(f.storage.get('ep.searches'), []);
  assert.equal(f.storage.get('nseTaglist', null), null); f.close();
});
test('Settings and Filters controls have help on their labels and describe the control', async () => {
  const f = await setup();
  try {
    const panes = f.doc.querySelectorAll('.epc-pane[data-pane=settings],.epc-pane[data-pane=filters]');
    f.doc.querySelector('.epc-navigation [data-pane=settings]').click();
    const controls = [...panes].flatMap(pane => [...pane.querySelectorAll('[data-setting],[data-ep-filter-control]')]);
    assert.ok(controls.length > 80);
    for (const control of controls) {
      const help = control.getAttribute('aria-description');
      assert.ok(help, control.id || control.dataset.setting);
      assert.equal(control.closest('label')?.querySelector('[data-setting-help]')?.dataset.settingHelp, help);
    }
    const label = f.doc.querySelector('[data-setting=thumbnailSize]').closest('label').querySelector('[data-setting-help]');
    const tooltip = f.doc.querySelector('.epc-setting-tooltip');
    label.dispatchEvent(new f.win.MouseEvent('pointerover', { bubbles: true }));
    assert.equal(tooltip.hidden, false);
    assert.equal(tooltip.textContent, label.dataset.settingHelp);
    f.doc.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(tooltip.hidden, true);
    assert.equal(panes[0].closest('.epc-panel').hidden, false);
  } finally { f.close(); }
});
test('tag whitelist overrides blacklist; Hard Pass and individual overrides are retained', async () => {
  const rows = rowHTML(1, { tags: 'blocked allow' }) + rowHTML(2, { tags: 'blocked' }) + rowHTML(3, { tags: 'hard allow' }) + rowHTML(4, { tags: 'blocked' });
  const f = await setup({ nseTaglist: 'blocked', nseWhitelist: 'allow', nseHardPassTaglist: 'hard',
    nseHardPassEnabled: true, nseIndividualUploadHidingWhitelist: ['4'] }, rows);
  const row = id => f.doc.querySelector('[data-fixture-id="' + id + '"]');
  assert.equal(row(1).classList.contains('hidden'), false);
  assert.equal(row(2).classList.contains('hidden'), true);
  assert.equal(row(3).classList.contains('hidden'), true);
  assert.equal(row(4).classList.contains('hidden'), false);
  assert.ok(row(1).querySelector('.nseWhitelistedTag')); assert.equal(f.errors.length, 0); f.close();
});
test('status and uploader filters still handle new rows with image improvements disabled', async () => {
  const f = await setup({ 'ep.settings': { enabled: false }, nseHideUnseededEnabled: true, nseUploaders: 'BlockedUser' },
    rowHTML(1, { uploader: 'BlockedUser' }));
  assert.equal(f.doc.querySelector('tr.torrent').classList.contains('hidden'), true);
  f.doc.querySelector('.torrent_table tbody').insertAdjacentHTML('beforeend', rowHTML(3, { uploader: 'BlockedUser' }));
  await settle(70);
  const row = f.doc.querySelector('[data-fixture-id="3"]');
  assert.equal(row.classList.contains('hidden'), true); assert.equal(row.querySelectorAll('.nseToggleIcon').length, 1);
  assert.equal(new Set([...f.doc.querySelectorAll('.nseToggleIcon')].map(n => n.id)).size, 2);
  assert.equal(f.errors.length, 0, f.errors.join('\n')); f.close();
});
test('right-click management handles current and dynamic tags; Shift preserves native menu', async () => {
  const f = await setup();
  const tag = f.doc.querySelector('.tags a');
  const shifted = new f.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey: true });
  tag.dispatchEvent(shifted); assert.equal(shifted.defaultPrevented, false);
  const event = new f.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  tag.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
  assert.ok(f.doc.getElementById('nseRCMBoxBLAdd'));
  f.doc.getElementById('nseRCMBoxBLAdd').click(); assert.match(f.storage.get('nseTaglist'), /sample\.tag/);
  const titleEvent = new f.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  f.doc.querySelector('.fixture-title').dispatchEvent(titleEvent);
  assert.equal(titleEvent.defaultPrevented, false);
  assert.equal(f.doc.getElementById('nseRCMBox').classList.contains('hidden'), true);
  assert.equal(f.errors.length, 0, f.errors.join('\n')); f.close();
});
test('hostile list text is escaped in settings markup', async () => {
  const value = '</textarea><img id="injected" src=x onerror="bad()">';
  const f = await setup({ nseBlacklistTitles: value });
  assert.equal(f.doc.querySelector('#injected'), null);
  assert.equal(f.doc.getElementById('nseBlacklistTitleListArea').value, value);
  f.close();
});
test('Black Hole removal hides the corresponding collage card before media loading', async () => {
  const f = await setup({ nseHardPassEnabled: true, nseHardPassTaglist: 'hard', nseRemoveHardPassResults: true },
    rowHTML(1, { tags: 'hard' }),
    '<div class="torrent_grid__torrent"><a href="/torrents.php?id=1"><div class="torrent__cover" style="background-image:url(https://x.test/cover.jpg)"></div></a></div>');
  assert.equal(f.doc.querySelector('tr.torrent'), null);
  assert.equal(f.doc.querySelector('.torrent_grid__torrent').classList.contains('epc-filter-hidden'), true);
  assert.equal(f.clock.images.length, 0);
  assert.equal(f.errors.length, 0, f.errors.join('\n')); f.close();
});
test('one workspace owns filters, searches, images, and settings without legacy panels', async () => {
  const f = await setup();
  assert.equal(f.doc.querySelectorAll('.epc-workspace').length, 1);
  assert.equal(f.win.getComputedStyle(f.doc.getElementById('nseOuter')).display, 'none');
  assert.equal(f.doc.querySelector('.epc-engine').hidden, true);
  assert.equal(f.win.getComputedStyle(f.doc.getElementById('nseFloatyBoi')).display, 'none');
  f.doc.querySelector('.epc-navigation button[data-pane="filters"]').click();
  assert.ok(f.doc.querySelector('.epc-pane[data-pane="filters"] #nseBlacklistTaglistArea'));
  assert.equal(f.doc.getElementById('nseBlacklistTaglistArea').closest('.epc-engine'), null);
  assert.ok(f.doc.querySelectorAll('[data-ep-filter-control]').length > 40);
  const blockedTags = f.doc.getElementById('nseBlacklistTaglistArea');
  blockedTags.value = 'new.tag';
  blockedTags.dispatchEvent(new f.win.Event('change', { bubbles: true }));
  await until(() => f.storage.get('nseTaglist') === 'new.tag');
  assert.equal(f.storage.get('nseTaglist'), 'new.tag');
  f.doc.querySelector('.epc-navigation button[data-pane="searches"]').click();
  assert.equal(f.doc.querySelector('.epc-pane[data-pane="searches"]').hidden, false);
  assert.equal(f.doc.querySelector('.epc-pane[data-pane="filters"]').hidden, true);
  assert.equal(f.doc.querySelectorAll('.epc-saved').length, 1);
  assert.ok(f.doc.querySelector('.epc-workspace .epc-saved'));
  assert.equal(f.errors.length, 0, f.errors.join('\n')); f.close();
});
test('show filtered reveals matching rows alongside visible rows and keeps preview eligibility', async () => {
  const f = await setup({ nseTaglist: 'blocked' }, rowHTML(1, { tags: 'blocked' }) + rowHTML(2));
  const button = f.doc.querySelector('[data-ep-reveal]');
  button.click();
  assert.equal(f.doc.querySelectorAll('tr.epc-revealed').length, 1);
  assert.equal(f.doc.querySelectorAll('tr.torrent:not(.hidden)').length, 2);
  assert.equal(button.checked, true);
  button.click(); assert.equal(f.doc.querySelectorAll('tr.epc-revealed').length, 0); f.close();
});

test('Show filtered remembers its switch across reloads and restores filtered and archived rows', async t => {
  const rows = rowHTML(1, { tags: 'blocked' }) + rowHTML(2, { tags: 'hard' }) + rowHTML(3, { tags: 'ordinary' });
  const initial = { nseTaglist: 'blocked', nseHardPassTaglist: 'hard', nseHardPassEnabled: true, nseRemoveHardPassResults: true };
  const copyStorage = (fixture) => JSON.parse(JSON.stringify(Object.fromEntries(fixture.storage.data)));
  const first = await setup(initial, rows);
  t.after(first.close);
  const firstSwitch = first.doc.querySelector('[data-ep-reveal]');
  assert.equal(firstSwitch.checked, false);
  firstSwitch.click();
  assert.equal(first.storage.get('ep.settings').showFilteredResults, true);
  first.doc.querySelector('[data-ep-layout=grid]').click();

  const refreshed = await setup(copyStorage(first), rows);
  t.after(refreshed.close);
  const refreshedSwitch = refreshed.doc.querySelector('[data-ep-reveal]');
  assert.equal(refreshedSwitch.checked, true);
  assert.ok(refreshed.doc.querySelector('.epc-result-grid'));
  assert.equal(refreshed.doc.querySelectorAll('tr.epc-revealed').length, 2);
  assert.ok(refreshed.doc.querySelector('[data-fixture-id="2"]'));
  refreshedSwitch.click();
  assert.equal(refreshed.storage.get('ep.settings').showFilteredResults, false);

  const disabled = await setup(copyStorage(refreshed), rows);
  t.after(disabled.close);
  assert.equal(disabled.doc.querySelector('[data-ep-reveal]').checked, false);
  assert.equal(disabled.doc.querySelectorAll('tr.epc-revealed').length, 0);
  assert.equal(disabled.doc.querySelector('[data-fixture-id="2"]'), null);
});

test('filter review counts only revealable results and identifies the effective rule', async () => {
  const rows = rowHTML(1, { tags: 'blocked' }) +
    rowHTML(2, { tags: 'blocked hard allowed', extra: 'sitewide_leech' }) +
    rowHTML(3, { tags: 'other', extra: 'sitewide_leech' });
  const f = await setup({ nseTaglist: 'blocked', nseWhitelist: 'allowed', nseHardPassTaglist: 'hard',
    nseHardPassEnabled: true, nseRemoveHardPassResults: true, nseIndividualUploadHidingEnabled: true,
    'ep.settings': { inlineThumbnails: false, freeleechView: 'sitewide', conditionalRules: 'HIDE: $TA{other}' } }, rows);
  try {
    const toggle = f.doc.querySelector('[data-ep-reveal]');
    const count = toggle.closest('label').querySelector('.epc-filtered-count');
    assert.equal(count.textContent, '2');
    toggle.click();
    assert.deepEqual([...f.doc.querySelectorAll('.epc-filter-reason')].map(node => node.textContent),
      ['Hard Pass tag · hard', 'Conditional rule 1']);
    const row = f.doc.querySelector('[data-fixture-id="2"]');
    const icon = row.querySelector('.nseToggleIcon');
    assert.equal(icon.getAttribute('aria-label'), 'Always show this result');
    icon.click(); await until(() => count.textContent === '1', 'Override reconciled');
    assert.deepEqual([...f.storage.get('nseIndividualUploadHidingWhitelist')], ['2']);
    assert.equal(row.querySelector('.epc-filter-reason'), null);
    assert.equal(row.classList.contains('hidden'), false);
    const filter = f.doc.querySelector('[data-setting=freeleechView]');
    filter.value = 'all'; filter.dispatchEvent(new f.win.Event('change', { bubbles: true }));
    await until(() => count.textContent === '2', 'View reconciled');
    assert.equal(f.doc.querySelector('[data-fixture-id="1"] .epc-filter-reason').textContent, 'Blocked tag · blocked');
  } finally { f.close(); }
});

test('Filtered only follows the saved switch, Freeleech, and backfilled results in List and Grid', async t => {
  const sitewide = 'sitewide_leech';
  const rows = rowHTML(1, { extra: sitewide }) + rowHTML(2, { tags: 'blocked', extra: sitewide }) +
    rowHTML(3, { tags: 'hard', extra: sitewide }) + rowHTML(4, { extra: sitewide }) + rowHTML(5, { tags: 'blocked' });
  const cards = [1, 2, 3, 4, 5].map(id => '<div class="torrent_grid__torrent" data-card="' + id + '">' +
    '<a href="/torrents.php?id=' + id + '">Cover</a></div>').join('');
  const initial = { 'ep.settings': { inlineThumbnails: false, backfillPages: 1, seenMode: 'hide', freeleechView: 'sitewide' },
    'ep.seen.4': { title: 'Example 4', time: 1 }, nseTaglist: 'blocked', nseHardPassTaglist: 'hard',
    nseHardPassEnabled: true, nseRemoveHardPassResults: true };
  const page = fixtureHTML(rowHTML(6, { extra: sitewide }) + rowHTML(7, { tags: 'blocked', extra: sitewide }))
    .replace(/<a class="pager_next"[^>]*>.*?<\/a>/, '');
  const f = await setup(initial, rows, cards, 'https://www.empornium.sx/torrents.php?page=2', {
    fetch: async url => ({ ok: true, url, text: async () => page })
  });
  t.after(f.close);
  const visibleIDs = (fixture, key = 'fixture-id') => [...fixture.doc.querySelectorAll('[data-' + key + ']')]
    .filter(node => fixture.win.getComputedStyle(node).display !== 'none').map(node => Number(node.getAttribute('data-' + key)));
  const select = (fixture, key, value) => {
    const field = fixture.doc.querySelector('[data-setting=' + key + ']');
    field.value = value;
    field.dispatchEvent(new fixture.win.Event('change', { bubbles: true }));
  };
  const toggle = f.doc.querySelector('[data-ep-reveal]');
  const label = toggle.closest('label');
  assert.deepEqual(visibleIDs(f), [1]);
  assert.equal(f.doc.querySelector('[data-setting=showFilteredMode]').closest('[data-settings-group]').dataset.settingsGroup, 'Browsing');
  select(f, 'showFilteredMode', 'only');
  await until(() => label.textContent.includes('Filtered only'));
  assert.deepEqual(visibleIDs(f), [1]);
  toggle.click();
  assert.deepEqual(visibleIDs(f), [2, 3, 4]);
  assert.deepEqual(visibleIDs(f, 'card'), [2, 3, 4]);
  assert.deepEqual([...f.doc.querySelectorAll('tr .epc-filter-reason')].map(node => node.textContent),
    ['Blocked tag · blocked', 'Hard Pass tag · hard', 'Already seen']);

  f.doc.querySelector('[data-ep-layout=grid]').click();
  f.doc.querySelector('[data-ep-backfill]').click();
  await until(() => f.doc.querySelector('[data-fixture-id="7"]'));
  assert.deepEqual(visibleIDs(f), [2, 3, 4, 7]);
  const saved = JSON.parse(JSON.stringify(Object.fromEntries(f.storage.data)));
  const reopened = await setup(saved, rows, cards);
  t.after(reopened.close);
  assert.equal(reopened.doc.querySelector('[data-ep-reveal]').checked, true);
  assert.deepEqual(visibleIDs(reopened), [2, 3, 4]);

  select(f, 'showFilteredMode', 'inline');
  await until(() => label.textContent.includes('Show filtered'));
  assert.equal(toggle.checked, true);
  assert.deepEqual(visibleIDs(f), [1, 2, 3, 4, 6, 7]);
  select(f, 'showFilteredMode', 'only');
  await until(() => label.textContent.includes('Filtered only'));
  assert.deepEqual(visibleIDs(f), [2, 3, 4, 7]);
  toggle.click();
  assert.deepEqual(visibleIDs(f), [1, 6]);
  assert.equal(f.errors.length, 0, f.errors.join('\n'));
});

test('Filtered only shows an empty state and keeps the switch available to exit', async () => {
  const f = await setup({ 'ep.settings': { showFilteredMode: 'only', showFilteredResults: true },
    nseFloatingToggleButtonEnabled: false });
  try {
    const toggle = f.doc.querySelector('[data-ep-reveal]');
    assert.equal(toggle.closest('label').hidden, false);
    assert.match(f.doc.querySelector('.epc-result-summary').textContent, /No filtered results in this view/);
    toggle.click();
    assert.equal(f.doc.querySelectorAll('tr.epc-filter-hidden').length, 0);
    assert.equal(toggle.closest('label').hidden, true);
  } finally { f.close(); }
});

test('Luminance import previews a merge, preserves existing choices and can undo without reverting searches', async () => {
  const f = await setup({ nseTaglist: 'old.block', nseWhitelist: 'allowed', 'ep.settings': { favoriteTags: 'existing' } });
  try {
    const form = f.doc.querySelector('.epc-luminance-import');
    const button = text => [...form.querySelectorAll('button')].find(node => node.textContent === text);
    form.querySelector('textarea').value = JSON.stringify({ useTag1aTags: true, useTag7aTags: true, useTerribleTags: true,
      useTag7dTags: true, tags: { Tags1a: ['📸 Fern', 'fern'], Tags7a: ['existing', 'review'], terrible: ['block.me', 'allowed'],
        Tags7d: ['metadata'] } });
    button('Preview import').click();
    const select = [...form.querySelectorAll('select')];
    assert.deepEqual(select.map(node => node.value), ['favorite', 'caution', 'skip', 'skip']);
    assert.equal(f.storage.get('nseTaglist'), 'old.block');
    for (const [index, value] of [[2, 'block'], [3, 'collapse']]) {
      select[index].value = value; select[index].dispatchEvent(new f.win.Event('change'));
    }
    assert.match(form.querySelector('[role=status]').textContent, /2 conflicts skipped/);
    button('Import selected tags').click();
    assert.equal(f.storage.get('nseTaglist'), 'old.block block.me');
    assert.equal(f.storage.get('ep.settings').favoriteTags, 'existing fern');
    assert.equal(f.storage.get('ep.settings').cautionTags, 'review');
    assert.equal(f.storage.get('ep.settings').collapsedDetailTags, 'metadata');
    button('Preview import').click();
    assert.equal(button('Import selected tags').disabled, true);
    f.doc.querySelector('input[name=searchtext]').value = 'Botanical notes';
    f.doc.querySelector('.epc-toolbar-utilities button').click();
    assert.equal(f.storage.get('ep.searches').length, 1);
    [...f.doc.querySelectorAll('button')].find(node => node.textContent === 'Undo changes').click();
    assert.equal(f.storage.get('nseTaglist'), 'old.block');
    assert.equal(f.storage.get('ep.settings').favoriteTags, 'existing');
    assert.equal(f.storage.get('ep.searches').length, 1);
  } finally { f.close(); }
});

test('Grid cues reveal matching tags while detail collapse and responsive layout preserve native links', async () => {
  const detail = '<div id="torrent_tags"><ul id="torrent_tags_list"><li><a href="?taglist=fern">fern</a></li>' +
    '<li><a href="?taglist=metadata">metadata</a><button type="button">Vote</button></li></ul></div>';
  const f = await setup({ 'ep.settings': { resultsView: 'grid', inlineThumbnails: false, favoriteTags: 'fern woodland',
    cautionTags: 'orchid', collapsedDetailTags: 'metadata', adaptiveDetailTags: true } },
  rowHTML(1, { tags: 'fern woodland orchid' }), detail);
  try {
    const cue = f.doc.querySelector('.epc-grid-tag-cue');
    assert.deepEqual([...cue.querySelectorAll('.epc-tag-swatch')].map(node => node.textContent), ['Liked', 'Caution']);
    const nativeTags = f.doc.querySelector('tr.torrent .tags');
    assert.equal(f.win.getComputedStyle(nativeTags).display, 'none');
    cue.querySelector('summary').click();
    assert.equal(cue.open, true);
    assert.notEqual(f.win.getComputedStyle(nativeTags).display, 'none');
    const list = f.doc.querySelector('#torrent_tags_list');
    assert.equal(list.hasAttribute('data-ep-adaptive-tags'), true);
    const tag = list.querySelector('[data-ep-low-priority-tag]');
    const link = tag.querySelector('a');
    assert.equal(f.win.getComputedStyle(tag).display, 'none');
    const toggle = f.doc.querySelector('.epc-detail-tag-actions button');
    assert.equal(toggle.textContent, 'Show 1 other tag');
    toggle.click();
    assert.notEqual(f.win.getComputedStyle(tag).display, 'none');
    assert.equal(list.querySelector('[data-ep-low-priority-tag] a'), link);
    assert.equal(tag.querySelector('button').textContent, 'Vote');
    f.doc.querySelector('[data-ep-layout=list]').click();
    assert.equal(f.doc.querySelector('.epc-grid-tag-cue'), null);
  } finally { f.close(); }
});

test('List column choices use heading identity, keep sorting accessible and apply to appended rows', async () => {
  const labels = ['Category', 'Name', 'Files', 'Comments', 'Added', 'Size', 'Snatches', 'Seeds', 'Peers', 'Uploader'];
  const header = '<tr class="colhead">' + labels.map(label => '<th>' +
    (label === 'Comments' ? '<a href="?order_by=comments">Comments</a>' : label) + '</th>').join('') + '</tr>';
  const f = await setup({}, header + rowHTML(1));
  try {
    const choice = () => f.doc.querySelector('[data-column-choice=comments]');
    const options = f.doc.querySelector('[aria-controls=epc-view-options]');
    options.click();
    assert.equal(exposed(choice()), true);
    choice().click();
    assert.equal(f.storage.get('ep.settings').listHiddenColumns, 'comments');
    assert.equal(f.doc.querySelectorAll('[data-ep-list-column-hidden]').length, 2);
    assert.equal(new URL(f.doc.querySelector('a[aria-label="Sort by Comments"]').href).search, '?order_by=comments');
    f.doc.querySelector('.torrent_table tbody').insertAdjacentHTML('beforeend', rowHTML(2));
    await until(() => f.doc.querySelector('[data-fixture-id="2"] [data-ep-list-column-hidden]'));
    f.doc.querySelector('[data-ep-layout=grid]').click();
    assert.equal(f.doc.querySelectorAll('[data-ep-list-column-hidden]').length, 0);
    const tags = f.doc.querySelector('[data-view-option=gridShowTags]');
    assert.equal(options.getAttribute('aria-expanded'), 'true');
    assert.equal(exposed(tags), true);
    tags.click();
    assert.equal(f.storage.get('ep.settings').gridShowTags, true);
    assert.equal(f.doc.querySelector('.epc-result-grid').dataset.epGridTags, 'true');
    assert.equal(f.doc.querySelector('[data-setting=gridShowTags]').checked, true);
    f.doc.querySelector('[data-ep-layout=list]').click();
    assert.equal(exposed(choice()), true);
    assert.equal(choice().checked, false);
    assert.equal(f.doc.querySelectorAll('[data-ep-list-column-hidden]').length, 3);
  } finally { f.close(); }
});

test('Grid opens alternate version links inside the representative card and preserves List expansion', async () => {
  const rows = rowHTML(1, { title: 'Mountain Walk [720p]' }) +
    rowHTML(2, { title: 'Mountain Walk [1080p]' }) + rowHTML(3, { title: 'Mountain Walk [2160p]' });
  const f = await setup({}, rows);
  try {
    const row = id => f.doc.querySelector('[data-fixture-id="' + id + '"]');
    row(1).querySelector('.epc-version-control').click();
    assert.equal(row(2).classList.contains('epc-version-hidden'), false);
    f.doc.querySelector('[data-ep-layout=grid]').click();
    const versions = row(1).querySelector('.epc-grid-versions');
    assert.equal(versions.querySelector('summary').textContent, '3 versions');
    versions.querySelector('summary').click();
    assert.equal(versions.open, true);
    assert.deepEqual([...versions.querySelectorAll('a')].map(link => [link.textContent, new URL(link.href).searchParams.get('id')]),
      [['1080p', '2'], ['2160p', '3']]);
    assert.equal(row(2).classList.contains('epc-version-hidden'), true);
    f.doc.querySelector('[data-ep-layout=list]').click();
    assert.equal(f.doc.querySelector('.epc-grid-versions'), null);
    assert.equal(row(2).classList.contains('epc-version-hidden'), false);
  } finally { f.close(); }
});

test('List Columns recognizes the native Comm heading as Comments', async () => {
  const labels = ['Category', 'Name', 'Files', 'Comm', 'Time', 'Size', '↻', '↑', '↓', 'Uploader'];
  const header = '<tr class="colhead_dark">' + labels.map(label => '<td>' + label + '</td>').join('') + '</tr>';
  const f = await setup({}, header + rowHTML(1));
  try {
    const choice = () => f.doc.querySelector('[data-column-choice=comments]');
    const comments = f.doc.querySelector('tr.torrent').cells[3];
    assert.equal(choice()?.closest('label').textContent, 'Comments');
    assert.equal(choice().checked, true);
    choice().click();
    assert.equal(comments.hasAttribute('data-ep-list-column-hidden'), true);
    choice().click();
    assert.equal(comments.hasAttribute('data-ep-list-column-hidden'), false);
  } finally { f.close(); }
});

test('[FLT-08] Show filtered reveals a blocked alternate version instead of immediately collapsing it again',async()=>{
  const rows=rowHTML(1,{title:'Mountain Walk [720p]',tags:'landscape'})+
    rowHTML(2,{title:'Mountain Walk [1080p]',tags:'blocked'})+rowHTML(3,{title:'Other landscape',tags:'blocked'});
  const f=await setup({nseTaglist:'blocked'},rows);
  try{
    const row=id=>f.doc.querySelector('[data-fixture-id="'+id+'"]');
    const button=f.doc.querySelector('[data-ep-reveal]');
    assert.equal(f.win.getComputedStyle(row(2)).display,'none');button.click();await settle();
    assert.equal(button.checked,true);assert.equal(row(2).getAttribute('isNSEHidden'),'1');
    assert.equal(f.win.getComputedStyle(row(2)).display,'table-row','explicitly revealed variant must actually be visible');
    assert.equal(row(2).classList.contains('epc-version-hidden'),false);
    assert.equal(f.win.getComputedStyle(row(3)).display,'table-row');
    button.click();await settle();assert.equal(f.win.getComputedStyle(row(2)).display,'none');assert.equal(f.win.getComputedStyle(row(3)).display,'none');
    assert.equal(f.storage.get('nseTaglist'),'blocked');
  }finally{f.close();}
});

test('[FLT-08] revealed versions load thumbnails and stay revealed after append and rule refresh',async()=>{
  const f=await setup({'ep.settings':{inlineThumbnails:true},nseTaglist:'blocked'},
    rowHTML(1,{title:'Mountain Walk [720p]',tags:'landscape'})+rowHTML(2,{title:'Mountain Walk [1080p]',tags:'blocked'}),
    overlayHTML(1,'https://hamsterimg.net/images/show-1.jpg')+overlayHTML(2,'https://hamsterimg.net/images/show-2.jpg'));
  try{
    const button=f.doc.querySelector('[data-ep-reveal]');
    const image=()=>f.doc.querySelector('[data-fixture-id="2"] .epc-thumbnail img');
    assert.equal(image().getAttribute('src'),null);button.click();await settle();
    assert.match(image().getAttribute('src'),/show-2\.th\.jpg/,'revealed thumbnail must become eligible');
    f.doc.querySelector('.torrent_table tbody').insertAdjacentHTML('beforeend',rowHTML(3,{title:'Mountain Walk [2160p]',tags:'blocked'})+
      overlayHTML(3,'https://hamsterimg.net/images/show-3.jpg'));await settle();
    for(const id of[2,3]){const row=f.doc.querySelector('[data-fixture-id="'+id+'"]');assert.equal(row.classList.contains('epc-revealed'),true);assert.equal(row.classList.contains('epc-version-hidden'),false);assert.equal(f.win.getComputedStyle(row).display,'table-row');}
    f.doc.querySelector('.epc-navigation button[data-pane="filters"]').click();
    const field=f.doc.getElementById('nseBlacklistTaglistArea');field.value='blocked another.tag';field.dispatchEvent(new f.win.Event('input',{bubbles:true}));await settle(240);
    assert.equal(f.doc.querySelectorAll('tr.epc-revealed').length,2);assert.equal(f.doc.querySelectorAll('tr.epc-version-hidden').length,0);
    button.click();await settle();assert.equal(f.doc.querySelectorAll('tr.epc-revealed').length,0);
  }finally{f.close();}
});
test('[FLT-09] reveal removes the native hidden class and synchronizes ordinary collage cards', async () => {
  const f=await setup({nseTaglist:'blocked'},rowHTML(1,{tags:'blocked'})+rowHTML(2),
    '<style>#content table.torrent_table tr.hidden{display:none!important}</style>'+ 
    '<div class="torrent_grid__torrent"><a href="/torrents.php?id=1">Cover</a></div>');
  try {
    const row=f.doc.querySelector('[data-fixture-id="1"]'),card=f.doc.querySelector('.torrent_grid__torrent');
    const button=f.doc.querySelector('[data-ep-reveal]');
    assert.equal(card.classList.contains('epc-filter-hidden'),true);
    button.click();await settle();
    assert.equal(row.classList.contains('hidden'),false,'native theme hidden selectors must no longer match a revealed row');
    assert.equal(f.win.getComputedStyle(row).display,'table-row');
    assert.equal(card.classList.contains('epc-filter-hidden'),false);
    assert.equal(row.getAttribute('isNSEHidden'),'1','filter identity is retained');
    button.click();await settle();assert.equal(row.classList.contains('hidden'),true);
    assert.equal(card.classList.contains('epc-filter-hidden'),true);
    assert.equal(f.errors.length,0,f.errors.join('\n'));
  } finally { f.close(); }
});

test('[FLT-09] Show filtered restores removed Hard Pass rows and covers then hides them again without losing order', async () => {
  const cards=[1,2,3].map(id=>'<div class="torrent_grid__torrent" data-card="'+id+'"><a href="/torrents.php?id='+id+'">Cover</a></div>').join('');
  const f=await setup({nseTaglist:'blocked',nseHardPassEnabled:true,nseHardPassTaglist:'hard',nseRemoveHardPassResults:true},
    rowHTML(1)+rowHTML(2,{tags:'hard'})+rowHTML(3,{tags:'blocked'}),cards);
  try {
    const row=id=>f.doc.querySelector('[data-fixture-id="'+id+'"]');
    const button=f.doc.querySelector('[data-ep-reveal]');
    for(let i=0;i<3;i++) {
      button.click();await settle();assert.ok(row(2),'removed result must return on explicit reveal');
      assert.deepEqual([...f.doc.querySelectorAll('tr.torrent')].map(r=>r.dataset.fixtureId),['1','2','3']);
      assert.equal(f.win.getComputedStyle(row(2)).display,'table-row');
      assert.equal(f.doc.querySelectorAll('.torrent_grid__torrent.epc-filter-hidden').length,0);
      assert.match(f.doc.querySelector('.epc-result-summary').textContent,/3 shown/);
      button.click();await settle();assert.equal(row(2),null);
      assert.equal(f.doc.querySelectorAll('.torrent_grid__torrent.epc-filter-hidden').length,2);
    }
    assert.equal(f.storage.get('nseHardPassTaglist'),'hard');assert.equal(f.errors.length,0,f.errors.join('\n'));
  } finally { f.close(); }
});

test('[FLT-09] all removed results can be revealed and rule edits restore them without duplicates', async () => {
  const f=await setup({nseHardPassEnabled:true,nseHardPassTaglist:'hard',nseRemoveHardPassResults:true},rowHTML(1,{tags:'hard'})+rowHTML(2,{tags:'hard'}));
  try {
    const toggle=f.doc.querySelector('[data-ep-reveal]');
    assert.equal(exposed(toggle),true);assert.equal(toggle.disabled,false,'all-removed page still needs a working reveal action');
    toggle.click();await settle();assert.equal(f.doc.querySelectorAll('tr.epc-revealed').length,2);
    f.doc.querySelector('.epc-navigation button[data-pane="filters"]').click();
    const field=f.doc.getElementById('nseHardPassTaglistArea');field.value='';field.dispatchEvent(new f.win.Event('change',{bubbles:true}));await settle(100);
    assert.equal(f.doc.querySelectorAll('tr.torrent').length,2);assert.equal(f.doc.querySelectorAll('tr.epc-revealed').length,0);
    assert.equal(f.doc.querySelectorAll('.nseToggleIcon').length,2);assert.equal(f.doc.querySelectorAll('tr.hidden').length,0);
    assert.equal(exposed(toggle),true);assert.equal(toggle.checked,true);
    assert.equal(toggle.closest('label').querySelector('.epc-filtered-count').hidden,true);
    assert.equal(f.errors.length,0,f.errors.join('\n'));
  } finally { f.close(); }
});

test('open visible action works with right-click management disabled', async () => {
  const f = await setup({ nseRightClickManagementEnabled: false });
  const opened = []; f.win.open = url => opened.push(url);
  f.doc.querySelector('.epc-navigation button[data-pane="filters"]').click();
  [...f.doc.querySelectorAll('.epc-pane button')].find(b => b.textContent === 'Open visible results').click();
  assert.equal(opened.length, 2);
  assert.ok(opened.every(url => /torrents\.php\?id=/.test(url) && !url.includes('download')));
  f.close();
});
test('notification rule imports use Companion controls and the current textarea value', async () => {
  const f = await setup({ nseWhitelist: 'allowed.tag' }, '',
    '<div><textarea class="long" name="tags"></textarea><p></p></div>',
    'https://www.empornium.sx/user.php?page=1&action=notify');
  const button = f.doc.querySelector('.epc-notification-control [role="button"]');
  assert.equal(button.textContent, 'Use allowed tag rules');
  f.doc.getElementById('nseWhitelistTaglistArea').value = 'updated.tag';
  button.click();
  assert.equal(f.doc.querySelector('textarea.long').value, 'updated.tag');
  assert.doesNotMatch(authoredInterfaceText(f.doc), branding);
  assert.equal(f.errors.length, 0, f.errors.join('\n')); f.close();
});
test('Companion branding covers every pane, row tooltip, and context menu; attribution is retained', async () => {
  const f = await setup({ nseSavedVersion: 1 });
  for (const pane of ['filters', 'searches', 'settings']) {
    f.doc.querySelector('.epc-navigation button[data-pane="' + pane + '"]').click();
    assert.doesNotMatch(authoredInterfaceText(f.doc), branding, pane);
  }
  assert.match(f.doc.querySelector('[data-ep-attribution]').textContent, /NoShitEmpornium/);
  f.doc.querySelector('.tags a').dispatchEvent(new f.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  assert.doesNotMatch(authoredInterfaceText(f.doc), branding);
  f.doc.querySelector('.torrent_table tbody').insertAdjacentHTML('beforeend', rowHTML(4));
  await settle(50);
  assert.ok(f.doc.querySelector('[data-fixture-id="4"] .nseToggleHideButton'));
  assert.doesNotMatch(authoredInterfaceText(f.doc), branding);
  assert.equal(f.errors.length, 0, f.errors.join('\n')); f.close();
});
test('filter confirmations and userscript-manager metadata use Companion terminology', async () => {
  const f = await setup({ nseTaglist: 'kept.tag' }), dialogs = [];
  f.win.confirm = message => { dialogs.push(message); return false; };
  f.doc.querySelector('.epc-navigation button[data-pane="settings"]').click();
  [...f.doc.querySelectorAll('.epc-pane button')].find(b => b.textContent === 'Reset filter preferences').click();
  f.doc.querySelector('.epc-navigation button[data-pane="filters"]').click();
  [...f.doc.querySelectorAll('.epc-pane button')].find(b => b.textContent === 'Hide visible results').click();
  assert.equal(dialogs.length, 2);
  assert.doesNotMatch(dialogs.join('\n'), branding);
  assert.equal(f.storage.get('nseTaglist'), 'kept.tag');
  const header = bundle.slice(0, bundle.indexOf('// ==/UserScript=='));
  assert.doesNotMatch(header, branding);
  assert.match(header, /^\/\/ @name\s+Companion$/m);
  assert.match(header, /@namespace\s+empornium-companion\.local/);
  assert.equal(f.doc.querySelector('.epc-workspace').getAttribute('aria-label'), 'Companion');
  assert.ok(f.menuCommands.includes('Companion settings'));
  assert.equal(f.errors.length, 0, f.errors.join('\n')); f.close();
});
test('typing filter rules autosaves and updates existing results without navigation', async () => {
  const f = await setup();
  f.doc.querySelector('.epc-navigation button[data-pane="filters"]').click();
  const input = f.doc.getElementById('nseBlacklistTaglistArea');
  input.focus(); input.value = 'Sample.Tag '; input.setSelectionRange(input.value.length, input.value.length);
  input.dispatchEvent(new f.win.Event('input', { bubbles: true }));
  await settle(650);
  assert.equal(f.storage.get('nseTaglist'), 'sample.tag');
  assert.equal(input.value, 'Sample.Tag '); assert.equal(input.selectionStart, input.value.length);
  assert.equal(f.doc.querySelectorAll('tr.torrent.hidden').length, 2);
  assert.equal(f.doc.querySelectorAll('.nseToggleHideButton').length, 2);
  assert.equal(f.doc.querySelectorAll('.epc-savebar button.epc-primary').length, 0);
  assert.equal(f.doc.querySelector('.epc-savebar [role="status"]').textContent, 'Saved automatically');
  f.doc.querySelector('.epc-savebar button').click();
  assert.equal(f.doc.querySelectorAll('tr.torrent.hidden').length, 0);
  assert.equal(f.storage.get('nseTaglist'), undefined);
  assert.equal(f.errors.length, 0, f.errors.join('\n')); f.close();
});
test('visibility checkboxes update live and do not accumulate row controls', async () => {
  const f = await setup();
  f.doc.querySelector('.epc-navigation button[data-pane="filters"]').click();
  const input = f.doc.getElementById('nseCheckHideUnseeded');
  input.checked = true; input.dispatchEvent(new f.win.Event('change', { bubbles: true })); await settle();
  assert.equal(f.doc.querySelectorAll('tr.torrent.hidden').length, 2);
  input.checked = false; input.dispatchEvent(new f.win.Event('change', { bubbles: true })); await settle();
  assert.equal(f.doc.querySelectorAll('tr.torrent.hidden').length, 0);
  assert.equal(f.doc.querySelectorAll('.nseToggleHideButton').length, 2);
  assert.equal(f.errors.length, 0, f.errors.join('\n')); f.close();
});
test('removing a Hard Pass rule restores archived rows without a refresh', async () => {
  const f = await setup({ nseHardPassEnabled: true, nseRemoveHardPassResults: true, nseHardPassTaglist: 'sample.tag' });
  assert.equal(f.doc.querySelectorAll('tr.torrent').length, 0);
  f.doc.querySelector('.epc-navigation button[data-pane="filters"]').click();
  const input = f.doc.getElementById('nseHardPassTaglistArea'); input.value = '';
  input.dispatchEvent(new f.win.Event('input', { bubbles: true })); await settle(650);
  assert.equal(f.doc.querySelectorAll('tr.torrent').length, 2);
  assert.equal(f.doc.querySelectorAll('tr.torrent.hidden').length, 0);
  assert.equal(f.doc.querySelectorAll('.nseToggleHideButton').length, 2);
  assert.equal(f.errors.length, 0, f.errors.join('\n')); f.close();
});
test('restoring a filter export applies it immediately and updates the controls', async () => {
  const f = await setup();
  f.doc.querySelector('.epc-navigation button[data-pane="settings"]').click();
  const picker = f.doc.querySelector('input[type="file"]');
  const file = new f.win.File(['{"nseTaglist":"sample.tag"}'], 'filters.json', { type: 'application/json' });
  Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
  picker.dispatchEvent(new f.win.Event('change', { bubbles: true })); await settle(90);
  assert.equal(f.doc.querySelectorAll('tr.torrent.hidden').length, 2);
  assert.equal(f.doc.getElementById('nseBlacklistTaglistArea').value, 'sample.tag');
  assert.match(f.doc.querySelector('.epc-notice').textContent, /preferences are active/);
  assert.doesNotMatch(f.doc.querySelector('.epc-workspace').textContent, /Reload to apply/);
  assert.equal(f.errors.length, 0, f.errors.join('\n')); f.close();
});
test('invalid draft preferences do not partially overwrite stored filter lists', async () => {
  const f = await setup({ nseTaglist: 'original.tag' });
  f.doc.querySelector('.epc-navigation button[data-pane="filters"]').click();
  f.doc.getElementById('nseBlacklistTaglistArea').value = 'sample.tag';
  const color = f.doc.getElementById('nseWhitelistColor'); color.value = 'url(bad)';
  color.dispatchEvent(new f.win.Event('input', { bubbles: true })); await settle(650);
  assert.equal(f.storage.get('nseTaglist'), 'original.tag');
  assert.match(f.doc.querySelector('.epc-savebar [role="status"]').textContent, /Could not save/);
  assert.equal(f.errors.length, 0, f.errors.join('\n')); f.close();
});
test('detail-page rules can update repeatedly without duplicate controls or title wrappers', async () => {
  const rows = '<tr class="group_torrent"><td></td><td><strong>Detail title</strong><span class="torrent_icon_container"></span></td><td></td><td></td><td>0</td></tr>' +
    '<tr><td>Title</td><td><strong>Detail title</strong></td></tr><tr><td></td></tr><tr><td></td></tr>' +
    '<tr><td><em><a href="/user.php?id=10">ExampleUser</a></em></td></tr>';
  const extra = '<div class="top_info"><table class="boxstat"><tbody><tr><td><a href="/user.php?id=10">ExampleUser</a></td><td></td><td></td><td><div>0</div></td></tr></tbody></table></div>' +
    '<div id="torrent_tags"><ul id="torrent_tags_list"><li><a>sample.tag</a></li></ul></div>';
  const f = await setup({ 'ep.settings': { inlineThumbnails: false, favoriteTags: 'sample.tag' } }, rows, extra, 'https://www.empornium.sx/torrents.php?id=1');
  assert.equal(f.doc.querySelector('.epc-toolbar [data-pane="filters"]'), null);
  const openTagMenu = () => f.doc.querySelector('#torrent_tags_list a')
    .dispatchEvent(new f.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  openTagMenu();
  f.doc.getElementById('nseRCMBoxBLAdd').click(); await settle();
  assert.ok(f.doc.querySelector('#torrent_tags_list .nseHiddenTag'));
  openTagMenu();
  f.doc.getElementById('nseRCMBoxBLRemove').click(); await settle();
  assert.equal(f.doc.querySelector('#torrent_tags_list .nseHiddenTag'), null);
  assert.equal(f.doc.querySelector('#torrent_tags_list a').dataset.epTagTone, 'favorite');
  assert.equal(f.doc.querySelectorAll('[data-ep-detail-title]').length, 1);
  assert.equal(f.doc.querySelectorAll('.nseToggleHideButton').length, 1);
  assert.equal(f.errors.length, 0, f.errors.join('\n')); f.close();
});

test('backfill uses the full filtering engine, preserves Show filtered and restores removed rows on rule edits', async () => {
  let calls = 0;
  const rows = rowHTML(2, { tags: 'blocked' }) + rowHTML(3, { tags: 'blocked allow' }) +
    rowHTML(4, { tags: 'hard allow' }) + rowHTML(5, { tags: 'blocked' });
  const defs = [2, 3, 4, 5].map(id => overlayHTML(id, 'https://hamsterimg.net/images/backfill-' + id + '.jpg')).join('');
  const page = fixtureHTML(rows, defs).replace(/<a class="pager_next"[^>]*>.*?<\/a>/, '');
  const f = await setup({ 'ep.settings': { inlineThumbnails: true, backfillPages: 1 }, nseTaglist: 'blocked',
    nseWhitelist: 'allow', nseHardPassEnabled: true, nseHardPassTaglist: 'hard', nseRemoveHardPassResults: true,
    nseIndividualUploadHidingWhitelist: ['5'] }, rowHTML(1, { tags: 'blocked' }), '',
    'https://www.empornium.sx/torrents.php?page=2', {
      fetch: async url => { calls++; return { ok: true, url, text: async () => page }; }
    });
  try {
    assert.equal(calls, 0);
    f.doc.querySelector('[data-ep-reveal]').click();
    f.doc.querySelector('[data-ep-backfill]').click(); await settle(100);
    assert.equal(calls, 1);
    const row = id => f.doc.querySelector('[data-fixture-id="' + id + '"]');
    assert.equal(row(2).getAttribute('isNSEHidden'), '1'); assert.equal(row(2).classList.contains('epc-revealed'), true);
    assert.equal(row(3).getAttribute('isNSEHidden'), '0'); assert.equal(row(5).getAttribute('isNSEHidden'), '0');
    assert.ok(row(4)?.classList.contains('epc-revealed'), 'explicit reveal also applies to appended Hard Pass results');
    assert.equal(f.clock.images.some(image => /backfill-4/.test(image.src)), false);
    assert.equal(f.doc.querySelectorAll('.nseToggleIcon').length, 5);
    assert.equal(new Set([...f.doc.querySelectorAll('.nseToggleIcon')].map(node => node.id)).size, 5);
    row(3).querySelector('.tags a').dispatchEvent(new f.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    assert.equal(f.win.getComputedStyle(f.doc.querySelector('#nseRCMBox')).display, 'block');
    f.doc.querySelector('.epc-navigation button[data-pane="filters"]').click();
    const hardPass = f.doc.getElementById('nseHardPassTaglistArea');
    hardPass.value = ''; hardPass.dispatchEvent(new f.win.Event('change', { bubbles: true })); await settle(90);
    assert.ok(row(4)); assert.equal(row(4).getAttribute('isNSEHidden'), '0');
    assert.equal(row(4).querySelectorAll('.nseToggleIcon').length, 1);
    assert.ok(row(4).querySelector('.epc-thumbnail'));
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

function exposed(node) {
  if (node.closest('[hidden]')) return false;
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS' && !parent.open && !parent.querySelector('summary')?.contains(node)) return false;
  }
  return true;
}

test('the simplified interface shows three task areas and keeps Grid preferences out of List settings', async () => {
  const f = await setup();
  try {
    assert.deepEqual([...f.doc.querySelectorAll('.epc-navigation button[data-pane]')].map(button => button.textContent), ['Searches', 'Settings', 'Filters']);
    assert.notEqual(f.doc.querySelector('.epc-brand').tagName, 'BUTTON');
    f.doc.querySelector('.epc-navigation [data-pane="settings"]').click();
    const pane = f.doc.querySelector('.epc-pane[data-pane="settings"]');
    const visible = [...pane.querySelectorAll('input,select,textarea')].filter(exposed);
    assert.equal(visible.length, 11);
    assert.ok(visible.some(control => control.id === 'nseThemeDropdown'));
    assert.ok(visible.some(control => control.dataset.setting === 'thumbnailSize'));
    assert.ok(visible.some(control => control.dataset.setting === 'reformatDetailPages' && !control.checked));
    assert.ok(!visible.some(control => control.dataset.setting === 'gridCardWidth'));
    assert.ok(!visible.some(control => control.dataset.setting === 'gridSpacing'));
    assert.equal(pane.querySelector('[data-setting=animatedCovers],[data-setting=gridAutoplayGifs],[data-setting=listAutoplayGifs]'), null);
    const search = pane.querySelector('.epc-settings-search');
    const gridSpacing = pane.querySelector('[data-setting=gridSpacing]');
    search.value = 'grid spacing';
    search.dispatchEvent(new f.win.Event('input', { bubbles: true }));
    assert.ok(exposed(gridSpacing));
    search.value = '';
    search.dispatchEvent(new f.win.Event('input', { bubbles: true }));
    assert.ok(!exposed(gridSpacing));
    assert.equal(f.doc.querySelector('[data-option-group="advanced"]').open, false);
    f.doc.querySelector('.epc-navigation [data-pane="filters"]').click();
    assert.deepEqual([...f.doc.querySelectorAll('.epc-pane[data-pane="filters"] input,.epc-pane[data-pane="filters"] textarea')].filter(exposed).map(control => control.id),
      ['nseBlacklistTaglistArea', 'nseWhitelistTaglistArea']);
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('per-result hide buttons default to off while bulk hide still works', async () => {
  const f = await setup();
  try {
    const control = f.doc.querySelector('[data-setting=showResultHideButton]');
    const button = f.doc.querySelector('.nseToggleHideButton');
    assert.equal(control.checked, false);
    assert.equal(f.win.getComputedStyle(button).display, 'none');
    f.doc.querySelector('.epc-navigation [data-pane="filters"]').click();
    [...f.doc.querySelectorAll('.epc-pane button')].find(b => b.textContent === 'Hide visible results').click();
    await until(() => f.storage.get('nseIndividualUploadHidingBlacklist', []).length === 2, 'Bulk hide saved both results');
    control.checked = true;
    control.dispatchEvent(new f.win.Event('change', { bubbles: true }));
    await until(() => !f.doc.documentElement.hasAttribute('data-ep-hide-result-buttons'), 'Per-result buttons shown');
    assert.equal(f.storage.get('ep.settings').showResultHideButton, true);
  } finally { f.close(); }
});

test('advanced search reveals matching controls, restores disclosure state and preserves customized preferences on save', async () => {
  const f = await setup({ 'ep.settings': { inlineThumbnails: false, previews: false, cacheEntries: 52, concurrency: 4, backfillPages: 8 },
    nseUIFont: 'Inter', nseBlacklistColor: '#ff9900' });
  try {
    f.doc.querySelector('.epc-navigation [data-pane="settings"]').click();
    const advanced = f.doc.querySelector('[data-option-group="advanced"]'); advanced.open = true;
    const input = f.doc.querySelector('.epc-settings-search'), before = JSON.stringify([...f.storage.data]);
    input.value = 'cache'; input.dispatchEvent(new f.win.Event('input', { bubbles: true }));
    const found = [...f.doc.querySelector('.epc-pane[data-pane=settings]').querySelectorAll('input[data-setting],select[data-setting],textarea')].filter(exposed);
    assert.deepEqual(found.map(control => control.dataset.setting).sort(), ['cacheEntries', 'cacheMegapixels', 'persistentCacheMB', 'persistentImages']);
    assert.equal(f.doc.querySelector('[data-option-group="loading"]').open, true);
    assert.equal(f.doc.querySelector('[data-option-group="appearance"]').hidden, true);
    assert.equal(JSON.stringify([...f.storage.data]), before, 'finding a setting does not write preferences');
    input.value = ''; input.dispatchEvent(new f.win.Event('input', { bubbles: true }));
    assert.equal(f.doc.querySelector('[data-option-group="loading"]').open, false);
    assert.equal(f.doc.querySelector('[data-option-group="appearance"]').hidden, false);
    assert.match(f.doc.querySelector('[data-option-group="images"] summary').textContent, /Hover off/);
    const size = f.doc.querySelector('[data-setting="thumbnailSize"]'); size.value = '84';
    size.dispatchEvent(new f.win.Event('change', { bubbles: true })); await settle();
    const saved = f.storage.get('ep.settings');
    assert.equal(saved.thumbnailSize, 84); assert.equal(saved.cacheEntries, 52);
    assert.equal(saved.previews, false); assert.equal(saved.concurrency, 4); assert.equal(saved.backfillPages, 8);
    assert.equal(f.storage.get('nseUIFont'), 'Inter'); assert.equal(f.storage.get('nseBlacklistColor'), '#ff9900');
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('collapsed rule summaries expose active rules and update without resetting their values', async () => {
  const f = await setup({ nseBlacklistTitles: 'one;two', nseUploaders: 'ExampleUser',
    nseHardPassEnabled: true, nseHardPassTaglist: 'hard.tag', nseHideWarnedEnabled: true });
  try {
    f.doc.querySelector('.epc-navigation [data-pane="filters"]').click();
    const title = f.doc.querySelector('[data-option-group="Title rules"]');
    assert.equal(title.open, false); assert.match(title.querySelector('summary').textContent, /2 rules/);
    assert.match(f.doc.querySelector('[data-option-group="Uploader rules"] summary').textContent, /1 rule/);
    assert.match(f.doc.querySelector('[data-option-group="hard-pass"] summary').textContent, /1 rule/);
    const field = f.doc.getElementById('nseBlacklistTitleListArea'); title.open = true;
    field.value = 'one'; field.dispatchEvent(new f.win.Event('change', { bubbles: true })); await settle();
    assert.match(title.querySelector('summary').textContent, /1 rule/);
    assert.equal(f.storage.get('nseBlacklistTitles'), 'one');
    assert.equal(f.storage.get('nseHardPassTaglist'), 'hard.tag');
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('saved searches remain primary while management opens only on request and row options stay folded', async () => {
  const f = await setup({ 'ep.searches': [{ id: 'saved', title: 'My search', fields: [{ name: 'searchtext', type: 'text', value: 'sample' }] }],
    'ep.searchDrawerOpen': true });
  try {
    assert.equal(f.doc.querySelector('.epc-panel').hidden, true);
    assert.equal(exposed(f.doc.querySelector('.epc-saved-shortcut')), true);
    f.doc.querySelector('.epc-navigation [data-pane="searches"]').click();
    const pane = f.doc.querySelector('.epc-pane[data-pane="searches"]');
    assert.equal(pane.querySelector('.epc-search-more').open, false);
    assert.equal(f.doc.querySelector('.epc-savebar').hidden, true);
    assert.equal([...pane.querySelectorAll('button')].filter(exposed).length, 0);
    pane.querySelector('.epc-search-more').open = true;
    assert.ok([...pane.querySelectorAll('button')].filter(exposed).some(button => button.textContent === 'Rename'));
    assert.equal(exposed(f.doc.querySelector('.epc-saved-shortcut')), true);
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('Show filtered stays available on a results page and counts the results it can reveal', async () => {
  const f = await setup({}, undefined, '', 'https://www.empornium.sx/torrents.php?page=3');
  try {
    const toggle = f.doc.querySelector('[data-ep-reveal]');
    const count = toggle.closest('label').querySelector('.epc-filtered-count');
    assert.equal(exposed(toggle), true);
    assert.equal(count.hidden, true);
    assert.equal(f.doc.querySelector('[data-ep-backfill]').hidden, true);
    f.doc.querySelector('.epc-navigation [data-pane="filters"]').click();
    const tags = f.doc.getElementById('nseBlacklistTaglistArea'); tags.value = 'sample.tag';
    tags.dispatchEvent(new f.win.Event('change', { bubbles: true })); await settle();
    assert.equal(count.hidden, false);
    assert.equal(count.textContent, '2');
    tags.value = ''; tags.dispatchEvent(new f.win.Event('change', { bubbles: true })); await settle();
    assert.equal(exposed(toggle), true);
    assert.equal(count.hidden, true);
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('Filters exposes Freeleech and an active chip can clear it without opening the pane', async () => {
  const f = await setup({ nseTaglist: 'blocked' }, rowHTML(1, { tags: 'blocked' }) + rowHTML(2));
  try {
    const context = f.doc.querySelector('.epc-toolbar-context');
    const reveal = f.doc.querySelector('[data-ep-reveal]');
    const filters = context.querySelector('[data-pane=filters]');
    const freeleech = f.doc.querySelector('[data-setting=freeleechView]');
    const chip = f.doc.querySelector('.epc-active-filter');
    assert.equal(exposed(context.querySelector('[data-ep-layout=list]')), true);
    assert.equal(exposed(reveal), true);
    assert.equal(reveal.getAttribute('role'), 'switch');
    assert.ok(reveal.closest('.epc-toolbar-main'));
    assert.equal(reveal.closest('label').nextElementSibling.dataset.pane, 'settings');
    reveal.click();
    assert.equal(reveal.checked, true);
    assert.match(reveal.closest('label').textContent, /Show filtered/);
    reveal.click();
    assert.equal(reveal.checked, false);
    assert.match(reveal.closest('label').textContent, /Show filtered/);
    filters.click();
    assert.equal(exposed(freeleech), true);
    freeleech.value = 'sitewide';
    freeleech.dispatchEvent(new f.win.Event('change', { bubbles: true }));
    await until(() => !chip.hidden);
    assert.equal(chip.getAttribute('aria-label'), 'Clear Sitewide freeleech filter');
    filters.click();
    chip.click();
    assert.equal(freeleech.value, 'all');
    assert.equal(chip.hidden, true);
    assert.equal(f.doc.activeElement, filters);
  } finally { f.close(); }
});

test('version grouping respects live filtering and restores archived Hard Pass variants', async () => {
  const rows = rowHTML(1, { title: 'Mountain Walk [720p]', tags: 'blocked' }) +
    rowHTML(2, { title: 'Mountain Walk [1080p]', tags: 'landscape' }) +
    rowHTML(3, { title: 'Mountain Walk [2160p]', tags: 'hard' }) + rowHTML(4, { title: 'Mountain Walk [480p]', tags: 'landscape' });
  const f = await setup({ nseTaglist: 'blocked', nseHardPassEnabled: true, nseHardPassTaglist: 'hard', nseRemoveHardPassResults: true }, rows);
  try {
    let button = f.doc.querySelector('.epc-version-control');
    assert.equal(button.closest('tr').dataset.fixtureId, '2'); assert.equal(button.textContent, 'Show 2 versions');
    assert.equal(f.doc.querySelector('[data-fixture-id="3"]'), null);
    f.doc.querySelector('.epc-navigation [data-pane="filters"]').click();
    const hard = f.doc.getElementById('nseHardPassTaglistArea'); hard.value = '';
    hard.dispatchEvent(new f.win.Event('change', { bubbles: true })); await settle(80);
    button = f.doc.querySelector('.epc-version-control'); assert.equal(button.textContent, 'Show 3 versions');
    f.doc.querySelector('[data-ep-reveal]').click();
    button = f.doc.querySelector('.epc-version-control'); assert.equal(button.closest('tr').dataset.fixtureId, '2');
    assert.equal(button.textContent, 'Show 3 versions'); button.click();
    assert.equal(f.win.getComputedStyle(f.doc.querySelector('[data-fixture-id="1"]')).display,'table-row');
    assert.equal(f.doc.querySelector('[data-fixture-id="1"]').getAttribute('isNSEHidden'), '1');
    assert.equal(f.doc.querySelectorAll('.nseToggleIcon').length, 4);
    f.doc.querySelector('[data-setting=groupVersions]').checked = false;
    f.doc.querySelector('[data-setting=groupVersions]').dispatchEvent(new f.win.Event('change', { bubbles: true })); await settle(80);
    assert.deepEqual([...f.doc.querySelectorAll('tr.torrent')].map(row => row.dataset.fixtureId), ['1', '2', '3', '4']);
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('backfilled variants join the same expanded group with previews and tag highlights intact', async () => {
  const rows = rowHTML(1, { title: 'Mountain Walk [720p]', tags: 'favorite' }) + rowHTML(2, { title: 'Mountain Walk [1080p]' });
  const f = await setup({ 'ep.settings': { inlineThumbnails: false, favoriteTags: 'favorite', backfillPages: 1 } }, rows, '', undefined, {
    fetch: async url => ({ ok: true, url, headers: { get: () => 'text/html' }, text: async () => fixtureHTML(
      rowHTML(2, { title: 'Mountain Walk [1080p]' }) + rowHTML(3, { title: 'Mountain Walk [2160p]', tags: 'favorite' }), overlayHTML(3, 'https://x.test/c.jpg')) })
  });
  try {
    const button = f.doc.querySelector('.epc-version-control'); button.click(); button.focus();
    f.doc.querySelector('[data-ep-backfill]').click(); await settle(120);
    assert.equal(f.doc.querySelectorAll('tr.torrent').length, 3);
    assert.equal(button.textContent, 'Hide 3 versions'); assert.equal(f.doc.activeElement, button);
    const third = f.doc.querySelector('[data-fixture-id="3"]');
    assert.ok(third.querySelector('.nseToggleIcon')); assert.equal(third.querySelector('.tags a').dataset.epTagTone, 'favorite');
    assert.ok(third.querySelector('a[data-ep-backfill-preview]'));
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('one contextual tag menu offers exclusive highlights without altering visibility rules', async () => {
  const f = await setup({ nseTaglist: 'blocked', 'ep.settings': { inlineThumbnails: false } });
  try {
    const tag = f.doc.querySelector('.tags a');
    const open = () => tag.dispatchEvent(new f.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    open(); assert.equal(f.doc.querySelectorAll('.epc-highlight-actions').length, 1);
    assert.equal(f.doc.querySelector('[data-highlight=clear]').hidden, true);
    f.doc.querySelector('[data-highlight=favorite]').click(); await settle();
    assert.equal(tag.dataset.epTagTone, 'favorite'); assert.equal(f.storage.get('nseTaglist'), 'blocked');
    assert.equal(f.storage.get('nseWhitelist'), undefined); assert.equal(f.doc.querySelector('.torrent_table tr').classList.contains('hidden'), false);
    open(); assert.equal(f.doc.querySelector('[data-highlight=favorite]').getAttribute('aria-pressed'), 'true');
    f.doc.querySelector('[data-highlight=caution]').click(); await settle();
    assert.equal(tag.dataset.epTagTone, 'caution'); assert.equal(f.storage.get('ep.settings').favoriteTags, '');
    open(); f.doc.querySelector('[data-highlight=clear]').click(); await settle();
    assert.equal(tag.hasAttribute('data-ep-tag-tone'), false);
    const nativeMenu = new f.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    f.doc.querySelector('.fixture-title').dispatchEvent(nativeMenu);
    assert.equal(nativeMenu.defaultPrevented, false);
    assert.equal(f.doc.getElementById('nseRCMBox').classList.contains('hidden'), true);
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('custom tag categories support conflict review, bulk moves, colors, order, and undo', async () => {
  const f = await setup({ 'ep.settings': { inlineThumbnails: false, favoriteTags: 'sample.tag sample.other' } });
  try {
    const click = (scope, caption) => [...scope.querySelectorAll('button')].find(button => button.textContent === caption).click();
    const change = (field, value) => {
      if (field.type === 'checkbox') field.checked = value; else field.value = value;
      field.dispatchEvent(new f.win.Event('change', { bubbles: true }));
    };
    f.doc.querySelector('[data-pane=filters]').click();
    const manager = f.doc.querySelector('[data-option-group=tag-highlights]');
    assert.equal(manager.querySelectorAll('[data-tag-category]').length, 8);
    click(manager, 'Add category');
    const custom = manager.querySelector('[data-tag-category^=custom-]');
    const id = custom.dataset.tagCategory;
    assert.equal(f.doc.activeElement, custom.querySelector('input[type=text]'));
    change(custom.querySelector('input[type=text]'), 'Standouts');
    change(custom.querySelector('input[type=color]'), '#203050');
    click(custom, 'Move up');
    assert.equal(custom.nextElementSibling.dataset.tagCategory, 'caution');
    custom.querySelector('textarea').value = 'sample.tag sample.extra';
    click(custom, 'Save tags');
    assert.match(custom.querySelector('[role=status]').textContent, /sample\.tag \(Liked\)/);
    assert.equal(f.storage.get('ep.settings').favoriteTags, 'sample.tag sample.other');
    click(custom, 'Move conflicting tags');
    assert.equal(f.storage.get('ep.settings').favoriteTags, 'sample.other');
    const tag = f.doc.querySelector('.tags a');
    assert.equal(tag.dataset.epTagTone, id);
    assert.equal(tag.style.getPropertyValue('--epc-tag-background'), '#203050');
    assert.equal(tag.style.getPropertyValue('--epc-tag-foreground'), '#fff');
    change(custom.querySelector('input[type=checkbox]'), false);
    assert.equal(tag.hasAttribute('data-ep-tag-tone'), false);
    change(custom.querySelector('input[type=checkbox]'), true);
    assert.equal(tag.dataset.epTagTone, id);

    const search = manager.querySelector('.epc-tag-search');
    const query = search.querySelector('input[type=search]'); query.value = 'sample.';
    query.dispatchEvent(new f.win.Event('input', { bubbles: true }));
    assert.equal(search.querySelectorAll('.epc-tag-search-row').length, 3);
    for (const input of search.querySelectorAll('input[type=checkbox]')) input.click();
    search.querySelector('select').value = 'loved';
    click(search, 'Move selected');
    assert.equal(tag.dataset.epTagTone, 'loved');
    assert.equal(f.storage.get('ep.settings').tagCategories.find(group => group.id === id).tags, '');
    assert.deepEqual(f.storage.get('ep.settings').tagCategories.find(group => group.id === 'loved').tags.split(' ').sort(),
      ['sample.extra', 'sample.other', 'sample.tag']);
    click(f.doc, 'Undo changes');
    assert.equal(manager.querySelector('[data-tag-category^=custom-]'), null);
    assert.equal(tag.dataset.epTagTone, 'favorite');
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('Grid tag discovery and category view follow Freeleech, reveal and backfill', async () => {
  const rows = rowHTML(1, { tags: 'coast', extra: 'sitewide_leech' }) + rowHTML(2, { tags: 'coast blocked', extra: 'sitewide_leech' }) +
    rowHTML(3, { tags: 'coast' }) + rowHTML(4, { tags: 'forest', extra: 'sitewide_leech' });
  const next = fixtureHTML(rowHTML(5, { tags: 'coast', extra: 'sitewide_leech' }) + rowHTML(6, { tags: 'forest', extra: 'sitewide_leech' }))
    .replace(/<a class="pager_next"[^>]*>.*?<\/a>/, '');
  const f = await setup({ nseTaglist: 'blocked', 'ep.settings': { resultsView: 'grid', inlineThumbnails: false, backfillPages: 1,
    freeleechView: 'sitewide' } }, rows, '', 'https://www.empornium.sx/torrents.php?page=2', {
    fetch: async url => ({ ok: true, url, text: async () => next })
  });
  try {
    const row = id => f.doc.querySelector('[data-fixture-id="' + id + '"]');
    const visible = () => [...f.doc.querySelectorAll('tr.torrent')].filter(node => f.win.getComputedStyle(node).display !== 'none')
      .map(node => +node.dataset.fixtureId);
    const tag = row(1).querySelector('.tags a');
    const tags = row(1).querySelector('.epc-grid-tag-cue summary');
    assert.equal(tags.textContent, 'Tags');
    tags.click();
    assert.notEqual(f.win.getComputedStyle(tag.parentElement).display, 'none');
    tag.dispatchEvent(new f.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    f.doc.querySelector('[data-highlight=new-performer]').click();
    assert.match(tags.textContent, /New performer/);
    f.doc.querySelector('[data-pane=filters]').click();
    const group = f.doc.querySelector('[data-tag-category=new-performer]');
    [...group.querySelectorAll('button')].find(button => button.textContent === 'Show matches').click();
    const chip = f.doc.querySelector('.epc-category-view');
    assert.match(chip.textContent, /New performer · 1 result/);
    assert.deepEqual(visible(), [1]);
    const reveal = f.doc.querySelector('[data-ep-reveal]');
    reveal.click();
    assert.deepEqual(visible(), [1, 2]);
    assert.match(chip.textContent, /2 results/);
    f.doc.querySelector('[data-ep-backfill]').click();
    await until(() => row(6));
    assert.deepEqual(visible(), [1, 2, 5]);
    assert.match(chip.textContent, /3 results/);
    tag.dispatchEvent(new f.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    f.doc.querySelector('[data-highlight=loved-performer]').click();
    assert.deepEqual(visible(), []);
    assert.match(chip.textContent, /0 results/);
    assert.match(f.doc.querySelector('.epc-result-summary').textContent, /No results match this category/);
    assert.equal(f.doc.activeElement, chip);
    chip.click();
    assert.deepEqual(visible(), [1, 2, 4, 5, 6]);
    assert.equal(chip.hidden, true);
    assert.equal(f.storage.get('nseTaglist'), 'blocked');
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('a touch Grid card can assign an unclassified tag through its picker', async () => {
  const f = await setup({ 'ep.settings': { resultsView: 'grid', inlineThumbnails: false } },
    rowHTML(1, { tags: 'landscape coast' }), '', undefined, { touch: true });
  try {
    const drawer = f.doc.querySelector('.epc-grid-tag-cue'); drawer.querySelector('summary').click();
    await until(() => drawer.querySelector('.epc-grid-tag-picker'));
    const picker = drawer.querySelector('.epc-grid-tag-picker');
    const select = picker.querySelector('select'), highlight = picker.querySelector('button');
    assert.equal(highlight.disabled, true);
    select.value = '1';
    select.dispatchEvent(new f.win.Event('change'));
    highlight.click();
    f.doc.querySelector('[data-highlight=loved]').click();
    assert.equal(f.doc.querySelector('.tags a').hasAttribute('data-ep-tag-tone'), false);
    assert.equal(f.doc.querySelector('.tags a:last-child').dataset.epTagTone, 'loved');
    assert.equal(drawer.querySelector('.epc-tag-swatch').textContent, 'Loved');
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('Bookmarks tags support keyboard assignment without torrent visibility actions', async () => {
  const f = await setup({ 'ep.settings': { keyboardShortcuts: true, inlineThumbnails: false } }, rowHTML(1), '',
    'https://www.empornium.sx/bookmarks.php?type=torrents');
  try {
    const tag = f.doc.querySelector('.tags a'); tag.focus();
    const shortcut = new f.win.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true });
    tag.dispatchEvent(shortcut);
    const menu = f.doc.getElementById('nseRCMBox');
    assert.ok(shortcut.defaultPrevented);
    assert.ok(menu.contains(f.doc.activeElement));
    assert.doesNotMatch(menu.textContent, /Block tag|Allow tag/);
    menu.querySelector('[data-highlight=loved]').click();
    assert.equal(tag.dataset.epTagTone, 'loved');
    assert.equal(f.doc.activeElement, tag);
    assert.equal(menu.classList.contains('hidden'), true);
  } finally { f.close(); }
});

test('tag drafts show their unsaved state and support keyboard saving and discarding', async () => {
  const f = await setup({ 'ep.settings': { keyboardShortcuts: true, inlineThumbnails: false } });
  try {
    f.doc.querySelector('button[data-pane=filters]').click();
    const group = f.doc.querySelector('[data-tag-category=loved]');
    const tags = group.querySelector('textarea');
    const action = name => [...group.querySelectorAll('button')].find(button => button.textContent === name);
    const draft = text => { tags.value = text; tags.dispatchEvent(new f.win.Event('input', { bubbles: true })); };
    draft('sample.tag');
    assert.match(group.querySelector('summary').textContent, /Unsaved edits/);
    assert.equal(action('Show matches').disabled, true);
    const shortcut = new f.win.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    tags.dispatchEvent(shortcut);
    assert.equal(shortcut.defaultPrevented, true);
    assert.equal(f.doc.querySelector('.tags a').dataset.epTagTone, 'loved');
    assert.equal(action('Show matches').disabled, false);
    draft('discard.me');
    action('Discard tag edits').click();
    assert.equal(tags.value, 'sample.tag');
    assert.equal(action('Discard tag edits').hidden, true);
  } finally { f.close(); }
});

test('tag highlighting remains keyboard accessible and returns focus when the menu closes', async () => {
  const f = await setup();
  try {
    const tag = f.doc.querySelector('.tags a'); tag.focus();
    const key = new f.win.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true });
    tag.dispatchEvent(key); assert.equal(key.defaultPrevented, true);
    assert.ok(f.doc.activeElement.closest('#nseRCMBox'));
    f.doc.activeElement.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(f.doc.activeElement, tag); assert.equal(f.doc.getElementById('nseRCMBox').classList.contains('hidden'), true);
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('highlight lists save within the folded category manager without adding primary controls', async () => {
  const f = await setup({ 'ep.settings': { inlineThumbnails: false, favoriteTags: 'retained' } });
  try {
    f.doc.querySelector('.epc-navigation [data-pane="filters"]').click();
    const section = f.doc.querySelector('[data-option-group="tag-highlights"]'); assert.equal(section.open, false);
    assert.match(section.querySelector('summary').textContent, /1 tag/);
    const field = section.querySelector('[data-tag-list=favorite]'); field.value = 'sample.tag';
    [...field.closest('details').querySelectorAll('button')].find(button => button.textContent === 'Save tags').click();
    assert.equal(f.doc.querySelector('.tags a').dataset.epTagTone, 'favorite');
    assert.equal(f.storage.get('ep.settings').favoriteTags, 'sample.tag');
    assert.equal(f.doc.querySelectorAll('.epc-navigation button[data-pane]').length, 3);
    assert.equal(f.doc.querySelector('.epc-basic-settings [data-setting=favoriteTags],.epc-basic-settings [data-setting=cautionTags]'), null);
    f.doc.querySelector('[data-setting=groupVersions]').checked = false;
    f.doc.querySelector('[data-setting=groupVersions]').dispatchEvent(new f.win.Event('change', { bubbles: true })); await settle(80);
    assert.equal(f.storage.get('ep.settings').favoriteTags, 'sample.tag');
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('opening visible results includes the representative and expanded versions only', async () => {
  const rows = rowHTML(1, { title: 'Mountain Walk [720p]' }) + rowHTML(2, { title: 'Mountain Walk [1080p]' }) + rowHTML(3);
  const f = await setup({}, rows);
  try {
    const opened = []; f.win.open = url => opened.push(url);
    f.doc.querySelector('.epc-navigation [data-pane="filters"]').click();
    const open = [...f.doc.querySelectorAll('button')].find(b => b.textContent === 'Open visible results'); open.click();
    assert.deepEqual(opened.map(url => new URL(url).searchParams.get('id')), ['1', '3']);
    opened.length = 0; f.doc.querySelector('.epc-version-control').click(); open.click();
    assert.deepEqual(opened.map(url => new URL(url).searchParams.get('id')), ['1', '2', '3']);
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('oversized highlight drafts are rejected and retain the draft', async () => {
  const f = await setup();
  try {
    f.doc.querySelector('.epc-navigation [data-pane="filters"]').click();
    const favorite = f.doc.querySelector('[data-tag-list=favorite]'); favorite.value = 'x'.repeat(50001);
    const category = favorite.closest('details');
    [...category.querySelectorAll('button')].find(button => button.textContent === 'Save tags').click();
    assert.equal(f.storage.get('nseTaglist'), undefined); assert.equal(f.storage.get('ep.settings').favoriteTags || '', '');
    assert.match(category.querySelector('[role=status]').textContent, /exceeds 50,000/);
    assert.equal(favorite.value.length, 50001);
  } finally { f.close(); }
});

test('[TITLE-02] title links keep the native menu while title phrase filtering stays in Filters',async()=>{
  const f=await setup({nseRCMTitlesEnabled:true});
  try{
    const title=f.doc.querySelector('.fixture-title');
    const event=new f.win.MouseEvent('contextmenu',{bubbles:true,cancelable:true});title.dispatchEvent(event);
    assert.equal(event.defaultPrevented,false,'imported legacy title-menu preference must not hijack link actions');
    assert.equal(f.doc.getElementById('nseRCMBox').classList.contains('hidden'),true);
    f.doc.querySelector('.epc-navigation [data-pane="filters"]').click();
    const group=f.doc.querySelector('[data-option-group="Title rules"]');assert.ok(group);
    assert.equal(f.doc.querySelector('[aria-label="Edit title rules from results"]'),null,'remove the obsolete visible option');
    const field=f.doc.getElementById('nseBlacklistTitleListArea');field.value='Example 1';field.dispatchEvent(new f.win.Event('input',{bubbles:true}));
    field.dispatchEvent(new f.win.KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}));await settle(50);
    assert.equal(f.storage.get('nseBlacklistTitles'),'example 1');assert.equal(title.closest('tr').classList.contains('hidden'),true);
    const uploader=f.doc.querySelector('td.user>a');const userEvent=new f.win.MouseEvent('contextmenu',{bubbles:true,cancelable:true});uploader.dispatchEvent(userEvent);
    assert.equal(userEvent.defaultPrevented,true,'uploader rules remain contextual on usernames');
  }finally{f.close();}
});
