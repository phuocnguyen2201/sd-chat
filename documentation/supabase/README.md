# Supabase Folder

## Overview
The `supabase` folder contains configuration and serverless functions for the Supabase backend. This includes Edge Functions for handling server-side operations like push notifications.

## Structure

```
supabase/
├── .gitignore          # Git ignore rules for Supabase files
├── config.toml         # Supabase local development configuration
└── functions/
    └── push/
        ├── .npmrc      # NPM configuration
        ├── deno.json   # Deno configuration
        └── index.ts    # Push notification Edge Function
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
```

### Testing Webhook
Use Supabase dashboard or curl:
```bash
curl -X POST https://{project-ref}.supabase.co/functions/v1/push \
  -H "Authorization: Bearer {anon-key}" \
  -H "Content-Type: application/json" \
  -d '{"payload": {...}}'
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
