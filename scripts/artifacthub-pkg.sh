#!/usr/bin/env bash
# Writes the Artifact Hub metadata for one released version into
# artifacthub/<version>/: artifacthub-pkg.yml, pointing at the release
# archive by URL and SHA-256, and the README Artifact Hub shows.
#
#   scripts/artifacthub-pkg.sh 0.1.0 bitswalk-headlamp-kind-0.1.0.tar.gz <sha256>
set -euo pipefail

version="${1:?usage: $0 <version> <archive name> <sha256>}"
archive="${2:?usage: $0 <version> <archive name> <sha256>}"
digest="${3:?usage: $0 <version> <archive name> <sha256>}"
[[ "$digest" =~ ^[0-9a-f]{64}$ ]] || { echo "Not a SHA-256 digest: $digest" >&2; exit 1; }

root="$(cd "$(dirname "$0")/.." && pwd)"
repo=https://github.com/bitswalk/k3dlamp-kind-plugin
dir="$root/artifacthub/$version"
mkdir -p "$dir"
cp "$root/README.md" "$dir/README.md"

cat >"$dir/artifacthub-pkg.yml" <<EOF
version: $version
name: k3dlamp-kind-plugin
displayName: kind for k3dlamp
createdAt: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
description: >-
  Create and delete kind clusters from Headlamp Desktop. Works only in a Headlamp
  desktop build whose app-build-manifest.json grants this plugin three kind
  commands and passes them standard input, such as k3dlamp. Stock Headlamp
  releases don't.
license: Apache-2.0
homeURL: $repo
logoURL: https://raw.githubusercontent.com/bitswalk/k3dlamp/main/branding/overlay/frontend/public/android-chrome-512x512.png
keywords:
  - kind
  - kubernetes in docker
  - local cluster
  - k3dlamp
links:
  - name: Source
    url: $repo
  - name: k3dlamp
    url: https://github.com/bitswalk/k3dlamp
install: |
  This plugin works only in a Headlamp desktop build whose
  \`app-build-manifest.json\` grants it three kind commands.
  [k3dlamp](https://github.com/bitswalk/k3dlamp) is such a build; stock Headlamp
  releases aren't. See [Requirements]($repo#requirements) for the grants.
annotations:
  headlamp/plugin/archive-url: "$repo/releases/download/v$version/$archive"
  headlamp/plugin/archive-checksum: "sha256:$digest"
  headlamp/plugin/distro-compat: "app"
EOF

echo "Wrote artifacthub/$version/"
