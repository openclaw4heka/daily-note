import { handleApi } from '../../lib/router.mjs';

export default (req) => handleApi(req, new URL(req.url).pathname.replace(/^\/api/, '') || '/');

export const config = { path: '/api/*' };
