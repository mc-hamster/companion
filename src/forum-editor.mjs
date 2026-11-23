// SPDX-License-Identifier: GPL-3.0-or-later
import { Schema } from 'prosemirror-model';
import { EditorState, Selection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { baseKeymap, exitCode, lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { liftListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import { forumQuoteCredit, parseForumBBCode, safeForumLink, writeForumBBCode } from './forum-bbcode.mjs';

const forumSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
    quote: {
      group: 'block', content: 'block+', defining: true, attrs: { label: { default: '' } },
      parseDOM: [{ tag: 'blockquote', contentElement: el => el.querySelector(':scope > .epc-forum-block-text') || el }],
      toDOM(node) {
        const { author, href } = forumQuoteCredit(node.attrs.label);
        const content = ['div', { class: 'epc-forum-block-text' }, 0];
        if (!author) return ['blockquote', content];
        const credit = href ? ['a', { href, target: '_blank', rel: 'noopener noreferrer' }, author] : author;
        return ['blockquote', ['div', { class: 'epc-forum-block-label', contenteditable: 'false' }, credit], content];
      }
    },
    spoiler: {
      group: 'block', content: 'block+', defining: true, attrs: { label: { default: '' } },
      toDOM: node => ['div', { class: 'epc-forum-editor-spoiler' },
        ['div', { class: 'epc-forum-block-label', contenteditable: 'false' }, node.attrs.label || 'Spoiler'],
        ['div', { class: 'epc-forum-block-text' }, 0]]
    },
    code_block: {
      group: 'block', content: 'text*', marks: '', code: true, defining: true,
      attrs: { language: { default: '' }, variant: { default: 'code' } },
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }], toDOM: () => ['pre', ['code', 0]]
    },
    bullet_list: { group: 'block', content: 'list_item+', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] },
    list_item: { content: 'paragraph', defining: true, parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] }
  },
  marks: {
    strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight=bold' }], toDOM: () => ['strong', 0] },
    em: { parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }], toDOM: () => ['em', 0] },
    underline: { parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }], toDOM: () => ['u', 0] },
    strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }], toDOM: () => ['s', 0] },
    link: {
      inclusive: false, attrs: { href: {} },
      parseDOM: [{ tag: 'a[href]', getAttrs: el => {
        const href = safeForumLink(el.getAttribute('href'));
        return href ? { href } : false;
      } }],
      toDOM: mark => ['a', { href: safeForumLink(mark.attrs.href), rel: 'noopener noreferrer' }, 0]
    },
    literal: { inclusive: false, toDOM: () => ['span', { class: 'epc-forum-literal' }, 0] }
  }
});

export function readForumVisualSource(source) {
  const parsed = parseForumBBCode(source);
  if (!parsed) return null;
  const doc = forumSchema.nodeFromJSON(parsed);
  return writeForumBBCode(doc.toJSON()) === source ? doc : null;
}

function forumBlockIsActive(state, name) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === name) return true;
  }
  return false;
}

