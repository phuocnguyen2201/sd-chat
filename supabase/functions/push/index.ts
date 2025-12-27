// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

Deno.serve(async (req) => {
  const { name } = await req.json()
  const test = 'ExponentPushToken[ATeYCXE-oYLaWrdo5unRAD]';

  const sender_data = await supabase.from('messages').select('conversation_id, content').eq('id', '3f4b8f12-6f4e-4d3b-8f4a-6f4e4d3b8f12').single();

  const receiver_data = await supabase.from('profiles').select('fcm_token').eq('id', 'user-2-id').single();

  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: receiver_data.data?.fcm_token || test,
      sound: 'default',
      title: user.displayname || 'New Message',
      body: sender_data.data?.content || 'You have a new message',
    }),
  }).then(res => res.json());

  return new Response(JSON.stringify(res), {
    headers: { "Content-Type": "application/json" },
  });
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/push' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
