import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ============================================================================
// Push: sends the push notification for a newly inserted message.
//
// Only the `push_notification` trigger on public.messages may call this
// (private.notify_push, see migration 20260927000000_push_webhook_secret.sql).
// It proves that with the `x-webhook-secret` header; verify_jwt is off because
// any JWT - including the public anon key - would pass it.
//
// The request body is only used for the message id. Sender, conversation and
// content are read back from the row, so a caller can't choose what is sent.
//
// Messages are end-to-end encrypted, so this function can't read them:
// - tokens with preview_capable (Android builds with the background task) get a
//   data-only push carrying the ciphertext; the app decrypts it and shows the
//   notification itself.
// - everything else (iOS, older Android builds) gets a visible "New message".
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPO_PUSH_URL = Deno.env.get("EXPO_API_PUSH_NOTIFICATION")!;
const PUSH_WEBHOOK_SECRET = Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "";

// Expo rejects payloads over 4096 bytes. Leave room for the envelope.
const MAX_DATA_BYTES = 3500;
const FALLBACK_BODY = "New message";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Service-role client: bypasses RLS. Every query is keyed off the message row
// read back from the database, never off the request body.
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function sendExpo(messages: unknown[]): Promise<void> {
  if (messages.length === 0) return;
  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    console.error("Expo push failed:", res.status, await res.text());
  }
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return json({ error: "Only POST allowed" }, 405);
    }

    if (!PUSH_WEBHOOK_SECRET) {
      console.error("PUSH_WEBHOOK_SECRET is not set; refusing all requests");
      return json({ error: "Internal server error" }, 500);
    }
    if (!safeEqual(req.headers.get("x-webhook-secret") ?? "", PUSH_WEBHOOK_SECRET)) {
      return json({ error: "Unauthorized" }, 401);
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const messageId = body?.record?.id;
    if (body?.type !== "INSERT" || body?.table !== "messages" || typeof messageId !== "string" || !UUID_RE.test(messageId)) {
      return json({ error: "Invalid payload" }, 400);
    }

    const { data: message, error: messageError } = await db
      .from("messages")
      .select("id, sender_id, conversation_id, content, nonce, wrapped_key, key_nonce, message_type")
      .eq("id", messageId)
      .maybeSingle();
    if (messageError) throw messageError;
    if (!message) {
      return json({ error: "Message not found" }, 404);
    }

    const { data: sender } = await db
      .from("profiles")
      .select("displayname, public_key")
      .eq("id", message.sender_id)
      .maybeSingle();
    const displayname = sender?.displayname || "New Message";

    // Only one recipient is supported: in a group this returns more than one row
    // and no push is sent (tracked in in-progress.md).
    const { data: recipient, error: recipientError } = await db
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", message.conversation_id)
      .neq("user_id", message.sender_id)
      .single();
    if (recipientError || !recipient) {
      console.warn("No single recipient for conversation", message.conversation_id, recipientError?.message);
      return json({ ok: true });
    }

    const { data: tokens, error: tokensError } = await db
      .from("push_notification_tokens")
      .select("token, preview_capable")
      .eq("profile_id", recipient.user_id)
      .eq("is_active", true);
    if (tokensError) throw tokensError;

    const previewTokens = (tokens ?? []).filter((t) => t.preview_capable).map((t) => t.token);
    const plainTokens = (tokens ?? []).filter((t) => !t.preview_capable).map((t) => t.token);

    // What the app's tap handlers read (Bootstrap.tsx, Chat.tsx).
    const tapData = {
      conversation_id: message.conversation_id,
      displayname: sender?.displayname,
      public_key: sender?.public_key,
    };

    // Data-only: no title/body, so Android hands it to the app's background
    // task instead of displaying it. Ciphertext goes along only when it fits.
    let previewData: Record<string, unknown> = {
      ...tapData,
      kind: "message",
      message_id: message.id,
      sender_id: message.sender_id,
      message_type: message.message_type,
    };
    if (message.message_type === "text") {
      const withCiphertext = {
        ...previewData,
        content: message.content,
        nonce: message.nonce,
        wrapped_key: message.wrapped_key,
        key_nonce: message.key_nonce,
      };
      if (new TextEncoder().encode(JSON.stringify(withCiphertext)).length <= MAX_DATA_BYTES) {
        previewData = withCiphertext;
      }
    }

    const outgoing: unknown[] = [];
    if (previewTokens.length > 0) {
      outgoing.push({ to: previewTokens, priority: "high", data: previewData });
    }
    if (plainTokens.length > 0) {
      outgoing.push({
        to: plainTokens,
        sound: "default",
        title: displayname,
        body: FALLBACK_BODY,
        data: tapData,
      });
    }
    await sendExpo(outgoing);

    return json({ ok: true });
  } catch (error) {
    console.error("Unexpected error in push function:", error);
    return json({ error: "Internal server error" }, 500);
  }
});
