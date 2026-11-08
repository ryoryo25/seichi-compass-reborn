import { neon } from '@neondatabase/serverless';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { anonymous } from 'better-auth/plugins';
import { drizzle } from 'drizzle-orm/neon-http';
import { NeonPostgisRepository } from './neon-repository.ts';
import * as schema from './schema.ts';

export interface BetterAuthEnv {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL?: string;
  TWITTER_CLIENT_ID?: string;
  TWITTER_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_CLIENT_SECRET?: string;
}

/**
 * 本番用 Better Auth インスタンス生成（X / Google / Apple ソーシャルログイン ＋ 匿名ゲスト引き継ぎ対応）
 */
export function createBetterAuth(env: BetterAuthEnv) {
  const sqlClient = neon(env.DATABASE_URL);
  const db = drizzle(sqlClient, { schema });
  const repo = new NeonPostgisRepository(env.DATABASE_URL);

  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (env.TWITTER_CLIENT_ID && env.TWITTER_CLIENT_SECRET) {
    socialProviders.twitter = {
      clientId: env.TWITTER_CLIENT_ID,
      clientSecret: env.TWITTER_CLIENT_SECRET,
    };
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    };
  }
  if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET) {
    socialProviders.apple = {
      clientId: env.APPLE_CLIENT_ID,
      clientSecret: env.APPLE_CLIENT_SECRET,
    };
  }

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth/oauth',
    database: drizzleAdapter(db, {
      provider: 'pg',
      usePlural: true,
      schema,
    }),
    emailAndPassword: {
      enabled: true,
    },
    socialProviders,
    plugins: [
      anonymous({
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await repo.mergeAnonymousUserData(anonymousUser.user.id, newUser.user.id);
        },
      }),
    ],
  });
}
