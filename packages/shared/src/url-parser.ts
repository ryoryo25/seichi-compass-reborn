export interface ParsedMapLocation {
  lat?: number;
  lng?: number;
  placeQuery?: string;
  sourceType: 'pin_3d4d' | 'query_coords' | 'viewport_at' | 'place_name' | 'unknown';
}

function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Google Maps URL（展開後URLや共有テキスト含む）から優先順位付きで緯度経度・検索名を抽出する。
 * `@lat,lng`（画面中心）よりも `!3d<lat>!4d<lng>`（実際のピン座標）を優先することで座標ズレを防ぐ。
 */
export function parseGoogleMapsUrl(rawInput: string): ParsedMapLocation {
  const trimmed = rawInput.trim();
  if (!trimmed) return { sourceType: 'unknown' };

  // 共有テキスト（例: "調布駅 https://maps.app.goo.gl/..."）からURLを抜き出す
  const urlMatch = trimmed.match(/https?:\/\/[^\s]+/);
  const target = urlMatch ? urlMatch[0] : trimmed;

  // 1. 最優先: !3d<lat>!4d<lng> (Google Maps の正確なピン座標)
  const pinMatches = [...target.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g)];
  if (pinMatches.length > 0) {
    const last = pinMatches[pinMatches.length - 1]!;
    const lat = Number(last[1]);
    const lng = Number(last[2]);
    if (isValidLatLng(lat, lng)) {
      const placeMatch = target.match(/\/maps\/place\/([^/@?]+)/);
      return {
        lat,
        lng,
        placeQuery: placeMatch?.[1] ? decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')) : undefined,
        sourceType: 'pin_3d4d',
      };
    }
  }

  // 2. クエリパラメータ (?q=35.68,139.76 / ?ll=35.68,139.76 / destination=...)
  try {
    const parsed = new URL(target);
    for (const key of ['q', 'query', 'll', 'destination', 'center']) {
      const val = parsed.searchParams.get(key);
      if (!val) continue;
      const coordMatch = val.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
      if (coordMatch) {
        const lat = Number(coordMatch[1]);
        const lng = Number(coordMatch[2]);
        if (isValidLatLng(lat, lng)) {
          return { lat, lng, sourceType: 'query_coords' };
        }
      }
    }
  } catch {
    // 生の "35.665, 139.705" 入力にも対応
    const directCoords = trimmed.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
    if (directCoords) {
      const lat = Number(directCoords[1]);
      const lng = Number(directCoords[2]);
      if (isValidLatLng(lat, lng)) {
        return { lat, lng, sourceType: 'query_coords' };
      }
    }
  }

  // 3. /@lat,lng,zoom パターン
  const atMatch = target.match(/\/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    const lat = Number(atMatch[1]);
    const lng = Number(atMatch[2]);
    if (isValidLatLng(lat, lng)) {
      const placeMatch = target.match(/\/maps\/place\/([^/@?]+)/);
      return {
        lat,
        lng,
        placeQuery: placeMatch?.[1] ? decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')) : undefined,
        sourceType: 'viewport_at',
      };
    }
  }

  // 4. 場所名のみ取得できた場合
  const placeOnly = target.match(/\/maps\/(?:place|search)\/([^/@?]+)/);
  if (placeOnly?.[1]) {
    return {
      placeQuery: decodeURIComponent(placeOnly[1].replace(/\+/g, ' ')),
      sourceType: 'place_name',
    };
  }

  return { sourceType: 'unknown' };
}

export type UrlTrustTier = 'youtube' | 'official' | 'external_safe';

export interface ValidatedReferenceUrl {
  ok: true;
  normalizedUrl: string;
  trustTier: UrlTrustTier;
  hostname: string;
  youtubeVideoId?: string;
  videoStartSec?: number;
}

const OFFICIAL_TRUSTED_DOMAINS = [
  'hinatazaka46.com',
  'www.hinatazaka46.com',
  'sakurazaka46.com',
  'www.sakurazaka46.com',
  'nogizaka46.com',
  'www.nogizaka46.com',
  'x.com',
  'twitter.com',
  'mobile.twitter.com',
  'instagram.com',
  'www.instagram.com',
  'tver.jp',
  'lemino.docomo.ne.jp',
];

function parseTimeParamToSeconds(raw: string | null): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  const hms = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i);
  if (!hms) return undefined;
  const h = Number(hms[1] ?? 0);
  const m = Number(hms[2] ?? 0);
  const s = Number(hms[3] ?? 0);
  const total = h * 3600 + m * 60 + s;
  return total > 0 ? total : undefined;
}

/**
 * 参考URLの脆弱性対策（HTTPS強制・ローカルIP/SSRF遮断・信頼ドメイン判定・YouTube開始秒数抽出）
 */
export function validateAndParseReferenceUrl(
  rawUrl: string,
): ValidatedReferenceUrl | { ok: false; reason: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, reason: 'URLが空です' };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: '有効なURL形式ではありません' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'セキュリティ保護のため https:// のURLのみ登録可能です' };
  }

  const host = url.hostname.toLowerCase();
  // SSRF / プライベートネットワーク遮断
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host === '[::1]'
  ) {
    return { ok: false, reason: '内部ネットワーク宛てのURLは登録できません' };
  }

  // YouTube 判定 & 動画ID + 秒数抽出
  if (
    host === 'youtu.be' ||
    host === 'youtube.com' ||
    host === 'www.youtube.com' ||
    host === 'm.youtube.com'
  ) {
    let videoId: string | undefined;
    if (host === 'youtu.be') {
      videoId = url.pathname.split('/').filter(Boolean)[0];
    } else if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v') ?? undefined;
    } else if (url.pathname.startsWith('/embed/') || url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/live/')) {
      videoId = url.pathname.split('/')[2];
    }

    if (videoId && !/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
      videoId = undefined;
    }

    const startSec =
      parseTimeParamToSeconds(url.searchParams.get('t')) ??
      parseTimeParamToSeconds(url.searchParams.get('start'));

    return {
      ok: true,
      normalizedUrl: url.toString(),
      trustTier: 'youtube',
      hostname: host,
      youtubeVideoId: videoId,
      videoStartSec: startSec,
    };
  }

  if (OFFICIAL_TRUSTED_DOMAINS.includes(host)) {
    return {
      ok: true,
      normalizedUrl: url.toString(),
      trustTier: 'official',
      hostname: host,
    };
  }

  return {
    ok: true,
    normalizedUrl: url.toString(),
    trustTier: 'external_safe',
    hostname: host,
  };
}
