// Neutral forum markup shaped like the Luminance templates.
import { escapeHTML } from '../src/core.mjs';
import { forumTableLayout, forumTableStyle, parseForumBBCode } from '../src/forum-bbcode.mjs';

const articleTitle = 'Photo uploads stall on large files';
const secondTitle = 'A simpler way to organize bug reports';
const longQuote = 'Uploads over 50 MB were stalling for me on a slower connection. I tried three browsers before narrowing it down to the upload itself.';
const smilies = [':smile1:', ':wave:', ':thanks:',
  ...Array.from({ length: 35 }, (_, index) => ':demo-smilie-' + (index + 4) + ':')];
const smileyImage = code => '<img class="bbcode smiley" src="/forum-fixture-avatar.svg" alt="' + escapeHTML(code) + '" />';
const neutralPosts = new Map([
  [11, { user: 'Mara', body: 'Please include your browser, file size, and approximate time when reporting an upload issue.' }],
  [12, { user: 'Riley', body: longQuote }],
  [13, { user: 'Jordan', body: 'The retry works for me when I leave the tab open.' }]
]);

function forumPostHTML(id, { user, body, unread = false, pinned = false, locked = false }) {
  return '<table class="forum_post box vertical_margin' + (unread ? ' forum_unread' : '') + '" id="post' + id + '">' +
    forumPostRows(id, { user, body, pinned, locked }) + '</table>';
}

function forumPostRows(id, { user, body, pinned = false, locked = false }) {
  const editable = !locked && (id === 12 || id === 13);
  return '<tr class="smallhead"><td colspan="2"><span style="float:left">' +
    '<a class="post_id" href="?postid=' + id + '#post' + id + '">#' + id + '</a> ' +
    '<span class="user_name"><span class="user_dropdown"><a href="/user.php?id=' + id + '">' + escapeHTML(user) +
    '</a></span></span> ' +
    '<span title="2026-11-22 10:00">2 hours ago</span>' +
    (locked ? '' : ' · <button type="button" id="quote' + id + '" title="quote this post">❝</button>') +
    (editable ? ' <button type="button" id="edit' + id + '" onclick="fixtureEdit(' + id + ')">Edit post</button>' : '') +
    (pinned ? ' <strong><span class="sticky_post">[Pinned]</span></strong>' : '') + '</span>' +
    '<span id="bar' + id + '" style="float:right">' +
    (editable ? '<input type="button" id="edit_preview_' + id + '" class="hidden" value="Preview" onclick="fixtureEditPreview(' + id + ')">' +
      '<input type="button" id="edit_preview_cancel_' + id + '" class="hidden" value="Editor" onclick="fixtureEditBack(' + id + ')">' +
      '<input type="button" id="edit_save_' + id + '" class="hidden" value="Post" onclick="fixtureEditSave(' + id + ')">' +
      '<input type="button" id="edit_cancel_' + id + '" class="hidden" value="Cancel" onclick="fixtureEditCancel(' + id + ')">' : '') +
    '<a href="/reports.php?action=report&type=post&id=' + id + '" aria-label="Report post">' +
    '<i class="font_icon forum_icon icon_forum_report" aria-hidden="true">⚠</i></a> · <a href="#" aria-label="Jump to top">↑</a></span></td></tr>' +
    '<tr><td class="avatar"><img class="avatar" src="/forum-fixture-avatar.svg" alt="' + escapeHTML(user) + '’s avatar">' +
    '<div class="badges"><div class="badge"><a href="/user.php?id=' + id + '#userbadges">' +
    '<img src="/forum-fixture-avatar.svg" width="64" height="64" alt="Site contributor" title="Site contributor"></a></div>' +
    '<div class="badge"><img src="/forum-fixture-award.svg" width="128" height="48" alt="Helpful member" title="Helpful member"></div></div></td>' +
    '<td class="postbody"><div id="content' + id + '" class="post_container"><div class="post_content">' + body +
    '</div>' + (id === 13 ? '<div class="post_footer"><span class="editedby">Last edited by <a href="/user.php?id=13">Jordan</a> · just now</span></div>' : '') +
    '</div></td></tr>';
}

