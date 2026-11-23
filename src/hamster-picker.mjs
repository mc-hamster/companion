// SPDX-License-Identifier: GPL-3.0-or-later
import { forumButton, forumElement } from './forum-ui.mjs';
import {
  HAMSTER_JOB_PREFIX, HAMSTER_PICKER_HASH, HAMSTER_PICKER_SESSION, HAMSTER_SELECTION_LIMIT,
  hamsterAccountKey, hamsterGalleryImage, hamsterImage, hamsterKey, hamsterPageURL, readHamsterRequest
} from './hamster-media.mjs';

function hamsterProfile(doc, service) {
  const menu = doc.querySelector('#top-bar-user,li[data-nav="user"]');
  const profile = menu?.querySelector('a:has(.fa-id-card)') || menu?.querySelector('.pop-box-menu a[href]');
  return {
    profile: hamsterPageURL(profile?.getAttribute('href'), service),
    files: hamsterPageURL(menu?.querySelector('a:has(.fa-photo-film)')?.getAttribute('href'), service),
    albums: hamsterPageURL(menu?.querySelector('a:has(.fa-images)')?.getAttribute('href'), service)
  };
}

export function mountHamsterPicker(win, storage, service, addStyle, css) {
  const doc = win.document;
  if (doc.querySelector('.epc-hamster-picker')) return;
  const page = new URL(win.location.href);
  const fromLink = new URLSearchParams(page.hash.slice(1)).get(HAMSTER_PICKER_HASH);
  let pending;
  try { pending = JSON.parse(win.sessionStorage.getItem(HAMSTER_PICKER_SESSION) || 'null'); } catch {}
  const id = fromLink || pending?.id;
  const job = readHamsterRequest(storage, id, service, win.Date.now());
  if (!job || job.result) return;

  function persist(selection = {}) {
    try { win.sessionStorage.setItem(HAMSTER_PICKER_SESSION, JSON.stringify({ ...selection, id })); } catch {}
  }
  persist(pending?.id === id ? pending : {});
  if (fromLink) {
    page.hash = '';
    win.history.replaceState(win.history.state, '', page.href);
  }

  const { profile, files, albums } = hamsterProfile(doc, service);
  if (job.action === 'browse' && profile && page.pathname === service.pathname && profile.pathname !== page.pathname) {
    win.location.replace((files || profile).href);
    return;
  }

  addStyle(css);
  const panel = forumElement(doc, 'section', 'epc-root epc-hamster-picker');
  panel.setAttribute('aria-label', 'Companion Hamsterimg picker');
  const title = forumElement(doc, 'h2', '', job.action === 'connect' ? 'Connect Hamsterimg' : 'Choose images for your reply');
  const status = forumElement(doc, 'p', 'epc-hamster-status');
  status.setAttribute('role', 'status');
  panel.append(title);
  doc.body.append(panel);

  const getActive = () => {
    const active = readHamsterRequest(storage, id, service, win.Date.now());
    if (active && !active.result) return active;
    status.textContent = 'This request ended. Open Image in your forum reply to start again.';
    return null;
  };
  function complete(active, result, message) {
    storage.set(HAMSTER_JOB_PREFIX + id, { ...active, result });
    try { win.sessionStorage.removeItem(HAMSTER_PICKER_SESSION); } catch {}
    const done = forumButton(doc, 'Done');
    done.addEventListener('click', () => win.close());
    status.textContent = message;
    panel.replaceChildren(title, status, done);
  }

  if (job.action === 'connect') {
    const settings = new URL('settings/api', service);
    if (page.pathname.replace(/\/$/, '') !== settings.pathname || doc.querySelector('form input[type="password"]')) {
      status.textContent = 'Sign in to Hamsterimg, then open your API settings.';
      const link = forumElement(doc, 'a', '', 'Open API settings');
      link.href = settings.href;
      panel.append(status, link);
      return;
    }
    const displayed = () => hamsterKey(doc.querySelector('input#api_v1_key[readonly],input[name="api_v1_key"][readonly]')?.value);
    const use = forumButton(doc, 'Use displayed key', 'epc-hamster-primary');
    const input = forumElement(doc, 'input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Hamsterimg API key');
    input.placeholder = 'Paste your API key';
    const save = forumButton(doc, 'Save key');
    const hint = forumElement(doc, 'p', '', 'Use the key shown in Hamsterimg settings, or paste a key you saved earlier. The first upload checks it.');
    const fields = forumElement(doc, 'div', 'epc-hamster-key-actions');
    fields.append(input, save);
    panel.append(hint, use, fields, status);
    const refresh = () => { use.hidden = !displayed(); };
    refresh();
    const observer = new win.MutationObserver(refresh);
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] });
    const saveKey = (event, value) => {
      if (!event.isTrusted) return;
      const key = hamsterKey(value);
      if (!key) {
        status.textContent = 'Enter the full API key from Hamsterimg settings.';
        input.focus();
        return;
      }
      const active = getActive();
      if (!active) return;
      try {
        storage.set(hamsterAccountKey(active.origin, active.account), key);
        input.value = '';
        complete(active, { connected: true }, 'Key saved. Return to your forum reply.');
        observer.disconnect();
      } catch { status.textContent = 'The key could not be saved. Try again.'; }
    };
    use.addEventListener('click', event => saveKey(event, displayed()));
    save.addEventListener('click', event => saveKey(event, input.value));
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) saveKey(event, input.value);
    });
    return;
  }

  if (!profile) {
    status.textContent = 'Sign in to Hamsterimg to browse your library.';
    panel.append(status);
    return;
  }

  const selected = new Map();
  if (pending?.id === id && pending?.profile === profile.href && Array.isArray(pending.images)) {
    for (const item of pending.images.slice(0, HAMSTER_SELECTION_LIMIT)) {
      const image = hamsterImage(item, service);
      if (image) selected.set(image.href, image);
    }
  }
  const links = forumElement(doc, 'nav', 'epc-hamster-library-links');
  const libraryLink = forumElement(doc, 'a', '', 'My files');
  libraryLink.href = (files || profile).href;
  links.append(libraryLink);
  if (albums) {
    const albumsLink = forumElement(doc, 'a', '', 'My albums');
    albumsLink.href = albums.href;
    links.append(albumsLink);
  }
  const insert = forumButton(doc, 'Insert selected', 'epc-hamster-primary');
  const clear = forumButton(doc, 'Clear selection');
  const actions = forumElement(doc, 'div', 'epc-hamster-actions');
  actions.append(insert, clear);
  panel.append(links, status, actions);
  const tileSelector = '.list-item[data-type="image"][data-object]';
  const buttons = new Map();

  function refreshSelection() {
    for (const [button, href] of buttons) {
      if (!button.isConnected) {
        buttons.delete(button);
        continue;
      }
      const checked = selected.has(href);
      button.textContent = checked ? 'Selected' : 'Select';
      button.setAttribute('aria-pressed', String(checked));
    }
    status.textContent = selected.size ? selected.size + ' selected' : 'Select shareable images in your files or albums.';
    insert.disabled = clear.disabled = !selected.size;
  }
  function changed() {
    persist({ profile: profile.href, images: [...selected.values()] });
    refreshSelection();
  }
  function addTile(tile) {
    if (tile.querySelector(':scope > .epc-hamster-pick')) return;
    const image = hamsterGalleryImage(tile, service, profile);
    if (!image) return;
    const button = forumButton(doc, '', 'epc-root epc-hamster-pick');
    button.setAttribute('aria-label', 'Select ' + image.name);
    buttons.set(button, image.href);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (!event.isTrusted) return;
      if (selected.has(image.href)) selected.delete(image.href);
      else if (selected.size < HAMSTER_SELECTION_LIMIT) selected.set(image.href, image);
      else {
        status.textContent = 'Insert the current selection before adding more images.';
        return;
      }
      changed();
    });
    tile.classList.add('epc-hamster-pickable');
    tile.prepend(button);
  }
  for (const tile of doc.querySelectorAll(tileSelector)) addTile(tile);
  const observer = new win.MutationObserver(records => {
    let addedTile = false;
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches(tileSelector)) {
        addTile(node);
        addedTile = true;
      } else for (const tile of node.querySelectorAll(tileSelector)) {
        addTile(tile);
        addedTile = true;
      }
    }
    if (addedTile) refreshSelection();
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  clear.addEventListener('click', () => { selected.clear(); changed(); });
  insert.addEventListener('click', event => {
    if (!event.isTrusted || !selected.size) return;
    if (hamsterProfile(doc, service).profile?.href !== profile.href) {
      status.textContent = 'The Hamsterimg account changed. Open My images again from your reply.';
      return;
    }
    const active = getActive();
    if (!active) return;
    try {
      complete(active, { images: [...selected.values()] }, 'Images sent. Return to your forum reply.');
      observer.disconnect();
      for (const button of buttons.keys()) {
        button.parentElement?.classList.remove('epc-hamster-pickable');
        button.remove();
      }
    } catch { status.textContent = 'The selection could not be sent. Try again.'; }
  });
  refreshSelection();
}
