import type { ExplorerSettings } from '@seichi/shared';
import {
  boolean,
  doublePrecision,
  geometry,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Better Auth 標準 + 聖地コンパス拡張ユーザーテーブル
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  isAnonymous: boolean('is_anonymous').notNull().default(true),
  role: text('role').notNull().default('user'), // 'user' | 'admin'
  publicProfileStats: boolean('public_profile_stats').notNull().default(true),
  settingsJson: jsonb('settings_json').$type<ExplorerSettings>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('accounts_user_id_idx').on(t.userId)],
);

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

/**
 * 聖地スポット（物理的な場所 1件に対し複数エピソードが紐づく）
 */
export const spots = pgTable(
  'spots',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').notNull().default('hinatazaka46'),
    title: text('title').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    /** PostGIS Point(lng, lat) SRID 4326 — ST_DWithin や <-> GiST近傍検索に使用 */
    location: geometry('location', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
    prefecture: text('prefecture').notNull(),
    arrivalRadiusMeters: integer('arrival_radius_meters').notNull().default(80),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('spots_location_gist_idx').using('gist', t.location),
    index('spots_group_pref_idx').on(t.groupId, t.prefecture),
  ],
);

export const spotEpisodes = pgTable(
  'spot_episodes',
  {
    id: text('id').primaryKey(),
    spotId: text('spot_id')
      .notNull()
      .references(() => spots.id, { onDelete: 'cascade' }),
    mediaCategory: text('media_category').notNull(),
    description: text('description').notNull(),
    referenceUrl: text('reference_url'),
    youtubeVideoId: text('youtube_video_id'),
    videoStartSec: integer('video_start_sec'),
    members: jsonb('members').$type<string[]>().notNull().default([]),
    hashtags: jsonb('hashtags').$type<string[]>().notNull().default([]),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('spot_episodes_spot_id_idx').on(t.spotId)],
);

/**
 * 訪問・ギブアップ記録 ＆ 自分専用の非公開アルバム（R2オブジェクトキー）
 */
export const visits = pgTable(
  'visits',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    spotId: text('spot_id')
      .notNull()
      .references(() => spots.id, { onDelete: 'cascade' }),
    status: text('status').notNull(), // 'visited' | 'give_up'
    selfDiscovered: boolean('self_discovered').notNull().default(false),
    privateMemo: text('private_memo'),
    /** Cloudflare R2 非公開オブジェクトキー（オーナー本人のみ閲覧可） */
    privatePhotoR2Key: text('private_photo_r2_key'),
    privatePhotoMime: text('private_photo_mime'),
    visitedAt: timestamp('visited_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('visits_user_spot_unique_idx').on(t.userId, t.spotId)],
);

export const spotComments = pgTable(
  'spot_comments',
  {
    id: text('id').primaryKey(),
    spotId: text('spot_id')
      .notNull()
      .references(() => spots.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    authorName: text('author_name').notNull(),
    content: text('content').notNull(),
    isPublic: boolean('is_public').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('spot_comments_spot_id_idx').on(t.spotId)],
);

export const spotReports = pgTable(
  'spot_reports',
  {
    id: text('id').primaryKey(),
    spotId: text('spot_id')
      .notNull()
      .references(() => spots.id, { onDelete: 'cascade' }),
    reporterUserId: text('reporter_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    detail: text('detail'),
    status: text('status').notNull().default('open'), // 'open' | 'resolved' | 'dismissed'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('spot_reports_status_idx').on(t.status)],
);
