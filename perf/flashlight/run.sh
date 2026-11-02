#!/usr/bin/env bash
# Runs the Flashlight scenarios in perf/flashlight/flows against the app on
# the connected Android device or emulator, and writes one JSON report per
# scenario to perf/reports/<date>-<scenario>.json.
#
#   perf/flashlight/run.sh                  # every scenario, 5 iterations
#   perf/flashlight/run.sh scroll-chat 3    # one scenario, 3 iterations
#   flashlight report perf/reports/*-scroll-chat.json   # compare runs
#
# Needs: flashlight (curl https://get.flashlight.dev | bash), maestro, adb,
# and a release build of the app installed and signed in. Debug builds load
# JS from Metro and are far slower, so their numbers are meaningless.
set -euo pipefail

APP_ID="com.phuocng23000.sdchat"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FLOWS="$ROOT/perf/flashlight/flows"
REPORTS="${REPORTS_DIR:-$ROOT/perf/reports}"
SCENARIO="${1:-all}"
ITERATIONS="${2:-5}"
STAMP="$(date +%Y%m%d-%H%M)"

for tool in flashlight maestro adb; do
  command -v "$tool" >/dev/null || { echo "$tool is not installed or not on PATH" >&2; exit 1; }
done
adb shell pm path "$APP_ID" >/dev/null || { echo "$APP_ID is not installed on the device" >&2; exit 1; }

mkdir -p "$REPORTS"

run_scenario() {
  local name="$1"
  echo "==> $name ($ITERATIONS iterations)"
  flashlight test \
    --bundleId "$APP_ID" \
    --testCommand "maestro test $FLOWS/$name.yaml" \
    --beforeEachCommand "adb shell am force-stop $APP_ID" \
    --iterationCount "$ITERATIONS" \
    --resultsTitle "$name $STAMP" \
    --resultsFilePath "$REPORTS/$STAMP-$name.json"
}

if [ "$SCENARIO" = "all" ]; then
  for flow in "$FLOWS"/*.yaml; do
    run_scenario "$(basename "$flow" .yaml)"
  done
else
  run_scenario "$SCENARIO"
fi

echo "Reports in $REPORTS. Open one with: flashlight report <file.json> [another.json ...]"
