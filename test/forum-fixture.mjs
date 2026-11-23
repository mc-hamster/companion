// Neutral forum markup shaped like the Luminance templates.
import { escapeHTML } from '../src/core.mjs';
import { parseForumBBCode } from '../src/forum-bbcode.mjs';

const articleTitle = 'Photo uploads stall on large files';
const secondTitle = 'A simpler way to organize bug reports';
const longQuote = 'Uploads over 50 MB were stalling for me on a slower connection. I tried three browsers before narrowing it down to the upload itself.';
const neutralPosts = new Map([
  [11, { user: 'Mara', body: 'Please include your browser, file size, and approximate time when reporting an upload issue.' }],
  [12, { user: 'Riley', body: longQuote }],
  [13, { user: 'Jordan', body: 'The retry works for me when I leave the tab open.' }]
]);

function forumPostHTML(id, { user, body, unread = false, pinned = false, locked = false }) {
  return '<table class="forum_post box vertical_margin' + (unread ? ' forum_unread' : '') + '" id="post' + id + '">' +
    '<tr class="smallhead"><td colspan="2"><span style="float:left">' +
    '<a class="post_id" href="?postid=' + id + '#post' + id + '">#' + id + '</a> ' +
    '<span class="user_dropdown"><a href="/user.php?id=' + id + '">' + escapeHTML(user) + '</a></span> ' +
    '<span title="2026-11-22 10:00">2 hours ago</span>' +
    (locked ? '' : ' · <button type="button" id="quote' + id + '" title="quote this post">❝</button>') +
    (pinned ? ' <strong><span class="sticky_post">[Pinned]</span></strong>' : '') + '</span>' +
    '<span id="bar' + id + '" style="float:right"><a href="/reports.php?action=report&type=post&id=' + id + '">Report</a> · <a href="#">↑</a></span></td></tr>' +
    '<tr><td class="avatar"><img class="avatar" src="/forum-fixture-avatar.svg" alt="' + escapeHTML(user) + '’s avatar">' +
    '<div class="badges"><a href="/user.php?id=' + id + '">Site contributor</a></div></td>' +
    '<td class="postbody"><div id="content' + id + '" class="post_container"><div class="post_content">' + body +
    '</div></div></td></tr></table>';
}

function forumThreadHTML(url, posted) {
  const locked = url.searchParams.has('locked');
  const id = url.pathname.split('/').filter(Boolean).at(-1);
  const post = url.searchParams.get('postid');
  const posts = [
    forumPostHTML(11, { ...neutralPosts.get(11), pinned: true, locked }),
    forumPostHTML(12, { ...neutralPosts.get(12), locked }),
    forumPostHTML(13, { ...neutralPosts.get(13), locked, unread: true,
      body: '<span class="quote_label"><strong>Riley</strong> <a href="?postid=12#post12">Original post</a></span>' +
        '<blockquote class="bbcode"><blockquote class="bbcode">An earlier report about a slow connection.</blockquote>' +
        'Uploads over 50 MB were stalling for me on a slower connection.</blockquote>' + neutralPosts.get(13).body })
  ];
  if (post === '14' && posted) posts.push(forumPostHTML(14, { user: 'Tester', body: forumFixturePreview(posted), locked }));
  return '<h2><a href="/forum">Forum</a> &gt; <a href="/forum/23">Site Bugs</a> &gt; ' +
    (id === '43' ? secondTitle : articleTitle) + '</h2>' +
    '<div class="linkbox">[<a href="/reports.php?action=report&type=thread&id=' + id + '">Report Thread</a>] ' +
    '[<a href="#" onclick="return false">Subscribe</a>] [<a href="/forum/unread">Unread Posts</a>]</div>' +
    '<div class="linkbox pager"><a href="?page=1">First</a> | 1–100 | <a href="?page=2">101–130</a> | <a href="?page=2">Next ›</a></div>' +
    posts.join('') + '<div class="linkbox pager"><a href="?page=2">Next ›</a></div>' +
    (locked ? '<p>This thread is locked.</p>' :
      '<div class="head">Post reply</div><div class="box pad">' +
      '<form id="quickpostform" action="/forum/thread/' + id + '/reply" method="post">' +
      '<input type="hidden" name="token" value="fixture-token"><div id="quickreplytext">' +
      '<table><tr><td><button id="fixture-bold" type="button" onclick="this.form.body.value+=\'[b]text[/b]\'">Bold</button></td></tr></table>' +
      '<textarea id="quickpost" name="body" rows="8"></textarea></div>' +
      '<div><label><input type="checkbox" id="subscribebox" name="subscribe" value="1"> Subscribe</label> ' +
      '<label><input type="checkbox" name="merge" value="1"> Merge</label> <input type="button" id="post_preview" value="Preview">' +
      '<input type="submit" value="Post reply"></div></form></div>');
}

