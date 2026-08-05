# V1 release qualification

**Candidate:** `local-model-workers-mcp@1.0.0-rc.1`  
**Status:** Automated local gates pass; external release gates remain blocked (report them with `npm run release:gates`)  
**Last reviewed:** 2026-08-02

## Current verdict

The application is feature-complete for the approved V1 scope and produces an
installable, reproducible npm tarball. It is not approved for publication yet.
Two required pieces of evidence cannot be truthfully produced by the local
run alone:

1. the complete six-tool scenarios have not yet run through both real Claude
   Code and Codex against the configured LM Studio instance;
2. the new Linux and Windows CI matrix has not yet completed on remote runners.

CA-47 through CA-52 therefore remain release gates. No aggregate metric or
local test can waive them.

## Evidence completed locally

| Gate | Result on 2026-08-02 |
| --- | --- |
| Node/npm baseline | Node 24.18.0 and npm 11.16.0 |
| Harness versions present | Claude Code 2.1.204 and Codex CLI 0.145.0 |
| Full validation | `npm run validate` passed all automated tests, lint, boundaries, typecheck, and build |
| Installed package smoke | Two independently packed tarballs were byte-identical; isolated install exposed the bin, started MCP without a token, listed six tools, and returned explicit `authentication: none` configuration. The final digest is captured outside the packaged documentation to avoid a self-referential artifact hash. |
| Harness configuration | Fresh, compatible, identical, conflicting, stale, malformed, cancelled, dry-run, and confirmed cases passed in isolated profiles |
| Official fixtures | TypeScript Node test and Python `unittest` smoke suites passed locally |
| Production dependency audit | `npm audit --omit=dev` reported zero known vulnerabilities across four production dependencies |
| Real LM capability probe | Qwen 3.5 9B and Gemma 4 12B passed structured output, required tool-call, and vision probes; Nomic embedding returned 768 dimensions |
| Real LM authentication probe | The compiled MCP returned overall `healthy`, authentication `healthy` / `not_configured`, and both approved LLMs available without credentials |

The automated RF/CA mapping is maintained in
[tasks/traceability.md](tasks/traceability.md) and checked against all 29 RFs and
52 CAs by `test/release-qualification.test.ts`.

## Cross-platform gate

`.github/workflows/validate.yml` runs `npm ci`, `npm run validate`, and
`npm run release:smoke` on `macos-latest`, `ubuntu-latest`, and
`windows-latest`. The smoke script:

- packs the candidate twice and compares SHA-256 digests;
- installs the tarball into an isolated prefix;
- verifies the executable and version channel;
- dry-runs both harness adapters in an isolated profile;
- writes global preferences through the installed command;
- starts the installed MCP server over `stdio`;
- verifies exactly six tools and a redacted `get_config` response.

CA-52 passes only after all three remote jobs are green for the exact candidate
commit.

## Official scenario measurement

Use fresh copies of `test/fixtures/release/typescript` and
`test/fixtures/release/python` for each harness. The harness, never the MCP
server, may apply a candidate patch and start the suggested command. Capture the
six discovered tool names, exploration evidence, patch paths, application
outcome, test-start outcome, and secret-scanned outbound/persisted/terminal
channels using [release-evidence.template.json](release-evidence.template.json).

Then run:

```sh
npm run release:measure -- /absolute/path/to/release-evidence.json
```

The measurement fails unless evidence references are 100% valid, at least 80%
of patches apply without conflict, at least 80% of applied patches start tests,
100% of patch paths are allowed, both harnesses expose the exact six-tool set,
and no prohibited fixture marker appears in captured channels. Empty samples
fail instead of producing a favorable percentage.

## Remaining macOS procedure

1. Keep LM Studio private to the trusted LAN. The current `lms` CLI may run
   without API-token authentication.
2. Export the protected URL and exact model allowlist without writing their
   values to project or evidence files. Export the optional token only when LM
   Studio supports and enables it.
3. Confirm `check_health` reports `not_configured` in trusted-LAN mode (or
   authentication enforced when a token is configured) and both approved LLM
   identifiers available.
4. Install the exact `1.0.0-rc.1` tarball into an isolated prefix.
5. Run the official Python and TypeScript scenarios once through Claude Code
   2.1.204 and once through Codex CLI 0.145.0.
6. Inspect LM Studio payload captures, harness output, operational logs,
   configuration, and the artifact for prohibited markers and credential
   values.
7. Run `release:measure`, record its JSON output and artifact SHA-256, and link
   the successful OS-matrix jobs.

## Release and rollback

Do not run `npm publish` while any gate above is pending. After all gates pass,
rebuild from the reviewed clean commit, rerun validation, smoke, audit, and
measurement, then publish the exact tarball digest recorded in the release
evidence. Promotion from `1.0.0-rc.1` to `1.0.0` requires updating
`package.json`, `package-lock.json`, and `src/shared/package-info.ts` together.
The reviewed promotion also changes `private` to `false`; the candidate keeps it
enabled to make accidental publication impossible.

Rollback installs the previously retained verified tarball. Harness recovery
does not require uninstalling: restore project `.mcp.json` from version control
or remove only the marked Codex block. Global preferences can be restored from
a securely retained, secret-free copy. There is no automatic updater or silent
migration.

## Known non-blocking limitations

- Full harness certification is macOS-only for V1; Linux and Windows receive
  package/start/configuration portability coverage.
- HTTP is supported only on a trusted private LAN. Certificate and proxy
  management are outside V1.
- Codex TOML preservation is intentionally managed-entry based; ambiguous or
  duplicate managed tables require manual repair.
- Combined Claude/Codex setup is atomic per file, not one cross-file
  transaction.
