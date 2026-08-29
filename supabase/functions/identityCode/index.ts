import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as crypto from "node:crypto";

Deno.serve(async (req: Request) => {
  try {
    const randomIdentityCode = (length = 4) => {
        let result           = '';
        const characters       = 'abcdefghijklmnopqrstuvwxyz';
        const charactersLength = characters.length;
        for ( const i = 0; i < length; i++ ) {
            const buf = crypto.randomBytes(1);
            result += characters.charAt(Math.floor(buf * charactersLength));
        }
        return result;
    }
    randomIdentityCode();
  } catch (error) {
    console.error("Unexpected error in function:", error);
    return new Response(JSON.stringify({ error: "Internal server error", message: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

});