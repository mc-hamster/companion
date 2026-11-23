// SPDX-License-Identifier: GPL-3.0-or-later
import { emporniumAccountID } from './core.mjs';
import { ForumComposer, forumReplyForm } from './forum-composer.mjs';
import { forumElement } from './forum-ui.mjs';
export { mountHamsterPicker } from './hamster-picker.mjs';
export { hamsterServiceBase } from './hamster-media.mjs';

const forumReaderPreference = 'ep.forum.reader';
const forumTopicPath = /^\/forum\/thread\/([1-9]\d{0,14})\/?$/;
const forumBoardPath = /^\/forum\/([1-9]\d{0,14})\/?$/;
const forumPostElement = /^post([1-9]\d{0,14})$/;
const forumJumpLabels = { 'Jump to last read': 'Continue', 'Jump to last post': 'Latest', 'Jump to post': 'Matched post' };

function forumURL(anchor, base) {
  const href = anchor?.getAttribute('href');
  if (!href || !URL.canParse(href, base)) return null;
  const url = new URL(href, base);
  return url.origin === base.origin && !url.username && !url.password ? url : null;
}

function forumThreadTitle(link) {
  return (link.title || link.textContent).trim();
}

class ForumReader {
  constructor(win, storage, page, route, content, heading, account, media) {
    Object.assign(this, { win, doc: win.document, storage, page, route, content, heading, account, media });
    this.header = forumElement(this.doc, 'header', 'epc-root epc-forum-header');
    this.toggle = forumElement(this.doc, 'button', 'epc-forum-toggle');
    this.toggle.type = 'button';
    this.toggle.addEventListener('click', () => this.setEnabled(!this.abort));
    this.header.append(this.toggle);
    this.heading.after(this.header);
    if (this.preference()) this.setEnabled(true, false);
    else this.setToggle(false);
  }

  preference() {
    try { return this.storage.get(forumReaderPreference, false) === true; } catch { return false; }
  }

  setToggle(on) {
    this.toggle.textContent = on ? 'Classic view' : 'Enable Companion Forum';
    this.toggle.setAttribute('aria-pressed', String(on));
  }

  setEnabled(on, remember = true) {
    if (this.composer?.sending) return;
    if (remember) {
      try { this.storage.set(forumReaderPreference, on); } catch {}
    }
    this.setToggle(on);
    if (!on) {
      this.abort.abort();
      this.abort = null;
      this.composer?.dispose();
      this.composer = null;
      for (const undo of this.changes.reverse()) undo();
      this.header.replaceChildren(this.toggle);
      if (remember) this.toggle.focus({ preventScroll: true });
      return;
    }

    this.abort = new this.win.AbortController();
    this.changes = [];
    this.mark(this.doc.documentElement, 'epc-forum-active');
    this.mark(this.content, 'epc-forum-content');
    this.mark(this.heading, 'epc-forum-classic-heading');
    if (!this.doc.head.querySelector('meta[name="viewport"]')) {
      const viewport = this.doc.createElement('meta');
      viewport.name = 'viewport';
      viewport.content = 'width=device-width, initial-scale=1';
      this.doc.head.append(viewport);
      this.changes.push(() => viewport.remove());
    }
    this.mountHeader();
    this.styleNativeNavigation();
    if (this.route.kind === 'thread') this.mountThread();
    else this.mountLists();
    if (remember) this.toggle.focus({ preventScroll: true });
  }

  mark(element, name) {
    if (!element || element.classList.contains(name)) return;
    element.classList.add(name);
    this.changes.push(() => element.classList.remove(name));
  }

