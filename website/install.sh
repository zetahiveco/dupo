#!/bin/sh
# Dupo installer for macOS and Linux.
# Usage: curl -fsSL https://dupo.vercel.app/install.sh | sh
set -eu

REPO="zetahiveco/dupo"
APP="dupo"

echo "Installing Dupo..."

OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="darwin" ;;
  Linux) PLATFORM="linux" ;;
  *)
    echo "Unsupported OS: $OS. See https://github.com/$REPO for build instructions." >&2
    exit 1
    ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) TARGET="${PLATFORM}-x86_64" ;;
  arm64|aarch64) TARGET="${PLATFORM}-aarch64" ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

# Pick the newest published release.
if command -v gh >/dev/null 2>&1; then
  VERSION="$(gh release list -R "$REPO" --limit 1 --json tagName --jq '.[0].tagName' 2>/dev/null || true)"
fi
if [ -z "${VERSION:-}" ]; then
  LATEST_URL="https://api.github.com/repos/$REPO/releases/latest"
  VERSION="$(curl -fsSL "$LATEST_URL" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p')"
fi
if [ -z "${VERSION:-}" ]; then
  echo "Could not determine the latest release. Download manually from https://github.com/$REPO/releases" >&2
  exit 1
fi

ASSET="${APP}-${TARGET}.tar.gz"
URL="https://github.com/$REPO/releases/download/$VERSION/$ASSET"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading $ASSET ($VERSION)..."
curl -fSL "$URL" -o "$TMP/$ASSET"

tar -xzf "$TMP/$ASSET" -C "$TMP"

if [ "$(id -u)" = "0" ]; then
  DEST="/usr/local/bin"
else
  DEST="/usr/local/bin"
  if [ ! -w "$DEST" ]; then DEST="$HOME/.local/bin"; mkdir -p "$DEST"; fi
fi

install "$TMP/$APP" "$DEST/$APP"
echo "Installed $DEST/$APP ($VERSION)."
case ":$PATH:" in
  *":$DEST:"*) ;;
  *) echo "Note: add $DEST to your PATH." ;;
esac
echo "Run 'dupo' to start designing."
