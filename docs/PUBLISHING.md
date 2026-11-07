# Publishing Empornium Companion

Repository: `mc-hamster/companion`. Published branch: `main`.

The userscript runs inside each user's browser. GitHub serves the installation and update files; there is no application server, database, domain, or GitHub Pages setup to maintain.

## First publication

1. Run the validation commands below and commit the publication changes, including the generated files.
2. Push `main` to `origin`, which is configured as `https://github.com/mc-hamster/companion.git`. In GitHub Desktop, use **Push origin** after committing. Confirm the repository is public so others can install and receive updates without GitHub authentication.
3. Confirm the **Validate userscript** GitHub Actions workflow passes.
4. Open the install link in a browser with Tampermonkey. Check that it identifies the release version, shows the declared permissions, and offers installation. Reload Empornium after installation and confirm Getting started and the toolbar appear. Existing installations should retain their saved preferences when updated.
5. Share the README or the install link below. These links become available after the public repository's first push.

Install:

<https://raw.githubusercontent.com/mc-hamster/companion/main/dist/EmporniumCompanion.user.js>

Update metadata:

<https://raw.githubusercontent.com/mc-hamster/companion/main/dist/EmporniumCompanion.meta.js>

Source and instructions:

<https://github.com/mc-hamster/companion>

## Validation

Use Node.js 22.13+ and pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm test
```

Commit `dist/EmporniumCompanion.user.js`, `dist/EmporniumCompanion.meta.js`, `dist/EmporniumCompanion-<version>.user.js`, and `dist/nse-schema.json` together with the source changes. The build derives the publication URLs from `package.json`. The bundle regression verifies that the versioned download and metadata match the stable script and that the README uses the same install URL. GitHub Actions rebuilds, checks syntax, runs the tests, and rejects missing or stale generated files. It does not publish releases or modify the repository.

Keep the existing `@name`, `@namespace`, and storage keys so users can update the same script and retain preferences.

## Future releases

1. Make the changes and increase `version` in `package.json` before publishing an update. Tampermonkey uses `@version` to detect newer releases.
2. Run validation, update the README's current version and versioned download, and record relevant changes and validation in the documentation.
3. Review and commit the source and generated files together, then push `main`. The stable installation link stays the same. Every push to `main` changes what new users install and what existing users can receive through updates, so keep unfinished work on another branch.
4. Confirm GitHub Actions passes and check the published metadata/install link. A GitHub release is optional; if creating one, tag the validated commit and attach its versioned userscript.

Retain the included GPL license, attribution, and required vendor build sources. Two unused research references remain local and are excluded by `.gitignore`; the application and tests do not require them. Test fixtures and recorded performance results are local simulations; see [the QA report](QA-REPORT.md) for actual browser-manager validation gaps.

## Release showcase

Use this workflow for Companion's user-facing release slides and animated GIFs. Save the deck and exports in Downloads or another user-selected folder outside the Git checkout. Keep screenshots, artwork, and temporary fixture or render files outside the checkout as well.

### Capture the interface

1. Confirm the release version in `package.json` and the installable userscript header. Build with `pnpm build` and capture the compiled script from `dist/EmporniumCompanion.user.js`. After a UI change, refresh affected captures and regenerate all exports from the revised deck.
2. Start the neutral demo with `pnpm fixture`. For additional scenes, run a temporary loopback fixture using `fixtureHTML`, `rowHTML`, and `overlayHTML` from [test/helpers.mjs](../test/helpers.mjs). Use a fresh browser context, dummy accounts and records, and fixture storage. Route any simulated image hosts to local assets. See [Development](REFERENCE.md#development) for fixture entry points.
3. Exercise the feature before capturing it. For example, select a Freeleech view from the toolbar, pin a sample collage and open a sample details page, or load a batch and capture the resulting status. Capture desktop and phone widths when layout or control placement changes. Crop to Companion and just enough surrounding content to show the result. Use actual screenshots of the script on the demo. Use close-ups of flowers or other neutral, appropriately licensed imagery as sample content and decorative art. Credit sourced photos in the speaker notes. Use only local fixtures for application requests, including collage writes.

### Build and review the deck

- Use a 16:9 canvas and a simple editorial style. The 2.13.0 showcase used Georgia for headlines, a plain sans serif for body text, warm light and deep dark surfaces, and cropped botanical photography. Keep screenshots large and readable, with one main user action or benefit per slide.
- Use the requested release version as the sole visible version. Keep the cover simple and slides unnumbered. Use straightforward feature names and plain instructions. Leave release-status labels such as “upcoming”, “preview”, and “unpublished” off the slides.
- Use the presentation authoring workflow to export the PowerPoint and render each final slide. Check the exported slides at full size for cropped controls, stale labels, private data, and readable screenshot text. The 2.13.0 deck in Downloads can serve as a visual reference when available.

### Export the GIFs

- Make both GIFs from the same final slide renders, in the same order. Use a continuous loop. Aim for about four seconds on the cover and six to nine seconds per feature slide, with more time for dense controls. Start at 1280 × 720 and aim to keep each GIF under 1 MB for posting.
- In the timer version, fill a thin accent bar along the bottom edge of the slide, from left to right. Reset it on each slide and leave it numberless. The 2.13.0 export used a five-pixel bar with updates roughly every 70 ms. Encode timer updates as small image patches that extend the bar, so the GIF stores each full slide only once. Tune per-slide palettes and dithering before reducing resolution.
- Reopen both GIFs to verify the full slide sequence, readable controls, timing, and looping. Check that the bar fills and resets in the timer version. Deliver the PowerPoint, the GIF with the timer, and the plain GIF from the external output folder.
