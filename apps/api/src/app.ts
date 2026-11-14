import { zValidator } from '@hono/zod-validator';
import {
  createBetterAuth,
  type R2LikeBucket,
  resolveAlbumStorage,
  resolveRepository,
} from '@seichi/db';
import {
  type AuthUser,
  calculateBearingDeg,
  CreateSpotInputSchema,
  ExplorerSettingsSchema,
  filterSpotTagsForVisibility,
  getBlurredRadarPoint,
  haversineDistanceMeters,
  HINATAZAKA_MEMBERS,
  MapModeSchema,
  type MapMode,
  MaskLevelSchema,
  type MaskLevel,
  maskSpotTitle,
  type MaskedSpotSummary,
  type MediaCategory,
  MediaCategorySchema,
  parseCsvToCandidates,
  parseGoogleMapsUrl,
  parseKmlToCandidates,
  type Spot,
  SpotReportReasonSchema,
  TagVisibilitySchema,
  type TagVisibility,
  UpdateSpotInputSchema,
  type VisitRecord,
} from '@seichi/shared';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { resolveLocationInput, searchPlacesByQuery } from './geocoder.ts';

export interface ApiBindings {
  DATABASE_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
  ALLOWED_ORIGINS?: string;
  GOOGLE_MAPS_API_KEY?: string;
  TWITTER_CLIENT_ID?: string;
  TWITTER_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_CLIENT_SECRET?: string;
  ALLOW_DEV_ROLE_SWITCH?: string;
  ENABLE_DEMO_SIMULATOR?: string;
  ALBUM_BUCKET?: R2LikeBucket;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
}

const SESSION_COOKIE_NAME = 'seichi_session';
const OAUTH_GUEST_COOKIE_NAME = 'seichi_oauth_guest';
const BETTER_AUTH_COOKIE_NAME = 'better-auth.session_token';
const SAFE_SPOT_ID_REGEX = /^[a-zA-Z0-9_-]{1,80}$/;

// スライディングウィンドウ方式のインメモリレートリミッタ（DoS / Denial of Wallet 対策）
const rateLimitWindows = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(
  bucket: string,
  clientKey: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  if (rateLimitWindows.size > 5000) {
    for (const [k, v] of rateLimitWindows.entries()) {
      if (v.resetAt <= now) rateLimitWindows.delete(k);
    }
  }
  const key = `${bucket}:${clientKey}`;
  const existing = rateLimitWindows.get(key);
  if (!existing || existing.resetAt <= now) {
    rateLimitWindows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= maxRequests) {
    return false;
  }
  existing.count += 1;
  return true;
}

function getClientIp(c: Context<{ Bindings: ApiBindings }>): string {
  const cfIp = c.req.header('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return 'local';
}

function getEnvValue<K extends keyof ApiBindings>(
  cEnv: ApiBindings | undefined,
  key: K,
): ApiBindings[K] {
  if (cEnv && cEnv[key] !== undefined) return cEnv[key];
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key as string] as ApiBindings[K];
  }
  return undefined;
}

/**
 * 開発用機能フラグ判定（フェイルクローズ設計）
 * - NODE_ENV === 'production' の本番環境では環境変数ミスによる権限昇格を防ぐため ALLOW_DEV_ROLE_SWITCH を強制無効化。
 * - 明示的に "true" が指定された場合、または未設定かつローカル `NODE_ENV === 'development'` の場合のみ有効。
 */
function isDevFeatureEnabled(
  cEnv: ApiBindings | undefined,
  key: 'ALLOW_DEV_ROLE_SWITCH' | 'ENABLE_DEMO_SIMULATOR',
): boolean {
  const isProdNodeEnv =
    typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
  if (isProdNodeEnv && key === 'ALLOW_DEV_ROLE_SWITCH') {
    return false;
  }
  const raw = getEnvValue(cEnv, key);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return (
    typeof process !== 'undefined' && process.env?.NODE_ENV === 'development'
  );
}

function isSecureRequest(c: Context<{ Bindings: ApiBindings }>): boolean {
  if (c.req.url.startsWith('https://')) return true;
  if (c.req.header('x-forwarded-proto') === 'https') return true;
  return false;
}

function sessionCookieOptions(c: Context<{ Bindings: ApiBindings }>) {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: isSecureRequest(c),
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
  };
}

function resolveAllowedCorsOrigin(
  requestOrigin: string,
  cEnv: ApiBindings | undefined,
): string | null {
  if (!requestOrigin) return null;
  const allowlist = new Set<string>();
  const addUrlOrigin = (raw?: string) => {
    if (!raw) return;
    for (const part of raw.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      try {
        allowlist.add(new URL(trimmed).origin);
      } catch {
        // ignore invalid URL
      }
    }
  };

  addUrlOrigin(getEnvValue(cEnv, 'BETTER_AUTH_URL'));
  addUrlOrigin(getEnvValue(cEnv, 'NEXT_PUBLIC_APP_URL'));
  addUrlOrigin(getEnvValue(cEnv, 'ALLOWED_ORIGINS'));

  const isProd =
    typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
  if (!isProd) {
    allowlist.add('http://localhost:3000');
    allowlist.add('http://127.0.0.1:3000');
    allowlist.add('http://localhost:8081');
    allowlist.add('http://127.0.0.1:8081');
    allowlist.add('http://localhost:8787');
    if (
      /^http:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(
        requestOrigin,
      )
    ) {
      return requestOrigin;
    }
  }

  return allowlist.has(requestOrigin) ? requestOrigin : null;
}

function extractRequestToken(
  authHeader: string | undefined,
  cookieToken: string | undefined,
): string | undefined {
  if (authHeader?.startsWith('Bearer ')) {
    const bearer = authHeader.slice('Bearer '.length).trim();
    if (bearer) return bearer;
  }
  if (cookieToken) return cookieToken;
  return undefined;
}

