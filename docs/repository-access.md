# Repository read capability

**Status:** Canonical read-only sandbox implemented
**Last reviewed:** 2026-08-02

## Public capability

Repository access is created for one validated root and exposes exactly three
methods:

- `listDirectory` for one bounded directory level;
- `searchText` for bounded recursive literal or safe-subset regular-expression
  search;
- `readSnippet` for a line-addressed bounded text excerpt.

There is no generic operation dispatcher and no write, command execution,
permission, process, or network method. The capability and returned values are
frozen.

Exploration input validation is transport-neutral. It requires a non-empty
`goal`, a non-empty `repository_root`, and at most 50 optional
`priority_paths`. The root and every priority path are authorized before a
capability is returned.

## Path authorization

The root must exist, canonicalize successfully, and be a directory. Its
filesystem device/inode identity is captured when the capability is created.
Every operation then:

1. verifies the canonical root identity again;
2. resolves an absolute or root-relative requested path with `realpath`;
3. uses component-aware relative-path containment, not a string prefix;
4. stats the canonical target;
5. performs the read against that canonical target, not an unresolved symlink;
6. verifies the root and target identities again before returning data.

An escaping symlink is rejected. If an authorized symlink changes after
resolution, the operation remains anchored to the original canonical in-root
target. If the root or target identity changes during the operation, the result
is discarded with `repository_access_denied`.

POSIX paths use case-sensitive component comparison. Windows paths use
`path.win32`, normalize separators, and compare case-insensitively. Successful
returned paths always use `/` as the portable repository-relative separator.
Real-filesystem package/start/configuration smoke coverage runs in the macOS,
Linux, and Windows release workflow; path semantics also have explicit POSIX and
Windows unit coverage.

## Operation limits

These fixed operational safety bounds prevent an individual internal read from
becoming unbounded. They do not replace the task-level configurable context
budget introduced in Task 006.

| Operation | Default | Maximum |
| --- | ---: | ---: |
| Directory entries | 100 | 500 |
| Search results | 20 | 100 |
| Search files visited | — | 2,000 |
| Total search bytes | — | 8 MiB |
| Search pattern | — | 128 characters |
| Search line considered | — | 4,096 characters |
| File read for search/snippet | — | 1 MiB |
| Snippet lines | 80 | 200 |
| Snippet returned bytes | — | 64 KiB |

Listings and traversal order are deterministic. Search does not follow
directory-entry symlinks recursively, which prevents loops; a specifically
requested in-root symlink is resolved and may be read. Unsupported text inside
a directory search is omitted and marks the result as truncated. Directly
requesting unsupported text fails closed.

Regular-expression search supports a deliberately bounded subset: grouping,
lookarounds, backreferences, and patterns with more than four quantifiers are
rejected. Literal search is the default. Neither mode accepts empty queries or
unknown fields.

## Structured failures

Failures use fixed messages and contain only a machine-readable code and
operation; raw paths and filesystem exception messages are not echoed. Codes
are `invalid_request`, `repository_not_found`,
`repository_access_denied`, and `context_limit_exceeded`.

## Outbound filtering layer

This capability establishes path containment and bounded text mechanics. The
implemented outbound collector then applies Git ignore handling, mandatory
secret/sensitive classification, binary detection, `.mcp-agent-ignore`,
interaction limits, and the effective task context budget before content can
become LM Studio context. See [content-filtering.md](content-filtering.md).
