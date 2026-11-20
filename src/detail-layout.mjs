// SPDX-License-Identifier: GPL-3.0-or-later
import { canonicalImageURL, COMPANION_HOSTS, fullSizeURL, isFriendlyImageHost, safeImageURL } from './core.mjs';
import { applyWorkspaceTheme, workspacePaletteKeys } from './workspace.mjs';

const excludedDescriptionMedia = '#torrentsigbox,.smiley,.emoticon,.emoji';
const closedDescriptionMedia = '.hidden,[hidden],.spoiler,details';
const detailImage = 'img[src],img[srcset],img[data-src],img[data-lazy-src],picture > img';
const detailEmbed = '.youtube,video,audio,iframe,object,embed';
const detailSpoiler = 'blockquote.spoiler,details';
const detailMedia = [detailSpoiler, detailEmbed, detailImage, 'a[href]'].join(',');
const uploadPromotionHeading = /^(?:please\s+)?check\s+(?:out\s+)?my\s+other\s+uploads\s*:?$/i;
const studioDescriptionArtwork = /\/([\w-]+)_(?:(h_(?:cast|sceneinfo|thestory|mediainfo|screenshots))|banner(?:_[12]x)?)(?:[a-f0-9]{16})?\.png$/i;

function promotedUploadLinks(description, torrentID) {
  const doc = description.ownerDocument;
  const walker = doc.createTreeWalker(description, doc.defaultView.NodeFilter.SHOW_TEXT);
  const links = new Set();
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!uploadPromotionHeading.test(text.textContent.trim())) continue;
    let heading = text;
    while (heading.parentElement !== description && uploadPromotionHeading.test(heading.parentElement.textContent.trim())) {
      heading = heading.parentElement;
    }
    for (let sibling = heading.nextSibling; sibling; sibling = sibling.nextSibling) {
      if (sibling.nodeType === 8 || sibling.nodeType === 3 && !sibling.textContent.trim() || sibling.matches?.('br')) continue;
      if (!sibling.matches?.('a[href]') || !URL.canParse(sibling.href)) break;
      const url = new URL(sibling.href);
      const id = url.searchParams.get('id');
      if (url.origin !== doc.location.origin || url.pathname !== '/torrents.php' || !/^[1-9]\d*$/.test(id || '') || id === torrentID) break;
      links.add(sibling);
    }
  }
  return links;
}

function detailSectionHeading(section) {
  const heading = section.previousElementSibling;
  return heading?.matches('.head') ? heading : section;
}

