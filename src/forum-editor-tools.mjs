// SPDX-License-Identifier: GPL-3.0-or-later
import { Fragment, Slice } from 'prosemirror-model';
import { Selection, TextSelection } from 'prosemirror-state';
import { lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { liftListItem, wrapInList } from 'prosemirror-schema-list';
import { addColumnAfter, addRowAfter, deleteColumn, deleteRow, deleteTable, isInTable, selectedRect, toggleHeaderRow } from 'prosemirror-tables';
import { forumMarkValue, forumSiteLabels, forumTableLayout, forumVideoProvider, safeForumLink, safeForumMediaURL } from './forum-bbcode.mjs';

const alignments = [['left', 'Align left'], ['center', 'Center'], ['right', 'Align right'], ['justify', 'Justify']];
const defaultFonts = ['Arial', 'Courier New', 'Georgia', 'Helvetica', 'Tahoma', 'Times New Roman', 'Verdana'];
const smiliePageSize = 36;
const smilieCacheAge = 24 * 60 * 60 * 1000;
const validSmilie = item => typeof item?.code === 'string' && /^[^\[\]\r\n]{1,64}$/.test(item.code) && safeForumMediaURL(item.href);
const colorPresets = [
  ['Black', '#151922'], ['Slate', '#475569'], ['Gray', '#788393'], ['Silver', '#b9c3cf'], ['White', '#ffffff'],
  ['Navy', '#233f73'], ['Blue', '#2864c9'], ['Sky', '#6bbaf0'], ['Teal', '#13847e'], ['Mint', '#8ed8b7'],
  ['Forest', '#236445'], ['Green', '#51852b'], ['Amber', '#d29a20'], ['Orange', '#d8662b'], ['Red', '#bb3445'],
  ['Rose', '#e4839e'], ['Purple', '#7350b4'], ['Lavender', '#beadef']
];
const recentColorsKey = 'ep.forum.recentColors';

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
  const cacheKey = from % smiliePageSize === 0 && from < smiliePageSize * 24 ? 'ep.forum.smilies.v1.' + from : null;
  if (cacheKey) {
    try {
      const cached = JSON.parse(win.localStorage.getItem(cacheKey));
      const age = win.Date.now() - cached?.savedAt;
      if (age >= 0 && age < smilieCacheAge && Number.isInteger(cached.next) &&
          cached.next > from && cached.next <= from + smiliePageSize && Number.isInteger(cached.max) && cached.max >= 0 &&
          Array.isArray(cached.items) && cached.items.length && cached.items.length <= cached.next - from &&
          cached.items.every(validSmilie)) return cached;
    } catch {}
  }
  const url = new URL('/ajax.php', page);
  url.search = new URLSearchParams({ action: 'get_smilies', indexfrom: from, indexto: from + smiliePageSize });
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
    if (!uri || !URL.canParse(uri, page)) continue;
    const item = { code, href: new URL(uri, page).href };
    if (validSmilie(item)) items.push(item);
  }
  const batch = { items, next: from + records.length, max: Number(xml.querySelector('maxsmilies')?.textContent) || 0 };
  if (cacheKey && !signal.aborted && items.length && records.length <= smiliePageSize) {
    try { win.localStorage.setItem(cacheKey, JSON.stringify({ ...batch, savedAt: win.Date.now() })); } catch {}
  }
  return batch;
}

