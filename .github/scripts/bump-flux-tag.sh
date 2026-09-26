#!/usr/bin/env bash
# Deploys an image tag just pushed to GHCR: commits <tag>-<arch> as APP_IMAGE_TAG in each given
# cluster app Kustomization on the `deployment` branch, which is the only branch Flux reads. Called by
# the <app>-bump-tag jobs in ci.yml from a checkout of `deployment`; master is never written.
#
#   bump-flux-tag.sh <app> <tag> <cluster-file>:<arch> [<cluster-file>:<arch> ...]
#
# <tag> is <run_number>-<sha7>. Each attempt starts from the current origin/deployment and re-applies
# the edit, so a concurrent push is retried without rebase conflicts. A file already on a newer run
# number is left alone, so an older run finishing last can't roll the cluster back. Each file must
# have exactly one `APP_IMAGE_TAG:` line (sed rewrites every match). sed writes via a temp file (no
# `sed -i`) so the script behaves the same with GNU and BSD sed. Plain git + sed, no extra tools.
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "::error::Usage: $0 <app> <tag> <cluster-file>:<arch> [...]"
  exit 1
fi
APP=$1
TAG=$2
shift 2
TARGETS=("$@")

if ! [[ "$TAG" =~ ^[0-9]+-[0-9a-f]{7}$ ]]; then
  echo "::error::Unexpected image tag '$TAG' (want <run_number>-<sha7>)"
  exit 1
fi
FILES=()
for t in "${TARGETS[@]}"; do FILES+=("${t%:*}"); done
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

for attempt in 1 2 3; do
  git fetch origin deployment
  git reset --hard origin/deployment
  for t in "${TARGETS[@]}"; do
    f=${t%:*}
    want="$TAG-${t##*:}"
    if [ ! -f "$f" ]; then
      echo "::error::$f is not on the deployment branch; merge master into deployment first"
      exit 1
    fi
    cur=$(sed -nE 's/^[[:space:]]*APP_IMAGE_TAG:[[:space:]]*"?([^"#[:space:]]*)"?.*/\1/p' "$f")
    if [[ "$cur" =~ ^([0-9]+)-[0-9a-f]{7}(-(amd64|arm64))?$ ]] && (( BASH_REMATCH[1] >= ${TAG%%-*} )); then
      echo "$f is already on $cur, not replacing it with $want"
      continue
    fi
    sed -E "s/^([[:space:]]*APP_IMAGE_TAG:).*/\1 \"$want\"/" "$f" > "$f.tmp"
    mv "$f.tmp" "$f"
    if [ "$(grep -cE "^[[:space:]]*APP_IMAGE_TAG: \"$want\"$" "$f")" != 1 ]; then
      echo "::error::$f: APP_IMAGE_TAG was not set to $want"
      exit 1
    fi
  done

  if git diff --quiet; then
    echo "Nothing to commit"
    exit 0
  fi
  git commit -m "chore($APP): deploy image $TAG" -- "${FILES[@]}"
  if git push origin HEAD:deployment; then
    exit 0
  fi
  echo "Push rejected (attempt $attempt), retrying on the new deployment"
done
echo "::error::Could not push the tag bump to deployment after 3 attempts"
exit 1
