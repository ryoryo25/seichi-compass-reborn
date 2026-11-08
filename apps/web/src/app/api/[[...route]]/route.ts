import { apiApp } from '@seichi/api';
import { handle } from 'hono/vercel';

export const runtime = 'nodejs';

export const GET = handle(apiApp);
export const POST = handle(apiApp);
export const PUT = handle(apiApp);
export const PATCH = handle(apiApp);
export const DELETE = handle(apiApp);
export const OPTIONS = handle(apiApp);
