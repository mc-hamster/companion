// SPDX-License-Identifier: GPL-3.0-or-later
// Keep media changes local, and process each changed subtree once per frame.
export function coalesceScanRoots(roots) {
  const connected = new Set([...roots].filter(root => root.isConnected));
  return [...connected].filter(root => {
    for (let parent = root.parentElement; parent; parent = parent.parentElement) if (connected.has(parent)) return false;
    return true;
  });
}

export function presentationMutation(mutation) {
  if (mutation.type !== 'attributes') return false;
  const current = mutation.target.getAttribute(mutation.attributeName);
  if (current === mutation.oldValue) return true;
  if (mutation.attributeName !== 'class') return false;
  const nativeClasses = value => (value || '').split(/\s+/).filter(name => name &&
    !/^epc-(?:tag-match|page-image|compact|revealed|stable-columns|result-grid|cover-art|managed-cover|native-cover|cover-positioned|version-(?:hidden|member)|category-(?:keep|hide|overlay))$/.test(name)).join(' ');
  return nativeClasses(current) === nativeClasses(mutation.oldValue);
}

export function mutationChangesResults(mutation) {
  const target = mutation.target;
  if (target.nodeType !== 1 || target.matches('img,source,video,canvas')) return false;
  const containsRows = node => node.nodeType === 1 && (node.matches('tr.torrent') ||
    node.children.length > 0 && !!node.querySelector('tr.torrent'));
  if (mutation.type === 'attributes') {
    if (!['class', 'style', 'hidden', 'isnsehidden'].includes(mutation.attributeName)) return false;
    if (mutation.attributeName === 'style') {
      const visibility = value => (value || '').match(/(?:^|;)\s*(?:display|visibility)\s*:[^;]*/gi)?.join('').toLowerCase() || '';
      if (visibility(mutation.oldValue) === visibility(target.getAttribute('style'))) return false;
    }
    return containsRows(target);
  }
  if (target.closest('div.tags,#torrent_tags_list,.torrent_icon_container,.nseToggleIcon')) return false;
  const changed = [...mutation.addedNodes, ...mutation.removedNodes];
  if (changed.some(containsRows)) return true;
  if (changed.some(node => node.nodeType === 1 && (node.matches('#search_form,#search_box,#content') ||
    node.children.length && node.querySelector('#search_form,#search_box')))) return true;
  return !!target.closest('tr.torrent') || !!target.closest('#search_form,#search_box');
}
