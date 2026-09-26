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
 * Messages, reactions and their attachments are deliberately left where
 * they are. They are end-to-end encrypted, and the keys for them are
 * destroyed on the device as part of the same flow, so what stays behind
 * is ciphertext that nobody - this account included - holds a key for.
 *
 * What does go is everything that still means something without a key:
 * every conversation this account took part in, the participant rows that
 * tie people to those conversations, the avatar record, the profile and
 * the auth user.
 */
async function deleteAccount(userId: string): Promise<void> {
  const { data: participantRows, error: participantError } = await db
    .from("conversation_participants")
    .select("conversation_id")
    .eq("user_id", userId);

  if (participantError) throw participantError;
  const conversationIds: string[] = participantRows?.map((row) => row.conversation_id) ?? [];

  if (conversationIds.length > 0) {
    /*
      Every participant row for these conversations, not only this
      account's. They are the children of the rows deleted immediately
      after, so leaving the other members behind would just block that.
    */
    const { error: participantsError } = await db
      .from("conversation_participants")
      .delete()
      .in("conversation_id", conversationIds);

    if (participantsError) throw participantsError;

    const { error: conversationsError } = await db
      .from("conversations")
      .delete()
      .in("id", conversationIds);

    if (conversationsError) throw conversationsError;
  }

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
