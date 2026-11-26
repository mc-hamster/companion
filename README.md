# Companion

Make Empornium easier to browse with image previews, filters, saved searches, and more results on one page.

**[Install stable Companion](https://raw.githubusercontent.com/mc-hamster/companion/main/dist/EmporniumCompanion.user.js)** · **[2.16.13](dist/EmporniumCompanion-2.16.13.user.js)**

Companion is a small add-on that runs through [Tampermonkey](https://www.tampermonkey.net/) in your browser. You'll need your own Empornium account.

## What you get

- **Preview before opening.** See thumbnails beside results and hover over them for a larger image. Click a preview to keep it open.
- **Browse in a grid.** Switch to thumbnail cards. Open an image preview to see a larger version. Choose card width in Settings or Getting started.
- **Filter and recognize results.** Filter by tags, titles, or uploaders. Highlight tags with named colors and browse results in a category.
- **Less clutter.** Similar releases are grouped together. Choose **Show versions** to compare them.
- **Your searches, one click away.** Save a search and run it again from the toolbar.
- **More results without page hopping.** Add the next few pages to your current search or collage, or let Companion load them automatically.
- **Fewer repeated image downloads.** Companion saves supported images in your browser for reuse and retries images that have trouble loading.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. Click **[Install Companion](https://raw.githubusercontent.com/mc-hamster/companion/main/dist/EmporniumCompanion.user.js)**, review the permissions, and choose **Install**.
3. Sign in to Empornium and open a torrent results page. Look for the **Companion** toolbar above the results.
4. Follow **Getting started** to choose your thumbnail size, previews, detail layout, and whether to load extra pages. You can change these later in **Settings**. **Reformat details** is also in the detail toolbar.

Already using Companion? Use **Check for updates** on your installed script in Tampermonkey to get the rename and keep your settings. Use the install link for a fresh copy.

To install a shared `.user.js` file, open **Tampermonkey Dashboard → Utilities → Import from file**. Choose the file, confirm **Install** or **Update**, and reload any open Empornium tabs.

If you use older scripts for the same features, back up their settings first, then disable them so you don't get duplicate controls. Companion can import NoShitEmpornium filter backups, including backups from mc-hamster's fork.

## Start browsing

**Filters** lets you choose what to hide or highlight. Most changes save automatically. Turn on **Show filtered** beside Settings to reveal hidden results in the current Freeleech view. To see only hidden results, choose **Settings → Browsing → When Show filtered is on → Show filtered only**. The toolbar switch becomes **Filtered only**, and Companion remembers it across result pages.

Open **Filters → Freeleech** to switch between **All results**, **Any freeleech**, and **Sitewide only**. Select the active filter chip to return to all results. Bookmarks remembers its own selection.

In **Filters → Conditional rules**, choose **Add a rule** to combine tags, titles, and uploaders. **Filters → Seen & Ignored** lets you show, dim, or hide torrents you have opened and undo individual seen or ignored entries. [Filter examples](docs/REFERENCE.md#freeleech-conditional-rules-and-seen-history)

**Searches** manages your saved searches. Run a search on Empornium, then click **Save search**. Its name appears below the toolbar; click it whenever you want to run that search again.

**Settings** has the everyday choices: appearance, thumbnail size, hover previews, version grouping, and extra pages. Use the search box to find a setting, or **Getting started** to walk through setup again.

Enable **Use keyboard shortcuts** during setup, or find the toggle and key mappings under **Settings → Advanced settings → Keyboard & menus**.

Click **Grid** above the results to switch to thumbnail cards. **List** switches back. Open **View options** beside the layout switch to choose the card size, spacing, title truncation, tags, and details in Grid or the visible columns in List. Hover over a thumbnail or click its preview button to load the larger image. Use the versions button on a grouped card to open alternate releases. Your layout is remembered across visits.

Grid covers fill the card width. Set **View options → Spacing → Compact** to bring cards closer together. Use **Animated Covers** beside **Show filtered** in the toolbar to play covers as they come into view. The switch starts off and saves one preference for both List and Grid. List playback shows inline covers. Companion preloads covers using its image cache and respects your system's reduced-motion preference.

Hover over, focus, or tap the small gauge beside the Companion name to see load progress for thumbnails, cover playback, previews, other images, and additional result pages. The percentage counts finished items. The breakdown separates ready, partial, and failed loads and marks tasks whose totals are unknown.

Grid titles show up to two lines by default. Turn off **View options → Truncate titles** to show full titles. Stats, uploader, and category information are hidden by default. Enable **Settings → Appearance → Show details in grid cards** to display them.

Open **Tags** on any Grid card to see its tags and assign highlights. Use **Settings → Appearance → Show tags in grid cards** to keep tag lists open. Right-click a tag and choose **Highlight as**, or open **Filters → Tag highlights** to edit categories and browse their matches among loaded results.

To add more results yourself, click **Load more** below the results. This brings the following pages into the page you're viewing. **Stop loading** stays visible while pages load and keeps the results already added. For automatic loading, look under **Settings → Browsing → Load more pages**.

To curate a collage, open it and click **Pin for quick add** in the Companion toolbar. Open a torrent's details page and click **Add to [collage name]**. If you pin several collages, use the selector next to the button to switch destinations. You can unpin a collage from its own page.

On a torrent detail page, turn on **Reformat details** in the Companion toolbar for a gallery that starts with the cover. Expand **File list** below Tags to see the files. Hover for a larger preview or click to open the image viewer. Turn off **Reformat details** to return to the original page. Companion remembers the switch for other detail pages.

## Forum

On a forum page, flip **Enable in forum** directly in the Companion toolbar. Use **Boards**, **Unread**, **Subscriptions**, and **Search** on the toolbar to navigate the forum. In an enhanced thread, **Topics** opens a compact list of topics in the current board.

On a topic page, turn on **Threaded view** in the toolbar to nest replies beneath the posts they quote on that page. Deep replies share an indent and have an **In reply to** link that jumps to the post they answer. Posts without a single identifiable parent stay in the main list. Turn the switch off to return to chronological order. Companion remembers your choice.

Open **Settings** on the toolbar for color theme, post text size, and long-quote folding. **Match site** follows the forum's light or dark theme. **Post link** opens the permanent link to an individual post, and awards appear beside the author's avatar.

On a thread, use the floating control for **Top**, **Bottom**, **Unread** when available, or **Reply**. **Bottom** jumps to the end of the current page. Use **Quote** on a post or select an excerpt and choose **Quote selection**.

Choose **Compact**, **Wide**, or **Full** in the reply window. **Minimize** saves your draft and tucks the window away. **Cancel reply** closes an empty reply and asks before discarding a draft. Companion remembers the window size. Drafts save in this browser per site, account, and thread. When two tabs have different drafts for the same thread, each tab restores its own draft after a reload.

**Visual** supports fonts, sizes, alignment, links, images, video links, tables, anchors, spoilers, site smilies, and post labels. On narrow windows, scroll a toolbar row sideways to reach more commands. The color picker offers a palette, custom colors, and recently used colors. Select a table, row, or cells to reveal their formatting controls. Use **BBCode** for the full native toolbar and exact source editing. **Preview** uses Empornium's renderer so you can check your formatting before posting.

**New Topic** and **Edit post** also offer Visual and BBCode editing for the body. Use the site's **Preview**, **Create thread**, and edit controls to finish. Topics, replies, and post edits share the same image picker.

The first time you open **Image → Upload**, Companion walks you through connecting Hamsterimg. Choose **Connect Hamsterimg** to open setup in a new tab. Sign in on the Hamsterimg tab and choose **Use displayed key**, or paste the key you saved earlier. The key is stored locally for your forum account and excluded from backups. Back in the forum, choose files or drop or paste images into the editor to upload and insert them. **Recent uploads** shows images uploaded through Companion, **My images** opens the signed-in Hamsterimg library, and **From URL** accepts an existing image link. In BBCode mode, these choices are under **Add images**.

## Updates and backups

Tampermonkey can keep Companion up to date when its update checks are enabled. To update manually, find your installed script in the Tampermonkey dashboard and click **Check for updates**.

Your preferences, saved searches, and saved images stay in your browser. Before changing browsers or reinstalling, save a backup under **Settings → Backup & restore**. Backups include your settings and searches, while saved images stay in your browser. Backups made before the rename still import here.

Moving from an older script? See the [import instructions](docs/REFERENCE.md#import-data), including how to bring over saved searches.

## Need help?

- **Nothing appears above your results?** Check that Tampermonkey and Companion are enabled, then reload the results page. Chrome may also need **Allow User Scripts** enabled; follow [Tampermonkey's instructions](https://www.tampermonkey.net/faq.php?q=Q209).
- **The install link shows code instead of an install button?** Follow [Tampermonkey's manual installation guide](https://www.tampermonkey.net/faq.php?q=Q102).
- **An image still won't load?** Try **Retry** if it's offered. Companion can't restore a deleted image or fix an image website that's offline.
- **Two thumbnails beside each result?** In Tampermonkey, keep one copy of Companion enabled and disable any separate thumbnail script, such as **whatcd gazelle direct thumbnails**. Reload the results page.

[Report a problem](https://github.com/mc-hamster/companion/issues) with what you were trying to do, what happened, and your browser and Companion version. Leave out account details and private links.

---

[Detailed reference](docs/REFERENCE.md) · [Developer instructions](docs/REFERENCE.md#development) · [Publishing](docs/PUBLISHING.md) · [Testing notes](docs/QA-REPORT.md) · [Credits](THIRD_PARTY.md) · [License](LICENSE)
