#!/usr/bin/env bash
# Lists RSSHub commits newer than the ones recorded in UPSTREAM.md for the files rssgate was ported from.
# Usage: RSSHUB_DIR=/path/to/RSSHub scripts/check-upstream.sh
set -euo pipefail
cd "$(dirname "$0")/.."
RSSHUB_DIR="${RSSHUB_DIR:-/run/media/sur/hdd/opensource/RSSHub}"
BRANCH="${RSSHUB_BRANCH:-origin/master}"

git -C "$RSSHUB_DIR" fetch -q "${BRANCH%%/*}"

# rows of the table: | `src/...` | `a`, `b` | commit |
grep -E '^\| `src/' UPSTREAM.md | while IFS='|' read -r _ ours files commit _; do
    ours=$(echo "$ours" | tr -d '` ')
    commit=$(echo "$commit" | tr -d ' ')
    paths=()
    while read -r path; do
        paths+=("lib/routes/$path")
    done < <(echo "$files" | grep -o '`[^`]*`' | tr -d '`')
    log=$(git -C "$RSSHUB_DIR" log --oneline "$commit..$BRANCH" -- "${paths[@]}" || true)
    echo "== $ours (since $commit)"
    if [ -z "$log" ]; then echo "   up to date"; else echo "$log" | sed 's/^/   /'; fi
done
