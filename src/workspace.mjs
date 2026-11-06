// SPDX-License-Identifier: GPL-3.0-or-later
// The filtering engine supplies behavior; Companion owns every visible control.
const toolbarIcons = {
  brand: 'm12 2 10 6-10 6L2 8l10-6Zm-10 10 10 6 10-6M2 16l10 6 10-6',
  filters: 'M4 6h16M7 12h10m-7 6h4',
  searches: 'M6 4h12v16l-6-4-6 4V4Z',
  settings: 'M4 6h5m4 0h7M4 12h9m4 0h3M4 18h2m4 0h10M9 4v4m4 2v4m-7 2v4',
  browse: 'M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-7 2v4',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  grid: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z',
  add: 'M12 5v14M5 12h14',
  stop: 'M6 6h12v12H6z',
  open: 'M7 17 17 7M7 7h10v10',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z'
};

export function companionIcon(app, name) {
  // Isolate the glyph from site themes that style or hide SVG elements.
  const icon = app.node('span', null, 'epc-icon');
  icon.setAttribute('aria-hidden', 'true');
  const svg = app.doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ width: '100%', height: '100%', viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '1.65', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    focusable: 'false' })) svg.setAttribute(key, value);
  svg.style.display = 'block';
  const path = app.doc.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', toolbarIcons[name]); svg.append(path);
  icon.attachShadow({ mode: 'open' }).append(svg);
  return icon;
}

