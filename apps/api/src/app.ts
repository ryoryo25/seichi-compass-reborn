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
  MaskLevelSchema,
  maskSpotTitle,
  type MaskedSpotSummary,
  type MediaCategory,
  MediaCategorySchema,
  parseCsvToCandidates,
  parseKmlToCandidates,
  SpotReportReasonSchema,
  TagVisibilitySchema,
  UpdateSpotInputSchema,
} from '@seichi/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { resolveLocationInput, searchPlacesByQuery } from './geocoder.ts';

export interface ApiBindings {
  DATABASE_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
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
}

const SESSION_COOKIE_NAME = 'seichi_session';

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

function extractRequestToken(
  authHeader: string | undefined,
  cookieToken: string | undefined,
): string | undefined {
  if (authHeader?.startsWith('Bearer ')) {
    const bearer = authHeader.slice('Bearer '.length).trim();
    if (bearer) return bearer;
  }
  return cookieToken;
}

function decodeDataUrlToBytes(dataUrl: string): {
  bytes: Uint8Array;
  mime: string;
} {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) {
    throw new Error('有効な画像データではありません');
  }
  const mime = match[1]!;
  const b64 = match[2]!;
  const binaryStr = atob(b64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  if (bytes.byteLength > 5 * 1024 * 1024) {
    throw new Error('画像サイズは5MB以下にしてください');
  }
  return { bytes, mime };
}

const SearchRequestSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  member: z.string().optional(),
  mediaCategory: MediaCategorySchema.optional(),
  prefecture: z.string().optional(),
  tagQuery: z.string().optional(),
  limit: z.number().int().min(1).max(1500).default(250),
  maskLevel: MaskLevelSchema.default('normal'),
  tagVisibility: TagVisibilitySchema.default('all'),
  mapMode: MapModeSchema.default('treasure'),
});

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
      origin: (origin) => origin || '*',
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  const getRepo = (env?: ApiBindings) =>
    resolveRepository(getEnvValue(env, 'DATABASE_URL'));
  const getAlbum = (env?: ApiBindings) =>
    resolveAlbumStorage(getEnvValue(env, 'ALBUM_BUCKET'));

  const resolveCurrentUser = async (
    authHeader: string | undefined,
    cookieVal: string | undefined,
    env?: ApiBindings,
  ): Promise<{ user: AuthUser; token: string } | null> => {
    const token = extractRequestToken(authHeader, cookieVal);
    if (!token) return null;
    const user = await getRepo(env).getUserBySessionToken(token);
    if (!user) return null;
    return { user, token };
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
          allowDevRoleSwitch:
            getEnvValue(c.env, 'ALLOW_DEV_ROLE_SWITCH') !== 'false',
          enableDemoSimulator:
            getEnvValue(c.env, 'ENABLE_DEMO_SIMULATOR') !== 'false',
        });
      })

      // 2. 認証・ゲストセッション初期化・アカウント連携引き継ぎ
      .post('/auth/session', async (c) => {
        const repo = getRepo(c.env);
        const currentToken = extractRequestToken(
          c.req.header('Authorization'),
          getCookie(c, SESSION_COOKIE_NAME),
        );
        const { user, sessionToken } =
          await repo.getOrCreateAnonymousUser(currentToken);

        setCookie(c, SESSION_COOKIE_NAME, sessionToken, {
          httpOnly: true,
          sameSite: 'Lax',
          path: '/',
          maxAge: 60 * 60 * 24 * 90,
        });

        const visits = await repo.getUserVisits(user.id);
        return c.json({ user, sessionToken, visits });
      })

      .post(
        '/auth/signup',
        zValidator(
          'json',
          z.object({
            email: z.string().email(),
            password: z.string().min(8).max(100),
            name: z.string().min(1).max(30),
          }),
        ),
        async (c) => {
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
            setCookie(c, SESSION_COOKIE_NAME, sessionToken, {
              httpOnly: true,
              sameSite: 'Lax',
              path: '/',
              maxAge: 60 * 60 * 24 * 90,
            });
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
            email: z.string().email(),
            password: z.string().min(1),
          }),
        ),
        async (c) => {
          const repo = getRepo(c.env);
          const currentToken = extractRequestToken(
            c.req.header('Authorization'),
            getCookie(c, SESSION_COOKIE_NAME),
          );
          const body = c.req.valid('json');
          try {
            const { user, sessionToken } = await repo.signInWithEmail({
              currentSessionToken: currentToken,
              ...body,
            });
            setCookie(c, SESSION_COOKIE_NAME, sessionToken, {
              httpOnly: true,
              sameSite: 'Lax',
              path: '/',
              maxAge: 60 * 60 * 24 * 90,
            });
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
        return c.json({ ok: true });
      })

      // Better Auth OAuth エンドポイント（X / Google / Apple 設定時）
      .all('/auth/oauth/*', async (c) => {
        const dbUrl = getEnvValue(c.env, 'DATABASE_URL');
        const secret = getEnvValue(c.env, 'BETTER_AUTH_SECRET');
        if (!dbUrl || !secret) {
          return c.json(
            { error: 'OAuthプロバイダを使用するには DATABASE_URL と BETTER_AUTH_SECRET の設定が必要です' },
            501,
          );
        }
        const auth = createBetterAuth({
          DATABASE_URL: dbUrl,
          BETTER_AUTH_SECRET: secret,
          BETTER_AUTH_URL: getEnvValue(c.env, 'BETTER_AUTH_URL'),
          TWITTER_CLIENT_ID: getEnvValue(c.env, 'TWITTER_CLIENT_ID'),
          TWITTER_CLIENT_SECRET: getEnvValue(c.env, 'TWITTER_CLIENT_SECRET'),
          GOOGLE_CLIENT_ID: getEnvValue(c.env, 'GOOGLE_CLIENT_ID'),
          GOOGLE_CLIENT_SECRET: getEnvValue(c.env, 'GOOGLE_CLIENT_SECRET'),
          APPLE_CLIENT_ID: getEnvValue(c.env, 'APPLE_CLIENT_ID'),
          APPLE_CLIENT_SECRET: getEnvValue(c.env, 'APPLE_CLIENT_SECRET'),
        });
        return auth.handler(c.req.raw);
      })

      // 3. ユーザー設定・開発ロール切替・公開実績プロフィール
      .put('/me/settings', zValidator('json', ExplorerSettingsSchema), async (c) => {
        const auth = await resolveCurrentUser(
          c.req.header('Authorization'),
          getCookie(c, SESSION_COOKIE_NAME),
          c.env,
        );
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
          if (getEnvValue(c.env, 'ALLOW_DEV_ROLE_SWITCH') === 'false') {
            return c.json({ error: '本番環境では無効化されています' }, 403);
          }
          const auth = await resolveCurrentUser(
            c.req.header('Authorization'),
            getCookie(c, SESSION_COOKIE_NAME),
            c.env,
          );
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

      // 4. 聖地検索・Xシェア用非ネタバレプレビュー・コンパス方位・到着判定
      .post('/spots/search', zValidator('json', SearchRequestSchema), async (c) => {
        const repo = getRepo(c.env);
        const auth = await resolveCurrentUser(
          c.req.header('Authorization'),
          getCookie(c, SESSION_COOKIE_NAME),
          c.env,
        );
        const userVisits = auth ? await repo.getUserVisits(auth.user.id) : {};
        const body = c.req.valid('json');

        const results = await repo.querySpots({
          lat: body.lat,
          lng: body.lng,
          member: body.member || undefined,
          mediaCategory: body.mediaCategory,
          prefecture: body.prefecture || undefined,
          tagQuery: body.tagQuery || undefined,
          limit: body.limit,
        });

        const summaries: MaskedSpotSummary[] = results.map(
          ({ spot, distanceMeters }) => {
            const visitRecord = userVisits[spot.id];
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
                  body.tagVisibility,
                );

            const { radarLat, radarLng } = getBlurredRadarPoint(
              spot.id,
              spot.lat,
              spot.lng,
            );
            const exposeExactCoords = isUnlocked || body.mapMode === 'standard';

            return {
              id: spot.id,
              displayTitle: isUnlocked
                ? spot.title
                : maskSpotTitle(spot.id, spot.title, body.maskLevel),
              isUnlocked,
              visitStatus,
              selfDiscovered: visitRecord?.selfDiscovered ?? false,
              distanceMeters,
              bearingDeg: calculateBearingDeg(
                body.lat,
                body.lng,
                spot.lat,
                spot.lng,
              ),
              arrivalRadiusMeters: spot.arrivalRadiusMeters,
              prefecture: spot.prefecture,
              episodeCount: spot.episodes.length,
              ...visibleTags,
              radarLat,
              radarLng,
              exactLat: exposeExactCoords ? spot.lat : undefined,
              exactLng: exposeExactCoords ? spot.lng : undefined,
            };
          },
        );

        return c.json({ spots: summaries });
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
        const lat = Number(c.req.query('lat'));
        const lng = Number(c.req.query('lng'));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return c.json({ error: 'Invalid coordinates' }, 400);
        }
        const spot = await getRepo(c.env).getSpotById(c.req.param('id'));
        if (!spot) return c.json({ error: 'Spot not found' }, 404);
        return c.json({
          distanceMeters: haversineDistanceMeters(lat, lng, spot.lat, spot.lng),
          bearingDeg: calculateBearingDeg(lat, lng, spot.lat, spot.lng),
          arrivalRadiusMeters: spot.arrivalRadiusMeters,
        });
      })

      .post('/demo/approach/:id', async (c) => {
        if (getEnvValue(c.env, 'ENABLE_DEMO_SIMULATOR') === 'false') {
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
          const repo = getRepo(c.env);
          const currentToken = extractRequestToken(
            c.req.header('Authorization'),
            getCookie(c, SESSION_COOKIE_NAME),
          );
          const { user, sessionToken } =
            await repo.getOrCreateAnonymousUser(currentToken);
          setCookie(c, SESSION_COOKIE_NAME, sessionToken, {
            httpOnly: true,
            sameSite: 'Lax',
            path: '/',
            maxAge: 60 * 60 * 24 * 90,
          });

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
              selfDiscovered: body.mapMode === 'treasure',
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
        const auth = await resolveCurrentUser(
          c.req.header('Authorization'),
          getCookie(c, SESSION_COOKIE_NAME),
          c.env,
        );
        if (!auth) return c.json({ visits: {} });
        const visits = await getRepo(c.env).getUserVisits(auth.user.id);
        return c.json({ visits });
      })

      .put(
        '/me/visits/:spotId/memo',
        zValidator('json', z.object({ privateMemo: z.string().max(1000) })),
        async (c) => {
          const auth = await resolveCurrentUser(
            c.req.header('Authorization'),
            getCookie(c, SESSION_COOKIE_NAME),
            c.env,
          );
          if (!auth) return c.json({ error: 'Unauthorized' }, 401);
          const updated = await getRepo(c.env).updateVisitAlbum({
            userId: auth.user.id,
            spotId: c.req.param('spotId'),
            privateMemo: c.req.valid('json').privateMemo,
          });
          if (!updated) return c.json({ error: '訪問記録が見つかりません' }, 404);
          return c.json({ visit: updated });
        },
      )

      .put(
        '/me/visits/:spotId/photo',
        zValidator('json', z.object({ dataUrl: z.string().min(20) })),
        async (c) => {
          const auth = await resolveCurrentUser(
            c.req.header('Authorization'),
            getCookie(c, SESSION_COOKIE_NAME),
            c.env,
          );
          if (!auth) return c.json({ error: 'Unauthorized' }, 401);

          const spotId = c.req.param('spotId');
          try {
            const { bytes, mime } = decodeDataUrlToBytes(
              c.req.valid('json').dataUrl,
            );
            const ext = mime.includes('png')
              ? 'png'
              : mime.includes('webp')
                ? 'webp'
                : 'jpg';
            const r2Key = `albums/${auth.user.id}/${spotId}_${Date.now()}.${ext}`;

            const albumStorage = getAlbum(c.env);
            const repo = getRepo(c.env);

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
        const auth = await resolveCurrentUser(
          c.req.header('Authorization'),
          getCookie(c, SESSION_COOKIE_NAME),
          c.env,
        );
        if (!auth) return c.json({ error: 'Unauthorized' }, 401);

        const meta = await getRepo(c.env).getVisitPhotoMeta(
          auth.user.id,
          c.req.param('spotId'),
        );
        if (!meta) return c.json({ error: 'Photo not found' }, 404);

        const stored = await getAlbum(c.env).getPhoto(meta.r2Key);
        if (!stored) return c.json({ error: 'Photo blob missing' }, 404);

        return new Response(stored.bytes as BodyInit, {
          status: 200,
          headers: {
            'Content-Type': stored.contentType,
            'Cache-Control': 'private, max-age=3600',
          },
        });
      })

      // 6. 場所検索・URL座標解析・重複検知・聖地登録
      .get('/spots/duplicates', async (c) => {
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
        zValidator('json', z.object({ input: z.string().min(1) })),
        async (c) => {
          const result = await resolveLocationInput(
            c.req.valid('json').input,
            getEnvValue(c.env, 'GOOGLE_MAPS_API_KEY'),
          );
          return c.json(result);
        },
      )

      .get('/locations/search', async (c) => {
        const q = c.req.query('q') ?? '';
        const candidates = await searchPlacesByQuery(
          q,
          getEnvValue(c.env, 'GOOGLE_MAPS_API_KEY'),
        );
        return c.json({ candidates });
      })

      .post('/spots', zValidator('json', CreateSpotInputSchema), async (c) => {
        const auth = await resolveCurrentUser(
          c.req.header('Authorization'),
          getCookie(c, SESSION_COOKIE_NAME),
          c.env,
        );
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
            authorName: z.string().min(1).max(30),
            content: z.string().min(1).max(300),
            isPublic: z.boolean().default(true),
          }),
        ),
        async (c) => {
          const auth = await resolveCurrentUser(
            c.req.header('Authorization'),
            getCookie(c, SESSION_COOKIE_NAME),
            c.env,
          );
          if (!auth) return c.json({ error: 'Unauthorized' }, 401);

          const spotId = c.req.param('id');
          const userVisits = await getRepo(c.env).getUserVisits(auth.user.id);
          if (!userVisits[spotId] && auth.user.role !== 'admin') {
            return c.json(
              { error: '解禁済みの聖地にのみコメントを投稿できます' },
              403,
            );
          }

          const body = c.req.valid('json');
          const saved = await getRepo(c.env).addComment({
            spotId,
            userId: auth.user.id,
            authorName: body.authorName,
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
          const auth = await resolveCurrentUser(
            c.req.header('Authorization'),
            getCookie(c, SESSION_COOKIE_NAME),
            c.env,
          );
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

      // 8. 管理者機能（一括インポート・マイマップURL同期・通報審査・スポット編集削除）
      .get('/admin/reports', async (c) => {
        const auth = await resolveCurrentUser(
          c.req.header('Authorization'),
          getCookie(c, SESSION_COOKIE_NAME),
          c.env,
        );
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
          const auth = await resolveCurrentUser(
            c.req.header('Authorization'),
            getCookie(c, SESSION_COOKIE_NAME),
            c.env,
          );
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
          const auth = await resolveCurrentUser(
            c.req.header('Authorization'),
            getCookie(c, SESSION_COOKIE_NAME),
            c.env,
          );
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
        const auth = await resolveCurrentUser(
          c.req.header('Authorization'),
          getCookie(c, SESSION_COOKIE_NAME),
          c.env,
        );
        if (!auth || auth.user.role !== 'admin') {
          return c.json({ error: '管理者権限が必要です' }, 403);
        }
        const ok = await getRepo(c.env).deleteSpot(c.req.param('id'));
        return c.json({ deleted: ok });
      })

      .post(
        '/admin/import',
        zValidator(
          'json',
          z.object({
            format: z.enum(['kml', 'csv', 'mymap_url']),
            content: z.string().min(1),
          }),
        ),
        async (c) => {
          const auth = await resolveCurrentUser(
            c.req.header('Authorization'),
            getCookie(c, SESSION_COOKIE_NAME),
            c.env,
          );
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
            const kmlRes = await fetch(kmlUrl);
            if (!kmlRes.ok) {
              return c.json(
                { error: 'GoogleマイマップからKMLを取得できませんでした（公開設定をご確認ください）' },
                400,
              );
            }
            const kmlXml = await kmlRes.text();
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
