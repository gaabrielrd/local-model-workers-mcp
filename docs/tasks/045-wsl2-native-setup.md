# Task 045: WSL2 Native Setup

**Status:** Implemented (v2.2.0)
**Depends on:** Task 042 (completed)

## Objective

Provide official WSL2 setup scripts for Windows developers running Linux
containers, complementing the existing `Dockerfile`.

## Key Design Decisions

- New `scripts/wsl2/setup-wsl2.sh` bootstraps inside WSL2: verifies WSL2,
  checks the Node.js 24.18 baseline, installs the server package globally (or
  builds a checkout with `--from-source`), then delegates the questionnaire to
  the server's own `setup` command so interactive (checkbox) and non-interactive
  (`--yes`, `--target`, `--url`) modes are identical to the native CLI.
- The script is shipped in the npm artifact (`scripts/wsl2` added to the
  package `files`) so the published package includes WSL2 support.
- The `Dockerfile` entrypoint was corrected to `node dist/cli/index.js` (the
  compiled CLI); the previous `dist/index.js` did not exist in the build output.
- `docs/wsl2.md` documents WSL2 networking (mirrored vs NAT) and the Docker
  alternative using `host.docker.internal`.

## Acceptance Criteria

- [x] WSL2 setup scripts install and configure the server on Windows/WSL2.
- [x] Setup works non-interactively and interactively.
- [x] Portability checks cover the WSL2 target.
- [x] `npm run validate` green.

## Files Changed

- `scripts/wsl2/setup-wsl2.sh` (new): WSL2 bootstrap script.
- `Dockerfile`: corrected CLI entrypoint.
- `package.json`: ships `scripts/wsl2` in the package artifact.
- `docs/wsl2.md` (new): WSL2 setup and networking documentation.
- `test/wsl2.test.ts` (new): WSL2 + Docker entrypoint portability checks.
- `test/dockerfile.test.ts`, `test/package-artifact.test.ts`: updated for the
  corrected entrypoint and shipped script.
