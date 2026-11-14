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

function getLocalPaths() {
  const baseDir =
    typeof import.meta?.url === 'string' && import.meta.url.startsWith('file:')
      ? path.dirname(fileURLToPath(import.meta.url))
      : process.cwd();
  const runtimeDir = path.resolve(baseDir, '../../../.local-data');
  return {
    seedPath: path.resolve(baseDir, '../seed/hinatazaka-spots.json'),
    runtimeDir,
    runtimeSpotsPath: path.join(runtimeDir, 'spots-runtime.json'),
    runtimeStatePath: path.join(runtimeDir, 'app-state-v2.json'),
    localR2Dir: path.join(runtimeDir, 'r2-album'),
  };
}

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
    spotId: 'spot_gme98q_0',
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
    const { localR2Dir } = getLocalPaths();
    const safeName = encodeURIComponent(key);
    fs.mkdirSync(localR2Dir, { recursive: true });
    fs.writeFileSync(path.join(localR2Dir, safeName), bytes);
    fs.writeFileSync(
      path.join(localR2Dir, `${safeName}.meta.json`),
      JSON.stringify({ contentType }),
      'utf8',
    );
  }

  public async getPhoto(key: string): Promise<StoredPhotoObject | null> {
    const { localR2Dir } = getLocalPaths();
    const safeName = encodeURIComponent(key);
    const filePath = path.join(localR2Dir, safeName);
    if (!fs.existsSync(filePath)) return null;
    const bytes = new Uint8Array(fs.readFileSync(filePath));
    let contentType = 'image/jpeg';
    const metaPath = path.join(localR2Dir, `${safeName}.meta.json`);
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
    const { localR2Dir } = getLocalPaths();
    const safeName = encodeURIComponent(key);
    const filePath = path.join(localR2Dir, safeName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const metaPath = path.join(localR2Dir, `${safeName}.meta.json`);
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
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

export interface R2S3Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return bytesToHex(new Uint8Array(hash));
}

async function hmacSha256(
  key: Uint8Array | string,
  message: string,
): Promise<Uint8Array> {
  const keyBytes =
    typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(message),
  );
  return new Uint8Array(sig);
}

/**
 * Vercel / Node.js 環境から Cloudflare R2 S3互換APIへ接続するストレージ実装（AWS SigV4 署名・外部SDK依存なし）
 */
export class CloudflareR2S3AlbumStorage implements PrivateAlbumStorage {
  private readonly cfg: R2S3Config;

  constructor(cfg: R2S3Config) {
    this.cfg = cfg;
  }

  private async signedFetch(
    method: 'PUT' | 'GET' | 'DELETE',
    objectKey: string,
    body?: Uint8Array,
    contentType?: string,
  ): Promise<Response> {
    const host = `${this.cfg.accountId}.r2.cloudflarestorage.com`;
    const encodedKey = objectKey
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    const canonicalUri = `/${encodeURIComponent(this.cfg.bucketName)}/${encodedKey}`;
    const url = `https://${host}${canonicalUri}`;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const region = 'auto';
    const service = 's3';

    const payloadHash = await sha256Hex(body ?? '');
    const headersRecord: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (contentType) {
      headersRecord['content-type'] = contentType;
    }

    const sortedHeaderKeys = Object.keys(headersRecord).sort();
    const canonicalHeaders = sortedHeaderKeys
      .map((k) => `${k}:${headersRecord[k]}\n`)
      .join('');
    const signedHeaders = sortedHeaderKeys.join(';');

    const canonicalRequest = [
      method,
      canonicalUri,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      await sha256Hex(canonicalRequest),
    ].join('\n');

    const kDate = await hmacSha256(
      `AWS4${this.cfg.secretAccessKey}`,
      dateStamp,
    );
    const kRegion = await hmacSha256(kDate, region);
    const kService = await hmacSha256(kRegion, service);
    const kSigning = await hmacSha256(kService, 'aws4_request');
    const signature = bytesToHex(await hmacSha256(kSigning, stringToSign));

    const authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return fetch(url, {
      method,
      headers: {
        ...headersRecord,
        Authorization: authorization,
      },
      body: body ? (body as BodyInit) : undefined,
      signal: AbortSignal.timeout(10000),
    });
  }

  public async putPhoto(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    const res = await this.signedFetch('PUT', key, bytes, contentType);
    if (!res.ok) {
      throw new Error(`R2 S3 PUT failed with status ${res.status}`);
    }
  }

  public async getPhoto(key: string): Promise<StoredPhotoObject | null> {
    const res = await this.signedFetch('GET', key);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`R2 S3 GET failed with status ${res.status}`);
    }
    const ab = await res.arrayBuffer();
    return {
      bytes: new Uint8Array(ab),
      contentType: res.headers.get('content-type') ?? 'image/jpeg',
    };
  }

  public async deletePhoto(key: string): Promise<void> {
    await this.signedFetch('DELETE', key).catch(() => {});
  }
}

export class LocalPersistenceRepository implements SeichiRepository {
  private spots: Spot[] | null = null;
  private state: LocalAppState | null = null;

