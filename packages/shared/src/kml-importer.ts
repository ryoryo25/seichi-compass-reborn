import { estimatePrefecture, haversineDistanceMeters } from './geo.ts';
import { hashStringToSeed } from './masking.ts';
import { extractMembersFromText } from './members.ts';
import type { MediaCategory, Spot, SpotEpisode } from './schemas.ts';
import { parseGoogleMapsUrl, validateAndParseReferenceUrl } from './url-parser.ts';

function decodeXmlEntities(str: string): string {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function mapFolderToCategory(folderName: string): {
  category: MediaCategory;
  defaultHashtags: string[];
} {
  if (folderName.includes('ロケ地') || folderName.includes('MV')) {
    return { category: 'mv', defaultHashtags: ['MV'] };
  }
  if (folderName.includes('ヒット祈願')) {
    return { category: 'hit_prayer', defaultHashtags: ['ヒット祈願'] };
  }
  if (folderName.includes('特典映像')) {
    return { category: 'bonus_video', defaultHashtags: ['特典映像'] };
  }
  if (folderName.includes('ひなあい')) {
    return { category: 'hinaai', defaultHashtags: ['ひなあい'] };
  }
  if (folderName.includes('写真集')) {
    return { category: 'photobook', defaultHashtags: ['写真集'] };
  }
  if (folderName.includes('ライブ') || folderName.includes('舞台')) {
    return { category: 'live_stage', defaultHashtags: ['ライブ'] };
  }
  if (folderName.includes('ちゃんねる') || folderName.toLowerCase().includes('youtube')) {
    return { category: 'youtube', defaultHashtags: ['日向坂ちゃんねる'] };
  }
  if (folderName.includes('ブログ') || folderName.includes('SNS')) {
    return { category: 'blog_sns', defaultHashtags: ['ブログ'] };
  }
  if (
    folderName.includes('映画') ||
    folderName.includes('ドラマ') ||
    folderName.includes('TV') ||
    folderName.includes('雑誌')
  ) {
    return { category: 'tv_magazine', defaultHashtags: [] };
  }
  return { category: 'other', defaultHashtags: [] };
}

function estimateArrivalRadius(title: string): number {
  if (/(ドーム|スタジアム|アリーナ|メッセ|国際展示場|空港|遊園地|ランド|スキー場)/.test(title)) {
    return 180;
  }
  if (/(公園|神社|寺|海岸|ビーチ|大学|体育館|駅)/.test(title)) {
    return 110;
  }
  return 80;
}

function normalizeTitleForDedup(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　・()（）「」『』\-ー]/g, '');
}

function extractCleanDescriptionAndUrl(
  rawDesc: string,
  extraMediaLinks: string,
): {
  description: string;
  referenceUrl?: string;
  youtubeVideoId?: string;
  videoStartSec?: number;
} {
  const combinedForUrls = `${rawDesc} ${extraMediaLinks}`;
  const rawUrls = combinedForUrls.match(/https?:\/\/[^\s"'<>]+/g) ?? [];

  let chosenRefUrl: string | undefined;
  let youtubeVideoId: string | undefined;
  let videoStartSec: number | undefined;

  for (const candidate of rawUrls) {
    // Google My Maps の hostedimage トークン画像URLは著作権配慮および肥大化防止のため除外
    if (
      candidate.includes('mymaps.usercontent.google.com') ||
      candidate.includes('img.youtube.com') ||
      candidate.includes('gstatic.com')
    ) {
      continue;
    }

    // /embed/VIDEO_ID を通常の watch URL に正規化
    let normalizedCandidate = candidate;
    const embedMatch = candidate.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{6,20})/);
    if (embedMatch?.[1]) {
      normalizedCandidate = `https://www.youtube.com/watch?v=${embedMatch[1]}`;
    }

    const validated = validateAndParseReferenceUrl(normalizedCandidate);
    if (validated.ok) {
      if (!chosenRefUrl || validated.trustTier === 'youtube') {
        chosenRefUrl = validated.normalizedUrl;
        youtubeVideoId = validated.youtubeVideoId;
        videoStartSec = validated.videoStartSec;
      }
      if (validated.trustTier === 'youtube') break;
    }
  }

  const cleanedText = rawDesc
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/gx_media_links\s*:\s*https?:\/\/[^\s]+/gi, '')
    .replace(/https?:\/\/mymaps\.usercontent\.google\.com\/[^\s]+/gi, '')
    .replace(/https?:\/\/www\.youtube\.com\/embed\/[^\s]+/gi, '')
    .replace(/\bWKT\s*:\s*/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();

  return {
    description: cleanedText,
    referenceUrl: chosenRefUrl,
    youtubeVideoId,
    videoStartSec,
  };
}

export interface RawCandidateEpisode {
  title: string;
  lat: number;
  lng: number;
  mediaCategory: MediaCategory;
  description: string;
  referenceUrl?: string;
  youtubeVideoId?: string;
  videoStartSec?: number;
  members: string[];
  hashtags: string[];
}

/**
 * 候補リストを走査し、50m以内の同名スポット（または15m以内の極近接同名系スポット）を
 * 1つの `Spot` + 複数 `SpotEpisode` へと統合する
 */
