// SPDX-License-Identifier: GPL-3.0-or-later
import { createForumEditor, readForumVisualSource } from './forum-editor.mjs';
import { formatForumQuote, forumLiteralText, forumMarkValue, forumQuoteSource, safeForumMediaURL } from './forum-bbcode.mjs';
import { ForumMedia } from './forum-media.mjs';
import { forumButton, forumElement } from './forum-ui.mjs';

const forumVisualPreference = 'ep.forum.visual';
const forumPostID = /^[1-9]\d{0,14}$/;
const forumPreviewStyle = [
  'body{margin:0;padding:14px 16px;background:var(--preview-bg);color:var(--preview-fg);font:15px/1.55 system-ui,sans-serif;overflow-wrap:anywhere}',
  'a{color:var(--preview-accent)}img,video{max-width:100%;height:auto}',
  'blockquote{margin:8px 0;padding:8px 12px;border-inline-start:3px solid GrayText;background:color-mix(in srgb,var(--preview-fg) 5%,var(--preview-bg))}',
  'pre{max-width:100%;overflow:auto}table{max-width:100%;border-collapse:collapse}td,th{padding:4px 8px;border:1px solid GrayText}',
  'details>summary{font-weight:650;cursor:pointer}details{margin:.4em 0}',
  '.hidden{display:none}'
].join('');

function forumPreviewMarkup(doc, page, markup) {
  const template = doc.createElement('template');
  template.innerHTML = markup;
  for (const spoiler of template.content.querySelectorAll('blockquote.spoiler')) {
    const link = spoiler.previousElementSibling;
    const label = link?.previousElementSibling;
    if (!link?.matches('a[onclick*="BBCode.spoiler"]')) continue;
    const details = doc.createElement('details');
    const summary = doc.createElement('summary');
    summary.textContent = label?.matches('strong') ? label.textContent : 'Spoiler';
    details.append(summary);
    if (label?.matches('strong')) {
      label.before(details);
      label.remove();
    } else link.before(details);
    const separator = link.previousSibling;
    if (separator?.nodeType === 3 && /^\s*:\s*$/.test(separator.textContent)) separator.remove();
    link.remove();
    spoiler.classList.remove('hidden');
    details.append(spoiler);
  }
  for (const image of template.content.querySelectorAll('img[data-src]:not([src])')) {
    const src = image.getAttribute('data-src');
    if (!src || !URL.canParse(src, page)) continue;
    const href = safeForumMediaURL(new URL(src, page).href);
    if (href) {
      image.loading = 'lazy';
      image.src = href;
    }
  }
  return template.innerHTML;
}

export function forumReplyForm(content, page, thread) {
  const form = content.querySelector('form#quickpostform');
  const action = form?.getAttribute('action');
  const sourceArea = form?.querySelector('#quickreplytext');
  const source = sourceArea?.querySelector('textarea#quickpost[name="body"]');
  const submit = form?.querySelector('[type="submit"]');
  if (!action || !source || !submit || form.method !== 'post' || !URL.canParse(action, page)) return null;
  const url = new URL(action, page);
  return url.origin === page.origin && url.pathname === '/forum/thread/' + thread + '/reply' && !url.search && !url.hash
    ? { form, sourceArea, source, submit, url }
    : null;
}

class ForumDraftStore {
  constructor(win, storage, key) {
    Object.assign(this, { win, storage, key });
    this.revisionPrefix = key + '.revision.';
    try { this.selected = win.sessionStorage.getItem(key); } catch {}
  }

  read(key) {
    const record = this.storage.get(key, null);
    if (typeof record?.body !== 'string' || typeof record?.revision !== 'string') return null;
    return { key, body: record.body, revision: record.revision, updatedAt: record.updatedAt ?? 0 };
  }

  restore() {
    if (this.selected === '') return null;
    try {
      if (this.selected?.startsWith(this.revisionPrefix)) {
        const selected = this.read(this.selected);
        if (selected) return selected;
      }
      let latest = this.read(this.key);
      for (const key of this.storage.list()) {
        if (!key.startsWith(this.revisionPrefix)) continue;
        const record = this.read(key);
        if (record && (!latest || record.updatedAt >= latest.updatedAt)) latest = record;
      }
      return latest;
    } catch { return null; }
  }

