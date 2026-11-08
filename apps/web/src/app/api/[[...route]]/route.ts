import { handle } from 'hono/vercel';
import { apiApp } from '@/server/app';

export const runtime = 'nodejs';

export const GET = handle(apiApp);
export const POST = handle(apiApp);