function hasValidImageMagicBytes(bytes: Uint8Array, mime: string): boolean {
  if (bytes.byteLength < 12) return false;
  if (mime === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === 'image/png') {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (mime === 'image/webp') {
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return false;
}

function decodeDataUrlToBytes(dataUrl: string): {
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
} {
  // SVG (image/svg+xml) 等のスクリプト実行可能な形式を厳格に拒否し、JPEG / PNG / WebP のみ許可
  const match = dataUrl.match(
    /^data:(image\/(?:jpeg|jpg|png|webp));base64,([\s\S]+)$/,
  );
  if (!match) {
    throw new Error(
      '対応していない画像形式です（JPEG / PNG / WebP のみアップロード可能です）',
    );
  }
  const rawMime = match[1]!;
  const mime: 'image/jpeg' | 'image/png' | 'image/webp' =
    rawMime === 'image/jpg' ? 'image/jpeg' : (rawMime as 'image/jpeg' | 'image/png' | 'image/webp');
  const b64 = match[2]!;
  const binaryStr = atob(b64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  if (bytes.byteLength > 5 * 1024 * 1024) {
    throw new Error('画像サイズは5MB以下にしてください');
  }
  if (!hasValidImageMagicBytes(bytes, mime)) {
    throw new Error('画像ファイルのシグネチャ（マジックバイト）が不正です');
  }
  return { bytes, mime };
}

const SearchRequestSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  member: z.string().optional(),
  members: z.array(z.string()).optional(),
  notificationMembers: z.array(z.string()).optional(),
  mediaCategory: MediaCategorySchema.optional(),
  prefecture: z.string().optional(),
  tagQuery: z.string().optional(),
  limit: z.number().int().min(1).max(1500).default(250),
  maskLevel: MaskLevelSchema.default('normal'),
  tagVisibility: TagVisibilitySchema.default('all'),
  mapMode: MapModeSchema.default('treasure'),
});

function buildMaskedSpotSummary(params: {
  spot: Spot;
  distanceMeters: number;
  userLat: number;
  userLng: number;
  visitRecord?: VisitRecord;
  maskLevel: MaskLevel;
  tagVisibility: TagVisibility;
  mapMode: MapMode;
  notificationMembers?: string[];
}): MaskedSpotSummary {
  const { spot, distanceMeters, userLat, userLng, visitRecord } = params;
  const isUnlocked = Boolean(visitRecord);
  const visitStatus = visitRecord?.status ?? 'unvisited';

  const allMedia = Array.from(
    new Set(spot.episodes.map((ep) => ep.mediaCategory)),
  ) as MediaCategory[];
  const allMembers = Array.from(
    new Set(spot.episodes.flatMap((ep) => ep.members)),
  );
  const allHashtags = Array.from(
    new Set(spot.episodes.flatMap((ep) => ep.hashtags)),
  );

  const visibleTags = isUnlocked
    ? {
        visibleMediaCategories: allMedia,
        visibleMembers: allMembers,
        visibleHashtags: allHashtags,
      }
    : filterSpotTagsForVisibility(
        {
          mediaCategories: allMedia,
          members: allMembers,
          hashtags: allHashtags,
        },
        params.tagVisibility,
      );

  const notifyFilter = params.notificationMembers ?? [];
  const matchesNotificationMembers =
    notifyFilter.length === 0 ||
    allMembers.some((m) => notifyFilter.includes(m));

  const { radarLat, radarLng } = getBlurredRadarPoint(
    spot.id,
    spot.lat,
    spot.lng,
  );
  const exposeExactCoords = isUnlocked || params.mapMode === 'standard';

  return {
    id: spot.id,
    displayTitle: isUnlocked
      ? spot.title
      : maskSpotTitle(spot.id, spot.title, params.maskLevel),
    isUnlocked,
    visitStatus,
    selfDiscovered: visitRecord?.selfDiscovered ?? false,
    distanceMeters,
    bearingDeg: calculateBearingDeg(userLat, userLng, spot.lat, spot.lng),
    arrivalRadiusMeters: spot.arrivalRadiusMeters,
    prefecture: spot.prefecture,
    episodeCount: spot.episodes.length,
    ...visibleTags,
    matchesNotificationMembers,
    radarLat,
    radarLng,
    exactLat: exposeExactCoords ? spot.lat : undefined,
    exactLng: exposeExactCoords ? spot.lng : undefined,
  };
}

const UnlockRequestSchema = z.object({
  userLat: z.number().min(-90).max(90),
  userLng: z.number().min(-180).max(180),
  mode: z.enum(['arrive', 'give_up', 'view_unlocked']),
  mapMode: MapModeSchema.default('treasure'),
});

export function createApiApp() {
  const app = new Hono<{ Bindings: ApiBindings }>().basePath('/api');

  app.use(
    '*',
    cors({
      origin: (origin, c) => resolveAllowedCorsOrigin(origin, c.env),
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  // CSRF 防御ミドルウェア（Cookie 認証での状態変更リクエストに対する Origin / Sec-Fetch-Site 検証）
  app.use('*', async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (
      method === 'POST' ||
      method === 'PUT' ||
      method === 'PATCH' ||
      method === 'DELETE'
    ) {
      const hasBearer = c.req.header('Authorization')?.startsWith('Bearer ');
      if (!hasBearer) {
        const secFetchSite = c.req.header('Sec-Fetch-Site');
        if (secFetchSite === 'cross-site') {
          return c.json(
            { error: 'Cross-site state-changing request forbidden (CSRF)' },
            403,
          );
        }
        const origin = c.req.header('Origin');
        if (origin) {
          let reqOrigin = '';
          try {
            reqOrigin = new URL(c.req.url).origin;
          } catch {
            // ignore
          }
          if (
            origin !== reqOrigin &&
            resolveAllowedCorsOrigin(origin, c.env) === null
          ) {
            return c.json(
              { error: 'Invalid Origin header for state-changing request (CSRF)' },
              403,
            );
          }
        }
      }
    }
    return next();
  });

  const getRepo = (env?: ApiBindings) =>
    resolveRepository(getEnvValue(env, 'DATABASE_URL'));
  const getAlbum = (env?: ApiBindings) =>
    resolveAlbumStorage(getEnvValue(env, 'ALBUM_BUCKET'), {
      accountId: getEnvValue(env, 'R2_ACCOUNT_ID'),
      accessKeyId: getEnvValue(env, 'R2_ACCESS_KEY_ID'),
      secretAccessKey: getEnvValue(env, 'R2_SECRET_ACCESS_KEY'),
      bucketName: getEnvValue(env, 'R2_BUCKET_NAME'),
    });

  const resolveCurrentUser = async (
    c: Context<{ Bindings: ApiBindings }>,
  ): Promise<{ user: AuthUser; token: string } | null> => {
    const token = extractRequestToken(
      c.req.header('Authorization'),
      getCookie(c, SESSION_COOKIE_NAME),
    );
    if (!token) return null;
    const user = await getRepo(c.env).getUserBySessionToken(token);
    if (!user) return null;
    return { user, token };
  };

  const buildBetterAuthFromEnv = (env?: ApiBindings) => {
    const dbUrl = getEnvValue(env, 'DATABASE_URL');
    const secret = getEnvValue(env, 'BETTER_AUTH_SECRET');
    if (!dbUrl || !secret) return null;
    return createBetterAuth({
      DATABASE_URL: dbUrl,
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: getEnvValue(env, 'BETTER_AUTH_URL'),
      TWITTER_CLIENT_ID: getEnvValue(env, 'TWITTER_CLIENT_ID'),
      TWITTER_CLIENT_SECRET: getEnvValue(env, 'TWITTER_CLIENT_SECRET'),
      GOOGLE_CLIENT_ID: getEnvValue(env, 'GOOGLE_CLIENT_ID'),
      GOOGLE_CLIENT_SECRET: getEnvValue(env, 'GOOGLE_CLIENT_SECRET'),
      APPLE_CLIENT_ID: getEnvValue(env, 'APPLE_CLIENT_ID'),
      APPLE_CLIENT_SECRET: getEnvValue(env, 'APPLE_CLIENT_SECRET'),
    });
  };

  return (
    app
      // 1. 全体メタ情報
      .get('/meta', async (c) => {
        const repo = getRepo(c.env);
        const summary = await repo.getMetaSummary();
        const dbUrl = getEnvValue(c.env, 'DATABASE_URL');
        return c.json({
          ...summary,
          members: HINATAZAKA_MEMBERS,
          storageMode: dbUrl ? 'neon_postgis' : 'local_persistence',
          oauthProviders: {
            twitter: Boolean(getEnvValue(c.env, 'TWITTER_CLIENT_ID')),
            google: Boolean(getEnvValue(c.env, 'GOOGLE_CLIENT_ID')),
            apple: Boolean(getEnvValue(c.env, 'APPLE_CLIENT_ID')),
          },
          allowDevRoleSwitch: isDevFeatureEnabled(c.env, 'ALLOW_DEV_ROLE_SWITCH'),
          enableDemoSimulator: isDevFeatureEnabled(c.env, 'ENABLE_DEMO_SIMULATOR'),
        });
      })

      // 2. 認証・ゲストセッション初期化・アカウント連携引き継ぎ
      .post('/auth/session', async (c) => {
        if (!checkRateLimit('auth_session', getClientIp(c), 40, 60_000)) {
          return c.json({ error: 'リクエストが多すぎます。しばらく待ってから再試行してください' }, 429);
        }
        const repo = getRepo(c.env);
        const currentToken = extractRequestToken(
          c.req.header('Authorization'),
          getCookie(c, SESSION_COOKIE_NAME),
        );
        const { user, sessionToken } =
          await repo.getOrCreateAnonymousUser(currentToken);

        setCookie(c, SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions(c));

        const visits = await repo.getUserVisits(user.id);
        return c.json({ user, sessionToken, visits });
      })

      .post(
        '/auth/signup',
        zValidator(
          'json',
          z.object({
            email: z.string().email().max(254),
            password: z.string().min(8).max(100),
            name: z.string().min(1).max(30),
          }),
        ),
        async (c) => {
          if (!checkRateLimit('auth_write', getClientIp(c), 15, 60_000)) {
            return c.json({ error: 'リクエストが多すぎます。しばらく待ってから再試行してください' }, 429);
          }
          const repo = getRepo(c.env);
          const currentToken = extractRequestToken(
            c.req.header('Authorization'),
            getCookie(c, SESSION_COOKIE_NAME),
          );
          const body = c.req.valid('json');
          try {
            const { user, sessionToken } = await repo.signUpOrLinkEmail({
              currentSessionToken: currentToken,
              ...body,
            });
            setCookie(c, SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions(c));
            const visits = await repo.getUserVisits(user.id);
            return c.json({ user, sessionToken, visits });
          } catch (err) {
            return c.json(
              { error: err instanceof Error ? err.message : '登録に失敗しました' },
              400,
            );
          }
        },
      )

      .post(
        '/auth/signin',
        zValidator(
          'json',
          z.object({
            email: z.string().email().max(254),
            password: z.string().min(1).max(100),
          }),
        ),
        async (c) => {
          if (!checkRateLimit('auth_write', getClientIp(c), 15, 60_000)) {
            return c.json({ error: 'リクエストが多すぎます。しばらく待ってから再試行してください' }, 429);
          }
          const repo = getRepo(c.env);
          const currentToken = extractRequestToken(
            c.req.header('Authorization'),
            getCookie(c, SESSION_COOKIE_NAME),
          );
          const body = c.req.valid('json');
          try {
            const { user, sessionToken, r2KeysToDelete } =
              await repo.signInWithEmail({
                currentSessionToken: currentToken,
                ...body,
              });
            if (r2KeysToDelete && r2KeysToDelete.length > 0) {
              const album = getAlbum(c.env);
              for (const key of r2KeysToDelete) {
                await album.deletePhoto(key).catch(() => {});
              }
            }
            setCookie(c, SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions(c));
            const visits = await repo.getUserVisits(user.id);
            return c.json({ user, sessionToken, visits });
          } catch (err) {
            return c.json(
              { error: err instanceof Error ? err.message : 'ログインに失敗しました' },
              401,
            );
          }
        },
      )

      .post('/auth/signout', async (c) => {
        const repo = getRepo(c.env);
        const token = extractRequestToken(
          c.req.header('Authorization'),
          getCookie(c, SESSION_COOKIE_NAME),
        );
        if (token) await repo.signOutSession(token);
        deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
        deleteCookie(c, BETTER_AUTH_COOKIE_NAME, { path: '/' });
        return c.json({ ok: true });
      })

      // OAuth ソーシャルログイン開始（現在のゲストトークンを一時保管してから Better Auth 認可URLへリダイレクト）
      .get('/auth/oauth-start/:provider', async (c) => {
        if (c.req.header('Sec-Fetch-Site') === 'cross-site') {
          return c.json({ error: 'Cross-site OAuth initiation forbidden' }, 403);
        }
        const provider = c.req.param('provider');
        if (provider !== 'twitter' && provider !== 'google' && provider !== 'apple') {
          return c.json({ error: 'Unsupported OAuth provider' }, 400);
        }
        const auth = buildBetterAuthFromEnv(c.env);
        if (!auth) {
          return c.json(
            {
              error:
                'OAuthプロバイダを使用するには DATABASE_URL と BETTER_AUTH_SECRET の設定が必要です',
            },
            501,
          );
        }

        const currentGuestToken = getCookie(c, SESSION_COOKIE_NAME);
        if (currentGuestToken) {
          setCookie(c, OAUTH_GUEST_COOKIE_NAME, currentGuestToken, {
            httpOnly: true,
            sameSite: 'Lax',
            secure: isSecureRequest(c),
            path: '/',
            maxAge: 60 * 10,
          });
        }

        const socialRes = await auth.api.signInSocial({
          body: {
            provider,
            callbackURL: '/api/auth/oauth-bridge',
          },
          headers: c.req.raw.headers,
          asResponse: true,
        });

        // Better Auth の state Cookie 等を維持したまま認可画面へ 302 リダイレクト
        const bodyData = (await socialRes
          .clone()
          .json()
          .catch(() => null)) as { url?: string } | null;
        if (bodyData?.url) {
          const headers = new Headers(socialRes.headers);
          headers.set('Location', bodyData.url);
          return new Response(null, { status: 302, headers });
        }
        return socialRes;
      })

      // OAuth コールバック完了ブリッジ（ゲスト記録・R2写真を自動マージして seichi_session を発行）
      .get('/auth/oauth-bridge', async (c) => {
        const auth = buildBetterAuthFromEnv(c.env);
        if (!auth) return c.redirect('/');

        const baSession = await auth.api.getSession({
          headers: c.req.raw.headers,
        });
        if (!baSession?.user?.id) {
          return c.redirect('/');
        }

        const repo = getRepo(c.env);
        const album = getAlbum(c.env);
        const guestToken = getCookie(c, OAUTH_GUEST_COOKIE_NAME);
        if (guestToken) {
          const guestUser = await repo.getUserBySessionToken(guestToken);
          if (guestUser?.isAnonymous && guestUser.id !== baSession.user.id) {
            const { r2KeysToDelete } = await repo.mergeAnonymousUserData(
              guestUser.id,
              baSession.user.id,
            );
            for (const key of r2KeysToDelete) {
              await album.deletePhoto(key).catch(() => {});
            }
          }
          deleteCookie(c, OAUTH_GUEST_COOKIE_NAME, { path: '/' });
        }

        const issued = await repo.issueSessionForUser(baSession.user.id);
        if (issued) {
          setCookie(
            c,
            SESSION_COOKIE_NAME,
            issued.sessionToken,
            sessionCookieOptions(c),
          );
        }
        return c.redirect('/');
      })

      // Better Auth OAuth エンドポイント（コールバック等）
      .all('/auth/oauth/*', async (c) => {
        const auth = buildBetterAuthFromEnv(c.env);
        if (!auth) {
          return c.json(
            {
              error:
                'OAuthプロバイダを使用するには DATABASE_URL と BETTER_AUTH_SECRET の設定が必要です',
            },
            501,
          );
        }
        return auth.handler(c.req.raw);
      })

      // 3. ユーザー設定・開発ロール切替・公開実績プロフィール
      .put('/me/settings', zValidator('json', ExplorerSettingsSchema), async (c) => {
        const auth = await resolveCurrentUser(c);
        if (!auth) return c.json({ error: 'Unauthorized' }, 401);
        const updated = await getRepo(c.env).updateUserSettings(
          auth.user.id,
          c.req.valid('json'),
        );
        return c.json({ user: updated });
      })

      .post(
        '/me/dev-role',
        zValidator('json', z.object({ role: z.enum(['user', 'admin']) })),
        async (c) => {
          if (!isDevFeatureEnabled(c.env, 'ALLOW_DEV_ROLE_SWITCH')) {
            return c.json({ error: '本番環境では無効化されています' }, 403);
          }
          const auth = await resolveCurrentUser(c);
          if (!auth) return c.json({ error: 'Unauthorized' }, 401);
          const updated = await getRepo(c.env).setUserRoleForDev(
            auth.user.id,
            c.req.valid('json').role,
          );
          return c.json({ user: updated });
        },
      )

      .get('/users/:id/achievements', async (c) => {
        const stats = await getRepo(c.env).getPublicUserAchievements(
          c.req.param('id'),
        );
        if (!stats) {
          return c.json({ error: 'このユーザーの実績は非公開、または存在しません' }, 404);
        }
        return c.json({ achievements: stats });
      })

      // 4. 聖地検索・単体サマリ取得・Xシェア用非ネタバレプレビュー・コンパス方位・到着判定
      .post('/spots/search', zValidator('json', SearchRequestSchema), async (c) => {
        const repo = getRepo(c.env);
        const auth = await resolveCurrentUser(c);
        const userVisits = auth ? await repo.getUserVisits(auth.user.id) : {};
        const body = c.req.valid('json');

        const results = await repo.querySpots({
          lat: body.lat,
          lng: body.lng,
          member: body.member || undefined,
          members: body.members?.length ? body.members : undefined,
          mediaCategory: body.mediaCategory,
          prefecture: body.prefecture || undefined,
          tagQuery: body.tagQuery || undefined,
          limit: body.limit,
        });

        const summaries: MaskedSpotSummary[] = results.map(
          ({ spot, distanceMeters }) =>
            buildMaskedSpotSummary({
              spot,
              distanceMeters,
              userLat: body.lat,
              userLng: body.lng,
              visitRecord: userVisits[spot.id],
              maskLevel: body.maskLevel,
              tagVisibility: body.tagVisibility,
              mapMode: body.mapMode,
              notificationMembers: body.notificationMembers,
            }),
        );

        return c.json({ spots: summaries });
      })

      .get('/spots/:id/summary', async (c) => {
        const lat = Number(c.req.query('lat'));
        const lng = Number(c.req.query('lng'));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return c.json({ error: 'Invalid coordinates' }, 400);
        }

        const repo = getRepo(c.env);
        const spot = await repo.getSpotById(c.req.param('id'));
        if (!spot) return c.json({ error: 'Spot not found' }, 404);

        const auth = await resolveCurrentUser(c);
        const userVisits = auth ? await repo.getUserVisits(auth.user.id) : {};

        const maskLevelParsed = MaskLevelSchema.safeParse(
          c.req.query('maskLevel'),
        );
        const tagVisibilityParsed = TagVisibilitySchema.safeParse(
          c.req.query('tagVisibility'),
        );
        const mapModeParsed = MapModeSchema.safeParse(c.req.query('mapMode'));

        const distanceMeters = haversineDistanceMeters(
          lat,
          lng,
          spot.lat,
          spot.lng,
        );

        return c.json({
          spot: buildMaskedSpotSummary({
            spot,
            distanceMeters,
            userLat: lat,
            userLng: lng,
            visitRecord: userVisits[spot.id],
            maskLevel: maskLevelParsed.success
              ? maskLevelParsed.data
              : 'normal',
            tagVisibility: tagVisibilityParsed.success
              ? tagVisibilityParsed.data
              : 'all',
            mapMode: mapModeParsed.success ? mapModeParsed.data : 'treasure',
          }),
        });
      })

      .get('/spots/:id/share-preview', async (c) => {
        const spot = await getRepo(c.env).getSpotById(c.req.param('id'));
        if (!spot) return c.json({ error: 'Spot not found' }, 404);

        const mediaCategories = Array.from(
          new Set(spot.episodes.map((e) => e.mediaCategory)),
        );
        const members = Array.from(
          new Set(spot.episodes.flatMap((e) => e.members)),
        ).slice(0, 6);
        const hashtags = Array.from(
          new Set(spot.episodes.flatMap((e) => e.hashtags)),
        ).slice(0, 5);

        return c.json({
          id: spot.id,
          maskedTitle: maskSpotTitle(spot.id, spot.title, 'normal'),
          prefecture: spot.prefecture,
          episodeCount: spot.episodes.length,
          arrivalRadiusMeters: spot.arrivalRadiusMeters,
          mediaCategories,
          members,
          hashtags,
        });
      })

      .get('/spots/:id/bearing', async (c) => {
        if (!checkRateLimit('bearing', getClientIp(c), 180, 60_000)) {
          return c.json({ error: 'リクエストが多すぎます' }, 429);
        }
        const lat = Number(c.req.query('lat'));
        const lng = Number(c.req.query('lng'));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return c.json({ error: 'Invalid coordinates' }, 400);
        }
        const spot = await getRepo(c.env).getSpotById(c.req.param('id'));
        if (!spot) return c.json({ error: 'Spot not found' }, 404);
        return c.json({
          distanceMeters: haversineDistanceMeters(lat, lng, spot.lat, spot.lng),
          bearingDeg:
            Math.round(calculateBearingDeg(lat, lng, spot.lat, spot.lng)) % 360,
          arrivalRadiusMeters: spot.arrivalRadiusMeters,
        });
      })

      .post('/demo/approach/:id', async (c) => {
        if (!isDevFeatureEnabled(c.env, 'ENABLE_DEMO_SIMULATOR')) {
          return c.json({ error: 'Demo simulator is disabled' }, 403);
        }
        const spot = await getRepo(c.env).getSpotById(c.req.param('id'));
        if (!spot) return c.json({ error: 'Spot not found' }, 404);
        return c.json({
          lat: Number((spot.lat - 0.00025).toFixed(6)),
          lng: Number((spot.lng - 0.00025).toFixed(6)),
        });
      })

      .post(
        '/spots/:id/unlock',
        zValidator('json', UnlockRequestSchema),
        async (c) => {
          if (!checkRateLimit('unlock', getClientIp(c), 60, 60_000)) {
            return c.json({ error: 'リクエストが多すぎます' }, 429);
          }
          const repo = getRepo(c.env);
          const currentToken = extractRequestToken(
            c.req.header('Authorization'),
            getCookie(c, SESSION_COOKIE_NAME),
          );
          const { user, sessionToken } =
            await repo.getOrCreateAnonymousUser(currentToken);
          setCookie(
            c,
            SESSION_COOKIE_NAME,
            sessionToken,
            sessionCookieOptions(c),
          );

          const spotId = c.req.param('id');
          const body = c.req.valid('json');
          const spot = await repo.getSpotById(spotId);
          if (!spot) {
            return c.json({ error: '聖地が見つかりませんでした' }, 404);
          }

          const distanceMeters = haversineDistanceMeters(
            body.userLat,
            body.userLng,
            spot.lat,
            spot.lng,
          );

          const existingVisits = await repo.getUserVisits(user.id);
          const existingVisit = existingVisits[spotId];

          if (body.mode === 'view_unlocked') {
            if (!existingVisit && user.role !== 'admin') {
              return c.json({ error: 'この聖地はまだ解禁されていません' }, 403);
            }
          } else if (body.mode === 'arrive') {
            if (distanceMeters > spot.arrivalRadiusMeters) {
              const remaining = Math.max(
                1,
                distanceMeters - spot.arrivalRadiusMeters,
              );
              return c.json(
                {
                  error: `まだ聖地に到着していません（到着判定まであと約 ${remaining}m 近づいてください）`,
                  distanceMeters,
                },
                400,
              );
            }
          }

          let visit = existingVisit;
          if (body.mode === 'arrive') {
            visit = await repo.recordVisit({
              userId: user.id,
              spotId,
              status: 'visited',
              selfDiscovered:
                body.mapMode === 'treasure' &&
                user.settings.mapMode === 'treasure',
            });
          } else if (body.mode === 'give_up') {
            visit = await repo.recordVisit({
              userId: user.id,
              spotId,
              status: 'give_up',
              selfDiscovered: false,
            });
          }

          const comments = await repo.getPublicCommentsForSpot(spotId, user.id);
          return c.json({
            spot,
            visit,
            comments,
            distanceMeters,
          });
        },
      )

      // 5. 自分専用の巡礼アルバム（Cloudflare R2 非公開バケット ＋ オーナー厳格認可）
      .get('/me/visits', async (c) => {
        const auth = await resolveCurrentUser(c);
        if (!auth) return c.json({ visits: {} });
        const visits = await getRepo(c.env).getUserVisits(auth.user.id);
        return c.json({ visits });
      })

      .put(
        '/me/visits/:spotId/memo',
        zValidator('json', z.object({ privateMemo: z.string().max(1000) })),
        async (c) => {
          const auth = await resolveCurrentUser(c);
          if (!auth) return c.json({ error: 'Unauthorized' }, 401);
          const spotId = c.req.param('spotId');
          if (!SAFE_SPOT_ID_REGEX.test(spotId)) {
            return c.json({ error: 'Invalid spotId' }, 400);
          }
          const updated = await getRepo(c.env).updateVisitAlbum({
            userId: auth.user.id,
            spotId,
            privateMemo: c.req.valid('json').privateMemo,
          });
          if (!updated) return c.json({ error: '訪問記録が見つかりません' }, 404);
          return c.json({ visit: updated });
        },
      )

      .put(
        '/me/visits/:spotId/photo',
        zValidator('json', z.object({ dataUrl: z.string().min(20).max(8_000_000) })),
        async (c) => {
          if (!checkRateLimit('photo_upload', getClientIp(c), 20, 60_000)) {
            return c.json({ error: 'リクエストが多すぎます' }, 429);
          }
          const auth = await resolveCurrentUser(c);
          if (!auth) return c.json({ error: 'Unauthorized' }, 401);

          const spotId = c.req.param('spotId');
          if (!SAFE_SPOT_ID_REGEX.test(spotId)) {
            return c.json({ error: '不正なスポットIDです' }, 400);
          }
          try {
            const repo = getRepo(c.env);
            // R2 への先行書き込みによる孤立オブジェクト生成（Storage DoS）を防ぐため、
            // 必ず事前にユーザーの訪問レコードが存在するか確認する
            const userVisits = await repo.getUserVisits(auth.user.id);
            if (!userVisits[spotId]) {
              return c.json({ error: '訪問記録が見つかりません' }, 404);
            }

            const { bytes, mime } = decodeDataUrlToBytes(
              c.req.valid('json').dataUrl,
            );
            const ext = mime === 'image/png'
              ? 'png'
              : mime === 'image/webp'
                ? 'webp'
                : 'jpg';
            const r2Key = `albums/${auth.user.id}/${spotId}_${Date.now()}.${ext}`;

            const albumStorage = getAlbum(c.env);

            // 既存の古い画像があればR2から削除
            const oldMeta = await repo.getVisitPhotoMeta(auth.user.id, spotId);
            if (oldMeta) {
              await albumStorage.deletePhoto(oldMeta.r2Key).catch(() => {});
            }

            await albumStorage.putPhoto(r2Key, bytes, mime);
            const updated = await repo.updateVisitAlbum({
              userId: auth.user.id,
              spotId,
              privatePhotoR2Key: r2Key,
              privatePhotoMime: mime,
            });
            if (!updated) {
              await albumStorage.deletePhoto(r2Key).catch(() => {});
              return c.json({ error: '訪問記録が見つかりません' }, 404);
            }
            return c.json({ visit: updated });
          } catch (err) {
            return c.json(
              { error: err instanceof Error ? err.message : '画像保存に失敗しました' },
              400,
            );
          }
        },
      )

      .get('/me/visits/:spotId/photo', async (c) => {
        const auth = await resolveCurrentUser(c);
        if (!auth) return c.json({ error: 'Unauthorized' }, 401);

        const spotId = c.req.param('spotId');
        if (!SAFE_SPOT_ID_REGEX.test(spotId)) {
          return c.json({ error: 'Invalid spotId' }, 400);
        }

        const meta = await getRepo(c.env).getVisitPhotoMeta(
          auth.user.id,
          spotId,
        );
        if (!meta) return c.json({ error: 'Photo not found' }, 404);

        const stored = await getAlbum(c.env).getPhoto(meta.r2Key);
        if (!stored) return c.json({ error: 'Photo blob missing' }, 404);

        const safeMime =
          stored.contentType === 'image/png' ||
          stored.contentType === 'image/webp' ||
          stored.contentType === 'image/jpeg'
            ? stored.contentType
            : 'image/jpeg';
        const ext =
          safeMime === 'image/png'
            ? 'png'
            : safeMime === 'image/webp'
              ? 'webp'
              : 'jpg';

        return new Response(stored.bytes as BodyInit, {
          status: 200,
          headers: {
            'Content-Type': safeMime,
            'Content-Disposition': `inline; filename="visit-photo.${ext}"`,
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
            'Cache-Control': 'private, max-age=3600',
          },
        });
      })

      // 6. 場所検索・URL座標解析・重複検知・聖地登録
      .get('/spots/duplicates', async (c) => {
        if (!checkRateLimit('duplicates', getClientIp(c), 40, 60_000)) {
          return c.json({ error: 'リクエストが多すぎます' }, 429);
        }
        // 未解禁スポットの正式名称が未認証スクレイピングされるのを防ぐため、ログイン済みユーザー限定
        const auth = await resolveCurrentUser(c);
        if (!auth || auth.user.isAnonymous) {
          return c.json({ error: 'ログインが必要です' }, 401);
        }
        const lat = Number(c.req.query('lat'));
        const lng = Number(c.req.query('lng'));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return c.json({ duplicates: [] });
        }
        const matches = await getRepo(c.env).findNearbyDuplicates(lat, lng, 60);
        return c.json({
          duplicates: matches.map(({ spot, distanceMeters }) => ({
            id: spot.id,
            title: spot.title,
            distanceMeters,
            episodeCount: spot.episodes.length,
            mediaCategories: Array.from(
              new Set(spot.episodes.map((e) => e.mediaCategory)),
            ),
          })),
        });
      })

      .post(
        '/locations/resolve',
        zValidator('json', z.object({ input: z.string().min(1).max(500) })),
        async (c) => {
          if (!checkRateLimit('geocoder', getClientIp(c), 30, 60_000)) {
            return c.json({ error: 'リクエストが多すぎます' }, 429);
          }
          const rawInput = c.req.valid('json').input.trim();
          // 既に完全なGoogleマップURLで座標(!3d!4d等)がローカル正規表現のみで抽出できる場合は外部API課金が発生しないため即時返却
          const isShortUrl =
            /https:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/[a-zA-Z0-9_-]+/.test(
              rawInput,
            );
          if (!isShortUrl) {
            const localParsed = parseGoogleMapsUrl(rawInput);
            if (localParsed.lat !== undefined && localParsed.lng !== undefined) {
              return c.json(localParsed);
            }
          }

          // 短縮URLのネットワーク展開やGoogle Places API / 国土地理院フォールバック検索を伴う場合はログイン済みユーザー限定（Denial of Wallet 防止）
          const auth = await resolveCurrentUser(c);
          if (!auth || auth.user.isAnonymous) {
            return c.json(
              { error: '場所名検索・短縮URL展開にはログインが必要です' },
              401,
            );
          }

          const result = await resolveLocationInput(
            rawInput,
            getEnvValue(c.env, 'GOOGLE_MAPS_API_KEY'),
          );
          return c.json(result);
        },
      )

      .get('/locations/search', async (c) => {
        if (!checkRateLimit('geocoder', getClientIp(c), 30, 60_000)) {
          return c.json({ error: 'リクエストが多すぎます' }, 429);
        }
        // Google Places API 課金枯渇攻撃（Denial of Wallet）を防ぐためログイン済みユーザー限定
        const auth = await resolveCurrentUser(c);
        if (!auth || auth.user.isAnonymous) {
          return c.json({ error: '施設・住所検索にはログインが必要です' }, 401);
        }
        const q = (c.req.query('q') ?? '').trim();
        if (q.length > 120) {
          return c.json({ error: '検索キーワードは120文字以内にしてください' }, 400);
        }
        const candidates = await searchPlacesByQuery(
          q,
          getEnvValue(c.env, 'GOOGLE_MAPS_API_KEY'),
        );
        return c.json({ candidates });
      })

      .post('/spots', zValidator('json', CreateSpotInputSchema), async (c) => {
        if (!checkRateLimit('create_spot', getClientIp(c), 20, 60_000)) {
          return c.json({ error: 'リクエストが多すぎます' }, 429);
        }
        const auth = await resolveCurrentUser(c);
        if (!auth || auth.user.isAnonymous) {
          return c.json(
            {
              error:
                '聖地の追加にはアカウント登録・ログインが必要です（現在の訪問記録はそのまま引き継がれます）',
            },
            401,
          );
        }
        try {
          const saved = await getRepo(c.env).createOrAppendSpot(
            c.req.valid('json'),
            auth.user.id,
          );
          return c.json({ spot: saved });
        } catch (err) {
          return c.json(
            { error: err instanceof Error ? err.message : '登録に失敗しました' },
            400,
          );
        }
      })

      // 7. コメント & 通報（モデレーション）
      .post(
        '/spots/:id/comments',
        zValidator(
          'json',
          z.object({
            authorName: z.string().min(1).max(30).optional(),
            content: z.string().min(1).max(300),
            isPublic: z.boolean().default(true),
          }),
        ),
        async (c) => {
          if (!checkRateLimit('post_comment', getClientIp(c), 20, 60_000)) {
            return c.json({ error: 'リクエストが多すぎます' }, 429);
          }
          const auth = await resolveCurrentUser(c);
          if (!auth) return c.json({ error: 'Unauthorized' }, 401);

          const spotId = c.req.param('id');
          const userVisits = await getRepo(c.env).getUserVisits(auth.user.id);
          const visit = userVisits[spotId];
          if (!visit && auth.user.role !== 'admin') {
            return c.json(
              { error: '解禁済みの聖地にのみコメントを投稿できます' },
              403,
            );
          }

          const body = c.req.valid('json');
          // ギブアップ解禁（現地未訪問）のユーザーは公開コメント不可（自分用非公開ノートのみ許可）
          if (
            body.isPublic &&
            visit?.status !== 'visited' &&
            auth.user.role !== 'admin'
          ) {
            return c.json(
              {
                error:
                  '他の巡礼者への公開コメントは、現地に到着して発見達成した聖地にのみ投稿できます（自分のみ表示のメモは保存可能です）',
              },
              403,
            );
          }

          // 投稿者名のなりすましを防ぐため、サーバー側の認証ユーザー表示名を強制使用
          const verifiedAuthorName =
            auth.user.settings.nickname?.trim() ||
            auth.user.name?.trim() ||
            'おひさま探索者';

          const saved = await getRepo(c.env).addComment({
            spotId,
            userId: auth.user.id,
            authorName: verifiedAuthorName,
            content: body.content,
            isPublic: body.isPublic,
          });
          return c.json({ comment: saved });
        },
      )

      .post(
        '/spots/:id/reports',
        zValidator(
          'json',
          z.object({
            reason: SpotReportReasonSchema,
            detail: z.string().max(500).optional(),
          }),
        ),
        async (c) => {
          if (!checkRateLimit('post_report', getClientIp(c), 15, 60_000)) {
            return c.json({ error: 'リクエストが多すぎます' }, 429);
          }
          const auth = await resolveCurrentUser(c);
          if (!auth) return c.json({ error: 'Unauthorized' }, 401);
          const body = c.req.valid('json');
          const report = await getRepo(c.env).createReport({
            spotId: c.req.param('id'),
            reporterUserId: auth.user.id,
            reason: body.reason,
            detail: body.detail,
          });
          return c.json({ report });
        },
      )

      // 8. 管理者機能（一括インポート・マイマップURL同期・通報審査・スポット/エピソード/コメント編集削除）
      .get('/admin/reports', async (c) => {
        const auth = await resolveCurrentUser(c);
        if (!auth || auth.user.role !== 'admin') {
          return c.json({ error: '管理者権限が必要です' }, 403);
        }
        const statusParam = c.req.query('status') as
          | 'open'
          | 'resolved'
          | 'dismissed'
          | undefined;
        const reports = await getRepo(c.env).listReports(statusParam);
        return c.json({ reports });
      })

      .patch(
        '/admin/reports/:reportId',
        zValidator(
          'json',
          z.object({ status: z.enum(['resolved', 'dismissed']) }),
        ),
        async (c) => {
          const auth = await resolveCurrentUser(c);
          if (!auth || auth.user.role !== 'admin') {
            return c.json({ error: '管理者権限が必要です' }, 403);
          }
          const updated = await getRepo(c.env).updateReportStatus(
            c.req.param('reportId'),
            c.req.valid('json').status,
          );
          if (!updated) return c.json({ error: 'Report not found' }, 404);
          return c.json({ report: updated });
        },
      )

      .patch(
        '/admin/spots/:id',
        zValidator('json', UpdateSpotInputSchema),
        async (c) => {
          const auth = await resolveCurrentUser(c);
          if (!auth || auth.user.role !== 'admin') {
            return c.json({ error: '管理者権限が必要です' }, 403);
          }
          const updated = await getRepo(c.env).updateSpot(
            c.req.param('id'),
            c.req.valid('json'),
          );
          if (!updated) return c.json({ error: 'Spot not found' }, 404);
          return c.json({ spot: updated });
        },
      )

      .delete('/admin/spots/:id', async (c) => {
        const auth = await resolveCurrentUser(c);
        if (!auth || auth.user.role !== 'admin') {
          return c.json({ error: '管理者権限が必要です' }, 403);
        }
        const { deleted, r2KeysToDelete } = await getRepo(c.env).deleteSpot(
          c.req.param('id'),
        );
        if (deleted && r2KeysToDelete.length > 0) {
          const album = getAlbum(c.env);
          for (const key of r2KeysToDelete) {
            await album.deletePhoto(key).catch(() => {});
          }
        }
        return c.json({ deleted });
      })

      .delete('/admin/spots/:spotId/episodes/:episodeId', async (c) => {
        const auth = await resolveCurrentUser(c);
        if (!auth || auth.user.role !== 'admin') {
          return c.json({ error: '管理者権限が必要です' }, 403);
        }
        try {
          const updatedSpot = await getRepo(c.env).deleteEpisode(
            c.req.param('spotId'),
            c.req.param('episodeId'),
          );
          if (!updatedSpot) {
            return c.json({ error: '対象スポットまたはエピソードが見つかりません' }, 404);
          }
          return c.json({ spot: updatedSpot });
        } catch (err) {
          return c.json(
            { error: err instanceof Error ? err.message : 'エピソード削除に失敗しました' },
            400,
          );
        }
      })

      .delete('/admin/spots/:spotId/comments/:commentId', async (c) => {
        const auth = await resolveCurrentUser(c);
        if (!auth || auth.user.role !== 'admin') {
          return c.json({ error: '管理者権限が必要です' }, 403);
        }
        const deleted = await getRepo(c.env).deleteComment(
          c.req.param('spotId'),
          c.req.param('commentId'),
        );
        if (!deleted) {
          return c.json({ error: 'コメントが見つかりません' }, 404);
        }
        return c.json({ deleted: true });
      })

      .post(
        '/admin/import',
        zValidator(
          'json',
          z.object({
            format: z.enum(['kml', 'csv', 'mymap_url']),
            content: z.string().min(1).max(10_000_000),
          }),
        ),
        async (c) => {
          const auth = await resolveCurrentUser(c);
          if (!auth || auth.user.role !== 'admin') {
            return c.json({ error: '一括インポートは管理者権限のみ実行可能です' }, 403);
          }

          const { format, content } = c.req.valid('json');
          let candidates;

          if (format === 'mymap_url') {
            const midMatch = content.match(/[?&]mid=([a-zA-Z0-9_-]+)/);
            const mid = midMatch ? midMatch[1] : content.trim();
            if (!mid || !/^[a-zA-Z0-9_-]{10,80}$/.test(mid)) {
              return c.json(
                { error: '有効な Google マイマップの URL または mid を指定してください' },
                400,
              );
            }
            const kmlUrl = `https://www.google.com/maps/d/kml?mid=${mid}&forcekml=1`;
            const kmlRes = await fetch(kmlUrl, {
              signal: AbortSignal.timeout(8000),
            });
            if (!kmlRes.ok) {
              return c.json(
                { error: 'GoogleマイマップからKMLを取得できませんでした（公開設定をご確認ください）' },
                400,
              );
            }
            const kmlXml = await kmlRes.text();
            if (kmlXml.length > 15_000_000) {
              return c.json({ error: 'KMLファイルサイズが上限（15MB）を超えています' }, 400);
            }
            candidates = parseKmlToCandidates(kmlXml);
          } else if (format === 'kml') {
            candidates = parseKmlToCandidates(content);
          } else {
            candidates = parseCsvToCandidates(content);
          }

          if (candidates.length === 0) {
            return c.json({ error: '有効な聖地データが見つかりませんでした' }, 400);
          }

          const summary = await getRepo(c.env).bulkImportCandidates(
            candidates,
            auth.user.id,
          );
          return c.json(summary);
        },
      )
  );
}

export const apiApp = createApiApp();
export type ApiAppType = typeof apiApp;
