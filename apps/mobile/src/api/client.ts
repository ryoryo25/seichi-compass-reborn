import type {
  ApiMetaResponse,
  AuthUser,
  CreateSpotInput,
  ExplorerSettings,
  MapMode,
  MaskLevel,
  MaskedSpotSummary,
  MediaCategory,
  PlaceSearchCandidate,
  ResolvedLocationResponse,
  Spot,
  SpotComment,
  SpotReport,
  SpotReportReason,
  TagVisibility,
  VisitRecord,
} from '@seichi/shared';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

export type {
  ApiMetaResponse,
  PlaceSearchCandidate,
  ResolvedLocationResponse,
};

const SESSION_TOKEN_KEY = 'seichi_bearer_token_v1';

function resolveDefaultApiBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
  if (envUrl) return envUrl;

  // Expo Go 実機接続時は Metro Bundler のホストIP (例: 192.168.x.x:8081) から API サーバー (:3000) を自動推定
  const debuggerHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (debuggerHost) {
    return `http://${debuggerHost}:3000/api`;
  }
  return 'http://localhost:3000/api';
}

export const API_BASE_URL = resolveDefaultApiBaseUrl();

let cachedToken: string | null = null;

export async function getStoredSessionToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    const token = await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
    cachedToken = token;
    return token;
  } catch {
    return null;
  }
}

export async function saveSessionToken(token: string | null): Promise<void> {
  cachedToken = token;
  try {
    if (token) {
      await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
    } else {
      await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
    }
  } catch {
    // Web / Simulator fallback
  }
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getStoredSessionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `APIエラー (${res.status})`);
  }
  return data;
}

export interface SessionResponse {
  user: AuthUser;
  sessionToken: string;
  visits: Record<string, VisitRecord>;
}

export const mobileApi = {
  fetchMeta: () => apiRequest<ApiMetaResponse>('/meta'),

  async initOrRestoreSession(): Promise<SessionResponse> {
    const data = await apiRequest<SessionResponse>('/auth/session', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await saveSessionToken(data.sessionToken);
    return data;
  },

  async signUpEmail(payload: {
    email: string;
    password: string;
    name: string;
  }): Promise<SessionResponse> {
    const data = await apiRequest<SessionResponse>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await saveSessionToken(data.sessionToken);
    return data;
  },

  async signInEmail(payload: {
    email: string;
    password: string;
  }): Promise<SessionResponse> {
    const data = await apiRequest<SessionResponse>('/auth/signin', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await saveSessionToken(data.sessionToken);
    return data;
  },

  async signOut(): Promise<void> {
    await apiRequest<{ ok: boolean }>('/auth/signout', {
      method: 'POST',
      body: JSON.stringify({}),
    }).catch(() => {});
    await saveSessionToken(null);
  },

  updateSettings: (settings: ExplorerSettings) =>
    apiRequest<{ user: AuthUser }>('/me/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  searchSpots: (params: {
    lat: number;
    lng: number;
    member?: string;
    members?: string[];
    notificationMembers?: string[];
    mediaCategory?: MediaCategory;
    prefecture?: string;
    tagQuery?: string;
    limit?: number;
    maskLevel?: MaskLevel;
    tagVisibility?: TagVisibility;
    mapMode?: MapMode;
  }) =>
    apiRequest<{ spots: MaskedSpotSummary[] }>('/spots/search', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  fetchSpotSummary: (
    spotId: string,
    params: {
      lat: number;
      lng: number;
      maskLevel?: MaskLevel;
      tagVisibility?: TagVisibility;
      mapMode?: MapMode;
    },
  ) => {
    const qs = new URLSearchParams({
      lat: String(params.lat),
      lng: String(params.lng),
      ...(params.maskLevel ? { maskLevel: params.maskLevel } : {}),
      ...(params.tagVisibility ? { tagVisibility: params.tagVisibility } : {}),
      ...(params.mapMode ? { mapMode: params.mapMode } : {}),
    });
    return apiRequest<{ spot: MaskedSpotSummary }>(
      `/spots/${encodeURIComponent(spotId)}/summary?${qs.toString()}`,
    );
  },

  fetchBearing: (spotId: string, lat: number, lng: number) =>
    apiRequest<{
      distanceMeters: number;
      bearingDeg: number;
      arrivalRadiusMeters: number;
    }>(`/spots/${encodeURIComponent(spotId)}/bearing?lat=${lat}&lng=${lng}`),

  simulateDemoApproach: (spotId: string) =>
    apiRequest<{ lat: number; lng: number }>(
      `/demo/approach/${encodeURIComponent(spotId)}`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
    ),

  unlockSpot: (
    spotId: string,
    payload: {
      userLat: number;
      userLng: number;
      mode: 'arrive' | 'give_up' | 'view_unlocked';
      mapMode: MapMode;
    },
  ) =>
    apiRequest<{
      spot: Spot;
      visit?: VisitRecord;
      comments: SpotComment[];
      distanceMeters: number;
    }>(`/spots/${encodeURIComponent(spotId)}/unlock`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  saveVisitMemo: (spotId: string, privateMemo: string) =>
    apiRequest<{ visit: VisitRecord }>(
      `/me/visits/${encodeURIComponent(spotId)}/memo`,
      {
        method: 'PUT',
        body: JSON.stringify({ privateMemo }),
      },
    ),

  uploadVisitPhoto: (spotId: string, dataUrl: string) =>
    apiRequest<{ visit: VisitRecord }>(
      `/me/visits/${encodeURIComponent(spotId)}/photo`,
      {
        method: 'PUT',
        body: JSON.stringify({ dataUrl }),
      },
    ),

  async getPrivatePhotoImageSource(spotId: string, cacheBust?: string) {
    const token = await getStoredSessionToken();
    const qs = cacheBust ? `?v=${encodeURIComponent(cacheBust)}` : '';
    return {
      uri: `${API_BASE_URL}/me/visits/${encodeURIComponent(spotId)}/photo${qs}`,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    };
  },

  addComment: (
    spotId: string,
    payload: { authorName: string; content: string; isPublic: boolean },
  ) =>
    apiRequest<{ comment: SpotComment }>(
      `/spots/${encodeURIComponent(spotId)}/comments`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),

  reportSpot: (
    spotId: string,
    payload: { reason: SpotReportReason; detail?: string },
  ) =>
    apiRequest<{ report: SpotReport }>(
      `/spots/${encodeURIComponent(spotId)}/reports`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),

  resolveLocation: (input: string) =>
    apiRequest<ResolvedLocationResponse>('/locations/resolve', {
      method: 'POST',
      body: JSON.stringify({ input }),
    }),

  searchPlaces: (query: string) =>
    apiRequest<{ candidates: PlaceSearchCandidate[] }>(
      `/locations/search?q=${encodeURIComponent(query)}`,
    ),

  checkDuplicates: (lat: number, lng: number) =>
    apiRequest<{
      duplicates: Array<{
        id: string;
        title: string;
        distanceMeters: number;
        episodeCount: number;
        mediaCategories: MediaCategory[];
      }>;
    }>(`/spots/duplicates?lat=${lat}&lng=${lng}`),

  createOrAppendSpot: (input: CreateSpotInput) =>
    apiRequest<{ spot: Spot }>('/spots', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
