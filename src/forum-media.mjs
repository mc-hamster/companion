// SPDX-License-Identifier: GPL-3.0-or-later
import { safeForumMediaURL } from './forum-bbcode.mjs';
import { forumButton, forumElement } from './forum-ui.mjs';
import {
  HAMSTER_JOB_PREFIX, HAMSTER_PICKER_HASH, HAMSTER_SELECTION_LIMIT, cleanupHamsterRequests, hamsterAccountKey,
  hamsterImage, hamsterKey, readHamsterRequest, uploadHamsterImage
} from './hamster-media.mjs';

const recentLimit = 60;
const modes = [['upload', 'Upload'], ['recent', 'Recent uploads'], ['library', 'My images'], ['url', 'From URL']];

export class ForumMedia {
  constructor({ win, storage, page, service, request, account, thread, context, source, visualArea, scope,
    getVisualEditor, beforeInsert = () => {}, afterInsert, busyChanged, close }) {
    Object.assign(this, { win, doc: win.document, storage, page, service, request, account, thread, context,
      source, visualArea, getVisualEditor, beforeInsert, afterInsert, busyChanged, close });
    this.abort = new win.AbortController();
    this.key = hamsterAccountKey(page.origin, account);
    this.recentPrefix = 'ep.forum.hamster.recent.' + page.origin + '.' + account + '.';
    this.sessionKey = context ? 'ep.forum.hamster.' + context + '.' + account :
      'ep.forum.hamster.reply.' + account + '.' + thread;
    this.mode = 'upload';
    this.files = [];
    this.selected = new Set();
    this.root = forumElement(this.doc, 'section', 'epc-forum-media');
    this.root.id = context ? 'epc-forum-media-' + source.id : 'epc-forum-media';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Add images');
    this.sourceButton = forumButton(this.doc, 'Add images', 'epc-forum-source-images');
    this.sourceButton.setAttribute('aria-controls', this.root.id);
    this.sourceButton.setAttribute('aria-expanded', 'false');
    this.on(this.sourceButton, 'click', () => this.open(null, this.sourceButton));
    this.listenForImages(scope);
    this.nav = forumElement(this.doc, 'div', 'epc-forum-media-nav');
    this.nav.setAttribute('role', 'group');
    this.nav.setAttribute('aria-label', 'Image source');
    this.tabs = new Map();
    for (const [mode, label] of modes) {
      const button = forumButton(this.doc, label);
      this.tabs.set(mode, button);
      this.on(button, 'click', () => this.show(mode));
      this.nav.append(button);
    }
    const dismiss = forumButton(this.doc, 'Close', 'epc-forum-media-close');
    this.on(dismiss, 'click', () => this.hide());
    this.nav.append(dismiss);
    this.content = forumElement(this.doc, 'div', 'epc-forum-media-body');
    this.status = forumElement(this.doc, 'p', 'epc-forum-media-status');
    this.status.setAttribute('role', 'status');
    this.root.append(this.nav, this.content, this.status);
    this.on(this.root, 'keydown', event => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        this.hide();
      }
    });
    this.on(win, 'focus', () => this.checkRequest());
    try { this.id = win.sessionStorage.getItem(this.sessionKey); } catch {}
    if (this.id) {
      this.watchRequest();
      win.queueMicrotask(() => this.checkRequest());
    }
  }

  on(element, event, fn) {
    element.addEventListener(event, fn, { signal: this.abort.signal });
  }

  canEdit() {
    return this.source.isConnected && !this.source.readOnly && !this.source.disabled;
  }

  listenForImages(scope) {
    const ownsTarget = target => target === this.source || this.root.contains(target) ||
      (this.visualArea.contains(target) && target.closest?.('.ProseMirror'));
    const accept = event => {
      if (!event.isTrusted || !this.canEdit() || !ownsTarget(event.target)) return;
      const files = (event.clipboardData || event.dataTransfer)?.files;
      if (!files?.length) return;
      if (!this.uploading) this.captureSelection();
      if (this.addFiles(files)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const signal = this.abort.signal;
    for (const event of ['paste', 'drop']) scope.addEventListener(event, accept, { capture: true, signal });
    this.on(scope, 'dragover', event => {
      if (event.isTrusted && this.canEdit() && event.dataTransfer?.types.includes('Files') && ownsTarget(event.target)) {
        event.preventDefault();
      }
    });
  }

  captureSelection() {
    const editor = this.getVisualEditor();
    this.selectionEditor = editor;
    if (editor) {
      this.sourceSelection = null;
      editor.captureImages();
    } else this.sourceSelection = { body: this.source.value, start: this.source.selectionStart, end: this.source.selectionEnd };
  }

  open(href, trigger) {
    if (!this.canEdit()) return;
    this.captureSelection();
    this.show(href ? 'url' : 'upload', href || '', trigger);
  }

  insert(urls) {
    if (!urls.length || !this.canEdit()) return false;
    this.beforeInsert();
    const editor = this.getVisualEditor();
    if (editor) {
      if (editor !== this.selectionEditor) editor.captureImages();
      editor.insertImages(urls);
    } else {
      const range = this.sourceSelection?.body === this.source.value ? this.sourceSelection : null;
      const start = range?.start ?? this.source.selectionStart;
      const end = range?.end ?? this.source.selectionEnd;
      this.source.setRangeText(urls.map(href => '[img]' + href + '[/img]').join('\n'), start, end, 'end');
      this.source.dispatchEvent(new this.win.Event('input', { bubbles: true }));
    }
    this.selectionEditor = this.sourceSelection = null;
    this.afterInsert();
    return true;
  }

  show(mode = this.mode, href, trigger) {
    const opening = this.root.hidden;
    this.mode = mode;
    if (trigger && this.trigger !== trigger) {
      this.trigger?.setAttribute('aria-expanded', 'false');
      this.trigger = trigger;
    }
    if (href !== undefined) this.url = href;
    this.root.hidden = false;
    this.trigger?.setAttribute('aria-expanded', 'true');
    this.render();
    const setupHeading = this.content.querySelector('.epc-forum-image-setup h3');
    if (setupHeading && (trigger || opening)) setupHeading.focus();
    else if (trigger) (mode === 'url' ? this.content.querySelector('input') : this.tabs.get(mode)).focus({ preventScroll: true });
  }

  hide(focus = true) {
    this.root.hidden = true;
    this.trigger?.setAttribute('aria-expanded', 'false');
    this.trigger = null;
    if (focus) this.close();
  }

  connectedKey() {
    try { return hamsterKey(this.storage.get(this.key, '')); } catch { return ''; }
  }

  setStatus(message = '', error = false) {
    this.status.textContent = message;
    this.status.dataset.error = String(error);
  }

  render() {
    if (this.root.hidden) return;
    for (const [mode, button] of this.tabs) button.setAttribute('aria-pressed', String(mode === this.mode));
    if (this.mode === 'upload') this.renderUpload();
    else if (this.mode === 'recent') this.renderRecent();
    else if (this.mode === 'library') this.renderLibrary();
    else this.renderURL();
  }

  requestLink(action, label) {
    const link = forumElement(this.doc, 'a', 'epc-forum-media-action', label);
    const url = new URL(action === 'connect' ? 'settings/api' : '.', this.service);
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    this.on(link, 'click', event => {
      if (!event.isTrusted) {
        event.preventDefault();
        return;
      }
      try {
        this.endRequest();
        const started = this.win.Date.now();
        cleanupHamsterRequests(this.storage, started);
        const id = this.win.crypto.randomUUID();
        const scope = this.context ? { context: this.context } : { thread: this.thread };
        this.storage.set(HAMSTER_JOB_PREFIX + id, { action, started, origin: this.page.origin, account: this.account, ...scope });
        this.id = id;
        try { this.win.sessionStorage.setItem(this.sessionKey, id); } catch {}
        url.hash = HAMSTER_PICKER_HASH + '=' + id;
        link.href = url.href;
        this.watchRequest();
        this.setStatus(action === 'connect' ? 'Finish setup in the Hamsterimg tab, then return here.' : 'Waiting for your image selection…');
      } catch {
        event.preventDefault();
        this.setStatus('Could not open the Hamsterimg picker. Try again.', true);
      }
    });
    return link;
  }

  watchRequest() {
    const check = () => this.checkRequest();
    try { this.unwatch = this.storage.watch?.(HAMSTER_JOB_PREFIX + this.id, check); } catch {}
    if (!this.unwatch) {
      const timer = this.win.setInterval(check, 450);
      this.unwatch = () => this.win.clearInterval(timer);
    }
  }

  ownsRequest(job) {
    return job?.origin === this.page.origin && job.account === this.account &&
      job.thread === this.thread && job.context === this.context;
  }

  endRequest() {
    if (!this.id) return;
    const id = this.id;
    this.id = null;
    this.unwatch?.();
    this.unwatch = null;
    try {
      if (this.win.sessionStorage.getItem(this.sessionKey) === id) this.win.sessionStorage.removeItem(this.sessionKey);
    } catch {}
    try {
      const key = HAMSTER_JOB_PREFIX + id;
      if (this.ownsRequest(this.storage.get(key, null))) this.storage.delete(key);
    } catch {}
  }

  checkRequest() {
    if (!this.id || this.abort.signal.aborted || this.receiving) return;
    const id = this.id;
    const deliver = () => {
      if (id !== this.id || this.abort.signal.aborted) return;
      const job = readHamsterRequest(this.storage, id, this.service, this.win.Date.now());
      if (!this.ownsRequest(job)) {
        this.endRequest();
        this.setStatus('The Hamsterimg request expired. Open it again to continue.', true);
        return;
      }
      if (job.action === 'connect' && job.result?.connected === true && this.connectedKey()) {
        this.endRequest();
        this.setStatus('Hamsterimg key saved.');
        this.render();
        this.upload();
      }
      if (job.action === 'browse' && Array.isArray(job.result?.images)) {
        const images = job.result.images.slice(0, HAMSTER_SELECTION_LIMIT)
          .map(item => hamsterImage(item, this.service)).filter(Boolean);
        if (images.length && !this.insert(images.map(image => image.href))) return;
        this.endRequest();
        if (images.length) this.hide(false);
        else this.setStatus('Hamsterimg returned no image links.', true);
      }
    };
    const job = readHamsterRequest(this.storage, id, this.service, this.win.Date.now());
    if (job && !job.result) return;
    if (this.win.navigator.locks?.request) {
      this.receiving = true;
      this.win.navigator.locks.request(HAMSTER_JOB_PREFIX + id, deliver).catch(() => {}).finally(() => { this.receiving = false; });
    } else deliver();
  }

  uploadSetup() {
    const { doc } = this;
    const setup = forumElement(doc, 'section', 'epc-forum-image-setup');
    const heading = forumElement(doc, 'h3', '', 'Set up image uploads');
    heading.id = this.root.id + '-setup';
    heading.tabIndex = -1;
    setup.setAttribute('aria-labelledby', heading.id);
    const steps = forumElement(doc, 'ol', 'epc-forum-image-steps');
    for (const [title, text] of [
      ['Sign in to Hamsterimg', 'Use your Hamsterimg account or create one in the new tab.'],
      ['Save your connection', 'Choose Use displayed key in the Companion panel. The key lets Companion upload images for you.'],
      ['Return to your post', this.files.some(item => item.state === 'queued')
        ? 'Your queued files will upload automatically. Companion will insert the image links.'
        : 'Choose, paste, or drop an image. Companion uploads it to Hamsterimg and inserts its link.']
    ]) {
      const step = forumElement(doc, 'li');
      step.append(forumElement(doc, 'strong', '', title), forumElement(doc, 'span', '', text));
      steps.append(step);
    }
    const actions = forumElement(doc, 'div', 'epc-forum-image-setup-actions');
    const connect = this.requestLink('connect', 'Connect Hamsterimg');
    const hint = forumElement(doc, 'span', 'epc-forum-image-setup-note', 'Opens Hamsterimg in a new tab');
    hint.id = this.root.id + '-setup-hint';
    connect.setAttribute('aria-describedby', hint.id);
    const useLink = forumButton(doc, 'Use an image link');
    this.on(useLink, 'click', () => {
      this.show('url');
      this.content.querySelector('input')?.focus();
    });
    actions.append(connect, useLink);
    setup.append(heading, forumElement(doc, 'p', '', 'Connect once to upload from this browser.'),
      actions, hint, steps, forumElement(doc, 'p', 'epc-forum-image-setup-note', 'Your key is saved in this browser for your Empornium account.'));
    return setup;
  }

  renderUpload() {
    const key = this.connectedKey();
    const { doc } = this;
    const block = forumElement(doc, 'div', 'epc-forum-upload');
    if (key) {
      const connection = forumElement(doc, 'div', 'epc-forum-media-line');
      connection.append(forumElement(doc, 'span', '', 'Hamsterimg connected'));
      if (!this.uploading) connection.append(this.requestLink('connect', 'Change key'));
      const picker = forumElement(doc, 'label', 'epc-forum-upload-drop');
      const input = forumElement(doc, 'input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.setAttribute('aria-label', 'Choose images to upload');
      picker.append(input, forumElement(doc, 'strong', '', 'Choose images'), forumElement(doc, 'span', '', 'or drop or paste images into the editor'));
      this.on(input, 'change', event => {
        if (event.isTrusted) this.addFiles(input.files);
      });
      block.append(connection, picker);
    } else {
      block.append(this.uploadSetup());
    }
    if (this.files.length) {
      const queue = forumElement(doc, 'ul', 'epc-forum-upload-queue');
      for (const item of this.files) {
        const row = forumElement(doc, 'li');
        const indicator = forumElement(doc, 'span', 'epc-forum-upload-state', item.message || (key ? 'Queued' : 'Waiting for setup'));
        item.indicator = indicator;
        row.append(forumElement(doc, 'span', '', item.file.name), indicator);
        if (item.state === 'failed' && key) {
          const retry = forumButton(doc, 'Retry');
          this.on(retry, 'click', event => {
            if (!event.isTrusted) return;
            item.state = 'queued';
            item.message = '';
            this.render();
            this.upload();
          });
          row.append(retry);
        }
        if (item.state !== 'uploading') {
          const remove = forumButton(doc, 'Remove');
          remove.setAttribute('aria-label', 'Remove ' + item.file.name);
          this.on(remove, 'click', () => {
            this.files = this.files.filter(file => file !== item);
            this.render();
          });
          row.append(remove);
        }
        queue.append(row);
      }
      block.append(queue);
    }
    this.content.replaceChildren(block);
  }

  addFiles(items) {
    if (!this.canEdit()) return false;
    const files = [...(items || [])].filter(file => file.type.startsWith('image/') ||
      (!file.type && /\.(?:png|jpe?g|gif|webp|avif|bmp)$/i.test(file.name)));
    if (!files.length) return false;
    this.files.push(...files.map(file => ({ file, state: 'queued' })));
    this.show('upload');
    this.upload();
    return true;
  }

  async upload() {
    if (this.uploading || this.abort.signal.aborted || !this.canEdit() || !this.files.some(item => item.state === 'queued')) return;
    const key = this.connectedKey();
    if (!key) return;
    this.uploading = true;
    this.busyChanged();
    const added = [];
    try {
      for (let item; !this.abort.signal.aborted && (item = this.files.find(file => file.state === 'queued'));) {
        item.state = 'uploading';
        item.message = 'Uploading…';
        this.render();
        try {
          const image = await uploadHamsterImage({
            win: this.win, service: this.service, request: this.request, key, file: item.file, signal: this.abort.signal,
            progress: fraction => { if (item.indicator) item.indicator.textContent = 'Uploading ' + Math.round(fraction * 100) + '%'; }
          });
          this.recordRecent(image);
          added.push(image.href);
          this.files = this.files.filter(file => file !== item);
        } catch (error) {
          item.state = 'failed';
          item.message = error.message;
          if (error.status === 401 || error.status === 403) break;
        }
      }
      if (!this.abort.signal.aborted && added.length) {
        if (this.insert(added)) {
          this.setStatus(added.length === 1 ? 'Image inserted.' : added.length + ' images inserted.');
          if (!this.files.length) this.hide(false);
        } else this.setStatus('The upload is available in Recent uploads.');
      }
    } finally {
      this.uploading = false;
      if (!this.abort.signal.aborted) {
        this.render();
        this.busyChanged();
      }
    }
  }

  recentRows() {
    try {
      return this.storage.list().flatMap(key => {
        if (!key.startsWith(this.recentPrefix)) return [];
        const value = this.storage.get(key, null);
        const image = hamsterImage(value, this.service);
        return image ? [{ ...image, key, time: Number(value.time) || 0 }] : [];
      }).sort((a, b) => b.time - a.time);
    } catch { return []; }
  }

  recordRecent(image) {
    try {
      this.storage.set(this.recentPrefix + this.win.crypto.randomUUID(), { ...image, time: this.win.Date.now() });
      for (const item of this.recentRows().slice(recentLimit)) this.storage.delete(item.key);
    } catch {}
  }

  renderRecent() {
    const { doc } = this;
    const rows = new Map();
    for (const item of this.recentRows()) if (!rows.has(item.href)) rows.set(item.href, item);
    if (!rows.size) {
      this.content.replaceChildren(forumElement(doc, 'p', '', 'Images you upload from Companion will appear here.'));
      return;
    }
    const grid = forumElement(doc, 'div', 'epc-forum-recent');
    const insert = forumButton(doc, 'Insert selected');
    const update = () => { insert.disabled = ![...this.selected].some(href => rows.has(href)); };
    for (const [href, image] of rows) {
      const button = forumButton(doc, '', 'epc-forum-recent-item');
      button.setAttribute('aria-label', 'Select ' + image.name);
      const thumb = forumElement(doc, 'img');
      thumb.src = image.thumbnail;
      thumb.loading = 'lazy';
      thumb.alt = '';
      button.append(thumb, forumElement(doc, 'span', '', image.name));
      button.setAttribute('aria-pressed', String(this.selected.has(href)));
      this.on(button, 'click', () => {
        if (this.selected.has(href)) this.selected.delete(href);
        else this.selected.add(href);
        button.setAttribute('aria-pressed', String(this.selected.has(href)));
        update();
      });
      grid.append(button);
    }
    update();
    this.on(insert, 'click', () => {
      if (this.insert([...this.selected].filter(href => rows.has(href)))) {
        this.selected.clear();
        this.hide(false);
      }
    });
    this.content.replaceChildren(grid, insert);
  }

  renderLibrary() {
    this.content.replaceChildren(
      forumElement(this.doc, 'p', '', 'Pick images from your signed-in Hamsterimg library and insert them into the editor.'),
      this.requestLink('browse', 'Open My images')
    );
  }

  renderURL() {
    const row = forumElement(this.doc, 'div', 'epc-forum-media-line');
    const input = forumElement(this.doc, 'input');
    input.type = 'text';
    input.inputMode = 'url';
    input.value = this.url || '';
    input.placeholder = 'https://…';
    input.setAttribute('aria-label', 'Image URL');
    const button = forumButton(this.doc, 'Insert image');
    const apply = () => {
      const href = safeForumMediaURL(input.value.trim());
      if (!href) {
        this.setStatus('Enter an http or https image address.', true);
        input.focus();
      } else if (this.insert([href])) {
        this.url = '';
        this.hide(false);
      }
    };
    this.on(input, 'input', () => { this.url = input.value; });
    this.on(input, 'keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      apply();
    });
    this.on(button, 'click', apply);
    row.append(input, button);
    this.content.replaceChildren(row);
  }

  destroy() {
    this.abort.abort();
    this.endRequest();
    this.sourceButton.remove();
    this.root.remove();
  }
}
