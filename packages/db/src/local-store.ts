import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type AuthUser,
  type CreateSpotInput,
  type ExplorerSettings,
  ExplorerSettingsSchema,
  estimatePrefecture,
  haversineDistanceMeters,
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
import { hashPasswordPbkdf2, verifyPasswordPbkdf2 } from './crypto-password.ts';
import { NeonPostgisRepository } from './neon-repository.ts';
import type {
  PrivateAlbumStorage,
  SeichiRepository,
  StoredPhotoObject,
} from './repository.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.resolve(__dirname, '../seed/hinatazaka-spots.json');
const RUNTIME_DIR = path.resolve(__dirname, '../../../.local-data');
const RUNTIME_SPOTS_PATH = path.join(RUNTIME_DIR, 'spots-runtime.json');
const RUNTIME_STATE_PATH = path.join(RUNTIME_DIR, 'app-state-v2.json');
const LOCAL_R2_DIR = path.join(RUNTIME_DIR, 'r2-album');

interface LocalStoredVisit extends VisitRecord {
  privatePhotoR2Key?: string;
  privatePhotoMime?: string;
}

interface LocalStoredUser extends AuthUser {
  passwordHash?: string;
}

interface LocalAppState {
  users: Record<string, LocalStoredUser>;
  sessions: Record<string, { userId: string; expiresAt: number }>;
  visitsByUser: Record<string, Record<string, LocalStoredVisit>>;
  comments: SpotComment[];
  reports: SpotReport[];
}

const INITIAL_COMMENTS: SpotComment[] = [
  {
    id: 'cmt_seed_1',
    spotId: 'spot_demo_catstreet',
    authorName: 'おひさま1号',
    content:
      'MVのサビと同じアングルで撮れました！朝早めの時間帯だと人が少なくておすすめです☀️',
    isPublic: true,
    createdAt: '2026-10-12T09:15:00.000Z',
  },
];

/**
 * ローカル開発用 PrivateAlbumStorage（本番 Cloudflare R2 と同一インターフェース）
 */
