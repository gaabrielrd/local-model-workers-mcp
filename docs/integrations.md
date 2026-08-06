# External integrations

**Status:** Local model providers, Git, Claude Code, and Codex adapters implemented
**Last reviewed:** 2026-08-02

## Claude Code and Codex

Both harnesses start the local MCP server as a child process and communicate over
`stdio`. With every feature group enabled, the server exposes twelve tools.
Harnesses
remain responsible for:

- collecting explicit confirmation for `update_config`;
- showing progress and structured results;
- deciding whether to apply a proposed patch;
- executing suggested test commands under the harness's own permissions;
- forwarding cancellation when a call or connection ends.

The server must keep stdout reserved for MCP protocol messages. Operational
diagnostics use a protocol-safe channel and must never contain protected or
repository content.

The executable and confirmed configuration assistant are implemented. Claude
Code uses global `~/.claude.json` or project `.mcp.json` entries:

```json
{
  "mcpServers": {
    "local-model-workers": {
      "command": "local-model-workers-mcp",
      "args": [],
      "env": {
        "LMW_PROVIDERS": "[{\"name\":\"lm-studio\",\"type\":\"lm-studio\",\"base_url\":\"http://localhost:1234/v1\",\"allowed_models\":[\"*\"],\"priority\":0}]"
      }
    }
  }
}
```

Claude Code can also install the server as a plugin, which supplies the same
stdio entry plus usage skills and replaces both the harness registration and the
managed `CLAUDE.md` block. See
[claude-code-plugin.md](claude-code-plugin.md).

Codex CLI 0.145.0 uses a user `~/.codex/config.toml` table and inherits named
variables from its process:

```toml
# local-model-workers-mcp:start
[mcp_servers.local-model-workers]
command = "local-model-workers-mcp"
args = []
env_vars = ["LMW_PROVIDERS"]
# local-model-workers-mcp:end
```

Run `local-model-workers-mcp configure-harness --target both --project-root
"$PWD" --dry-run`, review the managed-field proposal, then repeat with `--yes`.
The adapters preserve unrelated configuration, reject ambiguous formats, and
never print existing entries or protected values. Installation, global
preferences, recovery, and exact commands are documented in
[installation.md](installation.md). Full real-harness V1 qualification remains
part of Task 015.

## LM Studio

The implemented adapter targets LM Studio 0.4.0 or later and its
OpenAI-compatible REST surface:

- `GET /v1/models` for the visible model catalog;
- `POST /v1/chat/completions` for non-streaming structured inference;
- optional `Authorization: Bearer <token>` when a token is configured.

