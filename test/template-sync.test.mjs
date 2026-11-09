import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/app.mjs';
import { escapeHTML } from '../src/core.mjs';
import { validateNSE } from '../src/nse-settings.mjs';
import { domFixture, fixtureHTML, memoryStorage, until } from './helpers.mjs';

const schema = JSON.parse(await readFile(new URL('../dist/nse-schema.json', import.meta.url), 'utf8'));
const account = '<div id="userinfo_username"><a href="/user.php?id=42">Example account</a></div>';
const secretKey = 'ep.templatePassphrase';
const search = title => ({ id: title, title, fields: [{ name: 'taglist', type: 'text', value: title }] });

function fakeEmp() {
  const writes = [], requests = [];
  const templates = new Map();
  const html = (selected = '') => account + '<select id="template" name="template"><option value="0">---</option>' +
    '<optgroup label="private templates">' + [...templates].map(([id, item]) =>
      '<option value="' + id + '"' + (id === selected ? ' selected' : '') + '>' + escapeHTML(item.name) + '</option>').join('') +
    '</optgroup><optgroup label="public templates"><option value="99">Companion</option></optgroup></select>' +
    '<textarea id="desc" name="desc">' + escapeHTML(templates.get(selected)?.body || '') + '</textarea>';
  const fetch = async (url, options) => {
    const path = new URL(url);
    const fields = options.body;
    assert.equal(path.origin, 'https://www.empornium.sx');
    assert.equal(path.pathname, '/upload.php');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    requests.push([options.method, path.search, fields]);
    if (options.method === 'GET') return new Response(html());
    if (!path.search) {
      assert.equal(fields.get('fill'), 'fill from');
      return new Response(html(fields.get('template')));
    }
    assert.equal(path.search, '?action=add_template');
    assert.equal(fields.get('ispublic'), '0');
    assert.equal(fields.has('submit'), false);
    const id = fields.get('templateID') === '0' ? '41' : fields.get('templateID');
    const item = { name: fields.get('name'), body: fields.get('body') };
    writes.push([fields.get('templateID'), item.body]);
    templates.set(id, item);
    return Response.json([1, 'Saved']);
  };
  return { fetch, requests, templates, writes };
}

async function installation(t, emp, initial) {
  const f = domFixture(fixtureHTML(undefined, account));
  Object.defineProperty(f.win, 'crypto', { value: webcrypto });
  const storage = memoryStorage(initial);
  let clipboard, entered;
  const app = createApp(f.win, storage, {
    fetch: emp.fetch, validateNSE: values => validateNSE(values, schema),
    empTemplate: { nseSchema: schema, requireTrusted: false,
      prompt: (_message, previous) => { assert.equal(previous, storage.get(secretKey)); return entered; },
      copyPassphrase: text => { clipboard = text; } }
  }).start();
  t.after(() => { app.dispose(); f.close(); });
  await until(() => app.panes?.settings?.querySelector('[data-option-group=experimental]'));
  app.openPane('settings');
  const group = app.panes.settings.querySelector('[data-option-group=experimental]');
  group.open = true;
  return { app, storage, group, clipboard: () => clipboard, enter: value => { entered = value; },
    click: name => [...group.querySelectorAll('button')].find(button => button.textContent === name).click(),
    status: () => group.querySelector('[role=status]').textContent };
}

async function decryptSaved(passphrase, payload) {
  const [version, salt, iv, ciphertext] = payload.split('.');
  assert.equal(version, 'companion-settings-v1');
  const bytes = value => Buffer.from(value, 'base64url');
  const material = await webcrypto.subtle.importKey('raw', Buffer.from(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: bytes(salt) },
    material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: Buffer.from(version + ':42') },
    key, bytes(ciphertext));
  return JSON.parse(Buffer.from(plain).toString());
}

