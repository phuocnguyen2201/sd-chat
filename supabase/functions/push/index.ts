import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_PUSH_NOTIFICATIONS_KEY = Deno.env.get("EXPO_API_PUSH_NOTIFICATION")!;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
Deno.serve(async (req: Request) => {
  try {
    // Only accept POST if that's intended
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Only POST allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse JSON safely
    let body: any;
    try {
      body = await req.json();
    } catch (e) {
      console.error("Failed to parse JSON body:", e);
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Support both shapes: { payload: { ... } } and { ... }
    const payload = body?.payload ?? body;

    if (!payload) {
      console.warn("No payload found in request body:", body);
      return new Response(JSON.stringify({ error: "No payload provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Inspect the webhook trigger
   // console.log("Received webhook payload:", JSON.stringify(payload, null, 2));
    //const inserted_Data = JSON.stringify(payload, null, 2)
    // Example: extract fields safely
    const { type, table, record, old_record } = payload;

    // TODO: Add your business logic here (DB calls, push notifications, etc.)
    const content = record?.content || "No content";
    const sender_name = await supabaseClient
      .from("profiles")
      .select("displayname")
      .eq("id", record?.sender_id)
      .single();
    const receivedPerson = await supabaseClient
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", record?.conversation_id).neq("user_id", record?.sender_id)
      .single();
    const received_fcm_token = await supabaseClient
      .from("profiles")
      .select("fcm_token, displayname")
      .eq("id", receivedPerson.data?.user_id)
      .single();
    // If you need Supabase client, construct it with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY

    console.log("Preparing to send push notification...");
     const res = await fetch(SUPABASE_PUSH_NOTIFICATIONS_KEY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: received_fcm_token.data?.fcm_token || '',
        sound: 'default',
        title: sender_name.data?.displayname || 'New Message',
        body: content || 'You have a new message',
        data: { conversation_id: record?.conversation_id, displayname: sender_name.data?.displayname}
      }),
    }).then(res => res.json());

    // Return the received payload as confirmation
    return new Response(JSON.stringify({ ok: true, payload }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Unexpected error in function:", error);
    return new Response(JSON.stringify({ error: "Internal server error", message: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});