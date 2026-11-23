// SPDX-License-Identifier: GPL-3.0-or-later
import { createForumEditor, readForumVisualSource } from './forum-editor.mjs';
import { formatForumQuote, forumLiteralText, forumQuoteSource } from './forum-bbcode.mjs';

const forumVisualPreference = 'ep.forum.visual';
const forumPostID = /^[1-9]\d{0,14}$/;
const forumPreviewStyle = [
  'html{color-scheme:light dark}',
  'body{margin:0;padding:14px 16px;font:15px/1.55 system-ui,sans-serif;overflow-wrap:anywhere}',
  'a{color:LinkText}img,video{max-width:100%;height:auto}',
  'blockquote{margin:8px 0;padding:8px 12px;border-inline-start:3px solid GrayText;background:color-mix(in srgb,CanvasText 5%,Canvas)}',
  'pre{max-width:100%;overflow:auto}table{max-width:100%;border-collapse:collapse}td,th{padding:4px 8px;border:1px solid GrayText}',
  '.hidden{display:none}'
].join('');

export function forumElement(doc, tag, className = '', text = '') {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function forumButton(doc, text, className = '') {
  const button = forumElement(doc, 'button', className, text);
  button.type = 'button';
  return button;
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

export class ForumComposer {
  constructor(win, storage, page, thread, account, controls) {
    Object.assign(this, controls);
    this.win = win;
    this.doc = win.document;
    this.storage = storage;
    this.page = page;
    this.thread = thread;
    this.key = 'ep.forum.draft.' + page.origin + '.' + account + '.' + thread;
    this.abort = new win.AbortController();
    this.moves = [];
    this.mode = 'bbcode';
    this.writeMode = 'bbcode';
    this.pendingQuotes = 0;
    this.draft = this.readDraft();
    if (this.draft && !this.source.value) this.source.value = this.draft.body;
    this.savedBody = this.draft?.body ?? '';
    this.initialReadonly = this.source.readOnly;
    this.initialSourceHidden = this.sourceArea.hidden;
    this.initialDisabled = this.submit.disabled;
    this.mount();
  }

  mount() {
    const { doc, form, source, submit } = this;
    this.dock = forumElement(doc, 'section', 'epc-root epc-forum-dock');
    this.dock.setAttribute('aria-label', 'Reply composer');
    this.launcher = forumButton(doc, '', 'epc-forum-launch');
    this.launcher.setAttribute('aria-expanded', 'false');
    this.launcher.setAttribute('aria-controls', 'epc-forum-compose');
    this.panel = forumElement(doc, 'div', 'epc-forum-compose');
    this.panel.id = 'epc-forum-compose';
    this.panel.hidden = true;
    const header = forumElement(doc, 'header', 'epc-forum-compose-head');
    const title = forumElement(doc, 'h2', '', 'Post reply');
    const minimize = forumButton(doc, 'Minimize', 'epc-forum-minimize');
    header.append(title, minimize);
    this.dock.append(this.launcher, this.panel);
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
    doc.body.append(this.dock);

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

    const tools = this.sourceArea.querySelector(':scope > table, :scope > .bbcode_assistant');
    if (tools) {
      this.tools = forumElement(doc, 'details', 'epc-forum-source-tools');
      this.tools.append(forumElement(doc, 'summary', '', 'BBCode tools'));
      tools.before(this.tools);
      this.move(tools, this.tools);
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
        this.editor = createForumEditor(this.visualArea, parsed, source => {
          this.visualSource = this.source.value = source;
          this.changed();
        });
      } else {
        unavailable = true;
        mode = 'bbcode';
      }
    }
    this.mode = mode;
    this.sourceArea.hidden = mode !== 'bbcode';
    this.visualArea.hidden = mode !== 'visual';
    this.preview.hidden = true;
    for (const [name, button] of this.modes) button.setAttribute('aria-pressed', String(name === mode));
    if (mode === 'preview') {
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

  readDraft() {
    try {
      const record = this.storage.get(this.key, null);
      return typeof record?.body === 'string' && typeof record?.revision === 'string' ? record : null;
    } catch { return null; }
  }

  save() {
    this.win.clearTimeout(this.timer);
    const body = this.source.value;
    if (body === this.savedBody) return;
    try {
      if (!body.trim()) {
        if (this.draft && this.readDraft()?.revision === this.draft.revision) this.storage.delete(this.key);
        this.draft = null;
      } else {
        const record = { body, revision: this.win.crypto.randomUUID() };
        this.storage.set(this.key, record);
        this.draft = record;
      }
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
    this.submit.disabled = this.initialDisabled || Boolean(this.sending) || this.pendingQuotes > 0 || !this.source.value.trim();
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
      this.preview.srcdoc = '<!doctype html><meta charset="utf-8">' +
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src https: http: data:; media-src https: http:; base-uri \'none\'; form-action \'none\'">' +
        '<style>' + forumPreviewStyle + '</style>' + markup;
      this.preview.hidden = false;
      this.setStatus('');
    } catch {
      if (!controller.signal.aborted) this.setStatus('Preview unavailable. Your reply is still here.', true);
    }
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
    const draft = this.draft;
    const fields = new URLSearchParams(new this.win.FormData(this.form, this.submit));
    this.previewRequest?.abort();
    this.sending = true;
    this.refreshSubmit();
    this.source.readOnly = true;
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
      if (draft && this.readDraft()?.revision === draft.revision) {
        try { this.storage.delete(this.key); } catch {}
      }
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
      this.editor?.setDisabled(false);
    }
  }

  dispose() {
    this.save();
    this.abort.abort();
    this.previewRequest?.abort();
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
    this.dock.remove();
  }
}