export function toolbarPageName(url) {
  const { pathname, searchParams } = new URL(url);
  if (/^\/collage\//.test(pathname)) return 'Collage';
  if (pathname === '/torrents.php') return searchParams.has('id') ? 'Torrent details' : 'Search results';
  return ({ '/bookmarks.php': 'Bookmarks', '/collages.php': 'Collages', '/top10.php': 'Top 10',
    '/requests.php': 'Requests', '/user.php': 'Account' })[pathname] || '';
}

export function optionGroup(app, parent, title, { key = '', open = false, searchable = false } = {}) {
  const section = app.node('details', null, 'epc-group epc-option-group'); section.open = open;
  const summary = app.node('summary'); summary.append(app.node('span', title), app.node('small', '', 'epc-option-count'));
  section.append(summary); parent.append(section);
  if (key) section.dataset.optionGroup = key;
  if (searchable) section.dataset.settingsGroup = title;
  return section;
}

export function keyboardShortcutList(app) {
  const list = app.node('ul', null, 'epc-caption epc-shortcut-list');
  list.setAttribute('aria-label', 'Keyboard shortcuts');
  for (const [keys, action] of [
    ['Ctrl+S / Cmd+S', 'Save changes in Companion.'],
    ['P', 'Pin or unpin the open image preview.'],
    ['R', 'Retry loading the open image preview.'],
    ['Esc', 'Dismiss a preview, menu, or panel, or cancel a saved-search edit.'],
    ['Shift+F10 / Menu', 'Open the filter menu for the focused tag when tag menus are enabled.'],
    ['← / →', 'Go to the previous or next page when Arrow key pagination is enabled.'],
    ['Enter', 'Save from a text field in the saved-search editor or rename field.']
  ]) {
    const item = app.node('li');
    item.append(app.node('kbd', keys), ' ' + action);
    list.append(item);
  }
  return list;
}

export function setupSettingsSearch(app) {
  const input = app.node('input'); input.type = 'search'; input.placeholder = 'Find a setting…';
  input.setAttribute('aria-label', 'Find a setting'); input.className = 'epc-settings-search';
  const status = app.node('p', '', 'epc-caption'); status.setAttribute('role', 'status'); status.hidden = true;
  app.panes.settings.prepend(input, status); app.settingsSearch = input;
  const scope=app.panes.settings;
  let previous = null;
  input.addEventListener('input', () => {
    const query = input.value.trim().toLocaleLowerCase();
    if (query && !previous) previous = new Map([...scope.querySelectorAll('details')].map(group => [group, group.open]));
    let matches = 0;
    for (const group of scope.querySelectorAll('[data-settings-group]')) {
      const groupMatches = !!query && group.dataset.settingsGroup.toLocaleLowerCase().includes(query);
      const items = [...group.querySelectorAll('[data-option-item]')];
      let found = groupMatches;
      for (const item of items) {
        const match = !query || groupMatches || (item.textContent+' '+(item.getAttribute('aria-label')||'')).toLocaleLowerCase().includes(query);
        item.hidden = !match;
        if (query && match) { found = true; matches++; for (let node = item.parentElement; node && node !== scope; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true; }
      }
      group.hidden = !!query && !found;
      if (query && found) group.open = true;
    }
    if (!query && previous) { for (const [group, open] of previous) group.open = open; previous = null; }
    app.syncSettingsUI?.();
    status.hidden = !query;
    status.textContent = matches ? matches + (matches === 1 ? ' matching option' : ' matching options') :
      'No matching settings. Try “image”, “backfill”, or “color”.';
  });
}

export function mountFilterControls(app) {
  if (app.filterControlsMounted || !app.engineReady) return;
  app.filterControlsMounted = true;
  const { doc } = app;
  const field = (parent, id, label, help = '') => {
    const control = doc.getElementById(id); if (!control) return;
    const row = app.node('label', null, 'epc-field' + (control.type === 'checkbox' ? ' epc-check' : ''));
    row.dataset.optionItem = '';
    control.className = ''; control.dataset.epFilterControl = ''; control.setAttribute('aria-label', label);
    if (control.tagName === 'TEXTAREA') control.rows = 3;
    const caption = app.node('span', label);
    if (control.type === 'checkbox') row.append(control, caption); else row.append(caption, control);
    if (help) row.append(app.node('small', help));
    parent.append(row); return control;
  };
  const bindings = [];
  const summarize = (section, read) => bindings.push([section.querySelector('.epc-option-count'), read]);
  const countList = (id, separator) => (doc.getElementById(id)?.value || '').split(separator).filter(s => s.trim()).length;
  const ruleCount = (ids, separator) => ids.reduce((sum, id) => sum + countList(id, separator), 0);
  const countText = count => count ? count + (count === 1 ? ' rule' : ' rules') : 'None';
  app.refreshOptionSummaries = () => {
    for (const [node, read] of bindings) node.textContent = read();
  };
  summarize(app.optionGroups.images, () => !app.controls.get('enabled').checked ? 'Off' :
    [!app.controls.get('inlineThumbnails').checked ? 'Thumbnails off' : '', !app.controls.get('previews').checked ? 'Hover off' : ''].filter(Boolean).join(' · '));
  summarize(app.optionGroups.results, () => app.controls.get('backfillEnabled').checked ?
    app.controls.get('backfillMode').value === 'all' ? 'All remaining pages on load' :
      (app.controls.get('backfillPages').value || app.settings.backfillPages) +
        (app.controls.get('backfillMode').value === 'pages' ? ' additional pages on load' : ' pages per manual batch') : 'Backfill off');
  app.panes.filters.replaceChildren(app.node('p', 'Tag lists update as you type. Separate tags with spaces.', 'epc-caption'));
  const grid = app.node('div', null, 'epc-rule-grid'); app.panes.filters.append(grid);
  field(grid, 'nseBlacklistTaglistArea', 'Blocked tags');
  field(grid, 'nseWhitelistTaglistArea', 'Allowed tags', 'Allowed matches override ordinary blocks.');
  app.resultFilters.mountRules(app.panes.filters);
  app.resultFilters.mountHistory(app.panes.filters);
  const highlights = optionGroup(app, app.panes.filters, 'Tag highlights', { key: 'tag-highlights' });
  highlights.append(app.node('p', 'Favorites are green; caution tags are amber. Both keep visibility unchanged. Search tags are emphasized automatically. Right-click a tag for a quick choice.', 'epc-caption'));
  for (const [key, label] of [['favoriteTags', 'Favorite tags'], ['cautionTags', 'Caution tags']]) {
    const row = app.node('label', null, 'epc-field');
    const input = app.node('textarea'); input.rows = 2; input.maxLength = 50000; input.value = app.settings[key];
    input.dataset.setting = key; input.setAttribute('aria-label', label);
    row.append(app.node('span', label), input); highlights.append(row); app.controls.set(key, input);
  }
  summarize(highlights, () => {
    const count = key => app.controls.get(key).value.trim().split(/\s+/).filter(Boolean).length;
    const favorite = count('favoriteTags'), caution = count('cautionTags');
    return favorite || caution ? favorite + (favorite === 1 ? ' favorite' : ' favorites') + ' · ' + caution + ' caution' : 'Search matches automatically';
  });
  for (const [title, hint, ids, separator] of [
    ['Title rules', 'Hide or allow results by words in their titles. Separate phrases with semicolons.', [['nseBlacklistTitleListArea', 'Blocked title phrases'], ['nseWhitelistTitleListArea', 'Allowed title phrases']], ';'],
    ['Uploader rules', 'Separate usernames with spaces.', [['nseBlacklistUploadersArea', 'Blocked uploaders'], ['nseWhitelistUploadersArea', 'Allowed uploaders']], /\s+/]
  ]) {
    const section = optionGroup(app, app.panes.filters, title, { key: title });
    section.append(app.node('p', hint, 'epc-caption'));
    for (const [id, label] of ids) field(section, id, label);
    summarize(section, () => countText(ruleCount(ids.map(([id]) => id), separator)));
  }
  const hardPass = optionGroup(app, app.panes.filters, 'Hard Pass', { key: 'hard-pass' });
  hardPass.append(app.node('p', 'Always hide matching results, including allowed matches.', 'epc-caption'));
  field(hardPass, 'nseCheckHardPassEnabled', 'Enable Hard Pass');
  field(hardPass, 'nseHardPassTaglistArea', 'Hard Pass tags');
  field(hardPass, 'nseHardPassTitleListArea', 'Hard Pass title phrases');
  field(hardPass, 'nseCheckRemoveHardPassResults', 'Remove Hard Pass results completely');
  summarize(hardPass, () => doc.getElementById('nseCheckHardPassEnabled').checked ?
    countText(countList('nseHardPassTaglistArea', /\s+/) + countList('nseHardPassTitleListArea', ';')) : 'Off');
  const rules = optionGroup(app, app.panes.filters, 'Hide by status', { key: 'status' });
  const checks = app.node('div', null, 'epc-check-grid'); rules.append(checks);
  for (const [id, label] of [
    ['nseCheckHideAnonUploads', 'Hide anonymous uploads'], ['nseCheckHideReported', 'Hide reported results'],
    ['nseCheckHideWarned', 'Hide warned results'], ['nseCheckHideUnseeded', 'Hide unseeded results'],
    ['nseCheckHideGrabbed', 'Hide grabbed results'], ['nseCheckHideLeeching', 'Hide leeching results'],
    ['nseCheckHideSeeding', 'Hide seeding results'], ['nseCheckHideSnatched', 'Hide snatched results'],
    ['nseCheckHideBookmarked', 'Hide bookmarked results'], ['nseCheckBypassWhitelists', 'Activity filters override allowed matches']
  ]) field(checks, id, label);
  summarize(rules, () => { const count = rules.querySelectorAll('input:checked').length; return count ? count + ' enabled' : 'Off'; });
  field(app.basicAppearance, 'nseThemeDropdown', 'Color theme');
  const appearance = app.optionGroups.appearance;
  for (const [id, label] of [['nseUIFont', 'Interface font'],
    ['nseTextAreaFont', 'List font'], ['nseBlacklistColor', 'Blocked highlight'],
    ['nseHardPassColor', 'Hard Pass highlight'], ['nseWhitelistColor', 'Allowed highlight']]) field(appearance, id, label);
  const colors = app.node('details'); colors.append(app.node('summary', 'Custom theme colors')); appearance.append(colors);
  for (const [id, label] of [['nseCustomThemeBgCol', 'Background'], ['nseCustomThemeBgHighCol', 'Hover background'],
    ['nseCustomThemeForeCol', 'Text'], ['nseCustomThemeAccentCol', 'Accent'], ['nseCustomThemeHighCol', 'Highlight'],
    ['nseCustomThemeHiddenBgCol', 'Filtered row background']]) field(colors, id, label);
  const interaction = app.optionGroups.interaction, extras = app.optionGroups.extras, results = app.optionGroups.results;
  for (const [parent, rows] of [
    [interaction, [['nseCheckIndividualHide', 'Individual result visibility'], ['nseCheckRightClickManagementEnabled', 'Right-click tag and uploader rules'],
      ['nseCheckRCMTagsEnabled', 'Edit tag rules from results'],
      ['nseCheckRCMUploadersEnabled', 'Edit uploader rules from results'], ['nseCheckScrollToNSEEnabled', 'Scroll to Companion on page load']]],
    [results, [['nseCheckFilterAllButtonEnabled', 'Hide visible results action'], ['nseCheckFloatingToggleButton', 'Quick visibility control'],
      ['nseCheckOpenAllButton', 'Open visible results action'], ['nseCheckOpenAllGoNext', 'Advance after opening visible results']]],
    [appearance, [['nseCheckHideCategoryIcons', 'Remove the category column'], ['nseCheckObliviousMode', 'Hide result tags'],
      ['nseCheckCustomCSS', 'Enable custom CSS']]],
    [extras, [['nseCheckEmojiEnabled', 'Decorative icons'], ['nseCheckUpdateToasts', 'Version notices'],
      ['nseCheckRenumberTorrents', 'Renumber Top 10 results'], ['nseCheckRussianRouletteMode', 'Random filtering mode'],
      ['nseCheckApril1stAllYear', 'Decorative April 1 mode']]]
  ]) for (const [id, label] of rows) field(parent, id, label);
  summarize(extras, () => doc.getElementById('nseCheckRussianRouletteMode').checked ? 'Random filtering enabled' : '');
  field(appearance, 'nseCustomCSSArea', 'Custom CSS');
  field(app.optionGroups.loading, 'nseTimeout', 'Compatibility delay (ms)');
  const batch = optionGroup(app, app.panes.filters, 'Bulk actions', { key: 'bulk' });
  const actions = app.node('div', null, 'epc-actions'); batch.append(actions);
  app.openVisibleAction = app.button('Open visible results', () => app.options.openVisible?.());
  app.hideVisibleAction = app.button('Hide visible results', () => app.options.hideVisible?.());
  actions.append(app.openVisibleAction, app.hideVisibleAction); app.syncFilterActions();
  const info = optionGroup(app, app.advancedSettings, 'Statistics & credits', { searchable: true });
  const stats = app.node('dl', null, 'epc-statistics');
  const count = (id, separator) => (doc.getElementById(id)?.value || '').split(separator).filter(s => s.trim()).length;
  for (const [label, id, separator] of [
    ['Blocked tags', 'nseBlacklistTaglistArea', /\s+/], ['Allowed tags', 'nseWhitelistTaglistArea', /\s+/],
    ['Hard Pass tags', 'nseHardPassTaglistArea', /\s+/], ['Blocked title phrases', 'nseBlacklistTitleListArea', ';'],
    ['Allowed title phrases', 'nseWhitelistTitleListArea', ';'], ['Hard Pass title phrases', 'nseHardPassTitleListArea', ';'],
    ['Blocked uploaders', 'nseBlacklistUploadersArea', /\s+/], ['Allowed uploaders', 'nseWhitelistUploadersArea', /\s+/]
  ]) stats.append(app.node('dt', label), app.node('dd', String(count(id, separator))));
  for (const [label, key] of [['Individually hidden', 'nseIndividualUploadHidingBlacklist'], ['Individually allowed', 'nseIndividualUploadHidingWhitelist']]) {
    stats.append(app.node('dt', label), app.node('dd', String(app.storage.get(key, []).length)));
  }
  const data = Object.fromEntries(app.storage.list().filter(key => key.startsWith('nse')).map(key => [key, app.storage.get(key)]));
  stats.append(app.node('dt', 'Stored filter data'), app.node('dd', Math.ceil(JSON.stringify(data).length / 1024) + ' KiB'));
  const credit = app.node('p', 'Filtering engine: NoShitEmpornium 2.8.2 by ceodoe. Backfill contributed by mc-hamster. GPL-3.0-or-later. Companion provides the interface, media loader, and search library.', 'epc-caption');
  credit.dataset.epAttribution = '';
  info.append(stats, credit);
  const reset = app.button('Reset filter preferences', () => doc.getElementById('nseEraseDataButton')?.click());
  reset.dataset.optionItem = ''; info.append(reset);
  app.refreshOptionSummaries();
}

export function adoptRuleMenu(app, event, kind, value = '') {
  const menu = app.doc.getElementById('nseRCMBox'); if (!menu) return;
  app.ruleMenuOrigin = event.target.closest?.('a') || event.target;
  menu.dataset.epRuleKind = kind || '';
  menu.classList.add('epc-root'); menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Edit filter rule');
  const close = menu.querySelector('#nseRCMClose');
  if (close) {
    close.textContent = 'Close'; close.setAttribute('role', 'button'); close.tabIndex = 0;
    close.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close.click(); } };
  }
  for (const item of menu.querySelectorAll('.nseRCMButton')) {
    item.textContent = item.textContent.replace(/^[+−➕➖-]\s*/, '').replace(/(?:Add|Move) to blacklist/i, 'Block tag')
      .replace(/(?:Add|Move) to whitelist/i, 'Allow tag').replace(/Remove from blacklist/i, 'Remove block')
      .replace(/Remove from whitelist/i, 'Remove allow rule');
    item.setAttribute('role', 'button'); item.tabIndex = 0;
    item.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click(); } };
    item.addEventListener('click', () => {
      app.toast('Filter rule saved. Results updated.');
    }, { once: true });
  }
  const footer = menu.querySelector(':scope > p:not([id])');
  if (footer) { footer.textContent = 'Rules save and update your results automatically.'; footer.hidden = kind === 'tag'; }
  app.tags.menu(menu, kind, value);
  menu.querySelector('.epc-uploader-rule')?.remove();
  if (kind === 'tag') {
    const info = menu.querySelector('#nseRCMBoxInfoText'), tag = menu.querySelector('#nseRCMBoxTag');
    if (info && tag) {
      const status = app.node('span', 'Visibility rules', 'epc-caption epc-menu-caption');
      info.replaceChildren(app.node('strong', 'Tag: '), tag, status);
    }
    const row = app.ruleMenuOrigin.closest?.('tr.torrent');
    const uploader = row?.querySelector(app.win.location.pathname === '/top10.php' ? 'td:nth-child(10) > a' : 'td.user > a')
      ?.textContent.trim();
    const tagName = app.ruleMenuOrigin.textContent.trim();
    if (uploader && tagName && !/[{}\r\n]/.test(uploader + tagName)) {
      const rule = app.button('Hide this tag for ' + uploader, () => app.resultFilters.addTagRule(tagName, uploader));
      rule.className = 'epc-uploader-rule'; menu.append(rule);
    }
  }
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.max(12, Math.min(event.clientX, app.win.innerWidth - rect.width - 12)) + 'px';
  menu.style.top = Math.max(12, Math.min(event.clientY, app.win.innerHeight - rect.height - 12)) + 'px';
}

