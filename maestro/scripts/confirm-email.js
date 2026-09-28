// Waits for the SD Chat confirmation email in a mail.tm inbox and confirms the
// account exactly like confirm-page/ does: POST {type, token_hash} to
// /auth/v1/verify with the publishable key, then revoke the session it returns.
// Needs: INBOX_EMAIL, INBOX_PASSWORD, SUPABASE_URL, SUPABASE_KEY (publishable).
// GraalJS: no async/await, no fetch, no sleep - http.* and json() only.
var API = 'https://api.mail.tm';
var TIMEOUT_MS = 90000;
var POLL_MS = 3000;

function pause(ms) {
  var until = new Date().getTime() + ms;
  while (new Date().getTime() < until) { /* no sleep in GraalJS */ }
}

var login = http.post(API + '/token', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ address: INBOX_EMAIL, password: INBOX_PASSWORD }),
});
if (!login.ok) throw new Error('mail.tm login failed: ' + login.status);
var auth = { Authorization: 'Bearer ' + json(login.body).token };

var tokenHash = null;
var deadline = new Date().getTime() + TIMEOUT_MS;
while (!tokenHash && new Date().getTime() < deadline) {
  var list = http.get(API + '/messages', { headers: auth });
  if (list.ok) {
    var messages = json(list.body)['hydra:member'];
    for (var i = 0; i < messages.length && !tokenHash; i++) {
      var full = http.get(API + '/messages/' + messages[i].id, { headers: auth });
      if (!full.ok) continue;
      var msg = json(full.body);
      var content = (msg.text || '') + ' ' + (msg.html ? msg.html.join(' ') : '');
      // Our template links with token_hash=; Supabase's default template uses
      // /auth/v1/verify?token=<the same hash>.
      var match = content.match(/token_hash=([A-Za-z0-9_-]+)/) ||
        content.match(/\/auth\/v1\/verify\?token=([A-Za-z0-9_-]+)/);
      if (match) tokenHash = match[1];
    }
  }
  if (!tokenHash) pause(POLL_MS);
}
if (!tokenHash) throw new Error('No confirmation email for ' + INBOX_EMAIL + ' within ' + TIMEOUT_MS / 1000 + 's');

var verify = http.post(SUPABASE_URL + '/auth/v1/verify', {
  headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'email', token_hash: tokenHash }),
});
if (!verify.ok) throw new Error('Supabase verify failed: ' + verify.status);

var session = json(verify.body);
if (session.access_token) {
  http.post(SUPABASE_URL + '/auth/v1/logout?scope=local', {
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
    body: '{}', // Maestro's http.post requires a body
  });
}
output.EMAIL_CONFIRMED = 'true';
