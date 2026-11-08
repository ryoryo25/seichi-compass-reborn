import {
  type AuthUser,
  type ExplorerSettings,
  ExplorerSettingsSchema,
  type MaskedSpotSummary,
  type MediaCategory,
  type VisitRecord,
} from '@seichi/shared';
import * as Location from 'expo-location';
import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { type ApiMetaResponse, mobileApi } from '../api/client.ts';
import { syncBackgroundProximityMonitoring } from '../services/geofencing.ts';

// 初期位置デフォルト: 東京駅周辺（GPS未許可時フォールバック）
const DEFAULT_COORDS = { lat: 35.681236, lng: 139.767125 };

interface AppContextValue {
  meta: ApiMetaResponse | null;
  user: AuthUser | null;
  visits: Record<string, VisitRecord>;
  settings: ExplorerSettings;
  coords: { lat: number; lng: number };
  usingRealGps: boolean;
  spots: MaskedSpotSummary[];
  loadingSpots: boolean;
  selectedMember: string;
  setSelectedMember: (m: string) => void;
  selectedMedia: MediaCategory | '';
  setSelectedMedia: (c: MediaCategory | '') => void;
  tagQuery: string;
  setTagQuery: (q: string) => void;
  pendingSharedUrl: string | null;
  setPendingSharedUrl: (url: string | null) => void;
  geofenceStatusText: string;
  refreshGpsLocation: () => Promise<void>;
  setSimulatedCoords: (lat: number, lng: number) => void;
  refreshSpots: () => Promise<void>;
  reloadSession: () => Promise<void>;
  updateSettings: (next: ExplorerSettings) => Promise<void>;
  signUp: (payload: {
    email: string;
    password: string;
    name: string;
  }) => Promise<void>;
  signIn: (payload: { email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = useState<ApiMetaResponse | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [visits, setVisits] = useState<Record<string, VisitRecord>>({});
  const [settings, setSettings] = useState<ExplorerSettings>(() =>
    ExplorerSettingsSchema.parse({}),
  );
  const [coords, setCoords] = useState(DEFAULT_COORDS);
  const [usingRealGps, setUsingRealGps] = useState(false);
  const [spots, setSpots] = useState<MaskedSpotSummary[]>([]);
  const [loadingSpots, setLoadingSpots] = useState(true);
  const [selectedMember, setSelectedMember] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<MediaCategory | ''>('');
  const [tagQuery, setTagQuery] = useState('');
  const [debouncedTagQuery, setDebouncedTagQuery] = useState('');
  const [pendingSharedUrl, setPendingSharedUrl] = useState<string | null>(null);
  const [geofenceStatusText, setGeofenceStatusText] = useState('未起動');

  const initializedRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTagQuery(tagQuery.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [tagQuery]);

  const reloadSession = useCallback(async () => {
    const session = await mobileApi.initOrRestoreSession();
    setUser(session.user);
    setVisits(session.visits);
    setSettings(session.user.settings);
  }, []);

  const refreshGpsLocation = useCallback(async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setCoords({
        lat: Number(loc.coords.latitude.toFixed(6)),
        lng: Number(loc.coords.longitude.toFixed(6)),
      });
      setUsingRealGps(true);
    } catch {
      // Keep current/fallback coords
    }
  }, []);

  const setSimulatedCoords = useCallback((lat: number, lng: number) => {
    setCoords({ lat, lng });
    setUsingRealGps(false);
  }, []);

  const refreshSpots = useCallback(async () => {
    setLoadingSpots(true);
    try {
      const res = await mobileApi.searchSpots({
        lat: coords.lat,
        lng: coords.lng,
        member: selectedMember || undefined,
        notificationMembers:
          settings.notificationMembers.length > 0
            ? settings.notificationMembers
            : undefined,
        mediaCategory: selectedMedia || undefined,
        tagQuery: debouncedTagQuery || undefined,
        limit: 250,
        maskLevel: settings.maskLevel,
        tagVisibility: settings.tagVisibility,
        mapMode: settings.mapMode,
      });
      setSpots(res.spots);
    } catch {
      // Offline / API unreachable
    } finally {
      setLoadingSpots(false);
    }
  }, [
    coords.lat,
    coords.lng,
    selectedMember,
    selectedMedia,
    debouncedTagQuery,
    settings.maskLevel,
    settings.tagVisibility,
    settings.mapMode,
    settings.notificationMembers,
  ]);

  // 初回起動ブートストラップ
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void (async () => {
      await Promise.allSettled([
        mobileApi.fetchMeta().then(setMeta),
        reloadSession(),
        refreshGpsLocation(),
      ]);
    })();
  }, [reloadSession, refreshGpsLocation]);

  // 条件変更時にスポット再検索
  useEffect(() => {
    void refreshSpots();
  }, [refreshSpots]);

  // バックグラウンド近接通知（OSジオフェンス / お出かけ中モード）同期
  useEffect(() => {
    if (spots.length === 0 && settings.notificationMode !== 'off') return;
    void syncBackgroundProximityMonitoring({
      settings,
      userLat: coords.lat,
      userLng: coords.lng,
      spots,
    }).then((res) => {
      if (settings.notificationMode === 'off') {
        setGeofenceStatusText('OFF');
      } else if (res.active) {
        setGeofenceStatusText(
          settings.notificationMode === 'power_save'
            ? '省電力ジオフェンス稼働中'
            : 'お出かけ中モード稼働中',
        );
      } else {
        setGeofenceStatusText(res.reason ?? '待機中');
      }
    });
  }, [settings, coords.lat, coords.lng, spots]);

  const updateSettings = useCallback(async (next: ExplorerSettings) => {
    setSettings(next);
    const res = await mobileApi.updateSettings(next);
    setUser(res.user);
  }, []);

  const signUp = useCallback(
    async (payload: { email: string; password: string; name: string }) => {
      const res = await mobileApi.signUpEmail(payload);
      setUser(res.user);
      setVisits(res.visits);
      setSettings(res.user.settings);
    },
    [],
  );

  const signIn = useCallback(
    async (payload: { email: string; password: string }) => {
      const res = await mobileApi.signInEmail(payload);
      setUser(res.user);
      setVisits(res.visits);
      setSettings(res.user.settings);
    },
    [],
  );

  const signOut = useCallback(async () => {
    await mobileApi.signOut();
    await reloadSession();
  }, [reloadSession]);

  return (
    <AppContext.Provider
      value={{
        meta,
        user,
        visits,
        settings,
        coords,
        usingRealGps,
        spots,
        loadingSpots,
        selectedMember,
        setSelectedMember,
        selectedMedia,
        setSelectedMedia,
        tagQuery,
        setTagQuery,
        pendingSharedUrl,
        setPendingSharedUrl,
        geofenceStatusText,
        refreshGpsLocation,
        setSimulatedCoords,
        refreshSpots,
        reloadSession,
        updateSettings,
        signUp,
        signIn,
        signOut,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used inside AppProvider');
  }
  return ctx;
}
