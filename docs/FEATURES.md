# Feature mapping

Version 2.13.3 keeps one thumbnail moving alongside an active original when the image host has reduced capacity to one slot and its cooldown has expired. In **Settings → Image cache**, **Pin statistics** moves the cache activity table below the toolbar across pages. Each column has its own tooltip.

Version 2.13.2 speeds up backfill batches of up to five collage pages. Thumbnail cache hits can display during image-host cooldowns, and covers can reuse saved resizes from matching rows. The local diagnostic export records cache outcomes, fallback reasons, and managed image HTTP statuses.

Version 2.13.1 fills an empty thumbnail slot with the matching larger image when Companion has already loaded it. It also isolates Companion's logo and toolbar icons from site styles that affect SVGs.

Version 2.13.0 reorganizes the toolbar. **List**, **Grid**, and **Load more** are available directly. **Browse options** contains Freeleech and Show filtered. Saved searches and loading feedback have their own row. It also adds Freeleech, conditional rules, and a history for seen and ignored torrents. Pin collages to add torrents from their details pages. Grid cards load thumbnails across the loaded results and request larger images when you open a preview. Backfill processes newly added rows and affected groups, with at least one second between request starts. [Filters and history](REFERENCE.md#freeleech-conditional-rules-and-seen-history) · [Grid view](GRID-VIEW.md)

Version 2.12.1 clamps grid titles to two lines and hides tags and the metadata/category block by default. Settings → Appearance offers separate Show tags in grid cards and Show details in grid cards toggles. Both apply immediately and persist with the normal settings/backup flow. Version expansion controls are hidden entirely in Grid. Tag filtering/highlighting, full title text, links, hover previews and native List presentation are retained.

Version 2.12.0 adds remembered List/Grid presentation of the same native result rows. Grid cards default to Balanced (320px), with Compact (240px), Large (420px) and Extra large (540px) presets plus retained custom widths, retain tags, metadata labels, links, per-row controls, version grouping and filtering, and accept backfilled rows. Static column headings are hidden; sorting links remain available. Grid thumbnails always use Small first, independently of the list's source/width settings. Once the displayed thumbnail pass settles, optional automatic originals use the existing bounded large-image queue and saved-file cache. Successful images are adopted into cards; failures keep thumbnails. Settings and Getting started expose layout, card width and automatic upgrades. List stays the default, and image improvements can still be disabled. [Grid behavior and validation](GRID-VIEW.md).

Version 2.11.0 enables Backfill results inside individual `/collage/<id>` pages. Rows and cover cards append together, deduplicated by torrent ID, with filter/reveal state, shared small-first loading and hover previews. The existing automatic modes, retries, pacing, Stop and per-host limits apply. Covers retain their square spacer; fetched scripts/forms/unsafe styles are removed, and image sources wait until filtering. Pagination preserves the collage, sort/filter query and table anchor.

Settings now has Appearance and Browsing sections for common choices. Cache usage is summarized; **Statistics & storage** contains the full metrics and storage controls. Backfill mode and version grouping are direct, with no page-count field in All mode. Global search covers common, advanced, cache and backup controls and restores prior disclosures when cleared. No duplicate controls or new stored preference is introduced.

Version 2.10.6 adds **Saved** to the same four-window activity table. It sums known image payload bytes for cache hits, including memory reuse and larger previews. It is an estimate of reused image data, not measured network traffic. Downloads alone earn no savings. Unknown historical sizes are not invented: — means none are measured and ≥ marks a measured lower bound. Savings persist, age and reset with the existing metrics; Clear saved images preserves them. The six-column table remains usable at 360px.

Version 2.10.5 adds one Hit rate column to the existing four-window table. It uses hits ÷ (hits + misses), excludes downloads, and shows up to one decimal place. Empty windows and incomplete pre-miss all-history data show —, with an explanation. No new control, preference, storage field, request or timer is added. The table still fits at 360px.

Version 2.10.4 adds cache misses and a single four-row activity table in Settings: 5 min, 15 min, 1 hour, All history; columns are Hits, Misses, Downloads. Recent history persists across pages in bounded 5-second buckets. Visible values age from an in-memory snapshot; hidden/closed Settings has no aging timer. Reset stats clears every window and preserves saved images. Existing hit/download totals survive the upgrade; new metrics are not backdated.

Version 2.10.3 makes cache hit/download totals cumulative across page loads and tabs in the same browser/site origin. **Settings → Image cache → Reset stats** starts a fresh history without deleting thumbnails or previews. Clear saved images preserves usage history. Updates batch on activity; no idle polling, new preference or permission.

Version2.10.2 adds one compact Image cache card directly in Settings. It shows saved thumbnail/preview file counts and byte sizes, total usage/limit, and clearly labeled this-page cache hits/downloads. The card reads transactional counters rather than image Blobs. It refreshes on opening and coalesces local changes while visible, with no polling when closed. Storage errors show an unavailable state; clearing saved files refreshes totals without rewriting this-page activity. Databasev3 rebuilds role counters from metadata while retaining existing files. No new controls or permissions are added.


Version2.10.1 prioritizes small saved thumbnails over preview/original files. Known thumbnail files up to512KiB are protected; larger files and previews are evicted first, even when newer. A large newcomer is declined before cleanup if it cannot fit around protected thumbnails. Preview quota failures do not turn off thumbnail writes. Databasev2 adds a metadata index and protected-byte accounting without reading/deleting existing image Blobs; legacy small files are conservatively protected until their role is known. No new settings, permissions or image requests are added. [Policy](PERSISTENT-CACHE.md#thumbnail-first-policy-version2101).


Version2.10.0 adds a persistent saved-file cache beneath the existing memory cache. Managed result thumbnails, collage covers, static original fallbacks and supported static hover upgrades reuse verified image bytes across pages and reloads. Files do not expire by time; default capacity is512MB with LRU/quota cleanup. Writes and counters are transactional, recent-use updates are batched, and blob reads are on demand. Controls remain in Advanced → Loading & recovery. Anonymous HTTPS transport is restricted to declared image hosts; CSP/storage/access problems fall back to native loading. Large animated originals keep the progressive native path. [Scope, limits and permission changes](PERSISTENT-CACHE.md).


Version2.9.2 keeps requested preview originals loading after dismissal. Last-viewer release lowers priority and clears hover eligibility closures; a later hover promotes and shares the same request. Finished detached images stay available for node adoption without a second transfer. Normal retries continue while closed, hidden-tab queued work waits, and stale completions cannot reopen or overwrite another preview. Idle unfinished requests and completed pixels share existing entry/megapixel limits; active page consumers are outside that cache allowance. No new UI controls or wider concurrency limits are added. [Policy and validation](HOVER-CACHE.md).


Version2.9.1 adds polite automatic backfill recovery: at most two delayed retries of a failed page, exponential backoff with jitter, longer rate-limit waits, Retry-After support, cancellable/background-aware waits and a one-second gap between successfully added pages. Failed pages remain the cursor; earlier pages are neither re-fetched nor duplicated. Permanent failures and exhausted retries show the safe cause plus Open page. No new preferences are added. [Policy and scope](ONBOARDING.md#version291-page-recovery).


Version 2.9.0 adds a first-use getting-started dialog, reopened from Settings. It introduces the features and explicitly says these options—and much more—remain available in Settings. Choices cover automatic backfill, thumbnail-size presets with a visual sample, hover previews, version grouping and optional Blocked/Favorite/Caution tags. Existing values, custom widths, other filters and saved searches are retained. Cancel leaves replay drafts unapplied; Not now dismisses first use without opting into automatic loading.

Automatic backfill supports manual only, N additional pages (fresh setup suggests3), and all remaining pages. Existing installations stay manual until changed. Runs once per page load after setup/filter readiness, follows only eligible same-search Next links, uses one page request at a time, pauses between pages while hidden, yields for input/rendering, and stops on permanent errors or exhausted retries. Stop cancels current work and prevents automatic restart. The existing image-host scheduler remains bounded. Owned append mutations are batched; media scanning targets only newly inserted rows. [Design, persistence and test scope](ONBOARDING.md).


Version 2.8.3 removes the native hidden class while explicitly revealing results, retaining isNSEHidden as the filter identity. Removed Hard Pass rows temporarily return at their saved markers; their collage cards and thumbnails follow the same reveal state. Hide restores removal, all-removed pages retain an enabled reveal control, and saved rules are unchanged. No new UI controls or background polling.

Version 2.8.2 fixes Show filtered being undone by version grouping. Explicitly revealed filtered rows stay outside automatic groups, so their content and thumbnails remain visible. Unfiltered versions retain grouping and expansion choices, including across hide/reveal and live rule changes. No new controls or filter-rule changes are needed.

Version 2.8.1 adds quiet loading feedback to the existing preview status line: elapsed time after one second, plus the actual attempt number during retries. Counters stop on completion/failure/dismissal and pause in hidden documents. Cached originals and title tooltips stay quiet; no new routine controls or transfers. [Design and verification](PREVIEW-STATS.md).

Version 2.8.0 adds automatic per-host pacing without new routine controls. Unknown hosts start at two small requests and grow gradually to six; the fresh global ceiling is eight, with existing custom ceilings retained. Slow/erroring hosts back off independently, sharing their reduced budget across small/original/hover work. Healthy hosts continue. Host learning is bounded, expires after 24 hours, and survives page changes without storing image paths. Constant-time active counters and event-driven cooldowns keep the scheduler lean. [Policy and verification](ADAPTIVE-HOSTS.md).

Version 2.7.7 extends the shared thumbnail loader to collage Cover Art. An early CSS gate suppresses original background transfers; small images load directly into cover cards through the six-slot queue, including offscreen cards on the current page. Supported hosts use their thumbnail variants; supplied legacy 300px covers remain small candidates. Hidden cards wait until revealed. Missing thumbnails use bounded original fallback with the large-image deadline.

Hovering a cover shows its small image while requesting the larger original, with loading/failure status and success-only replacement. Moving off dismisses the enlargement; clicking the enlargement pins controls. Cover links still navigate normally. Native absolute positioning is retained; hover geometry uses the visible cover, and covered neighboring links cannot steal an enlargement. Dynamic replacement, removal and existing recovery/hover preferences are respected. No new controls, polling or full-gallery requests are added.

Version 2.7.6 corrects backfill column sizing with native percentage-width headers. Metadata retains its measured pixel widths, Name flexes, and owned layout temporarily overrides width hints while preserving their attributes. Each completed/stopped backfill batch measures the full native table once; category spans and disabling grouping restore correctly. No resize polling or extra steady-state scans are added.

Version 2.7.5 keeps title links conventional: delayed, informational mouseover tooltip; immediate mouse-out dismissal; normal focus/navigation/browser context menu. Tooltips share small-first thumbnail loading and metadata, while thumbnail hover retains the larger-image upgrade and pin controls. Title phrase rules remain in Filters → Title rules; the old title-menu setting is hidden, with stored/imported values retained for compatibility.

Version 2.7.4 makes hover upgrades explicit: show the ready thumbnail with “Loading larger image…”, swap only after successful loading, retain the thumbnail on failure, and reuse the loaded image node for display/cache. Shared native images keep their original position.

Version 2.7.3 hardens storage failures, preview ownership/Unpin, removed-row cleanup, repeated cache eviction, and slow original fallback. Supplied small-image URLs use the small queue even without a thumbnail filename suffix; originals use the large queue and full-image deadline. See [the acceptance matrix](TEST-MATRIX.md) and [audit results](QA-REPORT.md).

The requested projects contribute Empornium functionality. Additional scripts inform the result tools; all adapters target Empornium.

| Reference feature | Integration |
| --- | --- |
| Tag/title/uploader blacklists and whitelists | NSE 2.8.2 engine with original matching and settings formats |
| Hard Pass and Black Hole | Original engine; removed results also hide matching collage cards |
| Individual hide/show/reset, filter-all, toggle hidden | Original engine; unique controls for new rows |
| Anonymous, reported, warned, unseeded and activity filters | Original engine with whitelist bypass options |
| Highlights and explanations | Original engine; settings and title fragments escaped in HTML |
| Right-click tag/uploader management | Delegated handler supports new rows; Shift preserves browser menu. Titles keep the native menu; title phrase rules live in Filters |
| Detail-page tag/highlight behavior | Original engine with optional-node guards |
| Notification filter imports | Original engine |
| Default/legacy/edgy/baked/dark purple/custom themes | Original engine; validated colors/fonts and scoped CSS |
| Custom CSS, icons, fonts, visibility toggle, auto-scroll, update notices | Companion appearance, toolbar visibility control, and shared notices; custom CSS retained |
| Open all unfiltered and optional next page | Explicit user button action |
| Top 10 renumbering and category hiding | Original engine, plus dynamic row support |
| Arrow navigation | One scope selector: off/results/site; handler guards typing, modifiers, composition and popup focus |
| Optional Russian Roulette and April 1 behavior | Original options and defaults |
| NSE save/deduplication/multi-tab merge/statistics | Original data semantics, automatic persistence, live results and statistics |
| NSE import/export/reset | Namespace isolation and validate-before-write import |
| mc-hamster's result backfill | Toolbar action, five pages per click (configurable 1–15), duplicates skipped, existing filters/Show filtered preserved, numbered-pager fallback, included-page markers and Next advancement |
| Direct thumbnails and progress | Automatic preparation throughout the current result list, distance priority, small-image lane, direct DOM loads and ready-count progress |
| Title/category placement and category keep/overlay/remove | Advanced settings → Image behavior; title fallback when the category column is removed |
| Small/full thumbnails | Small-first/page-preview/original sources; bounded guessing and immediate error fallback |
| Empornium list pages | Search, Top 10, collage, notifications and uploaded lists using overlay data |
| Saved-search title/date/alphabetic list/keep-open | Saved names always visible in the primary interface; legacy keep-open flags do not hide them |
| Restore and submit | Click a saved name to navigate directly to results using allowed GET fields |
| Append without submitting | Add to site search form; reveal merged text/tags/categories and saved choices for other options, then offer Search now |
| Delete | Delete plus Undo |
| Additional search features | Full form capture, contextual Edit search with explicit Save/Cancel, Rename, multi-tab re-read and unified backup |
| Collapse duplicates / coalesce variations | Independent conservative title parser; original rows grouped in place, existing order and per-version controls retained; loaded/backfilled results only |
| Emp++ / Luminance tag highlighting | Favorite and Caution lists in the existing Filters panel/menu, positive search-term emphasis, unified precedence with existing visibility rules, backup and Undo |

Additional media behavior includes persistent URL retry budgets, stale-response guards, first usable progressive/animation frames, failed legacy resize fallback, CSS cover handling, untouched hidden-gallery sources, responsive sizing, optional compact mode and local diagnostics. There is no jQuery dependency, execution of overlay JavaScript or bulk HEAD probing.

Version 2 removes the separate NSE panel, saved-search drawer placement and floating EP/eye buttons. Every visible preference lives in one workspace. Context menus and per-row controls use its styling and keyboard behavior. The filtering implementation remains a credited internal engine.

Version 2.1 removes the Save/Apply/reload cycle, adds preference Undo, quick save/run search controls, thumbnail hover, stable media settings, immediate restore, bounded automatic image recovery, and quieter status. Routine image settings are reduced to four controls; technical tuning is collapsed.

Version 2.1.1 prepares the whole current result list without a scroll trigger, prioritizes visible/nearby rows, resumes newly revealed queued results, and pauses new thumbnail requests in background tabs.

Version 2.2 restores the backfill contribution from mc-hamster's fork, adds Stop and retry from the failed page, and imports/exports its preferences. New rows use the same filter/media controllers and retain preview data without executing fetched scripts.

Version 2.3 adds immediate inline hover enlargement with an image-only view, mouse-off dismissal, and click-to-pin controls from either the small or enlarged image. The usable thumbnail is enlarged while the larger image loads. Keyboard/touch access and title-hover behavior are retained.

Version 2.4 places saved names in a permanent primary row when searches exist. Each shortcut runs the saved search and reloads results immediately, including from pages without a search form. The former Fill/Append actions become Edit search form/Add to search form, reveal collapsed fields, focus the relevant input, and show feedback plus Search now. Shortcut changes follow saves, renames, deletion/Undo, imports and other-tab updates.

Version 2.5 reduces navigation to Filters, Searches and Settings. The default Settings view has two controls, and the default Filters view has two tag fields. Other filters carry counts in collapsed headings. Advanced settings groups retained options and provides search without changing their values. Saved names and available backfill remain primary; management actions move under More, and obsolete drawer flags no longer reopen management. Empty filtered-result actions and exhausted backfill buttons stay out of the toolbar.

Version 2.6 replaces the saved-search edit action with a prefilled editor inside its row. It reads the saved data directly, retains fields missing from the site's form, and keeps the management panel/page/site form unchanged. Save updates the saved record and shortcuts; Cancel preserves it. Drafts survive unrelated redraws, and storage errors or conflicting same-search changes are shown in place. Explicit Add to site search form remains available as a separate advanced action.

Version 2.7 adds automatic alternate video grouping and richer tag highlighting within the existing interface. Matching removes recognized technical descriptors while retaining release identity and category boundaries. The first eligible row stays in the current result order; other versions expand beneath it, preserving their own tags, warnings, bookmarks, links and controls. Live filters promote an eligible representative and retain expansion state. Hard Pass restoration and disabling grouping restore original row positions. Backfill deduplication still sees every original torrent ID. Collapsed versions defer their thumbnails, and Open visible results follows the expanded display.

Favorite and Caution are exclusive visual preferences with Caution taking precedence for overlapping manual entries. Existing blocked/Hard Pass colors retain priority. Positive current-search tag terms get an additional underline; negative terms are excluded. Wildcard matching uses literal segments, with no regular-expression execution. Highlights cover list and detail tags and dynamically added results. The same contextual menu presents visibility rules and highlight-only actions, including keyboard access. New lists are folded in Filters; grouping has one Advanced opt-out. Settings retains two common controls and the toolbar retains three task areas.

Version 2.7.1 reduces repeated CPU work with local media mutations, coalesced subtree scans, batched engine/health updates, indexed tag changes, cached group expansion and fewer scroll observations. Long tables preserve their measured column proportions, and visual tag choices retain text dimensions. Bench instrumentation remains outside the release bundle; controls and saved-data formats remain compatible.

Version 2.7.2 restores the usable inline image on each new hover session, including a return to the same thumbnail after cancellation. An open preview can still hand off its image/request to pinned controls. Completed originals keep using the existing cache, and repeated dismissals preserve retry budgets without extra page scans.
