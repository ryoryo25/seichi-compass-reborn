import { parseGoogleMapsUrl } from '@seichi/shared';

export interface PlaceSearchCandidate {
  name: string;
  address?: string;
  lat: number;
  lng: number;
  provider: 'google_places' | 'gsi_japan';
}

/**
 * 施設名・住所キーワード検索
 * GOOGLE_MAPS_API_KEY 設定時は Google Places API (New) を優先し、
 * 未設定時は課金ゼロの国土地理院 AddressSearch API へ自動フォールバックする。
 */
export async function searchPlacesByQuery(
  query: string,
  googleMapsApiKey?: string,
): Promise<PlaceSearchCandidate[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (googleMapsApiKey && googleMapsApiKey.trim() !== '') {
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': googleMapsApiKey.trim(),
          'X-Goog-FieldMask':
            'places.displayName,places.formattedAddress,places.location',
        },
        body: JSON.stringify({
          textQuery: trimmed,
          languageCode: 'ja',
          regionCode: 'JP',
          maxResultCount: 6,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          places?: Array<{
            displayName?: { text?: string };
            formattedAddress?: string;
            location?: { latitude?: number; longitude?: number };
          }>;
        };
        const out: PlaceSearchCandidate[] = [];
        for (const p of data.places ?? []) {
          if (
            p.location?.latitude !== undefined &&
            p.location?.longitude !== undefined
          ) {
            out.push({
              name: p.displayName?.text ?? trimmed,
              address: p.formattedAddress,
              lat: Number(p.location.latitude.toFixed(6)),
              lng: Number(p.location.longitude.toFixed(6)),
              provider: 'google_places',
            });
          }
        }
        if (out.length > 0) return out;
      }
    } catch {
      // Google Places 失敗時は国土地理院APIへフォールバック
    }
  }

  // 国土地理院 AddressSearch API（APIキー不要・無料）
  try {
    const gsiUrl = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(
      trimmed,
    )}`;
    const res = await fetch(gsiUrl);
    if (res.ok) {
      const features = (await res.json()) as Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: { title?: string };
      }>;
      return features
        .slice(0, 8)
        .filter((f) => Array.isArray(f.geometry?.coordinates))
        .map((f) => ({
          name: f.properties?.title ?? trimmed,
          lat: Number(f.geometry!.coordinates![1].toFixed(6)),
          lng: Number(f.geometry!.coordinates![0].toFixed(6)),
          provider: 'gsi_japan' as const,
        }));
    }
  } catch {
    // オフライン時は空配列
  }

  return [];
}

/**
 * Google Maps 短縮URL展開 ＋ `!3d!4d` 座標解析 ＋ 場所名ジオコーディング補完
 */
export async function resolveLocationInput(
  rawInput: string,
  googleMapsApiKey?: string,
): Promise<{
  lat?: number;
  lng?: number;
  placeQuery?: string;
  sourceType: string;
}> {
  let targetInput = rawInput.trim();

  // 短縮URL (maps.app.goo.gl / goo.gl/maps) のリダイレクト追跡（許可ホスト限定）
  const shortUrlMatch = targetInput.match(
    /https:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/[a-zA-Z0-9_-]+/,
  );
  if (shortUrlMatch) {
    try {
      const resp = await fetch(shortUrlMatch[0], {
        method: 'GET',
        redirect: 'follow',
      });
      if (resp.url) {
        targetInput = resp.url;
      }
    } catch {
      // ignore network failure
    }
  }

  const parsed = parseGoogleMapsUrl(targetInput);
  if (parsed.lat !== undefined && parsed.lng !== undefined) {
    return parsed;
  }

  // URLに座標がなく場所名だけ含まれていた場合、または直接地名が入力された場合はジオコーダで補完
  const fallbackQuery =
    parsed.placeQuery ?? (!targetInput.startsWith('http') ? targetInput : undefined);
  if (fallbackQuery) {
    const candidates = await searchPlacesByQuery(fallbackQuery, googleMapsApiKey);
    if (candidates[0]) {
      return {
        lat: candidates[0].lat,
        lng: candidates[0].lng,
        placeQuery: candidates[0].name,
        sourceType: `geocoded_${candidates[0].provider}`,
      };
    }
  }

  return parsed;
}