  select(key) {
    this.selected = key;
    try { this.win.sessionStorage.setItem(this.key, key); } catch {}
  }

  remove(record) {
    if (!record) return;
    try {
      if (this.read(record.key)?.revision === record.revision) this.storage.delete(record.key);
    } catch {}
  }

  save(body, previous) {
    const owned = previous?.key && (previous.key === this.selected || previous.key === this.key) ? previous : null;
    if (!body.trim()) {
      this.select('');
      this.remove(owned);
      return null;
    }
    // Each write gets its own key. A tab can only delete the exact revision it replaced.
    const revision = this.win.crypto.randomUUID();
    const key = this.revisionPrefix + revision;
    const record = { body, revision, updatedAt: this.win.Date.now() };
    this.storage.set(key, record);
    this.select(key);
    this.remove(owned);
    return { key, ...record };
  }

  posted(record) {
    this.select('');
    this.remove(record);
  }
}

export class ForumComposer {
  constructor(win, storage, page, thread, account, controls, mediaOptions) {
    Object.assign(this, controls);
    this.win = win;
    this.doc = win.document;
    this.storage = storage;
    this.page = page;
    this.thread = thread;
    this.account = account;
    this.mediaOptions = mediaOptions;
    this.drafts = new ForumDraftStore(win, storage, 'ep.forum.draft.' + page.origin + '.' + account + '.' + thread);
    this.abort = new win.AbortController();
    this.moves = [];
    this.mode = 'bbcode';
    this.writeMode = 'bbcode';
    this.pendingQuotes = 0;
    this.draft = this.drafts.restore();
    if (this.draft && !this.source.value) this.source.value = this.draft.body;
    this.savedBody = this.draft?.body ?? '';
    this.initialReadonly = this.source.readOnly;
    this.initialSourceHidden = this.sourceArea.hidden;
    this.initialDisabled = this.submit.disabled;
    this.mount();
  }

