import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';
import '@/global.css';
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from 'expo-router/react-navigation';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider, useSession } from '@/utility/session/SessionProvider';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
// Source - https://stackoverflow.com/a/79908585
// Posted by Zakhar G, modified by community. See post 'Timeline' for change history
// Retrieved 2026-06-22, License - CC BY-SA 4.0

import { requireOptionalNativeModule } from 'expo';

const DevMenuPreferences = requireOptionalNativeModule('DevMenuPreferences');
DevMenuPreferences?.setPreferencesAsync({
  showFloatingActionButton: false,
  showsAtLaunch: false,
  motionGestureEnabled: false,    // Disables shake to open
  touchGestureEnabled: false,     // Disables 3-finger long press to open
});


export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);
  
  return (
    <SessionProvider>
      <RootLayoutNav />
    </SessionProvider>
  );
}

function RootLayoutNav() {
  const { isDarkMode, fetchThemeMode } = useSession();

  useEffect(() => {
    fetchThemeMode();
  }, [fetchThemeMode]);

  const colorMode = isDarkMode === 'dark' ? 'dark' : 'light';

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style={colorMode === 'dark' ? 'light' : 'dark'} />
      <GluestackUIProvider mode={colorMode}>
        <ThemeProvider value={colorMode === 'dark' ? DarkTheme : DefaultTheme}>
          <Slot />
        </ThemeProvider>
      </GluestackUIProvider>
    </GestureHandlerRootView>
  );
}