export function mergeCandidatesIntoSpots(
  candidates: RawCandidateEpisode[],
  existingSpots: Spot[] = [],
): { spots: Spot[]; addedSpots: number; mergedEpisodes: number } {
  const spots: Spot[] = structuredClone(existingSpots);
  let addedSpots = 0;
  let mergedEpisodes = 0;
  const nowIso = new Date().toISOString();

  for (let idx = 0; idx < candidates.length; idx++) {
    const item = candidates[idx]!;
    const normTitle = normalizeTitleForDedup(item.title);

    // 近接スポット探索
    let targetSpot: Spot | undefined;
    for (const s of spots) {
      // 粗い緯度経度フィルタ（約100m）で高速枝刈り
      if (Math.abs(s.lat - item.lat) > 0.001 || Math.abs(s.lng - item.lng) > 0.0012) {
        continue;
      }
      const dist = haversineDistanceMeters(s.lat, s.lng, item.lat, item.lng);
      const existingNorm = normalizeTitleForDedup(s.title);
      if (
        (dist <= 60 && existingNorm === normTitle) ||
        (dist <= 18 &&
          (existingNorm.includes(normTitle) || normTitle.includes(existingNorm)))
      ) {
        targetSpot = s;
        break;
      }
    }

    const seedBase = `${item.title}:${item.lat.toFixed(5)}:${item.lng.toFixed(5)}`;
    const spotId =
      targetSpot?.id ?? `spot_${hashStringToSeed(seedBase).toString(36)}_${spots.length}`;

    const episodeSeed = `${spotId}:${item.description.slice(0, 40)}:${item.referenceUrl ?? ''}:${idx}`;
    const episode: SpotEpisode = {
      id: `ep_${hashStringToSeed(episodeSeed).toString(36)}_${idx}`,
      spotId,
      mediaCategory: item.mediaCategory,
      description: item.description || `${item.title}（聖地スポット）`,
      referenceUrl: item.referenceUrl,
      youtubeVideoId: item.youtubeVideoId,
      videoStartSec: item.videoStartSec,
      members: item.members,
      hashtags: item.hashtags,
      createdBy: 'import',
      createdAt: nowIso,
    };

    if (targetSpot) {
      const isExactDuplicate = targetSpot.episodes.some(
        (ep) =>
          ep.description === episode.description &&
          ep.referenceUrl === episode.referenceUrl,
      );
      if (!isExactDuplicate) {
        targetSpot.episodes.push(episode);
        mergedEpisodes++;
      }
    } else {
      spots.push({
        id: spotId,
        groupId: 'hinatazaka46',
        title: item.title,
        lat: Number(item.lat.toFixed(6)),
        lng: Number(item.lng.toFixed(6)),
        prefecture: estimatePrefecture(item.lat, item.lng),
        arrivalRadiusMeters: estimateArrivalRadius(item.title),
        episodes: [episode],
        createdAt: nowIso,
      });
      addedSpots++;
    }
  }

  return { spots, addedSpots, mergedEpisodes };
}

/**
 * Googleマイマップの KML XML 文字列から聖地候補を構造化抽出する
 */
