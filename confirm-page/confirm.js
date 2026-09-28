/*
 * Email confirmation page for SD Chat.
 *
 * The "Confirm signup" email links here with ?token_hash=…&type=email.
 * - Nothing happens on load: mail scanners that prefetch links would otherwise
 *   burn the one-time token before the user gets to it.
 * - The token is read once, kept in memory and stripped from the address bar
 *   and history.
 * - verifyOtp confirms the email and returns a session this page has no use
 *   for, so it is revoked straight away and never persisted.
 */
(function () {
  'use strict';

  var ALLOWED_TYPES = ['email', 'signup'];
  var MESSAGES = {
    ready: 'Tap the button to confirm your email address.',
    working: 'Confirming…',
    done: 'Your email is confirmed. Go back to the SD Chat app and log in.',
    failed: 'This link is invalid or has expired. Request a new one from the SD Chat app.',
    invalid: 'This link is incomplete. Open the link from your confirmation email again.',
  };

  var statusEl = document.getElementById('status');
  var button = document.getElementById('confirm');

  var params = new URLSearchParams(window.location.search);
  var tokenHash = params.get('token_hash');
  var type = params.get('type');

  // Drop the token from the URL before anything else can read or record it.
  window.history.replaceState(null, '', window.location.pathname);

  function show(text, state) {
    statusEl.textContent = text;
    statusEl.className = state || '';
  }

  if (!tokenHash || !/^[A-Za-z0-9_-]{16,256}$/.test(tokenHash) || ALLOWED_TYPES.indexOf(type) === -1) {
    show(MESSAGES.invalid, 'error');
    button.hidden = true;
    return;
  }

  var config = window.SD_CHAT_CONFIG;
  var client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  button.addEventListener('click', function () {
    button.disabled = true;
    show(MESSAGES.working);

    var hash = tokenHash;
    tokenHash = null; // one attempt per page load; the token is single-use anyway

    client.auth
      .verifyOtp({ token_hash: hash, type: 'email' })
      .then(function (result) {
        if (result.error) throw result.error;
        // Revoke the session the confirmation created; the app signs in on its own.
        return client.auth.signOut({ scope: 'local' }).catch(function () {});
      })
      .then(function () {
        show(MESSAGES.done, 'success');
        button.hidden = true;
      })
      .catch(function () {
        // Server error text is never shown: it can't help the user and may leak detail.
        show(MESSAGES.failed, 'error');
        button.hidden = true;
      });
  });
})();
