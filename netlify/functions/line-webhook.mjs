import { verifySignature, handleWebhook, lineEnabled } from '../../lib/line.mjs';

export default async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  if (!lineEnabled()) return new Response('LINE not configured', { status: 503 });
  const body = await req.text();
  if (!verifySignature(body, req.headers.get('x-line-signature'))) return new Response('bad signature', { status: 401 });
  try {
    await handleWebhook(body);
  } catch (err) {
    console.error(err);
  }
  return new Response('ok');
};

export const config = { path: '/line/webhook' };
