// SPDX-License-Identifier: GPL-3.0-or-later
import { applyWorkspaceTheme } from './workspace.mjs';

function detailSectionHeading(section) {
  const heading = section.previousElementSibling;
  return heading?.matches('.head') ? heading : section;
}

export class DetailLayout {
  constructor(app) {
    this.app = app;
    const { pathname, searchParams } = new URL(app.win.location.href);
    const ids = searchParams.getAll('id'), actions = searchParams.getAll('action');
    if (pathname === '/torrents.php' && ids.length === 1 && /^[1-9]\d{0,14}$/.test(ids[0]) &&
        actions.length <= 1 && ['', 'view'].includes(actions[0] || '')) this.torrentID = ids[0];
    this.targets = new Map();
  }

  sync() {
    const { app } = this;
    if (!this.torrentID || !app.settings.reformatDetailPages) {
      if (this.root) this.dispose();
      return;
    }
    if (app.doc.readyState === 'loading' || this.nav?.isConnected && this.root.contains(this.nav) &&
        [...this.targets.keys()].every(target => this.root.contains(target))) return;
    this.dispose();

    const root = app.doc.querySelector('#content > .details.thin');
    const title = root?.querySelector(':scope > h2');
    const top = root?.querySelector(':scope > #details_top');
    const table = top?.querySelector(':scope > .middle_column > table.torrent_table');
    const main = root?.querySelector(':scope > .main_column');
    const description = main?.querySelector('#descbox');
    const descriptionBox = description?.closest('.box');
    if (!title || !table || !descriptionBox || descriptionBox.parentElement !== main) return;

    let fileList = table.querySelector('#files_' + this.torrentID);
    if (!fileList) {
      const lists = table.querySelectorAll('tr.torrentdetails [id^="files_"]');
      if (lists.length === 1) fileList = lists[0];
    }
    const fileToggle = fileList?.parentElement.querySelector(':scope > .linkbox a[onclick^="show_files("]');
    const reply = main.querySelector('#quickpostform')?.closest('.box');
    const discussion = main.querySelector(':scope > table.forum_post:not(#quickreplypreview)') ||
      (reply && detailSectionHeading(reply));
    const tags = top.querySelector(':scope > .sidebar > #tag_container');
    const collages = top.querySelector(':scope > .middle_column > :is(#collages,#personal_collages)');
    const infoToggle = root.querySelector(':scope > .linkbox #slide_button');

    this.root = root;
    this.nav = app.node('nav', null, 'epc-root epc-detail-nav');
    this.nav.setAttribute('aria-label', 'Torrent detail sections');
    if (infoToggle) this.markTarget('Show info', infoToggle);
    this.link('Overview', title);
    this.link('Description', detailSectionHeading(descriptionBox));
    this.link('Torrent info', detailSectionHeading(table), infoToggle);
    this.link('Files', fileToggle || fileList?.closest('tr.torrentdetails'), infoToggle, fileToggle && fileList);
    if (tags) this.link('Tags', detailSectionHeading(tags), infoToggle);
    if (collages) this.link('Collages', detailSectionHeading(collages), infoToggle);
    this.link('Discussion', discussion);
    top.before(this.nav);
    root.setAttribute('data-ep-detail-layout', '');
    applyWorkspaceTheme(app, [this.nav]);
  }

  markTarget(label, target) {
    let id = null;
    if (!target.id) {
      const base = 'epc-detail-' + label.toLowerCase().replaceAll(' ', '-');
      id = base;
      for (let suffix = 2; this.app.doc.getElementById(id); suffix++) id = base + '-' + suffix;
      target.id = id;
    }
    const addTabIndex = !target.hasAttribute('tabindex') && !target.matches('a[href],button');
    if (addTabIndex) target.tabIndex = -1;
    target.setAttribute('data-ep-detail-target', '');
    this.targets.set(target, { id, addTabIndex });
  }

  link(label, target, infoToggle, fileList) {
    if (!target) return;
    const { app } = this;
    if (!this.targets.has(target)) this.markTarget(label, target);
    const link = app.node('a', label);
    const url = new URL(app.win.location.href);
    url.hash = target.id;
    link.href = url.href;
    if (infoToggle || fileList) link.addEventListener('click', event => {
      if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (target.getClientRects().length === 0) {
        // The native preference can hide the entire panel. Take the user to its switch.
        if (infoToggle?.getClientRects().length) {
          event.preventDefault();
          infoToggle.focus({ preventScroll: true });
          infoToggle.scrollIntoView({ block: 'center' });
        }
      } else if (fileList && fileList.getClientRects().length === 0) target.click();
    });
    this.nav.append(link);
  }

  dispose() {
    this.nav?.remove();
    this.root?.removeAttribute('data-ep-detail-layout');
    for (const [target, { id, addTabIndex }] of this.targets) {
      target.removeAttribute('data-ep-detail-target');
      if (id && target.id === id) target.removeAttribute('id');
      if (addTabIndex && target.getAttribute('tabindex') === '-1') target.removeAttribute('tabindex');
    }
    this.targets.clear();
    this.nav = this.root = null;
  }
}
