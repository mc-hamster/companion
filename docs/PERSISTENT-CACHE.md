# Saved image files

Version2.10.0 adds actual image-byte persistence across navigation, refresh and reopening the site in the same browser profile and site origin. The former MediaPool cache was tied to the current document. The new saved-file layer is independent of that short-lived decoded-image layer.

## Scope and retention

Managed inline result thumbnails and collage Cover Art use the saved-file cache. Supported static hover originals and static original fallbacks also participate. Fully received thumbnail formats are stored without re-encoding; animated thumbnail files preserve their bytes. Large animated originals remain on native image loading to preserve progressive/animation behavior. Ordinary native page content, unknown image hosts and access-restricted images retain native loading rather than introducing wildcard or cookie permissions.

Image files have **no timed expiry**. Default capacity is512MB, adjustable from32MB to2GB in Settings → Advanced settings → Loading & recovery. Previews/larger files are removed first when that byte allowance or browser quota requires space; small thumbnails are removed only as a last resort. A50,000-file safety limit and64MB per-transport payload ceiling bound extreme cases. Byte accounting excludes browser metadata overhead. The existing memory allowance stays24 idle entries/48MP; a memory eviction does not remove the saved file. Browser/site-data clearing, private-session rules and browser storage eviction can remove saved files; no persistence permission prompt is requested.

Clear saved images removes this cache's database contents. Images already displayed stay visible. Pending saves from the clearing page cannot resurrect old bytes; other open pages/new requests can fill the cache again. Disabling Remember images between page loads stops saved-file use/writes without automatically deleting existing files. Image bytes are not included in configuration backups or uploaded/synced by this feature.

## Loading and performance

A needed image is looked up by canonical source URL; only the script's own retry token/hash is removed. Other query parameters remain significant. Hits read one Blob and display an asynchronous data URL, with no image-host request. Misses at supported public hosts use one manager request, then display those same bytes. Only successfully decoded images are committed. The shared scheduler still bounds admission/retry/host pressure. Cached decoding does not train image-host performance. No full database of image bytes is loaded at startup.

In automatic thumbnail mode, a collage cover can reuse a saved resize supplied by its matching row, including Empornium's 300 px cover and 350 px row variants. Cached image reads can start while usage statistics are still initializing.

Images, metadata and totals are updated transactionally. Last-use metadata is batched after cache hits, and writes are serialized per page. LRU uses a database index; quota errors prune older cache data and retry a write once before falling back. There is no timed-expiry sweep or background polling. Large storage work and data-URL conversion use asynchronous browser APIs. Failed/corrupt cached images fall back to the original URL; CSP-denied data display falls back without weakening page policy. Navigation explicitly aborts manager transfers for outgoing documents while preserving BFCache documents. Successful variant URL hints flush before navigation.

## Access and security boundaries

The update declares GM_xmlhttpRequest plus these connection domains: hamsterimg.net, hamster.is, empornium.sx/.me/.is/.ph, and emparadise.rs. Their subdomains are covered by manager semantics. Requests are GETs for validated image URLs, anonymous, without supplied cookies/credentials, with redirect rejection. Legacy HTTP image URLs are upgraded for privileged transport; a plaintext final reply is rejected. There is no @connect wildcard, cookie API, torrent download API or remote executable dependency. Unknown/unsupported requests keep the browser's normal loading path.

