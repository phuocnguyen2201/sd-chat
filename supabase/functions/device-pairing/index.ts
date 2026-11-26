import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// ============================================================================
// Device pairing: relays end-to-end sealed key material between an
// account's devices. This function never sees a plaintext private key -
// only ciphertext, ephemeral public keys, nonces and a commitment. The
// tables have no client-facing RLS policies or grants: everything is gated here.
//
// Remote pairing (security #23), see utility/securedMessage/RemotePairingCheck.ts:
//   create    new device: one-time key K + commitment H(K || Nn)  -> pending
//   challenge old device: nonce Na, bound to the K and commitment it saw -> challenged
//   reveal    new device: Nn, must open the commitment            -> revealed
//   approve   the challenging device: key sealed to K, after the user typed
//             the 6-digit check value shown on the new device      -> approved
//   deny      any of the account's devices other than the requester
//   fetch-key new device, single use
// The server can't fake the check value: it would have to commit to a nonce
// before seeing Na.
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

const REMOTE_COMMIT_CONTEXT = "sd-chat-remote-pairing-commit-v1";
const REQUEST_TTL_MS = 2 * 60 * 1000;
const MAX_FIELD_LENGTH = 8000; // generous cap for base64 blobs, guards against abuse

// Local (same-room) pairing code gate, in front of the existing QR
// handshake. See local_pairing_codes_schema.sql for the table/RLS design.
const LOCAL_CODE_LENGTH = 4;
const LOCAL_CODE_TTL_MS = 3 * 60 * 1000; // shorter than the lockout window, on purpose
const LOCAL_CODE_MAX_ATTEMPTS = 5;
const LOCAL_CODE_LOCKOUT_MS = 5 * 60 * 1000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function randomDigit(): number {
  // 256 isn't a multiple of 10 - reject bytes >= 250 (the largest multiple
  // of 10 that's <= 256) so every digit 0-9 stays uniformly likely.
  const buf = new Uint8Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= 250);
  return value % 10;
}

function generateDigitCode(): string {
  let code = "";
  for (let i = 0; i < LOCAL_CODE_LENGTH; i++) {
    code += randomDigit().toString();
  }
  return code;
}

// Standard base64 of exactly 32 bytes: the new device's one-time X25519
// public key, and the HMAC-SHA256 that binds it to the pairing code.
const BASE64_32_BYTES = /^[A-Za-z0-9+/]{43}=$/;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** H(context || K || Nn), the same as remotePairingCommitment on the client. */
async function remoteCommitment(ephemeralPublicKey: string, requesterNonce: string): Promise<string> {
  const context = new TextEncoder().encode(REMOTE_COMMIT_CONTEXT);
  const key = base64ToBytes(ephemeralPublicKey);
  const nonce = base64ToBytes(requesterNonce);
  const input = new Uint8Array(context.length + key.length + nonce.length);
  input.set(context, 0);
  input.set(key, context.length);
  input.set(nonce, context.length + key.length);
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", input)));
}

function isBase64Of32Bytes(value: unknown): value is string {
  return typeof value === "string" && BASE64_32_BYTES.test(value);
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
    .in("status", ["pending", "challenged", "revealed", "approved"])
    .lt("expires_at", new Date().toISOString());
}

async function cleanupExpiredLocalCodes(userId: string): Promise<void> {
  await db
    .from("local_pairing_codes")
    .delete()
    .eq("user_id", userId)
    .in("status", ["pending", "verified"])
    .lt("expires_at", new Date().toISOString());
}

// ----------------------------------------------------------------------------
// Actions
// ----------------------------------------------------------------------------

