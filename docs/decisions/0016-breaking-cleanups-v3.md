# 0016 — Breaking cleanups for 3.0.0

Status: accepted
Date: 2026-08-06

## Context

Three cleanups accumulated behind the 2.x compatibility promise. Each is
breaking on its own, and shipping them one per release would mean a major bump
for each — so they ship together in 3.0.0.

## Decision

### 1. `LMW_PROVIDERS` is the only provider contract

`LMW_LM_STUDIO_BASE_URL`, `LMW_LM_STUDIO_BEARER_TOKEN`, and
`LMW_ALLOWED_MODELS` are no longer read by the server. The synthetic
single-provider projection that translated them is gone.

Two contracts for the same setting meant two code paths, two sets of validation
rules, and a projection whose failure modes did not match the schema it
imitated. Multi-provider was already the real contract; the legacy one was a
shim.

Migration lives in `installation`, not in the server: `setup` reads the retired
variables once, writes the equivalent `LMW_PROVIDERS`, and reports that it did.
A server that finds only the retired variables fails closed with a message
naming `LMW_PROVIDERS` and the command that migrates — an upgrade that looks
like a breakage is worse than one that explains itself.

An already-migrated `LMW_PROVIDERS` wins over lingering legacy variables, so
re-running setup never regresses to a stale endpoint left in a shell profile.

### 2. `tls_verify` defaults to the host, not to `false`

Unset now means: **remote providers verify certificates, loopback does not.**

The old default was `false` everywhere, which made "accept any certificate from
a machine across the network" the behavior nobody chose. Loopback keeps plain
HTTP because that traffic never leaves the machine and is what a local LM Studio
actually serves.

Opting out for a remote provider now requires writing `tls_verify: false`.
`setup` writes it — with a warning — when the URL it is given is remote and
plain `http:`. A trusted-LAN install that worked before 3.0 keeps working, and
the trade-off is recorded in the configuration instead of assumed.

`bearer_token` is still written only into harness files that cannot inherit the
process environment (JetBrains, Antigravity). Moving the credential inside
`LMW_PROVIDERS` did not change which files receive it: the value is stripped
from the JSON for every other harness.

### 3. Gate-conditional promotion is **not** adopted

The plan called for dropping `--report-only` from the CI gates job and setting
`private: true`. This part is deliberately not implemented.

Two release gates are structurally unverifiable by any local or CI process: a
real harness session and a real three-OS matrix run. With `--report-only`
removed, the gates job exits non-zero on every commit, and since `release`
depends on `gates`, publishing stops permanently until someone runs those
scenarios by hand and records the result.

That is the change working as designed, not a bug. It is also outward-facing
and effectively irreversible in practice — a package that silently stops
publishing is a user-visible failure. Adopting it requires someone committed to
running the real scenarios, which is a decision about process, not code.

`--report-only` therefore stays. The gates job continues to report met, unmet,
and unverifiable gates on every push; it just does not block. Revisiting this
means answering "who runs the harness and matrix scenarios, and when" first.

## Consequences

- 2.x installations must run `setup` once, or set `LMW_PROVIDERS` by hand.
- A remote plain-HTTP provider that has not been migrated by `setup` is refused
  at startup with a message naming the opt-out.
- Release promotion remains unconditional. The intent is recorded here so the
  gap is visible rather than forgotten.
