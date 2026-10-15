// Cloudflare Pages Function: forwards status to the private Octave backend.
// Set SMAT_BACKEND_URL and SMAT_BACKEND_TOKEN as Pages environment secrets/variables.
export async function onRequest({ request, env }) {
  if (!env.SMAT_BACKEND_URL || !env.SMAT_BACKEND_TOKEN) {
    return Response.json({ ok: false, stderr: 'Cloud execution backend is not configured.', octave: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const url = new URL('/api/status', env.SMAT_BACKEND_URL);
  const upstream = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${env.SMAT_BACKEND_TOKEN}` } });
  return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
