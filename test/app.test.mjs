import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp, captureSearch, applySearch } from '../src/app.mjs';
import { validateNSE } from '../src/nse-settings.mjs';
import { domFixture, fixtureHTML, rowHTML, overlayHTML, memoryStorage, fakeClock, settle, until, afterFrames } from './helpers.mjs';

const schema = JSON.parse(await readFile(new URL('../dist/nse-schema.json', import.meta.url)));
async function setup(extra = '', settings = {}, initial = {}) {
  const f = domFixture(fixtureHTML(undefined, extra)), c = fakeClock();
  const storage = memoryStorage({ 'ep.settings': { inlineThumbnails: false, ...settings }, ...initial });
  const app = createApp(f.win, storage, { Image: c.env.Image, validateNSE: value => validateNSE(value, schema) }).start();
  await until(() => f.doc.querySelector('.epc-workspace[data-ep-ready="true"]'), 'App fixture readiness');
  return { ...f, c, app, storage, close() { app.dispose(); f.close(); } };
}
test('captures and restores complete search controls without hidden credentials', () => {
  const f = domFixture(), form = f.doc.querySelector('form'), fields = form.elements;
  fields.searchtext.value = 'sample'; fields.taglist.value = 'tag.one'; fields.sizetype.value = 'gb';
  fields.order_by.value = 'size'; fields.order_way.value = 'asc';
  fields['filter_cat[2]'].checked = true;
  const saved = { fields: captureSearch(form) };
  assert.equal(saved.fields.some(field => field.name === 'authkey'), false);
  fields.searchtext.value = 'other'; fields['filter_cat[1]'].checked = true;
  applySearch(form, saved);
  assert.equal(fields.searchtext.value, 'sample'); assert.equal(fields.sizetype.value, 'gb');
  assert.equal(fields.order_by.value, 'size'); assert.equal(fields.order_way.value, 'asc');
  assert.equal(fields['filter_cat[1]'].checked, false); assert.equal(fields['filter_cat[2]'].checked, true);
  fields.searchtext.value = 'more'; fields['filter_cat[1]'].checked = true; applySearch(form, saved, true);
  assert.equal(fields.searchtext.value, 'more sample'); assert.equal(fields['filter_cat[1]'].checked, true);
  f.close();
});
test('saved searches migrate legacy format, rename, delete and undo', async () => {
  const legacy = [{ title: 'Old search', textInputs: [{ name: 'searchtext', value: 'sample' }], checkBoxes: [{ name: 'filter_freeleech', checked: true }] }];
  const f = await setup('', {}, { empSavedSearches: JSON.stringify(legacy) });
  assert.equal(f.app.searches[0].fields.length, 2); assert.ok(f.app.savedDrawer);
  const buttons = () => [...f.app.savedList.querySelectorAll('button')];
  buttons().find(b => b.textContent === 'Rename').click();
  f.app.savedList.querySelector('input').value = 'Renamed'; buttons().find(b => b.textContent === 'Save name').click();
  assert.equal(f.storage.get('ep.searches')[0].title, 'Renamed');
  assert.equal(f.app.savedShortcuts.querySelector('a').textContent, 'Renamed');
  buttons().find(b => b.textContent === 'Delete').click(); assert.equal(f.app.searches.length, 0);
  assert.equal(f.app.savedShortcuts.hidden, true);
  buttons().find(b => b.textContent === 'Undo last deletion').click(); assert.equal(f.app.searches.length, 1);
  assert.equal(f.app.savedShortcuts.hidden, false);
  f.close();
});
test('imports validate before changes; toolkit and NSE settings have separate namespaces', async () => {
  const f = await setup('', {}, { nseTaglist: 'old.tag' });
  const before = JSON.stringify([...f.storage.data]);
  assert.throws(() => f.app.importData('{"nseTaglist":"new.tag","unrecognized":true}'), /Unknown/);
  assert.equal(JSON.stringify([...f.storage.data]), before);
  assert.throws(() => f.app.importData('{bad'), SyntaxError);
  f.app.importData('{"nseTaglist":"new.tag","nseHideAnonUploadsEnabled":true}');
  assert.equal(f.storage.get('nseTaglist'), 'new.tag'); assert.ok(f.storage.get('ep.settings'));
  assert.equal(f.storage.get('ep.previousImport').nse.nseTaglist, 'old.tag');
  const exported = f.app.exportData(); assert.equal(exported.format, 'empornium-companion');
  assert.equal(exported.nse.nseTaglist, 'new.tag');
  assert.throws(() => validateNSE(JSON.parse('{"__proto__":{}}'), schema), /Unknown/);
  assert.throws(() => validateNSE({ nseCustomTheme: { backgroundColor: 'url(https://x)' } }, schema), /theme/);
  f.close();
});
test('transaction rolls back a storage write failure', async () => {
  const f = await setup('', {}, { nseTaglist: 'old.tag' });
  const set = f.storage.set; let first = true;
  f.storage.set = (key, value) => {
    if (key === 'nseTaglist' && first) { first = false; throw new Error('Quota'); } return set(key, value);
  };
  assert.throws(() => f.app.importData('{"nseTaglist":"new.tag"}'), /Quota/);
  assert.equal(f.storage.get('nseTaglist'), 'old.tag'); f.close();
});
test('unopened gallery remains unrequested and is prepared for lazy reveal', async () => {
  const f = await setup('<div class="hidden spoiler"><img id="gallery" data-src="https://x.test/gallery.jpg"></div>');
  const image = f.doc.getElementById('gallery');
  assert.equal(image.hasAttribute('src'), false); assert.equal(image.loading, 'lazy');
  assert.equal(f.c.images.length, 0); assert.equal(f.app.media.records.get(image).state, 'deferred'); f.close();
});
test('already failed image recovers to legacy original and stale recovery cannot overwrite a new source', async () => {
  const f = await setup();
  const image = f.doc.createElement('img');
  Object.defineProperty(image, 'complete', { configurable: true, get: () => true });
  image.src = 'https://fapping.empornium.sx/images/resize/250/a.jpg'; f.doc.querySelector('#content').append(image);
  await settle(); assert.equal(f.c.images.length, 1);
  assert.equal(f.c.images[0].src, 'https://fapping.empornium.sx/images/a.jpg');
  image.src = 'https://x.test/new.jpg'; f.app.media.inspect(image); f.c.images[0].succeed();
  assert.equal(image.src, 'https://x.test/new.jpg'); f.close();
});
test('a native image that stalls offscreen recovers when scrolled into view', async () => {
  const f = await setup(); f.app.settings.stallMs = 10;
  let near = false; f.app.media.visible = () => near;
  const image = f.doc.createElement('img'); image.src = 'https://x.test/stalled.jpg';
  Object.defineProperty(image, 'complete', { get: () => false });
  f.doc.querySelector('#content').append(image); f.app.media.inspect(image);
  await settle(20);
  assert.equal(f.app.media.records.get(image).state, 'stalled'); assert.equal(f.c.images.length, 0);
  near = true; f.app.media.near.get(image)();
  assert.equal(f.c.images.length, 1); assert.match(f.c.images[0].src, /_ep_retry=/);
  f.close();
});
test('collage covers share the pool and follow a changed background source', async () => {
  const f = await setup('<div class="torrent__cover" style="background-image:url(https://x.test/cover.jpg)"></div>');
  const cover = f.doc.querySelector('.torrent__cover');
  assert.equal(f.c.images.length, 1); f.c.images[0].succeed();
  assert.equal(f.app.media.records.get(cover).state, 'ready');
  cover.style.backgroundImage = 'url("https://x.test/new-cover.jpg")'; await settle();
  assert.equal(f.c.images.length, 2); assert.equal(f.c.images[1].src, 'https://x.test/new-cover.jpg');
  f.close();
});
test('dynamic rows get one thumbnail and keyboard preview shares its transfer', async () => {
  const f = await setup(overlayHTML(1, 'https://x.test/a.jpg'), { inlineThumbnails: true });
  assert.equal(f.doc.querySelectorAll('.epc-thumbnail').length, 1);
  f.app.schedule(f.doc.body); await settle();
  assert.equal(f.doc.querySelectorAll('.epc-thumbnail').length, 1); assert.equal(f.c.images.length, 1);
  const link = f.doc.querySelector('.fixture-title'); link.focus(); await settle(10);
  assert.equal(f.app.preview.open, false);
  const thumbButton = f.doc.querySelector('.epc-thumb-button'); thumbButton.focus(); await settle(10);
  assert.equal(f.app.preview.open, true); assert.equal(f.c.images.length, 1);
  f.c.images[0].succeed(); assert.equal(f.app.preview.image.src, 'https://x.test/a.jpg');
  thumbButton.click(); assert.equal(f.app.preview.pinned, true);
  f.app.preview.showFor(thumbButton, { pin: false, keyboard: true });
  f.app.preview.retryButton.focus();
  f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(f.app.preview.open, false); assert.equal(f.doc.activeElement, thumbButton);
  await settle(10); assert.equal(f.app.preview.open, false);
  const tbody = f.doc.querySelector('.torrent_table tbody');
  tbody.insertAdjacentHTML('beforeend', rowHTML(3) + overlayHTML(3, 'https://x.test/c.jpg'));
  await settle(); assert.equal(f.doc.querySelectorAll('.epc-thumbnail').length, 2);
  f.close();
});
test('slow old preview cannot replace the next title or image', async () => {
  const f = await setup(overlayHTML(1, 'https://x.test/a.jpg') + overlayHTML(2, 'https://x.test/b.jpg'));
  const links = f.doc.querySelectorAll('.fixture-title');
  f.app.preview.showFor(links[0]); f.app.preview.showFor(links[1]);
  f.c.images[0].succeed(); assert.equal(f.app.preview.title.textContent, 'Example 2');
  assert.equal(f.app.preview.image.hasAttribute('src'), false);
  f.c.images[1].succeed(); assert.equal(f.app.preview.image.src, 'https://x.test/b.jpg');
  f.close();
});
test('pagination ignores typing, composition and modifiers', async () => {
  const f = await setup('', { globalArrowNavigation: true });
  const targets = []; f.app.options.navigate = value => targets.push(value);
  f.doc.querySelector('input[name="searchtext"]').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true }));
  assert.equal(targets.length, 0);
  f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  assert.match(targets[0], /page=3/); f.close();
});
test('preferences save automatically without navigation or a second Apply action', async () => {
  const f = await setup(); let reloads = 0, flushes = 0, refreshes = 0;
  f.app.options.reload = () => reloads++; f.app.options.flushNSE = () => flushes++;
  f.app.options.refreshFilters = () => refreshes++;
  f.app.openPane('images');
  const control = f.app.controls.get('thumbnailSize');
  control.value = '80'; control.dispatchEvent(new f.win.Event('input', { bubbles: true }));
  assert.equal(f.app.applyButton, undefined);
  await settle(600);
  assert.equal(f.storage.get('ep.settings').thumbnailSize, 80); assert.equal(reloads, 0);
  const rule = f.doc.createElement('textarea'); rule.dataset.epFilterControl = '';
  f.app.panes.filters.append(rule);
  rule.dispatchEvent(new f.win.Event('input', { bubbles: true }));
  rule.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
  assert.equal(flushes, 1); assert.equal(refreshes, 1); assert.equal(reloads, 0);
  f.close();
});
test('old two-slot default migrates and small thumbnails are preferred for supported hosts', async () => {
  const f = await setup(overlayHTML(1, 'https://hamsterimg.net/images/example.gif'), { inlineThumbnails: true, concurrency: 2 });
  assert.equal(f.app.settings.concurrency, 6);
  assert.equal(f.c.images[0].src, 'https://hamsterimg.net/images/example.th.gif');
  const entry = [...f.app.media.pool.entries.values()][0];
  assert.equal(entry.timeoutMs, 4500); assert.equal(entry.lane, 'thumbnail');
  f.close();
});
test('pinning an in-flight preview hands off its subscription without restarting it', async () => {
  const f = await setup(overlayHTML(1, 'https://x.test/a.jpg'));
  const link = f.doc.querySelector('.fixture-title');
  f.app.preview.showFor(link); f.app.preview.pin();
  assert.equal(f.c.images.length, 1);
  assert.equal(f.app.preview.pinned, true);
  f.c.images[0].succeed(); assert.equal(f.app.preview.image.src, 'https://x.test/a.jpg');
  f.close();
});
test('invalid filter imports report plain filter terminology without leaking internal keys', async () => {
  const f = await setup();
  for (const input of [
    '{"nseTaglist":broken}', '{"empSavedSearches":"nse broken"}',
    '{"nseUnknownPreference":true}', '{"nseHideUnseededEnabled":"yes"}',
    '{"nseIndividualUploadHidingBlacklist":["bad"]}', '{"nseWhitelistColor":"url(bad)"}',
    '{"nseCustomTheme":{}}'
  ]) {
    assert.throws(() => f.app.importData(input), error => {
      assert.doesNotMatch(error.message, /\bnse\w*|noshitempornium/i); return true;
    });
  }
  const error = (() => { try { f.app.importData('{"nseUnknownPreference":true}'); } catch (e) { return e; } })();
  f.app.toast('Nothing imported: ' + error.message);
  assert.match(f.app.notice.textContent, /filter preference/);
  assert.doesNotMatch(f.app.notice.textContent, /\bnse\w*|noshitempornium/i);
  f.close();
});
test('size changes keep loaded thumbnails and current transfers intact', async () => {
  const f = await setup(overlayHTML(1, 'https://x.test/a.jpg'), { inlineThumbnails: true });
  const pool = f.app.media.pool, image = f.doc.querySelector('.epc-thumbnail img');
  f.c.images[0].succeed();
  f.app.controls.get('thumbnailSize').value = '84';
  f.app.controls.get('thumbnailSize').dispatchEvent(new f.win.Event('change', { bubbles: true })); await settle();
  assert.equal(f.app.media.pool, pool); assert.equal(f.c.images.length, 1);
  assert.equal(f.doc.querySelector('.epc-thumbnail img'), image);
  assert.equal(f.doc.querySelector('.epc-thumbnail').style.getPropertyValue('--epc-thumb-size'), '84px');
  const control = f.app.controls.get('thumbnailSize');
  control.value = ''; control.dispatchEvent(new f.win.Event('input', { bubbles: true })); await settle(600);
  assert.equal(f.app.settings.thumbnailSize, 84);
  control.dispatchEvent(new f.win.FocusEvent('focusout', { bubbles: true }));
  assert.equal(control.value, '84'); assert.equal(f.app.settings.thumbnailSize, 84);
  assert.equal(f.c.images.length, 1);
  f.close();
});
test('quick Save search names and deduplicates without opening the library', async () => {
  const f = await setup();
  const control = f.doc.querySelector('input[name="searchtext"]'); control.value = 'sample query';
  control.dispatchEvent(new f.win.Event('input', { bubbles: true }));
  f.app.quickSaveSearch.click(); assert.equal(f.app.searches[0].title, 'sample query');
  assert.equal(f.app.panel.hidden, true); assert.equal(f.app.quickSaveSearch.disabled, true);
  f.app.saveCurrentSearch(); assert.equal(f.app.searches.length, 1);
  assert.equal(f.app.savedShortcuts.hidden, false);
  assert.equal(f.app.savedShortcuts.querySelectorAll('a').length, 1);
  f.close();
});

