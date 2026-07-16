#!/bin/bash
#
# setup.command — double-click this on your Mac to open GlassMail in Xcode.
#
# It will:
#   1. Use the bundled GlassMail.xcodeproj if it opens cleanly, OR
#   2. Regenerate a guaranteed-valid project with XcodeGen (installing it
#      via Homebrew if needed), then open it.
#
set -e
cd "$(dirname "$0")"

echo "──────────────────────────────────────────────"
echo "  GlassMail setup"
echo "──────────────────────────────────────────────"

# Prefer the pre-generated project — just open it.
if [ -d "GlassMail.xcodeproj" ]; then
  echo "Opening GlassMail.xcodeproj …"
  open GlassMail.xcodeproj
  echo
  echo "If Xcode reports a project-format problem, close it and press"
  echo "ENTER here to regenerate the project with XcodeGen instead."
  read -r _

  # If the user pressed enter, fall through to regeneration.
fi

echo "Setting up XcodeGen (one-time)…"
if ! command -v xcodegen >/dev/null 2>&1; then
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew not found. Installing Homebrew…"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
  echo "Installing XcodeGen…"
  brew install xcodegen
fi

echo "Generating a fresh GlassMail.xcodeproj…"
xcodegen generate

echo "Opening GlassMail.xcodeproj…"
open GlassMail.xcodeproj

echo "Done. In Xcode: pick a Simulator (or your Mac) and press ⌘R to run."
