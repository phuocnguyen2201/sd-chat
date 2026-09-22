import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';
import { ColorValue } from 'react-native';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';

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
  return (
    <Tabs
      screenOptions={{
        // Disable the static render of the header on web
        // to prevent a hydration error in React Navigation v6.
        headerShown: useClientOnlyValue(false, true),
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