export function styleRowControls(app, roots = [app.doc]) {
  app.rowKeys ||= new WeakSet();
  for (const root of roots) for (const icon of root.querySelectorAll('.nseToggleIcon')) {
    const row = icon.closest('tr'); const hidden = row?.getAttribute('isNSEHidden') === '1';
    const label = icon.classList.contains('nseIndividuallyWhitelisted') ? 'Reset visibility override' :
      hidden ? 'Show this result' : 'Hide this result';
    icon.setAttribute('role', 'button'); icon.setAttribute('aria-label', label); icon.title = label; icon.tabIndex = 0;
    if (!app.rowKeys.has(icon)) {
      app.rowKeys.add(icon);
      icon.addEventListener('keydown', e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); icon.click(); } });
    }
  }
}

export function adoptNotificationControls(app) {
  for (const button of app.doc.querySelectorAll('[id^="nseImportListButton"]')) {
    const allowed = button.textContent.includes('whitelist');
    const container = button.parentNode;
    container.classList.add('epc-root', 'epc-notification-control');
    button.className = 'epc-rule-import'; button.setAttribute('role', 'button'); button.tabIndex = 0;
    button.textContent = allowed ? 'Use allowed tag rules' : 'Use blocked tag rules';
    container.onclick = () => {
      const field = container.parentNode.parentNode.querySelector('textarea.long');
      if (!field) return;
      const get = id => app.doc.getElementById(id)?.value.trim() || '';
      field.value = allowed ? get('nseWhitelistTaglistArea') :
        [app.doc.getElementById('nseCheckHardPassEnabled')?.checked ? get('nseHardPassTaglistArea') : '',
          get('nseBlacklistTaglistArea')].filter(Boolean).join(' ');
      field.dispatchEvent(new app.win.Event('input', { bubbles: true }));
      field.dispatchEvent(new app.win.Event('change', { bubbles: true }));
      app.toast('Tag rules copied. Save the notification form on the site to apply them.');
    };
    button.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); button.click(); } };
  }
}

