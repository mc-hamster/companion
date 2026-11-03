# Grid view

Version 2.12.0 adds a toolbar **Grid view / List view** toggle and remembers the choice. Settings → Appearance and Getting started share three preferences:

- Results layout: List (default) or Grid.
- Grid card size: Compact (240px), Balanced (320px, default), Large (420px), or Extra large (540px). Previously saved custom widths remain available as a Current option. Responsive cards fill the available width and become one column on narrow screens. List thumbnail width stays separate.
- Automatically load larger images in grid view: enabled by default. Disabling it keeps small thumbnails at card size; hover previews remain a separate choice.

The grid styles the native table rows in place. Titles, tags, category information, warnings, download/bookmark links, uploader links and visibility controls retain their original behavior. Metadata uses native column headings where available. Sorting links stay accessible; static column headings are omitted. Grouped versions expand into additional cards. Show filtered and Hard Pass restoration use the existing filter state. Newly backfilled rows join the same grid.

Grid cards request small thumbnails first, including when list thumbnails are disabled or the list uses Full original. Small-image failure uses the existing fallback policy. Automatic larger images wait until the displayed thumbnail pass has settled, then use the existing large-image scheduler, retries, host pacing and cache. Newly revealed or backfilled thumbnails pause queued upgrades until that new thumbnail pass settles. Hidden/grouped rows do not start upgrades, and background tabs pause new requests. Switching to List, turning off upgrades, or removing a row releases unused upgrade work.

Cards retain thumbnails until larger images load successfully. When possible, the loaded image node is adopted directly to avoid another transfer. A shared image already displayed elsewhere uses a separate view and waits for it to load before replacing the thumbnail. Failed or stale completions cannot replace another card or discard its small image. Resizing cards preserves loaded images.

Layout changes do not fetch additional result pages, detail pages, galleries or torrent files. Existing image-host permissions and storage/cache limits apply. All preferences participate in backup, restore and preference Undo.

## Verification

`test/grid-view.test.mjs` exercises loading order, opt-out, failure retention, live switching, original-mode/list-thumbnail independence, size presets, retained custom widths, cross-page/fresh-session persistence, foreground handling, dynamic rows, filters, grouping, and onboarding/Settings persistence. The compiled bundle and existing backfill, filter, hover, storage and performance regressions run with the full suite.

Native Chromium checks use the neutral local fixture. Desktop cards show 960px originals after 160px thumbnails without duplicate original transfers; a 390px viewport uses one column without horizontal overflow. This local browser validation does not replace an actual Empornium/Tampermonkey check.
