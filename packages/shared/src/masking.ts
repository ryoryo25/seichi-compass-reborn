import type { MaskLevel, MediaCategory, TagVisibility } from './schemas.ts';

const MASK_SYMBOLS = ['〇', '△', '＊', '？'] as const;

export function hashStringToSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MASK_RATIO: Record<MaskLevel, number> = {
  easy: 0.32,
  normal: 0.56,
  hard: 0.8,
  full: 1.0,
};

/**
 * スポットIDをシード値として各文字の伏字優先度を決定論的に計算し、虫食いタイトルを返す。
 * - リロードしても同じ記号・同じ位置が維持されるため、再読み込みによる文字特定を防止。
 * - 難易度を hard -> normal -> easy に下げた際も段階的にのみ開示される包含関係を保証。
 */
export function maskSpotTitle(spotId: string, title: string, level: MaskLevel): string {
  const chars = Array.from(title);
  if (chars.length === 0) return title;

  const rng = createSeededRng(hashStringToSeed(`mask:${spotId}`));

  // 空白や括弧以外のマスク対象インデックスを抽出
  const maskableIndices: number[] = [];
  const symbolChoicePerIndex = new Map<number, string>();

  chars.forEach((ch, idx) => {
    const symbol = MASK_SYMBOLS[Math.floor(rng() * MASK_SYMBOLS.length)] ?? '〇';
    symbolChoicePerIndex.set(idx, symbol);
    if (!/[\s　・()（）「」『』/／\-]/.test(ch)) {
      maskableIndices.push(idx);
    }
  });

  if (maskableIndices.length === 0) return title;

  if (level === 'full') {
    return chars
      .map((ch, idx) =>
        maskableIndices.includes(idx) ? (symbolChoicePerIndex.get(idx) ?? '〇') : ch,
      )
      .join('');
  }

  // Fisher-Yates シャッフルで固定のマスク優先順を作る
  const rankedIndices = [...maskableIndices];
  for (let i = rankedIndices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = rankedIndices[i]!;
    rankedIndices[i] = rankedIndices[j]!;
    rankedIndices[j] = tmp;
  }

  const ratio = MASK_RATIO[level];
  let maskCount = Math.round(rankedIndices.length * ratio);
  if (maskCount < 1) maskCount = 1;
  if (rankedIndices.length >= 2 && maskCount >= rankedIndices.length) {
    maskCount = rankedIndices.length - 1;
  }

  const maskedSet = new Set(rankedIndices.slice(0, maskCount));
  return chars
    .map((ch, idx) => (maskedSet.has(idx) ? (symbolChoicePerIndex.get(idx) ?? '〇') : ch))
    .join('');
}

export function filterSpotTagsForVisibility(
  tags: {
    mediaCategories: MediaCategory[];
    members: string[];
    hashtags: string[];
  },
  visibility: TagVisibility,
): {
  visibleMediaCategories: MediaCategory[];
  visibleMembers: string[];
  visibleHashtags: string[];
} {
  switch (visibility) {
    case 'all':
      return {
        visibleMediaCategories: tags.mediaCategories,
        visibleMembers: tags.members,
        visibleHashtags: tags.hashtags,
      };
    case 'member_and_media':
      return {
        visibleMediaCategories: tags.mediaCategories,
        visibleMembers: tags.members,
        visibleHashtags: [],
      };
    case 'media_only':
      return {
        visibleMediaCategories: tags.mediaCategories,
        visibleMembers: [],
        visibleHashtags: [],
      };
    case 'none':
      return {
        visibleMediaCategories: [],
        visibleMembers: [],
        visibleHashtags: [],
      };
  }
}
