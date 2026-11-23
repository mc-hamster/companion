// SPDX-License-Identifier: GPL-3.0-or-later
import { Schema } from 'prosemirror-model';
import { EditorState, Selection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { baseKeymap, exitCode } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { splitListItem } from 'prosemirror-schema-list';
import { goToNextCell, tableEditing, tableNodes } from 'prosemirror-tables';
import {
  forumAlignment, forumLayoutStyle, forumMarkValue, forumQuoteCredit, forumSiteLabels, forumSizeStyle,
  forumVideoProvider, parseForumBBCode, safeForumLink, safeForumMediaURL, writeForumBBCode
} from './forum-bbcode.mjs';
import { forumFormattingCommands, mountForumToolbar } from './forum-editor-tools.mjs';

function forumStyledMark(type, style) {
  return {
    attrs: { value: {}, tag: { default: '' } },
    parseDOM: [{
      tag: 'span[data-ep-forum-' + type + ']',
      getAttrs: el => {
        const value = forumMarkValue(type, el.getAttribute('data-ep-forum-' + type));
        return value === null ? false : { value };
      }
    }],
    toDOM(mark) {
      const value = forumMarkValue(type, mark.attrs.value);
      return ['span', { ['data-ep-forum-' + type]: value, ...style(value) }, 0];
    }
  };
}

function safeLayoutLabel(value) {
  return typeof value === 'string' && !/[\]\r\n]/.test(value) ? value : '';
}

const forumTables = tableNodes({
  tableGroup: 'block',
  cellContent: 'block+',
  cellAttributes: {
    label: {
      default: '',
      setDOMAttr(value, attrs) {
        if (!value) return;
        attrs['data-ep-forum-layout'] = value;
        attrs.style = forumLayoutStyle(value);
      }
    },
    gap: { default: '' }
  }
});
// The site uses plain cells. Pasted HTML contributes content and headers, without HTML-only spans.
for (const [name, tag] of [['table_cell', 'td'], ['table_header', 'th']]) {
  forumTables[name].parseDOM = [{
    tag, getAttrs: element => ({ label: safeLayoutLabel(element.getAttribute('data-ep-forum-layout')) })
  }];
}
for (const [name, tag] of [['table', 'table'], ['table_row', 'tr']]) {
  Object.assign(forumTables[name], {
    attrs: { label: { default: '' }, gap: { default: '' }, tail: { default: '' } },
    parseDOM: [{ tag, getAttrs: el => ({ label: safeLayoutLabel(el.getAttribute('data-ep-forum-layout')) }) }],
    toDOM(node) {
      const attrs = { 'data-ep-forum-layout': node.attrs.label, style: forumLayoutStyle(node.attrs.label) };
      return tag === 'table' ? [tag, attrs, ['tbody', 0]] : [tag, attrs, 0];
    }
  });
}

const forumSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
    horizontal_rule: { group: 'block', atom: true, parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
    image: {
      inline: true, group: 'inline', atom: true, draggable: true,
      attrs: { href: {}, resize: { default: '' } },
      parseDOM: [{ tag: 'img[src]:not([data-ep-forum-smiley])', getAttrs: el => {
        const href = safeForumMediaURL(el.getAttribute('src'));
        return href ? { href } : false;
      } }],
      toDOM(node) {
        const [width, height] = node.attrs.resize.split(',').map(Number);
        return ['img', { src: safeForumMediaURL(node.attrs.href), alt: 'Image', loading: 'lazy',
          class: 'epc-forum-editor-image', width: width || null, height: height || null }];
      }
    },
    video: {
      inline: true, group: 'inline', atom: true, attrs: { href: {} },
      parseDOM: [{ tag: 'span[data-ep-forum-video]', getAttrs: el => {
        const href = el.getAttribute('data-ep-forum-video');
        return forumVideoProvider(href) ? { href } : false;
      } }],
      toDOM(node) {
        return ['span', { class: 'epc-forum-embed', 'data-ep-forum-video': node.attrs.href, title: node.attrs.href },
          forumVideoProvider(node.attrs.href) + ' video'];
      }
    },
    url_text: {
      inline: true, group: 'inline', atom: true, attrs: { href: {} },
      parseDOM: [{ tag: 'a[data-ep-forum-url]', getAttrs: el => {
        const href = safeForumLink(el.getAttribute('href'));
        return href ? { href } : false;
      } }],
      toDOM: node => ['a', { href: safeForumLink(node.attrs.href), 'data-ep-forum-url': '' }, node.attrs.href]
    },
    smiley: {
      inline: true, group: 'inline', atom: true, attrs: { code: {}, href: {} },
      parseDOM: [{ tag: 'img[data-ep-forum-smiley]', getAttrs: el => {
        const code = el.getAttribute('data-ep-forum-smiley');
        const href = safeForumMediaURL(el.getAttribute('src'));
        return code && /^[^\[\]\r\n]{1,64}$/.test(code) && href ? { code, href } : false;
      } }],
      toDOM: node => ['img', { 'data-ep-forum-smiley': node.attrs.code, src: safeForumMediaURL(node.attrs.href),
        class: 'epc-forum-editor-smiley', alt: node.attrs.code, title: node.attrs.code }]
    },
    site_label: {
      inline: true, group: 'inline', atom: true, attrs: { tag: {} },
      parseDOM: [{ tag: 'span[data-ep-forum-label]', getAttrs: el => {
        const tag = el.getAttribute('data-ep-forum-label');
        return Object.hasOwn(forumSiteLabels, tag) ? { tag } : false;
      } }],
      toDOM: node => ['span', { class: 'epc-forum-embed', 'data-ep-forum-label': node.attrs.tag },
        Object.hasOwn(forumSiteLabels, node.attrs.tag) ? forumSiteLabels[node.attrs.tag] : 'Post label']
    },
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
      parseDOM: [{ tag: 'div[data-ep-forum-spoiler]',
        getAttrs: el => ({ label: safeLayoutLabel(el.getAttribute('data-ep-forum-spoiler')) }),
        contentElement: '.epc-forum-block-text' }],
      toDOM: node => ['div', { class: 'epc-forum-editor-spoiler', 'data-ep-forum-spoiler': node.attrs.label },
        ['div', { class: 'epc-forum-block-label', contenteditable: 'false' }, node.attrs.label || 'Spoiler'],
        ['div', { class: 'epc-forum-block-text' }, 0]]
    },
    align: {
      group: 'block', content: 'block+', attrs: { label: { default: 'left' }, tag: { default: '' } },
      parseDOM: [{ tag: 'div[data-ep-forum-align]', getAttrs: el => {
        const label = forumAlignment(el.getAttribute('data-ep-forum-align'));
        return label ? { label } : false;
      } }],
      toDOM: node => ['div', { 'data-ep-forum-align': node.attrs.label,
        style: 'text-align:' + (forumAlignment(node.attrs.label) || 'left') }, 0]
    },
    bg: {
      group: 'block', content: 'block+', defining: true, attrs: { label: { default: '' } },
      parseDOM: [{ tag: 'div[data-ep-forum-background]',
        getAttrs: el => ({ label: safeLayoutLabel(el.getAttribute('data-ep-forum-background')) }) }],
      toDOM: node => ['div', { class: 'epc-forum-editor-bg', 'data-ep-forum-background': node.attrs.label,
        style: forumLayoutStyle(node.attrs.label) }, 0]
    },
    code_block: {
      group: 'block', content: 'text*', marks: '', code: true, defining: true,
      attrs: { language: { default: '' }, variant: { default: 'code' } },
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }], toDOM: () => ['pre', ['code', 0]]
    },
    bullet_list: { group: 'block', content: 'list_item+', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] },
    list_item: { content: 'paragraph', defining: true, parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] },
    ...forumTables
  },
  marks: {
    strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight=bold' }], toDOM: () => ['strong', 0] },
    em: { parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }], toDOM: () => ['em', 0] },
    underline: { parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }], toDOM: () => ['u', 0] },
    strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }], toDOM: () => ['s', 0] },
    sup: { excludes: 'sub', parseDOM: [{ tag: 'sup' }], toDOM: () => ['sup', 0] },
    sub: { excludes: 'sup', parseDOM: [{ tag: 'sub' }], toDOM: () => ['sub', 0] },
    font: forumStyledMark('font', value => ({ style: value && 'font-family:' + value })),
    size: forumStyledMark('size', value => ({ style: 'font-size:' + forumSizeStyle(value) })),
    color: forumStyledMark('color', value => ({ style: value && 'color:' + value })),
    anchor: forumStyledMark('anchor', value => ({ class: 'epc-forum-anchor', title: value && '#' + value })),
    link: {
      inclusive: false, attrs: { href: {} },
      parseDOM: [{ tag: 'a[href]:not([data-ep-forum-url])', getAttrs: el => {
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
  try {
    const doc = forumSchema.nodeFromJSON(parsed);
    doc.check();
    const serialized = writeForumBBCode(doc.toJSON());
    if (serialized === source) return doc;
    // Native tags can nest in either order. Keep the source untouched until an edit.
    const restored = parseForumBBCode(serialized);
    return restored && forumSchema.nodeFromJSON(restored).eq(doc) ? doc : null;
  } catch {
    return null;
  }
}

export function createForumEditor(root, doc, onChange, options) {
  const { nodes } = forumSchema;
  const commands = forumFormattingCommands(forumSchema);
  const surface = root.ownerDocument.createElement('div');
  const shortcuts = keymap({
    'Mod-b': commands.strong, 'Mod-i': commands.em, 'Mod-u': commands.underline,
    'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo,
    'Mod-Enter': exitCode,
    Enter: splitListItem(nodes.list_item),
    Tab: goToNextCell(1), 'Shift-Tab': goToNextCell(-1),
    'Shift-Enter': (state, dispatch) => {
      if (state.selection.$from.parent.type.spec.code) return false;
      dispatch?.(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView());
      return true;
    }
  });

  let disabled = false;
  let toolbar;
  const view = new EditorView(surface, {
    state: EditorState.create({ doc, selection: Selection.atEnd(doc),
      plugins: [history(), shortcuts, keymap(baseKeymap), tableEditing({ allowTableNodeSelection: true })] }),
    editable: () => !disabled,
    attributes: { role: 'textbox', 'aria-label': 'Reply text', 'aria-multiline': 'true', spellcheck: 'true' },
    dispatchTransaction(transaction) {
      view.updateState(view.state.apply(transaction));
      toolbar?.sync();
      if (transaction.docChanged) onChange(writeForumBBCode(view.state.doc.toJSON()));
    }
  });
  toolbar = mountForumToolbar(root, view, commands, options);
  root.append(surface);
  return {
    focus: () => view.focus(),
    setDisabled(value) {
      disabled = value;
      view.setProps({ editable: () => !disabled });
      toolbar.sync(disabled);
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
    destroy() { toolbar.destroy(); view.destroy(); root.replaceChildren(); }
  };
}
