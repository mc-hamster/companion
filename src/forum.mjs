// SPDX-License-Identifier: GPL-3.0-or-later
import { emporniumAccountID } from './core.mjs';
import { ForumComposer, forumReplyForm } from './forum-composer.mjs';
import { forumNewTopicSource, mountForumInlineEditor } from './forum-inline-editor.mjs';
import { forumButton, forumElement, forumSiteTheme } from './forum-ui.mjs';
import { createWorkspaceChrome, createWorkspacePane, styleWorkspaceSwitch, updateWorkspacePane } from './workspace.mjs';
export { mountHamsterPicker } from './hamster-picker.mjs';
export { hamsterServiceBase } from './hamster-media.mjs';

const forumThemes = [['site', 'Match site'], ['light', 'Light'], ['graphite', 'Graphite'], ['plum', 'Plum']];
const forumTextSizes = [['small', 'Small'], ['regular', 'Regular'], ['large', 'Large']];
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

function forumReplyTarget(body, page, thread) {
  let replyTo = null;
  for (const link of body.querySelectorAll('.quote_label a[href]')) {
    if (link.closest('blockquote,.spoiler')) continue;
    const url = forumURL(link, page);
    if (!url || forumTopicPath.exec(url.pathname)?.[1] !== thread) continue;
    const [queryID, duplicate] = url.searchParams.getAll('postid');
    const fragment = url.hash ? url.hash.slice(1) : 'post' + (queryID ?? '');
    const id = forumPostElement.exec(fragment)?.[1];
    if (!id || duplicate !== undefined || (queryID !== undefined && queryID !== id)) continue;
    if (replyTo && replyTo !== id) return null;
    replyTo = id;
  }
  return replyTo;
}

class ForumReader {
  constructor(win, storage, page, route, content, heading, account, media) {
    Object.assign(this, { win, doc: win.document, storage, page, route, content, heading, account, media });
    this.header = forumElement(this.doc, 'header', 'epc-root epc-forum-header');
    this.header.hidden = true;
    this.mountCompanionControl();
    this.workspace.root.after(this.header);
    const updateTheme = () => this.updateTheme();
    updateTheme();
    if (this.doc.readyState !== 'complete') win.addEventListener('load', updateTheme, { once: true });
    win.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', updateTheme);
    if (this.toggle.checked) this.setEnabled(true, false);
  }

  preference(name, fallback) {
    try { return this.storage.get('ep.forum.' + name, fallback); } catch { return fallback; }
  }

  savePreference(name, value) {
    try { this.storage.set('ep.forum.' + name, value); } catch {}
  }

