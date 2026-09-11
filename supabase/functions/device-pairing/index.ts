import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// ============================================================================
// Device pairing: relays end-to-end sealed key material between an
// account's devices. This function never sees a plaintext private key -
// only ciphertext, ephemeral public keys, and a SHA-256 hash of the
// one-time confirmation code. See device_pairing_schema.sql for why the
// table has no client-facing RLS policies: everything is gated here.
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Service-role client: bypasses RLS. This function is the sole gatekeeper
// for device_pairing_requests, so every authorization decision below is
// enforced explicitly in code, not delegated to Postgres policies.
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I, 32 symbols
const CODE_LENGTH = 6;
const REQUEST_TTL_MS = 2 * 60 * 1000;
const MAX_FIELD_LENGTH = 8000; // generous cap for base64 blobs, guards against abuse

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    // 256 % 32 === 0, so this is uniform - no modulo bias.
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isNonEmptyString(value: unknown, maxLength = MAX_FIELD_LENGTH): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
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

async function assertOwnDevice(userId: string, deviceId: string): Promise<boolean> {
  const { data } = await db
    .from("devices")
    .select("id")
    .eq("id", deviceId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

/** Opportunistic sweep so an abandoned request doesn't permanently block new ones. */
async function cleanupExpired(userId: string): Promise<void> {
  await db
    .from("device_pairing_requests")
    .delete()
    .eq("user_id", userId)
    .in("status", ["pending", "code_issued", "approved"])
    .lt("expires_at", new Date().toISOString());
}

// ----------------------------------------------------------------------------
// Actions
// ----------------------------------------------------------------------------

async function actionCreate(userId: string, body: any) {
  const { deviceId, ephemeralPublicKey } = body;
  if (!isNonEmptyString(deviceId) || !isNonEmptyString(ephemeralPublicKey)) {
    return json({ error: "deviceId and ephemeralPublicKey are required" }, 400);
  }
  if (!(await assertOwnDevice(userId, deviceId))) {
    return json({ error: "Unknown device" }, 403);
  }

  await cleanupExpired(userId);

  const expiresAt = new Date(Date.now() + REQUEST_TTL_MS).toISOString();
  const { data, error } = await db
    .from("device_pairing_requests")
    .insert({
      user_id: userId,
      requesting_device_id: deviceId,
      requesting_ephemeral_public_key: ephemeralPublicKey,
      expires_at: expiresAt,
    })
    .select("id, expires_at")
    .single();

  if (error) {
    // Partial unique index (one active request per account) violation.
    if (error.code === "23505") {
      return json({ error: "A pairing request is already in progress for this account" }, 409);
    }
    console.error("create failed:", error);
    return json({ error: "Failed to create pairing request" }, 500);
  }

  return json({ requestId: data.id, expiresAt: data.expires_at });
}

async function actionStatus(userId: string, body: any) {
  const { deviceId } = body;

  const { data: reqRow, error } = await db
    .from("device_pairing_requests")
    .select(
      "id, status, requesting_device_id, requesting_ephemeral_public_key, expires_at, created_at"
    )
    .eq("user_id", userId)
    .in("status", ["pending", "code_issued", "approved"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("status failed:", error);
    return json({ error: "Failed to fetch status" }, 500);
  }

  if (!reqRow || new Date(reqRow.expires_at).getTime() < Date.now()) {
    return json({ active: false });
  }

  const { data: deviceRow } = await db
    .from("devices")
    .select("device_name")
    .eq("id", reqRow.requesting_device_id)
    .maybeSingle();

  return json({
    active: true,
    requestId: reqRow.id,
    status: reqRow.status,
    requestingDeviceId: reqRow.requesting_device_id,
    requestingDeviceName: deviceRow?.device_name ?? "Unknown device",
    requestingEphemeralPublicKey: reqRow.requesting_ephemeral_public_key,
    isMine: isNonEmptyString(deviceId) ? deviceId === reqRow.requesting_device_id : undefined,
    expiresAt: reqRow.expires_at,
  });
}

async function actionApprove(userId: string, body: any) {
  const { deviceId, senderEphemeralPublicKey, ciphertext, nonce } = body;
  if (
    !isNonEmptyString(deviceId) ||
    !isNonEmptyString(senderEphemeralPublicKey) ||
    !isNonEmptyString(ciphertext) ||
    !isNonEmptyString(nonce)
  ) {
    return json({ error: "deviceId, senderEphemeralPublicKey, ciphertext and nonce are required" }, 400);
  }
  if (!(await assertOwnDevice(userId, deviceId))) {
    return json({ error: "Unknown device" }, 403);
  }

  const code = generateCode();
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + REQUEST_TTL_MS).toISOString();

  const { data, error } = await db
    .from("device_pairing_requests")
    .update({
      status: "code_issued",
      code_hash: codeHash,
      code_issued_by_device_id: deviceId,
      sender_ephemeral_public_key: senderEphemeralPublicKey,
      ciphertext,
      nonce,
      attempts: 0,
      expires_at: expiresAt,
    })
    .eq("user_id", userId)
    .eq("status", "pending")
    .neq("requesting_device_id", deviceId) // can't approve your own request
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("approve failed:", error);
    return json({ error: "Failed to approve pairing request" }, 500);
  }
  if (!data) {
    return json({ error: "No pending pairing request to approve" }, 409);
  }

  return json({ requestId: data.id, code, expiresAt });
}

async function actionConfirm(userId: string, body: any) {
  const { deviceId, requestId, code } = body;
  if (!isNonEmptyString(deviceId) || !isNonEmptyString(requestId) || !isNonEmptyString(code, 32)) {
    return json({ error: "deviceId, requestId and code are required" }, 400);
  }

  // Atomically claim the single confirmation attempt (0 -> 1). A
  // concurrent/duplicate submit finds attempts already at 1 and no row
  // matches, so it cannot get a second guess.
  const { data: claimed, error: claimError } = await db
    .from("device_pairing_requests")
    .update({ attempts: 1 })
    .eq("id", requestId)
    .eq("user_id", userId)
    .eq("requesting_device_id", deviceId)
    .eq("status", "code_issued")
    .eq("attempts", 0)
    .gt("expires_at", new Date().toISOString())
    .select("code_hash")
    .maybeSingle();

  if (claimError) {
    console.error("confirm claim failed:", claimError);
    return json({ error: "Failed to confirm code" }, 500);
  }
  if (!claimed) {
    return json({ error: "No code awaiting confirmation, request a new one" }, 410);
  }

  const submittedHash = await sha256Hex(code.trim().toUpperCase());
  const matched = submittedHash === claimed.code_hash;

  const { data: finalRow, error: finalError } = await db
    .from("device_pairing_requests")
    .update({
      status: matched ? "approved" : "denied",
      approved_by_device_id: matched ? deviceId : null,
    })
    .eq("id", requestId)
    .select("status")
    .single();

  if (finalError) {
    console.error("confirm finalize failed:", finalError);
    return json({ error: "Failed to confirm code" }, 500);
  }

  return json({ status: finalRow.status });
}

async function actionFetchKey(userId: string, body: any) {
  const { deviceId, requestId } = body;
  if (!isNonEmptyString(deviceId) || !isNonEmptyString(requestId)) {
    return json({ error: "deviceId and requestId are required" }, 400);
  }

  // Atomic fetch-and-delete: only one caller can ever successfully read
  // this ciphertext, and it cannot be re-read after (single-use).
  const { data, error } = await db
    .from("device_pairing_requests")
    .delete()
    .eq("id", requestId)
    .eq("user_id", userId)
    .eq("requesting_device_id", deviceId)
    .eq("status", "approved")
    .select("sender_ephemeral_public_key, ciphertext, nonce")
    .maybeSingle();

  if (error) {
    console.error("fetch-key failed:", error);
    return json({ error: "Failed to fetch key" }, 500);
  }
  if (!data) {
    return json({ error: "Not approved yet, or already consumed" }, 404);
  }

  return json({
    senderEphemeralPublicKey: data.sender_ephemeral_public_key,
    ciphertext: data.ciphertext,
    nonce: data.nonce,
  });
}

async function actionCancel(userId: string, body: any) {
  const { deviceId, requestId } = body;
  if (!isNonEmptyString(deviceId) || !isNonEmptyString(requestId)) {
    return json({ error: "deviceId and requestId are required" }, 400);
  }

  await db
    .from("device_pairing_requests")
    .delete()
    .eq("id", requestId)
    .eq("user_id", userId)
    .eq("requesting_device_id", deviceId);

  return json({ ok: true });
}

// ----------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Only POST allowed" }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const user = await getAuthedUser(req);
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    switch (body?.action) {
      case "create":
        return await actionCreate(user.id, body);
      case "status":
        return await actionStatus(user.id, body);
      case "approve":
        return await actionApprove(user.id, body);
      case "confirm":
        return await actionConfirm(user.id, body);
      case "fetch-key":
        return await actionFetchKey(user.id, body);
      case "cancel":
        return await actionCancel(user.id, body);
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (error) {
    console.error("Unexpected error in device-pairing function:", error);
    return json({ error: "Internal server error" }, 500);
  }
});
