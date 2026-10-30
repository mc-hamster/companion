# Retaining preview originals

This records the2.9.2 in-memory layer. Version2.10 adds [persistent saved image files](PERSISTENT-CACHE.md) across navigation and reload.

Version2.9.2 changes dismissal of thumbnail enlargements and preview controls: the UI closes immediately, but an original already requested remains queued/loading/retrying in the shared pool. No originals are requested merely by loading a results or collage page. Title-only transient work retains its existing cancellation policy.

When the last viewer unsubscribes, retained originals drop to low priority, release their hover/DOM eligibility callbacks, and continue with the normal large-image concurrency, host pacing and retry budget. New hover demand promotes its entry and outranks waiting retained work. Already-running transfers are not preempted; a new hover can wait when all large-image slots are occupied. Queued work waits while the document is hidden; already-started transfers can finish. Closing a popup does not leave its elapsed-status timer running.

Returning before completion subscribes to the same entry. Returning after completion adopts the cached image node, avoiding another source assignment/transfer. Completion has no UI subscriber after dismissal, and existing version guards protect a different open preview. A failed retained load gets the ordinary bounded automatic retries; it does not gain an unlimited retry loop.

The existing cache settings bound **idle** work: pending retained requests and finished idle entries count toward the entry allowance (default24), and known idle pixels count toward the megapixel allowance (default48MP). Visible/subscribed consumers are protected and are outside the idle cache budget. Ordinary idle thumbnail entries are evicted before explicitly retained originals, so finishing the rest of a page’s thumbnails does not cancel the user’s chosen image. Among retained originals, older idle entries can be evicted, including unfinished requests; such eviction refunds the currently active attempt and is not treated as an image-host failure. Large dimension metadata can trigger trimming before final completion. A rapid sweep therefore cannot create an unbounded retained queue. Navigation/rebuilding or disabling the media pool still disposes its unfinished requests and timers. Version2.9.2 did not persist image files; version2.10 adds the separate saved-file layer.

## Evidence

Eight new regressions cover same-request reuse/demotion, retries/visibility, foreground queue priority,40-item sweeps, memory limits/live consumers, shared requests/disposal, and stale UI/no page scans. The full suite passes230 checks. Existing tests that expected cancellation on mouse-out now expect a single continued original request.

Native Chromium checks use local neutral assets and mock GM APIs. The final build keeps a4.003s original transfer alive after mouse-out, leaves the popup closed, and rehovers at960px with one original request. List thumbnails also reuse a single original. A first503 followed by a4.006s success completes while closed and is reused. Candidate observations retain their scope/hash and the final scheduling-only review. Actual Chrome/Tampermonkey remains unverified.

- [Full regression](qa/2.9.2-full.xml)
- [Native hover observations](qa/retained-hover-292-browser.json)
- [Rendering observations](qa/performance-800-292.json)
- [Previous-release rendering control](qa/performance-800-292-control291.json)


## Rendering measurements

The800-row runs retain zero idle scans, zero global regrouping on image updates, and no idle/image-update/scroll long tasks. Image-update animation callbacks total4.7/4.5ms across122 callbacks versus4.3ms in a2.9.1 control. Interactive layout is not universally free of long tasks: group-toggle counts are1/1 in the new runs versus0 in the control; tag-change counts are1/0 versus1. Group callback time totals1.0/.9ms versus.6ms; six tag-refresh calls total16.6/16.7ms versus15.8ms. These observations do not isolate whole-browser paint/decoder CPU. The original and repeat data are preserved; there is no claim that all interaction frames are below50ms.

The rendering runs execute candidate21383534c6a8. The finalae0082fdcc73 change only ranks retained originals ahead of idle thumbnails during cache eviction; it does not change these idle/no-pool-work rendering paths. Final native hover checks are re-executed on the release artifact.

- [Repeated rendering run](qa/performance-800-292-repeat.json)
