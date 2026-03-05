import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from '@/utility/connection';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Push_Tokens } from '../types/user';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

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
        platform: 'android',
        is_active: true
    }

    const { data, error } = await supabase
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
                updated_at: new Date().toISOString()
            })
            .eq('token', token)
            .eq('profile_id', user?.id)

            if (currentToken) { 
                console.log(currentToken.message)
                return false;
            }

            //Deactive all others token.
            const { error: otherTokens } = await supabase
            .from('push_notification_tokens')
            .update({ 
                is_active: false,
                updated_at: new Date().toISOString()
            })
            .neq('token', token)
            .neq('profile_id', user?.id)

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