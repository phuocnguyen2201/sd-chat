// Creates a throwaway mail.tm inbox for a sign-up that has to be confirmed.
// Outputs: output.INBOX_EMAIL, output.INBOX_PASSWORD
// GraalJS: no async/await, no fetch - http.* and json() only.
var API = 'https://api.mail.tm';

var domains = http.get(API + '/domains');
if (!domains.ok) throw new Error('mail.tm domains failed: ' + domains.status);
var domain = json(domains.body)['hydra:member'][0].domain;

var suffix = String(new Date().getTime()) + String(Math.floor(Math.random() * 1e6));
var address = 'sdchat-e2e-' + suffix + '@' + domain;
var password = 'Pw-' + suffix + '-' + Math.random().toString(36).slice(2);

var created = http.post(API + '/accounts', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ address: address, password: password }),
});
if (created.status !== 201) throw new Error('mail.tm account failed: ' + created.status);

output.INBOX_EMAIL = address;
output.INBOX_PASSWORD = password;