const shortcutSearch = (id = 'landscapes', title = 'Landscapes') => ({ id, title, date: '2026-10-19', fields: [
  { name: 'searchtext', type: 'text', value: 'landscape', checked: false },
  { name: 'taglist', type: 'textarea', value: 'sample.tag', checked: false },
  { name: 'filter_cat[2]', type: 'checkbox', value: '1', checked: true },
  { name: 'filter_freeleech', type: 'checkbox', value: '1', checked: false }
] });

test('saved search shortcuts stay visible outside all panels and do not use a dropdown or drawer', async () => {
  const f = await setup('', {}, { 'ep.searches': [shortcutSearch('z', 'Zebra'), shortcutSearch('a', 'Alpine')], 'ep.searchDrawerOpen': false });
  try {
    assert.equal(f.app.savedShortcuts.hidden, false);
    assert.equal(f.app.savedShortcuts.closest('.epc-panel'), null);
    assert.deepEqual([...f.app.savedShortcuts.querySelectorAll('a')].map(link => link.textContent), ['Alpine', 'Zebra']);
    assert.equal(f.app.savedShortcuts.querySelector('select,details'), null);
    f.app.openPane('filters'); f.app.closePane();
    assert.equal(f.app.savedShortcuts.closest('[hidden]'), null);
    f.app.schedule(f.doc.body); await settle();
    assert.equal(f.doc.querySelectorAll('.epc-saved-shortcuts').length, 1);
    assert.equal(f.app.savedShortcuts.querySelectorAll('a').length, 2);
  } finally { f.close(); }
});

