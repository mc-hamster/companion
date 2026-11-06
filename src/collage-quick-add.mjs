// SPDX-License-Identifier: GPL-3.0-or-later

const quickAddID = /^[1-9]\d{0,14}$/;
const quickAddCollagePath = /^\/collage\/([1-9]\d{0,14})\/?$/;
const quickAddDetails = '#content tr.torrentdetails';

function quickAddPageID(url, pathname) {
  const ids = url.searchParams.getAll('id');
  return url.pathname === pathname && !url.searchParams.has('action') && ids.length === 1 && quickAddID.test(ids[0])
    ? ids[0] : null;
}

function quickAddAccount(root, page) {
  const href = root.querySelector('#userinfo_username a[href]')?.getAttribute('href');
  if (!href || !URL.canParse(href, page)) return null;
  const url = new URL(href, page);
  return url.origin === page.origin ? quickAddPageID(url, '/user.php') : null;
}

function quickAddForm(root, collageURL) {
  const form = root.querySelector('#content #addtorrent form');
  if (form?.method !== 'post' || !form.querySelector('input[name="url"]:enabled')) return null;
  const token = form.querySelector('input[type="hidden"][name="token"]:enabled')?.value;
  const endpoint = new URL(collageURL.href + '/add');
  const action = form.getAttribute('action');
  return token && action && URL.canParse(action, collageURL) && new URL(action, collageURL).href === endpoint.href
    ? { endpoint, token } : null;
}

function quickAddMembership(root, base) {
  const ids = new Set();
  for (const link of root.querySelectorAll('#content table#collages a[href], #content table#personal_collages a[href]')) {
    const href = link.getAttribute('href');
    if (!URL.canParse(href, base)) continue;
    const url = new URL(href, base);
    const id = quickAddCollagePath.exec(url.pathname)?.[1];
    if (id && url.origin === base.origin && !url.search) ids.add(id);
  }
  return ids;
}

export class CollageQuickAdd {
  constructor(app) {
    this.app = app;
    this.page = new URL(app.win.location.href);
    this.collageID = quickAddCollagePath.exec(this.page.pathname)?.[1];
    this.torrentID = quickAddPageID(this.page, '/torrents.php');
    this.added = new Set();
    this.unconfirmed = new Set();
  }

  mount() {
    if (this.tools || !this.collageID && !this.torrentID) return;
    const { app, page } = this;
    const heading = app.doc.querySelector('#content h2');
    this.accountID = quickAddAccount(app.doc, page);
    if (!heading || !this.accountID) return;

    if (this.collageID) {
      this.collageURL = this.urlFor(this.collageID);
      this.title = heading.textContent.trim().slice(0, 300);
      if (!this.title || !quickAddForm(app.doc, this.collageURL)) return;
    } else {
      if (!app.doc.querySelector(quickAddDetails)) return;
      this.fetch = app.options.fetch || app.win.fetch?.bind(app.win);
      if (!this.fetch) return;
      this.torrentURL = new URL('/torrents.php?id=' + this.torrentID, page);
      this.members = quickAddMembership(app.doc, page);
    }

    this.scope = 'ep.collageQuickAdd:' + page.origin + ':' + this.accountID;
    this.pinPrefix = this.scope + ':pin:';
    this.tools = app.node('div', null, 'epc-collage-tools');
    this.button = app.button('', () => this.collageID ? this.togglePin() : void this.add());
    if (this.torrentID) this.button.classList.add('epc-primary');
    this.status = app.node('span', '', 'epc-collage-status');
    this.status.setAttribute('role', 'status');
    if (this.torrentID) {
      this.select = app.node('select');
      this.select.setAttribute('aria-label', 'Quick-add collage');
      this.select.addEventListener('change', () => {
        try { app.storage.set(this.scope + ':selected', this.select.value); this.status.textContent = ''; }
        catch { this.status.textContent = 'Could not remember the selected collage.'; }
        this.renderAdd();
      });
    }
    this.tools.append(this.button);
    if (this.select) this.tools.append(this.select);
    app.contextActions.append(this.tools);
    app.toolbarStatus.append(this.status);
    app.on(app.win, 'focus', () => this.refresh());
    app.on(app.win, 'pageshow', event => { if (event.persisted) this.refresh(); });
    app.on(app.win, 'pagehide', () => this.dispose());
    this.refresh();
  }

  urlFor(id) { return new URL('/collage/' + id, this.page); }