function forumThreadHTML(url, posted, { created, edits } = {}) {
  const locked = url.searchParams.has('locked');
  const id = url.pathname.split('/').filter(Boolean).at(-1);
  const post = url.searchParams.get('postid');
  const singlePage = url.searchParams.has('single-page');
  const topPager = singlePage ? '<div class="linkbox pager"></div>' :
    '<div class="linkbox pager"><a href="?page=1">First</a> | 1–100 | <a href="?page=2">101–130</a> | <a href="?page=2">Next ›</a></div>';
  const bottomPager = singlePage ? '<div class="linkbox pager"> \n </div>' :
    '<div class="linkbox pager"><a href="?page=2">Next ›</a></div>';
  const posts = [
    forumPostHTML(11, { ...neutralPosts.get(11), pinned: true, locked }),
    forumPostHTML(12, { ...neutralPosts.get(12), locked,
      body: edits?.has(12) ? forumFixturePreview(edits.get(12)) : neutralPosts.get(12).body }),
    forumPostHTML(13, { ...neutralPosts.get(13), locked, unread: true,
      body: edits?.has(13) ? forumFixturePreview(edits.get(13)) : '<br><br><span class="quote_label"><strong>Riley</strong> <a href="?postid=12#post12">Original post</a></span>' +
        '<blockquote class="bbcode"><blockquote class="bbcode">An earlier report about a slow connection.</blockquote>' +
        'Uploads over 50 MB were stalling for me on a slower connection.</blockquote><br><br>' + neutralPosts.get(13).body })
  ];
  if (id === '44' && created) posts.unshift(forumPostHTML(15, { user: 'Tester', body: forumFixturePreview(created.body), locked }));
  if (post === '14' && posted) posts.push(forumPostHTML(14, { user: 'Tester', body: forumFixturePreview(posted), locked }));
  return '<h2><a href="/forum">Forum</a> &gt; <a href="/forum/23">Site Bugs</a> &gt; ' +
    (id === '44' && created ? escapeHTML(created.title) : id === '43' ? secondTitle : articleTitle) + '</h2>' +
    '<div class="linkbox">[<a href="/reports.php?action=report&type=thread&id=' + id + '">Report Thread</a>] ' +
    '[<a href="#" onclick="return false">Subscribe</a>] [<a href="/forum/unread">Unread Posts</a>]</div>' +
    topPager + posts.join('') + bottomPager +
    (locked ? '<p>This thread is locked.</p>' :
      '<div class="head">Post reply</div><div class="box pad">' +
      '<form id="quickpostform" action="/forum/thread/' + id + '/reply" method="post" style="display: block; text-align: center;">' +
      '<input type="hidden" name="token" value="fixture-token"><div id="quickreplytext">' +
      '<table class="bb_holder"><tr><td><div class="bb_buttons_left">' +
      '<a id="fixture-bold" onclick="this.closest(\'form\').body.value+=\'[b]text[/b]\'">Bold</a>' +
      '<select name="fontfont" aria-label="Native font"><option value="-1">Font Type</option><option>Georgia</option><option>Verdana</option></select>' +
      '<a href="/articles/view/bbcode" target="_blank">Help</a></div></td></tr></table>' +
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
      '<td><h4><a href="/forum/23" title="Report bugs">Site Bugs</a></h4></td><td>' +
      '<span class="float_left last_thread"><a href="/forum/thread/42" title="' + articleTitle +
      ' while transferring many large files on a slower connection">Photo uploads stall…</a></span>' +
      '<span class="float_left" title="Jump to last read"><a href="/forum/thread/42?postid=12#post12"><i>↦</i></a></span>' +
      '<span class="float_right" class="last_poster">by <a href="/user.php?id=12">A very long fixture username</a> · 2 hours ago</span>' +
      '</td><td class="align_center">120</td><td class="align_center">12,399</td></tr></table>'
    : '<table class="forum_list"><tr class="colhead"><td></td><td>Thread</td><td style="width:5%">Posts</td><td style="width:5%">Views</td><td>Latest</td></tr>' +
      '<tr class="sticky"><td><span class="forum_icon_container" title="Pinned Thread"><i class="forum_hint_unread">●</i></span></td>' +
      '<td><span class="last_thread"><strong><a href="/forum/thread/42" title="' + articleTitle + '">Photo uploads stall…</a></strong></span>' +
      '<span title="Jump to last read"><a href="/forum/thread/42?postid=12#post12"><i>↦</i></a></span>' +
      '<span class="first_poster">started by Riley</span></td><td class="align_center">130</td><td class="align_center">1,934</td>' +
      '<td><span class="last_poster">by Jordan · 2 hours ago</span><span title="Jump to last post">' +
      '<a href="/forum/thread/42?postid=13#post13"><i>↦</i></a></span></td></tr>' +
      '<tr><td><span class="forum_icon_container" title="Forum Thread">○</span></td>' +
      '<td><a href="/forum/thread/43">' + secondTitle + '</a></td><td class="align_center">7</td><td class="align_center">94</td>' +
      '<td>by Mara · yesterday</td></tr></table>';
  return '<h2>' + heading + '</h2><div class="linkbox">' +
    (kind === 'board' ? '[<a href="/forum/23/new">New Thread</a>] ' : '') + '[<a href="/forum/catchup">Catch up</a>] ' +
    '[<a href="/forum/unread">Unread Posts</a>]</div>' + main;
}

function fixtureAuthoringControls() {
  const get = id => document.getElementById(id);
  const originals = new Map();
  const hide = (id, hidden) => get(id).classList.toggle('hidden', hidden);
  const preview = body => fetch('/ajax.php?action=preview', {
    method: 'POST', body: new URLSearchParams({ body })
  }).then(response => response.text());
  const editControls = (id, editing, previewing = false) => {
    hide('edit_preview_' + id, !editing || previewing);
    hide('edit_preview_cancel_' + id, !previewing);
    hide('edit_save_' + id, !editing);
    hide('edit_cancel_' + id, !editing);
  };
  window.fixturePreviewTopic = async showing => {
    const form = get('newthreadform');
    hide('newthreadtext', showing);
    hide('newthreadpreview', !showing);
    hide('newthreadpreviewbutton', showing);
    hide('newthreadeditbutton', !showing);
    hide('subscribediv', !showing);
    get('newthreadtitle').textContent = showing ? form.elements.title.value : 'New Topic';
    if (showing) get('contentpreview').innerHTML = await preview(form.elements.body.value);
  };
  window.fixtureEdit = async id => {
    const content = get('content' + id);
    originals.set(id, content.innerHTML);
    get('edit' + id).disabled = true;
    content.innerHTML = '<div id="preview' + id + '"></div><div id="editcont' + id + '"></div>';
    editControls(id, true);
    const response = await fetch('/forum/post/' + id + '/get');
    get('editcont' + id).innerHTML = await response.text();
  };
  window.fixtureEditPreview = async id => {
    get('preview' + id).innerHTML = await preview(get('editbox' + id).value);
    hide('editcont' + id, true);
    editControls(id, true, true);
  };
  window.fixtureEditBack = id => {
    get('preview' + id).replaceChildren();
    hide('editcont' + id, false);
    editControls(id, true);
  };
  window.fixtureEditCancel = id => {
    get('content' + id).innerHTML = originals.get(id);
    get('edit' + id).disabled = false;
    originals.delete(id);
    editControls(id, false);
  };
  window.fixtureEditSave = async id => {
    const response = await fetch('/forum/post/' + id + '/edit', {
      method: 'POST', body: new URLSearchParams({ body: get('editbox' + id).value, token: 'fixture-edit-token' })
    });
    const [status, html] = await response.json();
    if (status === 'saved') {
      get('post' + id).innerHTML = html;
      originals.delete(id);
    }
  };
}

function forumAuthoringBody(id, body = '') {
  return '<table class="bb_holder"><tr><td><select name="fontfont" aria-label="Native font">' +
    '<option value="-1">Font Type</option><option>Georgia</option></select></td></tr></table>' +
    '<textarea id="' + id + '" name="body" class="long" rows="8" cols="90">' + escapeHTML(body) + '</textarea>';
}

function forumNewTopicHTML(board) {
  return '<h2><a href="/forum">Forum</a> &gt; <a href="/forum/' + board + '">Site Bugs</a> &gt; New Topic</h2>' +
    '<div id="newthreadpreview" class="hidden"><div id="contentpreview"></div></div>' +
    '<div class="head"><span id="newthreadtitle">New Topic</span></div><div class="box pad">' +
    '<form id="newthreadform" method="post" action="/forum/' + board + '/new">' +
    '<input type="hidden" name="token" value="fixture-topic-token"><table id="newthreadtext">' +
    '<tr><td class="label">Title</td><td><input id="title" name="title" required></td></tr>' +
    '<tr><td class="label">Body</td><td>' + forumAuthoringBody('posttext') + '</td></tr>' +
    '<tr><td></td><td><label><input type="checkbox" name="subscribe" value="1" onchange="document.getElementById(\'subscribeboxpreview\').checked=this.checked"> Subscribe to topic</label></td></tr>' +
    '<tr><td>Poll</td><td><input name="poll_question" aria-label="Poll question"><input name="poll_answers[]" aria-label="First answer"></td></tr>' +
    '</table><div id="subscribediv" class="hidden"><label><input type="checkbox" id="subscribeboxpreview" name="subscribe" value="1"> Subscribe to topic</label></div>' +
    '<input type="button" id="newthreadpreviewbutton" value="Preview" onclick="fixturePreviewTopic(true)">' +
    '<input type="button" id="newthreadeditbutton" class="hidden" value="Editor" onclick="fixturePreviewTopic(false)">' +
    '<input type="submit" value="Create thread"></form></div>';
}

export const forumFixtureScripts = '<script>(' + fixtureAuthoringControls.toString() + ')();</script><script>' +
  'window.GM_getValue=(key,fallback)=>JSON.parse(localStorage.getItem(key)??"null")??fallback;' +
  'window.GM_setValue=(key,value)=>localStorage.setItem(key,JSON.stringify(value));' +
  'window.GM_listValues=()=>Object.keys(localStorage);window.GM_deleteValue=key=>localStorage.removeItem(key);' +
  'window.GM_addStyle=css=>{const style=document.createElement("style");style.textContent=css;document.head.append(style)};' +
  'window.GM_addValueChangeListener=(key,fn)=>{const listener=e=>{if(e.key===key)fn(key,e.oldValue,e.newValue,true)};' +
  'window.addEventListener("storage",listener);return listener};' +
  'window.GM_removeValueChangeListener=fn=>window.removeEventListener("storage",fn);' +
  '</script><script src="/EmporniumCompanion.js"></script>';

export function forumFixtureHTML(url, { bundle = false, posted = '', account = 7, created, edits } = {}) {
  const scripts = bundle ? forumFixtureScripts : '';
  const theme = url.searchParams.get('theme');
  const wide = '#wrapper{width:min(1320px,94vw)}#content{padding:10px 18px}.forum_list{table-layout:fixed}';
  const pageTheme = theme === 'site-dark'
    ? wide + 'body{background:#19253d;color:#f4f6fc}#wrapper{background:rgba(22,29,41,.5)}' +
      '#content{background:rgba(90,120,190,.3)}a{color:#bfd0ee}' +
      'h2{padding:3px 40px 7px;background:linear-gradient(#ffffff19,#00000026);color:#def}'
    : theme === 'site-light' ? wide + 'body{background:#f0f3f8;color:#18243a}a{color:#274f9d}' : '';
  const kind = url.pathname.includes('unread') ? 'unread' : url.pathname === '/forum/search' ? 'search' :
    url.pathname.includes('userhistory') ? 'subscriptions' : /^\/forum\/\d+/.test(url.pathname) ? 'board' : 'boards';
  const topic = /^\/forum\/(\d+)\/new$/.exec(url.pathname);
  const main = topic ? forumNewTopicHTML(topic[1]) : url.pathname.startsWith('/forum/thread/')
    ? forumThreadHTML(url, posted, { created, edits }) : forumListHTML(kind);
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="ep-companion-fixture" content="local-test-only"><title>Companion forum fixture</title><style>' +
    'body{min-width:960px;margin:0;background:#f0f3f8;color:#18243a;font:12px/1.35 system-ui,sans-serif}' +
    '#wrapper{width:960px;min-width:960px;margin:auto}#content{min-width:940px;margin:auto}' +
    '#header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;margin-block-end:10px;border-block-end:1px solid #dbe2ee}' +
    '#header nav{display:flex;gap:14px;align-items:center}a{color:#274f9d}button,input,textarea{font:inherit}h4{margin:0}' +
    'li{list-style-position:inside}' +
    '.post_content{min-height:100px;padding:10px 10px 20px}.post_footer{width:400px;border-top:1px dashed #aaa}' +
    'span.quote_label{float:left;margin-left:10px;margin-bottom:4px}blockquote.bbcode{clear:both}' +
    '.head{font-weight:700;padding:7px 10px}.forum_post,table{width:100%;border-spacing:0}.forum_post{margin:7px 0;background:white}' +
    '.smallhead{background:#e4e9f2}.smallhead td,.postbody,td.avatar{padding:8px}.postbody,td.avatar{vertical-align:top}' +
    'tr.smallhead a:link,tr.smallhead button{color:#ddd;background:unset;border:unset;display:unset}' +
    'tr.smallhead a:visited{color:#023174}' +
    '.colhead{background:#e4e9f2}.forum_list td,.forum_index td{padding:6px}.avatar img{width:52px;height:52px}.hidden{display:none}' +
    '@media(prefers-color-scheme:dark){body{background:#151c28;color:#dce6f8}a{color:#b9cdff}}' + pageTheme + '</style>' + scripts + '</head><body>' +
    '<div id="wrapper"><header id="header"><nav><strong>Empornium</strong><a href="/forum">Forum</a><a href="/forum/23">Site Bugs</a></nav>' +
    (account ? '<span id="userinfo_username"><a href="/user.php?id=' + account + '">Tester</a></span>' : '') + '</header>' +
    '<main id="content">' + main + '</main></div>' +
    '</body></html>';
}

function forumFixturePreview(bbcode) {
  const tree = parseForumBBCode(bbcode);
  if (!tree) return '<pre>' + escapeHTML(bbcode) + '</pre>';
  function format(node) {
    if (node.type === 'text') {
      let value = escapeHTML(node.text).replace(/:[a-z0-9_-]+:/gi, code => smilies.includes(code) ? smileyImage(code) : code);
      for (const { type, attrs } of node.marks ?? []) {
        const tag = { strong: 'strong', em: 'em', underline: 'u', strike: 's', sup: 'sup', sub: 'sub' }[type];
        if (type === 'link') value = '<a href="' + escapeHTML(attrs.href) + '">' + value + '</a>';
        else if (tag) value = '<' + tag + '>' + value + '</' + tag + '>';
      }
      return value;
    }
    const children = node.content?.map(format).join('') || '';
    if (node.type === 'spoiler') return '<strong>' + escapeHTML(node.attrs.label || 'Spoiler') +
      '</strong>: <a href="#" onclick="BBCode.spoiler(this);">Show</a><blockquote class="hidden spoiler">' + children + '</blockquote>';
    if (node.type === 'image') return '<img src="' + escapeHTML(node.attrs.href) + '" alt="Image">';
    if (node.type === 'url_text') return '<a href="' + escapeHTML(node.attrs.href) + '">' + escapeHTML(node.attrs.href) + '</a>';
    if (node.type === 'video') return '<span>Video link</span>';
    if (node.type === 'site_label') return '<strong>' + escapeHTML(node.attrs.tag) + '</strong>';
    if (node.type === 'horizontal_rule') return '<hr>';
    const tag = { paragraph: 'p', quote: 'blockquote', bullet_list: 'ul', list_item: 'li', code_block: 'pre',
      table: 'table', table_row: 'tr', table_cell: 'td', table_header: 'th' }[node.type];
    if (['table', 'tr', 'td', 'th'].includes(tag) && node.attrs?.label) {
      const layout = forumTableLayout(node.attrs.label).values;
      const classes = ['bbcode', layout.border && 'noborder', layout.padding, layout.vertical].filter(Boolean).join(' ');
      return '<' + tag + ' class="' + classes + '" style="' + escapeHTML(forumTableStyle(node.attrs.label, tag)) + '">' + children + '</' + tag + '>';
    }
    return tag ? '<' + tag + '>' + children + '</' + tag + '>' : children;
  }
  return format(tree);
}

export function createForumFixture() {
  let posted = '', created;
  const edits = new Map();
  return async (req, res, url) => {
    const path = url.pathname;
    if (path === '/forum-fixture-award.svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="48"><rect width="128" height="48" rx="8" fill="#234c92"/><path d="M58 29l5 5 12-16" fill="none" stroke="#fff" stroke-width="4"/></svg>');
      return true;
    }
    if (path === '/forum-fixture-avatar.svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#234c92"/><circle cx="32" cy="27" r="11" fill="#c6d8f7"/><path d="M13 57a19 19 0 0 1 38 0" fill="#c6d8f7"/></svg>');
      return true;
    }
    const quote = /^\/forum\/post\/(\d+)\/get$/.exec(path);
    if (quote) {
      const id = Number(quote[1]);
      const body = edits.get(id) ?? neutralPosts.get(id)?.body ?? '';
      const plain = url.searchParams.get('body') === '1';
      res.setHeader('Content-Type', plain ? 'application/json' : 'text/html; charset=utf-8');
      res.end(plain ? JSON.stringify(body) : forumAuthoringBody('editbox' + id, body));
      return true;
    }
    if (path === '/ajax.php' && url.searchParams.get('action') === 'get_smilies') {
      const from = Number(url.searchParams.get('indexfrom')) || 0;
      const to = Number(url.searchParams.get('indexto')) || smilies.length;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.end('<smilies>' + smilies.slice(from, to).map(code =>
        '<smiley><bbcode>' + escapeHTML(code) + '</bbcode><url><![CDATA[' + smileyImage(code) + ']]></url></smiley>'
      ).join('') + '<maxsmilies>' + smilies.length + '</maxsmilies></smilies>');
      return true;
    }
    const isPreview = path === '/ajax.php' && url.searchParams.get('action') === 'preview';
    const isReply = /^\/forum\/thread\/\d+\/reply$/.test(path);
    const isTopic = /^\/forum\/\d+\/new$/.test(path);
    const postEdit = /^\/forum\/post\/(12|13)\/edit$/.exec(path);
    if (req.method === 'POST' && (isPreview || isReply || isTopic || postEdit)) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const fields = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const body = fields.get('body') || '';
      if (isPreview) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(forumFixturePreview(body));
      } else if (isTopic && fields.get('token') === 'fixture-topic-token' && fields.get('title')?.trim() && body.trim()) {
        created = { title: fields.get('title'), body };
        res.writeHead(303, { Location: '/forum/thread/44' }).end();
      } else if (postEdit && fields.get('token') === 'fixture-edit-token' && body.trim()) {
        const id = Number(postEdit[1]);
        edits.set(id, body);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(['saved', forumPostRows(id, { ...neutralPosts.get(id), body: forumFixturePreview(body) })]));
      } else if (!isReply || fields.get('token') !== 'fixture-token' || !body.trim() || body.includes('reject this fixture reply')) {
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
      res.end(forumFixtureHTML(url, { bundle: true, posted, created, edits }));
      return true;
    }
    return false;
  };
}
