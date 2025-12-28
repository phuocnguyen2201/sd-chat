import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from '@/utility/connection';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
        //console.log(pushTokenString);
        return pushTokenString;
        } catch (e: unknown) {
        console.log(`${e}`);
        }
    } else {
        console.log('Must use physical device for push notifications');
    }
    },
    
    async savePushTokenToDatabase(token: string) {
    const user = await AsyncStorage.getItem('user').then((data) => data ? JSON.parse(data) : null);
    if (!user) return;
    if (await this.verifyPushTokenInDatabase()) {
        console.log('Push token already exists in database');
        return;
    }
    
    const { data, error } = await supabase
        .from('profiles')
        .update({ fcm_token: token })
        .eq('id', user.id);
    if (error) {
        console.log('Error saving push token to database:', error.message);
    } else {
        console.log('Push token saved to database successfully:', data);
    }
    },

    async verifyPushTokenInDatabase(): Promise<boolean> {
        const user = await AsyncStorage.getItem('user').then((data) => data ? JSON.parse(data) : null);
    if (!user) return false;
    const { data, error } = await supabase
        .from('profiles')
        .select('fcm_token')
        .eq('id', user.id)
        .single();
    if (error) {
        console.log('Error verifying push token in database:', error.message);
        return false;
    }
    return data?.fcm_token != null;
    },
}