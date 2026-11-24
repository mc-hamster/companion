// SPDX-License-Identifier: GPL-3.0-or-later
import { Fragment, Slice } from 'prosemirror-model';
import { Selection, TextSelection } from 'prosemirror-state';
import { lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { liftListItem, wrapInList } from 'prosemirror-schema-list';
import { addColumnAfter, addRowAfter, deleteColumn, deleteRow, deleteTable, isInTable, toggleHeaderRow } from 'prosemirror-tables';
import { forumMarkValue, forumSiteLabels, forumVideoProvider, safeForumLink, safeForumMediaURL } from './forum-bbcode.mjs';

const alignments = [['left', 'Align left'], ['center', 'Center'], ['right', 'Align right'], ['justify', 'Justify']];
const defaultFonts = ['Arial', 'Courier New', 'Georgia', 'Helvetica', 'Tahoma', 'Times New Roman', 'Verdana'];

function forumBlock(state, name) {
  const { $from, to } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    const pos = $from.before(depth);
    if (node.type.name === name && to <= $from.end(depth)) return { node, pos };
  }
  return null;
}

function forumActiveMark(state, type) {
  const { $from, from, to, empty } = state.selection;
  if (empty) return type.isInSet(state.storedMarks || $from.marks());
  let found;
  state.doc.nodesBetween(from, to, node => {
    if (!found && node.isInline) found = type.isInSet(node.marks);
  });
  return found;
}

function forumMarkRange(state, type) {
  const { from, to, empty, $from } = state.selection;
  const mark = empty && type.isInSet($from.marks());
  if (!mark) return { from, to };
  const groups = [];
  $from.parent.forEach((child, offset) => {
    const other = type.isInSet(child.marks);
    if (!other || !mark.eq(other)) return;
    const end = offset + child.nodeSize;
    const previous = groups.at(-1);
    if (previous?.to === offset) previous.to = end;
    else groups.push({ from: offset, to: end });
  });
  const range = groups.find(group => group.from <= $from.parentOffset && group.to >= $from.parentOffset);
  const start = $from.start();
  return range ? { from: start + range.from, to: start + range.to } : { from, to };
}

export function forumFormattingCommands({ marks, nodes }) {
  return {
    strong: toggleMark(marks.strong), em: toggleMark(marks.em), underline: toggleMark(marks.underline),
    strike: toggleMark(marks.strike), sup: toggleMark(marks.sup), sub: toggleMark(marks.sub),
    bullet_list: (state, dispatch, view) => forumBlock(state, 'bullet_list')
      ? liftListItem(nodes.list_item)(state, dispatch)
      : wrapInList(nodes.bullet_list)(state, dispatch, view),
    quote: (state, dispatch) => forumBlock(state, 'quote') ? lift(state, dispatch) : wrapIn(nodes.quote)(state, dispatch),
    code_block: (state, dispatch) => setBlockType(
      forumBlock(state, 'code_block') ? nodes.paragraph : nodes.code_block
    )(state, dispatch)
  };
}

function changeForumMark(view, name, attrs, text, editCurrent = false) {
  const { state, dispatch } = view;
  const type = state.schema.marks[name];
  const { from, to } = editCurrent ? forumMarkRange(state, type) : state.selection;
  const mark = attrs && type.create(attrs);
  const transaction = state.tr;
  if (text) {
    const other = (state.storedMarks || state.selection.$from.marks()).filter(item => item.type !== type);
    const inserted = state.schema.text(text, mark ? mark.addToSet(other) : other);
    if (from === to) transaction.replaceSelectionWith(inserted, false);
    else transaction.replaceWith(from, to, inserted);
  } else if (from === to) {
    if (mark) transaction.addStoredMark(mark);
    else transaction.removeStoredMark(type);
  } else {
    transaction.removeMark(from, to, type);
    if (mark) transaction.addMark(from, to, mark);
  }
  dispatch(transaction);
}

