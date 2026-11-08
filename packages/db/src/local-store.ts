import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CreateSpotInput,
  estimatePrefecture,
  haversineDistanceMeters,
  type MediaCategory,
  mergeCandidatesIntoSpots,
  type RawCandidateEpisode,
  type Spot,
  type SpotComment,
  type SpotEpisode,
  validateAndParseReferenceUrl,
} from '@seichi/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.resolve(__dirname, '../seed/hinatazaka-spots.json');
const RUNTIME_DIR = path.resolve(__dirname, '../../../.local-data');
const RUNTIME_SPOTS_PATH = path.join(RUNTIME_DIR, 'spots-runtime.json');
const RUNTIME_COMMENTS_PATH = path.join(RUNTIME_DIR, 'comments-runtime.json');

const BUILTIN_FALLBACK_SPOTS: Spot[] = [
  {
    id: 'spot_demo_catstreet',
    groupId: 'hinatazaka46',
    title: 'キャットストリート',
    lat: 35.665242,
    lng: 139.705812,
    prefecture: '東京都',
    arrivalRadiusMeters: 80,
    episodes: [
      {
        id: 'ep_demo_catstreet_1',
        spotId: 'spot_demo_catstreet',
        mediaCategory: 'mv',
        description: '4thシングル『ソンナコトナイヨ』のMV（2:22〜）でメンバー全員が踊っている渋谷・原宿間の遊歩道。',
        referenceUrl: 'https://youtu.be/7njC5lgL61c?t=142',
        youtubeVideoId: '7njC5lgL61c',
        videoStartSec: 142,
        members: ['小坂菜緒', '加藤史帆', '齊藤京子', '金村美玖', '東村芽依'],
        hashtags: ['MV', 'ソンナコトナイヨ'],
        createdBy: 'system',
        createdAt: '2024-01-24T00:00:00.000Z',
      },
    ],
    createdAt: '2024-01-24T00:00:00.000Z',
  },
];

const INITIAL_COMMENTS: SpotComment[] = [
  {
    id: 'cmt_seed_1',
    spotId: 'spot_demo_catstreet',
    authorName: 'おひさま1号',
    content: 'MVのサビと同じアングルで撮れました！朝早めの時間帯だと人が少なくておすすめです☀️',
    isPublic: true,
    createdAt: '2026-10-12T09:15:00.000Z',
  },
];

class LocalSpotStore {
  private spots: Spot[] | null = null;
  private comments: SpotComment[] | null = null;

  private ensureLoaded(): void {
    if (this.spots !== null && this.comments !== null) return;

    if (fs.existsSync(RUNTIME_SPOTS_PATH)) {
      this.spots = JSON.parse(fs.readFileSync(RUNTIME_SPOTS_PATH, 'utf8')) as Spot[];
    } else if (fs.existsSync(SEED_PATH)) {
      this.spots = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')) as Spot[];
    } else {
      this.spots = structuredClone(BUILTIN_FALLBACK_SPOTS);
    }

    if (fs.existsSync(RUNTIME_COMMENTS_PATH)) {
      this.comments = JSON.parse(fs.readFileSync(RUNTIME_COMMENTS_PATH, 'utf8')) as SpotComment[];
    } else {
      this.comments = structuredClone(INITIAL_COMMENTS);
    }
  }

  private persistSpots(): void {
    if (!this.spots) return;
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(RUNTIME_SPOTS_PATH, JSON.stringify(this.spots), 'utf8');
  }

  private persistComments(): void {
    if (!this.comments) return;
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(RUNTIME_COMMENTS_PATH, JSON.stringify(this.comments, null, 2), 'utf8');
  }

  public getAllSpots(): Spot[] {
    this.ensureLoaded();
    return this.spots!;
  }

  public getSpotById(id: string): Spot | undefined {
    this.ensureLoaded();
    return this.spots!.find((s) => s.id === id);
  }