Tampermonkey documents [blob responses, anonymous requests and redirect controls](https://www.tampermonkey.net/documentation.php?q=GM_xmlhttpRequest) and [declared connection permissions](https://www.tampermonkey.net/documentation.php?q=connect). The underlying browser store is [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase). Actual manager permission/sandbox behavior remains unverified in the disconnected user Chrome profile.

## Validation

The250-check suite includes20 new cache/security/lifecycle regressions: reopening without expiry after a simulated400 days; network miss/hit; LRU/replacement/byte totals; concurrent writers; quota and storage errors; clear generations; corruption/native fallback; late callback/abort containment; HTTPS/host restrictions; manager metadata; missing small/static fallback; navigation cancellation/BFCache; and immediate variant hint flushes. fake-indexeddb6.2.5 is a test-only dependency, absent from the installable.

Native Chromium with real IndexedDB and a mock manager transport displays8 inline/cover thumbnails and a960px preview after navigation/refresh with the image server blocked. The server log remains4 original small-image requests and1 original-image request. Product Settings clearing reaches0 stored bytes while8 existing images remain visible. A restrictive image CSP falls back to8 ordinary images. Real browser quota exhaustion and actual Tampermonkey grants are separate pending checks.

- [Full regression](qa/2.10.0-full.xml)
- [Native navigation/reload/clear/CSP observations](qa/persistent-cache-2100-browser.json)
- [Acceptance matrix](TEST-MATRIX.md)


## Thumbnail-first policy, version2.10.1

The file layer now distinguishes known thumbnails from previews. A known thumbnail at most512KiB receives priority over every preview and over larger thumbnail files. Within each priority group, least-recently-used files go first. An image already known as a small thumbnail retains that role if it is also opened in a preview. This policy concerns saved files; the existing decoded-memory and connection limits are unchanged.

Before storing a low-priority file, the cache checks protected thumbnail bytes. If the candidate could not fit even after every low-priority file was removed, it is declined without flushing other useful files. A verified replacement of the same URL can invalidate that URL's old data to avoid stale content. Quota cleanup for previews never removes protected thumbnails, and exhausted preview writes do not disable later thumbnail saves. Reducing the overall budget or filling it with thumbnails can still evict the oldest thumbnails as the last resort.

Databasev2 adds an indexed priority/last-use ordering and transactional thumbnail-byte accounting. Upgrade touches metadata only; existing image Blobs remain intact. Because old records do not identify their role, old small files are conservatively retained based on byte size; later known-role reads refine the metadata. There is no periodic scan, new setting or added permission.

The257-check suite includes7 new priority/admission/migration regressions. Native in-app Chromium preserves8 existing thumbnail views with the server blocked after upgrade. A fixture-only3000-byte cap then demonstrates:4 thumbnails plus a preview fit; an oversized preview is rejected without losing them; a fifth thumbnail evicts the preview and leaves all5 thumbnails stored. Actual quota exhaustion uses deterministic model faults rather than filling the real browser disk.

- [2.10.1 full regression](qa/2.10.1-full.xml)
- [Native priority and migration observations](qa/thumbnail-priority-2101-browser.json)


## Usage summary in Settings, version2.10.2

One Image cache card is visible in Settings without opening Advanced. Two rows show thumbnail and preview file counts with their stored byte sizes. A total/limit line and one activity line complete the card. Counts represent unique saved files across this browser/site cache, not copies displayed in multiple locations. Known thumbnail use wins when the same file is also previewed; large thumbnail fallbacks still count as thumbnails even though they have lower eviction priority. Legacy roles use the existing byte/tier inference until their use is known.

Activity is labeled **This page** and resets on navigation/reload. Hits include ready memory reuse and successfully decoded saved-file reuse. Downloads count successfully decoded manager-fetched images, including images that could not be retained for space reasons. Metadata/statistics reads, failed transfers, and browser-native fallback traffic are not counted. The activity line's tooltip states the scope. Clearing saved files changes stored totals, not the page's historical activity. These counters are not persistent analytics.

Schema3 computes role counts/bytes from metadata on upgrade without reading or deleting image Blobs. Writes, replacements, role changes, eviction, deletion and Clear maintain counters transactionally. The card reads those counters on opening, and cache changes from the current page coalesce while visible. Closing/switching Settings invalidates pending reads and cancels the one pending refresh. There is no background polling, automatic full-cache scan or metric-write stream; other-tab changes appear on the next snapshot.

The265-check suite includes8 new summary/UI/metrics cases. Native real-IndexedDB checks verify cold download counts, live preview downloads and memory rehover hits, reset-on-reload/saved-byte hits, Clear and a360px-frame layout (card286px, no horizontal overflow). [Browser observations](qa/cache-usage-2102-browser.json), [full regression](qa/2.10.2-full.xml).


## Cumulative usage and Reset stats, version 2.10.3

The Settings activity line is now **Cumulative**, replacing version 2.10.2's page-only counters. It retains hits and successful managed downloads across navigation, refresh and tabs within the same browser/site origin. Tracking begins with this version or the latest reset; older page-only history cannot be reconstructed. Metric definitions above remain unchanged, including the exclusion of failed transfers and native fallback traffic.

**Reset stats**, beside the Image cache heading, clears only the usage history. All saved thumbnail/preview files and their size/count totals stay intact. **Clear saved images** removes files while preserving history. There is no additional preference or confirmation step for resetting these diagnostic counters.

Schema 4 adds a tiny activity journal; upgrading from schema 3 does not scan image metadata or Blobs. Events coalesce for 500ms. A write-only journal transaction starts synchronously on pagehide when the database is ready, so a later page can replay a committed batch even if compaction was interrupted. Atomic compaction combines tab contributions exactly once. A reset generation rejects older batches; BroadcastChannel informs other open pages to discard pending pre-reset activity and refresh an open card. Failed writes preserve pending deltas without an automatic retry loop. Batched storage cannot guarantee the final uncommitted events after a browser/process crash.

Opening Settings reads compact totals, without loading image Blobs. Current-page changes coalesce while visible; closed Settings does not poll. Other-tab additions appear on the next snapshot; resets also notify open cards. No network requests or new userscript permissions are added by usage tracking.

[276-check regression suite](qa/2.10.3-full.xml), [native two-page/reset observations](qa/cumulative-usage-2103-browser.json), [Settings screenshot](qa/cumulative-usage-2103.png). Actual manager sandboxes remain unverified.


## Misses and rolling windows, version 2.10.4

Settings keeps the saved-file counts and byte usage, with one compact activity table underneath. Rows are the last **5 minutes**, **15 minutes**, **1 hour**, and **All history**. Columns are **Hits**, **Misses**, and **Downloads**. Reset stats clears every row and keeps image files; Clear saved images keeps all activity history. All history means since cumulative tracking began or the last reset, within the same browser/site origin.

A miss counts a managed lookup that cannot provide a usable saved image. It is recorded before the transfer and remains a miss if the transfer fails or falls back to native loading. Unusable saved bytes also count a miss. Forced bypasses, disabled/unsupported caching, inspections of metadata/files, and reads canceled before a lookup finishes are excluded. A successful managed transfer increments Downloads after image decode, independently of whether its bytes can be retained. Ready memory reuse and decoded saved bytes increment Hits. Shared pending consumers do not duplicate lookups; retries that actually perform another cache lookup can add a miss. Native transfer bytes are not measured.

Recent activity is stored in 5-second buckets, retaining at most 721 buckets covering roughly the latest hour. All-history scalar totals have no timed expiry. Five-second precision means an event can remain in a recent window for up to approximately five extra seconds at its boundary. No individual browsing-event log or image data is added to metrics. Existing journal batching, atomic compaction/replay, reset generations and failure recovery also cover misses and buckets. Recent storage remains bounded after long activity or a write failure.

Database schema 5 fences older tab writers that cannot preserve these new fields; existing image files and hit/download totals survive without a Blob or metadata scan. Pre-update totals are retained in All history, but cannot be assigned invented timestamps or miss counts. A short note explains this when old history exists. Reset starts a complete new history and removes that note.

Settings reads a snapshot on opening and after local cache changes. Recent values age every five seconds from that snapshot only while visible, with no repeated database reads. Unchanged values are not rewritten to the DOM. Closing/hiding Settings cancels the clock; reopening/foregrounding refreshes the snapshot. Other-tab activity appears on the next snapshot; a reset also notifies open cards. The clock stops once all recent buckets have expired. No new network request, userscript permission or configuration option is introduced.

[287-check suite](qa/2.10.4-full.xml), [controlled native clock/reload/reset/narrow-layout observations](qa/window-usage-2104-browser.json).


## Hit rate, version 2.10.5

A single Hit rate column appears between Misses and Downloads for all four periods. It is hits divided by hits plus misses, formatted as a percentage with at most one decimal place. Downloads are excluded from the denominator. No lookups means —; zero hits with one or more misses means 0%.

If preserved all-history totals contain hits from before miss tracking existed, their all-history percentage is unavailable (—). The existing note and cell tooltip explain the gap. Recent windows still show their valid rate. Reset stats starts a complete new history. This avoids treating missing historical misses as zero.

Rates derive from the current window snapshot and age/reset with its counts. No new stored metrics, schema change, database reads, image requests or timers are introduced. Auto-sized table columns preserve the five-column layout in the 360px fixture. [Native evidence](qa/hit-rate-2105-browser.json), [full regression](qa/2.10.5-full.xml).


## Estimated bandwidth savings, version 2.10.6

**Saved** adds one column to the existing table for 5 min, 15 min, 1 hour and All history. It sums each known encoded image payload size when the image is reused successfully. That includes decoded saved-file hits, ready memory reuse across request tiers, and title-hover reuse of an already loaded small thumbnail. Larger preview reuse counts that preview's payload size. A download by itself, inspection of stored metadata, failed/corrupt loads and canceled reads do not earn savings.

This is an estimate of image data reused, not measured wire bandwidth. Browser HTTP caching/request coalescing might already have avoided some transfers, and headers/compression/protocol overhead are not measured. Repeated reuse can therefore exceed the unique stored-file size. No network probes, Resource Timing assumptions or extra image requests are used to infer sizes.

Unknown sizes (including older hits and native-fallback images with no observed payload size) are not guessed from pixel dimensions. A window with only unmeasured hits shows —; a partly measured window shows ≥ followed by the known byte sum. A window with no hits shows 0 B. Header/cell tooltips explain the estimate and lower bound. Earlier hit/miss/rate totals remain intact.

The existing activity record adds savedBytes and sizedHits scalars plus two fields per 5-second bucket. Schema 6 fences old writers so they cannot discard the new metrics; existing images and counters remain. Migration does not scan image Blobs or reconstruct nonexistent historical sizes. Media entries retain only a numeric payload size after releasing the transfer Blob. No new permission, network request, scan or timer is introduced.

Savings use the same atomic journal/compaction, bounded hourly buckets and cumulative history. They survive refresh and concurrent writers, age from the visible in-memory snapshot, and reset with all other usage metrics. Clear saved images preserves savings history. [293-check suite](qa/2.10.6-full.xml), [native thumbnail/preview/reload/reset/narrow observations](qa/savings-2106-browser.json).


## Settings location, version 2.11.0

A compact total/limit summary stays on the main Settings surface. Expand **Image cache → Statistics & storage** for file counts, all four activity/rate/savings windows, Reset stats, persistence/limit controls and Clear saved images. No metrics were removed or reset by this layout change. The aging clock runs only while the statistics disclosure is open; metadata snapshots still keep the visible total current.

## Saved thumbnail variants, version 2.11.1

Small-first thumbnail requests check their remaining candidate URLs in saved storage before attempting the preferred URL on the network. This lets collage cover backgrounds reuse a saved small variant or original fallback even when their supplied legacy resize URL is unavailable and the short thumbnail-history list no longer contains the successful choice. A saved alternative produces a hit after decode, without a miss or another download. When no candidate is saved, the lookup records one miss and retains the normal network order. Forced retries bypass all saved candidates. Original-only preview requests retain their existing source selection.

Regression coverage includes a native-shaped collage cover with a missing 300px source and a saved small variant, correct source tracking and invalidation of corrupt alternate bytes, validated candidate destinations, and forced bypasses.

Validation: all 304 automated checks pass, together with the build and syntax checks. A neutral browser fixture using real IndexedDB and decoded image bytes loaded a saved alternate with 1 hit, 0 misses, 0 downloads, and no managed network request. Actual Tampermonkey sandbox behavior remains unverified.
