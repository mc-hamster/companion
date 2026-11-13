// SPDX-License-Identifier: GPL-3.0-or-later

export const settingHelp = Object.freeze({
  enabled: 'Turn on Companion’s thumbnails, hover previews, and image recovery. Filters and saved searches still work when this is off.',
  previews: 'Hover over a result title or thumbnail to see a larger image. Click the preview to keep it open.',
  inlineThumbnails: 'Show a small image beside each result in List. Grid has its own card images.',
  thumbnailPlacement: 'Put List thumbnails beside the title or in the category column. Choose the title if you hide the category column.',
  categoryDisplay: 'Keep the site’s category icon, overlay it on the thumbnail, or hide the icon.',
  thumbnailMode: 'Choose the image List tries first. Small first uses a small variant when available, Page preview uses the site’s supplied image, and Full original starts with the largest image.',
  thumbnailSize: 'Set the size of List thumbnails in pixels. Grid card size is controlled separately.',
  showResultHideButton: 'Show the button for setting an individual visibility exception on each result.',
  resultsView: 'Choose List for the site’s table or Grid for image cards. You can also switch from the results toolbar.',
  gridCardWidth: 'Choose the target card width. Smaller cards fit more across the page, and cards shrink to fit a narrow screen.',
  gridSpacing: 'Compact reduces the gaps and padding in Grid. It also tightens spacing in the site’s Cover Art view.',
  gridAutoplayGifs: 'Preload full-size covers so animated images can play when Grid cards are visible. This can use extra data, including for still images.',
  listAutoplayGifs: 'Preload full-size covers so animated images can play on visible List rows. This shows inline covers even if Inline thumbnails is off and can use extra data.',
  gridShowDetails: 'Show the category and metadata such as size, seeds, and uploader on each Grid card.',
  gridShowTags: 'Show the full tag list on each Grid card. Tags still count toward filters when the list is hidden.',
  gridTagCues: 'When the full tag list is hidden, show a short cue on Grid cards with Favorite or Caution matches. Open it to see the matching tags.',
  adaptiveDetailTags: 'Let the tag list on a torrent detail page wrap into columns when there’s room. Narrow screens use one column.',
  previewWidth: 'Set the target width of enlarged previews in pixels. Previews still fit within the browser window.',
  hoverDelay: 'Wait this many milliseconds before showing a preview when you hover over a title. Increase it if previews open while you scan the list.',
  hideDelay: 'Give yourself this many milliseconds to move from the trigger into the preview before it closes. A pinned preview stays open.',
  recoverImages: 'Retry page images that fail or stall as they come into view, including images on torrent detail pages.',
  recoverBackgrounds: 'Load and recover images used as collage or Cover Art covers. This also enables Companion’s cover handling on those pages.',
  legacyFallback: 'Try the full-size image if an older Empornium resize link fails. The original can use more data.',
  prepareGalleries: 'Let the browser wait to load offscreen images in unopened galleries, reducing work when a page first opens.',
  reserveImageSpace: 'Hold space for nearby images while they load so text and controls move less as the images appear.',
  compactBodyImages: 'Limit the displayed height of very tall images in page content so they take up less scrolling space.',
  concurrency: 'Set the maximum number of thumbnail loads at once. Companion can slow down for a struggling image host. Lower this if loading feels heavy.',
  thumbnailTimeoutMs: 'Give the small image this many milliseconds before trying another candidate. A shorter wait can switch sooner to a larger image where available.',
  maxRetries: 'Set how many automatic retries to make after an image attempt fails. Zero turns off automatic retries. You can still retry manually.',
  stallMs: 'Show a slow-load message after this many milliseconds without progress. The request can keep running until its timeout.',
  timeoutMs: 'Set how long to wait for an unanswered full-size image attempt before retrying or reporting a failure.',
  cacheEntries: 'Limit the number of idle images kept in memory for quick reuse. Lower this to use less memory.',
  cacheMegapixels: 'Limit the total decoded image pixels kept in the in-memory cache. The saved image cache has its own limit in megabytes.',
  persistentImages: 'Save supported image files in this browser so future pages can reuse them. This uses local disk space.',
  persistentCacheMB: 'Set how much browser storage saved images may use. Older cached files can be cleared to make room.',
  preloadScreens: 'Prioritize thumbnails within this many screen heights of the viewport. Other loaded results can still warm in the background.',
  progressBar: 'Show the progress indicator in the Companion header. Open it to see which images and result pages are loading.',
  keyboardShortcuts: 'Enable Companion shortcuts for previews, saving edits, and opening tag menus. See the key list in this section.',
  navigationScope: 'Choose where Left and Right arrows go to the previous or next page. Requires Companion keyboard shortcuts.',
  diagnostics: 'Keep a local record of recent image and loading events for troubleshooting. Full image URLs and account tokens are omitted.',
  backfillEnabled: 'Enable Load more on supported lists and collages so you can append results to the current page.',
  backfillMode: 'Choose manual loading, a fixed number of additional pages, or every remaining page. Loading all pages can use more memory.',
  backfillPages: 'Set the number of extra pages per click or per automatic batch in fixed-count mode. The current page is already loaded.',
  groupVersions: 'Keep alternate video versions together. In List, expand the original rows. In Grid, open the versions list on the card.',
  favoriteTags: 'Enter space-separated tags to highlight as favorites. This helps you spot matches without changing which results appear.',
  cautionTags: 'Enter space-separated tags to flag for review. Caution takes priority if a tag also appears in Favorites.',
  collapsedDetailTags: 'Enter space-separated tags to tuck under Show other tags on torrent detail pages. The original tag links and controls are still available.',
  seenMode: 'Choose what to do with results whose detail pages you’ve opened in this browser. Show filtered can reveal hidden seen results in the current view.',
  nseBlacklistTaglistArea: 'Hide results with any of these exact tags. Separate tags with spaces. An Allow match can override an ordinary block.',
  nseWhitelistTaglistArea: 'Let results with any of these tags through ordinary blocks. Hard Pass and activity filters that bypass Allow can still hide them.',
  nseBlacklistTitleListArea: 'Hide results whose titles contain a listed phrase. Separate phrases with semicolons.',
  nseWhitelistTitleListArea: 'Allow results whose titles contain a listed phrase to pass ordinary blocks. Separate phrases with semicolons.',
  nseBlacklistUploadersArea: 'Hide results from these uploaders where uploader names are available. Separate usernames with spaces.',
  nseWhitelistUploadersArea: 'Let results from these uploaders through ordinary blocks. Separate usernames with spaces.',
  nseCheckHardPassEnabled: 'Apply the Hard Pass tag and title lists. Matching results stay hidden even when an ordinary Allow rule matches.',
  nseHardPassTaglistArea: 'When Hard Pass is enabled, hide results with any of these exact tags. Separate tags with spaces.',
  nseHardPassTitleListArea: 'When Hard Pass is enabled, hide results whose title contains a listed phrase. Separate phrases with semicolons.',
  nseCheckRemoveHardPassResults: 'Take Hard Pass rows out of the displayed list until you choose Show filtered. Their original positions are kept.',
  nseCheckHideAnonUploads: 'Hide results where the site shows the uploader as anonymous.',
  nseCheckHideReported: 'Hide results whose titles carry the site’s reported marker.',
  nseCheckHideWarned: 'Hide results with a warning marker from the site.',
  nseCheckHideUnseeded: 'Hide results with zero seeders in the current listing.',
  nseCheckHideGrabbed: 'Hide results the site marks as grabbed. This is useful when you want to skip downloads you’ve already grabbed.',
  nseCheckHideLeeching: 'Hide results the site marks as currently downloading.',
  nseCheckHideSeeding: 'Hide results the site marks as currently seeding.',
  nseCheckHideSnatched: 'Hide results the site marks as previously completed.',
  nseCheckHideBookmarked: 'Hide results marked as bookmarked in the current listing.',
  nseCheckBypassWhitelists: 'Give the grabbed, leeching, seeding, snatched, and bookmarked filters priority over ordinary Allow rules.',
  nseThemeDropdown: 'Choose Companion’s interface colors. Select Custom to use the colors under Advanced settings → Appearance.',
  nseUIFont: 'Set the font family for Companion’s interface. Use a font installed in your browser or a CSS fallback such as sans-serif.',
  nseTextAreaFont: 'Set the font family used in filter list and rule text boxes. Monospace makes tag lists easier to align.',
  nseBlacklistColor: 'Set the color used to mark ordinary blocked matches. Enter a CSS color such as #b91c1c.',
  nseHardPassColor: 'Set the color used to mark Hard Pass matches on tags and titles.',
  nseWhitelistColor: 'Set the color used to mark matches that are allowed through ordinary blocks.',
  nseCustomThemeBgCol: 'Set the main background color for the Custom theme.',
  nseCustomThemeBgHighCol: 'Set the hover background in parts of the filter interface that use the Custom theme.',
  nseCustomThemeForeCol: 'Set the main text color for the Custom theme. Choose one that is easy to read against the background.',
  nseCustomThemeAccentCol: 'Set the accent color for links, focus outlines, and highlighted controls in the Custom theme.',
  nseCustomThemeHighCol: 'Set the highlight and divider color used by the Custom theme.',
  nseCustomThemeHiddenBgCol: 'Set the background of filtered result rows when you reveal them with Show filtered.',
  nseCheckIndividualHide: 'Add a control on results to save a visibility exception for that one result. Right-click the control to reset a saved exception.',
  nseCheckRightClickManagementEnabled: 'Open Companion’s rule menu when you right-click supported tags or uploaders. Hold Shift to use the browser’s menu.',
  nseCheckRCMTagsEnabled: 'Include tags in the right-click rule menu so you can set Block, Allow, Favorite, or Caution while browsing.',
  nseCheckRCMUploadersEnabled: 'Include uploader names in the right-click rule menu so you can block or allow an uploader while browsing.',
  nseCheckScrollToNSEEnabled: 'Scroll to the Companion controls when a supported page opens.',
  nseCheckFilterAllButtonEnabled: 'Offer a bulk action that saves individual hide exceptions for the visible results. Requires individual result visibility.',
  nseCheckFloatingToggleButton: 'Show the Show filtered button in the toolbar when there are results it can reveal in the current view.',
  nseCheckOpenAllButton: 'Offer a bulk action that opens eligible visible results in separate tabs.',
  nseCheckOpenAllGoNext: 'After Open visible results opens the tabs, advance the current tab to the next results page.',
  nseCheckHideCategoryIcons: 'Remove the category column from the table to free up space for result names.',
  nseCheckObliviousMode: 'Hide the tag text in result rows. Tag rules still apply.',
  nseCheckCustomCSS: 'Apply the styles in the Custom CSS box to the site when Companion is active.',
  nseCheckEmojiEnabled: 'Use emoji for some rule-menu symbols and decorative text.',
  nseCheckUpdateToasts: 'Show a notice when the filtering engine is updated and your settings have been retained.',
  nseCheckRenumberTorrents: 'Renumber the visible entries on Top 10 pages after filtering.',
  nseCheckRussianRouletteMode: 'Randomly let filtered results appear on some page loads. Leave this off for consistent filtering.',
  nseCheckApril1stAllYear: 'Keep the decorative April Fools’ effect active year-round.',
  nseCustomCSSArea: 'Enter CSS for the site. Turn on Enable custom CSS to apply it.',
  nseTimeout: 'Wait this many milliseconds before integrating with the site’s comment links and calculating legacy filter storage usage.'
});