function changeForumBlock(view, name, label) {
  const { state, dispatch } = view;
  const previous = forumBlock(state, name);
  if (previous && label !== null) {
    dispatch(state.tr.setNodeMarkup(previous.pos, undefined, { label }));
  } else if (previous) {
    const { from, to } = state.selection;
    const transaction = state.tr.replaceWith(previous.pos, previous.pos + previous.node.nodeSize, previous.node.content);
    dispatch(transaction.setSelection(TextSelection.between(transaction.doc.resolve(from - 1), transaction.doc.resolve(to - 1))));
  } else if (label !== null) {
    wrapIn(state.schema.nodes[name], { label })(state, dispatch);
  }
}

function changeForumCase(view, transform) {
  const { state } = view;
  const { from, to } = state.selection;
  const changes = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    const value = node.text.slice(start - pos, end - pos);
    const text = transform(value);
    if (text !== value) changes.push({ start, end, text, marks: node.marks });
  });
  const transaction = state.tr;
  for (const { start, end, text, marks } of changes.reverse()) {
    transaction.replaceWith(start, end, state.schema.text(text, marks));
  }
  if (transaction.docChanged) view.dispatch(transaction);
}

function insertForumBlock(view, node) {
  const { state } = view;
  const transaction = state.tr.replaceSelectionWith(node, false);
  let before;
  transaction.doc.descendants((candidate, pos) => {
    if (candidate === node) before = pos;
    return before === undefined;
  });
  if (before !== undefined) {
    const after = before + node.nodeSize;
    if (after === transaction.doc.content.size) transaction.insert(after, state.schema.nodes.paragraph.create());
    const inside = node.type.name === 'table' ? before + 1 : after;
    const selection = Selection.findFrom(transaction.doc.resolve(inside), 1, true);
    if (selection) transaction.setSelection(selection);
  }
  view.dispatch(transaction.scrollIntoView());
}

async function loadForumSmilies(page, from, signal, win) {
  const url = new URL('/ajax.php', page);
  url.search = new URLSearchParams({ action: 'get_smilies', indexfrom: from, indexto: from + 36 });
  const response = await win.fetch(url.href, { credentials: 'same-origin', mode: 'same-origin', redirect: 'error', signal });
  if (!response.ok) throw new Error('Smilies are unavailable.');
  const xml = new win.DOMParser().parseFromString(await response.text(), 'application/xml');
  if (xml.querySelector('parsererror') || xml.documentElement.localName !== 'smilies') throw new Error('Smilies are unavailable.');
  const records = [...xml.querySelectorAll('smiley')];
  const template = win.document.createElement('template');
  const items = [];
  for (const record of records) {
    const code = record.querySelector('bbcode')?.textContent.trim();
    let uri = record.querySelector('url')?.textContent.trim();
    // Empornium returns an escaped image tag in the URL field.
    if (uri?.startsWith('<')) {
      template.innerHTML = uri;
      const image = template.content.firstElementChild;
      uri = image?.matches('img') ? image.getAttribute('src')?.trim() : undefined;
    }
    if (!code || !uri || !/^[^\[\]\r\n]{1,64}$/.test(code) || !URL.canParse(uri, page)) continue;
    const href = safeForumMediaURL(new URL(uri, page).href);
    if (href) items.push({ code, href });
  }
  return { items, next: from + records.length, max: Number(xml.querySelector('maxsmilies')?.textContent) || 0 };
}

