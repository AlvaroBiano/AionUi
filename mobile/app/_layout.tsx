import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
} from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { ThemeProvider, useTheme } from '../src/context/ThemeContext';
import { ConnectionProvider } from '../src/context/ConnectionContext';
import { WebSocketProvider } from '../src/context/WebSocketContext';
import { ConversationProvider } from '../src/context/ConversationContext';
import { WorkspaceProvider } from '../src/context/WorkspaceContext';
import { FilesTabProvider } from '../src/context/FilesTabContext';
import { initI18n } from '../src/i18n';

// Prevent splash screen from auto-hiding until routing is ready
SplashScreen.preventAutoHideAsync();

// Initialize i18n early
initI18n();

function AppContent() {
  const { preference, effectiveTheme } = useTheme();

  return (
    <>
      <NavigationThemeProvider value={effectiveTheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name='index' />
          <Stack.Screen name='connect' />
          <Stack.Screen name='(tabs)' />
          <Stack.Screen
            name='file-preview'
            options={{
              headerShown: true,
              headerTitle: '',
              headerBackTitle: '',
              animation: 'slide_from_right',
            }}
          />
        </Stack>
      </NavigationThemeProvider>
      <StatusBar style={preference === 'auto' ? 'auto' : preference === 'light' ? 'dark' : 'light'} />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <ConnectionProvider>
          <WebSocketProvider>
            <ConversationProvider>
              <WorkspaceProvider>
                <FilesTabProvider>
                  <AppContent />
                </FilesTabProvider>
              </WorkspaceProvider>
            </ConversationProvider>
          </WebSocketProvider>
        </ConnectionProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
