#!/usr/bin/env bash
# MongoDB 8 stops at startup on Linux kernels 6.19 through 7.0.13 (its 8.0 release
# notes; a clash with its memory allocator). Exits 1 on one of those.
#   check-kernel.sh [version]      default: the running kernel
set -euo pipefail

VERSION="${1:-$(uname -r)}"
IFS='.-' read -r MAJOR MINOR PATCH _ <<<"$VERSION"
CODE=$((10#$MAJOR * 1000000 + 10#$MINOR * 1000 + 10#${PATCH:-0}))
if [ "$CODE" -ge 6019000 ] && [ "$CODE" -lt 7000014 ]; then
  cat >&2 <<EOF
Linux kernel $VERSION: MongoDB 8 refuses to start on kernels 6.19 through 7.0.13.
Ubuntu 24.04's standard kernel (6.8) is fine. Either change to it, then reboot and
run this again:
  sudo apt-get install -y linux-image-generic
  sudo apt-get remove -y linux-image-$VERSION      (the kernel you are on now)
  sudo reboot
or install kernel 7.0.14 or later. Your hosting provider may have its own kernel
setting. See docs/DEPLOY-DEMO.md, "Before you start".
EOF
  exit 1
fi