  public querySpots(params: {
    lat: number;
    lng: number;
    member?: string;
    mediaCategory?: MediaCategory;
    prefecture?: string;
    tagQuery?: string;
    limit?: number;
  }): Array<{ spot: Spot; distanceMeters: number }> {
    this.ensureLoaded();
    const q = params.tagQuery?.trim().toLowerCase();

    const filtered: Array<{ spot: Spot; distanceMeters: number }> = [];
    for (const spot of this.spots!) {
      if (params.prefecture && spot.prefecture !== params.prefecture) {
        continue;
      }
      if (params.member) {
        const hasMember = spot.episodes.some((ep) => ep.members.includes(params.member!));
        if (!hasMember) continue;
      }
      if (params.mediaCategory) {
        const hasCat = spot.episodes.some((ep) => ep.mediaCategory === params.mediaCategory);
        if (!hasCat) continue;
      }
      if (q) {
        const matchTagOrPref =
          spot.prefecture.toLowerCase().includes(q) ||
          spot.episodes.some(
            (ep) =>
              ep.hashtags.some((h) => h.toLowerCase().includes(q)) ||
              ep.members.some((m) => m.toLowerCase().includes(q)),
          );
        if (!matchTagOrPref) continue;
      }

      const distanceMeters = haversineDistanceMeters(
        params.lat,
        params.lng,
        spot.lat,
        spot.lng,
      );
      filtered.push({ spot, distanceMeters });
    }

    filtered.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return params.limit ? filtered.slice(0, params.limit) : filtered;
  }

  /**
   * 新規登録時の重複防止：指定座標から半径 withinMeters 以内の既存スポットを検索
   */
  public findNearbyDuplicates(
    lat: number,
    lng: number,
    withinMeters = 60,
  ): Array<{ spot: Spot; distanceMeters: number }> {
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

  public createOrAppendSpot(input: CreateSpotInput, createdBy = 'user'): Spot {
    this.ensureLoaded();
    let youtubeVideoId: string | undefined;
    let videoStartSec: number | undefined;
    let normalizedRef: string | undefined;

    if (input.referenceUrl && input.referenceUrl.trim() !== '') {
      const validated = validateAndParseReferenceUrl(input.referenceUrl);
      if (!validated.ok) {
        throw new Error(validated.reason);
      }
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
        id: `ep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        spotId: targetExisting.id,
        mediaCategory: input.mediaCategory,
        description: input.description,
        referenceUrl: normalizedRef,
        youtubeVideoId,
        videoStartSec,
        members: input.members,
        hashtags: input.hashtags,
        createdBy,
        createdAt: nowIso,
      };
      targetExisting.episodes.unshift(ep);
      this.persistSpots();
      return targetExisting;
    }

    const spotId = `spot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
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
          id: `ep_${Date.now().toString(36)}_1`,
          spotId,
          mediaCategory: input.mediaCategory,
          description: input.description.trim(),
          referenceUrl: normalizedRef,
          youtubeVideoId,
          videoStartSec,
          members: input.members,
          hashtags: input.hashtags,
          createdBy,
          createdAt: nowIso,
        },
      ],
      createdAt: nowIso,
    };

    this.spots!.unshift(newSpot);
    this.persistSpots();
    return newSpot;
  }

  public bulkImportCandidates(candidates: RawCandidateEpisode[]): {
    totalSpots: number;
    addedSpots: number;
    mergedEpisodes: number;
  } {
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

  public getPrefectureSummary(): Array<{ prefecture: string; totalSpots: number }> {
    this.ensureLoaded();
    const counts = new Map<string, number>();
    for (const s of this.spots!) {
      counts.set(s.prefecture, (counts.get(s.prefecture) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([prefecture, totalSpots]) => ({ prefecture, totalSpots }))
      .sort((a, b) => b.totalSpots - a.totalSpots);
  }

  public getPublicCommentsForSpot(spotId: string): SpotComment[] {
    this.ensureLoaded();
    return this.comments!
      .filter((c) => c.spotId === spotId && c.isPublic)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public addComment(input: {
    spotId: string;
    authorName: string;
    content: string;
    isPublic: boolean;
  }): SpotComment {
    this.ensureLoaded();
    const comment: SpotComment = {
      id: `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      spotId: input.spotId,
      authorName: input.authorName.trim() || 'おひさま探索者',
      content: input.content.trim(),
      isPublic: input.isPublic,
      createdAt: new Date().toISOString(),
    };
    this.comments!.unshift(comment);
    this.persistComments();
    return comment;
  }
}

export const localSpotStore = new LocalSpotStore();