test('experimental settings round-trip between devices and preserve private local data', async t => {
  const emp = fakeEmp();
  const a = await installation(t, emp, {
    'ep.settings': { favoriteTags: 'demo.favorite', cautionTags: 'demo.caution', resultsView: 'grid',
      diagnostics: true, persistentImages: true, persistentCacheMB: 1024 },
    'ep.searches': [search('demo.search')],
    nseTaglist: 'demo.blocked', nseCustomCSS: '/* private CSS */', nseCustomCSSEnabled: true,
    nseIndividualUploadHidingBlacklist: ['4242'], nseIndividualUploadHidingWhitelist: ['4343'],
    nseSavedVersion: 7, nseUnknown: 'unsupported',
    'ep.seen.1': { title: 'private history' }, 'ep.collageQuickAdd:demo': 'private pin', 'ep.hostHistory': ['private host']
  });
  const b = await installation(t, emp, {
    'ep.settings': { favoriteTags: 'local.favorite', diagnostics: false, persistentImages: false, persistentCacheMB: 64 },
    'ep.searches': [search('local.search')], nseWhitelist: 'local.rule', nseCustomCSS: '/* local CSS */',
    nseCustomCSSEnabled: false, nseIndividualUploadHidingBlacklist: ['99'], 'ep.seen.2': { title: 'local history' }
  });
  const phrase = a.storage.get(secretKey);
  assert.match(phrase, /^(?:[a-z]+ ){7}[a-z]+$/);
  assert.notEqual(phrase, b.storage.get(secretKey));
  assert.ok(!a.group.outerHTML.includes(phrase));
  assert.ok(!JSON.stringify(a.app.exportData()).includes(phrase));
  assert.equal(emp.requests.length, 0, 'opening Settings does not contact Emp');
  a.click('Copy passphrase');
  assert.equal(a.clipboard(), phrase);

  a.click('Write to Companion Template');
  await until(() => a.status().includes('Saved and verified'), a.status(), 5000);
  assert.deepEqual(emp.requests.map(([method, path]) => [method, path]),
    [['GET', ''], ['POST', '?action=add_template'], ['GET', ''], ['POST', '']]);
  const [[createdID, payload]] = emp.writes;
  assert.equal(createdID, '0', 'a same-named public template is never used');
  assert.ok(!payload.includes(phrase) && !payload.includes('demo'));
  const decoded = await decryptSaved(phrase, payload);
  assert.deepEqual(Object.keys(decoded), ['settings', 'nse', 'searches']);
  for (const key of ['diagnostics', 'persistentImages', 'persistentCacheMB']) assert.ok(!Object.hasOwn(decoded.settings, key));
  assert.deepEqual(decoded.nse, { nseTaglist: 'demo.blocked' });
  assert.equal(decoded.settings.favoriteTags, 'demo.favorite');
  assert.equal(decoded.settings.resultsView, 'grid');
  assert.equal(decoded.searches[0].title, 'demo.search');

  b.click('Write to Companion Template');
  await until(() => b.status().includes('Could not unlock'), b.status(), 5000);
  assert.equal(emp.writes.length, 1, 'a different passphrase cannot overwrite the template');
  b.enter(phrase.toUpperCase().replaceAll(' ', '-'));
  b.click('Show or change passphrase');
  assert.equal(b.storage.get(secretKey), phrase);
  b.click('Read from Companion Template');
  await until(() => b.status().includes('Review the changes'), b.status(), 5000);
  assert.equal(b.app.settings.favoriteTags, 'local.favorite');
  b.storage.set('ep.searches', [search('changed.search')]);
  b.click('Apply settings');
  assert.match(b.status(), /Local settings changed/);
  b.click('Apply settings');
  assert.match(b.status(), /Settings applied/);
  assert.equal(b.app.settings.favoriteTags, 'demo.favorite');
  assert.equal(b.app.settings.cautionTags, 'demo.caution');
  assert.equal(b.app.settings.resultsView, 'grid');
  assert.equal(b.app.settings.diagnostics, false);
  assert.equal(b.app.settings.persistentImages, false);
  assert.equal(b.app.settings.persistentCacheMB, 64);
  assert.equal(b.app.searches[0].title, 'demo.search');
  assert.equal(b.storage.get('nseTaglist'), 'demo.blocked');
  assert.equal(b.storage.get('nseWhitelist'), undefined, 'absent portable fields reset to defaults');
  assert.equal(b.storage.get('nseCustomCSS'), '/* local CSS */');
  assert.equal(b.storage.get('nseCustomCSSEnabled'), false);
  assert.deepEqual(b.storage.get('nseIndividualUploadHidingBlacklist'), ['99']);
  assert.deepEqual(b.storage.get('ep.seen.2'), { title: 'local history' });
  assert.equal(b.storage.get(secretKey), phrase);
  const undo = b.storage.get('ep.previousImport');
  assert.equal(undo.settings.favoriteTags, 'local.favorite');
  assert.equal(undo.searches[0].title, 'changed.search');

  b.storage.set('ep.settings', { ...b.app.settings, favoriteTags: 'demo.updated' });
  b.click('Write to Companion Template');
  await until(() => b.status().includes('Saved and verified'), b.status(), 5000);
  assert.equal(emp.templates.size, 1);
  assert.equal(emp.writes[1][0], '41', 'writes update the existing private template');
  assert.equal((await decryptSaved(phrase, emp.writes[1][1])).settings.favoriteTags, 'demo.updated');
});

test('template writes leave unrelated or ambiguous private templates intact', async t => {
  const emp = fakeEmp();
  const f = await installation(t, emp, {});
  emp.templates.set('41', { name: 'Companion', body: 'An unrelated upload template' });
  f.click('Write to Companion Template');
  await until(() => f.status().includes('does not contain a supported settings snapshot'));
  emp.templates.set('42', { name: 'Companion', body: 'Another unrelated upload template' });
  f.click('Write to Companion Template');
  await until(() => f.status().includes('more than one private template'));
  assert.equal(emp.writes.length, 0);
});

test('the packaged userscript generates a passphrase and ignores page-script clicks', async t => {
  const f = domFixture(fixtureHTML(undefined, account));
  t.after(() => f.close());
  const storage = memoryStorage();
  Object.defineProperty(f.win, 'crypto', { value: webcrypto });
  Object.assign(f.win, {
    GM_getValue: storage.get, GM_setValue: storage.set, GM_listValues: storage.list, GM_deleteValue: storage.delete,
    GM_registerMenuCommand: () => {}, GM_addStyle: () => {},
    GM_setClipboard: () => assert.fail('A page-script click copied the passphrase'),
    fetch: () => assert.fail('A page-script click contacted Emp')
  });
  f.win.eval(await readFile(new URL('../dist/EmporniumCompanion.user.js', import.meta.url), 'utf8'));
  await until(() => f.doc.querySelector('[data-option-group=experimental]'));
  const group = f.doc.querySelector('[data-option-group=experimental]');
  const phrase = storage.get(secretKey);
  assert.match(phrase, /^(?:[a-z]+ ){7}[a-z]+$/);
  assert.ok(!group.outerHTML.includes(phrase));
  const buttons = [...group.querySelectorAll('button')];
  assert.ok(buttons.every(button => !button.disabled));
  for (const button of buttons) button.click();
  assert.equal(group.querySelector('[role=status]').textContent, '');
});