  private ensureLoaded(): void {
    const { seedPath, runtimeSpotsPath, runtimeStatePath } = getLocalPaths();
    if (this.spots === null) {
      if (fs.existsSync(runtimeSpotsPath)) {
        this.spots = JSON.parse(fs.readFileSync(runtimeSpotsPath, 'utf8')) as Spot[];
      } else if (fs.existsSync(seedPath)) {
        this.spots = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as Spot[];
      } else {
        this.spots = [];
      }
    }

    if (this.state === null) {
      if (fs.existsSync(runtimeStatePath)) {
        this.state = JSON.parse(
          fs.readFileSync(runtimeStatePath, 'utf8'),
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
    const { runtimeDir, runtimeSpotsPath } = getLocalPaths();
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(runtimeSpotsPath, JSON.stringify(this.spots), 'utf8');
  }

  private persistState(): void {
    if (!this.state) return;
    const { runtimeDir, runtimeStatePath } = getLocalPaths();
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(runtimeStatePath, JSON.stringify(this.state, null, 2), 'utf8');
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
  ): Promise<{ r2KeysToDelete: string[] }> {
    this.ensureLoaded();
    if (fromGuestUserId === toUserId) return { r2KeysToDelete: [] };
    const guestVisits = this.state!.visitsByUser[fromGuestUserId] ?? {};
    const targetVisits = (this.state!.visitsByUser[toUserId] ??= {});
    const r2KeysToDelete: string[] = [];

    for (const [spotId, gv] of Object.entries(guestVisits)) {
      const ex = targetVisits[spotId];
      if (!ex) {
        targetVisits[spotId] = { ...gv, userId: toUserId };
      } else {
        if (
          ex.privatePhotoR2Key &&
          gv.privatePhotoR2Key &&
          ex.privatePhotoR2Key !== gv.privatePhotoR2Key
        ) {
          r2KeysToDelete.push(gv.privatePhotoR2Key);
        }
        const nextStatus =
          gv.status === 'visited' || ex.status === 'visited' ? 'visited' : 'give_up';
        targetVisits[spotId] = {
          ...ex,
          status: nextStatus,
          selfDiscovered: ex.selfDiscovered || gv.selfDiscovered,
          privateMemo: ex.privateMemo ?? gv.privateMemo,
          privatePhotoR2Key: ex.privatePhotoR2Key ?? gv.privatePhotoR2Key,
          privatePhotoMime: ex.privatePhotoMime ?? gv.privatePhotoMime,
          hasPrivatePhoto: Boolean(ex.privatePhotoR2Key ?? gv.privatePhotoR2Key),
        };
      }
    }
    delete this.state!.visitsByUser[fromGuestUserId];
    if (this.state!.users[fromGuestUserId]?.isAnonymous) {
      delete this.state!.users[fromGuestUserId];
    }

    for (const c of this.state!.comments) {
      if (c.userId === fromGuestUserId) c.userId = toUserId;
    }
    for (const r of this.state!.reports) {
      if (r.reporterUserId === fromGuestUserId) r.reporterUserId = toUserId;
    }
    this.persistState();
    return { r2KeysToDelete };
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
  }): Promise<{
    user: AuthUser;
    sessionToken: string;
    r2KeysToDelete?: string[];
  }> {
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

    let r2KeysToDelete: string[] = [];
    const currentGuest = params.currentSessionToken
      ? await this.getUserBySessionToken(params.currentSessionToken)
      : null;
    if (currentGuest && currentGuest.isAnonymous && currentGuest.id !== target.id) {
      const merged = await this.mergeAnonymousUserData(currentGuest.id, target.id);
      r2KeysToDelete = merged.r2KeysToDelete;
    }

    const token = `tok_${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, '')}`;
    this.state!.sessions[token] = {
      userId: target.id,
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 90,
    };
    this.persistState();
    return { user: this.sanitizeUser(target), sessionToken: token, r2KeysToDelete };
  }

  public async signOutSession(token: string): Promise<void> {
    this.ensureLoaded();
    delete this.state!.sessions[token];
    this.persistState();
  }

  public async issueSessionForUser(
    userId: string,
  ): Promise<{ user: AuthUser; sessionToken: string } | null> {
    this.ensureLoaded();
    const target = this.state!.users[userId];
    if (!target) return null;
    const token = `tok_${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, '')}`;
    this.state!.sessions[token] = {
      userId: target.id,
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 90,
    };
    this.persistState();
    return { user: this.sanitizeUser(target), sessionToken: token };
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
    members?: string[];
    mediaCategory?: MediaCategory;
    prefecture?: string;
    tagQuery?: string;
    limit?: number;
  }): Promise<Array<{ spot: Spot; distanceMeters: number }>> {
    this.ensureLoaded();
    const q = params.tagQuery?.trim().toLowerCase();
    const memberFilterList = params.members?.length
      ? params.members
      : params.member
        ? [params.member]
        : [];
    const filtered: Array<{ spot: Spot; distanceMeters: number }> = [];

    for (const spot of this.spots!) {
      if (params.prefecture && spot.prefecture !== params.prefecture) continue;
      if (
        memberFilterList.length > 0 &&
        !spot.episodes.some((ep) =>
          ep.members.some((m) => memberFilterList.includes(m)),
        )
      ) {
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

  public async deleteSpot(
    spotId: string,
  ): Promise<{ deleted: boolean; r2KeysToDelete: string[] }> {
    this.ensureLoaded();
    const before = this.spots!.length;
    this.spots = this.spots!.filter((s) => s.id !== spotId);
    if (this.spots.length === before) {
      return { deleted: false, r2KeysToDelete: [] };
    }

    const r2KeysToDelete: string[] = [];
    for (const userVisits of Object.values(this.state!.visitsByUser)) {
      const visit = userVisits[spotId];
      if (visit?.privatePhotoR2Key) {
        r2KeysToDelete.push(visit.privatePhotoR2Key);
      }
      delete userVisits[spotId];
    }
    this.state!.comments = this.state!.comments.filter((c) => c.spotId !== spotId);
    this.state!.reports = this.state!.reports.filter((r) => r.spotId !== spotId);

    this.persistSpots();
    this.persistState();
    return { deleted: true, r2KeysToDelete };
  }

  public async deleteEpisode(
    spotId: string,
    episodeId: string,
  ): Promise<Spot | null> {
    this.ensureLoaded();
    const target = this.spots!.find((s) => s.id === spotId);
    if (!target) return null;
    if (!target.episodes.some((e) => e.id === episodeId)) return null;
    if (target.episodes.length <= 1) {
      throw new Error(
        '最後の1エピソードは個別削除できません（スポット自体を削除するか編集してください）',
      );
    }
    target.episodes = target.episodes.filter((e) => e.id !== episodeId);
    this.persistSpots();
    return target;
  }

  public async deleteComment(
    spotId: string,
    commentId: string,
  ): Promise<boolean> {
    this.ensureLoaded();
    const before = this.state!.comments.length;
    this.state!.comments = this.state!.comments.filter(
      (c) => !(c.spotId === spotId && c.id === commentId),
    );
    if (this.state!.comments.length === before) return false;
    this.persistState();
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

let singletonLocalRepo: LocalPersistenceRepository | null = null;
let singletonLocalAlbum: LocalFsAlbumStorage | null = null;

function isLiveProductionRuntime(): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  if (process.env.NEXT_PHASE === 'phase-production-build') return false;
  return (
    process.env.NODE_ENV === 'production' &&
    (process.env.VERCEL === '1' ||
      process.env.CF_PAGES === '1' ||
      process.env.REQUIRE_PROD_STORAGE === 'true')
  );
}

/**
 * DATABASE_URL が設定されていれば本番 Neon PostGIS リポジトリ、未設定ならローカル永続リポジトリを返す
 * 本番クラウド環境（Vercel / Cloudflare 等）で DATABASE_URL が未設定の場合はフェイルクローズで例外を送出する
 */
export function resolveRepository(databaseUrl?: string): SeichiRepository {
  if (databaseUrl && databaseUrl.trim().startsWith('postgres')) {
    return new NeonPostgisRepository(databaseUrl.trim());
  }
  if (isLiveProductionRuntime()) {
    throw new Error(
      '本番環境では DATABASE_URL (Neon PostgreSQL) の設定が必須です（ローカルFSへのフォールバックは禁止されています）',
    );
  }
  singletonLocalRepo ??= new LocalPersistenceRepository();
  return singletonLocalRepo;
}

export function resolveAlbumStorage(
  r2Bucket?: R2LikeBucket,
  r2S3Config?: Partial<R2S3Config>,
): PrivateAlbumStorage {
  if (r2Bucket) {
    return new CloudflareR2AlbumStorage(r2Bucket);
  }
  const accountId =
    r2S3Config?.accountId ??
    (typeof process !== 'undefined' ? process.env?.R2_ACCOUNT_ID : undefined);
  const accessKeyId =
    r2S3Config?.accessKeyId ??
    (typeof process !== 'undefined' ? process.env?.R2_ACCESS_KEY_ID : undefined);
  const secretAccessKey =
    r2S3Config?.secretAccessKey ??
    (typeof process !== 'undefined'
      ? process.env?.R2_SECRET_ACCESS_KEY
      : undefined);
  const bucketName =
    r2S3Config?.bucketName ??
    (typeof process !== 'undefined' ? process.env?.R2_BUCKET_NAME : undefined);

  if (accountId && accessKeyId && secretAccessKey && bucketName) {
    return new CloudflareR2S3AlbumStorage({
      accountId: accountId.trim(),
      accessKeyId: accessKeyId.trim(),
      secretAccessKey: secretAccessKey.trim(),
      bucketName: bucketName.trim(),
    });
  }

  if (isLiveProductionRuntime()) {
    throw new Error(
      '本番環境で非公開アルバム写真を使用するには Cloudflare R2 バインディング (ALBUM_BUCKET) または R2 S3 環境変数 (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME) の設定が必要です',
    );
  }

  singletonLocalAlbum ??= new LocalFsAlbumStorage();
  return singletonLocalAlbum;
}
