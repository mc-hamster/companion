// SPDX-License-Identifier: GPL-3.0-or-later
const forumMarks = new Map([['b', 'strong'], ['i', 'em'], ['u', 'underline'], ['s', 'strike'], ['url', 'link'], ['plain', 'literal']]);
const forumMarkTags = new Map([...forumMarks].map(([tag, type]) => [type, tag]));
const forumBlockTags = new Set(['quote', 'spoiler', 'code', 'codeblock']);
const forumTagPattern = /\[(\/?)([a-z][\w-]*|[*#])(?:=([^\]\r\n]*))?\]/gi;
const forumDocLimit = 100_000;

export function safeForumLink(value) {
  if (typeof value !== 'string' || /[\s[\]]/.test(value) || !/^https?:\/\//i.test(value)) return null;
  return URL.canParse(value) ? value : null;
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
    if (!forumMarks.has(tag) && !forumBlockTags.has(tag) && tag !== '*' && tag !== 'br') return null;
    const node = { tag, attribute, children: [] };
    parent.children.push(node);
    if (tag === '*' || tag === 'br') {
      if (attribute !== undefined) return null;
    } else if (tag === 'plain' || tag === 'code' || tag === 'codeblock') {
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
    if (tag === 'br') {
      content.push({ type: 'hard_break', marks });
      continue;
    }
    const type = forumMarks.get(tag);
    const href = tag === 'url' ? safeForumLink(attribute) : null;
    if (!type || marks.some(mark => mark.type === type) || (tag === 'url' ? !href : attribute !== undefined)) return null;
    const nested = forumInline(children, [...marks, href ? { type, attrs: { href } } : { type }]);
    if (!nested) return null;
    content.push(...nested);
  }
  return content;
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
      } else {
        const children = forumBlocks(first.children);
        if (!children) return null;
        content.push({ type: first.tag, attrs: { label: value }, content: children });
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
    while (shared < active.length && shared < marks.length &&
      active[shared].type === marks[shared].type && active[shared].attrs?.href === marks[shared].attrs?.href) shared++;
    for (const mark of active.slice(shared).reverse()) code += '[/' + forumMarkTags.get(mark.type) + ']';
    for (const mark of marks.slice(shared)) {
      code += '[' + forumMarkTags.get(mark.type) + (mark.type === 'link' ? '=' + mark.attrs.href : '') + ']';
    }
    const literal = marks.some(mark => mark.type === 'literal');
    if (item.type === 'hard_break') code += '[br]';
    else code += literal ? item.text : forumLiteralText(item.text);
    active = marks;
  }
  for (const mark of active.slice().reverse()) code += '[/' + forumMarkTags.get(mark.type) + ']';
  return code;
}

export function writeForumBBCode({ type, attrs = {}, content = [] }) {
  switch (type) {
    case 'doc':
      return content.map(writeForumBBCode).join('\n');
    case 'paragraph':
      return encodeForumInline(content);
    case 'bullet_list':
      return content.map(item => '[*]' + writeForumBBCode(item.content[0])).join('\n');
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
      return '[' + type + (attrs.label ? '=' + attrs.label : '') + ']' +
        content.map(writeForumBBCode).join('\n') + '[/' + type + ']';
    default:
      throw new Error('Formatting is unavailable in Visual mode.');
  }
}
