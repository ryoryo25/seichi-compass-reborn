import { neon } from '@neondatabase/serverless';
import {
  type AuthUser,
  type CreateSpotInput,
  type ExplorerSettings,
  ExplorerSettingsSchema,
  estimatePrefecture,
  type MediaCategory,
  mergeCandidatesIntoSpots,
  type PublicUserAchievements,
  type RawCandidateEpisode,
  type Spot,
  type SpotComment,
  type SpotEpisode,
  type SpotReport,
  type SpotReportReason,
  type UpdateSpotInput,
  validateAndParseReferenceUrl,
  type VisitRecord,
} from '@seichi/shared';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-http';
import { hashPasswordPbkdf2, verifyPasswordPbkdf2 } from './crypto-password.ts';
import type { SeichiRepository } from './repository.ts';
import {
  accounts,
  sessions,
  spotComments,
  spotEpisodes,
  spotReports,
  spots,
  users,
  visits,
} from './schema.ts';

function toAuthUser(row: typeof users.$inferSelect): AuthUser {
  const settings = ExplorerSettingsSchema.parse({
    ...(row.settingsJson ?? {}),
    nickname: row.settingsJson?.nickname ?? row.name,
    publicProfileStats: row.publicProfileStats,
  });
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    isAnonymous: row.isAnonymous,
    role: row.role === 'admin' ? 'admin' : 'user',
    publicProfileStats: row.publicProfileStats,
    settings,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 本番用 Neon Serverless PostgreSQL + PostGIS リポジトリ実装
 */
export class NeonPostgisRepository implements SeichiRepository {
  private readonly db;

  constructor(databaseUrl: string) {
    const client = neon(databaseUrl);
    this.db = drizzle(client);
  }

  private async hydrateSpotsWithEpisodes(
    spotRows: Array<typeof spots.$inferSelect>,
  ): Promise<Spot[]> {
    if (spotRows.length === 0) return [];
    const spotIds = spotRows.map((s) => s.id);
    const epRows = await this.db
      .select()
      .from(spotEpisodes)
      .where(inArray(spotEpisodes.spotId, spotIds));

    const epBySpot = new Map<string, SpotEpisode[]>();
    for (const ep of epRows) {
      const list = epBySpot.get(ep.spotId) ?? [];
      list.push({
        id: ep.id,
        spotId: ep.spotId,
        mediaCategory: ep.mediaCategory as MediaCategory,
        description: ep.description,
        referenceUrl: ep.referenceUrl ?? undefined,
        youtubeVideoId: ep.youtubeVideoId ?? undefined,
        videoStartSec: ep.videoStartSec ?? undefined,
        members: ep.members ?? [],
        hashtags: ep.hashtags ?? [],
        createdBy: ep.createdBy ?? 'system',
        createdAt: ep.createdAt.toISOString(),
      });
      epBySpot.set(ep.spotId, list);
    }

    return spotRows.map((s) => ({
      id: s.id,
      groupId: s.groupId,
      title: s.title,
      lat: s.lat,
      lng: s.lng,
      prefecture: s.prefecture,
      arrivalRadiusMeters: s.arrivalRadiusMeters,
      episodes: epBySpot.get(s.id) ?? [],
      createdAt: s.createdAt.toISOString(),
    }));
  }

  public async getUserBySessionToken(token: string): Promise<AuthUser | null> {
    if (!token) return null;
    const rows = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.token, token))
      .limit(1);

    const match = rows[0];
    if (!match) return null;
    if (match.session.expiresAt.getTime() < Date.now()) {
      await this.db.delete(sessions).where(eq(sessions.id, match.session.id));
      return null;
    }
    return toAuthUser(match.user);
  }

  public async getOrCreateAnonymousUser(
    sessionToken?: string,
  ): Promise<{ user: AuthUser; sessionToken: string }> {
    if (sessionToken) {
      const existing = await this.getUserBySessionToken(sessionToken);
      if (existing) return { user: existing, sessionToken };
    }

    const userId = `usr_${crypto.randomUUID()}`;
    const newToken = `tok_${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, '')}`;
    const defaultSettings = ExplorerSettingsSchema.parse({});

    const [inserted] = await this.db
      .insert(users)
      .values({
        id: userId,
        name: defaultSettings.nickname,
        isAnonymous: true,
        role: 'user',
        publicProfileStats: true,
        settingsJson: defaultSettings,
      })
      .returning();

    await this.db.insert(sessions).values({
      id: `ses_${crypto.randomUUID()}`,
      userId,
      token: newToken,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90),
    });

    return { user: toAuthUser(inserted!), sessionToken: newToken };
  }

  public async mergeAnonymousUserData(
    fromGuestUserId: string,
    toUserId: string,
  ): Promise<void> {
    if (fromGuestUserId === toUserId) return;
    const guestVisits = await this.db
      .select()
      .from(visits)
      .where(eq(visits.userId, fromGuestUserId));

    for (const gv of guestVisits) {
      const existing = await this.db
        .select()
        .from(visits)
        .where(and(eq(visits.userId, toUserId), eq(visits.spotId, gv.spotId)))
        .limit(1);

      if (!existing[0]) {
        await this.db
          .update(visits)
          .set({ userId: toUserId })
          .where(eq(visits.id, gv.id));
      } else if (gv.status === 'visited' && existing[0].status !== 'visited') {
        await this.db
          .update(visits)
          .set({
            status: 'visited',
            selfDiscovered: gv.selfDiscovered || existing[0].selfDiscovered,
            privateMemo: existing[0].privateMemo ?? gv.privateMemo,
            privatePhotoR2Key: existing[0].privatePhotoR2Key ?? gv.privatePhotoR2Key,
            privatePhotoMime: existing[0].privatePhotoMime ?? gv.privatePhotoMime,
          })
          .where(eq(visits.id, existing[0].id));
      }
    }

    await this.db
      .update(spotComments)
      .set({ userId: toUserId })
      .where(eq(spotComments.userId, fromGuestUserId));
  }

  public async signUpOrLinkEmail(params: {
    currentSessionToken?: string;
    email: string;
    password: string;
    name: string;
  }): Promise<{ user: AuthUser; sessionToken: string }> {
    const normalizedEmail = params.email.trim().toLowerCase();
    const dup = await this.db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);
    if (dup[0]) {
      throw new Error('このメールアドレスは既に登録されています');
    }

    const passwordHash = await hashPasswordPbkdf2(params.password);
    const currentGuest = params.currentSessionToken
      ? await this.getUserBySessionToken(params.currentSessionToken)
      : null;

    if (currentGuest && currentGuest.isAnonymous && params.currentSessionToken) {
      const nextSettings = ExplorerSettingsSchema.parse({
        ...currentGuest.settings,
        nickname: params.name.trim(),
      });
      const [updated] = await this.db
        .update(users)
        .set({
          name: params.name.trim(),
          email: normalizedEmail,
          isAnonymous: false,
          settingsJson: nextSettings,
          updatedAt: new Date(),
        })
        .where(eq(users.id, currentGuest.id))
        .returning();

      await this.db.insert(accounts).values({
        id: `acc_${crypto.randomUUID()}`,
        accountId: normalizedEmail,
        providerId: 'credential',
        userId: currentGuest.id,
        password: passwordHash,
      });

      return {
        user: toAuthUser(updated!),
        sessionToken: params.currentSessionToken,
      };
    }

    const userId = `usr_${crypto.randomUUID()}`;
    const newSettings = ExplorerSettingsSchema.parse({ nickname: params.name.trim() });
    const [created] = await this.db
      .insert(users)
      .values({
        id: userId,
        name: params.name.trim(),
        email: normalizedEmail,
        isAnonymous: false,
        role: 'user',
        publicProfileStats: true,
        settingsJson: newSettings,
      })
      .returning();

    await this.db.insert(accounts).values({
      id: `acc_${crypto.randomUUID()}`,
      accountId: normalizedEmail,
      providerId: 'credential',
      userId,
      password: passwordHash,
    });

    const token = `tok_${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, '')}`;
    await this.db.insert(sessions).values({
      id: `ses_${crypto.randomUUID()}`,
      userId,
      token,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90),
    });

    return { user: toAuthUser(created!), sessionToken: token };
  }

  public async signInWithEmail(params: {
    currentSessionToken?: string;
    email: string;
    password: string;
  }): Promise<{ user: AuthUser; sessionToken: string }> {
    const normalizedEmail = params.email.trim().toLowerCase();
    const found = await this.db
      .select({ user: users, account: accounts })
      .from(users)
      .innerJoin(accounts, eq(accounts.userId, users.id))
      .where(
        and(
          eq(users.email, normalizedEmail),
          eq(accounts.providerId, 'credential'),
        ),
      )
      .limit(1);

    const row = found[0];
    if (!row?.account.password) {
      throw new Error('メールアドレスまたはパスワードが正しくありません');
    }

    const valid = await verifyPasswordPbkdf2(params.password, row.account.password);
    if (!valid) {
      throw new Error('メールアドレスまたはパスワードが正しくありません');
    }

    const currentGuest = params.currentSessionToken
      ? await this.getUserBySessionToken(params.currentSessionToken)
      : null;
    if (currentGuest && currentGuest.isAnonymous && currentGuest.id !== row.user.id) {
      await this.mergeAnonymousUserData(currentGuest.id, row.user.id);
    }

    const token = `tok_${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, '')}`;
    await this.db.insert(sessions).values({
      id: `ses_${crypto.randomUUID()}`,
      userId: row.user.id,
      token,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90),
    });

    return { user: toAuthUser(row.user), sessionToken: token };
  }

  public async signOutSession(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.token, token));
  }

  public async updateUserSettings(
    userId: string,
    settings: ExplorerSettings,
  ): Promise<AuthUser> {
    const [updated] = await this.db
      .update(users)
      .set({
        name: settings.nickname,
        publicProfileStats: settings.publicProfileStats,
        settingsJson: settings,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) throw new Error('User not found');
    return toAuthUser(updated);
  }

  public async setUserRoleForDev(
    userId: string,
    role: 'user' | 'admin',
  ): Promise<AuthUser> {
    const [updated] = await this.db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) throw new Error('User not found');
    return toAuthUser(updated);
  }

  public async getPublicUserAchievements(
    userId: string,
  ): Promise<PublicUserAchievements | null> {
    const [userRow] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!userRow || !userRow.publicProfileStats) return null;

    const visitRows = await this.db
      .select({ visit: visits, pref: spots.prefecture })
      .from(visits)
      .innerJoin(spots, eq(visits.spotId, spots.id))
      .where(and(eq(visits.userId, userId), eq(visits.status, 'visited')));

    const prefCounts = new Map<string, number>();
    let selfCount = 0;
    for (const r of visitRows) {
      if (r.visit.selfDiscovered) selfCount++;
      prefCounts.set(r.pref, (prefCounts.get(r.pref) ?? 0) + 1);
    }

    return {
      userId: userRow.id,
      nickname: userRow.name,
      visitedCount: visitRows.length,
      selfDiscoveredCount: selfCount,
      prefecturesVisited: prefCounts.size,
      topPrefectures: Array.from(prefCounts.entries())
        .map(([prefecture, count]) => ({ prefecture, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
  }

  public async getMetaSummary() {
    const prefRows = await this.db
      .select({
        prefecture: spots.prefecture,
        totalSpots: sql<number>`count(*)::int`,
      })
      .from(spots)
      .groupBy(spots.prefecture)
      .orderBy(sql`count(*) desc`);

    const [epCount] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(spotEpisodes);

    const totalSpots = prefRows.reduce((acc, r) => acc + r.totalSpots, 0);
    return {
      totalSpots,
      totalEpisodes: epCount?.count ?? 0,
      prefectures: prefRows,
    };
  }

  public async getSpotById(spotId: string): Promise<Spot | null> {
    const rows = await this.db
      .select()
      .from(spots)
      .where(eq(spots.id, spotId))
      .limit(1);
    if (!rows[0]) return null;
    const hydrated = await this.hydrateSpotsWithEpisodes(rows);
    return hydrated[0] ?? null;
  }

  public async querySpots(params: {
    lat: number;
    lng: number;
    member?: string;
    mediaCategory?: MediaCategory;
    prefecture?: string;
    tagQuery?: string;
    limit?: number;
  }): Promise<Array<{ spot: Spot; distanceMeters: number }>> {
    const pointGeog = sql`ST_SetSRID(ST_MakePoint(${params.lng}, ${params.lat}), 4326)::geography`;
    const pointGeom = sql`ST_SetSRID(ST_MakePoint(${params.lng}, ${params.lat}), 4326)`;

    const conditions = [];
    if (params.prefecture) {
      conditions.push(eq(spots.prefecture, params.prefecture));
    }

    // GiST KNN (<->) を用いた高速空間検索（フィルタがある場合は広めに候補を引いて正確に絞り込む）
    const fetchLimit =
      params.member || params.mediaCategory || params.tagQuery
        ? Math.max((params.limit ?? 200) * 6, 1200)
        : (params.limit ?? 200);

    const rows = await this.db
      .select({
        spot: spots,
        distanceMeters: sql<number>`round(ST_Distance(${spots.location}::geography, ${pointGeog}))::int`,
      })
      .from(spots)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(sql`${spots.location} <-> ${pointGeom}`)
      .limit(fetchLimit);

    const hydrated = await this.hydrateSpotsWithEpisodes(rows.map((r) => r.spot));
    const distById = new Map(rows.map((r) => [r.spot.id, r.distanceMeters]));
    const q = params.tagQuery?.trim().toLowerCase();

    const filtered: Array<{ spot: Spot; distanceMeters: number }> = [];
    for (const spot of hydrated) {
      if (params.member && !spot.episodes.some((e) => e.members.includes(params.member!))) {
        continue;
      }
      if (
        params.mediaCategory &&
        !spot.episodes.some((e) => e.mediaCategory === params.mediaCategory)
      ) {
        continue;
      }
      if (q) {
        const hit =
          spot.prefecture.toLowerCase().includes(q) ||
          spot.episodes.some(
            (ep) =>
              ep.hashtags.some((h) => h.toLowerCase().includes(q)) ||
              ep.members.some((m) => m.toLowerCase().includes(q)),
          );
        if (!hit) continue;
      }
      filtered.push({
        spot,
        distanceMeters: distById.get(spot.id) ?? 0,
      });
    }

    return params.limit ? filtered.slice(0, params.limit) : filtered;
  }

  public async findNearbyDuplicates(
    lat: number,
    lng: number,
    withinMeters = 60,
  ): Promise<Array<{ spot: Spot; distanceMeters: number }>> {
    const pointGeog = sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
    const rows = await this.db
      .select({
        spot: spots,
        distanceMeters: sql<number>`round(ST_Distance(${spots.location}::geography, ${pointGeog}))::int`,
      })
      .from(spots)
      .where(sql`ST_DWithin(${spots.location}::geography, ${pointGeog}, ${withinMeters})`)
      .orderBy(sql`ST_Distance(${spots.location}::geography, ${pointGeog})`);

    const hydrated = await this.hydrateSpotsWithEpisodes(rows.map((r) => r.spot));
    const distMap = new Map(rows.map((r) => [r.spot.id, r.distanceMeters]));
    return hydrated.map((spot) => ({
      spot,
      distanceMeters: distMap.get(spot.id) ?? 0,
    }));
  }

  public async createOrAppendSpot(
    input: CreateSpotInput,
    createdByUserId: string,
  ): Promise<Spot> {
    let normalizedRef: string | undefined;
    let youtubeVideoId: string | undefined;
    let videoStartSec: number | undefined;

    if (input.referenceUrl && input.referenceUrl.trim() !== '') {
      const v = validateAndParseReferenceUrl(input.referenceUrl);
      if (!v.ok) throw new Error(v.reason);
      normalizedRef = v.normalizedUrl;
      youtubeVideoId = v.youtubeVideoId;
      videoStartSec = v.videoStartSec;
    }

    const epId = `ep_${crypto.randomUUID().slice(0, 12)}`;

    if (input.existingSpotId) {
      const existing = await this.getSpotById(input.existingSpotId);
      if (existing) {
        await this.db.insert(spotEpisodes).values({
          id: epId,
          spotId: existing.id,
          mediaCategory: input.mediaCategory,
          description: input.description.trim(),
          referenceUrl: normalizedRef,
          youtubeVideoId,
          videoStartSec,
          members: input.members,
          hashtags: input.hashtags,
          createdBy: createdByUserId,
        });
        return (await this.getSpotById(existing.id))!;
      }
    }

    const spotId = `spot_${crypto.randomUUID().slice(0, 12)}`;
    const lat = Number(input.lat.toFixed(6));
    const lng = Number(input.lng.toFixed(6));

    await this.db.insert(spots).values({
      id: spotId,
      groupId: 'hinatazaka46',
      title: input.title.trim(),
      lat,
      lng,
      location: { x: lng, y: lat },
      prefecture: estimatePrefecture(lat, lng),
      arrivalRadiusMeters: input.arrivalRadiusMeters,
      createdBy: createdByUserId,
    });

    await this.db.insert(spotEpisodes).values({
      id: epId,
      spotId,
      mediaCategory: input.mediaCategory,
      description: input.description.trim(),
      referenceUrl: normalizedRef,
      youtubeVideoId,
      videoStartSec,
      members: input.members,
      hashtags: input.hashtags,
      createdBy: createdByUserId,
    });

    return (await this.getSpotById(spotId))!;
  }

  public async updateSpot(
    spotId: string,
    input: UpdateSpotInput,
  ): Promise<Spot | null> {
    const existing = await this.getSpotById(spotId);
    if (!existing) return null;

    const nextLat = input.lat !== undefined ? Number(input.lat.toFixed(6)) : existing.lat;
    const nextLng = input.lng !== undefined ? Number(input.lng.toFixed(6)) : existing.lng;

    await this.db
      .update(spots)
      .set({
        title: input.title?.trim() ?? existing.title,
        lat: nextLat,
        lng: nextLng,
        location: { x: nextLng, y: nextLat },
        prefecture: estimatePrefecture(nextLat, nextLng),
        arrivalRadiusMeters: input.arrivalRadiusMeters ?? existing.arrivalRadiusMeters,
      })
      .where(eq(spots.id, spotId));

    return this.getSpotById(spotId);
  }

  public async deleteSpot(spotId: string): Promise<boolean> {
    await this.db.delete(spots).where(eq(spots.id, spotId));
    return true;
  }

  public async bulkImportCandidates(
    candidates: RawCandidateEpisode[],
    createdByUserId: string,
  ) {
    const allSpotRows = await this.db.select().from(spots);
    const existingSpots = await this.hydrateSpotsWithEpisodes(allSpotRows);
    const existingSpotIds = new Set(existingSpots.map((s) => s.id));
    const existingEpIds = new Set(
      existingSpots.flatMap((s) => s.episodes.map((e) => e.id)),
    );

    const { spots: mergedSpots, addedSpots, mergedEpisodes } =
      mergeCandidatesIntoSpots(candidates, existingSpots);

    const newSpotRows = mergedSpots.filter((s) => !existingSpotIds.has(s.id));
    const newEpRows = mergedSpots.flatMap((s) =>
      s.episodes.filter((e) => !existingEpIds.has(e.id)),
    );

    const chunkSize = 200;
    for (let i = 0; i < newSpotRows.length; i += chunkSize) {
      const batch = newSpotRows.slice(i, i + chunkSize);
      await this.db.insert(spots).values(
        batch.map((s) => ({
          id: s.id,
          groupId: s.groupId,
          title: s.title,
          lat: s.lat,
          lng: s.lng,
          location: { x: s.lng, y: s.lat },
          prefecture: s.prefecture,
          arrivalRadiusMeters: s.arrivalRadiusMeters,
          createdBy: createdByUserId,
        })),
      );
    }

    for (let i = 0; i < newEpRows.length; i += chunkSize) {
      const batch = newEpRows.slice(i, i + chunkSize);
      await this.db.insert(spotEpisodes).values(
        batch.map((e) => ({
          id: e.id,
          spotId: e.spotId,
          mediaCategory: e.mediaCategory,
          description: e.description,
          referenceUrl: e.referenceUrl,
          youtubeVideoId: e.youtubeVideoId,
          videoStartSec: e.videoStartSec,
          members: e.members,
          hashtags: e.hashtags,
          createdBy: createdByUserId,
        })),
      );
    }

    return {
      totalSpots: mergedSpots.length,
      addedSpots,
      mergedEpisodes,
    };
  }

  public async getUserVisits(userId: string): Promise<Record<string, VisitRecord>> {
    const rows = await this.db
      .select({
        visit: visits,
        spotTitle: spots.title,
        prefecture: spots.prefecture,
      })
      .from(visits)
      .innerJoin(spots, eq(visits.spotId, spots.id))
      .where(eq(visits.userId, userId));

    const map: Record<string, VisitRecord> = {};
    for (const r of rows) {
      map[r.visit.spotId] = {
        id: r.visit.id,
        userId: r.visit.userId,
        spotId: r.visit.spotId,
        spotTitle: r.spotTitle,
        prefecture: r.prefecture,
        status: r.visit.status === 'visited' ? 'visited' : 'give_up',
        selfDiscovered: r.visit.selfDiscovered,
        privateMemo: r.visit.privateMemo ?? undefined,
        hasPrivatePhoto: Boolean(r.visit.privatePhotoR2Key),
        visitedAt: r.visit.visitedAt.toISOString(),
      };
    }
    return map;
  }

  public async recordVisit(params: {
    userId: string;
    spotId: string;
    status: 'visited' | 'give_up';
    selfDiscovered: boolean;
  }): Promise<VisitRecord> {
    const spot = await this.getSpotById(params.spotId);
    if (!spot) throw new Error('Spot not found');

    const [existing] = await this.db
      .select()
      .from(visits)
      .where(and(eq(visits.userId, params.userId), eq(visits.spotId, params.spotId)))
      .limit(1);

    if (existing) {
      const nextStatus =
        existing.status === 'visited' || params.status === 'visited'
          ? 'visited'
          : 'give_up';
      const nextSelf = existing.selfDiscovered || params.selfDiscovered;
      const [updated] = await this.db
        .update(visits)
        .set({ status: nextStatus, selfDiscovered: nextSelf })
        .where(eq(visits.id, existing.id))
        .returning();

      return {
        id: updated!.id,
        userId: updated!.userId,
        spotId: updated!.spotId,
        spotTitle: spot.title,
        prefecture: spot.prefecture,
        status: nextStatus,
        selfDiscovered: nextSelf,
        privateMemo: updated!.privateMemo ?? undefined,
        hasPrivatePhoto: Boolean(updated!.privatePhotoR2Key),
        visitedAt: updated!.visitedAt.toISOString(),
      };
    }

    const id = `vis_${crypto.randomUUID()}`;
    const [created] = await this.db
      .insert(visits)
      .values({
        id,
        userId: params.userId,
        spotId: params.spotId,
        status: params.status,
        selfDiscovered: params.selfDiscovered,
      })
      .returning();

    return {
      id: created!.id,
      userId: created!.userId,
      spotId: created!.spotId,
      spotTitle: spot.title,
      prefecture: spot.prefecture,
      status: params.status,
      selfDiscovered: params.selfDiscovered,
      hasPrivatePhoto: false,
      visitedAt: created!.visitedAt.toISOString(),
    };
  }

  public async updateVisitAlbum(params: {
    userId: string;
    spotId: string;
    privateMemo?: string;
    privatePhotoR2Key?: string;
    privatePhotoMime?: string;
  }): Promise<VisitRecord | null> {
    const [existing] = await this.db
      .select()
      .from(visits)
      .where(and(eq(visits.userId, params.userId), eq(visits.spotId, params.spotId)))
      .limit(1);
    if (!existing) return null;

    const spot = await this.getSpotById(params.spotId);
    if (!spot) return null;

    const [updated] = await this.db
      .update(visits)
      .set({
        privateMemo:
          params.privateMemo !== undefined ? params.privateMemo : existing.privateMemo,
        privatePhotoR2Key:
          params.privatePhotoR2Key !== undefined
            ? params.privatePhotoR2Key
            : existing.privatePhotoR2Key,
        privatePhotoMime:
          params.privatePhotoMime !== undefined
            ? params.privatePhotoMime
            : existing.privatePhotoMime,
      })
      .where(eq(visits.id, existing.id))
      .returning();

    return {
      id: updated!.id,
      userId: updated!.userId,
      spotId: updated!.spotId,
      spotTitle: spot.title,
      prefecture: spot.prefecture,
      status: updated!.status === 'visited' ? 'visited' : 'give_up',
      selfDiscovered: updated!.selfDiscovered,
      privateMemo: updated!.privateMemo ?? undefined,
      hasPrivatePhoto: Boolean(updated!.privatePhotoR2Key),
      visitedAt: updated!.visitedAt.toISOString(),
    };
  }

  public async getVisitPhotoMeta(
    userId: string,
    spotId: string,
  ): Promise<{ r2Key: string; mime: string } | null> {
    const [row] = await this.db
      .select()
      .from(visits)
      .where(and(eq(visits.userId, userId), eq(visits.spotId, spotId)))
      .limit(1);
    if (!row?.privatePhotoR2Key) return null;
    return {
      r2Key: row.privatePhotoR2Key,
      mime: row.privatePhotoMime ?? 'image/jpeg',
    };
  }

  public async getPublicCommentsForSpot(
    spotId: string,
    viewerUserId?: string,
  ): Promise<SpotComment[]> {
    const rows = await this.db
      .select()
      .from(spotComments)
      .where(
        and(
          eq(spotComments.spotId, spotId),
          viewerUserId
            ? or(eq(spotComments.isPublic, true), eq(spotComments.userId, viewerUserId))
            : eq(spotComments.isPublic, true),
        ),
      )
      .orderBy(desc(spotComments.createdAt));

    return rows.map((c) => ({
      id: c.id,
      spotId: c.spotId,
      userId: c.userId ?? undefined,
      authorName: c.authorName,
      content: c.content,
      isPublic: c.isPublic,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  public async addComment(params: {
    spotId: string;
    userId: string;
    authorName: string;
    content: string;
    isPublic: boolean;
  }): Promise<SpotComment> {
    const id = `cmt_${crypto.randomUUID().slice(0, 12)}`;
    const [created] = await this.db
      .insert(spotComments)
      .values({
        id,
        spotId: params.spotId,
        userId: params.userId,
        authorName: params.authorName.trim() || 'おひさま探索者',
        content: params.content.trim(),
        isPublic: params.isPublic,
      })
      .returning();

    return {
      id: created!.id,
      spotId: created!.spotId,
      userId: created!.userId ?? undefined,
      authorName: created!.authorName,
      content: created!.content,
      isPublic: created!.isPublic,
      createdAt: created!.createdAt.toISOString(),
    };
  }

  public async createReport(params: {
    spotId: string;
    reporterUserId: string;
    reason: SpotReportReason;
    detail?: string;
  }): Promise<SpotReport> {
    const id = `rep_${crypto.randomUUID().slice(0, 12)}`;
    const spot = await this.getSpotById(params.spotId);
    const [created] = await this.db
      .insert(spotReports)
      .values({
        id,
        spotId: params.spotId,
        reporterUserId: params.reporterUserId,
        reason: params.reason,
        detail: params.detail?.trim(),
        status: 'open',
      })
      .returning();

    return {
      id: created!.id,
      spotId: created!.spotId,
      spotTitle: spot?.title,
      reporterUserId: created!.reporterUserId,
      reason: created!.reason as SpotReportReason,
      detail: created!.detail ?? undefined,
      status: 'open',
      createdAt: created!.createdAt.toISOString(),
    };
  }

  public async listReports(
    status?: 'open' | 'resolved' | 'dismissed',
  ): Promise<SpotReport[]> {
    const rows = await this.db
      .select({
        report: spotReports,
        spotTitle: spots.title,
      })
      .from(spotReports)
      .leftJoin(spots, eq(spotReports.spotId, spots.id))
      .where(status ? eq(spotReports.status, status) : undefined)
      .orderBy(desc(spotReports.createdAt));

    return rows.map((r) => ({
      id: r.report.id,
      spotId: r.report.spotId,
      spotTitle: r.spotTitle ?? undefined,
      reporterUserId: r.report.reporterUserId,
      reason: r.report.reason as SpotReportReason,
      detail: r.report.detail ?? undefined,
      status: r.report.status as 'open' | 'resolved' | 'dismissed',
      createdAt: r.report.createdAt.toISOString(),
    }));
  }

  public async updateReportStatus(
    reportId: string,
    status: 'resolved' | 'dismissed',
  ): Promise<SpotReport | null> {
    const [updated] = await this.db
      .update(spotReports)
      .set({ status })
      .where(eq(spotReports.id, reportId))
      .returning();
    if (!updated) return null;
    return {
      id: updated.id,
      spotId: updated.spotId,
      reporterUserId: updated.reporterUserId,
      reason: updated.reason as SpotReportReason,
      detail: updated.detail ?? undefined,
      status: updated.status as 'open' | 'resolved' | 'dismissed',
      createdAt: updated.createdAt.toISOString(),
    };
  }
}