function nativeSpoilerControl(element) {
  return /\b(?:BBCode\.)?spoiler\s*\(/i.test(element?.getAttribute('onclick') || '');
}

function detailImageSource(image) {
  return image.currentSrc || image.getAttribute('src') || image.getAttribute('data-src') || image.getAttribute('data-lazy-src');
}

function galleryImageKey(image) {
  const url = safeImageURL(detailImageSource(image), image.baseURI);
  return url && canonicalImageURL(fullSizeURL(url));
}

function descriptionDecorations(description) {
  const decorations = new Set(), studioHeaders = new Set(), studioBanners = new Map();
  for (const image of description.querySelectorAll(detailImage)) {
    const src = detailImageSource(image);
    if (!src || !URL.canParse(src, image.baseURI)) continue;
    const url = new URL(src, image.baseURI);
    if (url.pathname.startsWith('/static/common/icons/') &&
        (url.origin === image.ownerDocument.location.origin || COMPANION_HOSTS.includes(url.hostname))) {
      decorations.add(image);
      continue;
    }
    if (!isFriendlyImageHost(url.hostname) || !/\.png$/i.test(url.pathname)) continue;
    const artwork = studioDescriptionArtwork.exec(new URL(fullSizeURL(url.href)).pathname);
    if (!artwork) continue;
    const studio = artwork[1].toLowerCase();
    if (artwork[2]) {
      studioHeaders.add(studio);
      decorations.add(image);
    } else studioBanners.set(image, studio);
  }
  // A banner filename alone can also belong to a real preview.
  for (const [image, studio] of studioBanners) if (studioHeaders.has(studio)) decorations.add(image);
  return decorations;
}

export class DetailLayout {
  constructor(app) {
    this.app = app;
    const { pathname, searchParams } = new URL(app.win.location.href);
    const ids = searchParams.getAll('id'), actions = searchParams.getAll('action');
    if (pathname === '/torrents.php' && ids.length === 1 && /^[1-9]\d{0,14}$/.test(ids[0]) &&
        actions.length <= 1 && ['', 'view'].includes(actions[0] || '')) this.torrentID = ids[0];
    this.movedNodes = [];
  }

  sync() {
    const { app } = this;
    if (!this.torrentID || app.doc.readyState === 'loading') return;
    if (app.settings.reformatDetailPages && this.previewSection?.isConnected && this.root.contains(this.previewSection) &&
        this.descriptionBox.contains(this.description) &&
        [...this.originalSections].every(section => this.root.contains(section))) return;
    this.dispose();

    const root = app.doc.querySelector('#content > .details.thin');
    const top = root?.querySelector(':scope > #details_top');
    const table = top?.querySelector(':scope > .middle_column > table.torrent_table');
    const main = root?.querySelector(':scope > .main_column');
    const description = main?.querySelector('#descbox');
    const descriptionBox = description?.closest('.box');
    const supported = !!table && descriptionBox?.parentElement === main;
    if (this.toggleRow) this.toggleRow.hidden = !supported;
    if (!supported || !app.settings.reformatDetailPages) return;

    this.root = root;
    this.panelRoot = root;
    this.description = description;
    this.descriptionBox = descriptionBox;
    const cover = top.querySelector('#coverimage');
    this.coverImage = cover?.querySelector(detailImage);
    this.originalSections = new Set([detailSectionHeading(descriptionBox), descriptionBox, detailSectionHeading(table), table]);
    if (cover) {
      this.originalSections.add(detailSectionHeading(cover)).add(cover);
      if (cover.nextElementSibling?.matches('br')) this.originalSections.add(cover.nextElementSibling);
    }
    this.collageTables = [...top.querySelectorAll('table:is(#collages,#personal_collages)')].filter(table => {
      const header = table.rows[0];
      return header?.cells.length === 2 && /^collage name$/i.test(header.cells[0].textContent.trim()) &&
        /^#?\s*torrents$/i.test(header.cells[1].textContent.trim()) &&
        !header.querySelector('a,button,input,select');
    });
    this.previewSection = app.node('section', null, 'epc-detail-preview');
    this.previewSection.setAttribute('aria-label', 'Listing preview');
    this.previewImages = app.node('div', null, 'epc-detail-preview-images');
    this.previewImages.addEventListener('load', () => this.sizeSparseGallery(), true);
    this.previewExtras = app.node('div', null, 'epc-detail-preview-extras');
    this.linksPanel = app.node('details', null, 'epc-root epc-detail-preview-links');
    this.linksSummary = app.node('summary');
    this.previewLinks = app.node('ul');
    this.linksPanel.append(this.linksSummary, this.previewLinks);
    this.previewSection.append(this.previewImages, this.previewExtras, this.linksPanel);
    app.batchDOM(() => {
      top.before(this.previewSection);
      root.setAttribute('data-ep-detail-layout', '');
      root.classList.add('epc-detail-panels');
      for (const collage of this.collageTables) collage.setAttribute('data-ep-collage-count', '');
      this.mountFiles(top, table);
      this.collectPreviews(cover);
      for (const section of this.originalSections) section.setAttribute('data-ep-detail-original-hidden', '');
    });
    app.scheduleHealth();
    applyWorkspaceTheme(app, [this.fileLists, this.linksPanel]);
  }

  mountFiles(top, table) {
    const { app } = this;
    const lists = [...table.querySelectorAll('tr.torrentdetails div[id^="files_"]')].flatMap(panel => {
      const files = panel.querySelector('table');
      return /^files_\d+$/.test(panel.id) && files?.rows.length ? [{ panel, files }] : [];
    });
    if (!lists.length) return;

    this.fileLists = app.node('details', null, 'epc-root epc-detail-files');
    this.fileLists.append(app.node('summary', 'File list'));
    const tags = top.querySelector('#tag_container');
    if (tags) tags.after(this.fileLists);
    else top.insertBefore(this.fileLists, table.closest('.middle_column'));
    const selected = lists.find(({ panel }) => panel.id === 'files_' + this.torrentID) || lists[0];
    for (const [index, entry] of lists.entries()) {
      let destination = this.fileLists;
      if (lists.length > 1) {
        const label = entry.panel.closest('tr.torrentdetails').previousElementSibling?.textContent.trim().replace(/\s+/g, ' ').slice(0, 100);
        destination = app.node('details');
        destination.open = entry === selected;
        destination.append(app.node('summary', label || `Edition ${index + 1}`));
        this.fileLists.append(destination);
      }
      // Leave the site's hidden wrapper in place, and move only the table it contains.
      this.moveNodes(destination, [entry.files]).classList.add('epc-detail-file-table');
    }
  }

  collectPreviews(cover) {
    const seen = new Set();
    const decorations = descriptionDecorations(this.description);
    const promotions = promotedUploadLinks(this.description, this.torrentID);
    if (this.coverImage) this.moveImage(this.coverImage, cover, seen, decorations);
    for (const node of this.description.querySelectorAll(detailMedia)) {
      if (!this.description.contains(node) || promotions.has(node.closest('a[href]')) || node.closest(excludedDescriptionMedia) ||
          node.parentElement.closest(closedDescriptionMedia)) continue;
      if (node.matches(detailSpoiler)) {
        const control = node.previousElementSibling;
        if (node.matches('details') && node.querySelector(':scope > summary')) this.moveNodes(this.previewExtras, [node]);
        else if (nativeSpoilerControl(control)) {
          const title = control.previousElementSibling;
          const hasTitle = title?.matches('strong,b') && !title.children.length && title.textContent.trim();
          const frame = this.moveNodes(this.previewExtras, hasTitle ? [title, control, node] : [control, node]);
          frame.classList.add('epc-detail-spoiler');
          if (node.querySelector(':scope > a > img') && !node.querySelector(':scope > :not(br,a:has(>img))')) {
            frame.classList.add('epc-detail-spoiler-gallery');
          }
        }
        continue;
      }
      if (node.matches(closedDescriptionMedia)) continue;
      if (node.matches(detailEmbed)) {
        this.moveNodes(this.previewExtras, [node]);
      } else if (node.matches(detailImage)) {
        if (!decorations.has(node)) this.moveImage(node, this.description, seen, decorations);
      } else {
        const href = node.getAttribute('href').trim();
        if (href && !href.startsWith('#') && /^https?:/i.test(node.href) && node.textContent.trim() &&
            !nativeSpoilerControl(node) && !node.querySelector(detailMedia)) this.moveNodes(this.previewLinks, [node]);
      }
    }
    const links = this.previewLinks.childElementCount;
    this.linksPanel.hidden = !links;
    this.linksSummary.textContent = `Links from description (${links})`;
    this.previewSection.hidden = !links && !this.previewImages.childElementCount && !this.previewExtras.childElementCount;
    this.sizeSparseGallery();
    this.app.preview.scan(this.previewImages);
  }

  moveImage(image, section, seen, decorations) {
    const key = galleryImageKey(image);
    if (key && seen.has(key)) return;

    const media = image.parentElement.matches('picture') ? image.parentElement : image;
    const link = media.closest('a');
    const linkImages = link && section.contains(link) ? [...link.querySelectorAll(detailImage)] : [];
    const linkKeys = linkImages.map(node => node === image ? key : galleryImageKey(node)).filter(Boolean);
    const linked = linkImages.length && !linkImages.some(node => decorations.has(node)) &&
      !link.querySelector(`${detailSpoiler},${detailEmbed},${closedDescriptionMedia}`) &&
      new Set(linkKeys).size === linkKeys.length && !linkKeys.some(value => seen.has(value));
    this.moveNodes(this.previewImages, [linked ? link : media], linked ? linkImages : [image]);
    for (const value of linked ? linkKeys : [key]) if (value) seen.add(value);
  }

  sizeSparseGallery() {
    const gallery = this.previewImages;
    if (!gallery) return;
    const count = gallery.childElementCount;
    const images = count && count <= (this.coverImage ? 4 : 3) ? [...gallery.querySelectorAll('img')] : [];
    const adaptive = !!images.length && images.length === count;
    gallery.toggleAttribute('data-ep-adaptive-gallery', adaptive);
    gallery.toggleAttribute('data-ep-single-image', adaptive && count === 1);
    if (!adaptive) return;

    const ratios = images.map(image => {
      const width = image.naturalWidth || Number(image.getAttribute('width'));
      const height = image.naturalHeight || Number(image.getAttribute('height'));
      const ratio = width / height;
      return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    });
    const totalRatio = ratios.reduce((sum, ratio) => sum + ratio, 0);
    // Fractions must add up to at least 1fr or Grid leaves part of the row unused.
    gallery.style.setProperty('--epc-gallery-tracks', ratios.map(ratio => `minmax(0,${ratio / totalRatio * count}fr)`).join(' '));
    gallery.style.setProperty('--epc-gallery-ratios', String(totalRatio));
    gallery.style.setProperty('--epc-gallery-count', String(count));
  }

  moveNodes(container, nodes, images = []) {
    const frame = this.app.node(container === this.previewLinks ? 'li' : 'div');
    const moved = nodes.map(element => {
      const position = this.app.doc.createComment('Companion media position');
      element.before(position);
      frame.append(element);
      return { element, position };
    });
    for (const image of images) {
      const retry = this.app.media.records.get(image)?.retryButton;
      if (retry?.isConnected) frame.append(retry);
    }
    container.append(frame);
    this.movedNodes.push({ frame, moved, images });
    return frame;
  }

  restoreNodes() {
    this.app.preview.unbindGallery(this.previewImages);
    for (const { frame, moved, images } of this.movedNodes) {
      for (const { element, position } of moved) {
        if (element.parentNode === frame && position.parentNode) position.replaceWith(element);
        else position.remove();
      }
      for (const image of images) {
        const retry = this.app.media.records.get(image)?.retryButton;
        if (retry?.parentNode === frame) (image.closest('a') || image).after(retry);
      }
      frame.remove();
    }
    this.movedNodes.length = 0;
  }

  dispose() {
    if (!this.root) return;
    this.app.batchDOM(() => {
      this.restoreNodes();
      for (const section of this.originalSections) section.removeAttribute('data-ep-detail-original-hidden');
      this.fileLists?.remove();
      this.previewSection.remove();
      for (const collage of this.collageTables) collage.removeAttribute('data-ep-collage-count');
      this.panelRoot.classList.remove('epc-detail-panels');
      for (const key of workspacePaletteKeys) this.panelRoot.style.removeProperty(key);
      this.root.removeAttribute('data-ep-detail-layout');
    });
    this.root = this.panelRoot = this.coverImage = this.fileLists = null;
    this.collageTables = null;
    this.description = this.descriptionBox = this.previewSection = this.previewImages = this.originalSections = null;
    this.previewExtras = this.linksPanel = this.linksSummary = this.previewLinks = null;
    this.app.scheduleHealth();
  }
}