async function actionCreate(userId: string, body: any) {
  const { deviceId, ephemeralPublicKey, commitment } = body;
  if (!isNonEmptyString(deviceId) || !isBase64Of32Bytes(ephemeralPublicKey)) {
    return json({ error: "deviceId and ephemeralPublicKey are required" }, 400);
  }
  // Security #23: requests without a commitment come from app versions that
  // can't show the check value, so they're refused.
  if (!isBase64Of32Bytes(commitment)) {
    return json({ error: "Update SD Chat on this device to pair it" }, 400);
  }
  if (!(await assertOwnDevice(userId, deviceId))) {
    return json({ error: "Unknown device" }, 403);
  }

  // Local code gate: this device must have just entered the 4-digit code shown
  // on one of the account's other devices (local-code-verify). The code is
  // claimed and deleted in one statement, so it opens exactly one request; a
  // concurrent create finds nothing left to claim.
  const { data: localCodes, error: localCodeError } = await db
    .from("local_pairing_codes")
    .delete()
    .eq("user_id", userId)
    .eq("status", "verified")
    .eq("verified_by_device_id", deviceId)
    .gt("expires_at", new Date().toISOString())
    .select("id");

  if (localCodeError) {
    console.error("create local code check failed:", localCodeError);
    return json({ error: "Failed to create pairing request" }, 500);
  }
  if (!localCodes || localCodes.length === 0) {
    return json({ error: "Enter the pairing code from your other device first" }, 403);
  }

  await cleanupExpired(userId);

  const expiresAt = new Date(Date.now() + REQUEST_TTL_MS).toISOString();
  const { data, error } = await db
    .from("device_pairing_requests")
    .insert({
      user_id: userId,
      requesting_device_id: deviceId,
      requesting_ephemeral_public_key: ephemeralPublicKey,
      requester_commitment: commitment,
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
      "id, status, requesting_device_id, requesting_ephemeral_public_key, requester_commitment, approver_nonce, requester_nonce, challenged_by_device_id, expires_at, created_at"
    )
    .eq("user_id", userId)
    .in("status", ["pending", "challenged", "revealed", "approved"])
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
    requesterCommitment: reqRow.requester_commitment,
    approverNonce: reqRow.approver_nonce,
    requesterNonce: reqRow.requester_nonce,
    isMine: isNonEmptyString(deviceId) ? deviceId === reqRow.requesting_device_id : undefined,
    isChallenger: isNonEmptyString(deviceId) ? deviceId === reqRow.challenged_by_device_id : undefined,
    expiresAt: reqRow.expires_at,
  });
}

async function actionChallenge(userId: string, body: any) {
  const { deviceId, requestId, requesterEphemeralPublicKey, requesterCommitment, approverNonce } = body;
  if (
    !isNonEmptyString(deviceId) ||
    !isNonEmptyString(requestId) ||
    !isBase64Of32Bytes(requesterEphemeralPublicKey) ||
    !isBase64Of32Bytes(requesterCommitment) ||
    !isBase64Of32Bytes(approverNonce)
  ) {
    return json({ error: "deviceId, requestId, requesterEphemeralPublicKey, requesterCommitment and approverNonce are required" }, 400);
  }
  if (!(await assertOwnDevice(userId, deviceId))) {
    return json({ error: "Unknown device" }, 403);
  }

  // Only the request this device was shown: same id, key and commitment.
  const { data, error } = await db
    .from("device_pairing_requests")
    .update({
      status: "challenged",
      approver_nonce: approverNonce,
      challenged_by_device_id: deviceId,
    })
    .eq("id", requestId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .eq("requesting_ephemeral_public_key", requesterEphemeralPublicKey)
    .eq("requester_commitment", requesterCommitment)
    .neq("requesting_device_id", deviceId) // can't approve your own request
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("challenge failed:", error);
    return json({ error: "Failed to approve pairing request" }, 500);
  }
  if (!data) {
    return json({ error: "This pairing request is no longer waiting for approval" }, 409);
  }
  return json({ ok: true });
}

async function actionReveal(userId: string, body: any) {
  const { deviceId, requestId, requesterNonce } = body;
  if (!isNonEmptyString(deviceId) || !isNonEmptyString(requestId) || !isBase64Of32Bytes(requesterNonce)) {
    return json({ error: "deviceId, requestId and requesterNonce are required" }, 400);
  }

  const { data: row, error } = await db
    .from("device_pairing_requests")
    .select("requesting_ephemeral_public_key, requester_commitment")
    .eq("id", requestId)
    .eq("user_id", userId)
    .eq("requesting_device_id", deviceId)
    .eq("status", "challenged")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.error("reveal lookup failed:", error);
    return json({ error: "Failed to continue pairing" }, 500);
  }
  if (!row) {
    return json({ error: "No pairing request waiting for this device" }, 409);
  }
  // The old device checks this too; checking here turns a bad nonce into a clear error.
  if ((await remoteCommitment(row.requesting_ephemeral_public_key, requesterNonce)) !== row.requester_commitment) {
    return json({ error: "Nonce does not match the commitment" }, 400);
  }

  const { data: updated, error: updateError } = await db
    .from("device_pairing_requests")
    .update({ status: "revealed", requester_nonce: requesterNonce })
    .eq("id", requestId)
    .eq("status", "challenged")
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.error("reveal failed:", updateError);
    return json({ error: "Failed to continue pairing" }, 500);
  }
  if (!updated) {
    return json({ error: "Please try again" }, 409);
  }
  return json({ ok: true });
}

