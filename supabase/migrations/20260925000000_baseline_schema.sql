-- Baseline: the live public schema as of 2026-10-12 (supabase db dump --linked --schema public).
-- The tables were first made in the dashboard, so no earlier migration creates them;
-- without this file a local or CI database cannot be built. Already on the live
-- project: mark it applied there (supabase migration repair --status applied 20260925000000)
-- instead of pushing it.
-- The push_notification trigger is left out here: it needs private.notify_push, which
-- 20260927000000_push_webhook_secret.sql creates along with the trigger.




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."create_conversation_with_participants"("p_name" "text", "p_user_id" "uuid", "p_group_users" "uuid"[]) RETURNS TABLE("conversation_id" "uuid", "conversation_name" "text", "owner_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_conv_id uuid;
  v_users uuid[];
  v_user uuid;
  v_conv_name text;
  v_owner uuid;
BEGIN
  INSERT INTO public.conversations (id, name, is_group, created_by, created_at)
  VALUES (gen_random_uuid(), p_name, true, p_user_id, now())
  RETURNING id, name, created_by, created_at
  INTO v_conv_id, v_conv_name, v_owner;

  IF p_group_users IS NULL THEN
    v_users := ARRAY[p_user_id];
  ELSE
    v_users := (
      SELECT array_agg(DISTINCT u) FROM (
        SELECT unnest(p_group_users) AS u
        UNION ALL
        SELECT p_user_id
      ) s
    );
  END IF;

  FOREACH v_user IN ARRAY v_users LOOP
    INSERT INTO public.conversation_participants (conversation_id, user_id, joined_at)
    SELECT v_conv_id, v_user, now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = v_conv_id AND cp.user_id = v_user
    );
  END LOOP;

  -- Return values into the function's output columns
  conversation_id := v_conv_id;
  conversation_name := v_conv_name;
  owner_id := v_owner;

  RETURN NEXT;
  RETURN;
END;
$$;


