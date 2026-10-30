// The API route. It sends each /api request to the API app in server/app.ts.
// The app makes the node clients from .env at the first request. After npm run network, restart npm run dev.
import { handle } from 'hono/vercel';
import { app } from '../../../../server/app.ts';

export const GET = handle(app);
export const POST = handle(app);
