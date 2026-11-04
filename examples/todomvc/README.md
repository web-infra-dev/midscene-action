# TodoMVC example

A standalone `@midscene/test` project inspired by
[midscene-example PR #99](https://github.com/web-infra-dev/midscene-example/pull/99).
It runs against [TodoMVC React](https://todomvc.com/examples/react/dist/) using the
same Midscene and Playwright versions as the [basic example](../basic/).

TypeScript Nodes own the selectors and exact assertions; YAML composes them with
AI actions and lifecycle hooks. The example includes two execution projects:

- `deterministic`: seed three Todos through the UI and verify their exact order
  and completed states, without calling a model.
- `ai`: ask AI to delete the Rust Todo and complete the AI Todo, check the visible
  result with `aiAssert`, then verify the exact DOM state.

Each project launches its own Chromium browser. `beforeAll` sets the viewport;
`beforeEach` opens TodoMVC, clears storage, and seeds the same three Todos.
`afterEach` captures DOM state even when a case fails, and `afterAll` adds a report
note. Project teardown destroys the Agent before closing the browser.

## Run locally

Use Node >= 22.13 and npm:

```bash
cd examples/todomvc
npm ci
npx playwright install chromium
npm run typecheck
```

Inspect the available Nodes or run just the deterministic case without a model:

```bash
npm run nodes
npm run test:deterministic
```

To run the AI case, copy `.env.example` to `.env` and fill in your model API key,
name, and family using the
[Midscene model configuration](https://www.midscenejs.com/model-config).
Set the optional base URL if your provider requires it. Shell variables take
precedence over `.env`.

```bash
npm test
```

`npm test` runs both projects. `npm run test:ai` runs just the AI project.
Set `HEADLESS=false` to watch the browser. TodoMVC must be reachable over HTTPS.

The reusable Nodes are in [`nodes/todo.ts`](nodes/todo.ts):
`todo.seed`, `todo.expectState`, and `todo.captureState`. Their inputs use strict
Zod schemas, and their structured results appear in the native report.
The workflow is in [`cases/todo.yaml`](cases/todo.yaml).

Midscene writes the HTML report under `midscene_run/report/` and structured
results and `result.md` under `.midscene/test-results/<run-id>/`.
Use a clean output directory for each Action run: report publication expects
exactly one native run summary.

## CI

The [TodoMVC workflow](../../.github/workflows/example-todomvc.yml) installs
dependencies and Chromium, typechecks, runs the full suite through `uses: ./`,
downloads the Action's artifact, and checks that the summary points to a nonempty
HTML report. It runs independently of the
[basic workflow](../../.github/workflows/example-basic.yml) and can be dispatched
separately.

Both examples share the repository's `CI` environment:

- Secret: `MIDSCENE_MODEL_API_KEY`.
- Variables or secrets: `MIDSCENE_MODEL_NAME`, `MIDSCENE_MODEL_FAMILY`.
- Optional variable or secret: `MIDSCENE_MODEL_BASE_URL`.

Fork PRs run quality checks only because model secrets are unavailable. Other
runs require a working model configuration and must pass both cases.
Every test run automatically publishes the TodoMVC report to Cloudflare Workers
and checks its URL, including manual workflow runs. Missing publication
configuration fails the job. See the
[basic example's publication setup](../basic/README.md#ci) for the Cloudflare
credentials. Both workflows use the default `midscene-reports` Worker. Each
workflow run has its own run ID and Preview URL, so their reports stay separate.