  mount() {
    const { doc, form, source, submit } = this;
    this.launcher = forumButton(doc, '', 'epc-forum-launch');
    this.launcher.setAttribute('aria-expanded', 'false');
    this.launcher.setAttribute('aria-controls', 'epc-forum-compose');
    this.panel = forumElement(doc, 'section', 'epc-forum-compose');
    this.panel.id = 'epc-forum-compose';
    this.panel.setAttribute('aria-label', 'Reply composer');
    this.panel.hidden = true;
    const header = forumElement(doc, 'header', 'epc-forum-compose-head');
    const title = forumElement(doc, 'h2', '', 'Post reply');
    const minimize = forumButton(doc, 'Minimize', 'epc-forum-minimize');
    header.append(title, minimize);
    this.threadActions.append(this.launcher);
    this.dock.append(this.panel);
    this.panel.append(header);

    this.sourceArea.classList.add('epc-forum-source');
    this.label = source.getAttribute('aria-label');
    source.setAttribute('aria-label', 'Reply BBCode');
    this.originBox = form.parentElement;
    this.originHead = this.originBox.previousElementSibling;
    if (this.originBox.matches('.box') && this.originHead?.textContent.trim() === 'Post reply') {
      this.originHead.classList.add('epc-forum-native-reply');
      this.originBox.classList.add('epc-forum-native-reply');
    }
    this.move(form, this.panel);

    this.switcher = forumElement(doc, 'div', 'epc-forum-modes');
    this.switcher.setAttribute('role', 'group');
    this.switcher.setAttribute('aria-label', 'Reply editor mode');
    this.modes = new Map();
    for (const [mode, label] of [['visual', 'Visual'], ['bbcode', 'BBCode'], ['preview', 'Preview']]) {
      const button = forumButton(doc, label);
      button.setAttribute('aria-pressed', String(mode === this.mode));
      if (mode === 'visual') button.title = 'Visual editor (alpha)';
      this.on(button, 'click', () => this.setMode(mode, { remember: mode !== 'preview' }));
      this.modes.set(mode, button);
      this.switcher.append(button);
    }
    form.prepend(this.switcher);
    this.visualArea = forumElement(doc, 'div', 'epc-forum-visual');
    this.visualArea.hidden = true;
    this.preview = forumElement(doc, 'iframe', 'epc-forum-preview-frame');
    this.preview.hidden = true;
    this.preview.title = 'Empornium reply preview';
    this.preview.setAttribute('sandbox', '');
    this.sourceArea.after(this.visualArea, this.preview);
    this.media = new ForumMedia({
      win: this.win, storage: this.storage, page: this.page, account: this.account, thread: this.thread,
      ...this.mediaOptions, insert: urls => this.insertImages(urls), busyChanged: () => this.refreshSubmit(),
      close: () => this.focusEditor()
    });
    this.switcher.after(this.media.root);
    this.sourceImages = forumButton(doc, 'Add images', 'epc-forum-source-images');
    this.sourceImages.setAttribute('aria-controls', 'epc-forum-media');
    this.sourceImages.setAttribute('aria-expanded', 'false');
    this.on(this.sourceImages, 'click', () => this.openImages(null, this.sourceImages));
    this.switcher.append(this.sourceImages);
    this.listenForImages();

    const tools = this.sourceArea.querySelector(':scope > .bb_holder, :scope > .bbcode_assistant, :scope > table');
    if (tools) {
      this.tools = forumElement(doc, 'details', 'epc-forum-source-tools');
      this.tools.open = true;
      this.tools.append(forumElement(doc, 'summary', '', 'Native BBCode tools'));
      tools.before(this.tools);
      this.move(tools, this.tools);
      for (const control of tools.querySelectorAll('a[onclick]:not([href]), img[onclick]')) {
        const previous = ['role', 'tabindex'].map(name => [name, control.getAttribute(name)]);
        control.tabIndex = 0;
        control.setAttribute('role', 'button');
        this.moves.push(() => {
          for (const [name, value] of previous) {
            if (value === null) control.removeAttribute(name);
            else control.setAttribute(name, value);
          }
        });
      }
      this.on(this.tools, 'keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[role="button"][onclick]')) {
          event.preventDefault();
          event.target.click();
        }
      });
      const refresh = () => this.win.queueMicrotask(() => this.changed());
      this.on(this.tools, 'click', refresh);
      this.on(this.tools, 'change', refresh);
    }
    this.nativePreview = form.querySelector('#post_preview');
    this.nativePreview?.classList.add('epc-forum-native-reply');
    this.nativePreviewTable = this.originBox.parentElement.querySelector('#quickreplypreview');
    this.nativePreviewTable?.classList.add('epc-forum-native-reply');
    this.footer = submit.parentElement;
    this.footer.classList.add('epc-forum-compose-actions');
    this.status = forumElement(doc, 'span', 'epc-forum-compose-status');
    this.status.setAttribute('role', 'status');
    this.footer.prepend(this.status);
    this.refreshSubmit();
    this.updateLauncher();

    this.on(source, 'input', () => this.changed());
    this.on(this.launcher, 'click', () => this.open());
    this.on(minimize, 'click', () => this.minimize());
    this.on(this.panel, 'keydown', event => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) {
        event.preventDefault();
        this.minimize();
      }
    });
    this.on(this.win, 'pagehide', () => this.save());
    this.on(form, 'submit', event => {
      if (event.defaultPrevented) {
        this.setStatus('Check your reply and try again.');
        return;
      }
      event.preventDefault();
      this.post();
    });
  }

  on(element, event, listener) {
    element.addEventListener(event, listener, { signal: this.abort.signal });
  }

  move(element, target) {
    const marker = this.doc.createComment('');
    element.before(marker);
    target.append(element);
    this.moves.push(() => marker.replaceWith(element));
  }

  open(focus = true) {
    if (this.panel.hidden) {
      this.panel.hidden = false;
      this.launcher.hidden = true;
      this.launcher.setAttribute('aria-expanded', 'true');
      this.doc.documentElement.classList.add('epc-forum-composing');
      if (!this.opened) {
        this.opened = true;
        try {
          if (this.storage.get(forumVisualPreference, false) === true) this.setMode('visual', { focus: false });
        } catch {}
        if (this.draft && !this.status.textContent) this.setStatus('Draft restored');
      }
    }
    if (focus) this.focusEditor();
  }

  minimize() {
    this.save();
    this.panel.hidden = true;
    this.launcher.hidden = false;
    this.launcher.setAttribute('aria-expanded', 'false');
    this.doc.documentElement.classList.remove('epc-forum-composing');
    this.updateLauncher();
    this.launcher.focus();
  }

  focusEditor() {
    if (this.mode === 'visual') this.editor.focus();
    else if (this.mode === 'bbcode') this.source.focus();
    else this.modes.get('preview').focus();
  }

  listenForImages() {
    const accept = event => {
      if (!event.isTrusted || this.sending || !event.target.closest?.('.ProseMirror,#quickpost,.epc-forum-media')) return;
      const files = (event.clipboardData || event.dataTransfer)?.files;
      if (!files?.length) return;
      if (!this.media.uploading) this.captureImages();
      if (this.media.addFiles(files)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    for (const event of ['paste', 'drop']) this.form.addEventListener(event, accept, { capture: true, signal: this.abort.signal });
    this.on(this.form, 'dragover', event => {
      if (event.isTrusted && event.dataTransfer?.types.includes('Files') &&
        event.target.closest?.('.ProseMirror,#quickpost,.epc-forum-media')) {
        event.preventDefault();
      }
    });
  }

  captureImages() {
    if (this.mode === 'visual') this.editor.captureImages();
    else this.imageSource = { body: this.source.value, start: this.source.selectionStart, end: this.source.selectionEnd };
  }

  openImages(href, trigger) {
    if (this.sending) return;
    this.captureImages();
    this.media.show(href ? 'url' : 'upload', href || '', trigger);
  }

  insertImages(urls) {
    if (this.sending || !urls.length) return false;
    this.open(false);
    if (this.mode === 'preview') this.setMode(this.writeMode, { focus: false });
    if (this.mode === 'visual') this.editor.insertImages(urls);
    else {
      const range = this.imageSource?.body === this.source.value ? this.imageSource : null;
      const start = range?.start ?? this.source.selectionStart;
      const end = range?.end ?? this.source.selectionEnd;
      this.source.setRangeText(urls.map(href => '[img]' + href + '[/img]').join('\n'), start, end, 'end');
      this.imageSource = null;
      this.changed();
    }
    this.save();
    this.focusEditor();
    return true;
  }

  setMode(mode, { remember = false, focus = true } = {}) {
    if (this.sending) return;
    this.previewRequest?.abort();
    this.previewRequest = null;
    let unavailable = false;
    if (mode === 'visual' && (!this.editor || this.visualSource !== this.source.value)) {
      const parsed = readForumVisualSource(this.source.value);
      if (parsed) {
        this.editor?.destroy();
        this.visualSource = this.source.value;
        const fonts = [...this.form.querySelectorAll('select[name="fontfont"] option')]
          .map(option => option.value).filter(name => name !== '-1' && forumMarkValue('font', name));
        this.editor = createForumEditor(this.visualArea, parsed, source => {
          this.visualSource = this.source.value = source;
          this.changed();
        }, { page: this.page, fonts: fonts.length ? fonts : undefined, openImages: (href, trigger) => this.openImages(href, trigger) });
      } else {
        unavailable = true;
        mode = 'bbcode';
      }
    }
    this.mode = mode;
    this.sourceImages.hidden = mode !== 'bbcode';
    this.sourceArea.hidden = mode !== 'bbcode';
    this.visualArea.hidden = mode !== 'visual';
    this.preview.hidden = true;
    for (const [name, button] of this.modes) button.setAttribute('aria-pressed', String(name === mode));
    if (mode === 'preview') {
      this.media.hide(false);
      this.showPreview();
      return;
    }
    this.writeMode = mode;
    if (remember && !unavailable) {
      try { this.storage.set(forumVisualPreference, mode === 'visual'); } catch {}
    }
    this.setStatus(unavailable ? 'This draft uses formatting that needs BBCode.' : '', unavailable);
    if (focus) this.focusEditor();
  }

  setStatus(text, error = false) {
    this.status.textContent = text;
    this.status.dataset.error = String(error);
  }

  changed() {
    if (this.abort.signal.aborted) return;
    this.refreshSubmit();
    this.win.clearTimeout(this.timer);
    this.timer = this.win.setTimeout(() => this.save(), 250);
  }

  save() {
    this.win.clearTimeout(this.timer);
    const body = this.source.value;
    if (body === this.savedBody) return;
    this.refreshSubmit();
    try {
      this.draft = this.drafts.save(body, this.draft);
      this.savedBody = body;
      this.updateLauncher();
      if (!this.sending && !this.pendingQuotes && this.mode !== 'preview' && this.status.dataset.error !== 'true') {
        this.setStatus(body.trim() ? 'Draft saved' : '');
      }
    } catch {
      this.setStatus('Draft could not be saved on this device.', true);
    }
  }

  updateLauncher() {
    this.launcher.textContent = this.source.value.trim() ? 'Resume draft' : 'Reply';
  }

  refreshSubmit() {
    this.submit.disabled = this.initialDisabled || Boolean(this.sending) || Boolean(this.media?.uploading) ||
      this.pendingQuotes > 0 || !this.source.value.trim();
  }

  async showPreview() {
    if (!this.source.value.trim()) {
      this.setStatus('Write a reply to preview it.');
      return;
    }
    const controller = new this.win.AbortController();
    this.previewRequest = controller;
    this.setStatus('Loading preview…');
    try {
      const response = await this.win.fetch(new URL('/ajax.php?action=preview', this.page).href, {
        method: 'POST', body: new URLSearchParams({ body: this.source.value }),
        credentials: 'same-origin', mode: 'same-origin', redirect: 'error', signal: controller.signal
      });
      if (!response.ok) throw new Error('Preview was rejected.');
      const markup = await response.text();
      if (controller.signal.aborted) return;
      this.previewMarkup = forumPreviewMarkup(this.doc, this.page, markup);
      this.preview.hidden = false;
      this.renderPreview();
      this.setStatus('');
    } catch {
      if (!controller.signal.aborted) this.setStatus('Preview unavailable. Your reply is still here.', true);
    }
  }

  renderPreview() {
    if (this.preview.hidden || this.previewMarkup === undefined) return;
    const theme = this.doc.documentElement.dataset.epForumTheme === 'dark' ? 'dark' : 'light';
    const style = this.win.getComputedStyle(this.dock);
    const color = (property, fallback) => {
      const value = style.getPropertyValue(property).trim();
      return /^#[\da-f]{6}$/i.test(value) ? value : fallback;
    };
    const palette = 'html{color-scheme:' + theme + ';--preview-bg:' + color('--epc-bg', 'Canvas') +
      ';--preview-fg:' + color('--epc-fg', 'CanvasText') + ';--preview-accent:' + color('--epc-accent', 'LinkText') + '}';
    const preview = '<!doctype html><meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src https: http: data:; media-src https: http:; base-uri \'none\'; form-action \'none\'">' +
      '<style>' + palette + forumPreviewStyle + '</style>' + this.previewMarkup;
    if (this.preview.srcdoc !== preview) this.preview.srcdoc = preview;
  }

  async quote(post, author, excerpt) {
    if (!forumPostID.test(post) || this.sending) return;
    this.open(false);
    if (this.mode === 'preview') this.setMode(this.writeMode, { focus: false });
    this.pendingQuotes++;
    this.refreshSubmit();
    const previousQuote = this.quotes || Promise.resolve();
    this.quotes = previousQuote.then(async () => {
      if (this.abort.signal.aborted) return;
      try {
        let body = excerpt === undefined ? undefined : forumLiteralText(excerpt);
        if (body === undefined) {
          this.setStatus('Loading quote…');
          const url = new URL('/forum/post/' + post + '/get?body=1', this.page);
          const response = await this.win.fetch(url.href, {
            credentials: 'same-origin', mode: 'same-origin', redirect: 'error', signal: this.abort.signal
          });
          if (!response.ok) throw new Error('Quote was rejected.');
          const raw = await response.json();
          if (typeof raw !== 'string') throw new Error('Invalid quote.');
          const decode = this.doc.createElement('textarea');
          decode.innerHTML = raw;
          body = decode.value.trim();
        }
        if (!body || this.abort.signal.aborted) return;
        const quote = formatForumQuote(author, this.thread, post, body);
        if (this.mode !== 'visual' || !this.editor.appendQuote(quote)) {
          const existing = this.source.value;
          this.source.value = existing + (existing && !existing.endsWith('\n') ? '\n' : '') + quote + '\n';
          const visual = this.mode === 'visual';
          this.setMode('bbcode', { focus: false });
          this.source.setSelectionRange(this.source.value.length, this.source.value.length);
          this.changed();
          if (visual) this.setStatus('This quote uses formatting that needs BBCode.', true);
        }
        if (this.status.textContent === 'Loading quote…') this.setStatus('');
        if (!this.panel.hidden) this.focusEditor();
      } catch {
        if (!this.abort.signal.aborted) this.setStatus('Quote unavailable. Select text in the post to quote it.', true);
      }
    }).finally(() => {
      this.pendingQuotes--;
      if (!this.abort.signal.aborted) this.refreshSubmit();
    });
    return this.quotes;
  }

  async post() {
    if (this.sending || this.submit.disabled || !this.source.value.trim()) return;
    this.save();
    const draft = this.draft?.body === this.source.value ? this.draft : null;
    const fields = new URLSearchParams(new this.win.FormData(this.form, this.submit));
    this.previewRequest?.abort();
    this.sending = true;
    this.refreshSubmit();
    this.source.readOnly = true;
    if (this.tools) this.tools.inert = true;
    this.editor?.setDisabled(true);
    this.setStatus('Posting reply…');
    try {
      const response = await this.win.fetch(this.url.href, {
        method: 'POST', body: fields, credentials: 'same-origin', mode: 'same-origin'
      });
      const destination = new URL(response.url || this.url);
      const post = destination.searchParams.get('postid');
      if (!response.ok || !response.redirected || destination.origin !== this.page.origin ||
        destination.pathname !== '/forum/thread/' + this.thread || !forumPostID.test(post || '')) {
        this.setStatus('Empornium didn’t confirm the reply. Check the thread before trying again.', true);
        return;
      }
      this.drafts.posted(draft);
      this.media.endRequest();
      this.draft = null;
      this.source.value = this.savedBody = '';
      this.editor?.destroy();
      this.editor = null;
      this.sending = false;
      this.setMode('bbcode', { focus: false });
      this.updateLauncher();
      this.setStatus('Reply posted');
      const target = new URL(forumQuoteSource(this.thread, post), this.page);
      const current = this.win.location;
      if (current.pathname === target.pathname && current.search === target.search) {
        this.win.history.replaceState(this.win.history.state, '', target.href);
        current.reload();
      } else current.assign(target.href);
    } catch {
      this.setStatus('The connection was interrupted. Check the thread before trying again.', true);
    } finally {
      this.sending = false;
      this.refreshSubmit();
      this.source.readOnly = this.initialReadonly;
      if (this.tools) this.tools.inert = false;
      this.editor?.setDisabled(false);
    }
  }

  dispose() {
    this.save();
    this.abort.abort();
    this.previewRequest?.abort();
    this.media.destroy();
    this.editor?.destroy();
    this.sourceArea.hidden = this.initialSourceHidden;
    this.sourceArea.classList.remove('epc-forum-source');
    this.footer.classList.remove('epc-forum-compose-actions');
    this.nativePreview?.classList.remove('epc-forum-native-reply');
    this.nativePreviewTable?.classList.remove('epc-forum-native-reply');
    this.originHead?.classList.remove('epc-forum-native-reply');
    this.originBox.classList.remove('epc-forum-native-reply');
    this.doc.documentElement.classList.remove('epc-forum-composing');
    if (this.label === null) this.source.removeAttribute('aria-label');
    else this.source.setAttribute('aria-label', this.label);
    this.submit.disabled = this.initialDisabled;
    this.switcher.remove();
    this.preview.remove();
    this.visualArea.remove();
    this.status.remove();
    for (const restore of this.moves.reverse()) restore();
    this.tools?.remove();
    this.launcher.remove();
    this.panel.remove();
  }
}
