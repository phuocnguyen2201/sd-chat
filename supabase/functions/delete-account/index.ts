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

/** Thrown before anything is changed, so the caller gets a clean refusal. */
class GroupCreatorBlockedError extends Error {}

/**
 * Removes this account from its conversations without taking anyone else's
 * conversation with it (security #12).
 *
 * - The caller's participant rows go. Everyone else stays in the chat.
 * - A conversation is deleted only once nobody is left in it. Its messages go
 *   with it (cascade), and nobody else can see them any more.
 * - DMs the caller created get `created_by` cleared, so the profile can be
 *   deleted. DM key lookup never reads `created_by`, so this is safe.
 * - A group the caller created that still has other members is refused before
 *   anything changes. Clearing its `created_by` would break key lookup for
 *   every remaining member (see ConversationKeyResolver.findKeyWrapperPeerId),
 *   so that case needs a decision first.
 *
 * Messages the caller sent in conversations that stay are removed with the
 * profile (messages.sender_id cascades), so the caller's text does not outlive
 * the account in other people's chats. The messages are encrypted anyway.
 */
async function leaveConversations(userId: string): Promise<void> {
  const { data: ownedGroups, error: ownedError } = await db
    .from("conversations")
    .select("id")
    .eq("created_by", userId)
    .eq("is_group", true);

  if (ownedError) throw ownedError;

  const ownedGroupIds = ownedGroups?.map((row) => row.id) ?? [];
  if (ownedGroupIds.length > 0) {
    const { data: otherMembers, error: membersError } = await db
      .from("conversation_participants")
      .select("conversation_id")
      .in("conversation_id", ownedGroupIds)
      .neq("user_id", userId)
      .limit(1);

    if (membersError) throw membersError;
    if (otherMembers && otherMembers.length > 0) {
      throw new GroupCreatorBlockedError(
        "This account created a group that other people are still in.",
      );
    }
  }

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

  // Conversations that still have a member stay exactly as they are.
  let stillPopulated = new Set<string>();
  if (conversationIds.length > 0) {
    const { data: remaining, error: remainingError } = await db
      .from("conversation_participants")
      .select("conversation_id")
      .in("conversation_id", conversationIds);

    if (remainingError) throw remainingError;
    stillPopulated = new Set((remaining ?? []).map((row) => row.conversation_id));
  }

  // Groups this account created that were already empty (it had left them, and
  // everyone else had too) still point at it. The check above guarantees they
  // have no other members, so they can go with the rest.
  const emptyIds = new Set([
    ...conversationIds.filter((id) => !stillPopulated.has(id)),
    ...ownedGroupIds,
  ]);

  // DMs the caller created: the profile can't be deleted while this points at it.
  const { error: dmError } = await db
    .from("conversations")
    .update({ created_by: null })
    .eq("created_by", userId)
    .eq("is_group", false);

  if (dmError) throw dmError;

  if (emptyIds.size > 0) {
    const ids = [...emptyIds];

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
    if (error instanceof GroupCreatorBlockedError) {
      return json({ error: error.message }, 409);
    }
    console.error("delete-account failed:", error);
    return json({ error: "Could not delete account" }, 500);
  }
});
