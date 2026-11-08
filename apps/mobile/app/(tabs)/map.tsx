import { formatDistance } from '@seichi/shared';
import { useRouter } from 'expo-router';
import { Fragment } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import { useApp } from '@/context/AppContext.tsx';

export default function RadarMapScreen() {
  const router = useRouter();
  const { coords, spots, settings, updateSettings } = useApp();

  const toggleMapMode = (mode: 'treasure' | 'standard') => {
    void updateSettings({ ...settings, mapMode: mode });
  };

  return (
    <View style={styles.container}>
      {/* モード切替バー（宝探しレーダー vs 通常聖地マップ） */}
      <View style={styles.topOverlay}>
        <View style={styles.modeSwitch}>
          <Pressable
            style={[
              styles.modeBtn,
              settings.mapMode === 'treasure' && styles.modeBtnActive,
            ]}
            onPress={() => toggleMapMode('treasure')}
          >
            <Text
              style={[
                styles.modeBtnText,
                settings.mapMode === 'treasure' && styles.modeBtnTextActive,
              ]}
            >
              🕵️ 宝探しレーダー
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.modeBtn,
              settings.mapMode === 'standard' && styles.modeBtnActive,
            ]}
            onPress={() => toggleMapMode('standard')}
          >
            <Text
              style={[
                styles.modeBtnText,
                settings.mapMode === 'standard' && styles.modeBtnTextActive,
              ]}
            >
              📍 通常聖地マップ
            </Text>
          </Pressable>
        </View>
        <Text style={styles.legendText}>
          {settings.mapMode === 'treasure'
            ? '未訪問は約420mのぼかしレーダー円のみ表示・訪問済は正確なピンを表示'
            : '全聖地の正確なピンを表示（到着しても自力発見バッジは対象外）'}
        </Text>
      </View>

      <MapView
        style={styles.map}
        showsUserLocation
        initialRegion={{
          latitude: coords.lat,
          longitude: coords.lng,
          latitudeDelta: 0.045,
          longitudeDelta: 0.045,
        }}
      >
        {spots.slice(0, 180).map((spot) => {
          const showExact =
            spot.isUnlocked ||
            (settings.mapMode === 'standard' &&
              spot.exactLat !== undefined &&
              spot.exactLng !== undefined);

          if (showExact && spot.exactLat !== undefined && spot.exactLng !== undefined) {
            const pinColor =
              spot.visitStatus === 'visited'
                ? '#10b981'
                : spot.visitStatus === 'give_up'
                  ? '#f59e0b'
                  : '#0284c7';
            return (
              <Marker
                key={spot.id}
                coordinate={{
                  latitude: spot.exactLat,
                  longitude: spot.exactLng,
                }}
                pinColor={pinColor}
                title={spot.displayTitle}
                description={`${spot.prefecture}・${formatDistance(spot.distanceMeters)}（タップでコンパス誘導）`}
                onCalloutPress={() =>
                  router.push(`/compass/${encodeURIComponent(spot.id)}`)
                }
              />
            );
          }

          return (
            <Fragment key={spot.id}>
              <Circle
                center={{
                  latitude: spot.radarLat,
                  longitude: spot.radarLng,
                }}
                radius={420}
                fillColor="rgba(14, 165, 233, 0.16)"
                strokeColor="rgba(2, 132, 199, 0.55)"
                strokeWidth={1.5}
              />
              <Marker
                coordinate={{
                  latitude: spot.radarLat,
                  longitude: spot.radarLng,
                }}
                pinColor="#38bdf8"
                title={`🧭 ${spot.displayTitle}`}
                description={`レーダー圏内（残り${formatDistance(spot.distanceMeters)}）・タップしてコンパス起動`}
                onCalloutPress={() =>
                  router.push(`/compass/${encodeURIComponent(spot.id)}`)
                }
              />
            </Fragment>
          );
        })}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  topOverlay: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 3,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 8,
  },
  modeBtnActive: { backgroundColor: '#0284c7' },
  modeBtnText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  modeBtnTextActive: { color: '#ffffff' },
  legendText: {
    marginTop: 6,
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
  },
});