export function parseKmlToCandidates(kmlXml: string): RawCandidateEpisode[] {
  const candidates: RawCandidateEpisode[] = [];
  const folderRegex = /<Folder>([\s\S]*?)<\/Folder>/g;
  let folderMatch: RegExpExecArray | null;

  const parsePlacemarksInBlock = (block: string, folderName: string) => {
    // ルート案内用フォルダ等は除外
    if (folderName.includes('へのルート')) return;

    const { category, defaultHashtags } = mapFolderToCategory(folderName);
    const pmRegex = /<Placemark>([\s\S]*?)<\/Placemark>/g;
    let pmMatch: RegExpExecArray | null;

    while ((pmMatch = pmRegex.exec(block)) !== null) {
      const pmXml = pmMatch[1]!;
      // Point のみ対象（LineString / Polygon はスキップ）
      const pointMatch = pmXml.match(
        /<Point>[\s\S]*?<coordinates>\s*([-\d.]+)\s*,\s*([-\d.]+)(?:\s*,\s*[-\d.]+)?\s*<\/coordinates>[\s\S]*?<\/Point>/,
      );
      if (!pointMatch) continue;

      const lng = Number(pointMatch[1]);
      const lat = Number(pointMatch[2]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const nameMatch = pmXml.match(/<name>([\s\S]*?)<\/name>/);
      const title = nameMatch?.[1] ? decodeXmlEntities(nameMatch[1]).trim() : '';
      if (!title) continue;

      const descMatch = pmXml.match(/<description>([\s\S]*?)<\/description>/);
      const rawDesc = descMatch?.[1] ? decodeXmlEntities(descMatch[1]) : '';

      // ExtendedData (題名 / gx_media_links)
      let workTitleTag = '';
      let gxLinks = '';
      const dataRegex =
        /<Data\s+name="([^"]+)">[\s\S]*?<value>([\s\S]*?)<\/value>[\s\S]*?<\/Data>/g;
      let dMatch: RegExpExecArray | null;
      while ((dMatch = dataRegex.exec(pmXml)) !== null) {
        const key = dMatch[1];
        const val = decodeXmlEntities(dMatch[2] ?? '').trim();
        if ((key === '題名' || key === '分類') && val) {
          workTitleTag = val;
        } else if (key === 'gx_media_links' && val) {
          gxLinks = val;
        }
      }

      const { description, referenceUrl, youtubeVideoId, videoStartSec } =
        extractCleanDescriptionAndUrl(rawDesc, gxLinks);

      const members = extractMembersFromText(`${title} ${description}`);
      const hashtags = new Set<string>(defaultHashtags);
      if (workTitleTag) hashtags.add(workTitleTag.replace(/^#/, ''));

      // 代表的な楽曲・番組キーワードのハッシュタグ補完
      const songMatches = description.match(/「([^」]{2,20})」/g) ?? [];
      for (const sm of songMatches.slice(0, 2)) {
        const inner = sm.slice(1, -1).trim();
        if (inner && !inner.includes(' ')) {
          hashtags.add(inner);
        }
      }

      candidates.push({
        title,
        lat,
        lng,
        mediaCategory: category,
        description,
        referenceUrl,
        youtubeVideoId,
        videoStartSec,
        members,
        hashtags: Array.from(hashtags),
      });
    }
  };

  let foundFolders = false;
  while ((folderMatch = folderRegex.exec(kmlXml)) !== null) {
    foundFolders = true;
    const folderBlock = folderMatch[1]!;
    const fNameMatch = folderBlock.match(/<name>([\s\S]*?)<\/name>/);
    const folderName = fNameMatch?.[1] ? decodeXmlEntities(fNameMatch[1]).trim() : '';
    parsePlacemarksInBlock(folderBlock, folderName);
  }

  if (!foundFolders) {
    parsePlacemarksInBlock(kmlXml, '');
  }

  return candidates;
}

function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cols.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current.trim());
  return cols;
}

/**
 * CSV文字列（title,lat,lng,mediaCategory,description,referenceUrl,members,hashtags または mapUrl列対応）を解析
 */
export function parseCsvToCandidates(csvText: string): RawCandidateEpisode[] {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h));

  const titleCol = idx(['title', 'name', '名称', 'タイトル', '聖地名']);
  const latCol = idx(['lat', 'latitude', '緯度']);
  const lngCol = idx(['lng', 'lon', 'longitude', '経度']);
  const mapUrlCol = idx(['mapurl', 'googlemapurl', '地図url', '場所url']);
  const catCol = idx(['mediacategory', 'category', '媒体', 'カテゴリ']);
  const descCol = idx(['description', 'desc', '説明', '詳細']);
  const refCol = idx(['referenceurl', 'url', '参考url']);
  const memCol = idx(['members', 'member', 'メンバー']);
  const tagCol = idx(['hashtags', 'tags', 'タグ']);

  const results: RawCandidateEpisode[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]!);
    const title = (titleCol >= 0 ? cols[titleCol] : cols[0]) ?? '';
    if (!title) continue;

    let lat = latCol >= 0 ? Number(cols[latCol]) : Number.NaN;
    let lng = lngCol >= 0 ? Number(cols[lngCol]) : Number.NaN;

    if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && mapUrlCol >= 0 && cols[mapUrlCol]) {
      const parsedLoc = parseGoogleMapsUrl(cols[mapUrlCol]!);
      if (parsedLoc.lat !== undefined && parsedLoc.lng !== undefined) {
        lat = parsedLoc.lat;
        lng = parsedLoc.lng;
      }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const rawCat = (catCol >= 0 ? cols[catCol] : '') ?? '';
    const { category } = mapFolderToCategory(rawCat);
    const description = (descCol >= 0 ? cols[descCol] : '') ?? '';
    const rawRef = (refCol >= 0 ? cols[refCol] : '') ?? '';

    let referenceUrl: string | undefined;
    let youtubeVideoId: string | undefined;
    let videoStartSec: number | undefined;
    if (rawRef) {
      const v = validateAndParseReferenceUrl(rawRef);
      if (v.ok) {
        referenceUrl = v.normalizedUrl;
        youtubeVideoId = v.youtubeVideoId;
        videoStartSec = v.videoStartSec;
      }
    }

    const explicitMembers =
      memCol >= 0 && cols[memCol]
        ? cols[memCol]!.split(/[|、,/]/).map((s) => s.trim()).filter(Boolean)
        : [];
    const autoMembers = extractMembersFromText(`${title} ${description}`);
    const members = Array.from(new Set([...explicitMembers, ...autoMembers]));

    const hashtags =
      tagCol >= 0 && cols[tagCol]
        ? cols[tagCol]!
            .split(/[|、,\s]+/)
            .map((s) => s.replace(/^#/, '').trim())
            .filter(Boolean)
        : [];

    results.push({
      title,
      lat,
      lng,
      mediaCategory: category,
      description,
      referenceUrl,
      youtubeVideoId,
      videoStartSec,
      members,
      hashtags,
    });
  }
  return results;
}