  mountHeader() {
    const { doc, page, route } = this;
    const row = forumElement(doc, 'div', 'epc-forum-heading-row');
    const titles = forumElement(doc, 'div', 'epc-forum-titles');
    const crumbs = forumElement(doc, 'nav', 'epc-forum-crumbs');
    crumbs.setAttribute('aria-label', 'Forum breadcrumbs');
    let title = this.heading.textContent.trim();
    for (const link of this.heading.querySelectorAll('a[href]')) {
      const url = forumURL(link, page);
      if (!url || (url.pathname !== '/forum' && !forumBoardPath.test(url.pathname))) continue;
      const crumb = forumElement(doc, 'a', '', link.textContent.trim());
      crumb.href = url.href;
      crumbs.append(crumb);
      if (forumBoardPath.test(url.pathname)) this.board = { url, name: crumb.textContent };
    }
    if (crumbs.childElementCount) {
      title = title.split(/\s*>\s*/).slice(crumbs.childElementCount).join(' > ').trim() || title;
      titles.append(crumbs);
    }
    titles.append(forumElement(doc, 'h2', '', title));
    row.append(titles, this.toggle);
    const nav = forumElement(doc, 'nav', 'epc-forum-nav');
    nav.setAttribute('aria-label', 'Forum navigation');
    const search = new URL('/forum/search', page);
    if (route.board) search.searchParams.set('forums[]', route.board);
    if (route.thread) search.searchParams.set('threadid', route.thread);
    for (const [label, url, kind] of [
      ['Boards', '/forum', 'boards'], ['Unread', '/forum/unread', 'unread'],
      ['Subscriptions', '/userhistory.php?action=subscriptions', 'subscriptions'], ['Search', search.href, 'search']
    ]) {
      const link = forumElement(doc, 'a', '', label);
      link.href = url;
      if (kind === route.kind) link.setAttribute('aria-current', 'page');
      nav.append(link);
    }
    this.header.replaceChildren(row, nav);
  }

  styleNativeNavigation() {
    const headingText = this.heading.textContent.replace(/\s+/g, ' ').trim();
    for (const heading of this.content.querySelectorAll('.head')) {
      if (heading.querySelector('a[href="/forum"],a[href="/forum/"]') &&
        heading.textContent.replace(/\s+/g, ' ').trim() === headingText) this.mark(heading, 'epc-forum-duplicate-link');
    }
    for (const pager of this.content.querySelectorAll('.linkbox.pager')) this.mark(pager, 'epc-forum-pager');
    for (const links of this.content.querySelectorAll('.linkbox:not(.pager)')) {
      if ([...links.querySelectorAll('a')].some(link =>
        /^(Report Thread|Subscribe|Unsubscribe|Search this Thread|Search this forum|Search forum|New Thread|Unread Posts|Catch up)$/.test(link.textContent.trim()))) {
        this.mark(links, 'epc-forum-actions');
        for (const link of links.querySelectorAll('a[href]')) {
          const url = forumURL(link, this.page);
          if (!url) continue;
          if (url.pathname === '/forum/unread') this.mark(link, 'epc-forum-duplicate-link');
        }
      }
    }
  }

