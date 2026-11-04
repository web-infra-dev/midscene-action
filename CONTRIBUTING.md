# Contributing to Midscene Action

Bug reports, documentation improvements, and pull requests are welcome.

## Development

Create a branch for your changes. Use Node.js 24 and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm check
```

Use `pnpm format` to fix lint and formatting issues. Keep both READMEs and examples
in sync when changing usage.

For changes to test execution or reports, run the [basic](examples/basic/README.md)
and [TodoMVC](examples/todomvc/README.md) examples with model credentials.

## Artifact and publication conventions

- Resolve the artifact root once through `src/artifacts.mjs`. Pass its absolute
  path to the command as `MIDSCENE_RUN_DIR`; upload, Summary, and publication
  consume the same resolved step outputs. Reject conflicting input and environment
  settings. A custom root must not collect stale default-root results; the default
  also collects legacy `.midscene` results.
- Locate results through `test-results/` and the generated Summary. Missing Test
  results must fail with a directory configuration hint, rather than produce an
  empty successful Summary. Preserve the command's failure when upload or
  publication succeeds.
- Keep report preparation in `src/cloudflare-report.mjs`. Stage a single HTML as
  an isolated `index.html`; publish a directory report with its required assets.
  Validate report paths and assets against the allowed report root, including
  real paths through symlinks. Do not publish the whole working directory.
- Cover both report formats, default and custom roots, inherited environment,
  conflicts, missing results, multiple runs, and path escapes in `pnpm check`.
  Runtime artifact conventions are maintained in Midscene's
  [contribution guide](https://github.com/web-infra-dev/midscene/blob/main/CONTRIBUTING.md).

## Pull requests

Open a pull request against `main`. Describe the change and how you tested it.

## Releases

Publish from the GitHub website:

1. Confirm that CI and both example workflows pass for the commit you want to release.
2. Open **Releases → Draft a new release** and create a `vX.Y.Z` tag, such as
   `v1.0.0`, for that commit.
3. Write or generate the release notes. Review them and explain any breaking changes.
4. Select **Publish this Action to the GitHub Marketplace** and publish the release.
5. Check that **Update major version tag** succeeds in the Actions tab. If it fails,
   rerun the workflow.

The [release workflow](.github/workflows/release.yml) updates `v1`, `v2`, etc.
automatically for stable releases. Prereleases are skipped. Keep specific version
tags such as `v1.0.0` unchanged.

GitHub Release Notes serve as the changelog.
