import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import type { Spot } from '@seichi/shared';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-http';
import { spotEpisodes, spots } from '../packages/db/src/schema.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.resolve(__dirname, '../packages/db/seed/hinatazaka-spots.json');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Error: DATABASE_URL environment variable is required to seed Neon PostgreSQL.');
  process.exit(1);
}

const client = neon(databaseUrl);
const db = drizzle(client);

async function main() {
  console.log('Enabling PostGIS extension on Neon...');
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS postgis;`);

  const rawSpots = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as Spot[];
  console.log(`Loaded ${rawSpots.length} spots from seed JSON.`);

  const chunkSize = 200;
  for (let i = 0; i < rawSpots.length; i += chunkSize) {
    const batch = rawSpots.slice(i, i + chunkSize);
    await db
      .insert(spots)
      .values(
        batch.map((s) => ({
          id: s.id,
          groupId: s.groupId,
          title: s.title,
          lat: s.lat,
          lng: s.lng,
          location: { x: s.lng, y: s.lat },
          prefecture: s.prefecture,
          arrivalRadiusMeters: s.arrivalRadiusMeters,
        })),
      )
      .onConflictDoNothing();
    console.log(`Inserted spots ${i + 1}..${Math.min(i + chunkSize, rawSpots.length)}`);
  }

  const allEpisodes = rawSpots.flatMap((s) => s.episodes);
  for (let i = 0; i < allEpisodes.length; i += chunkSize) {
    const batch = allEpisodes.slice(i, i + chunkSize);
    await db
      .insert(spotEpisodes)
      .values(
        batch.map((e) => ({
          id: e.id,
          spotId: e.spotId,
          mediaCategory: e.mediaCategory,
          description: e.description,
          referenceUrl: e.referenceUrl,
          youtubeVideoId: e.youtubeVideoId,
          videoStartSec: e.videoStartSec,
          members: e.members,
          hashtags: e.hashtags,
          createdBy: 'seed',
        })),
      )
      .onConflictDoNothing();
  }

  console.log(`Successfully seeded ${rawSpots.length} spots and ${allEpisodes.length} episodes to Neon PostGIS!`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
