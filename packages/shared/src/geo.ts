import { createSeededRng, hashStringToSeed } from './masking.ts';

const EARTH_RADIUS_METERS = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * 2点間の直線距離（メートル）を Haversine 公式で計算
 */
export function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_METERS * c);
}

/**
 * 現在地から目的地への真北基準の方位角（0〜360度: 0=北, 90=東, 180=南, 270=西）
 */
export function calculateBearingDeg(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const phi1 = toRad(fromLat);
  const phi2 = toRad(toLat);
  const deltaLambda = toRad(toLng - fromLng);

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);
  return (toDeg(theta) + 360) % 360;
}

/**
 * 距離を読みやすい日本語表記（37m / 1.9km 等）にフォーマット
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.max(1, Math.round(meters))}m`;
  }
  if (meters < 10000) {
    return `${(meters / 1000).toFixed(1)}km`;
  }
  return `${Math.round(meters / 1000)}km`;
}

/**
 * 宝探しレーダーマップ用に、スポットの正確なピン位置を分からないよう
 * 決定論的に半径 220m〜480m ずらした中心座標を生成する
 */
export function getBlurredRadarPoint(
  spotId: string,
  lat: number,
  lng: number,
): { radarLat: number; radarLng: number } {
  const rng = createSeededRng(hashStringToSeed(`radar:${spotId}`));
  const distanceMeters = 220 + rng() * 260;
  const angleRad = rng() * Math.PI * 2;

  const dLat = (distanceMeters * Math.cos(angleRad)) / 111320;
  const dLng =
    (distanceMeters * Math.sin(angleRad)) /
    (111320 * Math.max(0.2, Math.cos(toRad(lat))));

  return {
    radarLat: Number((lat + dLat).toFixed(6)),
    radarLng: Number((lng + dLng).toFixed(6)),
  };
}

const PREFECTURE_CENTERS: ReadonlyArray<{ name: string; lat: number; lng: number }> = [
  { name: '北海道', lat: 43.06417, lng: 141.34694 },
  { name: '青森県', lat: 40.82444, lng: 140.74 },
  { name: '岩手県', lat: 39.70361, lng: 141.1525 },
  { name: '宮城県', lat: 38.26889, lng: 140.87194 },
  { name: '秋田県', lat: 39.71861, lng: 140.1025 },
  { name: '山形県', lat: 38.24056, lng: 140.36333 },
  { name: '福島県', lat: 37.75, lng: 140.46778 },
  { name: '茨城県', lat: 36.34139, lng: 140.44667 },
  { name: '栃木県', lat: 36.56583, lng: 139.88361 },
  { name: '群馬県', lat: 36.39111, lng: 139.06083 },
  { name: '埼玉県', lat: 35.85694, lng: 139.64889 },
  { name: '千葉県', lat: 35.60472, lng: 140.12333 },
  { name: '東京都', lat: 35.68944, lng: 139.69167 },
  { name: '神奈川県', lat: 35.44778, lng: 139.6425 },
  { name: '新潟県', lat: 37.90222, lng: 139.02361 },
  { name: '富山県', lat: 36.69528, lng: 137.21139 },
  { name: '石川県', lat: 36.59444, lng: 136.62556 },
  { name: '福井県', lat: 36.06528, lng: 136.22194 },
  { name: '山梨県', lat: 35.66389, lng: 138.56833 },
  { name: '長野県', lat: 36.65139, lng: 138.18111 },
  { name: '岐阜県', lat: 35.39111, lng: 136.72222 },
  { name: '静岡県', lat: 34.97694, lng: 138.38306 },
  { name: '愛知県', lat: 35.18028, lng: 136.90667 },
  { name: '三重県', lat: 34.73028, lng: 136.50861 },
  { name: '滋賀県', lat: 35.00444, lng: 135.86833 },
  { name: '京都府', lat: 35.02139, lng: 135.75556 },
  { name: '大阪府', lat: 34.68639, lng: 135.52 },
  { name: '兵庫県', lat: 34.69139, lng: 135.18306 },
  { name: '奈良県', lat: 34.68528, lng: 135.83278 },
  { name: '和歌山県', lat: 34.22611, lng: 135.1675 },
  { name: '鳥取県', lat: 35.50361, lng: 134.23833 },
  { name: '島根県', lat: 35.47222, lng: 133.05056 },
  { name: '岡山県', lat: 34.66167, lng: 133.935 },
  { name: '広島県', lat: 34.39639, lng: 132.45944 },
  { name: '山口県', lat: 34.18583, lng: 131.47139 },
  { name: '徳島県', lat: 34.06583, lng: 134.55944 },
  { name: '香川県', lat: 34.34028, lng: 134.04333 },
  { name: '愛媛県', lat: 33.84167, lng: 132.76611 },
  { name: '高知県', lat: 33.55972, lng: 133.53111 },
  { name: '福岡県', lat: 33.60639, lng: 130.41806 },
  { name: '佐賀県', lat: 33.24944, lng: 130.29889 },
  { name: '長崎県', lat: 32.74472, lng: 129.87361 },
  { name: '熊本県', lat: 32.78972, lng: 130.74167 },
  { name: '大分県', lat: 33.23806, lng: 131.6125 },
  { name: '宮崎県', lat: 31.91111, lng: 131.42389 },
  { name: '鹿児島県', lat: 31.56028, lng: 130.55806 },
  { name: '沖縄県', lat: 26.2125, lng: 127.68111 },
];

/**
 * 外部API通信なしで日本国内の都道府県（海外の場合は「海外」）を高速推定
 */
export function estimatePrefecture(lat: number, lng: number): string {
  if (lat < 20 || lat > 46.5 || lng < 122 || lng > 154) {
    return '海外';
  }
  if (lat > 41.35 && lng > 139.3) {
    return '北海道';
  }
  let best = '東京都';
  let minDist = Number.POSITIVE_INFINITY;
  for (const pref of PREFECTURE_CENTERS) {
    const dist = haversineDistanceMeters(lat, lng, pref.lat, pref.lng);
    if (dist < minDist) {
      minDist = dist;
      best = pref.name;
    }
  }
  if (minDist > 350000) {
    return '海外';
  }
  return best;
}
