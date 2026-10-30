# Attribution

## NoShitEmpornium

[Project](https://github.com/ceodoe/noshitempornium), copyright ceodoe 2015–2026. Version 2.8.2, commit 0acede6fe4a5c57c42df8a87020082122897bad8. Main Git blob: 75fd5dff4919ba07a3e7135a9ab86fb764cd427e.

GPL-3.0-or-later, per its source header. Original source/license are in vendor/noshitempornium. The main engine is incorporated into the combined GPL script, retaining its copyright and license notice. Internal version 2.8.2 is retained for migrations.

Build transformations isolate and validate settings, replace placeholder lists, validate imports before writes, escape HTML values, scope generic CSS, hide the generated legacy form, delegate context menus, unify keyboard Save/navigation, support dynamic rows, synchronize collage filtering, guard optional nodes, trim empty list entries and fix the disabled Hard Pass title-menu button reference. The source hash and integration anchors are checked before building.

In version 2 the generated engine DOM is internal infrastructure. Working form inputs are adopted into a native Companion workspace and keep their IDs for engine compatibility. NoShitEmpornium's public-facing panels and floating widgets are replaced, while its matching behavior and original attribution are preserved.

Version 2.1 adds generated setting readers/control mappings for live updates, reversible row archival, idempotent detail-title wrapping, automatic-save hooks, and managed custom CSS. Cosmetic zero-seeder text rewriting is removed to preserve native content during repeated updates. Original matching semantics and settings keys remain in use.

Version 2.7.1 batches initial/live/dynamic engine writes while Companion's observer is paused, then processes the final DOM explicitly. The engine's matching behavior and stored settings remain intact.

## mc-hamster's backfill contribution

[Fork](https://github.com/mc-hamster/noshitempornium), pinned commit [d4469512b08245f11beec35c53a1ed8f14f6b391](https://github.com/mc-hamster/noshitempornium/commit/d4469512b08245f11beec35c53a1ed8f14f6b391). Reference file Git blob: 62112c76ea18bde028ac055688475991569f02c4. GPL-3.0-or-later under the retained source header.

The fork adds three commits after the pinned upstream version: result backfill (de543e1645ad5f43c43c52da62c9f4e7965b0eb4), numbered-pager fallback (68632cf41bd1aa34536d9c89743cd4bab6f668f1), and preservation of the hidden-results toggle (d4469512b08245f11beec35c53a1ed8f14f6b391). The intact reference is in vendor/noshitempornium-backfill. The build verifies its blob hash.

Version 2.2 ports the contribution into Companion's toolbar and controllers: five following pages per click, a 1–15-page preference, duplicate-ID handling, filtering of appended results, preserved Show filtered state, included-page markers and Next advancement. The integration uses the existing filtering engine rather than the fork's duplicated filtering loop. Overlay definitions are parsed as data with unique names instead of replaying fetched scripts. Added behavior includes Stop, timeouts, same-search URL checks, partial-progress retry, empty-page termination and persistent preview metadata across media restarts. Legacy backfill preference keys remain import/export compatible.

## whatcd gazelle direct thumbnails

[Project](https://openuserjs.org/scripts/node/whatcd_gazelle_direct_thumbnails), by node, reference version 12. OpenUserJS lists MIT.

Thumbnail behavior was independently reimplemented. Its runtime source and unrelated-site adapters are not in the generated script. The research reference is not distributed in this repository or used by the build.

## empornium saved searches

[Project](https://github.com/ehfraim/emporniumuserscripts/blob/master/empornium_save_search.user.js), source author ephraim, version 4.2. Reference blob: f8746a2c487e407c587c3d786603f39c9d388b64.

No explicit license was found in the inspected file. Behavior and storage compatibility were independently reimplemented; none of its code is incorporated into the generated script. The research reference is not distributed in this repository or used by the build.

## Version grouping design references

[Collapse Duplicates](https://github.com/colligere/collapse_duplicates/blob/master/gazelle_collapse_duplicates.user.js), originally by node998 and maintained by colligere, reference version 27.3, Git blob 3b30aed6ba0cd76ae05318a627f05e9208fa34fd. Reviewed descriptor parsing, chronological placement, status preservation and duplicate-script guards.

[Coalesce Variations](https://github.com/ehfraim/emporniumuserscripts/blob/master/empornium_coalesce_variations.user.js), by ephraim, reference version 7.6.1, Git blob 40665416e5d315b61c9fb2d8cc735968be93f352. Reviewed resolution/codec extraction and row presentation. Companion keeps dates, studios and title word order in its identity and retains original DOM rows and handlers. It does not use the reference's character-sorted matching or synthesize replacement torrent rows.

Both are behavioral references for the independent implementation in src/result-tools.mjs. Their source and runtime dependencies are not incorporated into the generated script.

## Tag highlighting design references

[Emp++ Tag Highlighter](https://github.com/allebady/Tag-Highlighter/blob/master/Emp%2B%2B_Tag_Highlighter.user.js), by allebady, reference version 0.6.3, Git blob c94510d956edf53abff0057aa5db7dedb7feccdd. [Luminance Tag Highlighter+](https://github.com/xrt141/Userscripts/blob/main/Luminance%20Tag%20Highlighter%2B.user.js), by xrt141 and allebady, reference version 2.8.4, Git blob 1e6f91e4c22662884999dd27dc1f99d1f5749f6d.

Reviewed visual categories, priority, category deduplication and contextual editing. Companion independently implements two visual lists, Favorite and Caution, and current-search emphasis. Visibility remains with the existing filter engine; highlighting has no voting or account actions. Reference source, configuration panels, scoring bars, jQuery and unrelated-site adapters are not incorporated.

## Development dependency

jsdom 26.1.0 and fake-indexeddb 6.2.5 are MIT-licensed and used only for tests, not bundled into the userscript.
