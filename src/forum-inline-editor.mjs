// SPDX-License-Identifier: GPL-3.0-or-later
import { createForumEditor, forumEditorFonts, forumVisualPreference, readForumVisualSource } from './forum-editor.mjs';
import { ForumMedia } from './forum-media.mjs';
import { forumButton, forumElement, forumHelpLink } from './forum-ui.mjs';

export function forumNewTopicSource(content, page, board) {
  const form = content.querySelector('form#newthreadform');
  const action = form?.getAttribute('action');
  if (form?.method !== 'post' || !action || !URL.canParse(action, page)) return null;
  const target = new URL(action, page);
  if (target.origin !== page.origin || target.pathname !== '/forum/' + board + '/new' || target.search || target.hash) return null;
  return form.querySelector('#newthreadtext textarea#posttext[name="body"]');
}

export function mountForumInlineEditor(source, { storage, page, account, media: mediaOptions }, {
  context, label, submit, nativeQuote = false
}) {
  const doc = source.ownerDocument;
  const win = doc.defaultView;
  const parent = source.parentElement;
  const nativeTools = parent.querySelector(':scope > .bb_holder, :scope > .bbcode_assistant');
  const nativePicker = doc.getElementById('hover_pick' + source.id);
  const sourceState = nativeQuote && ['tabindex', 'aria-hidden'].map(name => [name, source.getAttribute(name)]);
  const root = forumElement(doc, 'div', 'epc-root epc-forum-inline-editor');
  const modes = forumElement(doc, 'div', 'epc-forum-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', label + ' editor mode');
  const visual = forumButton(doc, 'Visual');
  const bbcode = forumButton(doc, 'BBCode');
  const help = forumHelpLink(doc);
  const status = forumElement(doc, 'p', 'epc-forum-inline-status');
  status.setAttribute('role', 'status');
  const editorArea = forumElement(doc, 'div', 'epc-forum-visual');
  editorArea.hidden = true;
  let editor, visualSource;
  const form = source.form;
  submit ??= form?.querySelector('[type="submit"]');
  let lockedSubmit = false;

  function lockSubmit(busy) {
    if (busy && submit && !submit.disabled) {
      submit.disabled = lockedSubmit = true;
    } else if (!busy && lockedSubmit) {
      submit.disabled = lockedSubmit = false;
    }
  }

  function focusEditor() {
    if (editorArea.hidden) source.focus();
    else editor.focus();
  }

  function setNativeToolsHidden(hidden) {
    for (const node of [nativeTools, nativePicker]) node?.classList.toggle('epc-forum-inline-hidden', hidden);
    if (!sourceState) {
      source.classList.toggle('epc-forum-inline-hidden', hidden);
      return;
    }
    source.classList.toggle('epc-forum-inline-quote-source', hidden);
    if (hidden) {
      source.tabIndex = -1;
      source.setAttribute('aria-hidden', 'true');
    } else {
      for (const [name, value] of sourceState) {
        if (value === null) source.removeAttribute(name);
        else source.setAttribute(name, value);
      }
    }
  }

  const media = new ForumMedia({
    ...mediaOptions, win, storage, page, account, context, source,
    visualArea: editorArea, scope: parent, getVisualEditor: () => editorArea.hidden ? null : editor,
    afterInsert: () => { if (parent.contains(doc.activeElement)) focusEditor(); },
    busyChanged: () => lockSubmit(media.uploading), close: focusEditor
  });
  form?.addEventListener('submit', event => {
    if (!media.uploading) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true, signal: media.abort.signal });

  function show(useVisual, focus = true) {
    const parsed = useVisual && (!editor || source.value !== visualSource) ? readForumVisualSource(source.value) : undefined;
    status.textContent = parsed === null ? 'This text uses formatting that needs BBCode.' : '';
    if (parsed) {
      editor?.destroy();
      visualSource = source.value;
      editor = createForumEditor(editorArea, parsed, value => {
        visualSource = source.value = value;
        source.dispatchEvent(new win.Event('input', { bubbles: true }));
      }, { page, label, optionsId: 'epc-forum-options-' + source.id, fonts: forumEditorFonts(parent),
        mediaId: media.root.id, openImages: (href, trigger) => media.open(href, trigger) });
    }
    const active = useVisual && Boolean(editor) && parsed !== null;
    editorArea.hidden = help.hidden = !active;
    media.sourceButton.hidden = active;
    setNativeToolsHidden(active);
    visual.setAttribute('aria-pressed', String(active));
    bbcode.setAttribute('aria-pressed', String(!active));
    if (focus) {
      if (parsed !== null) {
        try { storage.set(forumVisualPreference, active); } catch {}
      }
      focusEditor();
    }
  }

  visual.addEventListener('click', () => show(true));
  bbcode.addEventListener('click', () => show(false));
  modes.append(visual, bbcode, help, media.sourceButton);
  root.append(modes, status, media.root, editorArea);
  (nativeTools || source).before(root);
  let previewObserver;
  if (nativeQuote) {
    // Luminance writes quotes straight to the textarea, then focuses it.
    const syncSource = () => {
      if (!editorArea.hidden && source.value !== visualSource) show(true, false);
    };
    source.addEventListener('focus', () => {
      if (editorArea.hidden) return;
      syncSource();
      focusEditor();
    }, { signal: media.abort.signal });
    // Returning from a native preview can reveal a quote inserted while the reply editor was hidden.
    previewObserver = new win.MutationObserver(syncSource);
    previewObserver.observe(parent, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  }
  let preferred = false;
  try { preferred = storage.get(forumVisualPreference, false) === true; } catch {}
  show(preferred, false);
  return {
    source,
    setSubmit(button) {
      if (submit === button) return;
      lockSubmit(false);
      submit = button;
      lockSubmit(media.uploading);
    },
    dispose() {
      previewObserver?.disconnect();
      media.destroy();
      lockSubmit(false);
      editor?.destroy();
      setNativeToolsHidden(false);
      root.remove();
    }
  };
}
