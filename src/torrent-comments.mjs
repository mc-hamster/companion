// SPDX-License-Identifier: GPL-3.0-or-later
import { mountForumInlineEditor } from './forum-inline-editor.mjs';
import { forumSiteTheme } from './forum-ui.mjs';

function torrentCommentSource(discussion, page, torrentID) {
  const form = discussion.querySelector('form#quickpostform');
  if (form?.method !== 'post' ||
      form.querySelector('input[type="hidden"][name="action"]')?.value !== 'add_comment' ||
      form.querySelector('input[type="hidden"][name="groupid"]')?.value !== torrentID) return null;
  const action = form.getAttribute('action') || page.href;
  if (!URL.canParse(action, page)) return null;
  const target = new URL(action, page);
  if (target.origin !== page.origin || target.pathname !== page.pathname) return null;
  return form.querySelector('#quickreplytext > textarea#quickpost[name="body"]:not([readonly],:disabled)');
}

export function mountTorrentCommentEditors(discussion, state, torrentID, addStyle) {
  const win = discussion.ownerDocument.defaultView;
  const edits = new Map();
  const context = 'torrent.' + torrentID;
  let style;
  function mount(source, options) {
    if (!discussion.hasAttribute('data-ep-forum-theme')) {
      discussion.dataset.epForumTheme = forumSiteTheme(win, source.parentElement);
      style = addStyle();
    }
    return mountForumInlineEditor(source, state, options);
  }

  const source = torrentCommentSource(discussion, state.page, torrentID);
  const reply = source && mount(source, { context: context + '.comment', label: 'Comment body', nativeQuote: true });
  function syncEdits() {
    for (const [field, editor] of edits) {
      if (discussion.contains(field)) continue;
      editor.dispose();
      edits.delete(field);
    }
    for (const field of discussion.querySelectorAll('textarea[id^="editbox"][name="body"]')) {
      const id = /^editbox([1-9]\d{0,14})$/.exec(field.id)?.[1];
      if (!id || !field.closest('.postbody > #content' + id + ' > #editcont' + id)) continue;
      const post = field.closest('table.forum_post#post' + id);
      const bar = post?.rows[0]?.cells[0]?.querySelector('#bar' + id);
      const submit = bar?.querySelector('#edit_save_' + id + ', input[onclick^="SaveEdit("]');
      const editor = edits.get(field);
      if (editor) editor.setSubmit(submit);
      else if (submit && !field.readOnly && !field.matches(':disabled')) {
        edits.set(field, mount(field, { context: context + '.edit.' + id, label: 'Edit comment body', submit }));
      }
    }
  }

  const observer = new win.MutationObserver(records => {
    if (records.some(({ target }) => !target.closest?.('.epc-forum-inline-editor'))) syncEdits();
  });
  observer.observe(discussion, { childList: true, subtree: true });
  syncEdits();
  return () => {
    observer.disconnect();
    reply?.dispose();
    for (const editor of edits.values()) editor.dispose();
    style?.remove?.();
    delete discussion.dataset.epForumTheme;
  };
}