  mountLists() {
    const { content, page, doc } = this;
    const tables = new Set(content.querySelectorAll('table.forum_index, table.forum_list'));
    for (const link of content.querySelectorAll('tr a[href*="/forum/thread/"]')) {
      const table = link.closest('table');
      if (table && !table.classList.contains('forum_post')) tables.add(table);
    }
    for (const table of tables) {
      this.mark(table, 'epc-forum-list');
      for (const row of table.rows) {
        const title = [...row.querySelectorAll('a[href]')].find(link => {
          const url = forumURL(link, page);
          return url && (forumTopicPath.test(url.pathname) || forumBoardPath.test(url.pathname)) &&
            !url.search && !url.hash && link.textContent.trim();
        });
        if (!title) continue;
        this.mark(row, 'epc-forum-topic');
        const cell = title.closest('td');
        this.mark(cell, 'epc-forum-topic-title');
        const subject = this.route.kind === 'boards' ? title :
          [...row.querySelectorAll('a[href]')].find(link => {
            const url = forumURL(link, page);
            return url && forumTopicPath.test(url.pathname) && !url.search && !url.hash && link.textContent.trim();
          }) || title;
        this.mark(subject, 'epc-forum-subject');
        if (subject.title && forumTopicPath.test(forumURL(subject, page)?.pathname || '')) {
          const original = subject.textContent;
          subject.textContent = forumThreadTitle(subject);
          this.changes.push(() => { subject.textContent = original; });
        }
        for (const cell of row.cells) {
          if (cell !== title.closest('td') && /^\s*[\d,]+\s*$/.test(cell.textContent)) {
            this.mark(cell, 'epc-forum-topic-count');
          }
        }
        const unread = row.querySelector('.forum_hint_unread');
        const state = row.querySelector('.forum_icon_container[title]')?.title || '';
        if (unread || /\b(?:Pinned|Locked)\b/.test(state)) {
          const labels = [unread && 'Unread', /\bPinned\b/.test(state) && 'Pinned', /\bLocked\b/.test(state) && 'Locked'].filter(Boolean);
          const badges = forumElement(doc, 'span', 'epc-forum-topic-states');
          for (const label of labels) badges.append(forumElement(doc, 'span', '', label));
          subject.after(badges);
          this.changes.push(() => badges.remove());
          if (unread) this.mark(row, 'epc-forum-topic-unread');
        }
        for (const jump of row.querySelectorAll('[title]')) {
          const label = forumJumpLabels[jump.title];
          const link = jump.matches('a') ? jump : jump.querySelector('a[href]');
          const url = forumURL(link, page);
          if (!label || !url || !forumTopicPath.test(url.pathname) || !url.searchParams.has('postid')) continue;
          this.mark(link, 'epc-forum-jump');
          const caption = forumElement(doc, 'span', '', label);
          link.append(caption);
          this.changes.push(() => caption.remove());
        }
      }
    }
  }

  mountThread() {
    const { doc, page, route, content } = this;
    this.mark(content, 'epc-forum-thread');
    const controls = forumReplyForm(content, page, route.thread);
    if (controls) this.composer = new ForumComposer(this.win, this.storage, page, route.thread, this.account, controls, this.media);
    this.posts = new Map();
    const pinned = new Map();
    let unread = false;
    for (const post of content.querySelectorAll('table.forum_post[id^="post"]')) {
      const id = forumPostElement.exec(post.id)?.[1];
      const head = post.rows[0]?.cells[0];
      const body = post.querySelector('td.postbody');
      if (!id || !head || !body) continue;
      this.mark(post, 'epc-forum-post');
      this.mark(head, 'epc-forum-post-head');
      this.mark(body, 'epc-forum-post-body');
      const permalink = head.querySelector('a.post_id[href]');
      if (permalink) {
        const label = permalink.textContent;
        const title = permalink.getAttribute('title');
        permalink.textContent = 'Post link';
        permalink.title = 'Permanent link to post #' + id;
        this.changes.push(() => {
          permalink.textContent = label;
          if (title === null) permalink.removeAttribute('title');
          else permalink.title = title;
        });
        this.move(permalink, head, head.querySelector('[id="bar' + id + '"]'), 'epc-forum-post-link');
      }
      const profile = head.querySelector('.user_dropdown a[href*="user.php"],a.username[href],a[href^="/user.php?id="]');
      const user = profile?.textContent.trim();
      const avatar = post.querySelector('td.avatar > img.avatar');
      const awards = post.querySelector('td.avatar > .badges');
      if (avatar) this.move(avatar, head, head.firstChild, 'epc-forum-author-avatar');
      if (awards?.childElementCount) {
        const details = forumElement(doc, 'details', 'epc-forum-awards');
        details.append(forumElement(doc, 'summary', '', 'Awards'));
        body.append(details);
        this.changes.push(() => details.remove());
        this.move(awards, details);
      }
      this.mark(post.querySelector('td.avatar'), 'epc-forum-avatar-cell');

      const isPinned = Boolean(head.querySelector('.sticky_post'));
      if (!isPinned && !unread && post.classList.contains('forum_unread')) {
        unread = true;
        const marker = forumElement(doc, 'div', 'epc-forum-unread-marker', 'Unread from here');
        post.before(marker);
        this.changes.push(() => marker.remove());
      }
      if (isPinned) pinned.set(id, this.fold(post, user ? 'Pinned post · ' + user : 'Pinned post', 'epc-forum-pinned'));
      for (const quote of body.querySelectorAll('.post_content blockquote.bbcode:not(.spoiler)')) {
        if (quote.closest('.spoiler,.epc-forum-folded-quote') || !(quote.querySelector('blockquote') || quote.textContent.length > 360)) continue;
        this.fold(quote, 'Show quoted text', 'epc-forum-folded-quote');
      }

      const nativeQuote = head.querySelector('button[id="quote' + id + '"]');
      if (user && nativeQuote && this.composer) {
        const button = forumElement(doc, 'button', 'epc-forum-quote', 'Quote');
        button.type = 'button';
        nativeQuote.after(button);
        this.changes.push(() => button.remove());
        this.mark(nativeQuote, 'epc-forum-duplicate-link');
        this.posts.set(id, { post, user });
        this.on(button, 'click', () => this.quote(id, user, this.selected?.id === id ? this.selected.text : undefined));
      }
    }
    const openPinned = () => {
      const id = forumPostElement.exec(this.win.location.hash.slice(1))?.[1] || page.searchParams.get('postid');
      if (pinned.has(id)) pinned.get(id).open = true;
    };
    openPinned();
    this.on(this.win, 'hashchange', openPinned);
    if (this.posts.size) this.mountSelectionQuote();
    if (this.board) this.mountBoardTopics();
  }