  mountCompanionControl() {
    const { doc } = this;
    const workspace = createWorkspaceChrome(doc, 'Forum', () => this.closeSettings());
    const { pane, button } = createWorkspacePane(doc, 'settings', 'Settings', () => this.openSettings());
    workspace.panes = { settings: pane };
    workspace.paneButtons = new Map([['settings', button]]);
    this.workspace = workspace;
    workspace.root.classList.add('epc-forum-control');

    const toggle = forumElement(doc, 'label');
    toggle.append(forumElement(doc, 'span', '', 'Enable in forum'));
    this.toggle = forumElement(doc, 'input', 'epc-forum-toggle');
    this.toggle.type = 'checkbox';
    this.toggle.checked = this.preference('reader', false) === true;
    this.toggle.addEventListener('change', () => this.setEnabled(this.toggle.checked));
    styleWorkspaceSwitch(toggle, this.toggle);
    workspace.navigation.append(toggle);
    if (this.route.kind === 'thread') {
      const label = forumElement(doc, 'label', '', 'Threaded view');
      const threaded = forumElement(doc, 'input', 'epc-forum-threaded-toggle');
      threaded.type = 'checkbox';
      threaded.checked = this.preference('threaded', false) === true;
      threaded.disabled = true;
      threaded.addEventListener('change', () => {
        this.savePreference('threaded', threaded.checked);
        this.updateThreadLayout();
      });
      this.threadedToggle = threaded;
      styleWorkspaceSwitch(label, threaded);
      workspace.navigation.append(label);
    }
    workspace.navigation.append(button);

    this.mountNavigation(workspace.contextActions);
    workspace.context.append(workspace.contextActions);
    workspace.main.append(workspace.brand, workspace.navigation);
    workspace.toolbar.append(workspace.main, workspace.context);
    workspace.panel.append(pane);
    workspace.root.append(workspace.toolbar, workspace.panel);

    const section = forumElement(doc, 'section', 'epc-settings-section');
    section.setAttribute('aria-label', 'Forum settings');
    const fields = forumElement(doc, 'div', 'epc-basic-settings');
    section.append(forumElement(doc, 'h3', '', 'Forum'), fields);
    pane.append(section);

    const field = (name, input) => {
      const label = forumElement(doc, 'label', 'epc-setting');
      label.append(forumElement(doc, 'span', '', name), input);
      if (input.type === 'checkbox') {
        label.classList.add('epc-setting-toggle');
        label.prepend(input);
      }
      fields.append(label);
    };
    const select = (name, choices, saved, fallback) => {
      const input = forumElement(doc, 'select');
      for (const [value, label] of choices) {
        const option = forumElement(doc, 'option', '', label);
        option.value = value;
        input.append(option);
      }
      input.value = choices.some(([value]) => value === saved) ? saved : fallback;
      field(name, input);
      return input;
    };

    this.theme = select('Color theme', forumThemes, this.preference('theme', 'site'), 'site');
    this.theme.addEventListener('change', () => {
      this.savePreference('theme', this.theme.value);
      this.updateTheme();
    });
    const textSize = select('Post text size', forumTextSizes, this.preference('textSize', 'regular'), 'regular');
    doc.documentElement.dataset.epForumTextSize = textSize.value;
    textSize.addEventListener('change', () => {
      this.savePreference('textSize', textSize.value);
      doc.documentElement.dataset.epForumTextSize = textSize.value;
    });

    this.collapseQuotes = forumElement(doc, 'input');
    this.collapseQuotes.type = 'checkbox';
    this.collapseQuotes.checked = this.preference('collapseQuotes', true) !== false;
    field('Collapse long quotes', this.collapseQuotes);
    this.collapseQuotes.addEventListener('change', () => {
      this.savePreference('collapseQuotes', this.collapseQuotes.checked);
      for (const quote of this.content.querySelectorAll('.epc-forum-folded-quote')) quote.open = !this.collapseQuotes.checked;
    });

    const footer = forumElement(doc, 'footer', 'epc-savebar');
    footer.append(forumElement(doc, 'span', 'epc-caption', 'Changes save automatically'));
    workspace.panel.append(footer);
    this.heading.after(workspace.root);
    doc.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || workspace.panel.hidden || event.isComposing || event.defaultPrevented) return;
      try { if (this.storage.get('ep.settings', {})?.keyboardShortcuts === false) return; } catch {}
      this.closeSettings();
    });
  }

  openSettings() {
    if (this.workspace.panel.hidden) updateWorkspacePane(this.workspace, 'settings');
    else this.closeSettings();
  }

  closeSettings() {
    updateWorkspacePane(this.workspace, null);
    this.workspace.paneButtons.get('settings').focus();
  }

  updateTheme() {
    const theme = this.theme.value;
    const { dataset } = this.doc.documentElement;
    dataset.epForumPalette = theme;
    dataset.epForumTheme = theme === 'site' ? forumSiteTheme(this.win, this.content) : theme === 'light' ? 'light' : 'dark';
    this.composer?.renderPreview();
  }

  setEnabled(on, remember = true) {
    const enabled = Boolean(this.abort);
    if (this.composer?.sending || on === enabled) {
      this.toggle.checked = enabled;
      return;
    }
    if (remember) this.savePreference('reader', on);
    this.toggle.checked = on;
    if (this.threadedToggle) this.threadedToggle.disabled = !on;
    this.header.hidden = !on;
    if (!on) {
      this.abort.abort();
      this.abort = null;
      this.composer?.dispose();
      this.composer = null;
      for (const undo of this.changes.reverse()) undo();
      this.header.replaceChildren();
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
    else if (this.route.kind === 'new-topic') {
      const source = forumNewTopicSource(this.content, this.page, this.route.board);
      if (source) {
        const editor = mountForumInlineEditor(source, this, { context: 'topic.' + this.route.board, label: 'Topic body' });
        this.changes.push(() => editor.dispose());
      }
    } else this.mountLists();
    const fitWidth = () => this.fitWidth();
    fitWidth();
    this.on(this.win, 'resize', fitWidth);
    if (this.doc.readyState !== 'complete') this.on(this.win, 'load', fitWidth);
    this.changes.push(() => this.doc.documentElement.classList.remove('epc-forum-fit'));
  }

  fitWidth() {
    const { documentElement, body } = this.doc;
    documentElement.classList.remove('epc-forum-fit');
    const width = documentElement.clientWidth || this.win.innerWidth;
    const overflow = [body, this.doc.getElementById('wrapper'), this.content].some(element => {
      if (!element) return false;
      const { left, right } = element.getBoundingClientRect();
      return right > width + 1 || left < -1;
    });
    if (overflow) documentElement.classList.add('epc-forum-fit');
  }

  mark(element, name, changes = this.changes) {
    if (!element || element.classList.contains(name)) return;
    element.classList.add(name);
    changes.push(() => element.classList.remove(name));
  }

  mountHeader() {
    const { doc, page } = this;
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
    row.append(titles);
    this.header.replaceChildren(row);
  }

  mountNavigation(nav) {
    const { doc, page, route } = this;
    nav.classList.add('epc-forum-nav');
    nav.setAttribute('role', 'navigation');
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
  }

  styleNativeNavigation() {
    const headingText = this.heading.textContent.replace(/\s+/g, ' ').trim();
    for (const heading of this.content.querySelectorAll('.head')) {
      if (heading.querySelector('a[href="/forum"],a[href="/forum/"]') &&
        heading.textContent.replace(/\s+/g, ' ').trim() === headingText) this.mark(heading, 'epc-forum-duplicate-link');
    }
    for (const pager of this.content.querySelectorAll('.linkbox.pager')) {
      const hasContent = pager.firstElementChild || pager.textContent.trim();
      this.mark(pager, hasContent ? 'epc-forum-pager' : 'epc-forum-empty-pager');
    }
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
        if (row.matches('.colhead,thead > tr')) {
          this.mark(row, 'epc-forum-list-heading');
          for (const cell of row.cells) {
            if (/^(Posts|Views|Replies|Threads)$/i.test(cell.textContent.trim())) this.mark(cell, 'epc-forum-count-heading');
          }
          continue;
        }
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
        if (table.classList.contains('forum_index')) this.layoutLatestPost(row);
      }
    }
  }

  layoutLatestPost(row) {
    const thread = row.querySelector('td > .last_thread');
    const cell = thread?.parentElement;
    const title = thread?.querySelector('a[href]');
    const author = cell?.querySelector(':scope > :is(.last_poster,.float_right)');
    if (!title || !author || !forumTopicPath.test(forumURL(title, this.page)?.pathname || '')) return;
    const layout = forumElement(this.doc, 'div', 'epc-forum-index-latest');
    cell.prepend(layout);
    this.changes.push(() => layout.remove());
    const originalTitle = title.textContent;
    title.textContent = forumThreadTitle(title);
    this.changes.push(() => { title.textContent = originalTitle; });
    this.mark(author, 'epc-forum-index-author');
    if (!author.hasAttribute('title')) {
      author.title = author.textContent.trim();
      this.changes.push(() => author.removeAttribute('title'));
    }
    for (const child of [...cell.children]) {
      if (child === thread || child === author || child.matches('.epc-forum-jump') || child.querySelector('.epc-forum-jump')) {
        this.move(child, layout);
      }
    }
  }

  mountThread() {
    const { doc, page, route, content } = this;
    this.mark(content, 'epc-forum-thread');
    const dock = forumElement(doc, 'div', 'epc-root epc-forum-dock');
    const actions = forumElement(doc, 'nav', 'epc-forum-thread-actions');
    actions.setAttribute('aria-label', 'Thread controls');
    dock.append(actions);
    doc.body.append(dock);
    this.changes.push(() => dock.remove());
    const controls = forumReplyForm(content, page, route.thread);
    if (controls) this.composer = new ForumComposer(this.win, this.storage, page, route.thread, this.account,
      { ...controls, dock, threadActions: actions }, this.media);
    this.posts = new Map();
    const views = new Map();
    const pinned = new Map();
    let unread;
    for (const post of content.querySelectorAll('table.forum_post[id^="post"]')) {
      const id = forumPostElement.exec(post.id)?.[1];
      const head = post.rows[0]?.cells[0];
      const body = post.querySelector('td.postbody');
      if (!id || !head || !body) continue;
      this.mark(post, 'epc-forum-post');
      const view = { post, id, changes: [], folds: [] };
      views.set(post, view);
      const user = this.stylePost(view, head, body);
      this.foldPostQuotes(view, body);
      const isPinned = Boolean(head.querySelector('.sticky_post'));
      if (!isPinned && !unread && post.classList.contains('forum_unread')) {
        unread = forumElement(doc, 'div', 'epc-forum-unread-marker');
        unread.append(forumElement(doc, 'span', '', 'Unread from here'));
        post.before(unread);
        view.unread = unread;
        this.changes.push(() => unread.remove());
      }
      if (isPinned) {
        view.pinned = this.fold(post, user ? 'Pinned post · ' + user : 'Pinned post', 'epc-forum-pinned');
        pinned.set(id, view.pinned);
      }
    }
    this.threadViews = views;
    this.observePostEditors(views);
    this.changes.push(() => {
      this.threadViews = null;
      this.updateThreadLayout();
    });
    this.updateThreadLayout();
    const openPinned = () => {
      const id = forumPostElement.exec(this.win.location.hash.slice(1))?.[1] || page.searchParams.get('postid');
      if (pinned.has(id)) pinned.get(id).open = true;
    };
    openPinned();
    this.on(this.win, 'hashchange', openPinned);
    this.mountThreadActions(actions, unread);
    if (this.posts.size) this.mountSelectionQuote();
    if (this.board) this.mountBoardTopics();
  }

  updateThreadLayout() {
    this.restorePostOrder?.();
    this.restorePostOrder = null;
    if (!this.threadViews || !this.threadedToggle.checked) return;

    const changes = [];
    this.restorePostOrder = () => { for (const undo of changes.reverse()) undo(); };
    const earlier = new Map();
    for (const view of this.threadViews.values()) {
      if (!this.content.contains(view.post)) continue;
      const element = view.pinned || view.post;
      const entry = { element, container: element.parentElement, depth: 0 };
      if (view.unread) {
        const label = view.unread.firstElementChild;
        const text = label.textContent;
        label.textContent = 'First unread post';
        changes.push(() => { label.textContent = text; });
      }

      const parent = earlier.get(view.replyTo);
      if (!view.pinned && parent?.container === entry.container) {
        entry.depth = parent.depth + 1;
        if (!parent.replies) {
          const replies = forumElement(this.doc, 'div', 'epc-forum-replies');
          replies.setAttribute('role', 'group');
          replies.setAttribute('aria-label', 'Replies to post #' + view.replyTo);
          replies.classList.toggle('epc-forum-replies-deep', entry.depth > 4);
          parent.element.after(replies);
          parent.replies = replies;
          changes.push(() => replies.remove());
        }
        if (view.unread) this.move(view.unread, parent.replies, null, null, changes);
        this.move(element, parent.replies, null, null, changes);
      }
      earlier.set(view.id, entry);
    }
  }

  stylePost(view, head, body) {
    const { doc } = this;
    const { post, id, changes } = view;
    const controller = new this.win.AbortController();
    const { signal } = controller;
    changes.push(() => controller.abort());
    view.head = head;
    this.mark(head, 'epc-forum-post-head', changes);
    this.mark(body, 'epc-forum-post-body', changes);
    const actions = head.querySelector('[id="bar' + id + '"]');
    this.mark(actions, 'epc-forum-post-actions', changes);
    const permalink = head.querySelector('a.post_id[href]');
    if (permalink) {
      const label = permalink.textContent;
      const title = permalink.getAttribute('title');
      permalink.textContent = 'Post link';
      permalink.title = 'Permanent link to post #' + id;
      changes.push(() => {
        permalink.textContent = label;
        if (title === null) permalink.removeAttribute('title');
        else permalink.title = title;
      });
      this.move(permalink, actions || head, actions?.firstChild ?? null, 'epc-forum-post-link', changes);
    }
    const profile = head.querySelector('.user_dropdown a[href*="user.php"],a.username[href],a[href^="/user.php?id="]');
    const user = profile?.textContent.trim();
    this.mark(profile, 'epc-forum-author-link', changes);
    const avatar = post.querySelector('td.avatar > img.avatar');
    const awards = post.querySelector('td.avatar > .badges');
    if (avatar || awards?.childElementCount) {
      const media = forumElement(doc, 'div', 'epc-forum-post-media');
      head.prepend(media);
      changes.push(() => media.remove());
      if (avatar) this.move(avatar, media, null, 'epc-forum-author-avatar', changes);
      if (awards?.childElementCount) this.move(awards, media, null, 'epc-forum-awards', changes);
    }
    this.mark(post.querySelector('td.avatar'), 'epc-forum-avatar-cell', changes);

    const edit = head.querySelector('button[id="edit' + id + '"]');
    if (actions && edit) this.move(edit, actions, actions.firstChild, null, changes);
    const nativeQuote = head.querySelector('button[id="quote' + id + '"]');
    if (user && nativeQuote && this.composer) {
      const button = forumElement(doc, 'button', 'epc-forum-quote', 'Quote');
      button.type = 'button';
      if (actions) {
        actions.prepend(button);
        const divider = nativeQuote.previousSibling;
        if (divider?.nodeType === 3 && /^\s*[-·]\s*$/.test(divider.data)) {
          const text = divider.data;
          divider.data = '';
          changes.push(() => { divider.data = text; });
        }
      } else nativeQuote.after(button);
      changes.push(() => button.remove());
      this.mark(nativeQuote, 'epc-forum-duplicate-link', changes);
      this.posts.set(id, { post, user });
      button.addEventListener('click', () => this.quote(id, user, this.selected?.id === id ? this.selected.text : undefined), { signal });
    }
    return user;
  }

  foldPostQuotes(view, body) {
    const { doc } = this;
    for (const quote of body.querySelectorAll('.post_content blockquote.bbcode:not(.spoiler)')) {
      if (quote.closest('.spoiler,.epc-forum-folded-quote') || !(quote.querySelector('blockquote') || quote.textContent.length > 360)) continue;
      const details = this.fold(quote, '', 'epc-forum-folded-quote', view.folds);
      const summary = details.firstElementChild;
      summary.append(forumElement(doc, 'span', 'epc-forum-quote-show', 'Show quoted text'),
        forumElement(doc, 'span', 'epc-forum-quote-hide', 'Hide quoted text'));
      details.open = !this.collapseQuotes.checked;
    }
  }

  clearPostView(view) {
    this.posts.delete(view.id);
    view.editor?.dispose();
    view.editor = null;
    for (const undo of view.folds.reverse()) undo();
    for (const undo of view.changes.reverse()) undo();
    view.folds.length = view.changes.length = 0;
  }

  observePostEditors(views) {
    const { content, win } = this;
    content.addEventListener('click', event => {
      const button = event.target.closest?.('button[id^="edit"]');
      const view = views.get(button?.closest('table.epc-forum-post'));
      if (!view || button.disabled || button.id !== 'edit' + view.id) return;
      // The native edit action snapshots the post HTML for Cancel.
      for (const undo of view.folds.reverse()) undo();
      view.folds.length = 0;
    }, { capture: true, signal: this.abort.signal });

    const observer = new win.MutationObserver(records => {
      const updated = new Set();
      for (const { target } of records) {
        if (!/^(?:post|content|editcont)[1-9]\d{0,14}$/.test(target.id || '') && !target.classList?.contains('post_content')) continue;
        const view = views.get(target.closest('table.epc-forum-post'));
        if (view) updated.add(view);
      }
      let repliesChanged = false;
      for (const view of updated) {
        if (this.updatePostEditor(view)) repliesChanged = true;
      }
      if (repliesChanged && this.threadedToggle.checked) this.updateThreadLayout();
    });
    observer.observe(content, { childList: true, subtree: true });
    this.changes.push(() => {
      observer.disconnect();
      for (const view of views.values()) this.clearPostView(view);
    });
    for (const view of views.values()) this.updatePostEditor(view);
  }

  updatePostEditor(view) {
    const { post, id } = view;
    const head = post.rows[0]?.cells[0];
    const body = post.querySelector('td.postbody');
    if (!head || !body) return;
    if (head !== view.head) {
      this.clearPostView(view);
      this.stylePost(view, head, body);
    }
    const host = body.querySelector('[id="content' + id + '"] > [id="editcont' + id + '"]');
    const source = host?.querySelector('textarea[id="editbox' + id + '"][name="body"]');
    if (view.editor?.source !== source) {
      view.editor?.dispose();
      const submit = head.querySelector('[id="edit_save_' + id + '"]');
      view.editor = source ? mountForumInlineEditor(source, this, { context: 'edit.' + id, label: 'Post body', submit }) : null;
    }
    if (!host && !view.folds.length) this.foldPostQuotes(view, body);

    // Keep the reply under its saved parent while the native editor replaces the rendered body.
    const rendered = body.querySelector('.post_content');
    if (!rendered) return false;
    const replyTo = forumReplyTarget(rendered, this.page, this.route.thread);
    const changed = replyTo !== view.replyTo;
    view.replyTo = replyTo;
    return changed;
  }

  mountThreadActions(parent, unread) {
    const behavior = () => this.win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'instant' : 'smooth';
    const actions = [
      ['Top', 'Jump to top', () => this.win.scrollTo({ top: 0, behavior: behavior() })],
      ['Bottom', 'Jump to bottom', () => this.win.scrollTo({
        top: (this.doc.scrollingElement || this.doc.documentElement).scrollHeight,
        behavior: behavior()
      })]
    ];
    if (unread) actions.push(['Unread', 'Jump to first unread post', () => unread.scrollIntoView({ block: 'start', behavior: behavior() })]);
    for (const [label, title, action] of actions) {
      const button = forumButton(this.doc, label);
      button.setAttribute('aria-label', title);
      button.title = title;
      this.on(button, 'click', action);
      parent.insertBefore(button, this.composer?.launcher || null);
    }
  }

  on(element, event, listener) {
    element.addEventListener(event, listener, { signal: this.abort.signal });
  }

  move(element, target, before = null, className, changes = this.changes) {
    if (className) this.mark(element, className, changes);
    const marker = this.doc.createComment('');
    element.before(marker);
    const place = (parent, reference) => {
      if (parent.moveBefore && parent.isConnected && element.isConnected) parent.moveBefore(element, reference);
      else parent.insertBefore(element, reference);
    };
    place(target, before);
    changes.push(() => {
      if (marker.parentNode && element.parentNode === target) place(marker.parentNode, marker);
      marker.remove();
    });
  }

  fold(element, title, className, changes = this.changes) {
    const details = forumElement(this.doc, 'details', className);
    details.append(forumElement(this.doc, 'summary', '', title));
    element.before(details);
    changes.push(() => details.remove());
    this.move(element, details, null, null, changes);
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
    const { board, doc, page } = this;
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
    this.workspace.contextActions.append(topics);
    this.changes.push(() => topics.remove());
    this.on(doc, 'pointerdown', event => {
      if (topics.open && !topics.contains(event.target)) topics.open = false;
    });
    this.on(topics, 'keydown', event => {
      if (event.key !== 'Escape' || !topics.open || event.isComposing) return;
      event.preventDefault();
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
  if (route.kind === 'new-topic' && !forumNewTopicSource(content, page, route.board)) return;
  addStyle(css);
  return new ForumReader(win, storage, page, route, content, heading, account, media);
}