The base URL therefore ends in `/v1`, for example
`http://model-host.local:1234/v1`. It cannot contain credentials, a query, or a
fragment. The version floor exists because LM Studio added API-token
authentication in 0.4.0. See the official [REST API
overview](https://lmstudio.ai/docs/developer/rest), [authentication
guide](https://lmstudio.ai/docs/developer/core/authentication), and [API
changelog](https://lmstudio.ai/docs/developer/api-changelog).

Inference sends `stream: false`, `temperature: 0`, `reasoning_effort: none`, and
strict `response_format: json_schema`. The adapter then parses the returned text
as JSON and validates it again with the local Zod schema. A non-`stop` finish,
invalid UTF-8/JSON/schema, response above 1 MiB, or response naming a different
model fails closed. The structured-output protocol follows LM Studio's official
[JSON Schema compatibility](https://beta.lmstudio.ai/docs/developer/openai-compat/structured-output).

Before inference, the requested identifier must be both protected-policy
allowlisted and present in `/models`; there is no fallback. A caller deadline
and cancellation signal remain active while response bytes are read. Only
network failures and HTTP 408, 429, 500, 502, 503, and 504 are transient; an
inference gets at most the configured single retry. Authentication, policy,
schema, size, partial-output, and other permanent failures are not retried.

`check_health` is repository-free. It reports configuration, reachability,
authentication mode, the default model, and every allowed model independently.
Without a token, successful reachability reports healthy `not_configured` and
no `Authorization` header is sent. With a configured token, health also sends a
catalog request with a deliberately invalid token. If that token succeeds,
authentication is `authentication_not_enforced` and overall health is unhealthy.

### Controlled compatibility probes

On 2026-08-02, a controlled LAN instance exposed these capabilities:

| Model | Catalog type | Structured JSON Schema | Tool call | Vision |
| --- | --- | --- | --- | --- |
| `qwen/qwen3.5-9b` | LLM | Passed | Passed | Passed |
| `google/gemma-4-12b-qat` | LLM | Passed | Passed | Passed |
| `text-embedding-nomic-embed-text-v1.5` | embedding | N/A | N/A | N/A |

The embedding probe returned 768 dimensions. Both LLMs advertise configurable
reasoning; with the default reasoning enabled, a deliberately tiny output
budget could be consumed entirely by reasoning tokens. Structured application
requests therefore disable reasoning explicitly. Tool calling is compatible
but is not exposed by this V1 adapter because the approved product uses locally
validated structured results rather than remote tools.

The tested `lms` instance returned HTTP 200 for a deliberately invalid Bearer
token, which means authentication was unavailable. It is supported in explicit
`none` mode: omit `bearer_token` from the provider entry. Supplying a token to such
an endpoint intentionally remains unhealthy because the requested protection is
not enforced.

HTTP is supported only on a trusted private local network. HTTPS may be used
when the environment provides it, but proxy and certificate management are not
part of V1. Public exposure is unsupported.

## Ollama, vLLM, and LocalAI

Multi-provider mode configures these services alongside LM Studio through the
protected `LMW_PROVIDERS` array. Ollama base URLs normally use the service root
(for example `http://model-host.local:11434`) and the adapter calls
`/api/tags`, `/api/chat`, and `/api/embed`. Structured chat sends the locally
derived JSON Schema as Ollama's `format` and validates the returned JSON again.

vLLM and LocalAI use their OpenAI-compatible `/v1/models`,
`/v1/chat/completions`, and `/v1/embeddings` surfaces, so their configured base
URL normally ends in `/v1`. Provider responses use the same byte bounds,
deadline, cancellation, model identity, allowlist, and strict local validation
rules as LM Studio. Compatibility is covered by deterministic fake-server and
adapter tests; real deployments should still verify the exact server version
and enabled endpoints.

## Git

Git is used only to identify ignored files before context is selected. The
implemented adapter executes
`git check-ignore --quiet --no-index -- <relative-path>` with `execFile`, never
a shell. It disables global/system configuration, optional locks, and pagers and
inherits no protected application variables. Exit 0 means ignored, exit 1 means
visible, and any other error excludes the uncertain file with a limitation.
Git is not used to modify, stage, commit, revert, or execute repository content.

## Local filesystem

The filesystem integration provides only bounded directory listing, text
search, and snippet reads to task code. It also supports configuration and
metadata-only operational logs through separate adapters. Canonical path and
symlink checks occur before access; permission failures never trigger an attempt
to expand process privileges.

Project preference updates are atomic and revision-controlled. Configuration
locations are defined in [configuration.md](configuration.md). Operational log
locations and retention are defined in
[operational-logging.md](operational-logging.md).

Global capacity metadata lives in a `coordination` directory beside the global
preference file. Its only durable file is `capacity-state.json`; a
`capacity-state.lock/owner.json` pair exists only during short state
transactions. Files use owner-only modes where supported. A process crash needs
no manual cleanup: the next waiter removes dead owners, and a dead transaction
lock is eligible after ten seconds. Do not place this directory on a network
filesystem, and do not delete it while MCP processes are active.

Operational logs use `~/Library/Logs/local-model-workers-mcp` on macOS,
`${XDG_STATE_HOME:-~/.local/state}/local-model-workers-mcp/logs` on Linux, and
`%LOCALAPPDATA%\\local-model-workers-mcp\\logs` on Windows. Each terminal event
is one owner-only JSON file. Cleanup examines only direct files matching the
application-owned `event-<timestamp>-<id>.json` pattern.

## Project test infrastructure

`propose_tests` detects existing test conventions and may suggest unit or
integration tests using that infrastructure. It does not install dependencies,
create a missing test framework, run commands, contact real external services,
or propose browser, GUI, or mobile tests in V1.

If usable infrastructure is absent, the result is `blocked` with compatible
options for the developer. Suggested commands are returned as text for the
harness to review and run.

## Failure behavior

| Integration | Required failure behavior |
| --- | --- |
| Harness transport | Return a structured MCP error when possible and cancel owned work on disconnect |
| LM Studio | Classify reachability, authentication, unavailable-model, timeout, and malformed-response failures without leaking credentials |
| Git | Exclude content whose ignore status cannot be established safely |
| Filesystem | Return a scoped error; never expand access or follow an escaping symlink |
| Test infrastructure | Return `blocked` without a patch when no usable framework exists |

## Implementation documentation checklist

When an integration becomes executable, update this document with its supported
versions, exact configuration fields, timeouts, setup and health-check commands,
expected errors, and a secret-safe troubleshooting example.
