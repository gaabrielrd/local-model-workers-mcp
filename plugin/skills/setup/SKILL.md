---
name: setup
description: Set up, configure, or diagnose the local-model-workers MCP server — connect LM Studio, Ollama, vLLM, or LocalAI, choose the default model and feature groups, and resolve errors about a missing default model, an unreachable provider, or a model outside the allowlist.
---

# Set up Local Model Workers

The plugin ships the MCP server, but the server needs two things the plugin
cannot supply: a **provider connection** (protected, environment-only) and a
**default model** (a global preference).

Work through the steps in order. Stop as soon as `check_health` is healthy.

## 1. Confirm what is already configured

Call `check_health` and `get_config`. They need no repository and return
redacted values. If health is `healthy` and a default model is routed, there is
nothing to do.

## 2. Point the server at the user's local model runtime

Connection settings are protected: they live in the process environment only, so
repository content and preference files can never weaken them. The plugin reads
them from Claude Code's environment.

The reliable place to set them is the `env` block of the user's Claude Code
settings (`~/.claude/settings.json`), which applies to the terminal, the desktop
app, and the IDE extensions alike:

```json
{
  "env": {
    "LMW_LM_STUDIO_BASE_URL": "http://localhost:1234/v1",
    "LMW_ALLOWED_MODELS": "[\"qwen/qwen3.5-9b\"]"
  }
}
```

- `LMW_LM_STUDIO_BASE_URL` — absolute `http(s)` URL ending in `/v1`, no
  credentials, query, or fragment. Defaults to `http://localhost:1234/v1` when
  unset. LM Studio serves `1234`, Ollama `11434/v1`, vLLM and LocalAI `8000/v1`.
- `LMW_ALLOWED_MODELS` — JSON array of model identifiers the server may use.
  Unset means "any served model".
- `LMW_LM_STUDIO_BEARER_TOKEN` — optional; blank selects no authentication,
  which is the expected posture for a trusted LAN.

For more than one runtime, set `LMW_PROVIDERS` instead: a JSON array of objects
with `name`, `type` (`lm-studio`, `ollama`, `vllm`, `localai`), `base_url`,
optional `bearer_token`, `allowed_models`, and `priority` (lower wins). It
replaces the single-provider variables.

Claude Code must restart to pick up a changed `env` block.

## 3. Set the default model and feature groups

These are global preferences, written by the CLI. Run it in a shell where the
same `LMW_*` variables are exported, because the command rejects a default model
that is absent from `LMW_ALLOWED_MODELS`:

```bash
npx -y local-model-workers-mcp@2.13.0 configure-global --default-model qwen/qwen3.5-9b --result-verbosity terse --dry-run
```

Show the proposal, then repeat with `--yes` instead of `--dry-run` to write it.

Feature groups decide which tools are registered: `exploration`
(`explore_repository`, `query_code_graph`, `search_semantic`,
`summarize_module`), `tests` (`propose_tests`, `auto_validate_tests`), `docs`
(`generate_docs_patch`, `analyze_diff`), and `lint` (`fix_lint_violations`,
`fix_type_errors`). `check_health`, `get_config`, `validate_config`,
`update_config`, and `get_offload_stats` are always available. Omitting the
preference registers every group.

## 4. Verify

Call `check_health` again. Then `/reload-plugins`, or restart Claude Code, if
the environment changed.

## Notes

- Do **not** run `local-model-workers-mcp setup` or `configure-harness --target
  claude-code` while the plugin is installed. Those write a second
  `local-model-workers` entry into `~/.claude.json` or the project `.mcp.json`,
  which duplicates the server the plugin already provides. Use the guided
  `setup` command only for harnesses other than Claude Code.
- The plugin pins the server version, so `npx` reuses its cache after the first
  run. Upgrades arrive through `/plugin update`.
- Node.js 24.18 or later is required, below Node 25.
- Per-project preferences live in `.local-model-workers.json` at the project
  root and are written through `validate_config` and `update_config`, never by
  hand.

## Common failures

| Symptom                                          | Cause and fix                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `invalid_configuration`, default model missing   | Step 3 was skipped                                                            |
| Provider unreachable                             | The runtime is not serving, or `LMW_LM_STUDIO_BASE_URL` lacks the `/v1` suffix |
| Model rejected                                   | It is absent from `LMW_ALLOWED_MODELS`                                        |
| `authentication_not_enforced`                    | A token was supplied but the runtime accepted an unauthenticated request      |
| Tools missing from the toolkit                   | The `enabled_features` preference excludes their group                        |
| Two `local-model-workers` servers listed         | A previous `configure-harness` entry coexists with the plugin; remove one     |