async function actionApprove(userId: string, body: any) {
  const { deviceId, requestId, senderEphemeralPublicKey, ciphertext, nonce } = body;
  if (
    !isNonEmptyString(deviceId) ||
    !isNonEmptyString(requestId) ||
    !isNonEmptyString(senderEphemeralPublicKey) ||
    !isNonEmptyString(ciphertext) ||
    !isNonEmptyString(nonce)
  ) {
    return json({ error: "deviceId, requestId, senderEphemeralPublicKey, ciphertext and nonce are required" }, 400);
  }
  if (!(await assertOwnDevice(userId, deviceId))) {
    return json({ error: "Unknown device" }, 403);
  }

  // Only the device that challenged, and only after the new device revealed.
  const expiresAt = new Date(Date.now() + REQUEST_TTL_MS).toISOString();
  const { data, error } = await db
    .from("device_pairing_requests")
    .update({
      status: "approved",
      approved_by_device_id: deviceId,
      sender_ephemeral_public_key: senderEphemeralPublicKey,
      ciphertext,
      nonce,
      expires_at: expiresAt,
    })
    .eq("id", requestId)
    .eq("user_id", userId)
    .eq("status", "revealed")
    .eq("challenged_by_device_id", deviceId)
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("approve failed:", error);
    return json({ error: "Failed to approve pairing request" }, 500);
  }
  if (!data) {
    return json({ error: "No pairing request ready to approve" }, 409);
  }

  return json({ requestId: data.id, expiresAt });
}

async function actionDeny(userId: string, body: any) {
  const { deviceId, requestId } = body;
  if (!isNonEmptyString(deviceId) || !isNonEmptyString(requestId)) {
    return json({ error: "deviceId and requestId are required" }, 400);
  }
  if (!(await assertOwnDevice(userId, deviceId))) {
    return json({ error: "Unknown device" }, 403);
  }

  // Denied rows carry no key material, and leaving the active states frees the
  // account for a new request.
  await db
    .from("device_pairing_requests")
    .update({ status: "denied", ciphertext: null, nonce: null, sender_ephemeral_public_key: null })
    .eq("id", requestId)
    .eq("user_id", userId)
    .neq("requesting_device_id", deviceId)
    .in("status", ["pending", "challenged", "revealed"]);

  return json({ ok: true });
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
// Local (same-room) pairing code gate
//
// Proves the two devices are physically together before the QR handshake
// above is allowed to start. Carries no key material - just a short-lived,
// rate-limited, server-enforced code check.
// ----------------------------------------------------------------------------

async function actionLocalCodeCreate(userId: string, body: any) {
  const { deviceId } = body;
  if (!isNonEmptyString(deviceId)) {
    return json({ error: "deviceId is required" }, 400);
  }
  if (!(await assertOwnDevice(userId, deviceId))) {
    return json({ error: "Unknown device" }, 403);
  }

  await cleanupExpiredLocalCodes(userId);

  const code = generateDigitCode();
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + LOCAL_CODE_TTL_MS).toISOString();

  const { data, error } = await db
    .from("local_pairing_codes")
    .insert({
      user_id: userId,
      issued_by_device_id: deviceId,
      code_hash: codeHash,
      expires_at: expiresAt,
    })
    .select("id, expires_at")
    .single();

  if (error) {
    // Partial unique index (one active code per account) violation.
    if (error.code === "23505") {
      return json({ error: "A pairing code is already active for this account. Cancel it first." }, 409);
    }
    console.error("local-code-create failed:", error);
    return json({ error: "Failed to create pairing code" }, 500);
  }

  return json({ codeId: data.id, code, expiresAt: data.expires_at });
}

async function actionLocalCodeStatus(userId: string) {
  const { data: row, error } = await db
    .from("local_pairing_codes")
    .select("id, status, expires_at, locked_until, attempts, verified_by_device_id, requester_ephemeral_pub, requester_key_proof")
    .eq("user_id", userId)
    .in("status", ["pending", "verified"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("local-code-status failed:", error);
    return json({ error: "Failed to fetch status" }, 500);
  }

  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    return json({ active: false });
  }

  let verifiedByDeviceName: string | null = null;
  if (row.verified_by_device_id) {
    const { data: deviceRow } = await db
      .from("devices")
      .select("device_name")
      .eq("id", row.verified_by_device_id)
      .maybeSingle();
    verifiedByDeviceName = deviceRow?.device_name ?? null;
  }

  return json({
    active: true,
    codeId: row.id,
    status: row.status,
    expiresAt: row.expires_at,
    lockedUntil: row.locked_until,
    attempts: row.attempts,
    verifiedByDeviceName,
    // Public values: the old device checks the proof against the code it
    // showed, then seals the key QR to this key.
    requesterEphemeralPublicKey: row.status === "verified" ? row.requester_ephemeral_pub : null,
    requesterKeyProof: row.status === "verified" ? row.requester_key_proof : null,
  });
}