const helpCaptions = new WeakMap();

export function setSettingHelp(caption, description, control = caption) {
  if (!description) return caption;
  caption.dataset.settingHelp = description;
  helpCaptions.set(control, caption);
  control.setAttribute('aria-description', description);
  return caption;
}

export const settingGroupHelp = Object.freeze({
  advanced: 'Open less frequently used image, keyboard, appearance, browsing, and troubleshooting settings.',
  images: 'Choose how Companion shows thumbnails and enlarged previews.',
  loading: 'Tune image recovery, retry limits, and how much loading happens at once.',
  interaction: 'Set shortcuts, arrow-key navigation, and the menus available on results.',
  appearance: 'Customize fonts, filter colors, tag cues, and how parts of results are displayed.',
  results: 'Configure loading extra pages and actions that affect multiple results.',
  extras: 'Find optional display effects and filter engine behavior.',
  diagnostics: 'Review local loading history to troubleshoot images and result pages.',
  'cache-details': 'See how many images are saved, how often they’re reused, and how much space they take.',
  backup: 'Save your settings and searches, restore a backup, or import tag lists from Luminance.',
  'conditional-rules': 'Combine tags, title phrases, and uploader names to hide or allow results in specific cases.',
  'result-history': 'Choose how to show results you’ve opened and review which results you’ve seen or ignored.',
  'tag-highlights': 'Mark tags as Favorite or Caution so you can spot them while browsing.',
  'collapsed-detail-tags': 'Choose which tag labels to tuck away on torrent detail pages.',
  'Title rules': 'Hide or allow results by phrases in their titles.',
  'Uploader rules': 'Hide or allow results by the account that uploaded them.',
  'hard-pass': 'Hide matches even when an ordinary Allow rule also matches.',
  status: 'Filter by the site’s activity, bookmark, warning, and seeding markers.',
  bulk: 'Open or hide multiple eligible results in one step.'
});

