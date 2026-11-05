# External-assets report example

A minimal Midscene Test project using `output.reportFormat: 'html-and-external-assets'`.
One custom Node checks arithmetic, so no browser or model credentials are needed.

## Run locally

Use Node >= 22.13 and npm from this directory.

```bash
npm ci
npm run typecheck
npm test
```

The report entry is `midscene_run/report/midscene-e2e-<run-id>/index.html`.
Keep its complete directory, including external assets, when copying the report.

## CI

The [workflow](../../.github/workflows/example-external-assets.yml) runs this
project through the Action, downloads its artifact and verifies the report entry.
On same-repository runs it also publishes the report using the shared `CI`
environment’s Cloudflare credentials. Fork PRs run the example without publication.

The [basic example](../basic/) covers the default single-HTML format.
