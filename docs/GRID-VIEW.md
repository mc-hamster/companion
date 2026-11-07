# Grid view

Use **List** or **Grid** in the toolbar to set your results layout. Companion remembers the choice. Settings → Appearance and Getting started share these preferences.

- Results layout: List (default) or Grid.
- Grid card size: Compact (240px), Balanced (320px, default), Large (420px), or Extra large (540px). Previously saved custom widths remain available as a Current option. Responsive cards fill the available width and become one column on narrow screens. List thumbnail width stays separate.

The grid styles the native table rows in place. Titles, tags, category information, warnings, download/bookmark links, uploader links and visibility controls retain their original behavior. Metadata uses native column headings where available. Sorting links stay accessible; static column headings are omitted. Version grouping is preserved, with Show/Hide versions controls displayed only in List. Show filtered and Hard Pass restoration use the existing filter state. Newly backfilled rows join the same grid.

Version 2.12.1 limits grid title links to two visible lines without changing their full text, destination or hover preview. Stats, uploader and category cells are hidden by default. **Settings → Appearance → Show details in grid cards** restores that whole block and remembers the choice across pages and sessions. List presentation retains its native title and metadata display.

Tags are hidden by default in Grid. **Settings → Appearance → Show tags in grid cards** independently restores the native tag links. This only changes their presentation: tag filters, highlights and saved rules still apply. The preference persists across pages and sessions and participates in backup/restore. List tags retain their native display.

**Settings → Appearance → Grid spacing → Compact** makes covers flush with the card edges and sets the gap to 10 px in Companion’s Grid. It also reduces the borders and gaps in Empornium’s native Cover Art grid. When results are in List view, **Switch to Grid** in Appearance applies the grid settings to those results.

Grid cards warm thumbnails throughout the loaded results, including backfilled rows. List thumbnails, Grid cards, and native Cover Art cards use the original once it has finished loading. Cards with neither image available show **Thumbnail unavailable** if the thumbnail fails. A confirmed missing thumbnail leaves other requests on the same host eligible. Hidden or grouped rows wait, and background tabs pause new requests.

Larger images load when you open an image preview. The preview can show the thumbnail while its larger image loads, and supported larger images can be reused from the cache the next time you request them. Scrolling or resizing preserves loaded thumbnails.

**Play animated covers in Grid** and **Play animated covers in List** are separate opt-ins in Appearance and Getting started. List playback shows inline covers even when **Inline thumbnails** is off. Native Cover Art follows the Grid setting. Companion queues full-size covers across the current results, including additional pages you load. Results in view get priority, and **Cover playback** in the header gauge includes off-screen downloads. The browser determines whether an image animates. Full-size downloads can use more data even for still covers. Covers play when visible and return to their thumbnails off-screen. Preloaded covers use the same cache limits as previews. New downloads pause in background tabs, and automatic loading and playback stay off while the system requests reduced motion.

Both autoplay controls are disabled when the system requests reduced motion. Companion keeps your choices and applies them again when reduced motion is turned off.

Layout changes do not fetch additional result pages, detail pages, galleries or torrent files. Existing image-host permissions and storage/cache limits apply. All preferences participate in backup, restore and preference Undo.

## Verification

`test/grid-view.test.mjs` exercises page-wide thumbnail warming, on-demand previews, missing thumbnails, layout switching, size presets, persistence, foreground handling and dynamic rows. The backfill regression covers missing thumbnails among a batch of 50 appended results.
