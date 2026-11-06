# Detailed reference

For installation and everyday use, start with the [README](../README.md). This page contains the detailed feature behavior, import formats, performance limits, and development instructions.

## Feature details

- **Previews:** hover an inline thumbnail for an immediate image-only enlargement; move off the thumbnail/enlargement to dismiss it. Click either image to pin it and reveal Close, Retry, Pin and Details controls. The usable small image enlarges while its larger version loads. Title hover shows a temporary thumbnail/info tooltip near the pointer, closes on mouse-out, and leaves link focus, navigation and the browser menu alone. Keyboard preview controls belong to the thumbnail. Includes Escape, shared requests and viewport fitting. Disabling hover still permits click-to-pin.
- **Cache usage in Settings → Statistics & storage:** a compact storage summary stays visible; expanding Statistics & storage shows saved thumbnail/preview counts and sizes, total usage against the limit, and a compact table of hits, misses, and successful managed downloads for the last **5 minutes**, **15 minutes**, **1 hour**, and **all history**. A **Hit rate** column shows hits ÷ (hits + misses), rounded to at most one decimal place; empty windows show —. A **Saved** column estimates reused image data from known file sizes, including memory and saved-file hits. Older unmeasured savings show — or a ≥ lower bound. History persists across page loads. **Reset stats** clears every window while keeping saved images. Misses and recent windows cover activity since those metrics were introduced; existing hit/download totals are retained. It updates when Settings opens and batches local changes while visible; no database polling for rolling-window aging or image-Blob scans.
- **Saved image cache:** managed inline thumbnails, collage covers and supported larger previews save image bytes in browser IndexedDB and reuse them across navigation/refresh. No timed expiry; small thumbnails are protected ahead of larger previews. Large entries that cannot fit without removing protected thumbnails are skipped. Default512MB, adjustable under **Settings → Image cache → Statistics & storage**. Clear saved images removes stored files while preserving images already displayed. Public supported image hosts use anonymous image-only transport; unsupported/access-restricted assets retain normal loading. [Scope and permissions](PERSISTENT-CACHE.md).
- **Retained hover images:** originals already requested from thumbnails keep loading after mouse-out. Completion stays cached without reopening the popup. Rehover shares pending work or displays the cached image; retries and per-host limits remain bounded. Older idle entries can be evicted under the existing cache limits.
- **Page images:** detect existing and future errors, stalled-request recovery, legacy Empornium resize-to-original fallback, visible-image retries, small-first collage covers with shared hover upgrades, responsive images and optional compact tall images.
- **Automatic preferences:** changes save after a short typing pause or a completed control change. Filters update the current results without a page reload. There is no Apply step. **Undo changes** restores the recent preference checkpoint while preserving newly saved searches.
- **Loading behavior:** automatically prepare thumbnails throughout the current results page, prioritize visible and nearby rows, prefer small images, and load directly into inline elements. Unknown hosts start with two small-image requests and grow gradually to six. A global ceiling, two ordinary large-image slots and one reserved interactive slot keep work bounded. Struggling hosts back off independently. Includes idle-cache limits, background failure backoff, space reservation and lazy preparation of unopened galleries.
- **CPU behavior:** scans overlapping changed subtrees once per frame, keeps image updates local, and batches image queue updates and status rendering. The scheduler uses cached thumbnail positions until the layout changes. Tag edits use a local tag index, and expanding a group updates its own rows. Lists with 200+ rows retain measured column proportions to reduce table reflow. [Measured results](PERFORMANCE.md#cpu-and-rendering-pass-version-271).
- **Filters:** tag, title and uploader rules with existing stored-list compatibility. Title phrases are edited in Filters → Title rules; tag/uploader rules remain available on their context menus. Includes Hard Pass/Black Hole, individual overrides, status/uploader rules, highlights, notification imports, themes/fonts/custom CSS, result actions, statistics and optional fun modes.
- **Alternate versions:** matching video releases on loaded pages automatically share a **Show versions** button. Expand to see each original row, including its thumbnail, size, seed count, status and actions. Backfilled versions join the group. Matching retains dates, title word order, studios, parts, cuts and fixes; differently named releases can remain separate. Groups follow existing visibility rules. The single opt-out is under **Settings → Advanced settings → Results & backfill**.
- **Tag highlights:** positive search tags are emphasized automatically, including wildcard terms. Right-click a tag and choose **Favorite** (green) or **Caution** (amber) inside the existing rule menu. These choices change appearance only; **Block** and **Allow** retain their existing visibility behavior. **Filters → Tag highlights** contains the two autosaving lists, with counts while folded. Highlights are included in backups and preference Undo.
- **Polite page recovery:** backfill loads one page at a time and starts requests at least one second apart. Downloading and processing a page count toward that interval. Temporary network/timeouts and HTTP408/425/429/500/502/503/504 get at most two automatic retries with increasing delay and jitter. Rate limits wait longer and respect Retry-After. Permanent failures show the reason and an Open page link; already-loaded results stay in place.
- **Automatic backfill:** choose **Settings → Browsing → Load more pages**, or replay **Getting started**. A limited batch loads N additional pages once per results or collage-page load; All follows remaining pages sequentially until the end. Manual only keeps the button. New automatic work waits for setup completion and foreground visibility; Temporary failures get two delayed retries; Stop or exhausted retries prevent another automatic batch on that page. All mode can grow page memory; image concurrency remains bounded.
- **Load more:** the backfill contribution from [mc-hamster's fork](https://github.com/mc-hamster/noshitempornium) is available in the toolbar on torrent lists and individual collages. Collage backfill adds matching cover cards and table rows together, preserves filters and hover previews, and skips duplicates. One click appends up to five following pages, skips duplicate torrent IDs, applies your existing filters and Show filtered state, prepares thumbnails, and advances Next past included pages. **Stop loading** keeps completed pages. Choose the 1–15-page batch limit directly under **Settings → Browsing**.
- **Direct thumbnails:** title/category placement, category keep/overlay/hide, small-first/page-preview/original sources and readiness progress.
- **Saved searches:** saved names appear directly below the toolbar whenever the library is nonempty. Click a name to run its criteria and reload the results page immediately; no menu or panel needs opening. Shortcuts also work on pages without a search form. **Save search** infers a name and prevents duplicates. **Searches → More → Edit search** opens a prefilled editor in that saved search's row. Save changes updates it; Cancel leaves it unchanged.
- **Simpler preferences:** Settings groups everyday appearance and browsing choices: theme, thumbnail width, hover enlargement, manual/few/all backfill, and version grouping. The page count hides in All mode. Cache details stay folded; a top-level search finds settings and restores disclosure states when cleared. Filters opens with blocked and allowed tags; other rules are folded with active counts. Technical controls are grouped under **Advanced settings**, with a search box that reveals matches. Existing preferences remain active and are preserved when editing common settings.

[Feature mapping](FEATURES.md) · [Diagnostics](DIAGNOSTICS.md) · [Validation](VALIDATION.md) · [Attribution](../THIRD_PARTY.md)

## Freeleech, conditional rules, and seen history

**Freeleech** under **Browse options** applies to loaded results in List and Grid, including backfilled rows. **Any freeleech** includes permanent and temporary offers. **Sitewide only** shows time-limited sitewide offers. Permanent freeleech icons have a dashed outline and sitewide freeleech icons have a solid outline. Bookmarks remembers its own view. **Show filtered** reveals filtered rows within the selected Freeleech view.

Choose **Add a rule** under **Filters → Conditional rules**. Select what to do, add tag, title, or uploader conditions, and choose whether every condition or any condition should match. Save the rule to apply it. The same section lists active rules with Edit and Remove actions.

Use **Advanced rule text** for grouped expressions and pasting existing rules. Enter one rule per line. Use `$TA{tag}`, `$TI{title phrase}`, and `$UP{uploader}` with `AND`, `OR`, `NOT`, and parentheses. Matching ignores capitalization. The editor flags syntax errors by line. Choose **Apply rule text** to save the draft, or **Discard draft** to return to the active rules. Blank lines and lines starting with `#` are allowed.

```text
HIDE: $UP{example-uploader} AND NOT $TA{favorite.tag}
SHOW: $TA{documentary} AND $TI{remastered}
PASS: $TA{sample} OR $TI{preview clip}
```

`HIDE` and `SHOW` follow the ordinary block and allow rules. `PASS` takes Hard Pass precedence, and explicit per-torrent overrides retain priority. Right-click a result tag and choose **Hide this tag for [uploader]** to add a rule for that combination. Conditional rules are included in preference Undo and backups.

**Filters → Seen & Ignored** stores up to 2,000 seen torrents in this browser. Choose how to display previously opened torrents. The **Hide this result** eye control sets individual ignores. Under **Review history**, use **Mark unseen** or **Unignore** to reverse an entry. Seen history is stored separately from exported preferences, and open result pages pick up other tabs’ entries when they regain focus.

## Import data

**Older filter exports:** NoShitEmpornium exports are supported through **Companion → Settings → Backup & restore**. Restored preferences apply immediately. Reset filter preferences clears filtering data only and retains its confirmation. Existing lists and preferences from Companion 1.0 are retained.

Exports from mc-hamster's fork also retain the backfill button preference and page limit. Companion backups include them in media/navigation settings and compatible legacy fields. Importing a current Companion backup uses its current settings if both representations are present.

**Saved searches:** Tampermonkey isolates storage between scripts. Copy empSavedSearches from the old script's storage editor to a JSON file. Import the array itself, or an object containing empSavedSearches and optional empSavedSearchesKeepOpen. The legacy 4.2 field format is recognized. A value copied as a JSON string should be placed inside the empSavedSearches property.

**Companion:** Export everything includes media preferences, searches, legacy UI-state fields and filter preferences. Imports validate before writing, roll back failed writes, and retain one previous-import snapshot. **Restore previous import** recovers it. Legacy drawer fields remain compatible; management opens only when requested and saved shortcuts remain visible.

Preference edits also keep one local **Undo changes** checkpoint, coalescing changes made within 30 seconds. Undo restores image/filter preferences and visibility overrides, preserving the current saved-search library. It is separate from the full pre-import snapshot and never downloads a file automatically.

## Saved-search actions

Clicking a saved name runs the saved search directly, replacing the results page. Saved search links support the browser's usual open-in-new-tab actions and do not overwrite an unsaved form draft before navigating.

Actions under **Searches → More** stay attached to the selected saved search:

- **Edit search** opens an inline draft populated from the stored record. Existing criteria, including fields absent from the site's current form, are retained. Populated text/category criteria are visible first; sorting and other options are under More criteria.
- **Save changes** updates the existing search and its shortcuts without navigating or changing the site's form/results. **Cancel** or Escape discards the draft and keeps Searches open.
- **Add to site search form** is a separate optional action for combining saved text, tags, categories and saved choices with the site's current form. It deliberately opens that form and offers Search now.

The inline editor works even when the page has no search form. Editor drafts survive panel switches and unrelated library redraws. Validation or storage failures keep the draft open; a concurrent edit to the same search is reported instead of overwritten. Rename, delete, Undo, imports, and changes from other tabs update the visible shortcuts. Clicking a saved name remains the direct run-and-refresh action.

The toolbar saves with an inferred name. **Save with a name** in the management panel is available when you want to choose one first. Management has no automatic-preference-save footer: these search actions are explicit.

## Finding less common settings

**Settings → Advanced settings** groups image behavior, loading/recovery, keyboard/menus, appearance, backfill/result actions, extras and diagnostics. Find an advanced setting opens matching groups and hides unrelated fields while you type. Clearing the query restores the previous group state. Searching or opening groups does not write new preferences. Backups remain a separate, clearly labeled section.

Title/uploader rules, Hard Pass, status filters and bulk actions live under collapsed headings in **Filters**. Counts make configured rules visible without displaying every input. Image-off and random-filtering preferences are summarized in their advanced group headings. No custom values are reset by this layout change.

## Defaults and limits

Unknown hosts start with two small-thumbnail requests and can grow to six after sustained good responses. Fresh profiles have a global ceiling of eight small requests; existing explicit ceilings are retained. Two ordinary large-image slots and one reserved interactive slot remain, for at most eleven scheduled transfers with fresh defaults. A distressed host shares its reduced allowance across all of its lanes, including hover; other hosts continue. Two retries remain the default. Small candidates fall back after 4.5 seconds, or after a brief host cooldown following an error. General image slow/timeout thresholds remain 8/24 seconds.

If normal attempts fail, a visible image gets one fresh automatic recovery attempt after a 31-second cooldown or when connectivity returns. This extra attempt does not loop. Setting automatic retries to zero disables it. Hidden/filtered failures do not demand attention, and ordinary status stays quiet after loading succeeds. Detailed counters and technical tuning remain under advanced options.

Auto thumbnails prefer page-provided or previously successful small variants, then make at most one small-name guess on recognized hosts. Page preview and Full original are explicit alternatives. A failed small URL falls back into the large-image lane while respecting its destination host’s pacing.

Thumbnail requests continue through the current results page as slots finish, without waiting for scrolling, hovering or IntersectionObserver events. Visible rows lead, nearby rows follow, then distance orders the rest. Filters run first; hidden or removed queued rows are skipped. Revealing results resumes their queue automatically. New offscreen rows join the queue, and a background tab pauses new requests until it becomes visible. Preparing the whole list starts image requests for rows you may never reach, including large fallbacks if small variants fail. Automatic thumbnail preparation does not fetch other result pages or unopened galleries. Backfill explicitly fetches following result-page HTML when clicked. Advanced nearby-image tuning affects priority and page-image recovery distance, rather than gating inline thumbnails.

Inline images load directly into their DOM element, eliminating the detached-preloader-to-image handoff. Changing size/layout preserves loaded elements and active requests. Successful variant URL hints are retained locally for seven days, up to200 entries; saved image files have no timed expiry. Moving away closes the popup while the original continues loading/retrying at lower priority. Returning reuses the same pending request or cached image. Idle retained requests and pixels share the existing cache limits; live consumers are protected. Title-only temporary requests keep their cancellation behavior.

The legacy two-slot migration remains compatible. Existing explicit overall ceilings are retained; automatic per-host tuning requires no new controls. Learned limits expire after 24 hours and are stored in a small advisory cache. The old Small mode maps to Small first. Arrow navigation has one scope setting: off, results only, or across the site. Repeated failed hovers still cannot reset retry budgets; exhausted budgets permit an explicit retry after 30 seconds.

Original mode and pinned previews can request large assets. The in-memory layer remains24 idle entries/48 megapixels. The separate saved-file layer defaults to512MB and survives page loads; active consumers/native page images are outside the idle memory allowance.

Inline hover also requests the recognized larger/original URL using the reserved interactive image lane. It displays the existing thumbnail at the enlarged size immediately, then upgrades only after the larger image loads successfully. Hover controls stay hidden until clicked; leaving both images closes the temporary enlargement even if the thumbnail button has focus. A pinned preview remains open on mouse-out. Keyboard focus offers controls directly, and touch opens them on tap. The advanced title hover-delay preference does not delay inline enlargement.

A userscript cannot fix a missing image, host outage, browser block or network failure. It cannot control native transfers already started by the browser. It never automatically clicks torrent downloads, opens result pages, changes account preferences or fetches torrent files. Open visible results runs only when explicitly clicked.

Backfill follows same-origin torrent-list pagination for the current search, sequentially, with a 20-second timeout per page. It uses numbered pager links if Next is missing, marks included pages, and disables Next at the end. A failed page can be retried without fetching completed pages again; an empty results page stops the batch. A duplicate-only page can be passed within the configured limit. Login, redirected, non-HTML or malformed responses leave the cursor retryable. Imported row scripts are never executed: safe overlay metadata is retained with unique names, while one engine supplies filtering and row controls. Native image requests wait until filtering. Standard links and magnet links remain available; fetched inline event handlers are not replayed. Source-page controls that depend on those handlers may require opening the detail page.

Optional diagnostics stay local and retain up to 3,000 events. Image records include anonymous per-page asset numbers, candidate hostnames, resize widths, timing, dimensions and load state. Cache events distinguish hits, misses, skipped lookups and unavailable or unusable storage. Managed image responses include their HTTP status. Native image fallbacks have a `null` HTTP status. Image records omit full image URLs and account tokens. Backups contain your filters and searches.

## Development

Node.js 22.13+ and pnpm 11.25.0 (the pinned `packageManager` version):

    pnpm install --frozen-lockfile
    pnpm build
    pnpm test
    pnpm check

For the neutral local browser fixture:

    pnpm fixture

Open http://127.0.0.1:8765/torrents.php. Compare loading policies with ?bench=baseline and ?bench=fast; use ?bench=ahead for 50 rows extending well below the fold. Use ?backfill=1&page=1 for four overlapping, filtered result pages, or ?searches=1 for visible saved shortcuts and an initially collapsed search form. The server binds only to loopback and generates neutral SVG assets with controlled failures/delays. Production match rules exclude localhost. [Performance methodology and results](PERFORMANCE.md).

Core/app/workspace/preferences modules own scheduling, the interface and automatic persistence. The search-editor module builds contextual drafts from saved records; native form controls supply option labels only. The backfill module owns page fetching, inert row import, duplicate handling, pager state and cancellation. A pinned GPL engine supplies filtering behavior; its generated form is hidden, and working inputs are adopted into Companion. Live updates restore baseline state before filtering again, including archived Hard Pass rows. The build verifies both pinned reference blobs, complete engine setting readers and integration anchors. Original project credits appear under Statistics & credits and in the attribution file. Legacy storage keys and backup fields remain compatible.

[Usability pass and interaction changes](USABILITY.md) · [Publishing and future releases](PUBLISHING.md)

GPL-3.0-or-later. See [LICENSE](../LICENSE) and [THIRD_PARTY.md](../THIRD_PARTY.md).

The earlier [fixed-limit experiment](CONCURRENCY-EXPERIMENT.md) led to [automatic host pacing](ADAPTIVE-HOSTS.md). The latter compares fixed and automatic cold/learned behavior in 60 local trials and documents conservative cold starts, CPU measurements and host-capacity limits.

[Preview loading feedback](PREVIEW-STATS.md) explains the elapsed/attempt suffix, cleanup behavior and why this native-image loader does not show a percentage.
