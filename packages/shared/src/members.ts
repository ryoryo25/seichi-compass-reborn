export interface MemberInfo {
  id: string;
  name: string;
  generation: '1期生' | '2期生' | '3期生' | '4期生' | '5期生' | 'けやき坂・卒業生';
  graduated?: boolean;
}

/**
 * 日向坂46（けやき坂46含む）メンバーマスタ
 * 表記揺れ防止およびKML/説明文からの自動タグ抽出に使用
 */
export const HINATAZAKA_MEMBERS: readonly MemberInfo[] = [
  // 1期生（現役・卒業生）
  { id: 'iguchi-mao', name: '井口眞緒', generation: '1期生', graduated: true },
  { id: 'ushio-sarina', name: '潮紗理菜', generation: '1期生', graduated: true },
  { id: 'kakizaki-memi', name: '柿崎芽実', generation: '1期生', graduated: true },
  { id: 'kageyama-yuuka', name: '影山優佳', generation: '1期生', graduated: true },
  { id: 'kato-shiho', name: '加藤史帆', generation: '1期生', graduated: true },
  { id: 'saito-kyoko', name: '齊藤京子', generation: '1期生', graduated: true },
  { id: 'sasaki-kumi', name: '佐々木久美', generation: '1期生', graduated: true },
  { id: 'sasaki-mirei', name: '佐々木美玲', generation: '1期生', graduated: true },
  { id: 'takase-mana', name: '高瀬愛奈', generation: '1期生', graduated: true },
  { id: 'takamoto-ayaka', name: '高本彩花', generation: '1期生', graduated: true },
  { id: 'nagahama-neru', name: '長濱ねる', generation: 'けやき坂・卒業生', graduated: true },
  { id: 'higashimura-mei', name: '東村芽依', generation: '1期生', graduated: true },

  // 2期生
  { id: 'kanemura-miku', name: '金村美玖', generation: '2期生' },
  { id: 'kawata-hina', name: '河田陽菜', generation: '2期生' },
  { id: 'kosaka-nao', name: '小坂菜緒', generation: '2期生' },
  { id: 'tomita-suzuka', name: '富田鈴花', generation: '2期生' },
  { id: 'nibu-akari', name: '丹生明里', generation: '2期生', graduated: true },
  { id: 'hamagishi-hiyori', name: '濱岸ひより', generation: '2期生', graduated: true },
  { id: 'matsuda-konoka', name: '松田好花', generation: '2期生' },
  { id: 'miyata-manamo', name: '宮田愛萌', generation: '2期生', graduated: true },
  { id: 'watanabe-miho', name: '渡邉美穂', generation: '2期生', graduated: true },

  // 3期生
  { id: 'kamimura-hinano', name: '上村ひなの', generation: '3期生' },
  { id: 'takahashi-mikuni', name: '髙橋未来虹', generation: '3期生' },
  { id: 'morimoto-marie', name: '森本茉莉', generation: '3期生' },
  { id: 'yamaguchi-haruyo', name: '山口陽世', generation: '3期生' },

  // 4期生
  { id: 'ishizuka-tamaki', name: '石塚瑶季', generation: '4期生' },
  { id: 'kishi-honoka', name: '岸帆夏', generation: '4期生', graduated: true },
  { id: 'konishi-nanami', name: '小西夏菜実', generation: '4期生' },
  { id: 'shimizu-rio', name: '清水理央', generation: '4期生' },
  { id: 'shogenji-yoko', name: '正源司陽子', generation: '4期生' },
  { id: 'takeuchi-kirari', name: '竹内希来里', generation: '4期生' },
  { id: 'hirao-honoka', name: '平尾帆夏', generation: '4期生' },
  { id: 'hiraoka-mitsuki', name: '平岡海月', generation: '4期生' },
  { id: 'fujishima-kaho', name: '藤嶌果歩', generation: '4期生' },
  { id: 'miyachi-sumire', name: '宮地すみれ', generation: '4期生' },
  { id: 'yamashita-haruka', name: '山下葉留花', generation: '4期生' },
  { id: 'watanabe-rina', name: '渡辺莉奈', generation: '4期生' },

  // 5期生
  { id: 'oota-mizuki', name: '大田美月', generation: '5期生' },
  { id: 'oono-manami', name: '大野愛実', generation: '5期生' },
  { id: 'katayama-saki', name: '片山紗希', generation: '5期生' },
  { id: 'kuramori-hinano', name: '蔵盛妃那乃', generation: '5期生' },
  { id: 'sakai-niina', name: '坂井新奈', generation: '5期生' },
  { id: 'sato-yu', name: '佐藤優羽', generation: '5期生' },
  { id: 'shimoda-izuki', name: '下田衣珠季', generation: '5期生' },
  { id: 'takai-rika', name: '高井俐香', generation: '5期生' },
  { id: 'tsurusaki-niko', name: '鶴崎仁香', generation: '5期生' },
  { id: 'matsuo-sakura', name: '松尾桜', generation: '5期生' },
] as const;

const VARIANT_NAME_MAP: Record<string, string> = {
  高橋未来虹: '髙橋未来虹',
  齊藤京子: '齊藤京子',
  斉藤京子: '齊藤京子',
  渡邊美穂: '渡邉美穂',
};

/**
 * テキスト（聖地の説明文など）から登場しているメンバー名を自動抽出する
 */
export function extractMembersFromText(text: string): string[] {
  if (!text) return [];
  const normalized = text.replace(/\s+/g, '');
  const found = new Set<string>();

  for (const member of HINATAZAKA_MEMBERS) {
    if (normalized.includes(member.name)) {
      found.add(member.name);
    }
  }
  for (const [variant, canonical] of Object.entries(VARIANT_NAME_MAP)) {
    if (normalized.includes(variant)) {
      found.add(canonical);
    }
  }
  return Array.from(found);
}
