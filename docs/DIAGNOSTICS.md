# Findings and limits

The user uses Chrome without preview extensions. Stuck hovers show text and a blank picture. Earlier read-only site observations established:

- Native popups lacked loading/error/retry states, could extend below the viewport and were difficult to interact with.
- Cold animation metadata could arrive before the final load event.
- Legacy resize/250 and resize/350 URLs repeatedly failed while the provided original image worked. The fallback is therefore limited to recognized Empornium image hosts.
- Body images could load late and cause major layout growth.
- Collage covers were CSS backgrounds.
- One detail page held 123 intentionally hidden data-src images; these should remain unrequested until reveal.
- Some failed image elements were already complete with zero natural width.

Implementation/browser testing also caught a global NSE rule hiding every section, a popup intercepting thumbnail clicks, and stalled offscreen images losing their elapsed state. These were corrected and regression-tested.

Version 2 investigation found a script-imposed bottleneck: original-sized inline sources and a two-slot scheduler. The live page's 50 overlays all pointed to originals, including seven GIFs. Small-first selection and separate scheduling lanes address that bottleneck. The user interface is now one workspace rather than visible reference-script panels. See [the performance methodology](PERFORMANCE.md).

The observations establish concrete broken resize paths, but do not prove one network cause for every intermittent Chrome failure. Missing assets, image-host outages, browser caches and blocked requests remain possible.

The controller uses image dimensions, load/error events and timeouts. Cross-origin image events do not expose HTTP status codes, and slow status is not a byte percentage. Native transfers may start before userscript observers run.

Large originals and animations remain expensive. Cache targets cover idle scheduler entries, not all tab memory. The script does not transcode or proxy images, and does not eagerly open galleries.

Repeated hovers cannot replenish the retry budget. Native failures count toward recovery attempts. Explicit retries have a cooldown.

The script displays usable animation frames without waiting for decode, which waits for animation frame data. See the [HTML decoding algorithm](https://html.spec.whatwg.org/multipage/embedded-content.html#dom-img-decode).
