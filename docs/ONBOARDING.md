# Getting started and automatic backfill

Version2.9.0 shows setup once when no successful completion/dismissal has been saved. It waits for the page/filter interface and foreground visibility. Existing installations see current values, including arbitrary custom thumbnail widths; fresh profiles get the suggested3 additional pages. No automatic result fetching begins before setup is finished.

The native dialog introduces thumbnails, hover previews, filters, grouped versions, saved searches and extra result pages. It explicitly explains that these options—and much more—remain in Settings, with Settings → Getting started to reopen it. A visual size sample, hover/group toggles and a folded optional tag section keep routine choices short. Focus stays in the modal, actions remain visible while scrolling, and narrow layouts avoid horizontal overflow.

Start browsing/Save changes commit the draft through the existing validated import transaction. Completion (`ep.onboardingDone`) is part of the same rollback snapshot, so failed writes retain the draft and do not enable auto-loading. Not now keeps current preferences and records dismissal; Cancel on replay writes nothing. Completion is local to the installation; backup settings include `backfillMode`, but do not copy the completion flag.

## Loading modes

- `off`: no automatic loading; the manual Backfill results action remains available when backfill is enabled.
- `pages`: add N **additional** pages once per load, with N in1–15. Three is suggested for a fresh setup; existing page counts are preserved.
- `all`: follow all eligible remaining Next links, one request at a time. It is not limited by the N-page field. Large searches can consume more page memory; the UI explains this and exposes Stop.

Backfill still applies to supported `/torrents.php` result lists, not detail, request or collage pages. It preserves the current search, accepts only forward same-origin result links, deduplicates IDs/pages, applies existing filters, prepares only eligible images and advances the pager. Existing installations default to manual until explicitly changed. Existing legacy backfill enabled/count preferences remain compatible.

No new page fetch starts in a hidden tab. Between pages a visibility listener waits for foreground; Stop/dispose releases it. Work yields between pages for rendering/input. Temporary page failures receive two delayed retries (three total attempts), then stop. Stop, a permanent error or exhausted retries prevents another automatic batch on that page; manual retry remains available after any server cooldown. Reloading starts a new page session with the saved mode. In-flight responses are generation/abort checked before append, including immediately after foreground admission. There is no idle poller. Image concurrency remains governed by the shared adaptive host scheduler.

Owned row insertions/filter changes are batched to avoid a duplicate observer scan. Media/preview scanning touches new rows rather than rescanning all accumulated rows. Full grouping/filter summaries still refresh as each page joins the result set.

## Validation

The215-check suite includes fresh/returning/hidden startup, replay/cancel/preservation, invalid count, optional live tags, write rollback/retry, N/all/manual operation, beyond15 pages, one page request in flight, pause/resume, Stop/error/disposal, immediate admission cancellation, backups, append scan scope and artifact version consistency. Browser observations use neutral local fixtures and JSON-persistent GM mocks. Actual Chrome/Tampermonkey and Firefox remain unconnected.

See [test matrix](TEST-MATRIX.md), [JUnit](qa/2.9.0-full.xml), [native observations](qa/onboarding-290-browser.json) and [CPU results](qa/performance-800-290.json).


## Version2.9.1 page recovery

A successful added page is followed by a one-second pause before the next fetch. Network/body interruption and request timeouts, plus HTTP408/425/429/500/502/503/504, receive at most two automatic retries. Ordinary backoff starts at2s then4s, with up to25% extra jitter; HTTP429 starts at10s then20s. A valid Retry-After delay (seconds or HTTP date) is a minimum, never shortened. All waits use cancellable timers, not polling. Background visibility gates each attempt, and Stop/dispose releases pending waits. No requests run in parallel within a backfill batch. Server cooldowns remain in force across Stop/manual resume within the current page session; they are not a cross-tab or cross-reload coordinator.

After a permanent failure or exhaustion, the toolbar keeps completed pages, identifies the failed page and safe reason, and offers Open page in another tab. That link is derived from the already-validated same-search results URL. Response parsing, login/access failures and result-processing errors do not automatically repeat. No scripts, torrent downloads or arbitrary redirect destinations are executed/followed.

The original user screenshot and2.9.0 error message do not identify the actual response code. The old build reproduces the same two struck-through pages and generic page4 error when a503 is injected. The new build recovers the same six-page/260-row fixture; actual server timing shows503 retries after2.305/4.308s and a12-second Retry-After observed as12.501s. [Native evidence](qa/backfill-retry-291-browser.json). The full2.9.1 suite has222 passing checks. Actual Chrome/Tampermonkey remains unverified.