function forumListHTML(kind) {
  const heading = { boards: 'Forum', board: '<a href="/forum">Forum</a> &gt; Site Bugs', unread: 'Unread Posts',
    search: 'Search forums', subscriptions: 'Subscribed threads' }[kind];
  const main = kind === 'boards'
    ? '<div class="head">Site</div><table class="forum_index"><tr class="colhead"><td></td><td>Forum</td><td>Last post</td><td>Threads</td><td>Posts</td></tr>' +
      '<tr><td><span class="forum_icon_container" title="Forum Thread"><i class="forum_hint_unread">●</i></span></td>' +
      '<td><h4><a href="/forum/23" title="Report bugs">Site Bugs</a></h4></td><td><a href="/forum/thread/42">' + articleTitle +
      '</a></td><td class="align_center">120</td><td class="align_center">12,399</td></tr></table>'
    : '<table class="forum_list"><tr class="colhead"><td></td><td>Thread</td><td>Posts</td><td>Views</td><td>Latest</td></tr>' +
      '<tr class="sticky"><td><span class="forum_icon_container" title="Pinned Thread"><i class="forum_hint_unread">●</i></span></td>' +
      '<td><span class="last_thread"><strong><a href="/forum/thread/42" title="' + articleTitle + '">Photo uploads stall…</a></strong></span>' +
      '<span title="Jump to last read"><a href="/forum/thread/42?postid=12#post12"><i>↦</i></a></span>' +
      '<span class="first_poster">started by Riley</span></td><td class="align_center">130</td><td class="align_center">1,934</td>' +
      '<td><span class="last_poster">by Jordan · 2 hours ago</span><span title="Jump to last post">' +
      '<a href="/forum/thread/42?postid=13#post13"><i>↦</i></a></span></td></tr>' +
      '<tr><td><span class="forum_icon_container" title="Forum Thread">○</span></td>' +
      '<td><a href="/forum/thread/43">' + secondTitle + '</a></td><td class="align_center">7</td><td class="align_center">94</td>' +
      '<td>by Mara · yesterday</td></tr></table>';
  return '<h2>' + heading + '</h2><div class="linkbox">[<a href="/forum/catchup">Catch up</a>] ' +
    '[<a href="/forum/unread">Unread Posts</a>]</div>' + main;
}

