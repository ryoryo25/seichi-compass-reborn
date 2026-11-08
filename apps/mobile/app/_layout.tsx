import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '@/context/AppContext.tsx';

function extractGoogleMapsUrl(raw: string): string | null {
  const match = raw.match(/https?:\/\/[^\s]+/i);
  const candidate = match ? match[0] : raw.trim();
  if (
    candidate.includes('google.com/maps') ||
    candidate.includes('maps.app.goo.gl') ||
    candidate.includes('goo.gl/maps')
  ) {
    return candidate;
  }
  try {
    const parsed = Linking.parse(raw);
    const sharedParam = parsed.queryParams?.url ?? parsed.queryParams?.sharedUrl;
    if (typeof sharedParam === 'string' && sharedParam.length > 0) {
      return sharedParam;
    }
  } catch {
    // Ignore malformed URLs
  }
  return null;
}

function NavigationBridge() {
  const router = useRouter();
  const { setPendingSharedUrl } = useApp();

  // 1. バックグラウンド近接通知タップ → 該当スポットのコンパス画面へ直行
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const spotId = response.notification.request.content.data?.spotId;
        if (typeof spotId === 'string' && spotId.length > 0) {
          router.push(`/compass/${encodeURIComponent(spotId)}`);
        }
      },
    );
    return () => sub.remove();
  }, [router]);

  // 2. Googleマップ共有URL / ディープリンク受信 → 聖地登録タブへ自動セット
  useEffect(() => {
    const handleIncomingUrl = (url: string | null) => {
      if (!url) return;
      const gmapUrl = extractGoogleMapsUrl(url);
      if (gmapUrl) {
        setPendingSharedUrl(gmapUrl);
        router.push('/(tabs)/register');
      }
    };

    void Linking.getInitialURL().then(handleIncomingUrl);
    const sub = Linking.addEventListener('url', (ev) =>
      handleIncomingUrl(ev.url),
    );
    return () => sub.remove();
  }, [router, setPendingSharedUrl]);

  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="dark" />
        <NavigationBridge />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#f0f9ff' },
            headerTintColor: '#0c4a6e',
            headerTitleStyle: { fontWeight: '700' },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="compass/[id]"
            options={{
              title: '聖地コンパス誘導',
              headerBackTitle: '戻る',
            }}
          />
        </Stack>
      </AppProvider>
    </SafeAreaProvider>
  );
}
