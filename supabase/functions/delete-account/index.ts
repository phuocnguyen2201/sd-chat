import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ============================================================================
// Delete account: the server-side half of deleting an account. It needs the
// service role (auth.admin.deleteUser, and rows the caller's RLS can't reach),
// which is why it lives here and not in the app - anything the app holds ships
// inside the APK.
//
// The account deleted is always the caller's, taken from their JWT. Nothing
// in the request body is read.
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Service-role client: bypasses RLS. Every query below is scoped to the
// authenticated caller's id explicitly.
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function getAuthedUser(req: Request): Promise<{ id: string } | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id };
}

/**
 * Removes this account from its conversations without taking anyone else's
 * conversation with it (security #12).
 *
 * - The caller's participant rows go. Everyone else stays in the chat.
 * - A conversation is deleted only once nobody is left in it. Its messages go
 *   with it (cascade), and nobody else can see them any more.
 * - `created_by` is left pointing at the deleted account (it has no foreign
 *   key since 20261026000200). Group members' keys were wrapped by the creator,
 *   and their pin is keyed by that id (ConversationKeyResolver.findKeyWrapperPeerId),
 *   so clearing it would lock remaining members out on a new device.
 *
 * Messages the caller sent in conversations that stay are removed with the
 * profile (messages.sender_id cascades), so the caller's text does not outlive
 * the account in other people's chats. The messages are encrypted anyway.
 */
async function leaveConversations(userId: string): Promise<void> {
  const { data: owned, error: ownedError } = await db
    .from("conversations")
    .select("id")
    .eq("created_by", userId);

  if (ownedError) throw ownedError;
  const ownedIds: string[] = owned?.map((row) => row.id) ?? [];

  const { data: participantRows, error: participantError } = await db
    .from("conversation_participants")
    .select("conversation_id")
    .eq("user_id", userId);

  if (participantError) throw participantError;
  const conversationIds: string[] = participantRows?.map((row) => row.conversation_id) ?? [];

  if (conversationIds.length > 0) {
    const { error: leaveError } = await db
      .from("conversation_participants")
      .delete()
      .eq("user_id", userId);

    if (leaveError) throw leaveError;
  }

  // Conversations this account was in or created (it may have left those
  // already) that still have a member stay exactly as they are.
  const candidateIds = [...new Set([...conversationIds, ...ownedIds])];
  let stillPopulated = new Set<string>();
  if (candidateIds.length > 0) {
    const { data: remaining, error: remainingError } = await db
      .from("conversation_participants")
      .select("conversation_id")
      .in("conversation_id", candidateIds);

    if (remainingError) throw remainingError;
    stillPopulated = new Set((remaining ?? []).map((row) => row.conversation_id));
  }

  const ids = candidateIds.filter((id) => !stillPopulated.has(id));
  if (ids.length > 0) {

    // files_group has no cascade from conversations, so it goes first.
    const { error: filesGroupError } = await db
      .from("files_group")
      .delete()
      .in("conversation_id", ids);

    if (filesGroupError) throw filesGroupError;

    const { error: conversationsError } = await db
      .from("conversations")
      .delete()
      .in("id", ids);

    if (conversationsError) throw conversationsError;
  }
}

/**
 * Other people's messages, reactions and attachments in conversations that
 * stay are left where they are. They are end-to-end encrypted, and the keys
 * for them are destroyed on the device as part of the same flow. This
 * account's own messages go with the profile (cascade).
 *
 * What does go is everything that still means something without a key: this
 * account's participant rows, conversations nobody is left in, the avatar
 * record, the profile and the auth user.
 */
async function deleteAccount(userId: string): Promise<void> {
  await leaveConversations(userId);

  // The avatar's row. The file itself is removed by the app beforehand, while its session still works.
  const { error: profileFiles } = await db
    .from("files_profiles")
    .delete()
    .eq("profile_id", userId);

  if (profileFiles) throw profileFiles;

  const { error: deleteError } = await db.auth.admin.deleteUser(userId);
  if (deleteError) throw deleteError;

  const { error: profileError } = await db
    .from("profiles")
    .delete()
    .eq("id", userId);

  if (profileError) throw profileError;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Only POST allowed" }, 405);
  }

  const user = await getAuthedUser(req);
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    await deleteAccount(user.id);
    return json({ ok: true });
  } catch (error) {
    console.error("delete-account failed:", error);
    return json({ error: "Could not delete account" }, 500);
  }
});
