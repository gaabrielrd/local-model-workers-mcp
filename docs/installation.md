# Installation and harness configuration

**Status:** Implemented for the local V1 release candidate  
**Last reviewed:** 2026-08-02

## Supported baseline

The package and executable are both named `local-model-workers-mcp`. V1 pins
Node.js 24.18.x and npm 11.x and fully qualifies macOS first. Linux and Windows
receive basic install, startup, and configuration-read smoke coverage during
release qualification.

The package is published on the public npm registry under the open MIT license. You can install it globally or run it zero-install via `npx`:

```sh
npm install --global local-model-workers-mcp
# or setup interactively without global install:
npx local-model-workers-mcp setup
```

To build and inspect locally from source:

```sh
npm ci
npm run validate
npm pack
npm install --global ./local-model-workers-mcp-2.0.0.tgz
local-model-workers-mcp --version
```

The artifact contains `package.json`, `README.md`, and compiled `dist/` runtime
files. It excludes source, tests, local environment files, task data, and
development scripts. To update or roll back, install the desired newer or older
tarball with the same `npm install --global` command. There is no automatic
update mechanism.

## Protected environment

Before starting either harness, provide the URL and allowlist. Export the token
only when that LM Studio deployment supports authentication:

```sh
export LMW_LM_STUDIO_BASE_URL='http://pc-gabriel.local:1234/v1'
export LMW_ALLOWED_MODELS='["qwen/qwen3.5-9b","google/gemma-4-12b-qat"]'
# Optional:
export LMW_LM_STUDIO_BEARER_TOKEN='<LM Studio API token>'
```

Do not place actual credentials in `.mcp.json`, Codex `config.toml`, project
files, command history, or support output. HTTP is supported only on a trusted
private LAN. The assistant never configures public exposure, certificates, or a
proxy. The probed `lms` instance accepts requests without authentication; this
is supported only because it remains on the explicitly trusted private LAN.

## Single-command interactive onboarding

The fastest way to install, initialize, and test the MCP server is the single interactive command:

```sh
local-model-workers-mcp setup
# or:
local-model-workers-mcp init
```

This assistant interactively prompts for the LM Studio Base URL, allowed models,
default model, optional Bearer token, MCP feature groups, and target harnesses.
Both feature and harness prompts are checkbox lists: use the arrow keys to move,
`Space` to toggle, `Enter` to confirm, and `Ctrl+C` to cancel. The feature groups
are `exploration`, `tests`, `docs`, and `lint`; all start enabled. Administrative
health and configuration tools are always available. The assistant updates
global preferences, writes harness configuration files, runs an immediate
health check (`check_health`) against LM Studio, and presents first-call
instructions. Non-interactive or automated execution is supported via flags
such as `--features exploration,tests --target all --yes` and `--dry-run`.

## Text-only configuration assistant

Every flow is keyboard-operable. A proposal is always printed before a write.
Without `--yes`, a required write exits without modifying a file; `--dry-run`
never writes. Choose Claude Code, Codex, Antigravity, all, or cancellation:

```sh
local-model-workers-mcp setup --dry-run
local-model-workers-mcp setup --features docs,tests --target all --yes
local-model-workers-mcp configure-harness --target claude-code --project-root "$PWD" --dry-run
local-model-workers-mcp configure-harness --target codex --dry-run
local-model-workers-mcp configure-harness --target antigravity --dry-run
local-model-workers-mcp configure-harness --target all --project-root "$PWD"
local-model-workers-mcp configure-harness --target cancel
```

Claude Code supports global user-scoped configuration (`~/.claude.json`) for automatic activation across all active projects, as well as project-scoped configuration (`.mcp.json`). Antigravity uses the user-scoped `~/.gemini/config/mcp_config.json` `mcpServers` format. Codex uses the user-scoped `~/.codex/config.toml` `[mcp_servers.local-model-workers]` table with `command`, `args`, and `env_vars`. JetBrains IDEs (IntelliJ IDEA, PyCharm, WebStorm, GoLand, and CLion) share one AI Assistant MCP configuration file — `~/Library/Application Support/JetBrains/AIAssistant/mcp.json` on macOS, `~/.config/JetBrains/AIAssistant/mcp.json` on Linux, and `%APPDATA%\JetBrains\AIAssistant\mcp.json` on Windows — written in the standard `mcpServers` JSON format, so a single `--target jetbrains` registers the server for all five IDEs.

