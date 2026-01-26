import React, { useEffect, useState, useRef } from 'react';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Spinner } from '@/components/ui/spinner';
import { VStack } from '@/components/ui/vstack';
import { useSession } from '@/utility/session/SessionProvider';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { usePushNotifications } from '@/utility/push-notification/push-Notification';

/**
 * Bootstrap Screen
 * 
 * This screen runs once on app startup and handles:
 * 1. Session restoration
 * 2. Push notification initialization
 * 3. Navigation to appropriate screen based on auth state
 */
export default function Bootstrap() {
  const { user, profile, loading, initialized } = useSession();
  const [pushInitialized, setPushInitialized] = useState(false);
  const hasNavigated = useRef(false);

  // Configure notification handler
  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  }, []);

  // Initialize push notifications
  useEffect(() => {
    if (!initialized || !user || pushInitialized) return;

    const initializePush = async () => {
      try {
        // Only initialize if user doesn't have token
        if (profile?.fcm_token) {
          console.log('Push token already exists');
          setPushInitialized(true);
          return;
        }

        const token = await usePushNotifications.registerForPushNotificationsAsync();
        if (token) {
          await usePushNotifications.savePushTokenToDatabase(token);
          console.log('Push notifications initialized');
        }
        setPushInitialized(true);
      } catch (error) {
        console.error('Error initializing push notifications:', error);
        setPushInitialized(true); // Continue even if push fails
      }
    };

    initializePush();
  }, [initialized, user, profile, pushInitialized]);

  // Set up notification listeners
  useEffect(() => {
    if (!initialized || !user) return;

    // Handle notification received while app is in foreground
    const notificationListener = Notifications.addNotificationReceivedListener((notification) => {
      //console.log('Notification received:', notification);
      //for future use - not yet needed
    });

    // Handle notification tapped
    const responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      const conversationId = data?.conversation_id as string;
      const displayName = data?.displayname as string;
      const public_key = data?.public_key as string;

      if (conversationId && user?.id) {
        router.push({
          pathname: '/tabs/msg/[room_id]',
          params: {
            conversation_id: conversationId,
            displayName: displayName || 'Chat',
            public_key: public_key || '',
          },
        });
      }
    });

    return () => {
      notificationListener.remove();
      responseListener.remove();
    };
  }, [initialized, user]);

  // Navigate based on session state
  useEffect(() => {
    if (!initialized || loading || hasNavigated.current) return;

    const navigate = async () => {
      hasNavigated.current = true;

      if (!user) {
        // No user session - go to login
        router.replace('/login');
        return;
      }

      // User is authenticated
      if (!profile?.displayname) {
        // Profile incomplete - go to complete profile
        router.replace('/CompleteProfile');
      } else {
        // Profile complete - go to chat
        router.replace('/tabs/(tabs)/Chat');
      }
    };

    navigate();
  }, [initialized, loading, user, profile]);

  // Show loading screen while initializing
  if (!initialized || loading) {
    return (
      <Box className="flex-1 bg-background-900 items-center justify-center">
        <VStack space="lg" className="items-center">
          <Spinner size="large" color="white" />
          <Text className="text-white text-lg">Loading...</Text>
        </VStack>
      </Box>
    );
  }

  // This should rarely be seen as navigation happens quickly
  return (
    <Box className="flex-1 bg-background-900 items-center justify-center">
      <VStack space="lg" className="items-center">
        <Spinner size="large" color="white" />
        <Text className="text-white text-lg">Initializing...</Text>
      </VStack>
    </Box>
  );
}
