// The Lightning Address route (LUD-16). It sends each /.well-known/lnurlp request to the API app in server/app.ts.
// The LNURL callback is under /api, so the API route serves it.
import { handle } from 'hono/vercel';
import { app } from '../../../../../server/app.ts';

export const GET = handle(app);
