# SIWC in parallel GitHub Actions jobs

Use one serialized job to own the full Sign in with ChatGPT session. Parallel
test jobs receive an encrypted access-only ticket. They cannot refresh the session.
The root report Action remains responsible for artifacts, Summary and publication.

## Provision once

1. Complete a separate local Midscene SIWC login for CI. Keep the full JSON record,
   including client registration metadata. Do not share a rotating session with a
   desktop client. Treat CLI stdout as sensitive: some versions print the access token.
2. Create a GitHub Environment, for example `midscene-siwc`, restrict its branches,
   and store the record in its `SIWC_CREDENTIALS` secret.
3. Create a fine-grained GitHub token scoped to this repository with **Environments:
   read and write**. Store it as repository secret `SIWC_SECRET_WRITE_TOKEN`.
4. Generate 32 random bytes encoded as 64 hex characters and store them in repository
   secret `SIWC_TRANSPORT_KEY`. All consumers need the same key.
5. Install `@midscene/core` in the caller project. The implementation was exercised
   with Core 1.17.4 and Node 24. `gh` must be installed on the credential runner.

See [the workflow template](../examples/siwc.yml). Pin the prepare, run and root
Actions to the same reviewed commit or release when adopting them. These paths
are additions in this change; older releases do not provide them.

## Keep job ownership in the workflow

The prepare job **must** bind `environment:` to the same Environment named in the
Action input. Use one fixed concurrency group for all jobs that can refresh this
session, with `cancel-in-progress: false` and `queue: max`. Do not include run IDs
in that group. The Action cannot configure or verify the caller's job-level lock.

Environment secrets are read when the job starts; repository secrets are read when
the workflow queues. A serialized job reading an Environment Secret can therefore
receive its predecessor's replacement record. Do not feed untrusted PR code these
credentials. Keep all session writers in this repository and concurrency group.

Put slow APK builds or image preparation before the credential job using `needs`.
The prepare Action requires 30 minutes of remaining access validity and refreshes
when necessary. It persists replacement credentials **before** issuing a ticket.
Only GitHub writeback is retried (up to three attempts), not the OAuth refresh.

`force-refresh: 'true'` exercises a real refresh and writeback for acceptance.
After CI rotates the session, the Environment Secret is authoritative. Do not
overwrite it with a stale local record.

## Consume without refresh

The run Action accepts `working-directory`, `command`, `ticket`, and `transport-key`.
It runs the command with Bash and pipefail inside a private temporary HOME, writes
an access-only `~/.midscene/siwc.json` with mode 0600, sets
`MIDSCENE_MODEL_AUTH_MODE=siwc`, and removes the temporary home on exit.

For an application under test that also needs the session, the child environment
provides `MIDSCENE_SIWC_ACCESS_TOKEN` and `MIDSCENE_SIWC_EXPIRES_AT` (milliseconds).
The caller owns any guarded device provisioning. Do not persist those values in
reports, caches or artifacts. Upload only report and result directories, never HOME.

The ticket uses AES-256-GCM and binds repository, run ID and run attempt. Only
`access_token` and `expires_at` are included; refresh, identity and registration
fields stay with the owner. Shard admission requires 22 minutes remaining; set the
whole shard job timeout to at most 20 minutes. A delayed/expired ticket fails closed.
Rerun the whole workflow after expiration; a single old shard cannot renew it.

## Reports and verification

Merge shard reports into one native report and one native result summary, then run
the root Action once with your merge command. For an existing Pages project:

```yaml
- uses: web-infra-dev/midscene-action@main
  id: report
  with:
    working-directory: tests/midscene
    command: node scripts/merge-reports.mjs
    publish-pages: 'true'
    cloudflare-target: pages
    cloudflare-pages-project: my-midscene-reports
    cloudflare-api-token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    cloudflare-account-id: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
```

Pages requires access to the selected Pages project; the existing Workers target
requires Workers permissions. Publication verifies that the deployed URL serves a
native Midscene report and appends its URL to Summary. `page-url` exposes that URL.
Publishing failed test reports does not change the test verdict.

Test a forced refresh, a subsequent reuse run, multiple parallel consumers, expired
and tampered tickets, writeback failure, and the actual published report URL. A
successful credential job alone does not establish that business tests passed.

There is no transaction spanning OAuth refresh and GitHub writeback. Cancellation
or a runner failure between them can lose the replacement token. Investigate the
stage before retrying; an invalid rotating grant may require a fresh local login.

References: [OpenAI sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
[GitHub secret timing](https://docs.github.com/en/actions/reference/security/secrets#when-github-actions-reads-secrets),
[Environment secret permissions](https://docs.github.com/en/rest/actions/secrets#create-or-update-an-environment-secret).
