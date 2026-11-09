// SPDX-License-Identifier: GPL-3.0-or-later
import { emporniumAccountID, validateSearches, validateSettings } from './core.mjs';
import { compileConditionalRules } from './conditional-rules.mjs';
import { templatePassphraseWords } from './template-passphrase-words.mjs';
import { optionGroup } from './workspace.mjs';

const templateName = 'Companion';
const templatePassphraseKey = 'ep.templatePassphrase';
const templateWordCount = 8;
const templateFormat = 'companion-settings-v1';
const templateMaxPayload = 1024 * 1024;
const templatePrivateOptions = '#template optgroup[label="private templates"] option';
const templateLocalSettings = ['diagnostics', 'persistentImages', 'persistentCacheMB'];
const templateLocalNSE = new Set(['nseSavedVersion', 'nseCustomCSS', 'nseCustomCSSEnabled',
  'nseIndividualUploadHidingBlacklist', 'nseIndividualUploadHidingWhitelist']);

function generateTemplatePassphrase(crypto) {
  const size = templatePassphraseWords.length;
  const limit = 65536 - 65536 % size;
  const draw = new Uint16Array(1);
  const words = [];
  while (words.length < templateWordCount) {
    crypto.getRandomValues(draw);
    if (draw[0] < limit) words.push(templatePassphraseWords[draw[0] % size]);
  }
  return words.join(' ');
}

function normalizeTemplatePassphrase(input) {
  const words = input.trim().toLowerCase().split(/[\s-]+/);
  if (words.length !== templateWordCount || words.some(word => !templatePassphraseWords.includes(word))) {
    throw new Error('Enter all eight words from Copy passphrase on your other device, in the same order.');
  }
  return words.join(' ');
}

function portableTemplateData(app, nseKeys, data) {
  if (!data?.settings || typeof data.settings !== 'object' || Array.isArray(data.settings) ||
      !data.nse || typeof data.nse !== 'object' || Array.isArray(data.nse)) {
    throw new Error('The Companion template contains invalid settings.');
  }
  const settings = validateSettings(data.settings);
  for (const key of templateLocalSettings) delete settings[key];
  compileConditionalRules(settings.conditionalRules);
  const nse = {};
  for (const key of nseKeys) if (Object.hasOwn(data.nse, key)) nse[key] = data.nse[key];
  return { settings, nse: app.options.validateNSE(nse), searches: validateSearches(data.searches) };
}

function templateBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function templateUnbase64(text) {
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}

async function deriveTemplateKey(crypto, passphrase, salt, usage) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt }, material,
    { name: 'AES-GCM', length: 256 }, false, [usage]);
}

function templateCipherParams(iv, account) {
  return { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(templateFormat + ':' + account) };
}

