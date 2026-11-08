import { Tabs } from 'expo-router';
import { Text } from 'react-native';

function TabIcon({ emoji }: { emoji: string }) {
  return <Text style={{ fontSize: 19 }}>{emoji}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#f0f9ff' },
        headerTintColor: '#0c4a6e',
        headerTitleStyle: { fontWeight: '800' },
        tabBarActiveTintColor: '#0284c7',
        tabBarInactiveTintColor: '#64748b',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#e0f2fe',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '聖地探索',
          tabBarLabel: '探索リスト',
          tabBarIcon: () => <TabIcon emoji="🧭" />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: '聖地レーダーマップ',
          tabBarLabel: 'マップ',
          tabBarIcon: () => <TabIcon emoji="🗺️" />,
        }}
      />
      <Tabs.Screen
        name="register"
        options={{
          title: '聖地を追加',
          tabBarLabel: '聖地登録',
          tabBarIcon: () => <TabIcon emoji="📍" />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'マイページ・設定',
          tabBarLabel: 'マイページ',
          tabBarIcon: () => <TabIcon emoji="🏆" />,
        }}
      />
    </Tabs>
  );
}