export function createForumEditor(root, doc, onChange) {
  const { marks, nodes } = forumSchema;
  const owner = root.ownerDocument;
  const toolbar = owner.createElement('div');
  toolbar.className = 'epc-forum-format';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'Reply formatting');
  const surface = owner.createElement('div');
  const buttons = [];
  const commands = {
    strong: toggleMark(marks.strong),
    em: toggleMark(marks.em),
    underline: toggleMark(marks.underline),
    strike: toggleMark(marks.strike),
    bullet_list: (state, dispatch, view) => forumBlockIsActive(state, 'bullet_list')
      ? liftListItem(nodes.list_item)(state, dispatch)
      : wrapInList(nodes.bullet_list)(state, dispatch, view),
    quote: (state, dispatch) => forumBlockIsActive(state, 'quote')
      ? lift(state, dispatch)
      : wrapIn(nodes.quote)(state, dispatch),
    spoiler: (state, dispatch) => forumBlockIsActive(state, 'spoiler')
      ? lift(state, dispatch)
      : wrapIn(nodes.spoiler)(state, dispatch),
    code_block: (state, dispatch) => setBlockType(
      forumBlockIsActive(state, 'code_block') ? nodes.paragraph : nodes.code_block
    )(state, dispatch)
  };
  const shortcuts = keymap({
    'Mod-b': commands.strong,
    'Mod-i': commands.em,
    'Mod-u': commands.underline,
    'Mod-z': undo,
    'Shift-Mod-z': redo,
    'Mod-y': redo,
    'Mod-Enter': exitCode,
    Enter: splitListItem(nodes.list_item),
    'Shift-Enter': (state, dispatch) => {
      if (state.selection.$from.parent.type.spec.code) return false;
      dispatch?.(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView());
      return true;
    }
  });

  let disabled = false;
  function updateButtons(state) {
    for (const { button, name } of buttons) {
      const { $from, empty, from, to } = state.selection;
      const mark = marks[name];
      const pressed = mark
        ? empty ? Boolean(mark.isInSet(state.storedMarks || $from.marks())) : state.doc.rangeHasMark(from, to, mark)
        : forumBlockIsActive(state, name);
      button.setAttribute('aria-pressed', String(pressed));
    }
  }

  const view = new EditorView(surface, {
    state: EditorState.create({ doc, selection: Selection.atEnd(doc), plugins: [history(), shortcuts, keymap(baseKeymap)] }),
    editable: () => !disabled,
    attributes: { role: 'textbox', 'aria-label': 'Reply text', 'aria-multiline': 'true', spellcheck: 'true' },
    dispatchTransaction(transaction) {
      view.updateState(view.state.apply(transaction));
      updateButtons(view.state);
      if (transaction.docChanged) onChange(writeForumBBCode(view.state.doc.toJSON()));
    }
  });
  function button(name, text, label, action) {
    const control = owner.createElement('button');
    control.type = 'button';
    control.dataset.format = name;
    control.textContent = text;
    control.title = label;
    control.setAttribute('aria-label', label);
    control.addEventListener('mousedown', event => event.preventDefault());
    control.addEventListener('click', action);
    toolbar.append(control);
    return control;
  }
  for (const [name, text, label] of [
    ['strong', 'B', 'Bold'], ['em', 'I', 'Italic'], ['underline', 'U', 'Underline'], ['strike', 'S', 'Strikethrough'],
    ['bullet_list', 'List', 'Bullet list'], ['quote', 'Quote', 'Quote block'], ['code_block', 'Code', 'Code block'],
    ['spoiler', 'Spoiler', 'Spoiler']
  ]) {
    const control = button(name, text, label, () => {
      commands[name](view.state, view.dispatch, view);
      view.focus();
    });
    buttons.push({ button: control, name });
  }

  const linkBox = owner.createElement('div');
  linkBox.className = 'epc-forum-link-box';
  linkBox.hidden = true;
  const linkInput = owner.createElement('input');
  linkInput.type = 'text';
  linkInput.inputMode = 'url';
  linkInput.placeholder = 'https://…';
  linkInput.setAttribute('aria-label', 'Link URL');
  const setLink = owner.createElement('button');
  setLink.type = 'button';
  setLink.textContent = 'Apply link';
  const linkError = owner.createElement('span');
  linkError.setAttribute('role', 'status');
  linkBox.append(linkInput, setLink, linkError);
  const linkButton = button('link', 'Link', 'Insert link', () => {
    linkBox.hidden = !linkBox.hidden;
    linkButton.setAttribute('aria-expanded', String(!linkBox.hidden));
    if (linkBox.hidden) {
      view.focus();
      return;
    }
    linkError.textContent = '';
    linkInput.value = '';
    linkInput.focus();
  });
  linkButton.setAttribute('aria-expanded', 'false');
  setLink.addEventListener('click', applyLink);
  linkInput.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    applyLink();
  });
  function applyLink() {
    const href = safeForumLink(linkInput.value.trim());
    if (!href) {
      linkError.textContent = 'Enter an http or https address.';
      return;
    }
    const { state } = view;
    const { from, to, empty } = state.selection;
    const mark = marks.link.create({ href });
    const transaction = empty
      ? state.tr.replaceSelectionWith(forumSchema.text(href, [mark]), false)
      : state.tr.addMark(from, to, mark);
    view.dispatch(transaction);
    linkBox.hidden = true;
    linkButton.setAttribute('aria-expanded', 'false');
    view.focus();
  }

  updateButtons(view.state);
  root.append(toolbar, linkBox, surface);
  return {
    focus: () => view.focus(),
    setDisabled(value) {
      disabled = value;
      view.setProps({ editable: () => !disabled });
      for (const control of root.querySelectorAll('button, input')) control.disabled = value;
    },
    appendQuote(quote) {
      const parsed = readForumVisualSource(quote);
      if (!parsed) return false;
      const { state } = view;
      const end = state.doc.content.size;
      const last = state.doc.lastChild;
      const start = last.type === nodes.paragraph && !last.content.size ? end - last.nodeSize : end;
      const transaction = state.tr.replaceWith(start, end, parsed.content).insert(
        start + parsed.content.size, nodes.paragraph.create()
      );
      view.dispatch(transaction.setSelection(Selection.atEnd(transaction.doc)));
      return true;
    },
    destroy() { view.destroy(); root.replaceChildren(); }
  };
}
