import type { ExplorerSettings, MaskedSpotSummary } from '@seichi/shared';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { mobileApi } from '../api/client.ts';

export const GEOFENCE_TASK_NAME = 'SEICHI_OS_GEOFENCING_TASK';
export const OUT_AND_ABOUT_TASK_NAME = 'SEICHI_OUT_AND_ABOUT_TASK';

const COOLDOWN_STORE_KEY = 'seichi_notify_cooldown_v1';
const SETTINGS_CACHE_KEY = 'seichi_bg_settings_v1';
const SPOT_META_CACHE_KEY = 'seichi_geofence_meta_v1';
const REFRESH_REGION_ID = '__SEICHI_REFRESH_BOUNDARY__';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

interface CachedSpotMeta {
  id: string;
  displayTitle: string;
  prefecture: string;
}

async function readJsonFromStore<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonToStore(key: string, value: unknown): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, JSON.stringify(value));
  } catch {
    // Ignore storage limits in simulator
  }
}

async function shouldNotifySpot(
  spotId: string,
  cooldownHours: number,
): Promise<boolean> {
  const map = await readJsonFromStore<Record<string, number>>(
    COOLDOWN_STORE_KEY,
    {},
  );
  const lastTs = map[spotId] ?? 0;
  const cooldownMs = Math.max(1, cooldownHours) * 60 * 60 * 1000;
  return Date.now() - lastTs >= cooldownMs;
}

async function markSpotNotified(spotId: string): Promise<void> {
  const map = await readJsonFromStore<Record<string, number>>(
    COOLDOWN_STORE_KEY,
    {},
  );
  map[spotId] = Date.now();
  // 古いエントリを整理してSecureStoreの容量上限（2KB）を守る
  const entries = Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);
  await writeJsonToStore(COOLDOWN_STORE_KEY, Object.fromEntries(entries));
}

async function scheduleProximityPush(params: {
  spotId: string;
  displayTitle: string;
  distanceMeters?: number;
  prefecture?: string;
}): Promise<void> {
  const distText =
    params.distanceMeters !== undefined
      ? `（残り約${Math.round(params.distanceMeters)}m）`
      : '';
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '🧭 近くに未訪問の聖地があります！',
      body: `『${params.displayTitle}』${distText} コンパスを開いて探索しましょう`,
      data: { spotId: params.spotId },
      sound: 'default',
    },
    trigger: null,
  });
}

// 1. OSジオフェンス監視タスク（省電力モード: 最大18件＋更新境界1件）
if (!TaskManager.isTaskDefined(GEOFENCE_TASK_NAME)) {
  TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }) => {
    if (error || !data) return;
    const event = data as {
      eventType: Location.GeofencingEventType;
      region: Location.LocationRegion;
    };

    const settings = await readJsonFromStore<ExplorerSettings | null>(
      SETTINGS_CACHE_KEY,
      null,
    );
    if (!settings || settings.notificationMode === 'off') return;

    const regionId = event.region.identifier;
    if (!regionId) return;

    // 外周2.5kmの境界を出たら最寄り18スポットを再計算・再登録
    if (
      regionId === REFRESH_REGION_ID &&
      event.eventType === Location.GeofencingEventType.Exit
    ) {
      try {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const { spots } = await mobileApi.searchSpots({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          member: settings.notificationMembers[0],
          limit: 50,
          maskLevel: settings.maskLevel,
          tagVisibility: settings.tagVisibility,
          mapMode: 'treasure',
        });
        await registerPowerSaveRegions(
          pos.coords.latitude,
          pos.coords.longitude,
          spots,
          settings,
        );
      } catch {
        // Ignore transient network errors in background
      }
      return;
    }

    if (event.eventType === Location.GeofencingEventType.Enter) {
      const allowed = await shouldNotifySpot(
        regionId,
        settings.notificationCooldownHours,
      );
      if (!allowed) return;

      const metaMap = await readJsonFromStore<Record<string, CachedSpotMeta>>(
        SPOT_META_CACHE_KEY,
        {},
      );
      const meta = metaMap[regionId];

      let distanceMeters: number | undefined;
      try {
        const pos = await Location.getLastKnownPositionAsync();
        if (pos) {
          const bearing = await mobileApi.fetchBearing(
            regionId,
            pos.coords.latitude,
            pos.coords.longitude,
          );
          distanceMeters = bearing.distanceMeters;
        }
      } catch {
        // Offline fallback
      }

      await markSpotNotified(regionId);
      await scheduleProximityPush({
        spotId: regionId,
        displayTitle: meta?.displayTitle ?? '？？？',
        distanceMeters,
        prefecture: meta?.prefecture,
      });
    }
  });
}