async function encryptTemplateSettings(crypto, passphrase, account, settings) {
  const bytes = new TextEncoder().encode(JSON.stringify(settings));
  if (bytes.length > Math.floor((templateMaxPayload - 100) * 3 / 4)) {
    throw new Error('These settings are too large for a template. Transfer them using Backup & restore.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveTemplateKey(crypto, passphrase, salt, 'encrypt');
  const ciphertext = await crypto.subtle.encrypt(templateCipherParams(iv, account), key, bytes);
  return [templateFormat, templateBase64(salt), templateBase64(iv), templateBase64(new Uint8Array(ciphertext))].join('.');
}

async function decryptTemplateSettings(crypto, passphrase, account, payload) {
  const format = /^companion-settings-v1\.([\w-]{22})\.([\w-]{16})\.([\w-]{22,})$/;
  const fields = payload.length <= templateMaxPayload && format.exec(payload);
  if (!fields) throw new Error('The private Companion template does not contain a supported settings snapshot. It was left alone.');
  try {
    const [salt, iv, ciphertext] = fields.slice(1).map(templateUnbase64);
    const key = await deriveTemplateKey(crypto, passphrase, salt, 'decrypt');
    const bytes = await crypto.subtle.decrypt(templateCipherParams(iv, account), key, ciphertext);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('Could not unlock the Companion template. Check that you entered the same passphrase used to write it.');
  }
}

class EmpTemplate {
  constructor(app, fetch, signal) {
    this.doc = app.doc;
    this.fetch = fetch;
    this.signal = signal;
    this.upload = new URL('/upload.php', app.win.location.href);
    this.account = emporniumAccountID(app.doc, this.upload);
    if (!this.account) throw new Error('Sign in to Emp before using the Companion template.');
  }

  async request(url, fields) {
    let response;
    try {
      response = await this.fetch(url.href, {
        method: fields ? 'POST' : 'GET', body: fields ? new URLSearchParams(fields) : undefined,
        mode: 'same-origin', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: this.signal
      });
    } catch {
      throw new Error('Could not connect to Emp. Check your session and try again.');
    }
    if (!response.ok || response.url && response.url !== url.href) {
      throw new Error('Emp could not open the template. Check that your account can use private upload templates.');
    }
    const text = await response.text();
    if (text.length > 8 * 1024 * 1024) throw new Error('Emp returned a page that was too large to check.');
    return text;
  }

  async page(fields) {
    const template = this.doc.createElement('template');
    template.innerHTML = await this.request(this.upload, fields);
    const root = template.content;
    if (emporniumAccountID(root, this.upload) !== this.account) throw new Error('Your Emp session changed. Sign in and try again.');
    const select = root.querySelector('select#template[name="template"]');
    if (!select) throw new Error('Private upload templates are unavailable for this Emp account.');
    const matches = [...root.querySelectorAll(templatePrivateOptions)].filter(option => option.textContent.trim() === templateName);
    if (matches.length > 1) throw new Error('Emp has more than one private template named Companion. Review them on the Upload page.');
    const id = matches[0]?.value || '';
    if (id && !/^[1-9]\d{0,14}$/.test(id)) throw new Error('Emp returned an invalid template ID.');
    return { id, select, root };
  }

  async read(id) {
    if (!id) throw new Error('No private Companion template yet. Use Write on the device that has your settings.');
    const page = await this.page({ fill: 'fill from', template: id });
    const body = page.root.querySelector('textarea#desc[name="desc"]');
    if (!body || page.id !== id || page.select.value !== id) throw new Error('Emp could not load the private Companion template.');
    return body.value;
  }

  async write(id, payload) {
    let result;
    try {
      const saveURL = new URL('/upload.php?action=add_template', this.upload);
      result = JSON.parse(await this.request(saveURL, {
        templateID: id || '0', name: templateName, ispublic: '0', title: '', image: '', category: '0', tags: '', body: payload
      }));
    } catch {
      throw new Error('Emp did not confirm the write. Use Read to check the template before trying again.');
    }
    if (Array.isArray(result) && result[0] === 0) {
      throw new Error('Emp declined the save. Check that your account can create and edit private upload templates.');
    }
    try {
      if (!Array.isArray(result) || result[0] !== 1) throw new Error();
      const saved = await this.page();
      if ((id && saved.id !== id) || await this.read(saved.id) !== payload) throw new Error();
    } catch {
      throw new Error('Emp did not confirm the write. Use Read to check the template before trying again.');
    }
  }
}

export function mountTemplateSync(app) {
  const { win, storage } = app;
  const { prompt, copyPassphrase, nseSchema, requireTrusted = true } = app.options.empTemplate;
  const nseKeys = Object.keys(nseSchema).filter(key => !templateLocalNSE.has(key) && nseSchema[key] !== 'array');
  const fetch = app.options.fetch || win.fetch?.bind(win);
  const crypto = win.crypto;
  const group = optionGroup(app, app.panes.settings, 'Experimental', { key: 'experimental', searchable: true });
  const panel = app.node('div');
  panel.dataset.optionItem = '';
  const status = app.node('p', '', 'epc-caption');
  status.setAttribute('role', 'status');
  const preview = app.node('div');
  const secret = () => storage.get(templatePassphraseKey, '');
  const templateButton = (label, action) => app.button(label, event => {
    if (event.isTrusted || !requireTrusted) action();
  });
  const copy = templateButton('Copy passphrase', () => {
    try {
      copyPassphrase(secret());
      status.textContent = 'Passphrase copied. Enter it in Experimental on your other device.';
    } catch { status.textContent = 'Could not copy. Use Show or change passphrase to copy or type the words.'; }
  });
  const change = templateButton('Show or change passphrase', () => {
    try {
      const previous = secret();
      const entered = prompt('Use the same eight words in the same order on every Companion installation.', previous);
      if (entered === null) return;
      const next = normalizeTemplatePassphrase(entered);
      if (next !== previous) {
        storage.set(templatePassphraseKey, next);
        preview.replaceChildren();
      }
      status.textContent = 'Passphrase ready on this device.';
    } catch (error) { status.textContent = error.message; }
  });
  const write = templateButton('Write to Companion Template', () => void transfer('write'));
  const read = templateButton('Read from Companion Template', () => void transfer('read'));
  const buttons = [copy, change, write, read];
  const setDisabled = disabled => {
    for (const button of buttons) button.disabled = disabled;
    copy.disabled ||= !copyPassphrase;
    change.disabled ||= !prompt;
  };
  const secretActions = app.node('div', null, 'epc-actions');
  const transferActions = app.node('div', null, 'epc-actions');
  secretActions.append(copy, change);
  transferActions.append(write, read);
  panel.append(app.node('h4', 'Companion settings across devices'),
    app.node('p', 'On your first device, copy or show the generated passphrase, then choose Write. On your other device, choose Show or change passphrase and enter the same eight words, then choose Read.', 'epc-caption'),
    secretActions,
    app.node('p', 'Use the same Emp account and passphrase on every installation. Write saves or replaces the encrypted settings, filter rules, and saved searches in your private Companion upload template. Read previews changes before replacing the settings on this device.', 'epc-caption'),
    app.node('p', 'Your passphrase, custom CSS, per-torrent history and overrides, collage pins, image cache, and diagnostic data stay on this device. Image retention and diagnostic logging choices stay local too.', 'epc-caption'),
    transferActions, status, preview);
  group.append(panel);

  try {
    if (!fetch || !crypto?.subtle) throw new Error('Template transfer is unavailable in this browser.');
    if (!secret()) storage.set(templatePassphraseKey, generateTemplatePassphrase(crypto));
    setDisabled(false);
  } catch (error) {
    setDisabled(true);
    status.textContent = !fetch || !crypto?.subtle ? error.message :
      'Could not save the passphrase on this device. Reload Companion and try again.';
  }

  const currentSettings = () => ({ ...app.settings, ...storage.get('ep.settings', {}) });
  const currentSnapshot = () => {
    const nse = {};
    for (const key of nseKeys) {
      const value = storage.get(key, undefined);
      if (value !== undefined) nse[key] = value;
    }
    return portableTemplateData(app, nseKeys, {
      settings: currentSettings(), nse, searches: storage.get('ep.searches', app.searches)
    });
  };
  const signature = data => JSON.stringify(data);

  function showPreview(incoming, localChanged = false) {
    const current = currentSnapshot();
    preview.replaceChildren();
    if (signature(current) === signature(incoming)) {
      status.textContent = 'Your settings already match the Companion template.';
      return;
    }
    status.textContent = localChanged ? 'Local settings changed. Review the updated preview and choose Apply settings again.' :
      'Review the changes before replacing your settings on this device.';
    const changes = app.node('ul', null, 'epc-caption');
    for (const [key, label] of [['settings', 'Companion preferences'], ['nse', 'Filter and theme preferences']]) {
      const keys = new Set([...Object.keys(current[key]), ...Object.keys(incoming[key])]);
      const count = [...keys].filter(name => signature(current[key][name]) !== signature(incoming[key][name])).length;
      if (count) changes.append(app.node('li', `${label} · ${count} to update`));
    }
    if (signature(current.searches) !== signature(incoming.searches)) {
      changes.append(app.node('li', `Saved searches · replace ${current.searches.length} local with ${incoming.searches.length} from Emp`));
    }
    const apply = templateButton('Apply settings', () => {
      if (!app.preferences.flush()) return;
      try {
        if (signature(current) !== signature(currentSnapshot())) {
          showPreview(incoming, true);
          return;
        }
        const settings = { ...currentSettings(), ...incoming.settings };
        app.importData(JSON.stringify({ format: 'empornium-companion', version: 1, ...incoming, settings }),
          true, { replaceNSEKeys: nseKeys });
        status.textContent = 'Settings applied. To undo, use Backup & restore → Restore previous import.';
        preview.replaceChildren();
      } catch (error) { status.textContent = error.message; }
    });
    preview.append(changes, apply, app.button('Cancel', () => {
      preview.replaceChildren();
      status.textContent = 'Import canceled.';
    }));
  }

  async function transfer(operation) {
    if (!app.preferences.flush()) {
      status.textContent = 'Resolve the unsaved setting before transferring settings.';
      return;
    }
    preview.replaceChildren();
    setDisabled(true);
    status.textContent = operation === 'write' ? 'Writing settings to Emp…' : 'Reading settings from Emp…';
    try {
      const signal = win.AbortSignal.timeout(20000);
      const passphrase = secret();
      if (!passphrase) throw new Error('Set a passphrase before transferring settings.');
      const remote = new EmpTemplate(app, fetch, signal);
      const { id } = await remote.page();
      const readSnapshot = async () => {
        const decoded = await decryptTemplateSettings(crypto, passphrase, remote.account, await remote.read(id));
        return portableTemplateData(app, nseKeys, decoded);
      };
      if (operation === 'read') {
        const incoming = await readSnapshot();
        if (passphrase !== secret()) throw new Error('The passphrase changed. Read the template again.');
        showPreview(incoming);
        return;
      }
      const local = currentSnapshot();
      if (id && signature(local) === signature(await readSnapshot())) {
        status.textContent = 'The Companion template already has these settings.';
        return;
      }
      const payload = await encryptTemplateSettings(crypto, passphrase, remote.account, local);
      if (passphrase !== secret() || emporniumAccountID(app.doc, remote.upload) !== remote.account) {
        throw new Error('Your Emp session or passphrase changed. Review it before writing again.');
      }
      await remote.write(id, payload);
      status.textContent = 'Saved and verified the private Companion template on Emp.';
    } catch (error) { status.textContent = error.message; }
    finally { setDisabled(false); }
  }
}