ALTER FUNCTION "public"."create_conversation_with_participants"("p_name" "text", "p_user_id" "uuid", "p_group_users" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_dm_conversation"("other_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  existing_conversation_id UUID;
  new_conversation_id UUID;
BEGIN
  -- Check if DM already exists
  SELECT c.id INTO existing_conversation_id
  FROM conversations c
  JOIN conversation_participants cp1 ON c.id = cp1.conversation_id
  JOIN conversation_participants cp2 ON c.id = cp2.conversation_id
  WHERE c.is_group = FALSE
    AND cp1.user_id = auth.uid()
    AND cp2.user_id = other_user_id;
  
  IF existing_conversation_id IS NOT NULL THEN
    RETURN existing_conversation_id;
  END IF;
  
  -- Create new DM
  INSERT INTO conversations (is_group, created_by) 
  VALUES (FALSE, auth.uid())
  RETURNING id INTO new_conversation_id;
  
  -- Add both users as participants
  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES 
    (new_conversation_id, auth.uid()),
    (new_conversation_id, other_user_id);
    
  RETURN new_conversation_id;
END;
$$;


ALTER FUNCTION "public"."create_dm_conversation"("other_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_conversation_between_users"("_user_a" "uuid", "_user_b" "uuid") RETURNS TABLE("conversation_id" "uuid")
    LANGUAGE "sql" STABLE
    AS $$
  SELECT cp.conversation_id
  FROM conversation_participants cp
  WHERE cp.user_id IN (_user_a, _user_b)
  GROUP BY cp.conversation_id
  HAVING COUNT(DISTINCT cp.user_id) = 2;
$$;


ALTER FUNCTION "public"."get_conversation_between_users"("_user_a" "uuid", "_user_b" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_messages_with_reactions"("convo_id" "uuid") RETURNS TABLE("id" "uuid", "conversation_id" "uuid", "sender_id" "uuid", "displayname" "text", "content" "text", "message_type" "text", "metadata" "jsonb", "created_at" timestamp with time zone, "read_by" "uuid"[], "nonce" "text", "wrapped_key" "text", "key_nonce" "text", "is_forward" boolean, "reactions" "jsonb", "files" "jsonb")
    LANGUAGE "sql"
    AS $$
  WITH limited_msgs AS (
    SELECT *
    FROM public.messages
    WHERE conversation_id = convo_id
    ORDER BY created_at DESC
    LIMIT 25
  ), reactions_agg AS (
    SELECT
      r.message_id,
      jsonb_agg(
        to_jsonb(r) - 'message_id'
        ORDER BY r.created_at ASC, r.id ASC
      ) AS reactions
    FROM public.reactions r
    WHERE r.message_id IS NOT NULL
    GROUP BY r.message_id
  ), files_agg AS (
    SELECT
      f.message_id,
      jsonb_agg(
        (to_jsonb(f) - 'message_id' - 'conversation_id')
        ORDER BY f.created_at ASC, f.id ASC
      ) AS files
    FROM public.files f
    WHERE f.message_id IS NOT NULL
    GROUP BY f.message_id
  ), msgs AS (
    SELECT
      m.id,
      m.conversation_id,
      m.sender_id,
      COALESCE(p.displayname, '') AS displayname,
      m.content,
      m.message_type,
      m.metadata,
      m.created_at,
      m.read_by,
      m.nonce,
      m.wrapped_key,
      m.key_nonce,
      m.is_forward,
      COALESCE(ra.reactions, '[]'::jsonb) AS reactions,
      COALESCE(fa.files, '[]'::jsonb) AS files
    FROM limited_msgs m
    LEFT JOIN public.profiles p ON p.id = m.sender_id
    LEFT JOIN reactions_agg ra ON ra.message_id = m.id
    LEFT JOIN files_agg fa ON fa.message_id = m.id
  )
  SELECT *
  FROM msgs
  ORDER BY created_at ASC;
$$;


ALTER FUNCTION "public"."get_messages_with_reactions"("convo_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_public_key text := new.raw_user_meta_data ->> 'public_key';
  v_username text := coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'user');
begin
  if v_public_key is null or v_public_key !~ '^[A-Za-z0-9+/]{43}=$' then
    v_public_key := null;
  end if;

  /*
    username is UNIQUE and comes from the email's local part, so john@a.com and
    john@b.com collide. A collision must not fail the sign-up (that would also
    tell the caller the name is taken): fall back to a suffix from the user id.
  */
  if exists (select 1 from public.profiles where username = v_username) then
    v_username := v_username || '_' || left(replace(new.id::text, '-', ''), 8);
  end if;

  begin
    insert into public.profiles (id, username, public_key, created_at)
    values (new.id, v_username, v_public_key, now())
    on conflict (id) do nothing;
  exception when unique_violation then
    -- Lost a race for the same username: the full id is unique by definition.
    insert into public.profiles (id, username, public_key, created_at)
    values (new.id, v_username || '_' || replace(new.id::text, '-', ''), v_public_key, now())
    on conflict (id) do nothing;
  end;

  return new;
end;
$_$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_conversation_member"("p_conversation_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.conversation_participants
    where conversation_id = p_conversation_id
      and user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_conversation_member"("p_conversation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_messages_as_read"("p_conversation_id" "uuid", "p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE messages
  SET read_by = array_append(read_by, p_user_id)
  WHERE conversation_id = p_conversation_id
    AND NOT (read_by @> ARRAY[p_user_id]);
END;
$$;


ALTER FUNCTION "public"."mark_messages_as_read"("p_conversation_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."messages_notify_new"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  recipient uuid;
  payload jsonb;
  topic text;
BEGIN
  -- Build the payload to send to clients
  payload := jsonb_build_object(
    'id', NEW.id,
    'conversation_id', NEW.conversation_id,
    'sender_id', NEW.sender_id,
    'content', NEW.content,
    'message_type', NEW.message_type,
    'metadata', COALESCE(NEW.metadata, '{}'::jsonb),
    'created_at', NEW.created_at
  );

  -- For each participant in the conversation except the sender, send realtime event
  FOR recipient IN
    SELECT user_id
    FROM public.conversation_participants
    WHERE conversation_id = NEW.conversation_id
      AND (NEW.sender_id IS NULL OR user_id <> NEW.sender_id)
  LOOP
    topic := 'user:' || recipient::text || ':notifications';

    -- realtime.send(topic, event, payload, is_private boolean)
    PERFORM realtime.send(
      topic,
      'message_created',
      payload,
      true  -- private channel
    );
  END LOOP;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."messages_notify_new"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_key_backups_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_key_backups_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
    new.updated_at = now();
    return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."conversation_participants" (
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"(),
    "wrapped_key" "text",
    "key_nonce" "text",
    "key_version" bigint,
    "other_party_pub_key" "text",
    "active" boolean DEFAULT false
);


ALTER TABLE "public"."conversation_participants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text",
    "is_group" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "meta_data" "jsonb",
    "epoch" bigint DEFAULT '1'::bigint NOT NULL,
    "avatar_url" "text"
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."device_pairing_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "requesting_device_id" "uuid" NOT NULL,
    "requesting_ephemeral_public_key" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "code_hash" "text",
    "code_issued_by_device_id" "uuid",
    "approved_by_device_id" "uuid",
    "sender_ephemeral_public_key" "text",
    "ciphertext" "text",
    "nonce" "text",
    "attempts" smallint DEFAULT 0 NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:02:00'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "device_pairing_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'code_issued'::"text", 'approved'::"text", 'denied'::"text", 'expired'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."device_pairing_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."devices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "device_name" "text" NOT NULL,
    "synced_key" boolean DEFAULT false NOT NULL,
    "is_new" boolean DEFAULT true NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."devices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid",
    "bucket_name" "text" NOT NULL,
    "filepath" "text" NOT NULL,
    "token" "text",
    "filename" "text",
    "original_name" "text",
    "mime_type" "text",
    "file_size" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expiry_date" timestamp without time zone,
    "status" boolean
);


ALTER TABLE "public"."files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."files_group" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bucket_name" "text" NOT NULL,
    "filepath" "text" NOT NULL,
    "token" "text",
    "filename" "text",
    "original_name" "text",
    "mime_type" "text",
    "file_size" bigint,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "conversation_id" "uuid",
    "expiry_date" timestamp with time zone,
    "status" boolean
);


ALTER TABLE "public"."files_group" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."files_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bucket_name" "text" NOT NULL,
    "filepath" "text" NOT NULL,
    "token" "text",
    "filename" "text",
    "original_name" "text",
    "mime_type" "text",
    "file_size" bigint,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "profile_id" "uuid",
    "expiry_date" timestamp with time zone,
    "status" boolean
);


ALTER TABLE "public"."files_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."key_backups" (
    "user_id" "uuid" NOT NULL,
    "kdf" "text" DEFAULT 'scrypt'::"text" NOT NULL,
    "kdf_salt" "text" NOT NULL,
    "kdf_n" integer NOT NULL,
    "kdf_r" integer NOT NULL,
    "kdf_p" integer NOT NULL,
    "nonce" "text" NOT NULL,
    "vault_ref" "text" NOT NULL,
    "blob_version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."key_backups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."local_pairing_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "issued_by_device_id" "uuid",
    "verified_by_device_id" "uuid",
    "code_hash" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" smallint DEFAULT 0 NOT NULL,
    "locked_until" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:03:00'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "requester_ephemeral_pub" "text",
    "requester_key_proof" "text",
    CONSTRAINT "local_pairing_codes_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'verified'::"text", 'expired'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."local_pairing_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid",
    "sender_id" "uuid",
    "content" "text" NOT NULL,
    "message_type" "text" DEFAULT 'text'::"text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "read_by" "uuid"[] DEFAULT ARRAY[]::"uuid"[],
    "nonce" "text",
    "wrapped_key" "text",
    "key_nonce" "text",
    "is_forward" boolean DEFAULT false
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "username" "text" NOT NULL,
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "displayname" "text",
    "fcm_token" "text",
    "public_key" "text"
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_notification_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "provider" "text" DEFAULT 'fcm'::"text" NOT NULL,
    "platform" "text",
    "last_seen" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "meta" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "preview_capable" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."push_notification_tokens" OWNER TO "postgres";


COMMENT ON TABLE "public"."push_notification_tokens" IS 'Push notification tokens for user profiles (many tokens -> one profile).';



COMMENT ON COLUMN "public"."push_notification_tokens"."profile_id" IS 'References public.profiles.id';



CREATE TABLE IF NOT EXISTS "public"."reactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "sender_username" "text" NOT NULL,
    "emoji" "text" NOT NULL,
    "message_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reactions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("conversation_id", "user_id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."device_pairing_requests"
    ADD CONSTRAINT "device_pairing_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_user_id_device_id_key" UNIQUE ("user_id", "device_id");



ALTER TABLE ONLY "public"."files_group"
    ADD CONSTRAINT "files_group_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."files_profiles"
    ADD CONSTRAINT "files_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."key_backups"
    ADD CONSTRAINT "key_backups_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."local_pairing_codes"
    ADD CONSTRAINT "local_pairing_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."push_notification_tokens"
    ADD CONSTRAINT "push_notification_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reactions"
    ADD CONSTRAINT "reactions_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "device_pairing_requests_one_active_idx" ON "public"."device_pairing_requests" USING "btree" ("user_id") WHERE ("status" = ANY (ARRAY['pending'::"text", 'code_issued'::"text"]));



CREATE INDEX "device_pairing_requests_user_status_idx" ON "public"."device_pairing_requests" USING "btree" ("user_id", "status");



CREATE INDEX "devices_user_id_idx" ON "public"."devices" USING "btree" ("user_id");



CREATE INDEX "idx_conversation_participants_conversation_user" ON "public"."conversation_participants" USING "btree" ("conversation_id", "user_id");



CREATE INDEX "idx_files_bucket_filepath" ON "public"."files" USING "btree" ("bucket_name", "filepath");



CREATE INDEX "idx_messages_conversation" ON "public"."messages" USING "btree" ("conversation_id", "created_at");



CREATE INDEX "idx_messages_sender" ON "public"."messages" USING "btree" ("sender_id");



CREATE INDEX "idx_participants_user" ON "public"."conversation_participants" USING "btree" ("user_id");



CREATE INDEX "idx_push_tokens_is_active" ON "public"."push_notification_tokens" USING "btree" ("is_active");



CREATE INDEX "idx_push_tokens_profile_id" ON "public"."push_notification_tokens" USING "btree" ("profile_id");



CREATE INDEX "idx_push_tokens_token" ON "public"."push_notification_tokens" USING "btree" ("token");



CREATE INDEX "idx_reactions_message_id" ON "public"."reactions" USING "btree" ("message_id");



CREATE INDEX "idx_reactions_sender_id" ON "public"."reactions" USING "btree" ("sender_id");



CREATE UNIQUE INDEX "local_pairing_codes_one_active_idx" ON "public"."local_pairing_codes" USING "btree" ("user_id") WHERE ("status" = 'pending'::"text");



CREATE INDEX "local_pairing_codes_user_status_idx" ON "public"."local_pairing_codes" USING "btree" ("user_id", "status");



CREATE OR REPLACE TRIGGER "device_pairing_requests_set_updated_at" BEFORE UPDATE ON "public"."device_pairing_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "devices_set_updated_at" BEFORE UPDATE ON "public"."devices" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "local_pairing_codes_set_updated_at" BEFORE UPDATE ON "public"."local_pairing_codes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();






CREATE OR REPLACE TRIGGER "trg_key_backups_updated_at" BEFORE UPDATE ON "public"."key_backups" FOR EACH ROW EXECUTE FUNCTION "public"."set_key_backups_updated_at"();



CREATE OR REPLACE TRIGGER "trg_push_tokens_set_updated_at" BEFORE UPDATE ON "public"."push_notification_tokens" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."device_pairing_requests"
    ADD CONSTRAINT "device_pairing_requests_approved_by_device_id_fkey" FOREIGN KEY ("approved_by_device_id") REFERENCES "public"."devices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."device_pairing_requests"
    ADD CONSTRAINT "device_pairing_requests_code_issued_by_device_id_fkey" FOREIGN KEY ("code_issued_by_device_id") REFERENCES "public"."devices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."device_pairing_requests"
    ADD CONSTRAINT "device_pairing_requests_requesting_device_id_fkey" FOREIGN KEY ("requesting_device_id") REFERENCES "public"."devices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."device_pairing_requests"
    ADD CONSTRAINT "device_pairing_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."devices"
    ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."files_group"
    ADD CONSTRAINT "files_group_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id");



