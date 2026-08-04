#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_VERSION="2.2.0"
readonly MIN_NODE_MAJOR=24
readonly MIN_NODE_MINOR=18

interactive=1
from_source=0
target="all"
url=""

usage() {
  cat <<'EOF'
Usage: setup-wsl2.sh [options]

Bootstrap and configure the Local Model Workers MCP server inside WSL2.

Options:
  -y, --yes            Run non-interactively (equivalent to the server's --yes).
  --target <targets>   Harness targets to configure (default: all).
  --url <base-url>     LM Studio Base URL to pass to the server setup.
  --from-source        Build and run from the local repository checkout.
  -h, --help           Show this help and exit.

The server's own `setup` command performs the interactive questionnaire
(arrow keys, Space to toggle, Enter to confirm) unless --yes is given.
EOF
}

die() {
  printf "setup-wsl2: error: %s\n" "$*" >&2
  exit 1
}

info() {
  printf "setup-wsl2: %s\n" "$*"
}

require_wsl2() {
  if grep -qi microsoft /proc/version 2>/dev/null || [[ -n "${WSL_INTEROP:-}" ]]; then
    info "WSL2 environment detected."
  else
    info "WSL2 was not detected; continuing for plain Linux. This script targets WSL2."
  fi
}

require_node() {
  if ! command -v node >/dev/null 2>&1; then
    die "Node.js ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0+ is required but was not found. Install it inside WSL2 (e.g. via nvm or the NodeSource binary distribution) and re-run this script."
  fi
  local major minor
  major="$(node -p 'process.versions.node.split(".")[0]')"
  minor="$(node -p 'process.versions.node.split(".")[1]')"
  if (( major < MIN_NODE_MAJOR )) || (( major == MIN_NODE_MAJOR && minor < MIN_NODE_MINOR )); then
    die "Node.js ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0+ is required; found $(node -p 'process.versions.node')."
  fi
  info "Node.js $(node -p 'process.versions.node') detected."
}

run_setup() {
  local cmd=(setup --target "$target")
  if [[ -n "$url" ]]; then
    cmd+=(--url "$url")
  fi
  if (( interactive == 0 )); then
    cmd+=(--yes)
  fi
  (cd "$workdir" && "${run_args[@]}" "${cmd[@]}")
}

install_from_source() {
  if [[ -f "$(dirname "${BASH_SOURCE[0]}")/../package.json" ]]; then
    workdir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  else
    [[ -f "$workdir/package.json" ]] || die "--from-source requires a repository checkout (use --workdir)."
  fi
  info "Building the server from source in $workdir."
  (cd "$workdir" && npm ci && npm run build)
}

install_package() {
  if command -v local-model-workers-mcp >/dev/null 2>&1; then
    info "The global command local-model-workers-mcp is already installed."
  else
    info "Installing the server package globally from the npm registry."
    npm install --global local-model-workers-mcp
  fi
}

while (( $# > 0 )); do
  case "$1" in
    -y | --yes) interactive=0 ;;
    --target) shift; target="${1:?--target requires a value}" ;;
    --target=*) target="${1#*=}" ;;
    --url) shift; url="${1:?--url requires a value}" ;;
    --url=*) url="${1#*=}" ;;
    --from-source) from_source=1 ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

require_wsl2
require_node

if (( from_source == 1 )); then
  install_from_source
  run_args=(node dist/cli/index.js)
else
  install_package
  workdir="$(pwd)"
  run_args=(local-model-workers-mcp)
fi

run_setup

info "Setup finished. Start your editor in the configured project to pick up the MCP server, then confirm with check_health."
info "When LM Studio runs on the Windows host, use localhost with WSL2 mirrored networking, otherwise the Windows host IP for the --url value."
