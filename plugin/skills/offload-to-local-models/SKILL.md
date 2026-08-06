---
name: offload-to-local-models
description: Route heavy repository work to the local-model-workers MCP tools instead of reading and scanning files directly. Use when exploring an unfamiliar codebase, searching code by intent or natural language, finding callers, dependencies or exports of a symbol, summarizing a file or directory, writing unit tests, generating documentation, summarizing a commit diff, or repairing linter and type-checker output.
---

# Offload repository work to local model tools

The `local-model-workers` MCP server delegates expensive repository work to a
model running on the user's own machine or LAN. Every tool is read-only against
the repository: patches come back as validated, unapplied unified diffs that you
decide whether to apply.

Using these tools instead of scanning files yourself keeps the conversation
short and keeps repository content on the user's network.

## Rules

- Do not echo large tool results verbatim into the conversation. Reference paths
  and summarize findings instead.
- Prefer a targeted `query_code_graph`, `search_semantic`, or `summarize_module`
  call over a broad `explore_repository` when a focused lookup suffices.
- Every tool takes an absolute `repository_root`. Pass the project root, not a
  subdirectory, unless the user asked to scope the work.
- Patches are proposals. Show the diff and let the user decide; never apply one
  silently.

## Which tool to reach for

| Situation                                                     | Tool                                          |
| ------------------------------------------------------------- | --------------------------------------------- |
| Understand an unfamiliar area, goal stated in prose            | `explore_repository`                          |
| Find code by intent ("where do we retry failed uploads?")      | `search_semantic`                             |
| Callers, dependencies, exports, or definition of a symbol      | `query_code_graph`                            |
| Structured summary of one file or directory                    | `summarize_module`                            |
| Propose unit tests as an unapplied diff                        | `propose_tests`                               |
| Generate tests and iterate until they pass in a sandbox copy   | `auto_validate_tests`                         |
| Docstrings, JSDoc, or a `docs/<slug>.md` guide                 | `generate_docs_patch`                         |
| Explain what a commit range changed and its architectural impact | `analyze_diff`                              |
| Repair reported linter violations                              | `fix_lint_violations` (pass the linter output) |
| Repair compiler or type-checker errors                         | `fix_type_errors` (pass the checker output)   |
| Provider reachability, model routing, configuration            | `check_health`, `get_config`                  |
| Tokens and queries saved by offloading                         | `get_offload_stats`                           |

`auto_validate_tests` reports progress as it iterates. Do not echo its
iteration output; wait for the final patch.

`update_config` writes project preferences and requires an explicit
confirmation value. Ask the user before calling it, and use `validate_config`
first to show what would change.

## When a call fails

- `invalid_configuration` mentioning a default model or an unreachable provider
  means the server was never set up. Run the `setup` skill from this plugin.
- Tools outside the enabled feature groups are simply not registered. If a tool
  you expect is missing, the user's `enabled_features` preference excludes it —
  the `setup` skill covers changing it.
- Fall back to reading files directly when the server is unavailable, and tell
  the user why.
