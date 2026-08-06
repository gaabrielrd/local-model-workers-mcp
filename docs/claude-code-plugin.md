# Claude Code plugin distribution

**Status:** Plugin and marketplace manifests implemented; official-directory
submission pending
**Last reviewed:** 2026-08-06

Claude Code can install the server as a plugin instead of through
`configure-harness`. A plugin bundles the MCP server definition with the
skills that tell the agent when to use its tools, so one install replaces the
harness registration and the managed steering block in `CLAUDE.md`.

## Layout

The repository is both the plugin source and its marketplace.

| Path                                   | Role                                                       |
| -------------------------------------- | ---------------------------------------------------------- |
| `.claude-plugin/marketplace.json`       | Marketplace `gaabrielrd`, listing the plugin at `./plugin`  |
| `plugin/.claude-plugin/plugin.json`     | Plugin manifest, name `local-model-workers`                 |
| `plugin/.mcp.json`                      | stdio server: `npx -y local-model-workers-mcp@<version>`    |
| `plugin/skills/offload-to-local-models/` | Tool-routing guidance, loaded on demand                    |
| `plugin/skills/setup/`                  | Provider connection, default model, troubleshooting        |

The root `.mcp.json` is unrelated: it is this repository's own development
configuration and is not part of the plugin, whose root is `plugin/`.

## Install

```sh
/plugin marketplace add gaabrielrd/local-model-workers-mcp
/plugin install local-model-workers@gaabrielrd
```

## Configuration reaches the server through Claude Code's environment

Protected connection settings stay environment-only, exactly as documented in
[configuration.md](configuration.md). A plugin cannot prompt, so `.mcp.json`
forwards each `LMW_*` variable with `${VAR:-default}` expansion, which Claude
Code resolves from its own process environment. Every forwarded variable has a
fallback, so an unset variable never blocks startup:

- `LMW_LM_STUDIO_BASE_URL` falls back to `http://localhost:1234/v1`;
- an empty `LMW_ALLOWED_MODELS` resolves to `*`;
- an empty `LMW_PROVIDERS` leaves single-provider mode active;
- an empty `LMW_LM_STUDIO_BEARER_TOKEN` selects `none`;
- an empty `LMW_PROVIDER_RECHECK_INTERVAL_MS` selects the 60 s default.

Users set the real values in the `env` block of `~/.claude/settings.json`, which
applies to the terminal, the desktop app, and the IDE extensions alike. A shell
export only reaches Claude Code when it is launched from that shell.

`default_model` remains a global preference with no built-in value, so the
`setup` skill directs users to `configure-global --default-model` rather than to
the guided `setup` command, which would also write a duplicate harness entry.

## Steering without editing `CLAUDE.md`

The managed block in `CLAUDE.md` is the harness-registration path only. Under
the plugin the same directives ship as the `offload-to-local-models` skill,
which loads when the task matches its description rather than occupying context
in every session. The two paths must not be combined: a user who installs the
plugin should not also run `configure-harness --target claude-code`.

Skill content and `steering.ts` state the same rules and drift independently.
When the tool set or the routing rules change, update both.

## Version pinning

`plugin/.mcp.json` pins the published server version so a plugin install is
reproducible and `npx` reuses its cache. That version, the plugin manifest
version, the marketplace entry version, and `package.json` must agree.
`npm run check:plugin` enforces it and runs in the validate workflow.

Releasing therefore means bumping `package.json`, running `npm run check:plugin`
to see which files lag, updating them, and pushing. Users receive the new
version through `/plugin update`.

## Local verification

```sh
npm run check:plugin
claude plugin validate ./plugin --strict
claude plugin validate . --strict
claude plugin marketplace add .
```

## Official directory submission

The plugin is installable from this repository today without review. Listing it
in Anthropic's official directory is a separate, optional step through the
plugin directory submission form at <https://clau.de/plugin-directory-submission>;
external plugins are reviewed against quality and security standards. The
community marketplace `anthropics/claude-plugins-community` accepts third-party
plugins that pass automated validation and safety screening.

Marketplace names that impersonate an official Anthropic source are blocked, so
the marketplace here is named after its owner.
