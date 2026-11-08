import { z } from 'zod';

export const MediaCategorySchema = z.enum([
  'mv',
  'youtube',
  'blog_sns',
  'hinaai',
  'tv_magazine',
  'photobook',
  'bonus_video',
  'hit_prayer',
  'live_stage',
  'other',
]);
export type MediaCategory = z.infer<typeof MediaCategorySchema>;

export const MEDIA_CATEGORY_META: Record<
  MediaCategory,
  { label: string; shortLabel: string; color: string }
> = {
  mv: { label: 'MV・シングルロケ地', shortLabel: 'MV', color: '#0284c7' },
  youtube: { label: '日向坂ちゃんねる・YouTube', shortLabel: 'YouTube', color: '#dc2626' },
  blog_sns: { label: 'メンバーブログ・SNS', shortLabel: 'ブログ', color: '#0ea5e9' },
  hinaai: { label: 'ひなあい・冠番組', shortLabel: 'ひなあい', color: '#f59e0b' },
  tv_magazine: { label: '映画・ドラマ・TV・雑誌', shortLabel: 'TV・雑誌', color: '#8b5cf6' },
  photobook: { label: '写真集', shortLabel: '写真集', color: '#ec4899' },
  bonus_video: { label: 'CD特典映像・個人PV', shortLabel: '特典映像', color: '#14b8a6' },
  hit_prayer: { label: 'ヒット祈願', shortLabel: 'ヒット祈願', color: '#f97316' },
  live_stage: { label: 'ライブ会場・舞台', shortLabel: 'ライブ', color: '#6366f1' },
  other: { label: 'その他', shortLabel: 'その他', color: '#64748b' },
};

export const MaskLevelSchema = z.enum(['easy', 'normal', 'hard', 'full']);
export type MaskLevel = z.infer<typeof MaskLevelSchema>;

export const TagVisibilitySchema = z.enum([
  'all',
  'member_and_media',
  'media_only',
  'none',
]);
export type TagVisibility = z.infer<typeof TagVisibilitySchema>;

export const MapModeSchema = z.enum(['treasure', 'standard']);
export type MapMode = z.infer<typeof MapModeSchema>;

export const NotificationModeSchema = z.enum([
  'power_save',
  'out_and_about',
  'off',
]);
export type NotificationMode = z.infer<typeof NotificationModeSchema>;

export const ExplorerSettingsSchema = z.object({
  maskLevel: MaskLevelSchema.default('normal'),
  tagVisibility: TagVisibilitySchema.default('all'),
  mapMode: MapModeSchema.default('treasure'),
  notificationMode: NotificationModeSchema.default('power_save'),
  notificationRadiusMeters: z.number().min(100).max(2000).default(300),
  notificationCooldownHours: z.number().min(1).max(168).default(24),
  notificationMembers: z.array(z.string()).default([]),
  publicProfileStats: z.boolean().default(true),
  defaultPublicComment: z.boolean().default(true),
  nickname: z.string().min(1).max(30).default('おひさま探索者'),
});
export type ExplorerSettings = z.infer<typeof ExplorerSettingsSchema>;

export const SpotEpisodeSchema = z.object({
  id: z.string(),
  spotId: z.string(),
  mediaCategory: MediaCategorySchema,
  titleHint: z.string().optional(),
  description: z.string(),
  referenceUrl: z.string().optional(),
  youtubeVideoId: z.string().optional(),
  videoStartSec: z.number().int().nonnegative().optional(),
  members: z.array(z.string()),
  hashtags: z.array(z.string()),
  createdBy: z.string().default('system'),
  createdAt: z.string(),
});
export type SpotEpisode = z.infer<typeof SpotEpisodeSchema>;

export const SpotSchema = z.object({
  id: z.string(),
  groupId: z.string().default('hinatazaka46'),
  title: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  prefecture: z.string(),
  arrivalRadiusMeters: z.number().int().min(30).max(500).default(80),
  episodes: z.array(SpotEpisodeSchema).min(1),
  createdAt: z.string(),
});
export type Spot = z.infer<typeof SpotSchema>;

export const VisitStatusSchema = z.enum(['unvisited', 'visited', 'give_up']);
export type VisitStatus = z.infer<typeof VisitStatusSchema>;

/**
 * 到着前クライアントへ返却する虫食いサマリ（ネタバレ情報を含まない）
 */
export const MaskedSpotSummarySchema = z.object({
  id: z.string(),
  displayTitle: z.string(),
  isUnlocked: z.boolean(),
  visitStatus: VisitStatusSchema,
  selfDiscovered: z.boolean().default(false),
  distanceMeters: z.number(),
  bearingDeg: z.number(),
  arrivalRadiusMeters: z.number(),
  prefecture: z.string(),
  episodeCount: z.number(),
  visibleMediaCategories: z.array(MediaCategorySchema),
  visibleMembers: z.array(z.string()),
  visibleHashtags: z.array(z.string()),
  /** 宝探しモード用のぼかしレーダー座標 */
  radarLat: z.number(),
  radarLng: z.number(),
  /** 達成済み・ギブアップ済み・または通常聖地マップモード時のみ正確な座標を返す */
  exactLat: z.number().optional(),
  exactLng: z.number().optional(),
});
export type MaskedSpotSummary = z.infer<typeof MaskedSpotSummarySchema>;

export const CreateSpotInputSchema = z.object({
  existingSpotId: z.string().optional(),
  title: z.string().min(1).max(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  arrivalRadiusMeters: z.number().int().min(30).max(500).default(80),
  mediaCategory: MediaCategorySchema,
  description: z.string().min(1).max(1000),
  referenceUrl: z.string().max(500).optional().or(z.literal('')),
  members: z.array(z.string()).default([]),
  hashtags: z.array(z.string()).default([]),
});
export type CreateSpotInput = z.infer<typeof CreateSpotInputSchema>;

export const SpotCommentSchema = z.object({
  id: z.string(),
  spotId: z.string(),
  authorName: z.string(),
  content: z.string().min(1).max(300),
  isPublic: z.boolean(),
  createdAt: z.string(),
});
export type SpotComment = z.infer<typeof SpotCommentSchema>;
