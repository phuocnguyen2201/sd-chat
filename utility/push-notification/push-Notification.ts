import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from '@/utility/connection';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Push_Tokens } from '../types/user';
import { isDataOnlyMessagePush } from './MessageNotification';

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // Data-only message pushes are shown by the background task, decrypted.
    const show = !isDataOnlyMessagePush(notification);
    return {
      shouldPlaySound: show,
      shouldSetBadge: show,
      shouldShowBanner: show,
      shouldShowList: show,
    };
  },
});

// This device's Expo push token. Not a secret: it only addresses the device.
const DEVICE_PUSH_TOKEN_KEY = 'device_push_token';

export const usePushNotifications = {
    async registerForPushNotificationsAsync(): Promise<string | undefined> {
    if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
        });
    }

    if (Device.isDevice) {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
        }
        if (finalStatus !== 'granted') {
            console.log('Permission not granted to get push token for push notification!');
            return;
        }
        const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
        if (!projectId) {
        console.log('Project ID not found');
            return;
        }
        try {
        const pushTokenString = (
            await Notifications.getExpoPushTokenAsync({
            projectId,
            })
        ).data;
        //console.log('Push token obtained:', pushTokenString);
        return pushTokenString;
        } catch (e: unknown) {
        console.log(`Testing: ${e}`);
        }
    } else {
        console.log('Must use physical device for push notifications');
    }
    },
    
    async savePushTokenToDatabase(token: string) {
    const user = await AsyncStorage.getItem('user').then((data) => data ? JSON.parse(data) : null);
    if (!user) return;
    if (await this.verifyPushTokenInDatabase(token)) {
        console.log('Push token already exists in database');
        return;
    }

    const push_token: Push_Tokens = {
        token: token,
        profile_id: user?.id,
        created_at: new Date().toISOString(),
        provider: 'fcm',
        platform: Platform.OS,
        // Only the Android build decrypts data-only pushes (MessageNotification.ts).
        preview_capable: Platform.OS === 'android',
        is_active: true
    }

    const { error } = await supabase
        .from('push_notification_tokens')
        .insert(push_token)

    if (error) {
        console.log('Error saving push token to database:', error.message);
    }
    },
    async updateTokenStatus(token: string): Promise<boolean> {
        try {

            const user = await AsyncStorage.getItem('user').then((data) => data ? JSON.parse(data) : null);

            //Active on the device logging in.
            const { error: currentToken } = await supabase
            .from('push_notification_tokens')
            .update({ 
                is_active: true , 
                platform: Platform.OS,
                preview_capable: Platform.OS === 'android',
                updated_at: new Date().toISOString()
            })
            .eq('token', token)
            .eq('profile_id', user?.id)

            if (currentToken) { 
                console.log(currentToken.message)
                return false;
            }

            //Deactive this user's tokens on other devices (never other users' tokens).
            const { error: otherTokens } = await supabase
            .from('push_notification_tokens')
            .update({
                is_active: false,
                updated_at: new Date().toISOString()
            })
            .neq('token', token)
            .eq('profile_id', user?.id)

             if (otherTokens) { 
                console.log(otherTokens.message)
                return false;
            }

            return true;

        } catch (error) {
             console.log('Error updating push token to database:', error);
             return false;
        }
    },

    /**
     * Stop this device getting the signed-in account's pushes. Runs before a
     * switch or sign-out, while that account's session is still active (the
     * token rows are owner-only), so only the account in use gets pushes here.
     */
    async deactivateThisDevice(userId: string): Promise<void> {
        try {
            const token = await AsyncStorage.getItem(DEVICE_PUSH_TOKEN_KEY);
            if (!token || !userId) return;
            const { error } = await supabase
                .from('push_notification_tokens')
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .eq('token', token)
                .eq('profile_id', userId);
            if (error) console.log('Error deactivating push token:', error.message);
        } catch (error) {
            console.log('Error deactivating push token:', error);
        }
    },

    /** Undo deactivateThisDevice when a switch was cancelled. */
    async reactivateThisDevice(userId: string): Promise<void> {
        try {
            const token = await AsyncStorage.getItem(DEVICE_PUSH_TOKEN_KEY);
            if (!token || !userId) return;
            await supabase
                .from('push_notification_tokens')
                .update({ is_active: true, updated_at: new Date().toISOString() })
                .eq('token', token)
                .eq('profile_id', userId);
        } catch (error) {
            console.log('Error reactivating push token:', error);
        }
    },

    async rememberDeviceToken(token: string): Promise<void> {
        if (token) await AsyncStorage.setItem(DEVICE_PUSH_TOKEN_KEY, token);
    },

    async verifyPushTokenInDatabase(token: string): Promise<boolean> {
        const user = await AsyncStorage.getItem('user').then((data) => data ? JSON.parse(data) : null);
    if (!user) return false;
    const { data, error } = await supabase
        .from('push_notification_tokens')
        .select('token')
        .eq('profile_id', user.id)
        .eq('token', token)

    if (error) {
        console.log('Error verifying push token in database:', error.message);
        return false;
    }
    return data?.length > 0;
    },
}