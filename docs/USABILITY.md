# Usability pass — version 2.1

The default workflow is browsing. Previews, small-image selection, loading limits, recovery, and preference persistence run without opening configuration.

| Before | Now |
| --- | --- |
| Edit a preference, find Apply, then refresh for filters | Automatic save; current results update in place |
| Context-menu rule edit followed by a refresh | Results update after the choice |
| Import a backup, then use Reload | Preferences and controls become active immediately |
| Retry manually after normal image attempts fail | One fresh automatic attempt after cooldown or reconnection; no endless loop |
| Open Searches, enter a name, then save | Save search in the toolbar; infer a name and prevent duplicates |
| Open the library or a dropdown to run a saved search | Saved names are visible beneath the toolbar; one click loads the search and refreshes results |
| Editing a saved search switches to a separate site form | Prefilled editing in its saved-search row, with Save changes and Cancel |
| Click an inline picture before seeing a larger preview | Hover for an image-only enlargement; leave to dismiss; click for controls |
| Change thumbnail size and restart the media controller | Resize existing elements while retaining requests/cache |
| Browse image, font, color and technical preference lists | Two common display choices; searchable Advanced settings |
| See all rule fields and status checkboxes together | Two tag fields first; other rule groups show counts while folded |
| See every saved-search action on every row | Names stay visible; More exposes management actions when needed |
| See disabled actions that have no work to do | Filtered-result and backfill actions appear when relevant |
| See image-error counts from hidden results | Status focuses on relevant failures; routine success is quiet |
| Scroll into a row, then wait for its thumbnail | Prepare the current result list automatically, with visible and nearby rows first |
| Move between short filtered result pages | Backfill results adds following pages with one click and prepares their thumbnails |
| Restart a partially failed page batch | Keep completed pages and retry the failed page |

Typing is debounced for 550 ms. Completed changes and leaving a field flush edits. The active text field retains its exact draft, trailing separator, selection and scroll position while stored rules are normalized. Invalid values stay editable and do not partially replace filter lists.

Automatic saves keep one local preference checkpoint, coalescing edits within 30 seconds. Undo restores preferences and visibility overrides without deleting searches added afterward. It is separate from the pre-import snapshot.

Live filtering refreshes the existing engine settings, restores the page baseline, then reapplies rules. Removed Hard Pass rows retain insertion markers so they can return when rules change. Repeated updates do not duplicate icons, title wrappers or event handlers.

Search submission, opening result pages, downloading an exported backup, replacing data, and account-form changes remain explicit. Reset/bulk-action confirmations are retained. Copying rules into the site's notification form does not submit it.

Backfill is available directly in the toolbar when more pages exist, preserving the contributed feature's five-page default. Its limit and visibility preference are under Settings → Advanced settings → Backfill & result actions. During a batch, the same button becomes Stop backfill; stopping keeps completed pages and the next-page cursor. No result pages are fetched until the action is clicked.

Version 2.3 makes inline browsing immediate: pointer entry enlarges the existing image without a panel header or action row. The larger image loads through the same scheduler. The enlargement overlaps the original thumbnail, so the pointer can move onto it and click it without crossing a dismissal gap. Moving outside both images closes it immediately, including when a mouse click had focused the original button. Clicking either image pins the preview and reveals its controls; mouse-out then leaves it open. Keyboard focus exposes controls, and touch opens them with a tap. Pointer cancellation/window blur also clear transient enlargements.

Version 2.4 separates running a search from preparing a form. The primary saved-name row sits outside the management panel and appears whenever the library is nonempty; closing a panel or restoring an old drawer preference cannot hide it. Names wrap in the available width and navigate directly to results, with standard browser new-tab behavior. The search library remains available for rename/delete and optional criteria editing. Editing opens the site's collapsed form, focuses a loaded field, and shows a persistent explanation and Search now action. Shortcut visibility and names update immediately after library changes.

Version 2.5 applies progressive disclosure across the interface. The toolbar has three task areas and a plain brand label. Settings shows only theme and thumbnail width; technical media behavior, appearance customization and rare features are in a closed Advanced section. Its search reveals matching controls directly and restores the previous disclosure state when cleared. Backup & restore remains a separate section.

Filters initially shows blocked and allowed tags. Title/uploader rules, Hard Pass, status filtering and bulk actions are collapsed, with counts or Off labels that update as preferences change. Saved-search management initially shows names and More rather than a repeated row of buttons; choosing a name still runs the search directly. Panels no longer reopen from old saved-search drawer flags, and the automatic-save footer is confined to preference panels.

The layout does not add persistent accordion/search state. Existing rule lists and all custom advanced values remain active; tests verify that saving a common preference preserves them.

Version 2.6 keeps saved-search editing in context. The previous edit path cleared the site's form, restored only matching field names, and closed management. The replacement reads the stored search directly and renders an inline draft beneath the same saved name. It never clears/reveals the site's form, navigates, or scrolls to a different form. Name, populated criteria, and common text fields are visible; additional criteria are folded.

Save changes updates that search, preserves its identity/date, and refreshes its shortcuts while leaving the results page and Searches panel in place. Cancel/Escape close only the draft. Keyboard save is available, and text composition does not accidentally submit. Drafts survive panel switches and other library updates. A failed save keeps the edited values; conflicting changes are reported in the editor instead of silently replacing the other version.

Version 2.7 keeps version grouping contextual to results. A single Show/Hide versions button expands original rows beneath the first eligible release. It uses the page's current order and shows per-version metadata in its original columns. Dates, parts, studios, cuts and fixes remain separate identities; category boundaries are retained. Existing filters and backfill feed the same groups, and hidden alternatives wait to load their thumbnails until expansion. The opt-out is in Advanced settings → Results & backfill.

Tag highlighting extends the existing rule menu with a compact Highlight only section. Favorite and Caution each take one action; Clear highlight appears when a choice exists. Visibility actions use Block/Allow wording and occupy a separate section in the same menu. The two visual lists live in a folded Tag highlights section in Filters, with active counts and automatic saving. Positive search tags are emphasized automatically. Existing block and Hard Pass markings retain priority, and selecting a highlight leaves visibility decisions with those rules. Keyboard menu access and Escape return focus to the originating tag.

Tested on a neutral local fixture, not installed in the user's Chrome profile.
