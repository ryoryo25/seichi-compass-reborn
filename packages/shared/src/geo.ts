import { createSeededRng, hashStringToSeed } from './masking.ts';

const EARTH_RADIUS_METERS = 6371000;

/** 宝探しモードで描画するレーダー円の半径（メートル） */
export const RADAR_CIRCLE_RADIUS_METERS = 420;
/** レーダー中心の最小オフセット距離（メートル） */
export const RADAR_MIN_OFFSET_METERS = 100;
/**
 * レーダー中心の最大オフセット距離（メートル）
 * 必ず RADAR_MAX_OFFSET_METERS < RADAR_CIRCLE_RADIUS_METERS（余裕80m）を満たし、
 * 真の聖地が100%レーダー円の内側に収まることを数学的に保証する。
 */
export const RADAR_MAX_OFFSET_METERS = 340;

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
 * 宝探しレーダーマップ用に、スポットの正確なピン位置を伏せつつ必ず円内（半径420m）に収まるよう
 * 決定論的に半径 100m〜340m ずらした中心座標を生成する
 */
export function getBlurredRadarPoint(
  spotId: string,
  lat: number,
  lng: number,
): { radarLat: number; radarLng: number } {
  const rng = createSeededRng(hashStringToSeed(`radar:${spotId}`));
  const span = RADAR_MAX_OFFSET_METERS - RADAR_MIN_OFFSET_METERS;
  const distanceMeters = RADAR_MIN_OFFSET_METERS + rng() * span;
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

/**
 * 県境・広域県（静岡東部・長野東信/南信・千葉葛南・川崎北西部・多摩等）の誤判定を防ぐ
 * 全国47都道府県のサブリージョン代表アンカー座標群
 */
const PREFECTURE_ANCHORS: ReadonlyArray<{
  name: string;
  lat: number;
  lng: number;
}> = [
  // 北海道・東北
  { name: '北海道', lat: 43.0642, lng: 141.3469 }, // 札幌
  { name: '北海道', lat: 41.7687, lng: 140.7288 }, // 函館
  { name: '北海道', lat: 43.7706, lng: 142.3648 }, // 旭川
  { name: '北海道', lat: 42.9849, lng: 144.3814 }, // 釧路
  { name: '北海道', lat: 43.8031, lng: 143.8962 }, // 北見
  { name: '青森県', lat: 40.8244, lng: 140.74 }, // 青森
  { name: '青森県', lat: 40.6063, lng: 140.4642 }, // 弘前
  { name: '青森県', lat: 40.5123, lng: 141.4884 }, // 八戸
  { name: '岩手県', lat: 39.7036, lng: 141.1525 }, // 盛岡
  { name: '岩手県', lat: 38.9312, lng: 141.1264 }, // 一関
  { name: '岩手県', lat: 39.6414, lng: 141.9572 }, // 宮古
  { name: '宮城県', lat: 38.2689, lng: 140.8719 }, // 仙台
  { name: '宮城県', lat: 38.4342, lng: 141.3029 }, // 石巻
  { name: '宮城県', lat: 38.5756, lng: 140.9556 }, // 大崎
  { name: '秋田県', lat: 39.7186, lng: 140.1025 }, // 秋田
  { name: '秋田県', lat: 39.3138, lng: 140.5469 }, // 横手
  { name: '秋田県', lat: 40.2722, lng: 140.5622 }, // 大館
  { name: '山形県', lat: 38.2406, lng: 140.3633 }, // 山形
  { name: '山形県', lat: 38.8944, lng: 139.8392 }, // 酒田・庄内
  { name: '山形県', lat: 37.9222, lng: 140.1167 }, // 米沢
  { name: '福島県', lat: 37.75, lng: 140.4678 }, // 福島
  { name: '福島県', lat: 37.4006, lng: 140.3597 }, // 郡山
  { name: '福島県', lat: 37.4947, lng: 139.9297 }, // 会津若松
  { name: '福島県', lat: 37.0504, lng: 140.8877 }, // いわき

  // 北関東
  { name: '茨城県', lat: 36.3414, lng: 140.4467 }, // 水戸
  { name: '茨城県', lat: 36.0835, lng: 140.0764 }, // つくば
  { name: '茨城県', lat: 35.8955, lng: 140.0768 }, // 取手・守谷
  { name: '茨城県', lat: 36.1956, lng: 139.7056 }, // 古河
  { name: '茨城県', lat: 35.9658, lng: 140.6448 }, // 鹿嶋
  { name: '茨城県', lat: 36.5992, lng: 140.6514 }, // 日立
  { name: '栃木県', lat: 36.5658, lng: 139.8836 }, // 宇都宮
  { name: '栃木県', lat: 36.7199, lng: 139.6982 }, // 日光
  { name: '栃木県', lat: 36.9619, lng: 140.0456 }, // 那須塩原
  { name: '栃木県', lat: 36.3147, lng: 139.8001 }, // 小山
  { name: '栃木県', lat: 36.3402, lng: 139.4497 }, // 足利・佐野
  { name: '群馬県', lat: 36.3911, lng: 139.0608 }, // 前橋
  { name: '群馬県', lat: 36.3219, lng: 139.0033 }, // 高崎
  { name: '群馬県', lat: 36.2911, lng: 139.3754 }, // 太田・館林
  { name: '群馬県', lat: 36.6441, lng: 139.0422 }, // 沼田
  { name: '群馬県', lat: 36.6208, lng: 138.5961 }, // 草津・嬬恋

  // 南関東（県境密集エリア）
  { name: '埼玉県', lat: 35.8569, lng: 139.6489 }, // さいたま
  { name: '埼玉県', lat: 35.8077, lng: 139.7242 }, // 川口・戸田
  { name: '埼玉県', lat: 35.7812, lng: 139.6058 }, // 和光・朝霞
  { name: '埼玉県', lat: 35.8911, lng: 139.7909 }, // 越谷・三郷
  { name: '埼玉県', lat: 35.7996, lng: 139.4689 }, // 所沢
  { name: '埼玉県', lat: 35.9251, lng: 139.4858 }, // 川越
  { name: '埼玉県', lat: 36.1473, lng: 139.3886 }, // 熊谷
  { name: '埼玉県', lat: 35.9917, lng: 139.0854 }, // 秩父
  { name: '千葉県', lat: 35.6047, lng: 140.1233 }, // 千葉
  { name: '千葉県', lat: 35.6532, lng: 139.9019 }, // 浦安（舞浜含む）
  { name: '千葉県', lat: 35.7219, lng: 139.931 }, // 市川
  { name: '千葉県', lat: 35.6947, lng: 139.9826 }, // 船橋・習志野
  { name: '千葉県', lat: 35.7876, lng: 139.9032 }, // 松戸
  { name: '千葉県', lat: 35.8676, lng: 139.9756 }, // 柏・流山
  { name: '千葉県', lat: 35.7767, lng: 140.3188 }, // 成田
  { name: '千葉県', lat: 35.7347, lng: 140.8267 }, // 銚子
  { name: '千葉県', lat: 35.3759, lng: 139.9168 }, // 木更津
  { name: '千葉県', lat: 34.9965, lng: 139.8699 }, // 館山・鴨川
  { name: '東京都', lat: 35.6894, lng: 139.6917 }, // 新宿・都庁
  { name: '東京都', lat: 35.6812, lng: 139.7671 }, // 千代田・中央・東京駅
  { name: '東京都', lat: 35.658, lng: 139.7016 }, // 渋谷・港
  { name: '東京都', lat: 35.6466, lng: 139.6532 }, // 世田谷
  { name: '東京都', lat: 35.5614, lng: 139.716 }, // 大田・品川
  { name: '東京都', lat: 35.7066, lng: 139.8683 }, // 江戸川・小岩
  { name: '東京都', lat: 35.7556, lng: 139.8045 }, // 足立・葛飾
  { name: '東京都', lat: 35.7512, lng: 139.7335 }, // 北・板橋・豊島
  { name: '東京都', lat: 35.6518, lng: 139.5446 }, // 調布・狛江・府中
  { name: '東京都', lat: 35.7023, lng: 139.5608 }, // 武蔵野・三鷹
  { name: '東京都', lat: 35.698, lng: 139.4137 }, // 立川
  { name: '東京都', lat: 35.5467, lng: 139.4386 }, // 町田
  { name: '東京都', lat: 35.6558, lng: 139.3239 }, // 八王子
  { name: '東京都', lat: 35.7879, lng: 139.2758 }, // 青梅・奥多摩
  { name: '神奈川県', lat: 35.4478, lng: 139.6425 }, // 横浜中区
  { name: '神奈川県', lat: 35.5453, lng: 139.5736 }, // 横浜青葉・都筑
  { name: '神奈川県', lat: 35.5308, lng: 139.7029 }, // 川崎区
  { name: '神奈川県', lat: 35.5768, lng: 139.6596 }, // 川崎中原・武蔵小杉
  { name: '神奈川県', lat: 35.5878, lng: 139.5858 }, // 川崎宮前・高津（鷺沼・溝の口）
  { name: '神奈川県', lat: 35.6197, lng: 139.5653 }, // 川崎多摩・麻生（登戸・新百合）
  { name: '神奈川県', lat: 35.5714, lng: 139.3732 }, // 相模原
  { name: '神奈川県', lat: 35.443, lng: 139.3619 }, // 厚木・海老名
  { name: '神奈川県', lat: 35.3391, lng: 139.4897 }, // 藤沢・鎌倉
  { name: '神奈川県', lat: 35.2814, lng: 139.6722 }, // 横須賀・三浦
  { name: '神奈川県', lat: 35.2556, lng: 139.1597 }, // 小田原・箱根

  // 甲信越・北陸・東海
  { name: '新潟県', lat: 37.9022, lng: 139.0236 }, // 新潟
  { name: '新潟県', lat: 37.4463, lng: 138.8512 }, // 長岡
  { name: '新潟県', lat: 37.1479, lng: 138.2361 }, // 上越
  { name: '富山県', lat: 36.6953, lng: 137.2114 }, // 富山
  { name: '富山県', lat: 36.7541, lng: 137.0257 }, // 高岡
  { name: '石川県', lat: 36.5944, lng: 136.6256 }, // 金沢
  { name: '石川県', lat: 37.0431, lng: 136.9669 }, // 七尾・能登
  { name: '福井県', lat: 36.0653, lng: 136.2219 }, // 福井
  { name: '福井県', lat: 35.6453, lng: 136.0556 }, // 敦賀
  { name: '山梨県', lat: 35.6639, lng: 138.5683 }, // 甲府
  { name: '山梨県', lat: 35.4875, lng: 138.8078 }, // 富士吉田・河口湖・山中湖
  { name: '山梨県', lat: 35.6121, lng: 138.9436 }, // 大月・上野原
  { name: '山梨県', lat: 35.7769, lng: 138.4203 }, // 北杜
  { name: '長野県', lat: 36.6514, lng: 138.1811 }, // 長野
  { name: '長野県', lat: 36.238, lng: 137.972 }, // 松本
  { name: '長野県', lat: 36.4019, lng: 138.249 }, // 上田
  { name: '長野県', lat: 36.2489, lng: 138.477 }, // 佐久
  { name: '長野県', lat: 36.3484, lng: 138.5971 }, // 軽井沢
  { name: '長野県', lat: 36.0028, lng: 138.1336 }, // 諏訪・茅野
  { name: '長野県', lat: 35.5147, lng: 137.8218 }, // 飯田
  { name: '長野県', lat: 36.6982, lng: 137.8619 }, // 白馬
  { name: '岐阜県', lat: 35.3911, lng: 136.7222 }, // 岐阜
  { name: '岐阜県', lat: 36.1461, lng: 137.2522 }, // 高山
  { name: '岐阜県', lat: 35.3592, lng: 137.1825 }, // 多治見・東濃
  { name: '静岡県', lat: 34.9769, lng: 138.3831 }, // 静岡
  { name: '静岡県', lat: 34.7108, lng: 137.7261 }, // 浜松
  { name: '静岡県', lat: 35.1614, lng: 138.6764 }, // 富士・富士宮
  { name: '静岡県', lat: 35.0956, lng: 138.8636 }, // 沼津・三島
  { name: '静岡県', lat: 35.3086, lng: 138.9344 }, // 御殿場・裾野
  { name: '静岡県', lat: 35.0963, lng: 139.0717 }, // 熱海・伊東
  { name: '静岡県', lat: 34.6797, lng: 138.9453 }, // 下田・伊豆南部
  { name: '愛知県', lat: 35.1803, lng: 136.9067 }, // 名古屋
  { name: '愛知県', lat: 34.7692, lng: 137.3914 }, // 豊橋
  { name: '愛知県', lat: 35.0825, lng: 137.1564 }, // 豊田・岡崎
  { name: '三重県', lat: 34.7303, lng: 136.5086 }, // 津
  { name: '三重県', lat: 34.9652, lng: 136.6244 }, // 四日市・桑名
  { name: '三重県', lat: 34.4875, lng: 136.7094 }, // 伊勢・志摩

  // 関西
  { name: '滋賀県', lat: 35.0044, lng: 135.8683 }, // 大津
  { name: '滋賀県', lat: 35.2744, lng: 136.2597 }, // 彦根・長浜
  { name: '京都府', lat: 35.0214, lng: 135.7556 }, // 京都
  { name: '京都府', lat: 35.4747, lng: 135.3858 }, // 舞鶴・福知山
  { name: '大阪府', lat: 34.6864, lng: 135.52 }, // 大阪中央
  { name: '大阪府', lat: 34.8192, lng: 135.4906 }, // 吹田・豊中
  { name: '大阪府', lat: 34.5733, lng: 135.4831 }, // 堺
  { name: '大阪府', lat: 34.4094, lng: 135.3183 }, // 泉佐野・関空
  { name: '兵庫県', lat: 34.6914, lng: 135.1831 }, // 神戸
  { name: '兵庫県', lat: 34.7376, lng: 135.3414 }, // 西宮・尼崎
  { name: '兵庫県', lat: 34.8151, lng: 134.6853 }, // 姫路
  { name: '兵庫県', lat: 35.5444, lng: 134.8203 }, // 豊岡・城崎
  { name: '兵庫県', lat: 34.3422, lng: 134.8975 }, // 淡路島
  { name: '奈良県', lat: 34.6853, lng: 135.8328 }, // 奈良
  { name: '奈良県', lat: 34.5125, lng: 135.7928 }, // 橿原
  { name: '和歌山県', lat: 34.2261, lng: 135.1675 }, // 和歌山
  { name: '和歌山県', lat: 33.7292, lng: 135.3783 }, // 田辺・白浜
  { name: '和歌山県', lat: 33.7244, lng: 135.9936 }, // 新宮

  // 中国・四国
  { name: '鳥取県', lat: 35.5036, lng: 134.2383 }, // 鳥取
  { name: '鳥取県', lat: 35.4281, lng: 133.3311 }, // 米子
  { name: '島根県', lat: 35.4722, lng: 133.0506 }, // 松江・出雲
  { name: '島根県', lat: 34.8994, lng: 132.0803 }, // 浜田
  { name: '岡山県', lat: 34.6617, lng: 133.935 }, // 岡山
  { name: '岡山県', lat: 34.585, lng: 133.7719 }, // 倉敷
  { name: '岡山県', lat: 35.0692, lng: 134.0044 }, // 津山
  { name: '広島県', lat: 34.3964, lng: 132.4594 }, // 広島
  { name: '広島県', lat: 34.4858, lng: 133.3622 }, // 福山・尾道
  { name: '山口県', lat: 34.1858, lng: 131.4714 }, // 山口
  { name: '山口県', lat: 33.9578, lng: 130.9414 }, // 下関
  { name: '山口県', lat: 34.1603, lng: 132.2194 }, // 岩国
  { name: '徳島県', lat: 34.0658, lng: 134.5594 }, // 徳島
  { name: '香川県', lat: 34.3403, lng: 134.0433 }, // 高松
  { name: '香川県', lat: 34.2897, lng: 133.7978 }, // 丸亀
  { name: '愛媛県', lat: 33.8417, lng: 132.7661 }, // 松山
  { name: '愛媛県', lat: 34.0661, lng: 132.9978 }, // 今治
  { name: '愛媛県', lat: 33.2233, lng: 132.5606 }, // 宇和島
  { name: '高知県', lat: 33.5597, lng: 133.5311 }, // 高知
  { name: '高知県', lat: 32.9917, lng: 132.9333 }, // 四万十

  // 九州・沖縄
  { name: '福岡県', lat: 33.6064, lng: 130.4181 }, // 福岡
  { name: '福岡県', lat: 33.8833, lng: 130.8753 }, // 北九州
  { name: '福岡県', lat: 33.3192, lng: 130.5083 }, // 久留米
  { name: '佐賀県', lat: 33.2494, lng: 130.2989 }, // 佐賀
  { name: '佐賀県', lat: 33.4508, lng: 129.9681 }, // 唐津
  { name: '長崎県', lat: 32.7447, lng: 129.8736 }, // 長崎
  { name: '長崎県', lat: 33.18, lng: 129.715 }, // 佐世保
  { name: '熊本県', lat: 32.7897, lng: 130.7417 }, // 熊本
  { name: '熊本県', lat: 32.9508, lng: 131.1211 }, // 阿蘇
  { name: '熊本県', lat: 32.5078, lng: 130.6019 }, // 八代
  { name: '大分県', lat: 33.2381, lng: 131.6125 }, // 大分・別府
  { name: '宮崎県', lat: 31.9111, lng: 131.4239 }, // 宮崎
  { name: '宮崎県', lat: 32.5806, lng: 131.665 }, // 延岡・日向
  { name: '宮崎県', lat: 31.7194, lng: 131.0617 }, // 都城
  { name: '鹿児島県', lat: 31.5603, lng: 130.5581 }, // 鹿児島
  { name: '鹿児島県', lat: 31.3789, lng: 130.8522 }, // 鹿屋
  { name: '鹿児島県', lat: 28.3775, lng: 129.4939 }, // 奄美
  { name: '沖縄県', lat: 26.2125, lng: 127.6811 }, // 那覇
  { name: '沖縄県', lat: 26.5914, lng: 127.9772 }, // 名護
  { name: '沖縄県', lat: 24.8056, lng: 125.2811 }, // 宮古島
  { name: '沖縄県', lat: 24.3448, lng: 124.1572 }, // 石垣島
];

const EXPLICIT_ADDRESS_PREF_REGEX =
  /(北海道|東京都|大阪府|京都府|(?:青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)県)(?=[^\s、,。()（）「」『』]{1,8}[市区町村郡])/;

/**
 * 外部API通信なしで日本国内の都道府県（海外の場合は「海外」）を高精度推定
 * - `textHint` に「長野県茅野市」「静岡県御殿場市」等の住所表記が含まれる場合は優先採用
 * - 座標のみの場合も全国約170箇所のサブリージョン代表アンカーにより県境エリアを正確に判定
 */
export function estimatePrefecture(
  lat: number,
  lng: number,
  textHint?: string,
): string {
  if (textHint) {
    const matched = textHint.match(EXPLICIT_ADDRESS_PREF_REGEX);
    if (matched?.[1]) {
      return matched[1];
    }
  }

  if (lat < 20 || lat > 46.5 || lng < 122 || lng > 154) {
    return '海外';
  }
  if (lat > 41.35 && lng > 139.3) {
    return '北海道';
  }

  let best = '東京都';
  let minDist = Number.POSITIVE_INFINITY;
  for (const anchor of PREFECTURE_ANCHORS) {
    const dist = haversineDistanceMeters(lat, lng, anchor.lat, anchor.lng);
    if (dist < minDist) {
      minDist = dist;
      best = anchor.name;
    }
  }
  if (minDist > 350000) {
    return '海外';
  }
  return best;
}
