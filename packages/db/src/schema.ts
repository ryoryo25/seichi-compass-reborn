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
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * 本番環境用スキーマ定義 (Neon Serverless PostgreSQL + PostGIS + Better Auth 連携)
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique(),
  isAnonymous: boolean('is_anonymous').notNull().default(true),
  role: text('role').notNull().default('user'), // 'user' | 'admin'
  publicProfileStats: boolean('public_profile_stats').notNull().default(true),
  settingsJson: jsonb('settings_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const spots = pgTable(
  'spots',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').notNull().default('hinatazaka46'),
    title: text('title').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    /** PostGIS Point(lng, lat) SRID 4326 — ST_DWithin や <-> 近傍検索に使用 */
    location: geometry('location', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
    prefecture: text('prefecture').notNull(),
    arrivalRadiusMeters: integer('arrival_radius_meters').notNull().default(80),
    createdBy: text('created_by').references(() => users.id),
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

export const visits = pgTable(
  'visits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    spotId: text('spot_id')
      .notNull()
      .references(() => spots.id, { onDelete: 'cascade' }),
    status: text('status').notNull(), // 'visited' | 'give_up'
    selfDiscovered: boolean('self_discovered').notNull().default(false),
    privateMemo: text('private_memo'),
    /** Cloudflare R2 非公開オブジェクトキー（オーナー本人のみ署名URL経由で閲覧可） */
    privatePhotoR2Key: text('private_photo_r2_key'),
    visitedAt: timestamp('visited_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('visits_user_spot_idx').on(t.userId, t.spotId)],
);

export const spotComments = pgTable(
  'spot_comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
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