test('a primary shortcut runs exactly the saved criteria without replacing an unsaved form draft', async () => {
  const f = await setup('', {}, { 'ep.searches': [shortcutSearch()] }), navigated = [];
  try {
    f.app.options.navigate = url => navigated.push(new URL(url));
    const input = f.app.savedForm.elements.searchtext; input.value = 'unsaved draft';
    const shortcut = f.app.savedShortcuts.querySelector('a'), href = new URL(shortcut.href);
    assert.equal(href.searchParams.get('searchtext'), 'landscape');
    assert.equal(href.searchParams.get('filter_cat[2]'), '1');
    assert.equal(href.searchParams.has('filter_freeleech'), false);
    assert.equal(href.searchParams.has('authkey'), false);
    shortcut.click();
    assert.equal(navigated.length, 1); assert.equal(navigated[0].searchParams.get('taglist'), 'sample.tag');
    assert.equal(navigated[0].searchParams.get('action'), 'advanced');
    assert.equal(input.value, 'unsaved draft');
  } finally { f.close(); }
});

test('saved shortcuts can run from pages with no torrent search form', async () => {
  const f = domFixture(fixtureHTML(), 'https://www.empornium.sx/top10.php');
  f.doc.querySelector('#search_form').remove();
  const storage = memoryStorage({ 'ep.settings': { enabled: false }, 'ep.searches': [shortcutSearch()] }), navigated = [];
  const app = createApp(f.win, storage, { navigate: url => navigated.push(new URL(url)) }).start(); await settle();
  try {
    assert.equal(app.savedForm, null); assert.equal(app.quickSaveSearch.hidden, true);
    assert.equal(app.savedShortcuts.hidden, false);
    app.savedShortcuts.querySelector('a').click();
    assert.equal(navigated[0].pathname, '/torrents.php'); assert.equal(navigated[0].searchParams.get('searchtext'), 'landscape');
    app.openPane('searches'); assert.equal(app.savedFormHint.hidden, false);
    assert.equal([...app.savedList.querySelectorAll('button')].some(button => /search form/.test(button.textContent)), false);
    [...app.savedList.querySelectorAll('button')].find(button => button.textContent === 'Edit search').click();
    assert.equal(app.savedList.querySelector('[data-search-field="taglist"]').value, 'sample.tag');
    assert.equal(app.activePane, 'searches');
  } finally { app.dispose(); f.close(); }
});

test('Edit search opens saved criteria in its row without changing context or the site form', async () => {
  const f = await setup('', {}, { 'ep.searches': [shortcutSearch()] }), navigated = [];
  try {
    f.app.options.navigate = url => navigated.push(new URL(url));
    const box = f.doc.querySelector('#search_box'); box.hidden = true; box.classList.add('hidden'); box.style.display = 'none';
    f.app.savedForm.elements.searchtext.value = 'my unsaved site draft';
    const original = JSON.stringify(captureSearch(f.app.savedForm)), stored = JSON.stringify(f.storage.get('ep.searches'));
    f.win.HTMLElement.prototype.scrollIntoView = () => { throw new Error('Editing must not scroll away'); };
    f.app.openPane('searches');
    [...f.app.savedList.querySelectorAll('button')].find(button => button.textContent === 'Edit search').click();
    const editor = f.doc.querySelector('.epc-search-editor');
    assert.equal(editor.closest('.epc-saved-row').dataset.searchId, 'landscapes');
    assert.equal(editor.querySelector('[data-search-field="searchtext"]').value, 'landscape');
    assert.equal(editor.querySelector('[data-search-field="taglist"]').value, 'sample.tag');
    assert.equal(editor.querySelector('[data-search-field="filter_cat[2]"]').checked, true);
    assert.equal(editor.contains(f.doc.activeElement), true);
    assert.equal(f.app.activePane, 'searches'); assert.equal(f.app.panel.hidden, false);
    assert.equal(box.hidden, true); assert.equal(JSON.stringify(captureSearch(f.app.savedForm)), original);
    assert.equal(JSON.stringify(f.storage.get('ep.searches')), stored); assert.equal(navigated.length, 0);
    editor.querySelector('[data-search-field="taglist"]').value = 'edited.tag';
    [...editor.querySelectorAll('button')].find(button => button.textContent === 'Save changes').click();
    assert.equal(f.storage.get('ep.searches')[0].fields.find(field => field.name === 'taglist').value, 'edited.tag');
    assert.equal(f.app.activePane, 'searches'); assert.equal(navigated.length, 0);
    assert.equal(new URL(f.app.savedShortcuts.querySelector('a').href).searchParams.get('taglist'), 'edited.tag');
    assert.equal(JSON.stringify(captureSearch(f.app.savedForm)), original);
  } finally { f.close(); }
});

test('Add to search form visibly combines criteria without changing results until Search now', async () => {
  const f = await setup('', {}, { 'ep.searches': [shortcutSearch()] }), navigated = [];
  try {
    f.app.options.navigate = url => navigated.push(new URL(url));
    f.app.savedForm.elements.searchtext.value = 'mountain';
    f.app.savedForm.elements.taglist.value = 'existing.tag';
    f.app.savedForm.elements['filter_cat[1]'].checked = true;
    f.app.openPane('searches');
    [...f.app.savedList.querySelectorAll('button')].find(button => button.textContent === 'Add to site search form').click();
    assert.equal(f.app.savedForm.elements.searchtext.value, 'mountain landscape');
    assert.equal(f.app.savedForm.elements.taglist.value, 'existing.tag sample.tag');
    assert.equal(f.app.savedForm.elements['filter_cat[1]'].checked, true);
    assert.equal(f.app.savedForm.elements['filter_cat[2]'].checked, true);
    assert.match(f.app.searchFeedback.textContent, /Added.*Landscapes.*current criteria/);
    assert.equal(navigated.length, 0);
    f.app.searchFeedback.querySelector('button').click();
    assert.equal(navigated[0].searchParams.get('searchtext'), 'mountain landscape');
  } finally { f.close(); }
});

function editSaved(f, id = 'landscapes') {
  f.app.openPane('searches');
  const row = [...f.app.savedList.querySelectorAll('.epc-saved-row')].find(row => row.dataset.searchId === id);
  [...row.querySelectorAll('button')].find(button => button.textContent === 'Edit search').click();
  return row.querySelector('.epc-search-editor');
}
const editorButton = (editor, text) => [...editor.querySelectorAll('button')].find(button => button.textContent === text);

