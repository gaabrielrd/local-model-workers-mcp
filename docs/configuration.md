# Configuration model

**Status:** Contract outline; schema and filenames are not implemented  
**Last reviewed:** 2026-08-02

## Principles

Configuration is split by authority so repository content cannot weaken
administrative controls or expose credentials.

| Layer | Purpose | Changed by MCP tools | May contain secrets |
| --- | --- | --- | --- |
| Protected | Credentials, LM Studio address, allowed models, and administrative maxima | No | Yes, through a protected mechanism |
| Global preferences | Developer defaults shared across projects | No; changed by a local command | No |
| Project preferences | Editable per-project values | Yes, through confirmed `update_config` | No |
| Built-in defaults | Safe fallback values shipped with the server | No | No |

Protected limits always win. For editable fields, project preferences override
global preferences, which override built-in defaults.

## Protected settings

The protected layer includes at least:

- LM Studio base address;
- Bearer token;
- allowed model policy;
- administrative maxima for concurrency, queue time, processing time,
  exploration interactions, context, and patch size.

The concrete environment-variable names and any protected configuration file
format are intentionally unspecified until implementation. They must be added
to a redacted `.env.example` and this document in the same change that introduces
them. Credentials must never be stored in agent-editable JSON.

## Editable preferences

The global and project schemas may expose only explicitly allowed preferences,
bounded by protected maxima. Based on the approved PRD, editable behavior may
include the default model (within the protected allowlist) and default limits
for exploration interactions, concurrency, queue time, and processing time where
the administrative policy permits it.

The exact editable-field list, types, units, defaults, and ranges must be
defined before `validate_config` or `update_config` is implemented. Do not infer
them from examples or silently accept unknown fields.

## MCP configuration tools

- `get_config` returns the effective value, origin, and revision for each
  visible setting. Secrets and credentials are always redacted.
- `validate_config` checks a proposed change, allowed fields, types, ranges, and
  expected revision without writing.
- `update_config` requires explicit harness confirmation and the current
  expected revision. It writes only project preferences, atomically, and returns
  old values, new values, changed fields, and the new revision.

A revision conflict, protected field, invalid proposal, or missing confirmation
must leave the current file unchanged. Active tasks retain their starting
revision; only later tasks observe an update.

## Project exclusions

A repository may provide `.mcp-agent-ignore` to add exclusion patterns. It can
only remove access. It cannot re-enable a path prohibited by built-in security
rules, Git ignore status, secret classification, binary detection, or root
containment.

## Configuration implementation checklist

Before configuration support is considered complete:

- choose and document global and project storage locations;
- define a versioned schema and revision representation;
- define the protected-setting names and loading mechanism;
- add a redacted `.env.example` if environment variables are used;
- implement atomic write and recovery behavior;
- document all fields, types, units, defaults, and ranges;
- test precedence, redaction, unknown fields, protected fields, stale revisions,
  interrupted writes, and task revision snapshots;
- update installation examples for both harnesses without embedding secrets.

## Current limitations

No configuration file, schema, CLI, environment-variable contract, or
`.env.example` exists today. Accordingly, there is no supported local setup to
copy or execute yet.