ALTER TABLE ONLY "public"."files_profiles"
    ADD CONSTRAINT "files_profiles_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "fk_message" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."key_backups"
    ADD CONSTRAINT "key_backups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."local_pairing_codes"
    ADD CONSTRAINT "local_pairing_codes_issued_by_device_id_fkey" FOREIGN KEY ("issued_by_device_id") REFERENCES "public"."devices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."local_pairing_codes"
    ADD CONSTRAINT "local_pairing_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."local_pairing_codes"
    ADD CONSTRAINT "local_pairing_codes_verified_by_device_id_fkey" FOREIGN KEY ("verified_by_device_id") REFERENCES "public"."devices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_notification_tokens"
    ADD CONSTRAINT "push_tokens_profile_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reactions"
    ADD CONSTRAINT "reactions_message_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE;



CREATE POLICY "Allow profile owner access" ON "public"."push_notification_tokens" TO "authenticated" USING (("profile_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("profile_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Allow users update own conversations" ON "public"."conversations" FOR UPDATE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."conversation_participants" "cm"
  WHERE (("cm"."conversation_id" = "conversations"."id") AND ("cm"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Authenticated can view their conversations" ON "public"."conversations" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."conversation_participants" "cm"
  WHERE (("cm"."conversation_id" = "conversations"."id") AND ("cm"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Enable delete for users based on user_id" ON "public"."messages" FOR DELETE USING ((( SELECT "auth"."uid"() AS "uid") = "sender_id"));



CREATE POLICY "Enable delete for users based on user_id" ON "public"."profiles" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "Enable insert for authenticated users only" ON "public"."files" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."files_group" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Enable insert for authenticated users only" ON "public"."files_profiles" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Enable insert for users based on user_id" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "Users can send messages to conversations they're in" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."conversation_participants"
  WHERE (("conversation_participants"."conversation_id" = "messages"."conversation_id") AND ("conversation_participants"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "Users can update their own messages" ON "public"."messages" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "sender_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "sender_id"));



CREATE POLICY "Users can view all profiles" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view messages in their conversations" ON "public"."messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."conversation_participants"
  WHERE (("conversation_participants"."conversation_id" = "messages"."conversation_id") AND ("conversation_participants"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."conversation_participants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."device_pairing_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."devices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "devices_delete_own" ON "public"."devices" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "devices_insert_own" ON "public"."devices" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "devices_select_own" ON "public"."devices" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "devices_update_own" ON "public"."devices" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."files_group" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."files_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."key_backups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "key_backups_delete_own" ON "public"."key_backups" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "key_backups_insert_own" ON "public"."key_backups" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "key_backups_select_own" ON "public"."key_backups" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "key_backups_update_own" ON "public"."key_backups" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."local_pairing_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "messages_delete_own" ON "public"."messages" FOR DELETE TO "authenticated" USING (("sender_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "participants_delete_own" ON "public"."conversation_participants" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "participants_select_members" ON "public"."conversation_participants" FOR SELECT TO "authenticated" USING ("public"."is_conversation_member"("conversation_id"));



CREATE POLICY "participants_update_key_columns" ON "public"."conversation_participants" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR ("public"."is_conversation_member"("conversation_id") AND ("wrapped_key" IS NULL)))) WITH CHECK ("public"."is_conversation_member"("conversation_id"));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_seed_users_select" ON "public"."profiles" FOR SELECT TO "authenticated", "anon" USING (("displayname" = ANY (ARRAY['Testing'::"text", 'Android Simulator'::"text"])));



ALTER TABLE "public"."push_notification_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reactions_delete_owner" ON "public"."reactions" FOR DELETE TO "authenticated" USING (("sender_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "reactions_insert_owner" ON "public"."reactions" FOR INSERT TO "authenticated" WITH CHECK (("sender_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "reactions_select_authenticated" ON "public"."reactions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "reactions_update_owner" ON "public"."reactions" FOR UPDATE TO "authenticated" USING (("sender_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("sender_id" = ( SELECT "auth"."uid"() AS "uid")));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_conversation_with_participants"("p_name" "text", "p_user_id" "uuid", "p_group_users" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."create_conversation_with_participants"("p_name" "text", "p_user_id" "uuid", "p_group_users" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_conversation_with_participants"("p_name" "text", "p_user_id" "uuid", "p_group_users" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_dm_conversation"("other_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_dm_conversation"("other_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_dm_conversation"("other_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_conversation_between_users"("_user_a" "uuid", "_user_b" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_conversation_between_users"("_user_a" "uuid", "_user_b" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_conversation_between_users"("_user_a" "uuid", "_user_b" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_messages_with_reactions"("convo_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_messages_with_reactions"("convo_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_messages_with_reactions"("convo_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_conversation_member"("p_conversation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_conversation_member"("p_conversation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_conversation_member"("p_conversation_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_messages_as_read"("p_conversation_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_messages_as_read"("p_conversation_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_messages_as_read"("p_conversation_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."messages_notify_new"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."messages_notify_new"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."messages_notify_new"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_key_backups_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_key_backups_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_key_backups_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."conversation_participants" TO "anon";
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."conversation_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_participants" TO "service_role";



GRANT UPDATE("wrapped_key") ON TABLE "public"."conversation_participants" TO "authenticated";



GRANT UPDATE("key_nonce") ON TABLE "public"."conversation_participants" TO "authenticated";



GRANT UPDATE("other_party_pub_key") ON TABLE "public"."conversation_participants" TO "authenticated";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."device_pairing_requests" TO "anon";
GRANT ALL ON TABLE "public"."device_pairing_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."device_pairing_requests" TO "service_role";



GRANT ALL ON TABLE "public"."devices" TO "anon";
GRANT ALL ON TABLE "public"."devices" TO "authenticated";
GRANT ALL ON TABLE "public"."devices" TO "service_role";



GRANT ALL ON TABLE "public"."files" TO "anon";
GRANT ALL ON TABLE "public"."files" TO "authenticated";
GRANT ALL ON TABLE "public"."files" TO "service_role";



GRANT ALL ON TABLE "public"."files_group" TO "anon";
GRANT ALL ON TABLE "public"."files_group" TO "authenticated";
GRANT ALL ON TABLE "public"."files_group" TO "service_role";



GRANT ALL ON TABLE "public"."files_profiles" TO "anon";
GRANT ALL ON TABLE "public"."files_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."files_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."key_backups" TO "anon";
GRANT ALL ON TABLE "public"."key_backups" TO "authenticated";
GRANT ALL ON TABLE "public"."key_backups" TO "service_role";



GRANT ALL ON TABLE "public"."local_pairing_codes" TO "anon";
GRANT ALL ON TABLE "public"."local_pairing_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."local_pairing_codes" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."push_notification_tokens" TO "anon";
GRANT ALL ON TABLE "public"."push_notification_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."push_notification_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."reactions" TO "anon";
GRANT ALL ON TABLE "public"."reactions" TO "authenticated";
GRANT ALL ON TABLE "public"."reactions" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







