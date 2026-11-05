# Empornium Companion

Make Empornium easier to browse with image previews, filters, saved searches, and more results on one page.

**[Install Empornium Companion](https://raw.githubusercontent.com/mc-hamster/companion/main/dist/EmporniumCompanion.user.js)** · Version **[2.12.3](https://raw.githubusercontent.com/mc-hamster/companion/main/dist/EmporniumCompanion-2.12.3.user.js)**

Companion is a small add-on that runs through [Tampermonkey](https://www.tampermonkey.net/) in your browser. You'll need your own Empornium account.

## What you get

- **Preview before opening.** See thumbnails beside results and hover over them for a larger image. Click a preview to keep it open.
- **Browse in a grid.** Switch to larger image cards. Thumbnails appear first, with an optional automatic upgrade to larger images. Choose card width and upgrades in Settings or Getting started.
- **Hide what you don't want.** Filter by tags, titles, or uploaders. Mark tags as favorites or cautions to make them easier to spot.
- **Less clutter.** Similar releases are grouped together. Choose **Show versions** to compare them.
- **Your searches, one click away.** Save a search and run it again from the toolbar.
- **More results without page hopping.** Add the next few pages to your current search or collage, or let Companion load them automatically.
- **Fewer repeated image downloads.** Companion saves supported images in your browser for reuse and retries images that have trouble loading.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. Click **[Install Empornium Companion](https://raw.githubusercontent.com/mc-hamster/companion/main/dist/EmporniumCompanion.user.js)**, review the permissions, and choose **Install**.
3. Open or reload Empornium. Look for the **Companion** toolbar above the results.
4. Follow **Getting started** to choose your thumbnail size, previews, and whether to load extra pages. You can change these later in **Settings**.

Already using Companion? Open the same install link to update your existing copy and keep your settings.

If you use older scripts for the same features, back up their settings first, then disable them so you don't get duplicate controls. Companion can import NoShitEmpornium filter backups, including backups from mc-hamster's fork.

## Start browsing

**Filters** lets you choose what to hide or highlight. Most changes save automatically. Use **Show filtered** to temporarily bring hidden results back without removing your rules.

**Searches** manages your saved searches. Run a search on Empornium, then click **Save search**. Its name appears below the toolbar; click it whenever you want to run that search again.

**Settings** has the everyday choices: appearance, thumbnail size, hover previews, version grouping, and extra pages. Use the search box to find a setting, or **Getting started** to walk through setup again.

Enable **Use keyboard shortcuts** during setup, or find the toggle and key mappings under **Settings → Advanced settings → Keyboard & menus**.

Click **Grid view** above the results to switch to image cards; **List view** switches back. Under **Settings → Appearance**, grid cards have Compact (240px), Balanced (320px), Large (420px), and Extra large (540px) sizes and an **Automatically load larger images in grid view** option. Larger images load after the thumbnail pass and keep the thumbnail visible if they fail. Both choices are also in Getting started. Your layout is remembered across visits.

Grid titles are limited to two lines. Stats, uploader and category information are hidden by default; enable **Settings → Appearance → Show details in grid cards** to display them again.

Tags are also hidden by default in grid view. **Settings → Appearance → Show tags in grid cards** controls them separately from the details block. Both choices are remembered; tag filtering and highlighting continue to work.

To add more results yourself, click **Backfill results** in the toolbar. This brings the following pages into the page you're viewing. **Stop backfill** stops loading and keeps the results already added. For automatic loading, look under **Settings → Browsing → Load more pages**.

## Updates and backups

Tampermonkey can keep Companion up to date when its update checks are enabled. You can also use **Check for updates** in Tampermonkey or open the install link again.

Your preferences, saved searches, and saved images stay in your browser. Before changing browsers or reinstalling, save a backup under **Settings → Backup & restore**. Backups include your settings and searches; saved images aren't included.

Moving from an older script? See the [import instructions](docs/REFERENCE.md#import-data), including how to bring over saved searches.

## Need help?

- **Nothing appears on Empornium?** Check that Tampermonkey and Companion are enabled, then reload the page. Chrome may also need **Allow User Scripts** enabled; follow [Tampermonkey's instructions](https://www.tampermonkey.net/faq.php?q=Q209).
- **The install link shows code instead of an install button?** Follow [Tampermonkey's manual installation guide](https://www.tampermonkey.net/faq.php?q=Q102).
- **An image still won't load?** Try **Retry** if it's offered. Companion can't restore a deleted image or fix an image website that's offline.
- **Two thumbnails beside each result?** In Tampermonkey, keep one copy of Companion enabled and disable any separate thumbnail script, such as **whatcd gazelle direct thumbnails**. Reload the results page.

[Report a problem](https://github.com/mc-hamster/companion/issues) with what you were trying to do, what happened, and your browser and Companion version. Leave out account details and private links.

---

[Detailed reference](docs/REFERENCE.md) · [Developer instructions](docs/REFERENCE.md#development) · [Publishing](docs/PUBLISHING.md) · [Testing notes](docs/QA-REPORT.md) · [Credits](THIRD_PARTY.md) · [License](LICENSE)
