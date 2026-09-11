# Supabase Folder

## Overview
The `supabase` folder contains configuration and serverless functions for the Supabase backend. This includes Edge Functions for handling server-side operations like push notifications and device-to-device key pairing.

## Structure

```
supabase/
├── .gitignore          # Git ignore rules for Supabase files
├── config.toml         # Supabase local development configuration
└── functions/
    ├── push/
    │   ├── .npmrc       # NPM configuration
    │   ├── deno.json    # Deno configuration
    │   └── index.ts     # Push notification Edge Function
    └── device-pairing/
        ├── deno.json    # Deno configuration
        └── index.ts     # Device pairing Edge Function (relays sealed key material)
```

## Edge Functions

### Push Notification Function (`functions/push/`)

#### Purpose
Handles push notifications when new messages are received. This function is triggered by database webhooks (typically on message insert) and sends push notifications to the recipient.

#### Configuration Files

**`deno.json`**
- Deno runtime configuration
- Defines dependencies and runtime settings for the Edge Function

**`.npmrc`**
- NPM configuration for package management
- May contain registry settings or authentication tokens

**`index.ts`**
- Main Edge Function implementation
- Handles POST requests from Supabase webhooks
- Sends push notifications via Expo Push Notification service

#### Function Flow

1. **Webhook Trigger**
   - Triggered by database event (message insert)
   - Receives payload with message data

2. **Data Extraction**
   - Extracts message content
   - Gets sender's display name from profiles table
   - Identifies recipient from conversation_participants table
   - Retrieves recipient's FCM token from profiles table

3. **Push Notification**
   - Sends notification to Expo Push Notification API
   - Includes:
     - Recipient's FCM token
     - Sender's display name as title
     - Message content as body
     - Conversation ID and display name in data payload

#### Environment Variables

