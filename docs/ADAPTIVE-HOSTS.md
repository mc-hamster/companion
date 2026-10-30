# Automatic image-host pacing

Version 2.8.0, October 23, 2026.

The shared image scheduler now learns separate limits for each hostname and port. An unknown host starts with two small-image requests. Successful uncached small transfers grow its limit one slot at a time, after at least four good samples and longer windows at higher limits. A host never grows above six small requests; the overall small-image ceiling is eight for a fresh profile. Existing explicit ceilings remain in effect. Two ordinary large-image slots and one interactive slot remain globally reserved, so total scheduled work stays at most the configured small ceiling plus three.

Slower completions compared with that host’s latency baseline reduce its limit and delay further growth. No-progress stalls also reduce it. A stable change in serial response time can establish a new baseline after the cooldown, including during continuous traffic. Old completions from before a reduction cannot immediately undo it. Instant cache hits, cancelled requests, hidden-page and interrupted timing samples and late partial-image completions do not train growth.

Errors reduce capacity toward the last proven limit and briefly allow in-flight work to drain. Repeated errors from different assets extend that host’s cooldown; six distinct failures can pause it for 15 seconds. A constrained host shares its reduced allowance across thumbnails, original fallbacks and hover work. Hover retains global priority but cannot bypass a distressed host’s limit or cooldown. Healthy hosts continue independently. Existing per-image retry budgets and the single automatic rescue attempt remain bounded.

Native image errors do not expose HTTP status or Retry-After headers. The controller therefore reacts conservatively to generic load errors and timing; it does not claim to distinguish a missing image from HTTP 429. Controlled server logs supply exact status counts in the tests.

Learning requires no separate requests. Active lane/host counters replace repeated scans of all cached image entries. Host history is limited to 128 in-memory hosts and 32 persisted records, with a 24-hour expiry. Persistence stores only hostname, limits, latency and cooldown metadata—no image paths. Changes are batched, flushed on page exit, and advisory: a failed storage write does not interrupt loading. There is no idle host polling; queued cooldowns share one deadline timer, and pending history writes share one short batching timer. Existing active-image first-frame checks remain unchanged.

The interface adds no routine controls. The existing advanced setting is now labeled “Maximum concurrent thumbnails (automatic per host)” and remains an optional ceiling. Host pacing is per tab, with advisory history shared through userscript storage. It does not coordinate active work across tabs or know whether different hostnames share a backend. Native browser requests outside the scheduler remain outside these limits. Usable partial/animated images may also continue streaming after the scheduler releases their slot; these counters are not a complete browser network ledger.

An unknown host’s first page may finish more slowly while it proves capacity. Later pages reuse learned limits. The local tests cannot establish production image-host capacity or validate an actual Chrome/Tampermonkey sandbox.

## Verification

The current full regression suite passes 187 checks. Twelve new host-pacing tests cover growth, slowdown and stale results, host isolation, actual fallback destinations, cancellation, constrained-lane sharing, reserved hover capacity, partial/cache/background samples, live ceiling changes, cleanup, bounded/expiring history, failed persistence and sustained latency recovery. Earlier warming and fallback tests now account for conservative startup and brief host cooldowns.

The browser comparison uses 50 local PNGs per trial, default retries enabled, five profiles (single origin, responsive origins, slowing origins, rate-limited origins and one constrained origin among healthy ones), fixed six/eight baselines and automatic cold/learned starts. Three repetitions produce 60 trials. Callback timing covers selected main-thread work rather than total process CPU or image decoder threads. No production image host is stressed. The preserved 2.7.7 baseline is read from `/tmp/ep-companion-fixed-2.7.7.js`.

Final browser measurements and native hover/CPU evidence are recorded separately with the exact artifact hash.

## Final browser results

Artifact SHA-256: `574579cafbfe316601ed3a0602394214d88d121dbb0046d9bc1742221334f30a`. All 30 automatic trials loaded 50/50 images, with default retries enabled. Three repetitions per cell; last-image medians apply only to completed runs. Fixed-eight limited runs hit the 20-second deadline with only 12/50 ready.

| Local profile | Fixed six | Fixed eight | Automatic cold | Automatic learned |
| --- | ---: | ---: | ---: | ---: |
| Single HTTP/1.1 origin | 1.56s | 1.54s | 2.19s | 1.53s |
| Responsive origins | 1.53s | 1.21s | 1.20s | 1.21s |
| Slowing origins | 1.57s | 1.75s | 1.52s | 1.54s |
| Rate-limited origins | 1.56s | Incomplete: 12/50 at 20s | 1.81s | 1.54s |
| Mixed hosts | 1.56s | 3.02s | 1.79s | 1.56s |

Rate-limited automatic cold runs each made 53 image requests: three simulated 429s plus successful original fallbacks. Learned runs made exactly 50 requests with zero errors. Fixed-eight limited runs made 27 requests with 15 simulated 429s and stopped at 12/50 ready by the deadline. Mixed-host cold automatic runs had one simulated 429 each, then zero on learned runs; fixed eight had ten each. The controller cannot prevent the first capacity-discovery error or read HTTP status from native image elements.

Unknown single-origin loading is deliberately conservative: 2.19s versus 1.56s with fixed six, then 1.53s when learned. Its first six were ready in 535ms cold and 207ms learned, versus 219ms fixed six. These numbers do not predict live-host latency.

Learned callback medians ranged 33.3–40.9ms per 50-image page, versus 61.2–65.0ms fixed six. The timing sums selected animation-frame/MutationObserver callbacks, excluding total-process CPU, decoding threads and other handlers. All 60 trials recorded 0 Long Tasks. Runs use 42,157-byte 160×96 PNGs, unique URLs/no-store, 160ms normal delay and 500ms original fallback delay; slowdown and error thresholds are synthetic. Cold precedes learned, with three repetitions and no simultaneous regression-suite work.

The final 800-row / 16,000-tag benchmark retains zero idle scans, zero image-triggered global regrouping and zero steady-state Long Tasks. Image-update animation-frame callbacks total 4.1ms; a 50-row append retains one Long Task.

Native UI checks retain the small image during cancelled/re-entered hovers, display 960px only after success, retain 160px after failure, pin/Unpin, navigate ordinary cover links, and release replaced/removed views. Twenty-eight covers complete in 623ms cold and 413ms learned, with no originals before hover. All 50 list images warm at scroll zero in 1432ms; the explicit overall ceiling of six survives. Title hover remains a 160px tooltip.

The background transition regression was reproduced before fixing it: [two candidate failures](qa/adaptive-background-before.xml). Interrupted/background timing and watchdog expiry no longer train host slowdown, while actual image errors still back off.

[60-trial raw evidence](qa/adaptive-hosts-280.json), [187-check full suite](qa/2.8.0-full.xml), [native UI evidence](qa/adaptive-ui-280.json), [CPU evidence](qa/performance-800-280.json).
