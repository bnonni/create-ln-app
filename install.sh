#!/usr/bin/env bash
# Makes a Lightning app with create-ln-app.
#
#   curl -fsSL https://create-ln-app.dev/install.sh | bash -s -- my-lapp
#
# This script does not install Node.js or Docker, and it does not use sudo.
# It checks Node.js, npm, and Docker Compose. Then it runs npx create-ln-app with your arguments.
# The body is in main, and the last line calls main. Thus a partial download does nothing.
# The syntax is for Bash 3.2, the Bash of macOS.

set -euo pipefail

MIN_NODE_MAJOR=24
NODE_URL='https://nodejs.org/en/download'
DOCKER_URL='https://docs.docker.com/engine/install/'
WINDOWS_URL='https://github.com/bnonni/create-ln-app#windows'

fail() {
  printf 'Error: %s\n' "$1" >&2
  printf 'Fix: %s\n' "$2" >&2
  exit 1
}

main() {
  if [ "$#" -eq 0 ]; then
    fail 'The project name is missing.' \
      'Give the name after --, for example: curl -fsSL https://create-ln-app.dev/install.sh | bash -s -- my-lapp'
  fi

  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*)
      fail 'This script does not run on Git Bash, MSYS, or Cygwin.' \
        "Use WSL2 (Ubuntu). See $WINDOWS_URL"
      ;;
  esac

  local node_path
  node_path=$(command -v node || true)
  if [ -z "$node_path" ]; then
    fail 'Node.js is missing.' "Install Node.js $MIN_NODE_MAJOR or later from $NODE_URL"
  fi
  # In WSL2, Ubuntu can find the Windows Node.js through the Windows PATH.
  case "$node_path" in
    /mnt/*)
      fail "Ubuntu uses the Windows Node.js ($node_path)." \
        "Install Node.js $MIN_NODE_MAJOR or later in Ubuntu. See $WINDOWS_URL"
      ;;
  esac

  local node_version node_major
  node_version=$(node --version)
  node_version=${node_version#v}
  node_major=${node_version%%.*}
  case "$node_major" in
    '' | *[!0-9]*)
      fail "The Node.js version '$node_version' is not valid." "Install Node.js $MIN_NODE_MAJOR or later from $NODE_URL"
      ;;
  esac
  if [ "$node_major" -lt "$MIN_NODE_MAJOR" ]; then
    fail "Node.js $MIN_NODE_MAJOR or later is necessary. You have Node.js $node_version." \
      "Install Node.js $MIN_NODE_MAJOR or later from $NODE_URL"
  fi

  if ! command -v npx > /dev/null 2>&1; then
    fail 'npm is missing.' "Install Node.js $MIN_NODE_MAJOR or later from $NODE_URL. The installer includes npm."
  fi

  # The CLI makes the project with no Docker, so a missing Docker Compose does not stop the script.
  if ! docker compose version > /dev/null 2>&1; then
    printf 'Warning: Docker Compose v2 is missing. npm run dev needs it.\n' >&2
    printf 'Fix: install Docker from %s\n' "$DOCKER_URL" >&2
  fi

  # CI sets CREATE_LN_APP_PACKAGE to the packed CLI.
  local package=${CREATE_LN_APP_PACKAGE:-create-ln-app@latest}
  # With curl | bash, stdin is the script. Thus npx must not read stdin.
  npx --yes --package "$package" create-ln-app "$@" < /dev/null
}

# Bash 3.2 with set -u stops on "$@" if there are no arguments, so use ${1+"$@"}.
main ${1+"$@"}
