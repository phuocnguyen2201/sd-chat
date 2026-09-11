import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from '@/utility/connection';

const DEVICE_ID_STORAGE = 'sd_chat_local_device_id';

function friendlyDeviceName(): string {
    return Device.deviceName ?? Device.modelName ?? `${Platform.OS} device`;
}

/**
 * A stable id for this physical install, generated once and kept in
 * SecureStore (device-bound). A restored backup on different hardware
 * gets a fresh id here rather than inheriting the original device's -
 * which is the behavior we want, since it's a different device.
 */
async function getOrCreateLocalDeviceId(): Promise<string> {
    const existing = await SecureStore.getItemAsync(DEVICE_ID_STORAGE, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    if (existing) {
        return existing;
    }

    const generated = Crypto.randomUUID();
    await SecureStore.setItemAsync(DEVICE_ID_STORAGE, generated, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return generated;
}

export const DeviceIdentity = {
    /**
     * Ensures a `devices` row exists for this install and returns its
     * database id (the uuid the pairing edge function expects, distinct
     * from the locally-generated device_id used only for upsert identity).
     */
    async registerCurrentDevice(userId: string): Promise<string> {
        const deviceId = await getOrCreateLocalDeviceId();

        const { data, error } = await supabase
            .from('devices')
            .upsert(
                {
                    user_id: userId,
                    device_id: deviceId,
                    device_name: friendlyDeviceName(),
                    last_seen_at: new Date().toISOString(),
                },
                { onConflict: 'user_id,device_id', ignoreDuplicates: false }
            )
            .select('id')
            .single();

        if (error || !data) {
            throw new Error(`Failed to register device: ${error?.message ?? 'unknown error'}`);
        }

        return data.id;
    },

    /** Called after this device successfully imports a synced private key. */
    async markKeySynced(rowId: string): Promise<void> {
        await supabase
            .from('devices')
            .update({ synced_key: true, is_new: false })
            .eq('id', rowId);
    },
};
