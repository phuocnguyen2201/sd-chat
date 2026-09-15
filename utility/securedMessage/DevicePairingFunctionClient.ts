import { supabase } from '@/utility/connection';

/**
 * Shared caller for the `device-pairing` Edge Function, used by both the
 * remote (ciphertext-relay) pairing flow and the local (same-room code
 * gate) flow. A non-2xx response is thrown as an Error with the server's
 * message; callers that need structured data even on a "soft failure"
 * (e.g. the local code's lockout countdown) have the function return that
 * case with HTTP 200 instead, specifically to avoid it being swallowed here.
 */
export async function invokeDevicePairing<T>(action: string, payload: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.functions.invoke('device-pairing', {
        body: { action, ...payload },
    });

    if (error) {
        let message = error.message ?? 'Request failed';
        const context = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
        if (context?.json) {
            try {
                const body = await context.json();
                if (body?.error) {
                    message = body.error;
                }
            } catch {
                // fall back to error.message below
            }
        }
        throw new Error(message);
    }

    if (data && typeof data === 'object' && 'error' in data && data.error) {
        throw new Error(String((data as { error: unknown }).error));
    }

    return data as T;
}
