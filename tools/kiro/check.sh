#!/usr/bin/env bash
# Runs every check this repo has. Called by the Kiro hook "tests-after-spec-task" and usable by hand:
#   tools/kiro/check.sh            bridge tests, site typecheck + build, mod tests (when JDK 25 is installed)
#   tools/kiro/check.sh bridge     only one part: bridge | site | mod
set -u
cd "$(dirname "$0")/../.."
want="${1:-all}"
fail=0

run() {
  local name="$1"; shift
  echo "== $name"
  if "$@"; then echo "   ok: $name"; else echo "   FAILED: $name"; fail=1; fi
}

if [[ "$want" == all || "$want" == bridge ]]; then
  run "bridge tests (node --test)" npm --prefix bridge test --silent
fi

if [[ "$want" == all || "$want" == site ]]; then
  if [[ -d landing_page/site/node_modules ]]; then
    run "site typecheck" npm --prefix landing_page/site run -s typecheck
    run "site build" npm --prefix landing_page/site run -s build
  else
    echo "== site: skipped (run npm install in landing_page/site first)"
  fi
fi

if [[ "$want" == all || "$want" == mod ]]; then
  java_major=$(java -version 2>&1 | sed -nE 's/.*version "([0-9]+).*/\1/p' | head -1)
  if [[ -n "$java_major" && "$java_major" -ge 25 ]]; then
    run "mod tests (gradle)" bash -c 'cd mod && ./gradlew test --quiet'
  else
    echo "== mod: skipped (needs JDK 25, found ${java_major:-none})"
  fi
fi

exit $fail
