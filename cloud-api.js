'use strict';
// SMAT cloud API prototype. This is an authenticated bridge, NOT a security sandbox.
// Do not expose arbitrary user-submitted code publicly until an isolated runner is added.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PORT = Number.parseInt(process.env.PORT || '8080', 10);
const TOKEN = process.env.SMAT_API_TOKEN || '';
const MAX_BODY = 256 * 1024;
const MAX_OUTPUT = 200 * 1024;
const MAX_PLOT = 5 * 1024 * 1024;
const TIMEOUT_MS = Math.max(1000, Math.min(Number.parseInt(process.env.SMAT_TIMEOUT_MS || '30000', 10), 60000));
let active = false;
let octavePath = process.env.OCTAVE_PATH || 'octave-cli';
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY'
};
function send(res, status, body) { if (!res.headersSent) res.writeHead(status, HEADERS); res.end(JSON.stringify(body)); }
function findOctave() {
  for (const exe of [octavePath, 'octave-cli', 'octave']) {
    try { const r = spawnSync(exe, ['--version'], { timeout: 5000, stdio: 'ignore', env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: '/tmp' } }); if (r.status === 0) { octavePath = exe; return true; } } catch {}
  }
  return false;
}
function kill(child) { if (!child?.pid) return; try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } }
function runOctave(code) {
  return new Promise(resolve => {
    if (active) return resolve({ status: 429, data: { ok: false, stdout: '', stderr: 'SMAT is busy. Please retry shortly.', plot: null, busy: true } });
    active = true;
    let dir = null, child = null, timer = null, settled = false, timedOut = false, truncated = false;
    let stdout = '', stderr = '';
    const finish = (ok, extra = {}) => {
      if (settled) return; settled = true; clearTimeout(timer);
      let plot = null;
      try { const p = path.join(dir, 'smat_plot.png'); if (fs.existsSync(p) && fs.statSync(p).size <= MAX_PLOT) plot = fs.readFileSync(p).toString('base64'); else if (fs.existsSync(p)) stderr += '\nSMAT plot omitted: file exceeds 5 MB.'; } catch {}
      if (truncated) stderr += '\nSMAT output was truncated at the configured limit.';
      try { if (dir) fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      active = false;
      resolve({ status: extra.busy ? 429 : 200, data: { ok, stdout, stderr, plot, ...extra } });
    };
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smat-job-'));
      fs.writeFileSync(path.join(dir, 'smat_script.m'), code + "\ntry; drawnow(); if ~isempty(get(0,'children')), print('-dpng','smat_plot.png'); end; catch; end;\n", { encoding: 'utf8', mode: 0o600 });
      // Deliberately pass a minimal environment; the API token is never inherited by Octave.
      const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: dir, TMPDIR: dir, LANG: 'C.UTF-8', GNUTERM: 'dumb' };
      child = spawn(octavePath, ['--quiet', '--no-gui', 'smat_script.m'], { cwd: dir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const append = (current, chunk) => { const remain = MAX_OUTPUT - Buffer.byteLength(current, 'utf8'); if (remain <= 0) { truncated = true; return current; } const b = Buffer.from(chunk); if (b.length > remain) truncated = true; return current + b.subarray(0, remain).toString('utf8'); };
      child.stdout.on('data', b => { stdout = append(stdout, b); });
      child.stderr.on('data', b => { stderr = append(stderr, b); });
      child.on('error', e => finish(false, { stderr: 'Could not start GNU Octave: ' + e.message }));
      child.on('close', status => finish(status === 0 && !timedOut, timedOut ? { stderr: stderr + `\nSMAT stopped execution after ${Math.round(TIMEOUT_MS / 1000)} seconds.` } : {}));
      timer = setTimeout(() => { timedOut = true; kill(child); setTimeout(() => finish(false, { stderr: stderr + `\nSMAT stopped execution after ${Math.round(TIMEOUT_MS / 1000)} seconds.` }), 1200).unref(); }, TIMEOUT_MS);
    } catch (e) { try { if (dir) fs.rmSync(dir, { recursive: true, force: true }); } catch {} active = false; resolve({ status: 500, data: { ok: false, stdout: '', stderr: 'Could not prepare execution workspace.', plot: null } }); }
  });
}
const server = http.createServer((req, res) => {
  if (req.url?.split('?')[0] === '/healthz' && req.method === 'GET') return send(res, 200, { ok: true, service: 'smat-cloud-api' });
  if (!TOKEN) return send(res, 503, { ok: false, stderr: 'SMAT_API_TOKEN is not configured.' });
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { ok: false, stderr: 'Unauthorized.' });
  const route = req.url?.split('?')[0];
  if (route === '/api/status' && req.method === 'GET') return send(res, 200, { ok: true, engine: 'GNU Octave cloud bridge', octave: findOctave() });
  if (route !== '/api/run') return send(res, 404, { ok: false, stderr: 'Not found.' });
  if (req.method !== 'POST') return send(res, 405, { ok: false, stderr: 'Use POST.' });
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(res, 415, { ok: false, stderr: 'Content-Type must be application/json.' });
  let size = 0, chunks = [], tooLarge = false;
  req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) tooLarge = true; else chunks.push(chunk); });
  req.on('end', async () => {
    if (tooLarge) return send(res, 413, { ok: false, stderr: 'Request exceeds 256 KB.' });
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return send(res, 400, { ok: false, stderr: 'Invalid JSON.' }); }
    if (typeof body.code !== 'string' || !body.code.trim()) return send(res, 400, { ok: false, stderr: 'Expected a non-empty code string.' });
    if (Buffer.byteLength(body.code, 'utf8') > MAX_BODY) return send(res, 413, { ok: false, stderr: 'Program exceeds 256 KB.' });
    if (!findOctave()) return send(res, 503, { ok: false, stderr: 'GNU Octave is unavailable.' });
    try { const result = await runOctave(body.code); send(res, result.status, result.data); } catch { send(res, 500, { ok: false, stderr: 'Execution service error.' }); }
  });
});
server.requestTimeout = 70000;
server.headersTimeout = 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`SMAT cloud API listening on ${PORT}`));