The function requires these environment variables:
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_ANON_KEY`: Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key (for admin operations)
- `EXPO_API_PUSH_NOTIFICATION`: Expo Push Notification API endpoint

#### Request Handling

**Method**: POST only
- Returns 405 for non-POST requests

**Payload Structure**:
```typescript
{
  payload: {
    type: string,        // Event type (e.g., "INSERT")
    table: string,       // Table name (e.g., "messages")
    record: {
      id: string,
      conversation_id: string,
      sender_id: string,
      content: string,
      // ... other message fields
    },
    old_record?: any     // For UPDATE/DELETE events
  }
}
```

**Response**:
- Success: `{ ok: true, payload: ... }`
- Error: `{ error: string, message: string }`

#### Database Queries

1. **Get Sender Name**
   ```sql
   SELECT displayname FROM profiles WHERE id = sender_id
   ```

2. **Get Recipient**
   ```sql
   SELECT user_id FROM conversation_participants 
   WHERE conversation_id = ? AND user_id != sender_id
   ```

3. **Get FCM Token**
   ```sql
   SELECT fcm_token, displayname FROM profiles WHERE id = recipient_id
   ```

#### Push Notification Payload

Sent to Expo Push Notification API:
```json
{
  "to": "fcm_token",
  "sound": "default",
  "title": "Sender Display Name",
  "body": "Message content",
  "data": {
    "conversation_id": "uuid",
    "displayname": "Sender Display Name"
  }
}
```

#### Error Handling

- **JSON Parse Errors**: Returns 400 with error message
- **Missing Payload**: Returns 400 with error message
- **Database Errors**: Logged and may cause 500 response
- **Push Notification Errors**: Logged but doesn't fail the function

### Device Pairing Function (`functions/device-pairing/`)

#### Purpose
Relays end-to-end sealed key material between a single account's devices, so a device that's missing the account's private key (every device except the one that originally signed up — see `documentation/utility/README.md`'s `DeviceIdentity`/`RemoteDevicePairing` sections) can obtain it without the plaintext key ever passing through the server. It's the server-relayed alternative to the local QR flow in `app/tabs/managekeys/` for devices that aren't physically together.

This function is the **only** way to read or write the `device_pairing_requests` table — that table intentionally has no RLS policies granted to `authenticated`/`anon` (see [Database Schema](#database-schema) below), so every authorization decision lives here, in code, not in Postgres policies.

#### Why not just RLS like `devices`?
Both an account's legitimate old device and an attacker who only has stolen login credentials authenticate as the same `auth.uid()` — Postgres RLS can't distinguish "which physical device" issued a request. If `device_pairing_requests` allowed `user_id = auth.uid()` writes directly, the device *requesting* a key sync could forge its own approval and skip the human-confirmation code check entirely. Routing everything through this function (service-role client, explicit checks in code) closes that gap.

#### Action Router
A single POST endpoint, dispatched by an `action` field in the JSON body. All actions require a valid user JWT in `Authorization: Bearer <token>`.

| Action | Caller | Purpose |
| --- | --- | --- |
| `create` | new device | Registers a pairing request with its ephemeral X25519 public key. Enforced to one active request per account by a partial unique index (also acts as free rate-limiting). |
| `status` | either device | Polls the account's current in-flight request (id, status, requesting device name/id, `isMine`, expiry). Never returns `code_hash` or ciphertext. |
| `approve` | old device | Uploads the private-key payload already sealed (ECDH + AEAD) client-side to the requester's ephemeral public key, and gets back a freshly generated one-time display code. Rejects approving your own request. |
| `confirm` | new device | Submits the code read off the old device. Atomic claim-then-finalize (`attempts` 0→1 as a compare-and-swap) guarantees exactly **one** guess is possible — a wrong code ends the request; a fresh one must be created. |
| `fetch-key` | new device | Atomic `DELETE ... RETURNING` — the sealed payload can be read exactly once, only once `status = 'approved'`, and is gone immediately after. |
| `cancel` | new device | Abandons an in-flight request. |

#### Code generation
6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 symbols, excludes `0/O/1/I` to avoid human misreads) via `crypto.getRandomValues` — uniform with no modulo bias since 256 % 32 = 0. Only a SHA-256 hash of the code is ever stored; the plaintext is returned once, in the `approve` response, and never persisted.

#### Configuration Files

**`deno.json`** — empty import map (no extra dependencies beyond `npm:`/`jsr:` specifiers used directly in `index.ts`).

**`index.ts`** — main implementation. Uses two Supabase clients:
- An anon-key client, scoped to the caller's bearer token, purely to resolve `auth.getUser()` and confirm the JWT is valid.
- A service-role client (module-level `db`) for all `devices` / `device_pairing_requests` reads and writes, since RLS is intentionally not usable here.

#### Environment Variables
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

#### Request Handling
**Method**: POST only (plus `OPTIONS` for CORS preflight) — returns 405 for anything else, 401 if the JWT doesn't resolve to a user, 400 for malformed JSON or missing required fields.

**Body shape**: `{ "action": "create" | "status" | "approve" | "confirm" | "fetch-key" | "cancel", ...actionFields }`

#### Error Handling
- Every action validates its own required fields and returns 400 with a message on failure.
- `assertOwnDevice()` checks the caller's `deviceId` actually belongs to their account (403 otherwise) before it's trusted in any write.
- `cleanupExpired()` opportunistically sweeps this account's expired requests at the start of `create`, so an abandoned handshake can't permanently block a new one past its TTL.
- Unexpected errors are logged server-side and returned as a generic 500 — never leak internal error detail to the client.

### Database Schema

Two tables, added via a hand-run migration (not currently tracked under `supabase/migrations/` — see the project owner before assuming Supabase CLI migrations manage this):

**`devices`** — bookkeeping only (device name, `synced_key`, `is_new`, a client-generated stable `device_id` for upsert idempotency across re-logins on the same install). No secrets. RLS: `auth.uid() = user_id` for select/insert/update/delete — safe for the app to read/write directly.

**`device_pairing_requests`** — the actual handshake state: requester's ephemeral public key, `code_hash`, sealed `ciphertext`/`nonce`/sender ephemeral public key, and a `status` state machine (`pending → code_issued → approved|denied`, plus `expired`/`completed` as terminal bookkeeping). RLS is enabled with **no policies** for `authenticated`/`anon` — see the "Why not just RLS" note above. A partial unique index (`status in ('pending','code_issued')`) allows only one in-flight request per account at a time.

## Configuration

### `config.toml`
Supabase local development configuration file. Contains:
- Database settings
- API settings
- Storage settings
- Edge Function settings
- Local development ports and URLs

### `.gitignore`
Excludes sensitive files and local development artifacts from version control:
- Environment variables
- Local database files
- Build artifacts
- Logs

## Deployment

### Edge Functions Deployment
Edge Functions are deployed to Supabase using:
```bash
supabase functions deploy push
supabase functions deploy device-pairing
```

### Environment Variables Setup
Set environment variables in Supabase dashboard:
1. Go to Project Settings > Edge Functions
2. Add environment variables
3. Redeploy functions after adding variables

### Webhook Configuration
Configure database webhook in Supabase:
1. Go to Database > Webhooks
2. Create new webhook
3. Set trigger: INSERT on `messages` table
4. Set URL: `https://{project-ref}.supabase.co/functions/v1/push`
5. Set HTTP method: POST
6. Include relevant payload fields

## Dependencies

### Runtime
- **Deno**: Edge Functions runtime
- **@supabase/supabase-js**: Supabase client library
- **@supabase/functions-js**: Supabase Edge Functions utilities

### External Services
- **Expo Push Notification Service**: Sends push notifications
- **Supabase Database**: Stores user and message data
- **Supabase Storage**: (Not used in this function)

## Security Considerations

### Service Role Key
- Uses service role key for admin database operations
- Should never be exposed to client-side code
- Only used in server-side Edge Functions

### FCM Token Validation
- Validates FCM token exists before sending
- Handles missing tokens gracefully

### Error Logging
- Logs errors for debugging
- Doesn't expose sensitive information in responses

## Testing

### Local Testing
```bash
supabase functions serve push
supabase functions serve device-pairing
```

### Testing Webhook
Use Supabase dashboard or curl:
```bash
curl -X POST https://{project-ref}.supabase.co/functions/v1/push \
  -H "Authorization: Bearer {anon-key}" \
  -H "Content-Type: application/json" \
  -d '{"payload": {...}}'
```

### Testing device-pairing
Requires a real user JWT (not the anon key) since the function calls `auth.getUser()`:
```bash
curl -X POST https://{project-ref}.supabase.co/functions/v1/device-pairing \
  -H "Authorization: Bearer {user-access-token}" \
  -H "Content-Type: application/json" \
  -d '{"action": "status", "deviceId": "..."}'
```

## Monitoring

### Logs
View Edge Function logs in Supabase dashboard:
- Go to Edge Functions > Logs
- Filter by function name
- View real-time and historical logs

### Metrics
Monitor function performance:
- Execution time
- Success/failure rates
- Error rates
- Invocation count
