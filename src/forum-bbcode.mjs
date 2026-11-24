// SPDX-License-Identifier: GPL-3.0-or-later
const forumMarks = new Map([
  ['b', 'strong'], ['i', 'em'], ['u', 'underline'], ['s', 'strike'], ['sup', 'sup'], ['sub', 'sub'],
  ['font', 'font'], ['size', 'size'], ['color', 'color'], ['anchor', 'anchor'], ['url', 'link'], ['plain', 'literal']
]);
const forumMarkTags = new Map([...forumMarks].map(([tag, type]) => [type, tag]));
forumMarks.set('colour', 'color');
forumMarks.set('#', 'anchor');
const forumBlockTags = new Set(['quote', 'spoiler', 'code', 'codeblock', 'align', 'center', 'bg', 'table', 'hr']);
const forumTableTags = new Set(['tr', 'td', 'th']);
export const forumSiteLabels = { cast: 'Cast', details: 'Details', info: 'Info', plot: 'Plot', screens: 'Screens' };
const forumShortTags = new Set(['*', 'br', 'hr', 'video', ...Object.keys(forumSiteLabels)]);
const forumTagPattern = /\[(\/?)([a-z][\w-]*|[*#])(?:=([^\]\r\n]*))?\]/gi;
const forumDocLimit = 100_000;

export function safeForumLink(value) {
  if (typeof value !== 'string' || /[\s[\]<>"'\\]/.test(value)) return null;
  if (/^#[a-z\d_-]+$/i.test(value) || /^\/(?!\/)/.test(value)) return value;
  return safeForumMediaURL(value);
}

export function safeForumMediaURL(value) {
  if (typeof value !== 'string' || /[\s[\]<>"'\\]/.test(value) || !/^https?:\/\//i.test(value) || !URL.canParse(value)) return null;
  const { username, password } = new URL(value);
  return username || password ? null : value;
}

export function forumVideoProvider(value) {
  const url = safeForumMediaURL(value);
  if (!url) return null;
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  if (['youtube.com', 'youtube-nocookie.com', 'youtu.be', 'm.youtube.com'].includes(host)) return 'YouTube';
  if (host === 'vimeo.com') return 'Vimeo';
  return host === 'streamable.com' ? 'Streamable' : null;
}

const forumMarkValidators = {
  font: value => /^[\w -]{1,48}$/.test(value),
  size: value => /^(?:[0-9]|10)$/.test(value),
  color: value => /^(?:#(?:[a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})|[a-z][a-z0-9_-]{0,29})$/i.test(value),
  anchor: value => /^[a-z0-9_-]+$/i.test(value)
};

export function forumMarkValue(type, value) {
  return typeof value === 'string' && forumMarkValidators[type]?.(value) ? value : null;
}

export function forumAlignment(value) {
  return ['left', 'center', 'right', 'justify'].includes(value) ? value : null;
}

export function forumSizeStyle(value) {
  const size = forumMarkValue('size', value);
  return size === null ? '1em' : (.75 + Number(size) / 4) + 'em';
}

export function forumLayoutStyle(value) {
  const props = [];
  for (const part of value.split(',')) {
    if (/^(?:[0-9]{1,3}%?|[0-9]{1,4}px)$/.test(part)) {
      const px = part.endsWith('px');
      props.push('width:' + Math.min(parseInt(part, 10), px ? 920 : 100) + (px ? 'px' : '%'));
    } else if (forumAlignment(part)) {
      props.push('text-align:' + part);
      if (part !== 'right') props.push('margin-right:auto');
      if (part !== 'left') props.push('margin-left:auto');
    } else if (forumMarkValue('color', part)) {
      props.push('background-color:' + part);
    }
  }
  return props.join(';');
}

const forumTableFlags = {
  nball: 'border', nb: 'border', vat: 'vertical', vam: 'vertical', vab: 'vertical', nopad: 'padding'
};

export function forumTableLayout(label) {
  const values = {}, extra = [];
  for (const raw of label.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const token = part.toLowerCase();
    if (Object.hasOwn(forumTableFlags, token)) values[forumTableFlags[token]] = token;
    else if (/^\d{1,4}(?:px|%)?$/.test(token)) values.width = token;
    else if (forumAlignment(token)) values.alignment = token;
    else if (forumMarkValue('color', part)) values.color = part;
    else extra.push(part);
  }
  return { values, extra };
}

export function forumTableStyle(label, tag) {
  const { values } = forumTableLayout(label);
  const props = [];
  if (values.color) props.push('background-color:' + values.color, '--epc-forum-table-color:' + values.color);
  if (tag !== 'tr' && values.width) {
    const px = values.width.endsWith('px');
    props.push('width:' + Math.min(parseInt(values.width, 10), px ? 9999 : 100) + (px ? 'px' : '%'));
  }
  if (tag === 'table' && values.alignment) {
    props.push('margin-left:' + (values.alignment === 'left' ? '0' : 'auto'),
      'margin-right:' + (values.alignment === 'right' ? '0' : 'auto'));
  }
  if (values.border) props.push('--epc-forum-cell-border:transparent');
  if (values.padding === 'nopad') props.push('--epc-forum-cell-padding:0');
  if (values.vertical) props.push('--epc-forum-cell-align:' + ({ vat: 'top', vam: 'middle', vab: 'bottom' })[values.vertical]);
  return props.join(';');
}

export function forumQuoteSource(thread, post) {
  return '/forum/thread/' + thread + '?postid=' + post + '#post' + post;
}

export function forumQuoteCredit(credit) {
  const match = /^([^,]+),f([1-9]\d{0,14}),([1-9]\d{0,14})$/.exec(credit);
  return match ? { author: match[1], href: forumQuoteSource(match[2], match[3]) } : { author: credit };
}

export function forumLiteralText(value) {
  return value.replace(forumTagPattern, tag => {
    if (tag.toLowerCase() === '[/plain]') return '[plain]' + tag.slice(0, -1) + '[/plain]]';
    return '[plain]' + tag + '[/plain]';
  });
}

export function formatForumQuote(author, thread, post, body) {
  const attribution = author.replace(/[\][,\r\n]/g, '').trim();
  return '[quote=' + attribution + ',f' + thread + ',' + post + ']' + body + '[/quote]';
}

function tokenizeForumBBCode(source) {
  const root = { children: [] };
  const stack = [root];
  const pattern = new RegExp(forumTagPattern);
  let offset = 0;
  for (let match; (match = pattern.exec(source));) {
    const [, closing, tag, attribute] = match;
    const parent = stack.at(-1);
    if (offset < match.index) parent.children.push(source.slice(offset, match.index));
    offset = pattern.lastIndex;
    if (closing) {
      if (attribute !== undefined || parent.tag !== tag) return null;
      stack.pop();
      continue;
    }
    if (!forumMarks.has(tag) && !forumBlockTags.has(tag) && !forumShortTags.has(tag) && !forumTableTags.has(tag) && tag !== 'img') return null;
    const node = { tag, attribute, children: [] };
    parent.children.push(node);
    if (forumShortTags.has(tag)) {
      if (tag === 'video' ? !forumVideoProvider(attribute) : attribute !== undefined) return null;
    } else if (tag === 'plain' || tag === 'code' || tag === 'codeblock' || tag === 'img') {
      const closer = '[/' + tag + ']';
      const end = source.indexOf(closer, offset);
      if (end < 0 || (tag === 'plain' && attribute !== undefined)) return null;
      node.children.push(source.slice(offset, end));
      pattern.lastIndex = offset = end + closer.length;
    } else {
      if (stack.length > 32) return null;
      stack.push(node);
    }
  }
  if (stack.length !== 1) return null;
  if (offset < source.length) root.children.push(source.slice(offset));
  return root.children;
}

function forumInline(tokens, marks = []) {
  const content = [];
  for (const token of tokens) {
    if (typeof token === 'string') {
      if (token) content.push({ type: 'text', text: token, marks });
      continue;
    }
    const { tag, attribute, children } = token;
    if (tag === 'br' || Object.hasOwn(forumSiteLabels, tag)) {
      content.push(tag === 'br' ? { type: 'hard_break', marks } : { type: 'site_label', attrs: { tag }, marks });
      continue;
    }
    if (tag === 'img' || tag === 'url' && attribute === undefined) {
      const [href] = children;
      const uri = tag === 'img' ? safeForumMediaURL(href) : safeForumLink(href);
      if (!uri || children.length !== 1 || (tag === 'img' && attribute !== undefined &&
        !/^\d{0,4}(?:,\d{0,4})?$/.test(attribute))) return null;
      content.push(tag === 'img'
        ? { type: 'image', attrs: { href: uri, resize: attribute ?? '' }, marks }
        : { type: 'url_text', attrs: { href: uri }, marks });
      continue;
    }
    if (tag === 'video') {
      content.push({ type: 'video', attrs: { href: attribute }, marks });
      continue;
    }
    const type = forumMarks.get(tag);
    if (!type || marks.some(mark => mark.type === type)) return null;
    const mark = { type };
    if (tag === 'url') {
      const href = safeForumLink(attribute);
      if (!href) return null;
      mark.attrs = { href };
    } else if (Object.hasOwn(forumMarkValidators, type)) {
      const value = forumMarkValue(type, attribute);
      if (value === null) return null;
      mark.attrs = { value, tag };
    } else if (attribute !== undefined) return null;
    const nested = forumInline(children, [...marks, mark]);
    if (!nested?.length) return null;
    content.push(...nested);
  }
  return content;
}

function forumTableChildren(tokens, allowed) {
  let gap = '';
  const items = [];
  for (const token of tokens) {
    if (typeof token === 'string') {
      if (token.trim()) return null;
      gap += token;
    } else {
      if (!allowed.includes(token.tag)) return null;
      items.push({ token, gap });
      gap = '';
    }
  }
  return items.length ? { items, tail: gap } : null;
}

function forumTable(token) {
  const rows = forumTableChildren(token.children, ['tr']);
  if (!rows) return null;
  const content = [];
  for (const row of rows.items) {
    const cells = forumTableChildren(row.token.children, ['td', 'th']);
    if (!cells || (content.length && cells.items.length !== content[0].content.length)) return null;
    const rowContent = [];
    for (const cell of cells.items) {
      const blocks = forumBlocks(cell.token.children);
      if (!blocks) return null;
      rowContent.push({ type: cell.token.tag === 'th' ? 'table_header' : 'table_cell',
        attrs: { label: cell.token.attribute ?? '', gap: cell.gap }, content: blocks });
    }
    content.push({
      type: 'table_row', attrs: { label: row.token.attribute ?? '', gap: row.gap, tail: cells.tail }, content: rowContent
    });
  }
  return { type: 'table', attrs: { label: token.attribute ?? '', tail: rows.tail }, content };
}

function forumBlocks(tokens) {
  const lines = [[]];
  for (const token of tokens) {
    if (typeof token !== 'string') {
      lines.at(-1).push(token);
      continue;
    }
    const [first, ...rest] = token.split('\n');
    if (first) lines.at(-1).push(first);
    for (const value of rest) lines.push(value ? [value] : []);
  }

  const content = [];
  for (const line of lines) {
    const [first] = line;
    if (first && typeof first !== 'string' && forumBlockTags.has(first.tag)) {
      if (line.length !== 1) return null;
      const value = first.attribute ?? '';
      if (first.tag === 'code' || first.tag === 'codeblock') {
        const [code] = first.children;
        content.push({ type: 'code_block', attrs: { language: value, variant: first.tag }, content: code ? [{ type: 'text', text: code }] : [] });
      } else if (first.tag === 'hr') {
        content.push({ type: 'horizontal_rule' });
      } else if (first.tag === 'table') {
        const table = forumTable(first);
        if (!table) return null;
        content.push(table);
      } else {
        if ((first.tag === 'align' && !forumAlignment(value)) || (first.tag === 'center' && first.attribute !== undefined)) return null;
        const children = forumBlocks(first.children);
        if (!children) return null;
        const block = first.tag === 'center' ? { type: 'align', attrs: { label: 'center', tag: 'center' } }
          : { type: first.tag, attrs: { label: value } };
        content.push({ ...block, content: children });
      }
      continue;
    }
    const bullet = first?.tag === '*';
    const inline = forumInline(bullet ? line.slice(1) : line);
    if (!inline) return null;
    const paragraph = { type: 'paragraph', content: inline };
    if (!bullet) {
      content.push(paragraph);
      continue;
    }
    if (content.at(-1)?.type !== 'bullet_list') content.push({ type: 'bullet_list', content: [] });
    content.at(-1).content.push({ type: 'list_item', content: [paragraph] });
  }
  return content;
}

export function parseForumBBCode(source) {
  if (source.length > forumDocLimit) return null;
  const tokens = tokenizeForumBBCode(source);
  const content = tokens && forumBlocks(tokens);
  return content ? { type: 'doc', content } : null;
}

function encodeForumInline(content = []) {
  let code = '';
  let active = [];
  for (const item of content) {
    const marks = item.marks ?? [];
    let shared = 0;
    while (shared < active.length && shared < marks.length && sameForumMark(active[shared], marks[shared])) shared++;
    for (const mark of active.slice(shared).reverse()) code += '[/' + forumTagForMark(mark) + ']';
    for (const mark of marks.slice(shared)) {
      code += '[' + forumTagForMark(mark) + forumTagAttribute(mark.attrs?.href ?? mark.attrs?.value) + ']';
    }
    const literal = marks.some(mark => mark.type === 'literal');
    code += item.type === 'text'
      ? (literal ? item.text.replace(/\[\/plain\]/gi, tag => tag.slice(0, -1) + '[/plain]][plain]') : forumLiteralText(item.text))
      : writeForumInlineAtom(item);
    active = marks;
  }
  for (const mark of active.slice().reverse()) code += '[/' + forumTagForMark(mark) + ']';
  return code;
}

function sameForumMark(a, b) {
  return a.type === b.type && a.attrs?.href === b.attrs?.href && a.attrs?.value === b.attrs?.value &&
    forumTagForMark(a) === forumTagForMark(b);
}

function forumTagForMark(mark) {
  return mark.attrs?.tag || forumMarkTags.get(mark.type);
}

function forumTagAttribute(value) {
  return value ? '=' + value : '';
}

function writeForumInlineAtom({ type, attrs = {} }) {
  switch (type) {
    case 'hard_break': return '[br]';
    case 'image': return '[img' + forumTagAttribute(attrs.resize) + ']' + attrs.href + '[/img]';
    case 'url_text': return '[url]' + attrs.href + '[/url]';
    case 'video': return '[video=' + attrs.href + ']';
    case 'site_label': return '[' + attrs.tag + ']';
    case 'smiley': return attrs.code;
    default: throw new Error('Unsupported Visual editor content.');
  }
}

export function writeForumBBCode({ type, attrs = {}, content = [] }) {
  switch (type) {
    case 'doc':
      return content.map(writeForumBBCode).join('\n');
    case 'paragraph':
      return encodeForumInline(content);
    case 'bullet_list':
      return content.map(item => '[*]' + writeForumBBCode(item.content[0])).join('\n');
    case 'horizontal_rule':
      return '[hr]';
    case 'table':
    case 'table_row':
    case 'table_cell':
    case 'table_header': {
      const tag = { table: 'table', table_row: 'tr', table_cell: 'td', table_header: 'th' }[type];
      const separator = type === 'table_cell' || type === 'table_header' ? '\n' : '';
      return (attrs.gap || '') + '[' + tag + forumTagAttribute(attrs.label) + ']' +
        content.map(writeForumBBCode).join(separator) + (attrs.tail || '') + '[/' + tag + ']';
    }
    case 'code_block': {
      const text = content.map(item => item.text).join('');
      const variant = attrs.variant || 'code';
      const alternate = variant === 'code' ? 'codeblock' : 'code';
      const tag = text.toLowerCase().includes('[/' + variant + ']') ? alternate : variant;
      if (text.toLowerCase().includes('[/' + tag + ']')) return forumLiteralText(text);
      return '[' + tag + (attrs.language ? '=' + attrs.language : '') + ']' + text + '[/' + tag + ']';
    }
    case 'quote':
    case 'spoiler':
    case 'align':
    case 'bg': {
      const tag = attrs.tag || type;
      const label = tag === 'center' ? '' : attrs.label;
      return '[' + tag + forumTagAttribute(label) + ']' + content.map(writeForumBBCode).join('\n') + '[/' + tag + ']';
    }
    default:
      throw new Error('Formatting is unavailable in Visual mode.');
  }
}