  on(element, event, listener) {
    element.addEventListener(event, listener, { signal: this.abort.signal });
  }

  move(element, target, before = null, className) {
    if (className) this.mark(element, className);
    const marker = this.doc.createComment('');
    element.before(marker);
    target.insertBefore(element, before);
    this.changes.push(() => marker.replaceWith(element));
  }

  fold(element, title, className) {
    const details = forumElement(this.doc, 'details', className);
    details.append(forumElement(this.doc, 'summary', '', title));
    element.before(details);
    this.changes.push(() => details.remove());
    this.move(element, details);
    return details;
  }

  mountSelectionQuote() {
    const button = forumElement(this.doc, 'button', 'epc-root epc-forum-selection', 'Quote selection');
    button.type = 'button';
    button.hidden = true;
    this.doc.body.append(button);
    this.changes.push(() => button.remove());
    const signal = this.abort.signal;
    let queued = false;
    const update = () => {
      if (queued) return;
      queued = true;
      this.win.requestAnimationFrame(() => {
        queued = false;
        if (signal.aborted) return;
        if (this.doc.activeElement === button) return;
        this.selected = this.selection();
        button.hidden = !this.selected;
        if (!this.selected) return;
        const { left, bottom } = this.selected.bounds;
        button.style.left = Math.max(8, Math.min(left, this.win.innerWidth - button.offsetWidth - 8)) + 'px';
        button.style.top = Math.max(8, Math.min(bottom + 8, this.win.innerHeight - button.offsetHeight - 8)) + 'px';
      });
    };
    this.on(this.doc, 'selectionchange', update);
    this.on(this.win, 'scroll', update);
    this.on(this.win, 'resize', update);
    this.on(button, 'pointerdown', event => event.preventDefault());
    this.on(button, 'click', () => {
      if (!this.selected) return;
      const { id, user, text } = this.selected;
      this.quote(id, user, text);
      button.hidden = true;
    });
  }

