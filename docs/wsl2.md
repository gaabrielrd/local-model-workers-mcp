# WSL2 native setup

**Status:** Implemented (v2.2.0)

Windows developers who run the MCP server inside a Linux container can use the
official WSL2 setup script, which complements the [Dockerfile](../Dockerfile).
The script bootstraps the Node.js runtime prerequisites, installs the server
package, and delegates the interactive questionnaire to the server's own
`setup` command.

## Prerequisites

- Windows 10/11 with **WSL2** and a Linux distribution (Ubuntu, Debian, or
  compatible) installed and set as default.
- **Node.js 24.18.0+** inside WSL2 (the same baseline as the server). Install it
  with your distro's package manager, `nvm`, or the NodeSource binary
  distribution:

  ```sh
  # example with nvm inside WSL2
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  nvm install 24
  nvm use 24
  ```

- LM Studio running on the Windows host, reachable from WSL2 (see
  [Connecting to LM Studio](#connecting-to-lm-studio-on-the-windows-host)).

## Interactive setup

Run the script inside the WSL2 terminal; it prompts for everything:

```sh
curl -fsSL https://raw.githubusercontent.com/gaabrielrd/local-model-workers-mcp/main/scripts/wsl2/setup-wsl2.sh | bash
```

or, from a local checkout:

```sh
./scripts/wsl2/setup-wsl2.sh --from-source
```

The script verifies WSL2, checks the Node.js version, installs the
`local-model-workers-mcp` package globally (or builds the checkout), and then
starts the interactive `setup` questionnaire: arrow keys to move, `Space` to
toggle harness and feature checkboxes, `Enter` to confirm, `Ctrl+C` to cancel.

## Non-interactive setup

Automated and scripted environments pass `--yes` (and optionally `--url` and
`--target`):

```sh
./scripts/wsl2/setup-wsl2.sh --yes \
  --target all \
  --url http://localhost:1234/v1
```

Other options:

| Option | Meaning |
| --- | --- |
| `-y`, `--yes` | Run non-interactively (same as the server's `--yes`). |
| `--target <targets>` | Harness targets (default `all`). |
| `--url <base-url>` | LM Studio Base URL passed to `setup`. |
| `--from-source` | Build and run from the local repository checkout. |
| `-h`, `--help` | Show the script help. |

The exported protected environment variable `LMW_PROVIDERS` is still respected
when running inside WSL2.

## Connecting to LM Studio on the Windows host

WSL2 networking determines which address the server uses to reach LM Studio:

- **Windows 11 with mirrored networking**: `http://localhost:1234/v1` inside
  WSL2 reaches the Windows host directly. Pass it with `--url`.
- **Windows 10 / NAT networking**: use the Windows host IP. Find it with:

  ```sh
  ip route show default | awk '{print $3}'
  ```

  then pass `--url http://<windows-host-ip>:1234/v1`.

Ensure LM Studio listens on `0.0.0.0` (not only `127.0.0.1`) when connecting
from WSL2 over NAT, and keep the deployment on a trusted private network.

## Docker alternative

For a containerized run without a WSL2 toolchain, build and run the image:

```sh
docker build -t local-model-workers-mcp .
docker run --rm -i \
  -e LMW_PROVIDERS='[{"name":"lm-studio","type":"lm-studio","base_url":"http://host.docker.internal:1234/v1","allowed_models":["qwen/qwen3.5-9b"],"priority":0,"tls_verify":false}]' \
  local-model-workers-mcp
```

The image starts the compiled CLI entrypoint (`node dist/cli/index.js`).

## Troubleshooting

- `Node.js 24.18.0+ is required` — install a current Node.js inside WSL2 and
  re-run the script.
- `local-model-workers-mcp: error: ...` — the script surfaces errors on stderr;
  run the script with the failing command manually to inspect the underlying
  setup exit code (see [installation.md](installation.md) for exit codes).
- LM Studio is unreachable — verify the host IP/`localhost` reachability and
  that LM Studio binds a listenable address as described above.
