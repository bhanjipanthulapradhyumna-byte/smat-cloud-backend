// Cloudflare Pages Function: forwards SMAT code to the private Octave backend.
// The backend token remains server-side and is never sent to browser JavaScript.
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return Response.json({ ok: false, stderr: 'Use POST.' }, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
  if (!env.SMAT_BACKEND_URL || !env.SMAT_BACKEND_TOKEN) {
    return Response.json({ ok: false, stderr: 'Cloud execution backend is not configured.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const type = request.headers.get('content-type') || '';
  if (!/^application\/json\b/i.test(type)) return Response.json({ ok: false, stderr: 'Content-Type must be application/json.' }, { status: 415, headers: { 'Cache-Control': 'no-store' } });
  const body = await request.arrayBuffer();
  if (body.byteLength > 256 * 1024) return Response.json({ ok: false, stderr: 'Request exceeds 256 KB.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
  const url = new URL('/api/run', env.SMAT_BACKEND_URL);
  const upstream = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${env.SMAT_BACKEND_TOKEN}`, 'Content-Type': 'application/json' }, body });
  return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
