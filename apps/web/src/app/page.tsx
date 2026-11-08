'use client';

import {
  type AuthUser,
  type ExplorerSettings,
  ExplorerSettingsSchema,
  formatDistance,
  haversineDistanceMeters,
  HINATAZAKA_MEMBERS,
  MEDIA_CATEGORY_META,
  type MaskedSpotSummary,
  type MediaCategory,
  type Spot,
  type SpotComment,
  type VisitRecord,
} from '@seichi/shared';
import {
  Award,
  BellRing,
  Compass,
  FlaskConical,
  LocateFixed,
  Map as MapIcon,
  PlusCircle,
  Radar,
  Search,
  ShieldCheck,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthModal } from '@/components/auth/AuthModal';
import { CompassView } from '@/components/compass/CompassView';
import { SeichiMap } from '@/components/map/SeichiMap';
import { ProfileSettingsPanel } from '@/components/profile/ProfileSettingsPanel';
import { RegisterSpotPanel } from '@/components/register/RegisterSpotPanel';
import { SpotDetailModal } from '@/components/spot/SpotDetailModal';

type TabKey = 'explore' | 'map' | 'register' | 'profile';

const DEMO_LOCATION_PRESETS: ReadonlyArray<{
  label: string;
  lat: number;
  lng: number;
}> = [
  { label: '渋谷・原宿（キャットストリート周辺）', lat: 35.6626, lng: 139.7038 },
  { label: '港区三田（日向坂周辺）', lat: 35.6518, lng: 139.7372 },
  { label: '水道橋（東京ドーム周辺）', lat: 35.7042, lng: 139.7528 },
  { label: '横浜（横浜スタジアム・みなとみらい）', lat: 35.4438, lng: 139.6402 },
  { label: '宮崎（サンマリンスタジアム周辺）', lat: 31.8258, lng: 131.4465 },
];

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<TabKey>('explore');
  const [sessionReady, setSessionReady] = useState(false);

  // サーバー同期された認証ユーザー & 訪問記録
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [settings, setSettings] = useState<ExplorerSettings>(() =>
    ExplorerSettingsSchema.parse({}),
  );
  const [visitBook, setVisitBook] = useState<Record<string, VisitRecord>>({});
  const [showAuthModal, setShowAuthModal] = useState(false);

  // 位置情報 & シミュレーター
  const [isDemoMode, setIsDemoMode] = useState(true);
  const [showSimulatorBar, setShowSimulatorBar] = useState(false);
  const [userLat, setUserLat] = useState(DEMO_LOCATION_PRESETS[0]!.lat);
  const [userLng, setUserLng] = useState(DEMO_LOCATION_PRESETS[0]!.lng);
  const [deviceHeadingDeg, setDeviceHeadingDeg] = useState(0);

  // メタ情報 & 機能フラグ
  const [meta, setMeta] = useState<{
    totalSpots: number;
    totalEpisodes: number;
    prefectures: Array<{ prefecture: string; totalSpots: number }>;
    oauthProviders: { twitter: boolean; google: boolean; apple: boolean };
    allowDevRoleSwitch: boolean;
    enableDemoSimulator: boolean;
  }>({
    totalSpots: 0,
    totalEpisodes: 0,
    prefectures: [],
    oauthProviders: { twitter: false, google: false, apple: false },
    allowDevRoleSwitch: true,
    enableDemoSimulator: true,
  });

  // 検索フィルタ
  const [filterMember, setFilterMember] = useState('');
  const [filterCategory, setFilterCategory] = useState<MediaCategory | ''>('');
  const [filterPrefecture, setFilterPrefecture] = useState('');
  const [tagQuery, setTagQuery] = useState('');
  const [debouncedTagQuery, setDebouncedTagQuery] = useState('');
  const [onlyUnvisited, setOnlyUnvisited] = useState(false);

  // 周辺スポット & 選択中コンパス（遠方スポット直接指定時のフォールバック含む）
  const [spots, setSpots] = useState<MaskedSpotSummary[]>([]);
  const [loadingSpots, setLoadingSpots] = useState(true);
  const [selectedCompassSpotId, setSelectedCompassSpotId] = useState<string | null>(
    null,
  );
  const [fallbackCompassSpot, setFallbackCompassSpot] =
    useState<MaskedSpotSummary | null>(null);
  const [needsCompassPermission, setNeedsCompassPermission] = useState(false);
  const lastGpsPosRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedTagQuery(tagQuery.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [tagQuery]);

  // 解禁モーダル
  const [unlockedModalData, setUnlockedModalData] = useState<{
    spot: Spot;
    comments: SpotComment[];
  } | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);

  // 接近通知クールダウン
  const notifiedSpotTimestamps = useRef<Record<string, number>>({});
  const [proximityToastSpot, setProximityToastSpot] =
    useState<MaskedSpotSummary | null>(null);

  // URL クエリ (?compass=spot_id) からのコンパス直接起動
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const compassTarget = params.get('compass');
    if (compassTarget) {
      setSelectedCompassSpotId(compassTarget);
      setActiveTab('explore');
    }
  }, []);

  // 1. セッション初期化（ゲスト匿名セッション自動発行または既存セッション復元）
  const initSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { method: 'POST' });
      if (res.ok) {
        const data = (await res.json()) as {
          user: AuthUser;
          visits: Record<string, VisitRecord>;
        };
        setCurrentUser(data.user);
        setSettings(data.user.settings);
        setVisitBook(data.visits);
      }
    } finally {
      setSessionReady(true);
    }
  }, []);

  useEffect(() => {
    initSession();
  }, [initSession]);

  // 2. メタデータ取得
  const fetchMeta = useCallback(async () => {
    try {
      const res = await fetch('/api/meta');
      if (!res.ok) return;
      const data = await res.json();
      setMeta(data);
      if (!data.enableDemoSimulator) {
        setIsDemoMode(false);
        setShowSimulatorBar(false);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchMeta();
  }, [fetchMeta]);

  const applyOrientationEvent = useCallback((event: DeviceOrientationEvent) => {
    const webkitHeading = (
      event as DeviceOrientationEvent & { webkitCompassHeading?: number }
    ).webkitCompassHeading;
    if (typeof webkitHeading === 'number') {
      setDeviceHeadingDeg(webkitHeading);
    } else if (typeof event.alpha === 'number') {
      setDeviceHeadingDeg((360 - event.alpha) % 360);
    }
  }, []);

  const handleRequestCompassPermission = useCallback(async () => {
    if (typeof DeviceOrientationEvent === 'undefined') return;
    const reqPerm = (
      DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<'granted' | 'denied'>;
      }
    ).requestPermission;
    if (typeof reqPerm !== 'function') {
      setNeedsCompassPermission(false);
      return;
    }
    try {
      const state = await reqPerm();
      if (state === 'granted') {
        setNeedsCompassPermission(false);
      }
    } catch {
      // ignore user dismissal
    }
  }, []);

  // 3. リアルGPS（15m移動閾値デバウンス） & 磁気コンパス購読（iOS 13+ 権限プロンプト対応）
  useEffect(() => {
    if (isDemoMode || typeof window === 'undefined') return;

    if (typeof DeviceOrientationEvent !== 'undefined') {
      const reqPerm = (
        DeviceOrientationEvent as unknown as {
          requestPermission?: () => Promise<string>;
        }
      ).requestPermission;
      if (typeof reqPerm === 'function') {
        setNeedsCompassPermission(true);
      }
    }

    let watchId: number | null = null;
    if ('geolocation' in navigator) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const nextLat = Number(pos.coords.latitude.toFixed(6));
          const nextLng = Number(pos.coords.longitude.toFixed(6));
          const prev = lastGpsPosRef.current;
          if (
            !prev ||
            haversineDistanceMeters(prev.lat, prev.lng, nextLat, nextLng) >= 15
          ) {
            lastGpsPosRef.current = { lat: nextLat, lng: nextLng };
            setUserLat(nextLat);
            setUserLng(nextLng);
          }
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 5000 },
      );
    }

    window.addEventListener(
      'deviceorientationabsolute',
      applyOrientationEvent as EventListener,
      true,
    );
    window.addEventListener('deviceorientation', applyOrientationEvent, true);
    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      window.removeEventListener(
        'deviceorientationabsolute',
        applyOrientationEvent as EventListener,
        true,
      );
      window.removeEventListener(
        'deviceorientation',
        applyOrientationEvent,
        true,
      );
    };
  }, [isDemoMode, applyOrientationEvent]);

  // 4. 周辺スポット検索（サーバー上の訪問状態と自動統合）
  const fetchSpots = useCallback(async () => {
    if (!sessionReady) return;
    setLoadingSpots(true);
    try {
      const res = await fetch('/api/spots/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: userLat,
          lng: userLng,
          member: filterMember || undefined,
          notificationMembers:
            settings.notificationMembers.length > 0
              ? settings.notificationMembers
              : undefined,
          mediaCategory: filterCategory || undefined,
          prefecture: filterPrefecture || undefined,
          tagQuery: debouncedTagQuery || undefined,
          limit: 300,
          maskLevel: settings.maskLevel,
          tagVisibility: settings.tagVisibility,
          mapMode: settings.mapMode,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { spots: MaskedSpotSummary[] };
      setSpots(data.spots);
    } finally {
      setLoadingSpots(false);
    }
  }, [
    sessionReady,
    userLat,
    userLng,
    filterMember,
    filterCategory,
    filterPrefecture,
    debouncedTagQuery,
    settings.maskLevel,
    settings.tagVisibility,
    settings.mapMode,
    settings.notificationMembers,
    visitBook,
  ]);

  useEffect(() => {
    fetchSpots();
  }, [fetchSpots]);

  // 4b. ?compass=<spotId> 等で最寄り300件外の遠方スポットが選択された場合の単体サマリ取得
  useEffect(() => {
    if (!sessionReady || !selectedCompassSpotId) {
      setFallbackCompassSpot(null);
      return;
    }
    if (spots.some((s) => s.id === selectedCompassSpotId)) {
      return;
    }
    let cancelled = false;
    const qs = new URLSearchParams({
      lat: String(userLat),
      lng: String(userLng),
      maskLevel: settings.maskLevel,
      tagVisibility: settings.tagVisibility,
      mapMode: settings.mapMode,
    });
    fetch(
      `/api/spots/${encodeURIComponent(selectedCompassSpotId)}/summary?${qs.toString()}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { spot?: MaskedSpotSummary } | null) => {
        if (!cancelled && data?.spot) {
          setFallbackCompassSpot(data.spot);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    sessionReady,
    selectedCompassSpotId,
    spots,
    userLat,
    userLng,
    settings.maskLevel,
    settings.tagVisibility,
    settings.mapMode,
    visitBook,
  ]);

  // 5. 接近通知検知
  useEffect(() => {
    if (!sessionReady || settings.notificationMode === 'off' || spots.length === 0) {
      return;
    }
    const now = Date.now();
    const cooldownMs = settings.notificationCooldownHours * 3600 * 1000;

    const candidate = spots.find((s) => {
      if (s.visitStatus !== 'unvisited') return false;
      if (s.distanceMeters > settings.notificationRadiusMeters) return false;
      const lastNotified = notifiedSpotTimestamps.current[s.id] ?? 0;
      if (now - lastNotified < cooldownMs) return false;
      return s.matchesNotificationMembers !== false;
    });

    if (candidate) {
      notifiedSpotTimestamps.current[candidate.id] = now;
      setProximityToastSpot(candidate);
    }
  }, [
    sessionReady,
    spots,
    settings.notificationMode,
    settings.notificationRadiusMeters,
    settings.notificationCooldownHours,
    settings.notificationMembers,
  ]);

  const displayedSpots = useMemo(() => {
    return onlyUnvisited
      ? spots.filter((s) => s.visitStatus === 'unvisited')
      : spots;
  }, [spots, onlyUnvisited]);

  const activeCompassSpot = useMemo(() => {
    if (!selectedCompassSpotId) return null;
    return (
      spots.find((s) => s.id === selectedCompassSpotId) ??
      (fallbackCompassSpot?.id === selectedCompassSpotId
        ? fallbackCompassSpot
        : null)
    );
  }, [spots, selectedCompassSpotId, fallbackCompassSpot]);

  const handleUpdateSettings = async (next: ExplorerSettings) => {
    setSettings(next);
    const res = await fetch('/api/me/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (res.ok) {
      const data = (await res.json()) as { user: AuthUser };
      setCurrentUser(data.user);
    }
  };

  const handleToggleAdminForDev = async () => {
    if (!currentUser) return;
    const nextRole = currentUser.role === 'admin' ? 'user' : 'admin';
    const res = await fetch('/api/me/dev-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: nextRole }),
    });
    if (res.ok) {
      const data = (await res.json()) as { user: AuthUser };
      setCurrentUser(data.user);
    }
  };

  const handleSignOut = async () => {
    await fetch('/api/auth/signout', { method: 'POST' });
    await initSession();
  };

  const handleUnlockSpot = async (
    spotId: string,
    mode: 'arrive' | 'give_up' | 'view_unlocked',
  ) => {
    setIsUnlocking(true);
    setUnlockError(null);
    try {
      const res = await fetch(`/api/spots/${spotId}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userLat,
          userLng,
          mode,
          mapMode: settings.mapMode,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        spot?: Spot;
        visit?: VisitRecord;
        comments?: SpotComment[];
      };
      if (!res.ok || !data.spot) {
        setUnlockError(data.error ?? '解禁できませんでした');
        return;
      }

      if (data.visit) {
        setVisitBook((prev) => ({ ...prev, [spotId]: data.visit! }));
      }

      setUnlockedModalData({
        spot: data.spot,
        comments: data.comments ?? [],
      });
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleDemoApproach = async (spotId: string) => {
    const res = await fetch(`/api/demo/approach/${spotId}`, { method: 'POST' });
    if (!res.ok) return;
    const pos = (await res.json()) as { lat: number; lng: number };
    setIsDemoMode(true);
    setUserLat(pos.lat);
    setUserLng(pos.lng);
    setUnlockError(null);
  };

  const nudgeLocation = (dLat: number, dLng: number) => {
    setIsDemoMode(true);
    setUserLat((prev) => Number((prev + dLat).toFixed(6)));
    setUserLng((prev) => Number((prev + dLng).toFixed(6)));
  };

  const visitedCount = useMemo(
    () => Object.values(visitBook).filter((v) => v.status === 'visited').length,
    [visitBook],
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/* ヘッダー */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-sky-100">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-sky-400 to-sky-600 text-white flex items-center justify-center shadow-sm">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                  聖地コンパス
                </h1>
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">
                  日向坂46 Edition
                </span>
              </div>
              <p className="text-[11px] text-slate-500 hidden sm:block">
                収録聖地 {meta.totalSpots.toLocaleString()}ヶ所（計{' '}
                {meta.totalEpisodes.toLocaleString()}エピソード）・達成 {visitedCount}ヶ所
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {meta.enableDemoSimulator && (
              <button
                type="button"
                onClick={() => setShowSimulatorBar((v) => !v)}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1 border cursor-pointer ${
                  showSimulatorBar
                    ? 'bg-sky-50 text-sky-700 border-sky-200'
                    : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                <FlaskConical className="w-3.5 h-3.5" />
                位置シミュレーター
              </button>
            )}

            {meta.allowDevRoleSwitch && currentUser && (
              <button
                type="button"
                onClick={handleToggleAdminForDev}
                title="開発環境用：管理者モード切替"
                className={`px-2.5 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1 border cursor-pointer ${
                  currentUser.role === 'admin'
                    ? 'bg-indigo-600 text-white border-indigo-700'
                    : 'bg-white text-slate-500 border-slate-200 hover:text-slate-800'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {currentUser.role === 'admin' ? 'Admin有効' : 'Admin切替'}
              </button>
            )}

            {currentUser?.isAnonymous ? (
              <button
                type="button"
                onClick={() => setShowAuthModal(true)}
                className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-extrabold inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                ログイン / 登録
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveTab('profile')}
                className="px-3 py-1.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-800 text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <UserCheck className="w-3.5 h-3.5" />
                {currentUser?.name}
              </button>
            )}
          </div>
        </div>

        {/* 位置シミュレーターバー */}
        {showSimulatorBar && meta.enableDemoSimulator && (
          <div className="bg-sky-950 text-sky-50 px-4 py-2.5 text-xs border-t border-sky-900">
            <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-extrabold text-sky-300">🧪 位置モード:</span>
                <button
                  type="button"
                  onClick={() => setIsDemoMode(false)}
                  className={`px-2.5 py-1 rounded-lg font-bold inline-flex items-center gap-1 cursor-pointer ${
                    !isDemoMode
                      ? 'bg-sky-500 text-white'
                      : 'bg-sky-900/70 text-sky-200 hover:bg-sky-800'
                  }`}
                >
                  <LocateFixed className="w-3.5 h-3.5" />
                  リアルGPS・磁気センサー
                </button>

                <select
                  value=""
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    const preset = DEMO_LOCATION_PRESETS[idx];
                    if (preset) {
                      setIsDemoMode(true);
                      setUserLat(preset.lat);
                      setUserLng(preset.lng);
                    }
                  }}
                  className="rounded-lg bg-sky-900 text-white border border-sky-700 px-2.5 py-1 font-semibold"
                >
                  <option value="" disabled>
                    📍 デモ現在地プリセット選択...
                  </option>
                  {DEMO_LOCATION_PRESETS.map((p, i) => (
                    <option key={p.label} value={i}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-1 bg-sky-900/70 px-2 py-1 rounded-lg">
                  <span className="text-sky-300">徒歩移動:</span>
                  <button
                    type="button"
                    onClick={() => nudgeLocation(0.00045, 0)}
                    className="px-1.5 py-0.5 rounded bg-sky-800 hover:bg-sky-700 cursor-pointer"
                  >
                    北50m
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgeLocation(-0.00045, 0)}
                    className="px-1.5 py-0.5 rounded bg-sky-800 hover:bg-sky-700 cursor-pointer"
                  >
                    南50m
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgeLocation(0, 0.00055)}
                    className="px-1.5 py-0.5 rounded bg-sky-800 hover:bg-sky-700 cursor-pointer"
                  >
                    東50m
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgeLocation(0, -0.00055)}
                    className="px-1.5 py-0.5 rounded bg-sky-800 hover:bg-sky-700 cursor-pointer"
                  >
                    西50m
                  </button>
                </div>

                {isDemoMode && (
                  <label className="inline-flex items-center gap-1.5 bg-sky-900/70 px-2.5 py-1 rounded-lg">
                    <span className="text-sky-300">端末の向き:</span>
                    <input
                      type="range"
                      min={0}
                      max={359}
                      value={deviceHeadingDeg}
                      onChange={(e) => setDeviceHeadingDeg(Number(e.target.value))}
                      className="w-20 accent-sky-400"
                    />
                    <span className="w-8 tabular-nums font-bold">
                      {Math.round(deviceHeadingDeg)}°
                    </span>
                  </label>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* 接近通知トースト */}
      {proximityToastSpot && (
        <div className="max-w-xl mx-auto w-full px-4 pt-3">
          <div className="rounded-2xl bg-gradient-to-r from-sky-600 to-indigo-600 text-white p-3.5 shadow-lg flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setSelectedCompassSpotId(proximityToastSpot.id);
                setActiveTab('explore');
                setProximityToastSpot(null);
              }}
              className="flex items-center gap-3 text-left flex-1 cursor-pointer"
            >
              <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <BellRing className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-sky-100">
                  近くに未発見の聖地があります！（タップでコンパス起動）
                </p>
                <p className="text-sm font-black">
                  {proximityToastSpot.displayTitle}（残り{' '}
                  {formatDistance(proximityToastSpot.distanceMeters)}）
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setProximityToastSpot(null)}
              className="text-xs text-sky-100 hover:text-white px-2 py-1 cursor-pointer"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* デスクトップナビ */}
      <div className="max-w-6xl mx-auto w-full px-4 pt-4 hidden sm:block">
        <nav className="inline-flex rounded-2xl bg-white p-1.5 border border-sky-100 shadow-xs gap-1">
          {(
            [
              { key: 'explore', label: '周辺・コンパス探索', icon: Compass },
              { key: 'map', label: '聖地マップ（レーダー/通常）', icon: MapIcon },
              { key: 'register', label: '聖地を追加・管理', icon: PlusCircle },
              { key: 'profile', label: 'マイアルバム・設定', icon: Award },
            ] as const
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`px-4 py-2 rounded-xl text-xs font-extrabold inline-flex items-center gap-2 transition cursor-pointer ${
                activeTab === key
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-sky-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* メイン領域 */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-5">
        {activeTab === 'explore' && (
          <div>
            {activeCompassSpot ? (
              <CompassView
                spot={activeCompassSpot}
                deviceHeadingDeg={deviceHeadingDeg}
                isDemoMode={isDemoMode && meta.enableDemoSimulator}
                isUnlocking={isUnlocking}
                needsCompassPermission={needsCompassPermission}
                errorMessage={unlockError}
                onBack={() => {
                  setSelectedCompassSpotId(null);
                  setUnlockError(null);
                }}
                onRequestCompassPermission={() =>
                  void handleRequestCompassPermission()
                }
                onDemoApproach={() => handleDemoApproach(activeCompassSpot.id)}
                onArriveUnlock={() =>
                  handleUnlockSpot(
                    activeCompassSpot.id,
                    activeCompassSpot.isUnlocked ? 'view_unlocked' : 'arrive',
                  )
                }
                onGiveUpUnlock={() =>
                  handleUnlockSpot(activeCompassSpot.id, 'give_up')
                }
              />
            ) : (
              <div className="space-y-5">
                <div className="bg-white rounded-3xl border border-sky-100 shadow-xs p-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                    <select
                      value={filterMember}
                      onChange={(e) => setFilterMember(e.target.value)}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white font-semibold"
                    >
                      <option value="">👤 全メンバー対象</option>
                      {HINATAZAKA_MEMBERS.map((m) => (
                        <option key={m.id} value={m.name}>
                          {m.name}（{m.generation}）
                        </option>
                      ))}
                    </select>

                    <select
                      value={filterCategory}
                      onChange={(e) =>
                        setFilterCategory(e.target.value as MediaCategory | '')
                      }
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white font-semibold"
                    >
                      <option value="">🎬 全媒体カテゴリ</option>
                      {Object.entries(MEDIA_CATEGORY_META).map(([key, info]) => (
                        <option key={key} value={key}>
                          {info.label}
                        </option>
                      ))}
                    </select>

                    <select
                      value={filterPrefecture}
                      onChange={(e) => setFilterPrefecture(e.target.value)}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white font-semibold"
                    >
                      <option value="">🗾 全国（現在地から近い順）</option>
                      {meta.prefectures.map((p) => (
                        <option key={p.prefecture} value={p.prefecture}>
                          {p.prefecture}（{p.totalSpots}件）
                        </option>
                      ))}
                    </select>

                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={tagQuery}
                        onChange={(e) => setTagQuery(e.target.value)}
                        placeholder="楽曲・企画タグ検索 (例: ひなあい)"
                        className="w-full rounded-xl border border-slate-200 pl-8 pr-3 py-2 text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1">
                    <span className="text-slate-500 font-semibold">
                      現在地から近い順に {displayedSpots.length} 件表示中（虫食い度:{' '}
                      <strong className="text-sky-700">{settings.maskLevel}</strong>）
                    </span>
                    <label className="inline-flex items-center gap-1.5 font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={onlyUnvisited}
                        onChange={(e) => setOnlyUnvisited(e.target.checked)}
                        className="rounded text-sky-600"
                      />
                      未発見の聖地のみ表示
                    </label>
                  </div>
                </div>

                {loadingSpots ? (
                  <div className="text-center py-12 text-sm text-slate-500">
                    周辺の聖地データを検索中...
                  </div>
                ) : displayedSpots.length === 0 ? (
                  <div className="bg-white rounded-3xl p-10 text-center text-sm text-slate-500 border border-slate-100">
                    条件に一致する聖地が見つかりませんでした。フィルタを緩めてお試しください。
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {displayedSpots.slice(0, 80).map((spot) => {
                      const isVisited = spot.visitStatus === 'visited';
                      const isGiveUp = spot.visitStatus === 'give_up';

                      return (
                        <div
                          key={spot.id}
                          className={`rounded-2xl border p-4 transition flex items-center justify-between gap-3 ${
                            isVisited
                              ? 'bg-sky-50/50 border-sky-200'
                              : 'bg-white border-slate-200 hover:border-sky-300 shadow-2xs'
                          }`}
                        >
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] font-bold text-slate-500">
                                {spot.prefecture}
                              </span>
                              {spot.episodeCount > 1 && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                                  {spot.episodeCount}シーン収録
                                </span>
                              )}
                              {isVisited && (
                                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-sky-600 text-white">
                                  {spot.selfDiscovered ? '🧭 自力達成' : '✓ 達成済'}
                                </span>
                              )}
                              {isGiveUp && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">
                                  ギブアップ閲覧済
                                </span>
                              )}
                            </div>

                            <h3 className="text-base font-extrabold text-slate-900 truncate">
                              {spot.displayTitle}
                            </h3>

                            <div className="flex flex-wrap gap-1">
                              {spot.visibleMediaCategories.map((cat) => (
                                <span
                                  key={cat}
                                  className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                                  style={{
                                    backgroundColor: MEDIA_CATEGORY_META[cat].color,
                                  }}
                                >
                                  #{MEDIA_CATEGORY_META[cat].shortLabel}
                                </span>
                              ))}
                              {spot.visibleMembers.slice(0, 3).map((m) => (
                                <span
                                  key={m}
                                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-800 border border-sky-200"
                                >
                                  #{m}
                                </span>
                              ))}
                              {spot.visibleMembers.length > 3 && (
                                <span className="text-[10px] text-slate-400 self-center">
                                  +{spot.visibleMembers.length - 3}名
                                </span>
                              )}
                              {spot.visibleHashtags.slice(0, 2).map((t) => (
                                <span
                                  key={t}
                                  className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600"
                                >
                                  #{t}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="text-right shrink-0 space-y-2">
                            <div className="text-lg font-black text-sky-700 tabular-nums">
                              {formatDistance(spot.distanceMeters)}
                            </div>
                            <div className="flex flex-col gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setUnlockError(null);
                                  setSelectedCompassSpotId(spot.id);
                                }}
                                className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-extrabold inline-flex items-center justify-center gap-1 cursor-pointer"
                              >
                                <Compass className="w-3.5 h-3.5" />
                                コンパス
                              </button>
                              {spot.isUnlocked && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUnlockSpot(spot.id, 'view_unlocked')
                                  }
                                  className="px-3 py-1 rounded-xl bg-white border border-sky-200 text-sky-700 text-[11px] font-bold hover:bg-sky-50 cursor-pointer"
                                >
                                  詳細を見る
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'map' && (
          <div className="space-y-4">
            <div className="bg-white rounded-3xl border border-sky-100 shadow-xs p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <Radar className="w-5 h-5 text-sky-600" />
                  聖地マップ（達成コレクション ＆ エリアレーダー）
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {settings.mapMode === 'treasure'
                    ? '宝探しモード：正確なピンは達成済みのみ表示し、未発見スポットは大まかな水色のぼかし円でエリアを示します。'
                    : '通常マップモード：遠征の下見や効率巡礼向けに、未発見スポット（オレンジ色の ? ピン）も正確な位置を表示しています。'}
                </p>
              </div>

              <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200 text-xs font-extrabold">
                <button
                  type="button"
                  onClick={() =>
                    handleUpdateSettings({ ...settings, mapMode: 'treasure' })
                  }
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                    settings.mapMode === 'treasure'
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  🧭 宝探しレーダー
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleUpdateSettings({ ...settings, mapMode: 'standard' })
                  }
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                    settings.mapMode === 'standard'
                      ? 'bg-amber-500 text-white shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  📍 通常マップ全表示
                </button>
              </div>
            </div>

            <SeichiMap
              centerLat={userLat}
              centerLng={userLng}
              spots={spots}
              mapMode={settings.mapMode}
              heightClassName="h-[520px]"
              onSelectSpot={(spot) => {
                if (spot.isUnlocked) {
                  handleUnlockSpot(spot.id, 'view_unlocked');
                } else {
                  setSelectedCompassSpotId(spot.id);
                  setActiveTab('explore');
                }
              }}
            />

            <div className="bg-white rounded-3xl border border-sky-100 p-4 space-y-2.5">
              <p className="text-xs font-extrabold text-slate-700">
                🗾 エリア別の収録聖地件数（タップでその都道府県のリストへ絞り込み）
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                {meta.prefectures.map((p) => (
                  <button
                    key={p.prefecture}
                    type="button"
                    onClick={() => {
                      setFilterPrefecture(p.prefecture);
                      setSelectedCompassSpotId(null);
                      setActiveTab('explore');
                    }}
                    className="px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 cursor-pointer"
                  >
                    {p.prefecture} ({p.totalSpots})
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'register' && (
          <RegisterSpotPanel
            currentUser={currentUser}
            initialLat={userLat}
            initialLng={userLng}
            onRequireAuth={() => setShowAuthModal(true)}
            onSpotCreated={() => {
              fetchMeta();
              fetchSpots();
            }}
          />
        )}

        {activeTab === 'profile' && (
          <ProfileSettingsPanel
            currentUser={currentUser}
            settings={settings}
            visitBook={visitBook}
            totalSpotsCount={meta.totalSpots}
            onUpdateSettings={handleUpdateSettings}
            onOpenVisitedSpot={(spotId) =>
              handleUnlockSpot(spotId, 'view_unlocked')
            }
            onOpenAuthModal={() => setShowAuthModal(true)}
            onSignOut={handleSignOut}
          />
        )}
      </main>

      {/* モバイルボトムナビ */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-sky-100 grid grid-cols-4 py-1.5 px-2">
        {(
          [
            { key: 'explore', label: '探索', icon: Compass },
            { key: 'map', label: 'マップ', icon: MapIcon },
            { key: 'register', label: '聖地登録', icon: PlusCircle },
            { key: 'profile', label: 'マイページ', icon: Award },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`flex flex-col items-center justify-center py-1 rounded-xl text-[11px] font-bold cursor-pointer ${
              activeTab === key ? 'text-sky-600' : 'text-slate-400'
            }`}
          >
            <Icon className="w-5 h-5 mb-0.5" />
            {label}
          </button>
        ))}
      </nav>

      {/* 解禁詳細モーダル（未訪問Adminの直接閲覧にも対応） */}
      {unlockedModalData && (
        <SpotDetailModal
          spot={unlockedModalData.spot}
          visitEntry={visitBook[unlockedModalData.spot.id]}
          currentUser={currentUser}
          initialComments={unlockedModalData.comments}
          onClose={() => setUnlockedModalData(null)}
          onVisitUpdated={(updated) =>
            setVisitBook((prev) => ({ ...prev, [updated.spotId]: updated }))
          }
          onSpotDeleted={() => {
            fetchMeta();
            fetchSpots();
          }}
        />
      )}

      {/* アカウント連携・ログインモーダル */}
      {showAuthModal && (
        <AuthModal
          currentUser={currentUser}
          oauthProviders={meta.oauthProviders}
          onClose={() => setShowAuthModal(false)}
          onAuthenticated={(user, visits) => {
            setCurrentUser(user);
            setSettings(user.settings);
            setVisitBook(visits);
          }}
        />
      )}
    </div>
  );
}
