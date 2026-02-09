import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';
import '@/global.css';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from '@react-navigation/native';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { useColorScheme } from '@/components/useColorScheme';
import { Slot, usePathname, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Fab, FabIcon } from '@/components/ui/fab';
import { MoonIcon, SunIcon } from '@/components/ui/icon';
import { SessionProvider } from '@/utility/session/SessionProvider';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
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
  
  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const pathname = usePathname();
  const segments = useSegments();
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('light');

  const showThemeToggle = pathname === '/tabs/(tabs)/Chat' || (pathname === '/' && segments.length < 1);
  const fetchThemeSetting = async () => {
    const theme = await AsyncStorage.getItem('darkmode')
    setColorMode(theme === 'dark' ? 'dark' : 'light')
  }

  useEffect(() => {
    if(colorMode)
      fetchThemeSetting();
  },[colorMode])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style={colorMode === 'dark' ? 'light' : 'dark'} />
      <GluestackUIProvider mode={colorMode}>
        <SessionProvider>
          <ThemeProvider value={colorMode === 'dark' ? DarkTheme : DefaultTheme}>
            <Slot />
            {
              /*showThemeToggle && (<Fab
                onPress={() =>
                  setColorMode(colorMode === 'dark' ? 'light' : 'dark')
                }
                className="m-6"
                size="lg"
              >
                <FabIcon as={colorMode === 'dark' ? MoonIcon : SunIcon} />
              </Fab>
            )*/
            }
          </ThemeProvider>
        </SessionProvider>
      </GluestackUIProvider>
    </GestureHandlerRootView>
  );
}