export function applyWorkspaceTheme(app, roots = [app.root, app.preview?.element, app.onboarding?.element,
  app.doc.getElementById('nseRCMBox'), ...app.doc.querySelectorAll('.epc-notification-control,.epc-search-feedback,.epc-media-retry')]) {
  const selected = app.storage.get('nseSelectedTheme', null);
  const palettes = {
    nseThemeLegacy: ['#23395a', '#eef4ff', '#91c5ff', '#526b8e'],
    nseThemeEdgy: ['#19171c', '#ffe8eb', '#ff7f9a', '#664454'],
    nseThemeBaked: ['#202b23', '#e5f4d9', '#c9a7ff', '#53674c'],
    nseThemeDarkPurple: ['#241e31', '#ede8ff', '#c6b0ff', '#5d4d79']
  };
  let colors = palettes[selected];
  if (selected === 'nseThemeCustom') {
    const theme = app.storage.get('nseCustomTheme', {});
    colors = [theme.backgroundColor, theme.foregroundColor, theme.accentColor, theme.highlightColor];
  }
  for (const root of roots.filter(Boolean)) {
    ['--epc-bg', '--epc-fg', '--epc-accent', '--epc-line'].forEach((key, i) => {
      if (colors?.[i]) root.style.setProperty(key, colors[i]);
      else root.style.removeProperty(key);
    });
    root.style.colorScheme = palettes[selected] ? 'dark' : '';
    const font = app.storage.get('nseUIFont', null);
    root.style.fontFamily = font && /^[\w\s,'".-]{1,200}$/.test(font) ? font : '';
    const listFont = app.storage.get('nseTextAreaFont', null);
    if (listFont && /^[\w\s,'".-]{1,200}$/.test(listFont)) root.style.setProperty('--epc-list-font', listFont);
    else root.style.removeProperty('--epc-list-font');
  }
}
