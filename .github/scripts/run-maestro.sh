#!/usr/bin/env bash
# Runs the Maestro suite in a fixed order against the installed app.
# Flows share state (logged-in account, the DM with "Android Simulator"),
# so order matters and each flow runs as its own `maestro test` call.
# Every flow runs even if an earlier one fails; teardown always runs.
# Requires PASSWORD, SUPABASE_URL and SUPABASE_KEY (publishable) in the environment.
set -uo pipefail

# Sign-up needs a confirmed email, so the run's account is a throwaway mail.tm
# inbox that maestro/scripts/confirm-email.js can read. Created here, not in a
# flow, because every flow is its own `maestro test` call and needs the address.
MAILTM=https://api.mail.tm
MAILTM_DOMAIN=$(curl -fsS "$MAILTM/domains" | jq -r '.["hydra:member"][0].domain') || {
  echo "::error::mail.tm unavailable; cannot create a confirmable test account."
  exit 1
}
EMAIL="sdchat-ci-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$RANDOM@$MAILTM_DOMAIN"
INBOX_PASSWORD=$(openssl rand -hex 16)
curl -fsS -X POST "$MAILTM/accounts" -H 'Content-Type: application/json' \
  -d "{\"address\":\"$EMAIL\",\"password\":\"$INBOX_PASSWORD\"}" > /dev/null || {
  echo "::error::Could not create mail.tm inbox $EMAIL."
  exit 1
}
echo "CI account: $EMAIL"

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
#   signup-unconfirmed.yaml, delete-account.yaml
#                                  register extra throwaway accounts
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
    -e MAESTRO_INBOX_PASSWORD="$INBOX_PASSWORD" \
    -e MAESTRO_SUPABASE_URL="$SUPABASE_URL" -e MAESTRO_SUPABASE_KEY="$SUPABASE_KEY" \
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