Every harness also receives a prompt steering instruction file that directs the
agent to offload repository work to the local MCP tools (`explore_repository`,
`search_semantic`, `query_code_graph`, `summarize_module`, and `propose_tests`):

- Claude Code Global: `~/.claude/CLAUDE.md`.
- Claude Code Project: `AGENTS.md` in the project root.
- Codex: `~/.codex/instructions.md`.
- Antigravity: `~/.gemini/instructions.md`.
- JetBrains: `.aiassistant/rules/local-model-workers.md` in the project root
  (register it in Settings > Tools > AI Assistant > Rules).

The managed instruction block is delimited by `# local-model-workers-mcp:start`
and `# local-model-workers-mcp:end`. Existing user text outside those markers is
strictly preserved; a stale managed block is replaced in place. Unbalanced
markers fail closed and require manual repair. A custom `steering_prompt` from
global or project preferences is appended as a custom directive inside the
managed block.

Existing unrelated Claude JSON properties, MCP servers, and Codex TOML text are
preserved. A differing managed entry is classified as a conflict. Invalid JSON,
unbalanced managed markers, or duplicate managed Codex tables fail closed and
require manual repair. The displayed proposal contains only the replacement's
managed fields; it never echoes existing values that may be sensitive.

## Global preferences

`update_config` remains project-only. Change developer-wide editable defaults
with the local command:

```sh
local-model-workers-mcp configure-global \
  --default-model qwen/qwen3.5-9b \
  --steering-prompt "Prefer semantic search for descriptive queries." \
  --max-concurrency 2 \
  --processing-timeout-ms 600000 \
  --dry-run

local-model-workers-mcp configure-global \
  --default-model qwen/qwen3.5-9b \
  --steering-prompt "Prefer semantic search for descriptive queries." \
  --max-concurrency 2 \
  --processing-timeout-ms 600000 \
  --yes
```

The command accepts the documented limit names in kebab case, applies the same
strict schema and administrative maxima as runtime loading, and rejects a
default model absent from `LMW_ALLOWED_MODELS`. Protected connection, token,
allowlist, and fixed policy fields cannot be written.

## Atomicity and recovery

Each target is written through an owner-only temporary file in the same
directory, flushed, and atomically renamed. A failed write or rename removes the
temporary file and leaves the previous bytes in place. The proposal is bound to
a hash of the observed file; a change before confirmation is rejected as stale.

The assistant deliberately does not create automatic backups because an
existing harness file may contain credentials and a backup would duplicate
them. Before confirming replacement of an untracked conflicting entry, copy it
to a secure location yourself. For project `.mcp.json`, version control is the
preferred recovery path. For Codex, remove only the block between
`# local-model-workers-mcp:start` and `# local-model-workers-mcp:end`, or restore
your securely retained file. An interrupted write requires no cleanup unless an
orphan `.tmp` file is visible; it is never selected as active configuration.

## Troubleshooting

- Exit 64: the command or option is unknown.
- Exit 65: input or an existing managed configuration is unsafe to merge.
- Exit 77: the proposal needs explicit `--yes` confirmation.
- `not_configured`: no token was supplied; this is healthy for a trusted `lms`
  deployment.
- `authentication_not_enforced`: a token was supplied but LM Studio accepted an
  invalid one; remove the token for intentional `none` mode or enable enforcement.
- `model_unavailable`: load the exact protected allowlisted model identifier.

Use `configure-harness ... --dry-run` to inspect setup without touching files.
Diagnostic output is sent to stderr so MCP stdout remains protocol-only.