export function mountSettingTooltips(app) {
  const selector = '[data-setting-help]';
  const tooltip = app.node('div', null, 'epc-setting-tooltip');
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  app.panel.append(tooltip);
  let anchor, positionAnchor, pointerFocus = false;
  const hide = () => { tooltip.hidden = true; anchor = positionAnchor = null; };
  const place = () => {
    if (!positionAnchor) return;
    const position = positionAnchor.getBoundingClientRect();
    const { innerWidth, innerHeight } = app.win;
    if (!positionAnchor.isConnected || position.bottom < 0 || position.top > innerHeight) { hide(); return; }
    const { width, height } = tooltip.getBoundingClientRect();
    tooltip.style.left = Math.max(8, Math.min(position.left, innerWidth - width - 8)) + 'px';
    tooltip.style.top = Math.max(8, position.bottom + height <= innerHeight - 8 ? position.bottom : position.top - height) + 'px';
  };
  const show = (caption, field) => {
    anchor = caption;
    positionAnchor = field?.closest('label') || caption;
    tooltip.textContent = caption.dataset.settingHelp;
    tooltip.hidden = false;
    place();
  };
  app.panel.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const caption = event.target.closest?.(selector);
    if (caption && caption !== anchor) show(caption);
  });
  app.panel.addEventListener('pointerout', event => {
    if (!anchor || !anchor.contains(event.target) && !tooltip.contains(event.target)) return;
    const next = event.relatedTarget;
    if (!next?.nodeType || !anchor.contains(next) && !tooltip.contains(next)) hide();
  });
  app.panel.addEventListener('pointerdown', () => { pointerFocus = true; hide(); });
  app.panel.addEventListener('focusin', event => {
    if (pointerFocus) return;
    const field = event.target;
    const caption = helpCaptions.get(field) || (field.matches(selector) ? field : null);
    if (caption) show(caption, field);
  });
  app.panel.addEventListener('focusout', () => {
    if (anchor && !anchor.matches(':hover') && !tooltip.matches(':hover')) hide();
  });
  app.on(app.doc, 'keydown', event => {
    pointerFocus = false;
    if (event.key !== 'Escape' || tooltip.hidden || app.panel.hidden) return;
    event.preventDefault(); event.stopPropagation(); hide();
  }, true);
  app.on(app.win, 'scroll', place, true);
  app.on(app.win, 'resize', place);
  return hide;
}
