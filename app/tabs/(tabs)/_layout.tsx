import React, { useEffect, useState } from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';
import { ColorValue } from 'react-native';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useSession } from '@/utility/session/SessionProvider';
import { MessageEncryption } from '@/utility/securedMessage/secured';
import { routeToKeyRecovery } from '@/utility/securedMessage/IdentityKeyGuard';

/*
  `color` is ColorValue, not string: that is what React Navigation hands to
  tabBarIcon, and what FontAwesome accepts.
*/
function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: ColorValue;
}) {
  return <FontAwesome size={18} style={{ marginBottom: -3 }} {...props} />;
}

export default function TabLayout() {
  const { user, profile } = useSession();
  const headerShown = useClientOnlyValue(false, true);
  const [keyVerified, setKeyVerified] = useState(false);

  /*
    Second line of defence behind Bootstrap. Bootstrap is not the only way in:
    EnableBiometric, notification taps and plain router calls all land here
    directly. Everything under these tabs can mint or unwrap conversation keys,
    so nothing renders until this device's identity key is known to match the
    account.
  */
  useEffect(() => {
    if (!user?.id || !profile) return;

    let cancelled = false;
    setKeyVerified(false);

    MessageEncryption.verifyIdentityKey(user.id, profile.public_key ?? '').then((state) => {
      if (cancelled) return;
      if (state === 'ok') {
        setKeyVerified(true);
      } else {
        routeToKeyRecovery(state);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user?.id, profile?.public_key]);

  if (!keyVerified) {
    return null;
  }

  return (
    <Tabs
      screenOptions={{
        // Disable the static render of the header on web
        // to prevent a hydration error in React Navigation v6.
        headerShown,
      }}
    >
      <Tabs.Screen
        name="Chat"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color }) => <TabBarIcon name="comments" color={color} />,
          headerShown: false
        }}
      />
      <Tabs.Screen
        name="Settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <TabBarIcon name="cog" color={color} />,
          headerShown: false
        }}
      />

    </Tabs>
  );
}