export function mountForumToolbar(root, view, commands, { fonts = defaultFonts, page = root.ownerDocument.baseURI, openImages } = {}) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const controller = new win.AbortController();
  const { nodes, marks } = view.state.schema;
  const buttonStates = [];
  let activePanel, panelSubmit;
  let disabled = false;

  const element = (tag, text = '', className = '') => {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const toolbar = element('div', '', 'epc-forum-format');
  const textTools = element('div', '', 'epc-forum-format-row');
  const insertTools = element('div', '', 'epc-forum-format-row');
  const tableTools = element('div', '', 'epc-forum-table-tools epc-forum-format-row');
  const panel = element('div', '', 'epc-forum-tool-panel');
  for (const [row, name] of [[textTools, 'Text formatting'], [insertTools, 'Insert in reply'], [tableTools, 'Table controls']]) {
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', name);
  }
  panel.hidden = true;
  toolbar.append(textTools, insertTools, tableTools);
  const rootId = 'epc-forum-editor-options';
  panel.id = rootId;
  root.append(toolbar, panel);

  function button(parent, name, text, label, action) {
    const control = element('button', text);
    control.type = 'button';
    control.dataset.format = name;
    control.title = label;
    control.setAttribute('aria-label', label);
    control.addEventListener('mousedown', event => event.preventDefault());
    control.addEventListener('click', action);
    parent.append(control);
    return control;
  }

  function options(select, choices) {
    for (const [value, text] of choices) {
      const option = element('option', text);
      option.value = value;
      select.append(option);
    }
  }

  function dropdown(parent, name, choices, action) {
    const select = element('select');
    select.setAttribute('aria-label', name);
    select.title = name;
    options(select, [['', name], ...choices]);
    select.addEventListener('change', () => {
      action(select.value);
      view.focus();
      sync();
    });
    parent.append(select);
    return select;
  }

  function closePanel(returnFocus = true) {
    activePanel?.setAttribute('aria-expanded', 'false');
    activePanel = panelSubmit = null;
    panel.hidden = true;
    if (returnFocus) view.focus();
  }

  function showPanel(trigger, content) {
    if (trigger === activePanel) {
      closePanel();
      return false;
    }
    closePanel(false);
    activePanel = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    panel.replaceChildren(content);
    panel.hidden = false;
    return true;
  }

  function configure(trigger, fields, action, { label = 'Apply', remove } = {}) {
    const content = element('div', '', 'epc-forum-tool-fields');
    const status = element('span', '', 'epc-forum-tool-status');
    status.setAttribute('role', 'status');
    const inputs = [];
    for (const field of fields) {
      const row = element('label', '', 'epc-forum-tool-field');
      const input = element(field.choices ? 'select' : 'input');
      input.setAttribute('aria-label', field.label);
      if (field.choices) {
        options(input, field.choices);
      } else {
        input.type = 'text';
        input.inputMode = field.inputMode ?? 'text';
        input.placeholder = field.placeholder ?? '';
      }
      input.value = field.value ?? '';
      row.append(element('span', field.label), input);
      if (field.swatch) {
        const picker = element('input');
        picker.type = 'color';
        picker.setAttribute('aria-label', 'Color picker');
        picker.value = /^#[\da-f]{6}$/i.test(input.value) ? input.value : '#274f9d';
        picker.addEventListener('input', () => { input.value = picker.value; });
        row.append(picker);
      }
      inputs.push(input);
      content.append(row);
    }
    const submit = () => {
      if (disabled) return;
      const error = action(inputs.map(input => input.value.trim()));
      if (error) status.textContent = error;
      else closePanel();
    };
    const controls = element('div', '', 'epc-forum-tool-actions');
    button(controls, 'apply-tool', label, label, submit);
    if (remove) button(controls, 'remove-tool', 'Remove', 'Remove formatting', () => { remove(); closePanel(); });
    button(controls, 'cancel-tool', 'Cancel', 'Cancel', () => closePanel());
    content.append(controls, status);
    if (showPanel(trigger, content)) {
      panelSubmit = submit;
      inputs[0]?.focus();
    }
  }

  function panelButton(parent, name, title, label, open) {
    const control = button(parent, name, title, label, () => open(control));
    control.setAttribute('aria-controls', rootId);
    control.setAttribute('aria-expanded', 'false');
    return control;
  }

  panel.addEventListener('keydown', event => {
    if (event.isComposing || event.key !== 'Escape' && (event.key !== 'Enter' || !event.target.matches('input[type=text]'))) return;
    event.preventDefault();
    if (event.key === 'Escape') closePanel();
    else panelSubmit?.();
  });

  function run(command) {
    command(view.state, view.dispatch, view);
    closePanel();
    sync();
  }

  const undoButton = button(textTools, 'undo', '↶', 'Undo', () => run(undo));
  const redoButton = button(textTools, 'redo', '↷', 'Redo', () => run(redo));
  for (const [name, text, label] of [
    ['strong', 'B', 'Bold'], ['em', 'I', 'Italic'], ['underline', 'U', 'Underline'], ['strike', 'S', 'Strikethrough'],
    ['sup', 'x²', 'Superscript'], ['sub', 'x₂', 'Subscript']
  ]) {
    const toggle = button(textTools, name, text, label, () => run(commands[name]));
    buttonStates.push([toggle, name]);
  }

  const font = dropdown(textTools, 'Font', [...fonts.map(name => [name, name]), ['default', 'Default font']], value => {
    if (value) changeForumMark(view, 'font', value === 'default' ? null : { value });
  });
  const size = dropdown(textTools, 'Size', [...Array.from({ length: 11 }, (_, i) => [String(i), String(i)]), ['default', 'Default size']], value => {
    if (value) changeForumMark(view, 'size', value === 'default' ? null : { value });
  });
  const color = panelButton(textTools, 'color', 'Color', 'Text color', trigger => {
    const mark = forumActiveMark(view.state, marks.color);
    configure(trigger, [{ label: 'Text color', value: mark?.attrs.value || '#274f9d', swatch: true }], ([value]) => {
      if (!forumMarkValue('color', value)) return 'Enter a color name or a hex color.';
      changeForumMark(view, 'color', { value }, '', true);
    }, { remove: mark && (() => changeForumMark(view, 'color', null, '', true)) });
  });
  const align = dropdown(textTools, 'Alignment', [...alignments, ['default', 'Default alignment']], value => {
    if (value) changeForumBlock(view, 'align', value === 'default' ? null : value);
  });
  const letterCase = dropdown(textTools, 'Case', [['upper', 'Uppercase'], ['lower', 'Lowercase']], value => {
    if (value) changeForumCase(view, text => value === 'upper' ? text.toUpperCase() : text.toLowerCase());
  });

  panelButton(insertTools, 'link', 'Link', 'Insert link', trigger => {
    const current = forumActiveMark(view.state, marks.link);
    configure(trigger, [
      { label: 'Link URL', value: current?.attrs.href, placeholder: 'https://… or #anchor', inputMode: 'url' },
      { label: 'Link text', placeholder: 'Optional' }
    ], ([url, text]) => {
      const href = safeForumLink(url);
      if (!href) return 'Enter a web address, a site path, or an anchor.';
      changeForumMark(view, 'link', { href }, text || (!current && view.state.selection.empty && href), true);
    }, { label: 'Apply link', remove: current && (() => changeForumMark(view, 'link', null, '', true)) });
  });
  const images = button(insertTools, 'image', 'Image', 'Insert image', () => {
    const current = view.state.selection.node;
    closePanel(false);
    openImages?.(current?.type === nodes.image ? current.attrs.href : null, images);
  });
  images.setAttribute('aria-controls', 'epc-forum-media');
  images.setAttribute('aria-expanded', 'false');
  panelButton(insertTools, 'video', 'Video', 'Insert video', trigger => {
    const current = view.state.selection.node;
    configure(trigger, [{ label: 'Video URL', value: current?.type === nodes.video ? current.attrs.href : '', placeholder: 'https://…', inputMode: 'url' }], ([href]) => {
      if (!forumVideoProvider(href)) return 'Enter a YouTube, Vimeo, or Streamable video address.';
      view.dispatch(view.state.tr.replaceSelectionWith(nodes.video.create({ href })));
    }, { label: 'Insert video' });
  });
  panelButton(insertTools, 'table', 'Table', 'Insert table', trigger => {
    configure(trigger, [
      { label: 'Columns', value: '2', inputMode: 'numeric' }, { label: 'Rows', value: '2', inputMode: 'numeric' }
    ], ([columns, rows]) => {
      const x = Number(columns), y = Number(rows);
      if (!Number.isInteger(x) || x < 1 || x > 20 || !Number.isInteger(y) || y < 1 || y > 40) {
        return 'Choose 1–20 columns and 1–40 rows.';
      }
      const content = Array.from({ length: y }, () => nodes.table_row.create({ gap: '\n' },
        Array.from({ length: x }, () => nodes.table_cell.createAndFill())));
      insertForumBlock(view, nodes.table.create({ tail: '\n' }, content));
    }, { label: 'Insert table' });
  });
  for (const [name, text, label] of [['bullet_list', 'List', 'Bullet list'], ['quote', 'Quote', 'Quote block'], ['code_block', 'Code', 'Code block']]) {
    const toggle = button(insertTools, name, text, label, () => run(commands[name]));
    buttonStates.push([toggle, name]);
  }
  panelButton(insertTools, 'spoiler', 'Spoiler', 'Spoiler', trigger => {
    const current = forumBlock(view.state, 'spoiler');
    configure(trigger, [{ label: 'Spoiler title', value: current?.node.attrs.label, placeholder: 'Optional' }], ([label]) => {
      if (/[\]\r\n]/.test(label)) return 'Use a title without closing brackets.';
      changeForumBlock(view, 'spoiler', label);
    }, { remove: current && (() => changeForumBlock(view, 'spoiler', null)) });
  });
  panelButton(insertTools, 'anchor', 'Anchor', 'Anchor heading', trigger => {
    const current = forumActiveMark(view.state, marks.anchor);
    configure(trigger, [
      { label: 'Anchor name', value: current?.attrs.value, placeholder: 'release-notes' },
      { label: 'Heading text', placeholder: 'Optional' }
    ], ([name, text]) => {
      if (!forumMarkValue('anchor', name)) return 'Use letters, numbers, hyphens, or underscores.';
      changeForumMark(view, 'anchor', { value: name }, text || (!current && view.state.selection.empty && name), true);
    }, { remove: current && (() => changeForumMark(view, 'anchor', null, '', true)) });
  });
  button(insertTools, 'horizontal_rule', 'Divider', 'Horizontal rule', () => {
    insertForumBlock(view, nodes.horizontal_rule.create());
    closePanel();
  });
  panelButton(insertTools, 'bg', 'Background', 'Background', trigger => {
    const current = forumBlock(view.state, 'bg');
    const parts = current?.node.attrs.label.split(',') ?? [];
    const oldColor = parts.find(part => forumMarkValue('color', part) && !alignments.some(([value]) => value === part));
    const defaultColor = doc.documentElement.dataset.epForumTheme === 'dark' ? '#253a57' : '#dbe8fa';
    configure(trigger, [
      { label: 'Background color', value: oldColor || defaultColor, swatch: true },
      { label: 'Width', value: parts.find(part => /^\d/.test(part)), placeholder: 'Optional, e.g. 75%' },
      { label: 'Background alignment', value: parts.find(part => alignments.some(([value]) => value === part)),
        choices: [['', 'Default'], ...alignments] }
    ], ([value, width, alignment]) => {
      if (!forumMarkValue('color', value)) return 'Enter a color name or a hex color.';
      if (width && !/^\d{1,3}(?:%|px)$/.test(width)) return 'Enter a width such as 75% or 400px.';
      changeForumBlock(view, 'bg', [value, width, alignment].filter(Boolean).join(','));
    }, { remove: current && (() => changeForumBlock(view, 'bg', null)) });
  });

  let smileys = [];
  let offset = 0, total = 0, loading = false;
  const smileyPanel = element('div', '', 'epc-forum-smiley-panel');
  const smileyGrid = element('div', '', 'epc-forum-smiley-grid');
  const smileyStatus = element('span', '', 'epc-forum-tool-status');
  smileyStatus.setAttribute('role', 'status');
  const more = button(smileyPanel, 'more-smilies', 'Load more', 'Load more smilies', requestSmilies);
  more.hidden = true;
  smileyPanel.prepend(smileyGrid);
  smileyPanel.append(smileyStatus);
  const picker = panelButton(insertTools, 'smilies', 'Smilies', 'Smilies', trigger => {
    if (showPanel(trigger, smileyPanel)) {
      if (!smileys.length) requestSmilies();
      else smileyGrid.firstElementChild?.focus();
    }
  });
  async function requestSmilies() {
    if (loading) return;
    loading = more.disabled = true;
    smileyStatus.textContent = 'Loading smilies…';
    try {
      const batch = await loadForumSmilies(page, offset, controller.signal, win);
      if (controller.signal.aborted) return;
      for (const item of batch.items) {
        const control = button(smileyGrid, 'smiley', '', item.code, () => {
          const { schema, tr } = view.state;
          const gap = schema.text(' ');
          const fragment = Fragment.fromArray([gap, nodes.smiley.create(item), gap]);
          view.dispatch(tr.replaceSelection(new Slice(fragment, 0, 0)));
          closePanel();
        });
        const image = element('img');
        image.src = item.href;
        image.alt = '';
        image.loading = 'lazy';
        control.append(image);
      }
      smileys = smileys.concat(batch.items);
      total = batch.max;
      const advanced = batch.next > offset;
      offset = batch.next;
      more.textContent = 'Load more';
      more.setAttribute('aria-label', 'Load more smilies');
      more.hidden = offset >= total || !advanced;
      smileyStatus.textContent = smileys.length ? '' : 'No smilies available.';
      if (activePanel === picker && doc.activeElement === picker) smileyGrid.firstElementChild?.focus();
    } catch {
      if (!controller.signal.aborted) {
        smileyStatus.textContent = 'Smilies could not load.';
        more.textContent = 'Retry';
        more.setAttribute('aria-label', 'Retry loading smilies');
        more.hidden = false;
      }
    } finally {
      loading = false;
      more.disabled = disabled;
    }
  }
  const labels = dropdown(insertTools, 'Post labels', Object.entries(forumSiteLabels), tag => {
    if (Object.hasOwn(forumSiteLabels, tag)) view.dispatch(view.state.tr.replaceSelectionWith(nodes.site_label.create({ tag })));
  });
  const help = element('a', 'Help');
  help.setAttribute('aria-label', 'BBCode help');
  help.href = '/articles/view/bbcode';
  help.target = '_blank';
  help.rel = 'noopener noreferrer';
  textTools.append(help);

  for (const [label, command] of [
    ['Add row', addRowAfter], ['Add column', addColumnAfter], ['Header row', toggleHeaderRow],
    ['Remove row', deleteRow], ['Remove column', deleteColumn], ['Remove table', deleteTable]
  ]) button(tableTools, 'table-action', label, label, () => run(command));

  function sync(setDisabled = disabled) {
    disabled = setDisabled;
    const { state } = view;
    for (const control of toolbar.querySelectorAll('button, select')) control.disabled = disabled;
    for (const control of panel.querySelectorAll('button, select, input')) control.disabled = disabled;
    more.disabled = disabled || loading;
    undoButton.disabled ||= !undo(state);
    redoButton.disabled ||= !redo(state);
    letterCase.disabled ||= state.selection.empty;
    font.value = forumActiveMark(state, marks.font)?.attrs.value || '';
    if (font.selectedIndex < 0) font.value = '';
    size.value = forumActiveMark(state, marks.size)?.attrs.value || '';
    align.value = forumBlock(state, 'align')?.node.attrs.label || '';
    letterCase.value = labels.value = '';
    color.dataset.active = String(Boolean(forumActiveMark(state, marks.color)));
    for (const [control, name] of buttonStates) {
      const active = marks[name] ? forumActiveMark(state, marks[name]) : forumBlock(state, name);
      control.setAttribute('aria-pressed', String(Boolean(active)));
    }
    tableTools.hidden = !isInTable(state);
  }
  sync();
  return { sync, destroy: () => controller.abort() };
}