async function actionLocalCodeVerify(userId: string, body: any) {
  const { deviceId, code, ephemeralPublicKey, keyProof } = body;
  const trimmedCode = typeof code === "string" ? code.trim() : "";
  if (!isNonEmptyString(deviceId) || !/^\d{4}$/.test(trimmedCode)) {
    return json({ error: "deviceId and a 4-digit code are required" }, 400);
  }
  // The old device seals the key QR to this key (security #4). Older app
  // versions don't send it and would only get a plaintext QR, so refuse them.
  if (
    typeof ephemeralPublicKey !== "string" || !BASE64_32_BYTES.test(ephemeralPublicKey) ||
    typeof keyProof !== "string" || !BASE64_32_BYTES.test(keyProof)
  ) {
    return json({ error: "Update SD Chat on this device to pair it" }, 400);
  }
  if (!(await assertOwnDevice(userId, deviceId))) {
    return json({ error: "Unknown device" }, 403);
  }

  const { data: row, error } = await db
    .from("local_pairing_codes")
    .select("id, code_hash, attempts, locked_until, expires_at")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("local-code-verify lookup failed:", error);
    return json({ error: "Failed to verify code" }, 500);
  }
  if (!row) {
    return json({ error: "No active pairing code for this account" }, 404);
  }

  const now = Date.now();

  if (new Date(row.expires_at).getTime() < now) {
    await db.from("local_pairing_codes").update({ status: "expired" }).eq("id", row.id).eq("status", "pending");
    return json({ error: "Code expired, ask the other device to generate a new one" }, 410);
  }

  if (row.locked_until && new Date(row.locked_until).getTime() > now) {
    // Not an error response (stays HTTP 200, no `error` key): the client
    // needs the structured retryAfterSeconds field, and a non-2xx status
    // would make the Supabase JS SDK drop the body into `error` instead of
    // `data`, losing it.
    const retryAfterSeconds = Math.ceil((new Date(row.locked_until).getTime() - now) / 1000);
    return json({ verified: false, locked: true, retryAfterSeconds });
  }

  const submittedHash = await sha256Hex(trimmedCode);
  const matched = submittedHash === row.code_hash;
  const newAttempts = row.attempts + 1;

  const updatePayload: Record<string, unknown> = { attempts: newAttempts };
  if (matched) {
    updatePayload.status = "verified";
    updatePayload.verified_by_device_id = deviceId;
    updatePayload.requester_ephemeral_pub = ephemeralPublicKey;
    updatePayload.requester_key_proof = keyProof;
  } else if (newAttempts >= LOCAL_CODE_MAX_ATTEMPTS) {
    updatePayload.locked_until = new Date(now + LOCAL_CODE_LOCKOUT_MS).toISOString();
  }

  // Optimistic-concurrency guard (.eq("attempts", row.attempts)): if a
  // concurrent verify call already advanced attempts, this update matches
  // nothing rather than double-consuming an attempt.
  const { data: updated, error: updateError } = await db
    .from("local_pairing_codes")
    .update(updatePayload)
    .eq("id", row.id)
    .eq("attempts", row.attempts)
    .select("status, locked_until")
    .maybeSingle();

  if (updateError) {
    console.error("local-code-verify update failed:", updateError);
    return json({ error: "Failed to verify code" }, 500);
  }
  if (!updated) {
    return json({ error: "Please try again" }, 409);
  }

  if (matched) {
    return json({ verified: true });
  }

  if (updated.locked_until) {
    return json({
      verified: false,
      locked: true,
      retryAfterSeconds: Math.ceil((new Date(updated.locked_until).getTime() - now) / 1000),
    });
  }

  return json({ verified: false, attemptsRemaining: Math.max(LOCAL_CODE_MAX_ATTEMPTS - newAttempts, 0) });
}

async function actionLocalCodeCancel(userId: string, body: any) {
  const { deviceId } = body;
  if (!isNonEmptyString(deviceId)) {
    return json({ error: "deviceId is required" }, 400);
  }

  await db
    .from("local_pairing_codes")
    .delete()
    .eq("user_id", userId)
    .eq("issued_by_device_id", deviceId)
    .eq("status", "pending");

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
      case "challenge":
        return await actionChallenge(user.id, body);
      case "reveal":
        return await actionReveal(user.id, body);
      case "approve":
        return await actionApprove(user.id, body);
      case "deny":
        return await actionDeny(user.id, body);
      case "fetch-key":
        return await actionFetchKey(user.id, body);
      case "cancel":
        return await actionCancel(user.id, body);
      case "local-code-create":
        return await actionLocalCodeCreate(user.id, body);
      case "local-code-status":
        return await actionLocalCodeStatus(user.id);
      case "local-code-verify":
        return await actionLocalCodeVerify(user.id, body);
      case "local-code-cancel":
        return await actionLocalCodeCancel(user.id, body);
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (error) {
    console.error("Unexpected error in device-pairing function:", error);
    return json({ error: "Internal server error" }, 500);
  }
});