export function mountForumToolbar(root, view, commands, { fonts = defaultFonts, page = root.ownerDocument.baseURI, openImages, mediaId, optionsId = 'epc-forum-editor-options' } = {}) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const controller = new win.AbortController();
  const { nodes, marks } = view.state.schema;
  const buttonStates = [];
  const colorProbe = doc.createElement('span').style;
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
  panel.id = optionsId;
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

  function validColor(value) {
    if (!forumMarkValue('color', value)) return false;
    colorProbe.color = '';
    colorProbe.color = value;
    return !!colorProbe.color;
  }

  function recentColors() {
    try {
      const values = JSON.parse(win.localStorage.getItem(recentColorsKey));
      if (Array.isArray(values)) return values.filter(validColor).slice(0, 6);
    } catch {}
    return [];
  }

  function colorField(field, input) {
    const fieldset = element('fieldset', '', 'epc-forum-color-field');
    const presetGrid = element('div', '', 'epc-forum-color-grid');
    presetGrid.setAttribute('role', 'group');
    presetGrid.setAttribute('aria-label', 'Color presets');
    const recent = recentColors();
    const swatches = [];
    const picker = element('input');
    picker.type = 'color';
    picker.setAttribute('aria-label', 'Custom color');
    const sample = element('span', 'Aa', 'epc-forum-color-sample');
    sample.setAttribute('aria-hidden', 'true');
    let mixed = field.placeholder === 'Mixed';
    const pick = value => {
      input.value = value;
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
    };
    const addSwatch = (parent, [name, value]) => {
      const swatch = button(parent, 'color-swatch', '', name, () => pick(value));
      swatch.style.setProperty('--epc-forum-swatch', value);
      swatches.push([swatch, value]);
    };
    for (const choice of colorPresets) addSwatch(presetGrid, choice);
    if (!field.required) {
      const reset = button(presetGrid, 'color-default', 'Default', 'Use default color', () => pick(''));
      swatches.push([reset, '']);
    }
    fieldset.append(element('legend', field.label), presetGrid);
    if (recent.length) {
      const row = element('div', '', 'epc-forum-color-recents');
      const grid = element('div', '', 'epc-forum-color-grid');
      grid.setAttribute('role', 'group');
      grid.setAttribute('aria-label', 'Recent colors');
      for (const value of recent) addSwatch(grid, ['Recent ' + value, value]);
      row.append(element('span', 'Recent'), grid);
      fieldset.append(row);
    }
    const entry = element('div', '', 'epc-forum-color-entry');
    const custom = element('label', '', 'epc-forum-custom-color');
    const hex = element('label', '', 'epc-forum-hex-color');
    custom.append(picker, element('span', 'Custom'));
    hex.append(element('span', 'Hex or color name'), input);
    entry.append(custom, hex, sample);
    fieldset.append(entry);

    const refresh = () => {
      const value = input.value.trim();
      const valid = validColor(value);
      sample.style[field.swatch === 'background' ? 'backgroundColor' : 'color'] = valid ? value : '';
      for (const [swatch, preset] of swatches) {
        swatch.setAttribute('aria-pressed', String(!mixed && preset.toLowerCase() === value.toLowerCase()));
      }
      if (/^#[a-f0-9]{6}$/i.test(value)) picker.value = value;
      else if (/^#[a-f0-9]{3}$/i.test(value)) picker.value = '#' + [...value.slice(1)].map(c => c + c).join('');
    };
    picker.value = '#2864c9';
    picker.addEventListener('input', () => pick(picker.value));
    picker.addEventListener('change', () => pick(picker.value));
    input.addEventListener('input', () => {
      if (mixed) input.placeholder = 'Default';
      mixed = false;
      refresh();
    });
    refresh();
    const selected = input.value && swatches.find(([swatch]) => swatch.getAttribute('aria-pressed') === 'true');
    return { fieldset, focus: selected?.[0] || swatches[0][0] };
  }

  function configure(trigger, fields, action, { label = 'Apply', remove } = {}) {
    const content = element('div', '', 'epc-forum-tool-fields');
    const status = element('span', '', 'epc-forum-tool-status');
    status.setAttribute('role', 'status');
    const inputs = [];
    const changed = new Set();
    let firstFocus;
    for (const [index, field] of fields.entries()) {
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
      const markChanged = () => { changed.add(index); status.textContent = ''; };
      input.addEventListener('input', markChanged);
      input.addEventListener('change', markChanged);
      if (field.swatch) {
        const { fieldset, focus } = colorField(field, input);
        firstFocus ||= focus;
        content.append(fieldset);
      } else {
        row.append(element('span', field.label), input);
        firstFocus ||= input;
        content.append(row);
      }
      inputs.push(input);
    }
    const submit = () => {
      if (disabled) return;
      const values = inputs.map(input => input.value.trim());
      const error = action(values, changed);
      if (error) status.textContent = error;
      else {
        const colors = values.filter((value, index) => changed.has(index) && fields[index].swatch && validColor(value));
        if (colors.length) {
          const recent = [...new Set([...colors, ...recentColors()].map(value => value.toLowerCase()))].slice(0, 6);
          try { win.localStorage.setItem(recentColorsKey, JSON.stringify(recent)); } catch {}
        }
        closePanel();
      }
    };
    const controls = element('div', '', 'epc-forum-tool-actions');
    button(controls, 'apply-tool', label, label, submit);
    if (remove) button(controls, 'remove-tool', 'Remove', 'Remove formatting', () => { remove(); closePanel(); });
    button(controls, 'cancel-tool', 'Cancel', 'Cancel', () => closePanel());
    content.append(controls, status);
    if (showPanel(trigger, content)) {
      panelSubmit = submit;
      firstFocus?.focus();
    }
  }

  function panelButton(parent, name, title, label, open) {
    const control = button(parent, name, title, label, () => open(control));
    control.setAttribute('aria-controls', optionsId);
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
    configure(trigger, [{ label: 'Text color', value: mark?.attrs.value, swatch: 'text', placeholder: 'Default' }], ([value]) => {
      if (value && !validColor(value)) return 'Enter a color name or a hex color.';
      changeForumMark(view, 'color', value ? { value } : null, '', true);
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
    openImages(current?.type === nodes.image ? current.attrs.href : null, images);
  });
  images.setAttribute('aria-controls', mediaId);
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
    const defaultColor = root.closest('[data-ep-forum-theme]')?.dataset.epForumTheme === 'dark' ? '#253a57' : '#dbe8fa';
    configure(trigger, [
      { label: 'Background color', value: oldColor || defaultColor, swatch: 'background', required: true },
      { label: 'Width', value: parts.find(part => /^\d/.test(part)), placeholder: 'Optional, e.g. 75%' },
      { label: 'Background alignment', value: parts.find(part => alignments.some(([value]) => value === part)),
        choices: [['', 'Default'], ...alignments] }
    ], ([value, width, alignment]) => {
      if (!validColor(value)) return 'Enter a color name or a hex color.';
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
    const moreFocused = doc.activeElement === more;
    const firstAdded = smileyGrid.children.length;
    loading = more.disabled = true;
    smileyPanel.setAttribute('aria-busy', 'true');
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
      if (activePanel === picker && (moreFocused || doc.activeElement === picker)) {
        smileyGrid.children[firstAdded]?.focus();
      }
    } catch {
      if (!controller.signal.aborted) {
        smileyStatus.textContent = 'Smilies could not load.';
        more.textContent = 'Retry';
        more.setAttribute('aria-label', 'Retry loading smilies');
        more.hidden = false;
      }
    } finally {
      loading = false;
      smileyPanel.setAttribute('aria-busy', 'false');
      more.disabled = disabled;
    }
  }
  const labels = dropdown(insertTools, 'Post labels', Object.entries(forumSiteLabels), tag => {
    if (Object.hasOwn(forumSiteLabels, tag)) view.dispatch(view.state.tr.replaceSelectionWith(nodes.site_label.create({ tag })));
  });

  function openTableOptions(trigger, scope) {
    const { state } = view;
    if (!isInTable(state)) return;
    const rect = selectedRect(state);
    const targets = [];
    if (scope === 'table') targets.push([rect.tableStart - 1, rect.table]);
    else if (scope === 'row') {
      rect.table.forEach((node, offset, index) => {
        if (index >= rect.top && index < rect.bottom) targets.push([rect.tableStart + offset, node]);
      });
    } else {
      for (const offset of rect.map.cellsInRect(rect)) targets.push([rect.tableStart + offset, rect.table.nodeAt(offset)]);
    }
    if (!targets.length) return;
    const optionsByTarget = targets.map(([, node]) => forumTableLayout(node.attrs.label));
    const title = { table: 'Table', row: 'Row', cell: 'Cell' }[scope];
    const fields = [{ key: 'color', label: title + ' background', swatch: 'background', placeholder: 'Default' }];
    if (scope !== 'row') {
      fields.push({ key: 'width', label: 'Width', placeholder: '80% or 420px' });
      if (scope === 'table') fields.push({ key: 'alignment', label: 'Table alignment', choices: [
        ['', 'Default'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right']
      ] });
      fields.push(
        { key: 'border', label: 'Borders', choices: [['', 'Default'], [scope === 'table' ? 'nball' : 'nb', 'Hidden']] },
        { key: 'vertical', label: 'Vertical alignment', choices: [['', 'Default'], ['vat', 'Top'], ['vam', 'Middle'], ['vab', 'Bottom']] }
      );
    }
    fields.push({ key: 'padding', label: 'Padding', choices: [['', 'Default'], ['nopad', 'None']] });
    for (const field of fields) {
      const values = new Set(optionsByTarget.map(option => option.values[field.key] || ''));
      if (values.size === 1) field.value = values.values().next().value;
      else if (field.choices) {
        field.choices = [['_mixed', 'Mixed'], ...field.choices];
        field.value = '_mixed';
      } else field.placeholder = 'Mixed';
    }
    configure(trigger, fields, (values, changed) => {
      const patch = {};
      for (const index of changed) {
        const { key } = fields[index];
        const value = values[index];
        if (value === '_mixed') continue;
        if (key === 'color' && value && !validColor(value)) return 'Enter a color name or a hex color.';
        if (key === 'width' && value && !/^(?:(?:[1-9]\d?|100)%|[1-9]\d{0,3}px)$/i.test(value)) {
          return 'Use a width like 80% or 420px.';
        }
        patch[key] = value;
      }
      if (!Object.keys(patch).length) return;
      if (view.state.doc !== state.doc) return 'The table changed. Reopen its options and try again.';
      const transaction = view.state.tr;
      for (const [index, [pos, node]] of targets.entries()) {
        const { extra, values: original } = optionsByTarget[index];
        const label = [...Object.values({ ...original, ...patch }).filter(Boolean), ...extra].join(',');
        if (label !== node.attrs.label) transaction.setNodeMarkup(pos, undefined, { ...node.attrs, label });
      }
      if (transaction.docChanged) view.dispatch(transaction);
    });
  }

  const tableOptions = element('div', '', 'epc-forum-table-actions');
  const tableStructure = element('div', '', 'epc-forum-table-actions');
  tableTools.append(tableOptions, tableStructure);
  for (const [scope, caption] of [['table', 'Table options'], ['row', 'Row options'], ['cell', 'Cell options']]) {
    panelButton(tableOptions, scope + '-options', caption, caption, trigger => openTableOptions(trigger, scope));
  }
  for (const [label, command] of [
    ['Add row', addRowAfter], ['Add column', addColumnAfter], ['Header row', toggleHeaderRow],
    ['Remove row', deleteRow], ['Remove column', deleteColumn], ['Remove table', deleteTable]
  ]) button(tableStructure, 'table-action', label, label, () => run(command));

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