export function forumFixtureHTML(url, { bundle = false, posted = '', account = 7 } = {}) {
  const scripts = bundle ? '<script>' +
    'window.GM_getValue=(key,fallback)=>JSON.parse(localStorage.getItem(key)??"null")??fallback;' +
    'window.GM_setValue=(key,value)=>localStorage.setItem(key,JSON.stringify(value));' +
    'window.GM_listValues=()=>Object.keys(localStorage);window.GM_deleteValue=key=>localStorage.removeItem(key);' +
    'window.GM_addStyle=css=>{const style=document.createElement("style");style.textContent=css;document.head.append(style)};' +
    '</script><script src="/EmporniumCompanion.js"></script>' : '';
  const kind = url.pathname.includes('unread') ? 'unread' : url.pathname === '/forum/search' ? 'search' :
    url.pathname.includes('userhistory') ? 'subscriptions' : /^\/forum\/\d+/.test(url.pathname) ? 'board' : 'boards';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="ep-companion-fixture" content="local-test-only"><title>Companion forum fixture</title><style>' +
    'body{min-width:960px;margin:0;background:#f0f3f8;color:#18243a;font:12px/1.35 system-ui,sans-serif}' +
    '#wrapper{width:960px;min-width:960px;margin:auto}#content{min-width:940px;margin:auto}' +
    '#header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;margin-block-end:10px;border-block-end:1px solid #dbe2ee}' +
    '#header nav{display:flex;gap:14px;align-items:center}a{color:#274f9d}button,input,textarea{font:inherit}h4{margin:0}' +
    '.head{font-weight:700;padding:7px 10px}.forum_post,table{width:100%;border-spacing:0}.forum_post{margin:7px 0;background:white}' +
    '.smallhead{background:#e4e9f2}.smallhead td,.postbody,td.avatar{padding:8px}.postbody,td.avatar{vertical-align:top}' +
    '.colhead{background:#e4e9f2}.forum_list td,.forum_index td{padding:6px}.avatar img{width:52px;height:52px}.hidden{display:none}' +
    '@media(prefers-color-scheme:dark){body{background:#151c28;color:#dce6f8}a{color:#b9cdff}}</style>' + scripts + '</head><body>' +
    '<div id="wrapper"><header id="header"><nav><strong>Empornium</strong><a href="/forum">Forum</a><a href="/forum/23">Site Bugs</a></nav>' +
    (account ? '<span id="userinfo_username"><a href="/user.php?id=' + account + '">Tester</a></span>' : '') + '</header>' +
    '<main id="content">' + (url.pathname.startsWith('/forum/thread/') ? forumThreadHTML(url, posted) : forumListHTML(kind)) + '</main></div>' +
    '</body></html>';
}

function forumFixturePreview(bbcode) {
  const tree = parseForumBBCode(bbcode);
  if (!tree) return '<pre>' + escapeHTML(bbcode) + '</pre>';
  function format(node) {
    if (node.type === 'text') {
      let value = escapeHTML(node.text);
      for (const { type } of node.marks ?? []) {
        const tag = { strong: 'strong', em: 'em', underline: 'u', strike: 's' }[type];
        if (tag) value = '<' + tag + '>' + value + '</' + tag + '>';
      }
      return value;
    }
    const children = node.content?.map(format).join('') || '';
    const tag = { paragraph: 'p', quote: 'blockquote', bullet_list: 'ul', list_item: 'li', code_block: 'pre' }[node.type];
    return tag ? '<' + tag + '>' + children + '</' + tag + '>' : children;
  }
  return format(tree);
}

export function createForumFixture() {
  let posted = '';
  return async (req, res, url) => {
    const path = url.pathname;
    if (path === '/forum-fixture-avatar.svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#234c92"/><circle cx="32" cy="27" r="11" fill="#c6d8f7"/><path d="M13 57a19 19 0 0 1 38 0" fill="#c6d8f7"/></svg>');
      return true;
    }
    const quote = /^\/forum\/post\/(\d+)\/get$/.exec(path);
    if (quote) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(neutralPosts.get(Number(quote[1]))?.body ?? ''));
      return true;
    }
    const isPreview = path === '/ajax.php' && url.searchParams.get('action') === 'preview';
    const isReply = /^\/forum\/thread\/\d+\/reply$/.test(path);
    if (req.method === 'POST' && (isPreview || isReply)) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const fields = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const body = fields.get('body') || '';
      if (isPreview) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(forumFixturePreview(body));
      } else if (fields.get('token') !== 'fixture-token' || !body.trim() || body.includes('reject this fixture reply')) {
        res.writeHead(422).end('Fixture rejected the reply');
      } else {
        posted = body;
        res.writeHead(303, { Location: path.replace(/\/reply$/, '') + '?postid=14#post14' }).end();
      }
      return true;
    }
    if (path === '/forum' || path.startsWith('/forum/') || (path === '/userhistory.php' && url.searchParams.get('action') === 'subscriptions')) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(forumFixtureHTML(url, { bundle: true, posted }));
      return true;
    }
    return false;
  };
}