test('turning off Companion shortcuts releases key events and Save ignores extra modifiers', async () => {
  const f = await setup('', { navigationScope: 'site' }, { 'ep.searches': [shortcutSearch()] });
  try {
    const press = (target, key, modifiers) => {
      const event = new f.win.KeyboardEvent('keydown', { key, ...modifiers, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const ctrl = { ctrlKey: true }, winCtrl = { ctrlKey: true, metaKey: true };
    const toggle = f.app.controls.get('keyboardShortcuts');
    f.app.openPane('settings');
    assert.equal(toggle.checked, true, 'existing installations retain shortcuts');
    assert.equal(press(toggle, 's', winCtrl), false);
    assert.equal(press(toggle, 's', { ...ctrl, shiftKey: true }), false);
    assert.equal(press(toggle, 's', ctrl), true);

    let editor = editSaved(f);
    let name = editor.querySelector('[data-search-title]');
    name.value = 'Updated';
    assert.equal(press(name, 's', winCtrl), false);
    assert.equal(f.storage.get('ep.searches')[0].title, 'Landscapes');
    assert.equal(press(name, 's', { metaKey: true }), true);
    assert.equal(f.storage.get('ep.searches')[0].title, 'Updated');

    f.app.openPane('settings');
    toggle.click();
    await until(() => !f.app.settings.keyboardShortcuts);
    assert.equal(press(toggle, 's', ctrl), false);
    assert.equal(press(f.doc.body, 'ArrowRight'), false);
    assert.equal(press(toggle, 'Escape'), false);
    assert.equal(f.app.activePane, 'settings');
    assert.equal(f.app.preview.pinButton.textContent, 'Pin');
    editor = editSaved(f);
    name = editor.querySelector('[data-search-title]');
    name.value = 'Updated with button';
    assert.equal(press(name, 's', ctrl), false);
    assert.equal(press(name, 'Enter'), false);
    assert.equal(press(name, 'Escape'), false);
    assert.equal(f.storage.get('ep.searches')[0].title, 'Updated');
    editorButton(editor, 'Save changes').click();
    assert.equal(f.storage.get('ep.searches')[0].title, 'Updated with button');
  } finally { f.close(); }
});

test('the saved-search editor retains fields and values absent from the current site form', async () => {
  const search = { id: 'landscapes', title: 'Imported search', fields: [
    { name: 'searchstr', type: 'text', value: 'saved keywords' },
    { name: 'filter_cat[17]', type: 'checkbox', value: '1', checked: true },
    { name: 'sizetype', type: 'select-one', value: 'GiB' },
    { name: 'order_by', type: 'select-one', value: 'uploaded' }
  ] };
  const f = await setup('', {}, { 'ep.searches': [search] });
  try {
    const original = structuredClone(f.app.searches[0].fields), editor = editSaved(f);
    assert.equal(editor.querySelector('[data-search-field="searchstr"]').value, 'saved keywords');
    assert.equal(editor.querySelector('[data-search-field="filter_cat[17]"]').checked, true);
    assert.equal(editor.querySelector('[data-search-field="sizetype"]').value, 'GiB');
    assert.equal(editor.querySelector('[data-search-field="order_by"]').value, 'uploaded');
    assert.equal(editor.querySelector('[data-search-field="authkey"]'), null);
    editorButton(editor, 'Save changes').click();
    assert.deepEqual(f.storage.get('ep.searches')[0].fields, original);
  } finally { f.close(); }
});

test('Cancel and Escape discard only the editor draft and keep the Searches panel open', async () => {
  const f = await setup('', {}, { 'ep.searches': [shortcutSearch()] });
  try {
    const original = JSON.stringify(f.storage.get('ep.searches'));
    let editor = editSaved(f); editor.querySelector('[data-search-field="taglist"]').value = 'discarded.tag';
    editorButton(editor, 'Cancel').click();
    assert.equal(f.doc.querySelector('.epc-search-editor'), null);
    assert.equal(JSON.stringify(f.storage.get('ep.searches')), original); assert.equal(f.app.panel.hidden, false);
    f.app.closePane(); editor = editSaved(f);
    editor.querySelector('[data-search-title]').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    assert.equal(editor.isConnected, true); assert.equal(JSON.stringify(f.storage.get('ep.searches')), original);
    editor.querySelector('[data-search-field="taglist"]').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(f.doc.querySelector('.epc-search-editor'), null);
    assert.equal(f.app.activePane, 'searches'); assert.equal(f.app.panel.hidden, false);
    assert.equal(JSON.stringify(f.storage.get('ep.searches')), original);
  } finally { f.close(); }
});

test('invalid editor names and storage failures keep the draft and original search intact', async () => {
  const f = await setup('', {}, { 'ep.searches': [shortcutSearch()] });
  try {
    const original = JSON.stringify(f.storage.get('ep.searches')), editor = editSaved(f);
    const name = editor.querySelector('[data-search-title]'), tag = editor.querySelector('[data-search-field="taglist"]');
    name.value = ''; editorButton(editor, 'Save changes').click();
    assert.match(editor.querySelector('[role=status]').textContent, /Enter a search name/);
    name.value = 'Updated'; tag.value = 'new.tag';
    const set = f.storage.set;
    f.storage.set = (key, value) => { if (key === 'ep.searches') throw new Error('Quota'); return set(key, value); };
    editorButton(editor, 'Save changes').click();
    assert.match(editor.querySelector('[role=status]').textContent, /Could not save/);
    assert.equal(tag.value, 'new.tag'); assert.equal(JSON.stringify(f.storage.get('ep.searches')), original);
    f.storage.set = set; editorButton(editor, 'Save changes').click();
    assert.equal(f.storage.get('ep.searches')[0].title, 'Updated');
    assert.equal(f.doc.querySelector('.epc-search-editor'), null);
  } finally { f.close(); }
});

test('saving an editor preserves changes to other searches and rejects stale edits to the same search', async () => {
  const f = await setup('', {}, { 'ep.searches': [shortcutSearch(), shortcutSearch('other', 'Other')] });
  try {
    let editor = editSaved(f); editor.querySelector('[data-search-field="taglist"]').value = 'mine.tag';
    const current = structuredClone(f.storage.get('ep.searches'));
    current[1].title = 'Updated elsewhere'; f.storage.set('ep.searches', current);
    editorButton(editor, 'Save changes').click();
    assert.equal(f.storage.get('ep.searches')[1].title, 'Updated elsewhere');
    f.app.closePane(); editor = editSaved(f);
    const changed = structuredClone(f.storage.get('ep.searches')); changed[0].fields[0].value = 'their keywords';
    f.storage.set('ep.searches', changed);
    editorButton(editor, 'Save changes').click();
    assert.match(editor.querySelector('[role=status]').textContent, /changed elsewhere/);
    assert.equal(f.storage.get('ep.searches')[0].fields[0].value, 'their keywords');
    assert.ok(editor.isConnected);
  } finally { f.close(); }
});

test('unrelated library redraws and panel switches keep the inline draft', async () => {
  const f = await setup('', {}, { 'ep.searches': [shortcutSearch()] });
  try {
    const editor = editSaved(f); editor.querySelector('[data-search-field="taglist"]').value = 'pending.tag';
    f.app.openPane('settings'); f.app.openPane('searches');
    f.app.savedForm.elements.searchtext.value = 'another search'; f.app.saveCurrentSearch();
    assert.equal(f.doc.querySelector('.epc-search-editor'), editor);
    assert.equal(editor.querySelector('[data-search-field="taglist"]').value, 'pending.tag');
    assert.equal(f.storage.get('ep.searches')[0].fields.find(field => field.name === 'taglist').value, 'sample.tag');
  } finally { f.close(); }
});

test('radio and multiselect criteria round-trip without losing types or saved options', async () => {
  const fields = [
    { name: 'sizeselect', type: 'radio', value: 'wide', checked: true },
    { name: 'sizeselect', type: 'radio', value: 'tall', checked: false },
    { name: 'filter_cat[3]', type: 'select-multiple', value: 'one', checked: false },
    { name: 'filter_cat[3]', type: 'select-multiple', value: 'two', checked: false }
  ];
  const f = await setup('', {}, { 'ep.searches': [{ id: 'landscapes', title: 'Options', fields }] });
  try {
    const editor = editSaved(f); editorButton(editor, 'Save changes').click();
    assert.deepEqual(f.storage.get('ep.searches')[0].fields, fields);
  } finally { f.close(); }
});

test('imports and changes from another tab update primary shortcuts, including the empty state', async () => {
  const f = await setup();
  try {
    assert.equal(f.app.savedShortcuts.hidden, true);
    f.app.importData(JSON.stringify([shortcutSearch('a', '<img src=x>')]));
    assert.equal(f.app.savedShortcuts.hidden, false);
    assert.equal(f.app.savedShortcuts.querySelector('img'), null);
    assert.equal(f.app.savedShortcuts.querySelector('a').textContent, '<img src=x>');
    f.storage.set('ep.searches', [shortcutSearch('b', 'From another tab')]);
    f.win.dispatchEvent(new f.win.Event('focus'));
    assert.equal(f.app.savedShortcuts.querySelector('a').textContent, 'From another tab');
    f.app.importData('[]'); assert.equal(f.app.savedShortcuts.hidden, true);
  } finally { f.close(); }
});
test('thumbnail hover shows a preview while keeping its trigger clickable', async () => {
  const f = await setup(overlayHTML(1, 'https://x.test/a.jpg'), { inlineThumbnails: true, hoverDelay: 0 });
  const button = f.doc.querySelector('.epc-thumb-button');
  button.dispatchEvent(new f.win.MouseEvent('pointerenter', { clientX: 40, clientY: 40 })); await settle(10);
  assert.equal(f.app.preview.open, true); assert.equal(f.app.preview.element.style.pointerEvents, 'none');
  assert.equal(f.app.preview.actions.hidden, true);
  button.click(); assert.equal(f.app.preview.pinned, true); assert.equal(f.app.preview.element.style.pointerEvents, '');
  assert.equal(f.app.preview.actions.hidden, false);
  f.close();
});

test('thumbnail hover immediately enlarges the usable thumbnail and requests its larger version without controls', async () => {
  const f = await setup(overlayHTML(1, 'https://hamsterimg.net/images/a.th.jpg'),
    { inlineThumbnails: true, hoverDelay: 1500 });
  try {
    const record = [...f.app.media.thumbnails.values()][0];
    f.c.images[0].succeed(160, 90);
    Object.defineProperty(record.image, 'naturalWidth', { get: () => 160 });
    const button = record.element.querySelector('button');
    button.dispatchEvent(new f.win.MouseEvent('pointerenter', { clientX: 40, clientY: 40 })); await settle(10);
    assert.equal(f.app.preview.open, true); assert.equal(f.app.preview.pinned, false);
    assert.equal(f.app.preview.element.dataset.mode, 'zoom');
    assert.equal(f.app.preview.element.getAttribute('role'), 'tooltip');
    assert.equal(f.app.preview.heading.hidden, true); assert.equal(f.app.preview.summary.hidden, true);
    assert.equal(f.app.preview.actions.hidden, true);
    assert.equal(f.app.preview.image.hidden, false); assert.match(f.app.preview.image.src, /a\.th\.jpg$/);
    assert.equal(f.c.images.length, 2); assert.match(f.c.images[1].src, /\/a\.jpg$/);
  } finally { f.close(); }
});

test('returning to the same thumbnail reuses its still-loading original and completed cache', async () => {
  const f = await setup(overlayHTML(1, 'https://hamsterimg.net/images/a.th.jpg'), { inlineThumbnails: true });
  try {
    const record = [...f.app.media.thumbnails.values()][0], preview = f.app.preview;
    f.c.images[0].succeed(160, 90);
    Object.defineProperty(record.image, 'naturalWidth', { get: () => 160 });
    const button = record.element.querySelector('button');
    const enter = async () => {
      button.dispatchEvent(new f.win.MouseEvent('pointerenter', { clientX: 40, clientY: 40 })); await settle(10);
    };
    const leave = () => button.dispatchEvent(new f.win.MouseEvent('pointerleave', { clientX: 900, clientY: 900 }));
    await enter(); assert.equal(preview.image.hidden, false);
    const retained = f.c.images[1]; leave();
    assert.equal(preview.image.hasAttribute('src'), false);
    await enter();
    assert.equal(preview.image.hidden, false, 'the ready inline image must reappear on every hover');
    assert.match(preview.image.src, /a\.th\.jpg$/);
    assert.equal(f.c.images.length, 2, 'rehover must not restart the original');
    retained.succeed(1000, 600);
    assert.equal(preview.element.dataset.state, 'ready'); assert.equal(preview.status.textContent, '');
    assert.match(preview.image.src, /\/a\.jpg$/);
    leave(); await enter();
    assert.equal(f.c.images.length, 2, 'a completed original is reused from the existing cache');
    assert.equal(preview.image.hidden, false); assert.match(preview.image.src, /\/a\.jpg$/);
  } finally { f.close(); }
});

test('repeated hover returns retain the thumbnail without spending retries or adding page scans', async () => {
  const f = await setup(overlayHTML(1, 'https://hamsterimg.net/images/repeat.jpg'), { inlineThumbnails: true });
  try {
    const record = [...f.app.media.thumbnails.values()][0], preview = f.app.preview;
    f.c.images[0].succeed(160, 90);
    Object.defineProperty(record.image, 'naturalWidth', { get: () => 160 });
    await afterFrames(f.win);
    const attempts = f.app.media.pool.budget.get(record.source).attempts;
    const scan = f.app.media.scan.bind(f.app.media); let scans = 0;
    f.app.media.scan = (...args) => { scans++; return scan(...args); };
    const button = record.element.querySelector('button');
    for (let i = 0; i < 8; i++) {
      button.dispatchEvent(new f.win.MouseEvent('pointerenter', { clientX: 40, clientY: 40 })); await settle(10);
      assert.equal(preview.image.hidden, false); assert.match(preview.image.src, /repeat\.th\.jpg$/);
      assert.equal(f.app.media.pool.active, 1);
      button.dispatchEvent(new f.win.MouseEvent('pointerleave', { clientX: 900, clientY: 900 }));
      assert.equal(f.app.media.pool.active, 1);
    }
    assert.equal(f.c.images.length, 2, 'eight rehovers share one original request');
    assert.equal(f.app.media.pool.budget.get(record.source).attempts, attempts + 1);
    assert.equal(scans, 0);
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
  } finally { f.close(); }
});

test('moving off an enlarged thumbnail dismisses it immediately even if the small button has focus', async () => {
  const f = await setup(overlayHTML(1, 'https://x.test/a.jpg'), { inlineThumbnails: true, hideDelay: 1500 });
  try {
    const button = f.doc.querySelector('.epc-thumb-button');
    button.dispatchEvent(new f.win.MouseEvent('pointerenter', { clientX: 40, clientY: 40 })); await settle(10);
    button.focus(); assert.equal(f.doc.activeElement, button);
    button.dispatchEvent(new f.win.MouseEvent('pointerleave', { clientX: 900, clientY: 900 }));
    assert.equal(f.app.preview.open, false); assert.equal(f.app.preview.element.hidden, true);
    assert.ok(button.querySelector('img'), 'the inline thumbnail remains in place');
  } finally { f.close(); }
});

test('the enlarged image can receive the pointer, dismiss on exit, and pin on click without restarting its request', async () => {
  const f = await setup(overlayHTML(1, 'https://x.test/a.jpg'), { inlineThumbnails: true });
  try {
    const button = f.doc.querySelector('.epc-thumb-button'), preview = f.app.preview;
    const enter = async () => {
      button.dispatchEvent(new f.win.MouseEvent('pointerenter', { clientX: 40, clientY: 40 })); await settle(10);
      button.dispatchEvent(new f.win.MouseEvent('pointerleave', { clientX: 220, clientY: 220, relatedTarget: preview.frame }));
      preview.element.dispatchEvent(new f.win.MouseEvent('pointerenter'));
    };
    await enter();
    assert.equal(preview.open, true); assert.equal(preview.element.style.pointerEvents, '');
    preview.element.dispatchEvent(new f.win.MouseEvent('pointerleave', { clientX: 900, clientY: 900 }));
    assert.equal(preview.open, false);
    await enter(); const transfers = f.c.images.length;
    preview.frame.click();
    assert.equal(preview.pinned, true); assert.equal(preview.element.dataset.mode, 'controls');
    assert.equal(preview.element.getAttribute('role'), 'dialog');
    assert.equal(preview.heading.hidden, false); assert.equal(preview.actions.hidden, false);
    assert.equal(f.c.images.length, transfers);
    preview.element.dispatchEvent(new f.win.MouseEvent('pointerleave', { clientX: 900, clientY: 900 }));
    assert.equal(preview.open, true);
  } finally { f.close(); }
});

test('keyboard focus offers preview controls and touch uses click instead of hover enlargement', async () => {
  const f = await setup(overlayHTML(1, 'https://x.test/a.jpg'), { inlineThumbnails: true });
  try {
    const button = f.doc.querySelector('.epc-thumb-button');
    const touch = new f.win.MouseEvent('pointerenter'); Object.defineProperty(touch, 'pointerType', { value: 'touch' });
    button.dispatchEvent(touch); await settle(10); assert.equal(f.app.preview.open, false);
    button.focus(); await settle(10);
    assert.equal(f.app.preview.element.dataset.mode, 'controls'); assert.equal(f.app.preview.actions.hidden, false);
    button.click(); assert.equal(f.app.preview.pinned, true);
    f.app.preview.hide(true);
    assert.equal(f.app.preview.open, false);
  } finally { f.close(); }
});

test('pointer cancellation and leaving the browser dismiss transient enlargement without affecting pinned controls', async () => {
  const f = await setup(overlayHTML(1, 'https://x.test/a.jpg'), { inlineThumbnails: true });
  try {
    const button = f.doc.querySelector('.epc-thumb-button'), preview = f.app.preview;
    button.dispatchEvent(new f.win.MouseEvent('pointerenter')); await settle(10);
    button.dispatchEvent(new f.win.MouseEvent('pointercancel'));
    assert.equal(preview.open, false);
    button.dispatchEvent(new f.win.MouseEvent('pointerenter')); await settle(10);
    f.win.dispatchEvent(new f.win.Event('blur')); assert.equal(preview.open, false);
    button.click(); f.win.dispatchEvent(new f.win.Event('blur'));
    assert.equal(preview.pinned, true); assert.equal(preview.open, true);
  } finally { f.close(); }
});

test('pointer movement outside both images clears a transient enlargement after pointer capture', async () => {
  const f = await setup(overlayHTML(1, 'https://x.test/a.jpg'), { inlineThumbnails: true });
  try {
    const button = f.doc.querySelector('.epc-thumb-button');
    button.dispatchEvent(new f.win.MouseEvent('pointerenter')); await settle(10);
    f.app.preview.inside = true;
    f.win.dispatchEvent(new f.win.MouseEvent('pointermove', { clientX: 900, clientY: 900 }));
    assert.equal(f.app.preview.open, false); assert.equal(button.querySelector('img').draggable, false);
  } finally { f.close(); }
});
test('one automatic recovery pass repairs a failed thumbnail and an already-open preview', async () => {
  const f = await setup(overlayHTML(1, 'https://x.test/a.jpg'), { inlineThumbnails: false, maxRetries: 1 });
  Object.assign(f.app.media.pool.env, f.c.env);
  f.app.settings.inlineThumbnails = true; f.app.media.scan(f.doc.body);
  f.c.images[0].fail(); f.c.tick(700); f.c.images[1].fail();
  const record = [...f.app.media.thumbnails.values()][0]; assert.equal(record.state, 'failed');
  f.app.preview.showFor(f.doc.querySelector('.fixture-title')); assert.equal(f.app.preview.element.dataset.state, 'failed');
  f.c.tick(31000); assert.equal(f.c.images.length, 3);
  f.c.images[2].succeed();
  assert.equal(record.state, 'ready'); assert.equal(f.app.preview.image.hidden, false);
  f.c.tick(300000); assert.equal(f.c.images.length, 3); f.close();
});
test('turning hover off preserves thumbnails and still permits click-to-pin', async () => {
  const f = await setup(overlayHTML(1, 'https://x.test/a.jpg'), { inlineThumbnails: true });
  const pool = f.app.media.pool, image = f.doc.querySelector('.epc-thumbnail img');
  const checkbox = f.app.controls.get('previews');
  checkbox.checked = false; checkbox.dispatchEvent(new f.win.Event('change', { bubbles: true })); await settle();
  assert.equal(f.app.media.pool, pool); assert.equal(f.doc.querySelector('.epc-thumbnail img'), image);
  const button = f.doc.querySelector('.epc-thumb-button');
  button.dispatchEvent(new f.win.MouseEvent('pointerenter')); await settle(160);
  assert.equal(f.app.preview.open, false);
  button.click(); assert.equal(f.app.preview.pinned, true); f.close();
});
test('undoing preferences keeps searches saved after the automatic restore point', async () => {
  const f = await setup();
  const input = f.app.controls.get('thumbnailSize'); input.value = '80';
  input.dispatchEvent(new f.win.Event('change', { bubbles: true })); await settle();
  f.doc.querySelector('input[name="searchtext"]').value = 'keep this search'; f.app.saveCurrentSearch();
  f.app.preferences.undo();
  assert.equal(f.app.settings.thumbnailSize, 100); assert.equal(f.app.searches.length, 1);
  assert.equal(f.app.searches[0].title, 'keep this search'); f.close();
});
test('filtered-out image failures do not ask for attention during ordinary browsing', async () => {
  const f = await setup(overlayHTML(1, 'https://x.test/a.jpg'), { inlineThumbnails: true, maxRetries: 0 });
  f.c.images[0].fail(); assert.equal(f.app.media.counts().failed, 1);
  const row = f.doc.querySelector('tr.torrent'); row.classList.add('hidden');
  f.app.updateHealth();
  assert.equal(f.app.media.counts().failed, 0); assert.equal(f.app.health.hidden, true);
  f.close();
});

async function thumbnailPage({ count = 12, concurrency = 6, waitForFilters = false, noObserver = false, hidden = false } = {}) {
  let rows = '', overlays = '';
  const positions = new Map();
  for (let i = 1; i <= count; i++) {
    rows += rowHTML(i); overlays += overlayHTML(i, 'https://hamsterimg.net/images/' + i + '.jpg');
    positions.set(String(i), 20 + (i - 1) * 300);
  }
  const f = domFixture(fixtureHTML(rows, overlays)), c = fakeClock();
  if (noObserver) delete f.win.IntersectionObserver;
  Object.defineProperty(f.doc, 'hidden', { get: () => hidden });
  const baseRect = f.win.HTMLElement.prototype.getBoundingClientRect;
  f.win.HTMLElement.prototype.getBoundingClientRect = function() {
    const rect = baseRect.call(this), row = this.closest('tr[data-fixture-id]');
    if (!row) return rect;
    const top = positions.get(row.dataset.fixtureId);
    return { ...rect, top, bottom: top + 100, y: top };
  };
  const storage = memoryStorage({ 'ep.settings': { concurrency } });
  const app = createApp(f.win, storage, { Image: c.env.Image, waitForFilters }).start();
  if (!waitForFilters) await until(() => f.doc.querySelector('.epc-workspace[data-ep-ready="true"]'), 'Thumbnail fixture readiness');
  return { ...f, app, c, positions, setHidden(value) { hidden = value; f.doc.dispatchEvent(new f.win.Event('visibilitychange')); },
    close() { app.dispose(); f.close(); } };
}

test('all 50 result thumbnails warm without scrolling or an IntersectionObserver', async () => {
  const f = await thumbnailPage({ count: 50, noObserver: true });
  try {
    const last = [...f.app.media.thumbnails.values()].at(-1);
    assert.equal(f.app.media.visible(last.element, true), false);
    assert.equal(f.c.images.length, 2);
    // Each completion must start another queued image with no scroll, hover or timer.
    for (let i = 0; i < 50; i++) {
      assert.ok(f.c.images[i], 'next thumbnail starts automatically: ' + i);
      assert.match(f.c.images[i].src, /\.th\.jpg$/);
      f.c.images[i].succeed(160, 90);
      assert.ok(f.app.media.pool.active <= 6);
    }
    assert.equal(f.c.images.length, 50);
    assert.equal(last.state, 'ready');
    assert.equal([...f.app.media.thumbnails.values()].every(record => record.state === 'ready'), true);
    assert.equal(f.win.scrollY, 0);
  } finally { f.close(); }
});

test('current and nearby rows overtake distant preloads; hidden and detached rows stay unrequested', async () => {
  const f = await thumbnailPage({ count: 6, concurrency: 1, waitForFilters: true });
  try {
    f.positions.set('1', 20); f.positions.set('2', 9000); f.positions.set('3', 900);
    f.positions.set('4', 50); f.positions.set('5', 4000); f.positions.set('6', 8000);
    f.app.filtersFinished(); await settle();
    assert.match(f.c.images[0].src, /\/1\.th\.jpg$/);
    f.c.images[0].succeed(); assert.match(f.c.images[1].src, /\/4\.th\.jpg$/);
    // Reprioritize on completion using current layout, without relying on IO callbacks.
    f.positions.set('2', 30);
    const hidden = f.doc.querySelector('[data-fixture-id="3"]'); hidden.classList.add('hidden');
    f.doc.querySelector('[data-fixture-id="5"]').remove();
    f.c.images[1].succeed(); assert.match(f.c.images[2].src, /\/2\.th\.jpg$/);
    f.c.images[2].succeed(); assert.match(f.c.images[3].src, /\/6\.th\.jpg$/);
    f.c.images[3].succeed(); assert.equal(f.c.images.length, 4);
    // Unfiltering wakes the existing queue even when there are no active transfers.
    hidden.classList.remove('hidden'); await settle();
    assert.equal(f.c.images.length, 5); assert.match(f.c.images[4].src, /\/3\.th\.jpg$/);
    assert.equal(f.c.images.some(image => /\/5\.th\.jpg$/.test(image.src)), false);
  } finally { f.close(); }
});

test('page warming waits for filters and foreground visibility, then resumes the whole list', async () => {
  const f = await thumbnailPage({ waitForFilters: true, hidden: true });
  try {
    assert.equal(f.c.images.length, 0);
    f.app.filtersFinished(); assert.equal(f.c.images.length, 0);
    f.setHidden(false); await settle(); assert.equal(f.c.images.length, 2);
    f.setHidden(true); await settle();
    for (const image of [...f.c.images]) image.succeed();
    assert.equal(f.c.images.length, 2);
    f.setHidden(false); await settle(); assert.equal(f.c.images.length, 4);
    for (let i=2;i<f.c.images.length;i++) f.c.images[i].succeed();
    assert.equal([...f.app.media.thumbnails.values()].every(record => record.state === 'ready'), true);
  } finally { f.close(); }
});

test('rows added far below the fold warm automatically while an unopened gallery stays deferred', async () => {
  const f = await thumbnailPage({ count: 1 });
  try {
    f.c.images[0].succeed(); f.positions.set('2', 20000);
    f.doc.querySelector('.torrent_table tbody').insertAdjacentHTML('beforeend', rowHTML(2) + overlayHTML(2, 'https://hamsterimg.net/images/2.jpg'));
    f.doc.querySelector('#content').insertAdjacentHTML('beforeend', '<div class="hidden spoiler"><img id="still-deferred" data-src="https://x.test/gallery.jpg"></div>');
    await settle();
    assert.equal(f.c.images.length, 2); assert.match(f.c.images[1].src, /\/2\.th\.jpg$/);
    assert.equal(f.doc.getElementById('still-deferred').hasAttribute('src'), false);
  } finally { f.close(); }
});

test('[HOV-09] hover keeps the thumbnail through incomplete and failed larger loads and names the upgrade',async()=>{
  const f=await setup(overlayHTML(1,'https://hamsterimg.net/images/upgrade.jpg'),{inlineThumbnails:true,maxRetries:0});
  try{
    const record=[...f.app.media.thumbnails.values()][0],preview=f.app.preview;
    f.c.images[0].succeed(160,90);Object.defineProperty(record.image,'naturalWidth',{get:()=>160});
    preview.showFor(record.element.querySelector('button'));
    const small=preview.image.src;assert.match(preview.status.textContent,/Loading larger image/);
    const entry=[...f.app.media.pool.entries.values()].find(e=>e.url.endsWith('/upgrade.jpg')&&e.lane==='large');
    f.c.images[1].naturalWidth=900;f.c.images[1].naturalHeight=600;entry.status='streaming';f.app.media.pool.emit(entry);
    assert.equal(preview.image.src,small,'dimensions alone must not replace a loaded thumbnail');
    entry.status='partial';f.app.media.pool.emit(entry);assert.equal(preview.image.src,small);
    f.c.images[1].fail();assert.equal(preview.image.src,small);assert.equal(preview.image.hidden,false);
    assert.match(preview.status.textContent,/Larger image unavailable.*thumbnail/);
    f.app.media.pool.budget.get(entry.url).last-=31001;
    preview.retry();await until(()=>f.c.images.length===3);f.c.images.at(-1).succeed(900,600);assert.match(preview.image.src,/\/upgrade\.jpg(?:\?|$)/);assert.equal(preview.status.textContent,'');
  }finally{f.close();}
});

test('[HOV-09] completed hover images are displayed from memory and stay usable through retry and cache reuse',async()=>{
  const f=domFixture(fixtureHTML(undefined,overlayHTML(1,'https://hamsterimg.net/images/memory.jpg'))),images=[];
  function NativeTestImage(){const img=f.doc.createElement('img');let w=0,h=0;
    Object.defineProperties(img,{naturalWidth:{get:()=>w},naturalHeight:{get:()=>h}});
    img.succeed=()=>{w=900;h=600;img.onload?.();};images.push(img);return img;}
  const app=createApp(f.win,memoryStorage({'ep.settings':{inlineThumbnails:true}}),{Image:NativeTestImage}).start();
  await until(()=>app.root?.dataset.epReady==='true');
  try{
    const record=[...app.media.thumbnails.values()][0],preview=app.preview,button=record.element.querySelector('button');
    images[0].succeed();Object.defineProperty(record.image,'naturalWidth',{get:()=>160});preview.showFor(button);
    const full=images[1];full.succeed();assert.equal(preview.image,full,'adopt the successful detached image instead of assigning its URL again');
    assert.equal(full.parentElement,preview.frame);preview.retry();assert.ok(full.hasAttribute('src'),'retry retains the completed displayed image');
    images.at(-1).succeed();const latest=preview.image;preview.hide();assert.equal(latest.isConnected,false);assert.ok(latest.hasAttribute('src'),'hide must not erase the cached image');
    preview.showFor(button);assert.equal(preview.image,latest,'re-entry reuses the exact loaded node');assert.equal(images.length,3);
  }finally{app.dispose();f.close();}
});

test('[HOV-09] a shared page image stays in place and a failed or stale display copy cannot replace the thumbnail',async()=>{
  const f=await setup(overlayHTML(1,'https://hamsterimg.net/images/shared.jpg'),{inlineThumbnails:true});
  try{
    const record=[...f.app.media.thumbnails.values()][0],preview=f.app.preview,button=record.element.querySelector('button');
    f.c.images[0].succeed(160,90);Object.defineProperty(record.image,'naturalWidth',{get:()=>160});
    const owned=f.doc.createElement('img');Object.defineProperties(owned,{naturalWidth:{get:()=>900},naturalHeight:{get:()=>600},complete:{get:()=>true}});
    f.doc.querySelector('#content').append(owned);
    f.app.media.pool.request(record.source,{lane:'large',target:owned});owned.onload();
    preview.showFor(button);const small=preview.image.src;assert.equal(owned.parentElement.id,'content');
    assert.ok(preview.pendingImage);assert.equal(preview.image.src,small);
    preview.pendingImage.onerror();assert.equal(preview.image.src,small);assert.match(preview.status.textContent,/unavailable/);
    preview.showFor(button);const stale=preview.pendingImage,late=stale.onload;preview.hide();late();assert.equal(preview.open,false);assert.equal(preview.image.hasAttribute('src'),false);
    preview.showFor(button);const copy=preview.pendingImage;Object.defineProperty(copy,'naturalWidth',{get:()=>900});copy.onload();
    assert.equal(preview.image,copy);assert.equal(owned.parentElement.id,'content');assert.equal(preview.status.textContent,'');
  }finally{f.close();}
});

test('[TITLE-01] title hover is a temporary site-style tooltip using the ready thumbnail, with ordinary link focus and clicks',async()=>{
  const f=await setup(overlayHTML(1,'https://hamsterimg.net/images/title.jpg'),{inlineThumbnails:true,hoverDelay:20,hideDelay:1500});
  try{
    const record=[...f.app.media.thumbnails.values()][0],link=f.doc.querySelector('.fixture-title'),preview=f.app.preview;
    f.c.images[0].succeed(160,90);Object.defineProperty(record.image,'naturalWidth',{get:()=>160});
    link.focus();await settle(30);assert.equal(preview.open,false,'normal link focus must not open preview controls');
    link.dispatchEvent(new f.win.MouseEvent('pointerenter'));
    const nativeContext=new f.win.MouseEvent('contextmenu',{bubbles:true,cancelable:true});link.dispatchEvent(nativeContext);
    await settle(30);assert.equal(nativeContext.defaultPrevented,false);
    assert.equal(preview.open,false,'right-click before the hover delay must cancel the pending tooltip');
    link.dispatchEvent(new f.win.MouseEvent('pointerleave',{clientX:900,clientY:900}));
    link.dispatchEvent(new f.win.MouseEvent('pointerenter',{clientX:60,clientY:30}));await settle(30);
    assert.equal(preview.element.dataset.mode,'tooltip');assert.equal(preview.element.getAttribute('role'),'tooltip');
    assert.equal(preview.actions.hidden,true);assert.equal(preview.heading.hidden,true);assert.equal(preview.summary.hidden,false);
    assert.match(preview.image.src,/title\.th\.jpg$/);assert.equal(f.c.images.length,1,'title tooltip reuses thumbnail work without starting an original');
    assert.equal(preview.element.style.pointerEvents,'none');
    link.dispatchEvent(new f.win.MouseEvent('pointerleave',{clientX:900,clientY:900}));assert.equal(preview.open,false,'mouseleave closes despite focused title and long hide delay');
    assert.match(link.href,/torrents\.php\?id=1$/);assert.equal(preview.pinned,false);
  }finally{f.close();}
});

test('[TITLE-01] title-only layouts use the shared small-first loader and cancel abandoned work',async()=>{
  const f=await setup(overlayHTML(1,'https://hamsterimg.net/images/title-only.jpg'),{inlineThumbnails:false,hoverDelay:0});
  try{
    const link=f.doc.querySelector('.fixture-title'),preview=f.app.preview;
    link.dispatchEvent(new f.win.MouseEvent('pointerenter'));await settle(10);
    assert.equal(preview.element.dataset.mode,'tooltip');assert.match(f.c.images[0].src,/title-only\.th\.jpg$/);
    assert.equal(f.app.media.pool.active,1);link.dispatchEvent(new f.win.MouseEvent('pointerleave',{clientX:900,clientY:900}));
    assert.equal(preview.open,false);assert.equal(f.app.media.pool.active,0);
    f.c.images[0].succeed();assert.equal(preview.image.hasAttribute('src'),false,'late response cannot reopen title tooltip');
  }finally{f.close();}
});

test('[TITLE-01] moving between title tooltip and thumbnail keeps one upgrade path and normal title navigation',async()=>{
  const f=await setup(overlayHTML(1,'https://hamsterimg.net/images/linked.jpg'),{inlineThumbnails:true,hoverDelay:0});
  try{
    const record=[...f.app.media.thumbnails.values()][0],link=f.doc.querySelector('.fixture-title'),button=record.element.querySelector('button'),preview=f.app.preview;
    f.c.images[0].succeed(160,90);Object.defineProperty(record.image,'naturalWidth',{get:()=>160});
    for(let i=0;i<4;i++){
      link.dispatchEvent(new f.win.MouseEvent('pointerenter'));await settle(10);
      assert.equal(preview.element.dataset.mode,'tooltip');assert.match(preview.image.src,/linked\.th\.jpg$/);
      link.dispatchEvent(new f.win.MouseEvent('pointerleave',{clientX:900,clientY:900}));
    }
    assert.equal(f.c.images.length,1);
    button.dispatchEvent(new f.win.MouseEvent('pointerenter'));await settle(10);
    assert.equal(preview.element.dataset.mode,'zoom');assert.equal(f.c.images.length,2);
    assert.match(f.c.images[1].src,/\/linked\.jpg$/);f.c.images[1].succeed();
    button.dispatchEvent(new f.win.MouseEvent('pointerleave',{clientX:900,clientY:900}));
    link.dispatchEvent(new f.win.MouseEvent('pointerenter'));await settle(10);
    const nativeMenu=new f.win.MouseEvent('contextmenu',{bubbles:true,cancelable:true});link.dispatchEvent(nativeMenu);
    assert.equal(nativeMenu.defaultPrevented,false);assert.equal(preview.open,false);
    let prevented;
    const navigate=event=>{prevented=event.defaultPrevented;event.preventDefault();};f.win.addEventListener('click',navigate,{once:true});
    link.dispatchEvent(new f.win.MouseEvent('click',{bubbles:true,cancelable:true}));
    assert.equal(prevented,false);assert.equal(preview.pinned,false);
  }finally{f.close();}
});

test('[TITLE-01] an open title tooltip keeps queued shared loading alive when inline thumbnails are disabled',async()=>{
  const f=await setup(overlayHTML(1,'https://hamsterimg.net/images/one.jpg')+overlayHTML(2,'https://hamsterimg.net/images/two.jpg'),{inlineThumbnails:true,concurrency:1,hoverDelay:0});
  try{
    const links=f.doc.querySelectorAll('.fixture-title');assert.equal(f.c.images.length,1);
    links[1].dispatchEvent(new f.win.MouseEvent('pointerenter'));await settle(10);
    const previous={...f.app.settings};f.app.settings.inlineThumbnails=false;f.app.media.updateSettings(previous);
    assert.equal(f.c.images.length,2,'removing the first inline transfer starts the tooltip-owned queued transfer');
    assert.match(f.c.images[1].src,/\/two\.th\.jpg$/);f.c.images[1].succeed(160,90);
    assert.equal(f.app.preview.element.dataset.state,'ready');assert.match(f.app.preview.image.src,/\/two\.th\.jpg$/);
    assert.equal(f.errors.length,0,f.errors.join('\n'));
  }finally{f.close();}
});
