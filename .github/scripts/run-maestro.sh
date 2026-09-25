#!/usr/bin/env bash
# Runs the Maestro suite in a fixed order against the installed app.
# Flows share state (logged-in account, the DM with "Android Simulator"),
# so order matters and each flow runs as its own `maestro test` call.
# Every flow runs even if an earlier one fails; teardown always runs.
# Requires EMAIL and PASSWORD in the environment.
set -uo pipefail

OUT=maestro-results
mkdir -p "$OUT"

# Keep the device log: a release build shows no red screen, so crashes and
# JS errors ("AndroidRuntime", "ReactNativeJS") only show up here.
adb logcat -c
adb logcat -v time > "$OUT/logcat.txt" 2>&1 &
LOGCAT_PID=$!
trap 'kill "$LOGCAT_PID" 2>/dev/null' EXIT

# Not run in CI:
#   login.yaml, login-ios.yaml     expect a dev-client build ("Downloading…") and
#                                  an account whose keys are already on the device
#   send-images.yaml, send-files.yaml,
#   create-account-with-picture.yaml
#                                  pick specific files from the device's gallery
#   create-account-without-picutre-enable-biometric-authentication.yaml
#                                  needs an enrolled fingerprint
FLOWS=(
  maestro/send-messages.yaml
  maestro/send-emojies.yaml
  maestro/send-reaction.yaml
  maestro/edit-message.yaml
  maestro/forward-message.yaml
  maestro/forward-cancel-then-send.yaml
  maestro/delete-message.yaml
  maestro/interactive-users.yaml
  maestro/search-bar.yaml
  maestro/toggle-darkmode.yaml
  maestro/change-display-name.yaml
  maestro/change-password.yaml
)

run_flow() {
  local flow=$1 name
  name=$(basename "$flow" .yaml)
  echo "::group::$name"
  maestro test "$flow" \
    -e MAESTRO_EMAIL="$EMAIL" -e MAESTRO_PASSWORD="$PASSWORD" -e MAESTRO_USER="$USER" \
    --format junit --output "$OUT/$name.xml" \
    --test-output-dir "$OUT/$name"
  local status=$?
  echo "::endgroup::"
  return $status
}

failed=()

if ! run_flow maestro/ci/setup-account.yaml; then
  echo "::error::Account setup failed; skipping the suite."
  exit 1
fi

for flow in "${FLOWS[@]}"; do
  run_flow "$flow" || failed+=("$(basename "$flow")")
done

run_flow maestro/ci/teardown-account.yaml \
  || echo "::warning::Could not delete CI account $EMAIL; remove it in Supabase."

{
  echo "## Maestro"
  echo "Ran ${#FLOWS[@]} flows, ${#failed[@]} failed."
  for f in "${failed[@]}"; do echo "- ❌ $f"; done
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

if ((${#failed[@]})); then
  echo "::error::Failed flows: ${failed[*]}"
  exit 1
fi