// 2. お出かけ中モード（移動連動バックグラウンド測位タスク）
if (!TaskManager.isTaskDefined(OUT_AND_ABOUT_TASK_NAME)) {
  TaskManager.defineTask(OUT_AND_ABOUT_TASK_NAME, async ({ data, error }) => {
    if (error || !data) return;
    const { locations } = data as { locations?: Location.LocationObject[] };
    const latest = locations?.[locations.length - 1];
    if (!latest) return;

    const settings = await readJsonFromStore<ExplorerSettings | null>(
      SETTINGS_CACHE_KEY,
      null,
    );
    if (!settings || settings.notificationMode !== 'out_and_about') return;

    try {
      const { spots } = await mobileApi.searchSpots({
        lat: latest.coords.latitude,
        lng: latest.coords.longitude,
        member: settings.notificationMembers[0],
        limit: 12,
        maskLevel: settings.maskLevel,
        tagVisibility: settings.tagVisibility,
        mapMode: 'treasure',
      });

      const target = spots.find(
        (s) =>
          !s.isUnlocked && s.distanceMeters <= settings.notificationRadiusMeters,
      );
      if (!target) return;

      const allowed = await shouldNotifySpot(
        target.id,
        settings.notificationCooldownHours,
      );
      if (!allowed) return;

      await markSpotNotified(target.id);
      await scheduleProximityPush({
        spotId: target.id,
        displayTitle: target.displayTitle,
        distanceMeters: target.distanceMeters,
        prefecture: target.prefecture,
      });
    } catch {
      // Ignore offline errors in background
    }
  });
}

async function registerPowerSaveRegions(
  userLat: number,
  userLng: number,
  spots: MaskedSpotSummary[],
  settings: ExplorerSettings,
): Promise<void> {
  const unvisited = spots
    .filter((s) => !s.isUnlocked)
    .filter(
      (s) =>
        settings.notificationMembers.length === 0 ||
        s.visibleMembers.some((m) => settings.notificationMembers.includes(m)),
    )
    .slice(0, 18);

  const metaCache: Record<string, CachedSpotMeta> = {};
  for (const s of unvisited) {
    metaCache[s.id] = {
      id: s.id,
      displayTitle: s.displayTitle,
      prefecture: s.prefecture,
    };
  }
  await writeJsonToStore(SPOT_META_CACHE_KEY, metaCache);

  // radarLat/radarLngは真の座標から最大480mオフセットされているため、
  // 480m + 通知半径 のジオフェンスを張ることで正確な座標を端末へ一切漏洩させずに接近検知を保証する
  const safeGeofenceRadius = Math.max(
    650,
    480 + settings.notificationRadiusMeters,
  );

  const regions: Location.LocationRegion[] = unvisited.map((s) => ({
    identifier: s.id,
    latitude: s.radarLat,
    longitude: s.radarLng,
    radius: safeGeofenceRadius,
    notifyOnEnter: true,
    notifyOnExit: false,
  }));

  regions.push({
    identifier: REFRESH_REGION_ID,
    latitude: userLat,
    longitude: userLng,
    radius: 2500,
    notifyOnEnter: false,
    notifyOnExit: true,
  });

  await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, regions);
}

/**
 * ユーザーの通知設定（OFF / 省電力OSジオフェンス / お出かけ中モード）に合わせてバックグラウンド監視を同期
 */
export async function syncBackgroundProximityMonitoring(params: {
  settings: ExplorerSettings;
  userLat: number;
  userLng: number;
  spots: MaskedSpotSummary[];
}): Promise<{ active: boolean; reason?: string }> {
  await writeJsonToStore(SETTINGS_CACHE_KEY, params.settings);

  // まず既存タスクを安全にクリーンアップ
  const hasGeofence = await Location.hasStartedGeofencingAsync(
    GEOFENCE_TASK_NAME,
  ).catch(() => false);
  const hasOutAndAbout = await Location.hasStartedLocationUpdatesAsync(
    OUT_AND_ABOUT_TASK_NAME,
  ).catch(() => false);

  if (params.settings.notificationMode === 'off') {
    if (hasGeofence) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => {});
    }
    if (hasOutAndAbout) {
      await Location.stopLocationUpdatesAsync(OUT_AND_ABOUT_TASK_NAME).catch(
        () => {},
      );
    }
    return { active: false };
  }

  // 通知権限とバックグラウンド位置情報権限を確認
  const notifPerm = await Notifications.requestPermissionsAsync();
  if (notifPerm.status !== 'granted') {
    return { active: false, reason: '通知権限が許可されていません' };
  }

  const fgPerm = await Location.requestForegroundPermissionsAsync();
  if (fgPerm.status !== 'granted') {
    return { active: false, reason: '位置情報権限が許可されていません' };
  }

  const bgPerm = await Location.requestBackgroundPermissionsAsync();
  if (bgPerm.status !== 'granted') {
    return {
      active: false,
      reason: 'バックグラウンド位置情報（「常に許可」）が未設定です',
    };
  }

  if (params.settings.notificationMode === 'power_save') {
    if (hasOutAndAbout) {
      await Location.stopLocationUpdatesAsync(OUT_AND_ABOUT_TASK_NAME).catch(
        () => {},
      );
    }
    await registerPowerSaveRegions(
      params.userLat,
      params.userLng,
      params.spots,
      params.settings,
    );
    return { active: true };
  }

  // out_and_about モード
  if (hasGeofence) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => {});
  }
  await Location.startLocationUpdatesAsync(OUT_AND_ABOUT_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    distanceInterval: 150,
    deferredUpdatesInterval: 60_000,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: '聖地コンパス お出かけ中モード稼働中',
      notificationBody: '近くの未訪問聖地を探索しています🧭',
      notificationColor: '#0284c7',
    },
  });
  return { active: true };
}
