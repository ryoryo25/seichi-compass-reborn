import { zValidator } from '@hono/zod-validator';
import { localSpotStore } from '@seichi/db';
import {
  calculateBearingDeg,
  CreateSpotInputSchema,
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
  parseGoogleMapsUrl,
  parseKmlToCandidates,
  TagVisibilitySchema,
} from '@seichi/shared';
import { Hono } from 'hono';
import { z } from 'zod';

const SearchRequestSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  member: z.string().optional(),
  mediaCategory: MediaCategorySchema.optional(),
  prefecture: z.string().optional(),
  tagQuery: z.string().optional(),
  limit: z.number().int().min(1).max(1500).default(200),
  maskLevel: MaskLevelSchema.default('normal'),
  tagVisibility: TagVisibilitySchema.default('all'),
  mapMode: MapModeSchema.default('treasure'),
  unlockedMap: z
    .record(
      z.string(),
      z.object({
        status: z.enum(['visited', 'give_up']),
        selfDiscovered: z.boolean().optional(),
      }),
    )
    .default({}),
});

const UnlockRequestSchema = z.object({
  userLat: z.number().min(-90).max(90),
  userLng: z.number().min(-180).max(180),
  mode: z.enum(['arrive', 'give_up', 'view_unlocked']),
});

export const apiApp = new Hono()
  .basePath('/api')
  .get('/meta', (c) => {
    const allSpots = localSpotStore.getAllSpots();
    const totalEpisodes = allSpots.reduce((acc, s) => acc + s.episodes.length, 0);
    return c.json({
      totalSpots: allSpots.length,
      totalEpisodes,
      prefectures: localSpotStore.getPrefectureSummary(),
      members: HINATAZAKA_MEMBERS,
    });
  })
  .post('/spots/search', zValidator('json', SearchRequestSchema), (c) => {
    const body = c.req.valid('json');
    const results = localSpotStore.querySpots({
      lat: body.lat,
      lng: body.lng,
      member: body.member || undefined,
      mediaCategory: body.mediaCategory,
      prefecture: body.prefecture || undefined,
      tagQuery: body.tagQuery || undefined,
      limit: body.limit,
    });

    const summaries: MaskedSpotSummary[] = results.map(({ spot, distanceMeters }) => {
      const unlockRecord = body.unlockedMap[spot.id];
      const isUnlocked = Boolean(unlockRecord);
      const visitStatus = unlockRecord?.status ?? 'unvisited';

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

      const { radarLat, radarLng } = getBlurredRadarPoint(spot.id, spot.lat, spot.lng);
      const exposeExactCoords = isUnlocked || body.mapMode === 'standard';

      return {
        id: spot.id,
        displayTitle: isUnlocked
          ? spot.title
          : maskSpotTitle(spot.id, spot.title, body.maskLevel),
        isUnlocked,
        visitStatus,
        selfDiscovered: unlockRecord?.selfDiscovered ?? false,
        distanceMeters,
        bearingDeg: calculateBearingDeg(body.lat, body.lng, spot.lat, spot.lng),
        arrivalRadiusMeters: spot.arrivalRadiusMeters,
        prefecture: spot.prefecture,
        episodeCount: spot.episodes.length,
        ...visibleTags,
        radarLat,
        radarLng,
        exactLat: exposeExactCoords ? spot.lat : undefined,
        exactLng: exposeExactCoords ? spot.lng : undefined,
      };
    });

    return c.json({ spots: summaries });
  })
  .get('/spots/:id/bearing', (c) => {
    const spotId = c.req.param('id');
    const lat = Number(c.req.query('lat'));
    const lng = Number(c.req.query('lng'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return c.json({ error: 'Invalid coordinates' }, 400);
    }
    const spot = localSpotStore.getSpotById(spotId);
    if (!spot) {
      return c.json({ error: 'Spot not found' }, 404);
    }
    return c.json({
      distanceMeters: haversineDistanceMeters(lat, lng, spot.lat, spot.lng),
      bearingDeg: calculateBearingDeg(lat, lng, spot.lat, spot.lng),
      arrivalRadiusMeters: spot.arrivalRadiusMeters,
    });
  })
  .post('/demo/approach/:id', (c) => {
    const spot = localSpotStore.getSpotById(c.req.param('id'));
    if (!spot) return c.json({ error: 'Spot not found' }, 404);
    // 聖地の約38m南西の位置へデモ移動（到着判定圏内）
    return c.json({
      lat: Number((spot.lat - 0.00025).toFixed(6)),
      lng: Number((spot.lng - 0.00025).toFixed(6)),
    });
  })
  .post('/spots/:id/unlock', zValidator('json', UnlockRequestSchema), (c) => {
    const spotId = c.req.param('id');
    const body = c.req.valid('json');
    const spot = localSpotStore.getSpotById(spotId);
    if (!spot) {
      return c.json({ error: '聖地が見つかりませんでした' }, 404);
    }

    const distanceMeters = haversineDistanceMeters(
      body.userLat,
      body.userLng,
      spot.lat,
      spot.lng,
    );

    if (body.mode === 'arrive' && distanceMeters > spot.arrivalRadiusMeters) {
      const remaining = Math.max(1, distanceMeters - spot.arrivalRadiusMeters);
      return c.json(
        {
          error: `まだ聖地に到着していません（到着判定まであと約 ${remaining}m 近づいてください）`,
          distanceMeters,
        },
        400,
      );
    }

    const comments = localSpotStore.getPublicCommentsForSpot(spot.id);
    return c.json({
      spot,
      comments,
      distanceMeters,
    });
  })
  .get('/spots/duplicates', (c) => {
    const lat = Number(c.req.query('lat'));
    const lng = Number(c.req.query('lng'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return c.json({ duplicates: [] });
    }
    const matches = localSpotStore.findNearbyDuplicates(lat, lng, 60);
    return c.json({
      duplicates: matches.map(({ spot, distanceMeters }) => ({
        id: spot.id,
        title: spot.title,
        distanceMeters,
        episodeCount: spot.episodes.length,
        mediaCategories: Array.from(new Set(spot.episodes.map((e) => e.mediaCategory))),
      })),
    });
  })
  .post(
    '/locations/resolve',
    zValidator('json', z.object({ input: z.string().min(1) })),
    async (c) => {
      const { input } = c.req.valid('json');
      let targetInput = input.trim();

      // 短縮URL (maps.app.goo.gl / goo.gl) の場合は許可ホスト限定でリダイレクト先を取得
      const shortUrlMatch = targetInput.match(
        /https:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/[a-zA-Z0-9_-]+/,
      );
      if (shortUrlMatch) {
        try {
          const resp = await fetch(shortUrlMatch[0], {
            method: 'HEAD',
            redirect: 'follow',
          });
          if (resp.url) {
            targetInput = resp.url;
          }
        } catch {
          // オフライン環境等ではそのままフォールバック解析
        }
      }

      const parsed = parseGoogleMapsUrl(targetInput);
      return c.json(parsed);
    },
  )
  .post('/spots', zValidator('json', CreateSpotInputSchema), (c) => {
    const role = c.req.header('x-user-role') ?? 'guest';
    if (role === 'guest') {
      return c.json(
        { error: '聖地の登録にはログインが必要です（ヘッダーのロール切替で試せます）' },
        401,
      );
    }
    const input = c.req.valid('json');
    try {
      const saved = localSpotStore.createOrAppendSpot(input, role);
      return c.json({ spot: saved });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : '登録に失敗しました' },
        400,
      );
    }
  })
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
    (c) => {
      const spotId = c.req.param('id');
      const body = c.req.valid('json');
      const saved = localSpotStore.addComment({
        spotId,
        authorName: body.authorName,
        content: body.content,
        isPublic: body.isPublic,
      });
      return c.json({ comment: saved });
    },
  )
  .post(
    '/admin/import',
    zValidator(
      'json',
      z.object({
        format: z.enum(['kml', 'csv']),
        content: z.string().min(1),
      }),
    ),
    (c) => {
      const role = c.req.header('x-user-role') ?? 'guest';
      if (role !== 'admin') {
        return c.json({ error: '一括インポートは管理者権限のみ実行可能です' }, 403);
      }
      const { format, content } = c.req.valid('json');
      const candidates =
        format === 'kml' ? parseKmlToCandidates(content) : parseCsvToCandidates(content);
      if (candidates.length === 0) {
        return c.json({ error: '有効な聖地データが見つかりませんでした' }, 400);
      }
      const summary = localSpotStore.bulkImportCandidates(candidates);
      return c.json(summary);
    },
  );

export type ApiAppType = typeof apiApp;
