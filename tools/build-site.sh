#!/usr/bin/env bash
# Builds the website into _site/ (used by GitHub Pages and Cloudflare Pages).
# Cloudflare Pages settings: build command "bash tools/build-site.sh", output directory "_site".
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf _site
mkdir _site
cp -r index.html friends.html privacy.html delete-data.html sw-register.js betting.js version.js \
      poker.js game.js friends.js config.js style.css sw.js manifest.webmanifest icons vendor CNAME .well-known _site/

# Stamp the build commit and date into the release line (GitHub Actions or Cloudflare Pages).
SHA="${GITHUB_SHA:-${CF_PAGES_COMMIT_SHA:-}}"
if [ -n "$SHA" ]; then
  sed -i "s/buildSha: ''/buildSha: '${SHA:0:7}'/" _site/version.js
  grep -q "buildSha: '${SHA:0:7}'" _site/version.js
fi
sed -i "s/buildDate: ''/buildDate: '$(date -u +%F)'/" _site/version.js

# The Android verification file and custom domain must be published.
test -f _site/.well-known/assetlinks.json
test -f _site/CNAME
echo "Built _site/ ($(find _site -type f | wc -l) files)"
