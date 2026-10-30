# Publishing Empornium Companion

Repository: `mc-hamster/companion`. Published branch: `main`.

The userscript runs inside each user's browser. GitHub serves the installation and update files; there is no application server, database, domain, or GitHub Pages setup to maintain.

## First publication

1. Run the validation commands below and commit the publication changes, including the generated files.
2. Push `main` to `origin`, which is configured as `https://github.com/mc-hamster/companion.git`. In GitHub Desktop, use **Push origin** after committing. Confirm the repository is public so others can install and receive updates without GitHub authentication.
3. Confirm the **Validate userscript** GitHub Actions workflow passes.
4. Open the install link in a browser with Tampermonkey. Check that it identifies **Empornium Companion 2.11.0**, shows the declared permissions, and offers installation. Reload Empornium after installation and confirm Getting started and the toolbar appear. Existing installations should retain their saved preferences when updated.
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