export class LocalFsAlbumStorage implements PrivateAlbumStorage {
  public async putPhoto(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    const safeName = encodeURIComponent(key);
    fs.mkdirSync(LOCAL_R2_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOCAL_R2_DIR, safeName), bytes);
    fs.writeFileSync(
      path.join(LOCAL_R2_DIR, `${safeName}.meta.json`),
      JSON.stringify({ contentType }),
      'utf8',
    );
  }

  public async getPhoto(key: string): Promise<StoredPhotoObject | null> {
    const safeName = encodeURIComponent(key);
    const filePath = path.join(LOCAL_R2_DIR, safeName);
    if (!fs.existsSync(filePath)) return null;
    const bytes = new Uint8Array(fs.readFileSync(filePath));
    let contentType = 'image/jpeg';
    const metaPath = path.join(LOCAL_R2_DIR, `${safeName}.meta.json`);
    if (fs.existsSync(metaPath)) {
      try {
        contentType =
          (JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { contentType?: string })
            .contentType ?? 'image/jpeg';
      } catch {
        // ignore
      }
    }
    return { bytes, contentType };
  }

  public async deletePhoto(key: string): Promise<void> {
    const safeName = encodeURIComponent(key);
    const filePath = path.join(LOCAL_R2_DIR, safeName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

export interface R2LikeBucket {
  put(
    key: string,
    value: Uint8Array | ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(
    key: string,
  ): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<unknown>;
}

/**
 * 本番用 Cloudflare R2 非公開アルバムストレージ実装
 */
export class CloudflareR2AlbumStorage implements PrivateAlbumStorage {
  private readonly bucket: R2LikeBucket;

  constructor(bucket: R2LikeBucket) {
    this.bucket = bucket;
  }

  public async putPhoto(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    await this.bucket.put(key, bytes, {
      httpMetadata: { contentType },
    });
  }

  public async getPhoto(key: string): Promise<StoredPhotoObject | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    const ab = await obj.arrayBuffer();
    return {
      bytes: new Uint8Array(ab),
      contentType: obj.httpMetadata?.contentType ?? 'image/jpeg',
    };
  }

  public async deletePhoto(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}

export class LocalPersistenceRepository implements SeichiRepository {
  private spots: Spot[] | null = null;
  private state: LocalAppState | null = null;

  private ensureLoaded(): void {
    if (this.spots === null) {
      if (fs.existsSync(RUNTIME_SPOTS_PATH)) {
        this.spots = JSON.parse(fs.readFileSync(RUNTIME_SPOTS_PATH, 'utf8')) as Spot[];
      } else if (fs.existsSync(SEED_PATH)) {
        this.spots = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')) as Spot[];
      } else {
        this.spots = [];
      }
    }

    if (this.state === null) {
      if (fs.existsSync(RUNTIME_STATE_PATH)) {
        this.state = JSON.parse(
          fs.readFileSync(RUNTIME_STATE_PATH, 'utf8'),
        ) as LocalAppState;
      } else {
        this.state = {
          users: {},
          sessions: {},
          visitsByUser: {},
          comments: structuredClone(INITIAL_COMMENTS),
          reports: [],
        };
      }
    }
  }

  private persistSpots(): void {
    if (!this.spots) return;
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(RUNTIME_SPOTS_PATH, JSON.stringify(this.spots), 'utf8');
  }

  private persistState(): void {
    if (!this.state) return;
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(RUNTIME_STATE_PATH, JSON.stringify(this.state, null, 2), 'utf8');
  }

  private sanitizeUser(u: LocalStoredUser): AuthUser {
    const { passwordHash: _pw, ...rest } = u;
    return rest;
  }

  public async getUserBySessionToken(token: string): Promise<AuthUser | null> {
    this.ensureLoaded();
    const ses = this.state!.sessions[token];
    if (!ses) return null;
    if (ses.expiresAt < Date.now()) {
      delete this.state!.sessions[token];
      this.persistState();
      return null;
    }
    const u = this.state!.users[ses.userId];
    return u ? this.sanitizeUser(u) : null;
  }

  public async getOrCreateAnonymousUser(
    sessionToken?: string,
  ): Promise<{ user: AuthUser; sessionToken: string }> {
    this.ensureLoaded();
    if (sessionToken) {
      const existing = await this.getUserBySessionToken(sessionToken);
      if (existing) return { user: existing, sessionToken };
    }

    const userId = `usr_${crypto.randomUUID()}`;
    const newToken = `tok_${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, '')}`;
    const defaultSettings = ExplorerSettingsSchema.parse({});
    const user: LocalStoredUser = {
      id: userId,
      name: defaultSettings.nickname,
      email: null,
      isAnonymous: true,
      role: 'user',
      publicProfileStats: true,
      settings: defaultSettings,
      createdAt: new Date().toISOString(),
    };

    this.state!.users[userId] = user;
    this.state!.sessions[newToken] = {
      userId,
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 90,
    };
    this.persistState();
    return { user: this.sanitizeUser(user), sessionToken: newToken };
  }

  public async mergeAnonymousUserData(
    fromGuestUserId: string,
    toUserId: string,
  ): Promise<void> {
    this.ensureLoaded();
    if (fromGuestUserId === toUserId) return;
    const guestVisits = this.state!.visitsByUser[fromGuestUserId] ?? {};
    const targetVisits = (this.state!.visitsByUser[toUserId] ??= {});

    for (const [spotId, gv] of Object.entries(guestVisits)) {
      const ex = targetVisits[spotId];
      if (!ex) {
        targetVisits[spotId] = { ...gv, userId: toUserId };
      } else if (gv.status === 'visited' && ex.status !== 'visited') {
        targetVisits[spotId] = {
          ...ex,
          status: 'visited',
          selfDiscovered: ex.selfDiscovered || gv.selfDiscovered,
          privateMemo: ex.privateMemo ?? gv.privateMemo,
          privatePhotoR2Key: ex.privatePhotoR2Key ?? gv.privatePhotoR2Key,
          privatePhotoMime: ex.privatePhotoMime ?? gv.privatePhotoMime,
          hasPrivatePhoto: Boolean(ex.privatePhotoR2Key ?? gv.privatePhotoR2Key),
        };
      }
    }
    delete this.state!.visitsByUser[fromGuestUserId];

    for (const c of this.state!.comments) {
      if (c.userId === fromGuestUserId) c.userId = toUserId;
    }
    this.persistState();
  }

  public async signUpOrLinkEmail(params: {
    currentSessionToken?: string;
    email: string;
    password: string;
    name: string;
  }): Promise<{ user: AuthUser; sessionToken: string }> {
    this.ensureLoaded();
    const normalizedEmail = params.email.trim().toLowerCase();
    const dup = Object.values(this.state!.users).find(
      (u) => u.email?.toLowerCase() === normalizedEmail,
    );
    if (dup) {
      throw new Error('このメールアドレスは既に登録されています');
    }

    const passwordHash = await hashPasswordPbkdf2(params.password);
    const currentGuest = params.currentSessionToken
      ? await this.getUserBySessionToken(params.currentSessionToken)
      : null;

    if (currentGuest && currentGuest.isAnonymous && params.currentSessionToken) {
      const target = this.state!.users[currentGuest.id]!;
      target.name = params.name.trim();
      target.email = normalizedEmail;
      target.isAnonymous = false;
      target.passwordHash = passwordHash;
      target.settings = { ...target.settings, nickname: params.name.trim() };
      this.persistState();
      return {
        user: this.sanitizeUser(target),
        sessionToken: params.currentSessionToken,
      };
    }

    const userId = `usr_${crypto.randomUUID()}`;
    const token = `tok_${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, '')}`;
    const settings = ExplorerSettingsSchema.parse({ nickname: params.name.trim() });
    const created: LocalStoredUser = {
      id: userId,
      name: params.name.trim(),
      email: normalizedEmail,
      isAnonymous: false,
      role: 'user',
      publicProfileStats: true,
      settings,
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    this.state!.users[userId] = created;
    this.state!.sessions[token] = {
      userId,
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 90,
    };
    this.persistState();
    return { user: this.sanitizeUser(created), sessionToken: token };
  }

  public async signInWithEmail(params: {
    currentSessionToken?: string;
    email: string;
    password: string;
  }): Promise<{ user: AuthUser; sessionToken: string }> {
    this.ensureLoaded();
    const normalizedEmail = params.email.trim().toLowerCase();
    const target = Object.values(this.state!.users).find(
      (u) => u.email?.toLowerCase() === normalizedEmail,
    );
    if (!target?.passwordHash) {
      throw new Error('メールアドレスまたはパスワードが正しくありません');
    }
    const ok = await verifyPasswordPbkdf2(params.password, target.passwordHash);
    if (!ok) {
      throw new Error('メールアドレスまたはパスワードが正しくありません');
    }

    const currentGuest = params.currentSessionToken
      ? await this.getUserBySessionToken(params.currentSessionToken)
      : null;
    if (currentGuest && currentGuest.isAnonymous && currentGuest.id !== target.id) {
      await this.mergeAnonymousUserData(currentGuest.id, target.id);
    }

    const token = `tok_${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, '')}`;
    this.state!.sessions[token] = {
      userId: target.id,
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 90,
    };
    this.persistState();
    return { user: this.sanitizeUser(target), sessionToken: token };
  }

  public async signOutSession(token: string): Promise<void> {
    this.ensureLoaded();
    delete this.state!.sessions[token];
    this.persistState();
  }

  public async updateUserSettings(
    userId: string,
    settings: ExplorerSettings,
  ): Promise<AuthUser> {
    this.ensureLoaded();
    const target = this.state!.users[userId];
    if (!target) throw new Error('User not found');
    target.settings = settings;
    target.name = settings.nickname;
    target.publicProfileStats = settings.publicProfileStats;
    this.persistState();
    return this.sanitizeUser(target);
  }

  public async setUserRoleForDev(
    userId: string,
    role: 'user' | 'admin',
  ): Promise<AuthUser> {
    this.ensureLoaded();
    const target = this.state!.users[userId];
    if (!target) throw new Error('User not found');
    target.role = role;
    this.persistState();
    return this.sanitizeUser(target);
  }

  public async getPublicUserAchievements(
    userId: string,
  ): Promise<PublicUserAchievements | null> {
    this.ensureLoaded();
    const u = this.state!.users[userId];
    if (!u || !u.publicProfileStats) return null;

    const userVisits = Object.values(this.state!.visitsByUser[userId] ?? {}).filter(
      (v) => v.status === 'visited',
    );
    const prefCounts = new Map<string, number>();
    let selfCount = 0;
    for (const v of userVisits) {
      if (v.selfDiscovered) selfCount++;
      prefCounts.set(v.prefecture, (prefCounts.get(v.prefecture) ?? 0) + 1);
    }

    return {
      userId: u.id,
      nickname: u.name,
      visitedCount: userVisits.length,
      selfDiscoveredCount: selfCount,
      prefecturesVisited: prefCounts.size,
      topPrefectures: Array.from(prefCounts.entries())
        .map(([prefecture, count]) => ({ prefecture, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
  }

  public async getMetaSummary() {
    this.ensureLoaded();
    const counts = new Map<string, number>();
    let totalEpisodes = 0;
    for (const s of this.spots!) {
      counts.set(s.prefecture, (counts.get(s.prefecture) ?? 0) + 1);
      totalEpisodes += s.episodes.length;
    }
    return {
      totalSpots: this.spots!.length,
      totalEpisodes,
      prefectures: Array.from(counts.entries())
        .map(([prefecture, totalSpots]) => ({ prefecture, totalSpots }))
        .sort((a, b) => b.totalSpots - a.totalSpots),
    };
  }

  public async getSpotById(spotId: string): Promise<Spot | null> {
    this.ensureLoaded();
    return this.spots!.find((s) => s.id === spotId) ?? null;
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
    this.ensureLoaded();
    const q = params.tagQuery?.trim().toLowerCase();
    const filtered: Array<{ spot: Spot; distanceMeters: number }> = [];

    for (const spot of this.spots!) {
      if (params.prefecture && spot.prefecture !== params.prefecture) continue;
      if (params.member && !spot.episodes.some((ep) => ep.members.includes(params.member!))) {
        continue;
      }
      if (
        params.mediaCategory &&
        !spot.episodes.some((ep) => ep.mediaCategory === params.mediaCategory)
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
        distanceMeters: haversineDistanceMeters(
          params.lat,
          params.lng,
          spot.lat,
          spot.lng,
        ),
      });
    }

    filtered.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return params.limit ? filtered.slice(0, params.limit) : filtered;
  }

  public async findNearbyDuplicates(
    lat: number,
    lng: number,
    withinMeters = 60,
  ): Promise<Array<{ spot: Spot; distanceMeters: number }>> {
    this.ensureLoaded();
    const matches: Array<{ spot: Spot; distanceMeters: number }> = [];
    for (const spot of this.spots!) {
      if (Math.abs(spot.lat - lat) > 0.002 || Math.abs(spot.lng - lng) > 0.002) continue;
      const distanceMeters = haversineDistanceMeters(lat, lng, spot.lat, spot.lng);
      if (distanceMeters <= withinMeters) {
        matches.push({ spot, distanceMeters });
      }
    }
    return matches.sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  public async createOrAppendSpot(
    input: CreateSpotInput,
    createdByUserId: string,
  ): Promise<Spot> {
    this.ensureLoaded();
    let youtubeVideoId: string | undefined;
    let videoStartSec: number | undefined;
    let normalizedRef: string | undefined;

    if (input.referenceUrl && input.referenceUrl.trim() !== '') {
      const validated = validateAndParseReferenceUrl(input.referenceUrl);
      if (!validated.ok) throw new Error(validated.reason);
      normalizedRef = validated.normalizedUrl;
      youtubeVideoId = validated.youtubeVideoId;
      videoStartSec = validated.videoStartSec;
    }

    const nowIso = new Date().toISOString();
    const targetExisting = input.existingSpotId
      ? this.spots!.find((s) => s.id === input.existingSpotId)
      : undefined;

    if (targetExisting) {
      const ep: SpotEpisode = {
        id: `ep_${crypto.randomUUID().slice(0, 12)}`,
        spotId: targetExisting.id,
        mediaCategory: input.mediaCategory,
        description: input.description.trim(),
        referenceUrl: normalizedRef,
        youtubeVideoId,
        videoStartSec,
        members: input.members,
        hashtags: input.hashtags,
        createdBy: createdByUserId,
        createdAt: nowIso,
      };
      targetExisting.episodes.unshift(ep);
      this.persistSpots();
      return targetExisting;
    }

    const spotId = `spot_${crypto.randomUUID().slice(0, 12)}`;
    const newSpot: Spot = {
      id: spotId,
      groupId: 'hinatazaka46',
      title: input.title.trim(),
      lat: Number(input.lat.toFixed(6)),
      lng: Number(input.lng.toFixed(6)),
      prefecture: estimatePrefecture(input.lat, input.lng),
      arrivalRadiusMeters: input.arrivalRadiusMeters,
      episodes: [
        {
          id: `ep_${crypto.randomUUID().slice(0, 12)}`,
          spotId,
          mediaCategory: input.mediaCategory,
          description: input.description.trim(),
          referenceUrl: normalizedRef,
          youtubeVideoId,
          videoStartSec,
          members: input.members,
          hashtags: input.hashtags,
          createdBy: createdByUserId,
          createdAt: nowIso,
        },
      ],
      createdAt: nowIso,
    };

    this.spots!.unshift(newSpot);
    this.persistSpots();
    return newSpot;
  }

  public async updateSpot(
    spotId: string,
    input: UpdateSpotInput,
  ): Promise<Spot | null> {
    this.ensureLoaded();
    const target = this.spots!.find((s) => s.id === spotId);
    if (!target) return null;
    if (input.title !== undefined) target.title = input.title.trim();
    if (input.lat !== undefined) target.lat = Number(input.lat.toFixed(6));
    if (input.lng !== undefined) target.lng = Number(input.lng.toFixed(6));
    target.prefecture = estimatePrefecture(target.lat, target.lng);
    if (input.arrivalRadiusMeters !== undefined) {
      target.arrivalRadiusMeters = input.arrivalRadiusMeters;
    }
    this.persistSpots();
    return target;
  }

  public async deleteSpot(spotId: string): Promise<boolean> {
    this.ensureLoaded();
    const before = this.spots!.length;
    this.spots = this.spots!.filter((s) => s.id !== spotId);
    if (this.spots.length === before) return false;
    this.persistSpots();
    return true;
  }

  public async bulkImportCandidates(
    candidates: RawCandidateEpisode[],
  ) {
    this.ensureLoaded();
    const { spots, addedSpots, mergedEpisodes } = mergeCandidatesIntoSpots(
      candidates,
      this.spots!,
    );
    this.spots = spots;
    this.persistSpots();
    return {
      totalSpots: spots.length,
      addedSpots,
      mergedEpisodes,
    };
  }

  public async getUserVisits(userId: string): Promise<Record<string, VisitRecord>> {
    this.ensureLoaded();
    const raw = this.state!.visitsByUser[userId] ?? {};
    const out: Record<string, VisitRecord> = {};
    for (const [spotId, v] of Object.entries(raw)) {
      out[spotId] = {
        id: v.id,
        userId: v.userId,
        spotId: v.spotId,
        spotTitle: v.spotTitle,
        prefecture: v.prefecture,
        status: v.status,
        selfDiscovered: v.selfDiscovered,
        privateMemo: v.privateMemo,
        hasPrivatePhoto: Boolean(v.privatePhotoR2Key),
        visitedAt: v.visitedAt,
      };
    }
    return out;
  }

  public async recordVisit(params: {
    userId: string;
    spotId: string;
    status: 'visited' | 'give_up';
    selfDiscovered: boolean;
  }): Promise<VisitRecord> {
    this.ensureLoaded();
    const spot = await this.getSpotById(params.spotId);
    if (!spot) throw new Error('Spot not found');

    const userMap = (this.state!.visitsByUser[params.userId] ??= {});
    const existing = userMap[params.spotId];

    if (existing) {
      if (params.status === 'visited') existing.status = 'visited';
      if (params.selfDiscovered) existing.selfDiscovered = true;
      this.persistState();
      return {
        id: existing.id,
        userId: existing.userId,
        spotId: existing.spotId,
        spotTitle: existing.spotTitle,
        prefecture: existing.prefecture,
        status: existing.status,
        selfDiscovered: existing.selfDiscovered,
        privateMemo: existing.privateMemo,
        hasPrivatePhoto: Boolean(existing.privatePhotoR2Key),
        visitedAt: existing.visitedAt,
      };
    }

    const created: LocalStoredVisit = {
      id: `vis_${crypto.randomUUID()}`,
      userId: params.userId,
      spotId: params.spotId,
      spotTitle: spot.title,
      prefecture: spot.prefecture,
      status: params.status,
      selfDiscovered: params.selfDiscovered,
      hasPrivatePhoto: false,
      visitedAt: new Date().toISOString(),
    };
    userMap[params.spotId] = created;
    this.persistState();
    return created;
  }

  public async updateVisitAlbum(params: {
    userId: string;
    spotId: string;
    privateMemo?: string;
    privatePhotoR2Key?: string;
    privatePhotoMime?: string;
  }): Promise<VisitRecord | null> {
    this.ensureLoaded();
    const userMap = this.state!.visitsByUser[params.userId];
    const target = userMap?.[params.spotId];
    if (!target) return null;

    if (params.privateMemo !== undefined) target.privateMemo = params.privateMemo;
    if (params.privatePhotoR2Key !== undefined) {
      target.privatePhotoR2Key = params.privatePhotoR2Key;
      target.hasPrivatePhoto = Boolean(params.privatePhotoR2Key);
    }
    if (params.privatePhotoMime !== undefined) {
      target.privatePhotoMime = params.privatePhotoMime;
    }
    this.persistState();
    return {
      id: target.id,
      userId: target.userId,
      spotId: target.spotId,
      spotTitle: target.spotTitle,
      prefecture: target.prefecture,
      status: target.status,
      selfDiscovered: target.selfDiscovered,
      privateMemo: target.privateMemo,
      hasPrivatePhoto: Boolean(target.privatePhotoR2Key),
      visitedAt: target.visitedAt,
    };
  }

  public async getVisitPhotoMeta(
    userId: string,
    spotId: string,
  ): Promise<{ r2Key: string; mime: string } | null> {
    this.ensureLoaded();
    const target = this.state!.visitsByUser[userId]?.[spotId];
    if (!target?.privatePhotoR2Key) return null;
    return {
      r2Key: target.privatePhotoR2Key,
      mime: target.privatePhotoMime ?? 'image/jpeg',
    };
  }

  public async getPublicCommentsForSpot(
    spotId: string,
    viewerUserId?: string,
  ): Promise<SpotComment[]> {
    this.ensureLoaded();
    return this.state!.comments.filter(
      (c) =>
        c.spotId === spotId &&
        (c.isPublic || (viewerUserId !== undefined && c.userId === viewerUserId)),
    ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public async addComment(params: {
    spotId: string;
    userId: string;
    authorName: string;
    content: string;
    isPublic: boolean;
  }): Promise<SpotComment> {
    this.ensureLoaded();
    const comment: SpotComment = {
      id: `cmt_${crypto.randomUUID().slice(0, 12)}`,
      spotId: params.spotId,
      userId: params.userId,
      authorName: params.authorName.trim() || 'おひさま探索者',
      content: params.content.trim(),
      isPublic: params.isPublic,
      createdAt: new Date().toISOString(),
    };
    this.state!.comments.unshift(comment);
    this.persistState();
    return comment;
  }

  public async createReport(params: {
    spotId: string;
    reporterUserId: string;
    reason: SpotReportReason;
    detail?: string;
  }): Promise<SpotReport> {
    this.ensureLoaded();
    const spot = await this.getSpotById(params.spotId);
    const report: SpotReport = {
      id: `rep_${crypto.randomUUID().slice(0, 12)}`,
      spotId: params.spotId,
      spotTitle: spot?.title,
      reporterUserId: params.reporterUserId,
      reason: params.reason,
      detail: params.detail?.trim(),
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    this.state!.reports.unshift(report);
    this.persistState();
    return report;
  }

  public async listReports(
    status?: 'open' | 'resolved' | 'dismissed',
  ): Promise<SpotReport[]> {
    this.ensureLoaded();
    return this.state!.reports.filter((r) => !status || r.status === status);
  }

  public async updateReportStatus(
    reportId: string,
    status: 'resolved' | 'dismissed',
  ): Promise<SpotReport | null> {
    this.ensureLoaded();
    const target = this.state!.reports.find((r) => r.id === reportId);
    if (!target) return null;
    target.status = status;
    this.persistState();
    return target;
  }
}

const singletonLocalRepo = new LocalPersistenceRepository();
const singletonLocalAlbum = new LocalFsAlbumStorage();

/**
 * DATABASE_URL が設定されていれば本番 Neon PostGIS リポジトリ、未設定ならローカル永続リポジトリを返す
 */
export function resolveRepository(databaseUrl?: string): SeichiRepository {
  if (databaseUrl && databaseUrl.trim().startsWith('postgres')) {
    return new NeonPostgisRepository(databaseUrl.trim());
  }
  return singletonLocalRepo;
}

export function resolveAlbumStorage(r2Bucket?: R2LikeBucket): PrivateAlbumStorage {
  if (r2Bucket) {
    return new CloudflareR2AlbumStorage(r2Bucket);
  }
  return singletonLocalAlbum;
}
