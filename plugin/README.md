# Local Model Workers — Claude Code plugin

This directory is the Claude Code plugin wrapper around
[`local-model-workers-mcp`](https://github.com/gaabrielrd/local-model-workers-mcp).
It bundles the MCP server plus two skills, so installing the plugin is the only
step a Claude Code user needs beyond pointing the server at their own model
runtime.

## Install

```sh
/plugin marketplace add gaabrielrd/local-model-workers-mcp
/plugin install local-model-workers@gaabrielrd
```

Then run the `setup` skill, which walks through the provider connection and the
default model:

```sh
/local-model-workers:setup
```

## What it contains

| Path                                | Purpose                                                                |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `.claude-plugin/plugin.json`        | Plugin manifest                                                        |
| `.mcp.json`                         | Starts `npx local-model-workers-mcp@<version>` over stdio               |
| `skills/offload-to-local-models/`   | Tells Claude when to route work to the tools instead of scanning files  |
| `skills/setup/`                     | Guided configuration and troubleshooting                               |

## Configuration

Provider connection settings are protected and read from the environment only.
Set them in the `env` block of `~/.claude/settings.json` so they reach the
server in the terminal, the desktop app, and the IDE extensions:

```json
{
  "env": {
    "LMW_LM_STUDIO_BASE_URL": "http://localhost:1234/v1",
    "LMW_ALLOWED_MODELS": "[\"qwen/qwen3.5-9b\"]"
  }
}
```

`.mcp.json` forwards `LMW_LM_STUDIO_BASE_URL`, `LMW_LM_STUDIO_BEARER_TOKEN`,
`LMW_ALLOWED_MODELS`, `LMW_PROVIDERS`, and
`LMW_PROVIDER_RECHECK_INTERVAL_MS`, each with a fallback so an unset variable
never blocks startup. The base URL falls back to `http://localhost:1234/v1`.

Do not also run `local-model-workers-mcp configure-harness --target
claude-code`. That writes a second server entry alongside the one the plugin
provides.

## Maintenance

The version appears in three places that must agree: the root `package.json`,
`plugin/.claude-plugin/plugin.json`, and the pinned `npx` argument in
`plugin/.mcp.json` (the marketplace entry mirrors it). `npm run check:plugin`
verifies this and runs in CI.

```sh
npm run check:plugin
claude plugin validate ./plugin --strict
```