  selection() {
    const selection = this.win.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const postBody = node => (node.nodeType === 1 ? node : node.parentElement)?.closest('.post_content');
    const body = postBody(range.startContainer);
    if (!body || body !== postBody(range.endContainer)) return null;
    const post = body.closest('.epc-forum-post');
    const id = forumPostElement.exec(post?.id || '')?.[1];
    const record = this.posts.get(id);
    const text = selection.toString().trim();
    if (!record || !text) return null;
    const bounds = range.getBoundingClientRect?.() || body.getBoundingClientRect();
    if (bounds.bottom < 0 || bounds.top > this.win.innerHeight) return null;
    return { id, user: record.user, text, bounds };
  }

  quote(id, user, text) {
    this.selected = null;
    this.win.getSelection()?.removeAllRanges();
    this.composer?.quote(id, user, text);
  }

  mountBoardTopics() {
    const { board, header, doc, page } = this;
    const topics = forumElement(doc, 'details', 'epc-forum-topics');
    const summary = forumElement(doc, 'summary', '', 'Topics');
    summary.setAttribute('aria-label', 'Topics in ' + board.name);
    const panel = forumElement(doc, 'div', 'epc-forum-topics-panel');
    const list = forumElement(doc, 'nav', 'epc-forum-topics-list');
    list.setAttribute('aria-label', 'Topics in ' + board.name);
    const browse = forumElement(doc, 'a', 'epc-forum-topics-browse', 'Open board');
    browse.href = board.url.href;
    panel.append(list, browse);
    topics.append(summary, panel);
    header.querySelector('.epc-forum-nav').append(topics);
    this.changes.push(() => topics.remove());
    this.on(doc, 'pointerdown', event => {
      if (topics.open && !topics.contains(event.target)) topics.open = false;
    });
    this.on(topics, 'keydown', event => {
      if (event.key !== 'Escape' || !topics.open) return;
      topics.open = false;
      summary.focus();
    });
    let loading = false;
    let loaded = false;
    const signal = this.abort.signal;
    this.on(topics, 'toggle', async () => {
      if (!topics.open || loading || loaded) return;
      loading = true;
      list.textContent = 'Loading topics…';
      try {
        const response = await this.win.fetch(board.url.href, {
          credentials: 'same-origin', mode: 'same-origin', redirect: 'error', signal
        });
        if (!response.ok) throw new Error('Board unavailable.');
        const template = doc.createElement('template');
        template.innerHTML = await response.text();
        if (signal.aborted) return;
        const table = template.content.querySelector('table.forum_list');
        if (!table || emporniumAccountID(template.content, board.url) !== this.account) throw new Error('Board unavailable.');
        const links = [];
        for (const row of table.rows) {
          const subject = [...row.querySelectorAll('a[href]')].find(link => {
            const target = forumURL(link, page);
            return target && forumTopicPath.test(target.pathname) && !target.search && !target.hash && forumThreadTitle(link);
          });
          if (!subject) continue;
          const link = forumElement(doc, 'a', '', forumThreadTitle(subject));
          link.href = forumURL(subject, page).href;
          if (link.pathname === page.pathname) link.setAttribute('aria-current', 'page');
          links.push(link);
          if (links.length === 12) break;
        }
        list.replaceChildren(...(links.length ? links : ['This board has no topics.']));
        loaded = true;
      } catch {
        if (!signal.aborted) list.textContent = 'Couldn’t load topics. Open the board or expand again to retry.';
      } finally { loading = false; }
    });
  }
}

export function mountCompanionForum(win, storage, page, route, addStyle, css, media) {
  const doc = win.document;
  const content = doc.getElementById('content');
  const heading = content?.querySelector('h2');
  const account = emporniumAccountID(doc, page);
  if (!heading || !account || doc.querySelector('.epc-forum-header,body#login,#loginform,form[action="/login.php"]')) return;
  addStyle(css);
  return new ForumReader(win, storage, page, route, content, heading, account, media);
}