  refresh() {
    if (this.collageID) {
      const pinned = !!this.app.storage.get(this.pinPrefix + this.collageID, '');
      this.button.textContent = pinned ? 'Unpin collage' : 'Pin for quick add';
      this.button.setAttribute('aria-pressed', String(pinned));
      return;
    }

    const { app, pinPrefix } = this;
    const pins = [];
    for (const key of app.storage.list()) {
      if (!key.startsWith(pinPrefix)) continue;
      const id = key.slice(pinPrefix.length);
      const title = app.storage.get(key, '');
      if (quickAddID.test(id) && typeof title === 'string' && title.trim()) pins.push({ id, title: title.slice(0, 300) });
    }
    pins.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    const selected = app.storage.get(this.scope + ':selected', this.select.value);
    if (JSON.stringify(pins) !== JSON.stringify(this.pins)) {
      this.pins = pins;
      this.select.replaceChildren(...pins.map(pin => {
        const option = app.node('option', pin.title);
        option.value = pin.id;
        return option;
      }));
    }
    if (pins.some(pin => pin.id === selected)) this.select.value = selected;
    this.renderAdd();
  }

  renderAdd() {
    const pin = this.pins.find(item => item.id === this.select.value);
    this.tools.hidden = !pin;
    this.status.hidden = !pin;
    this.select.hidden = this.pins.length < 2;
    this.select.disabled = !!this.operation;
    if (!pin) return;
    const added = this.added.has(pin.id), present = this.members.has(pin.id);
    this.button.textContent = (added ? 'Added to ' : present ? 'Already in ' : 'Add to ') + pin.title;
    this.button.disabled = !!this.operation || added || present;
    this.button.setAttribute('aria-busy', String(!!this.operation));
  }

  togglePin() {
    const { storage } = this.app;
    const key = this.pinPrefix + this.collageID;
    try {
      const pinned = !!storage.get(key, '');
      if (pinned) storage.delete(key);
      else storage.set(key, this.title);
      this.status.textContent = pinned ? 'Collage unpinned.' : 'Pinned. Add torrents from their details pages.';
      this.refresh();
    } catch { this.status.textContent = 'Could not save the collage pin.'; }
  }

  async readPage(url, signal) {
    const response = await this.fetch(url.href, {
      credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal
    });
    if (!response.ok || response.url && response.url !== url.href) throw new Error('Empornium could not load the page.');
    const contentType = response.headers?.get('content-type');
    if (contentType && !/\btext\/html\b/i.test(contentType)) throw new Error('Empornium did not return a page.');
    const html = await response.text();
    if (html.length > 8 * 1024 * 1024) throw new Error('The Empornium page was too large to check.');
    const template = this.app.doc.createElement('template');
    template.innerHTML = html;
    if (quickAddAccount(template.content, url) !== this.accountID) throw new Error('Your Empornium session changed.');
    return template.content;
  }

  async verifyMembership(id, signal) {
    const detail = await this.readPage(this.torrentURL, signal);
    if (!detail.querySelector(quickAddDetails)) throw new Error('Empornium did not return the torrent details.');
    return quickAddMembership(detail, this.torrentURL).has(id);
  }

  async add() {
    if (this.button.disabled || this.operation) return;
    const pin = this.pins.find(item => item.id === this.select.value);
    if (!pin) return;
    const { id, title } = pin;
    const controller = new this.app.win.AbortController();
    this.operation = controller;
    const { signal } = controller;
    const timeout = this.app.win.setTimeout(() => controller.abort(), 20000);
    this.renderAdd();
    this.status.textContent = 'Checking ' + title + '…';
    try {
      if (this.unconfirmed.has(id) && await this.verifyMembership(id, signal)) {
        this.unconfirmed.delete(id);
        this.members.add(id);
        this.status.textContent = 'Already in ' + title + '.';
        return;
      }
      this.unconfirmed.delete(id);
      const url = this.urlFor(id);
      const page = await this.readPage(url, signal);
      const form = quickAddForm(page, url);
      if (!form) {
        this.status.textContent = 'Empornium is not accepting adds to ' + title + '. Check the collage for access.';
        return;
      }
      if (signal.aborted) throw new Error('The request was interrupted.');

      this.status.textContent = 'Adding to ' + title + '…';
      this.unconfirmed.add(id);
      try {
        await this.fetch(form.endpoint.href, {
          method: 'POST', body: new URLSearchParams({ token: form.token, url: this.torrentURL.href }),
          credentials: 'same-origin', mode: 'same-origin', redirect: 'manual', signal
        });
      } catch { /* The site may have accepted the add before the connection dropped. */ }
      if (!await this.verifyMembership(id, signal)) throw new Error('The add could not be verified.');
      this.unconfirmed.delete(id);
      this.added.add(id);
      this.status.textContent = 'Added to ' + title + '.';
    } catch {
      this.status.textContent = this.unconfirmed.has(id)
        ? 'Could not confirm the add. Try again to check membership first.'
        : 'Could not reach the collage. Check your sign-in and try again.';
    } finally {
      this.app.win.clearTimeout(timeout);
      this.operation = null;
      if (!this.app.disposed) this.refresh();
    }
  }

  dispose() { this.operation?.abort(); }
}
