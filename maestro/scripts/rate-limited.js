// Fails the flow when Supabase has refused to send another confirmation email.
// The project's email limit is 2 per hour, so a second run inside the hour
// gets this error on sign-up. Called from a `when: visible` branch in the
// sign-up subflows; it only throws, so the failure shows in the run report.
// GraalJS: no async/await, no fetch.
throw new Error(
  'Email rate exceeded. Supabase allows 2 confirmation emails per hour. ' +
  'Please re-run the failed flow in one hour.'
);
