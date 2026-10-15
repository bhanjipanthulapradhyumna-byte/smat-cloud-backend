'use strict';
// Local-only SMAT bridge to GNU Octave. Do not expose this server to the public internet.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT, 10) || 8080;
const MAX_BODY = 256 * 1024;
const MAX_OUTPUT_BYTES = 200 * 1024;
const requestedTimeout = Number.parseInt(process.env.SMAT_TIMEOUT_MS, 10) || 30000;
const TIMEOUT_MS = Math.max(1000, Math.min(requestedTimeout, 60000));
let activeRuns = 0;
const MAX_CONCURRENT_RUNS = 1;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.otf': 'font/otf' };
const PUBLIC_FILES = new Set(['/index.html', '/style.css', '/app.js', '/google-auth-config.js']);   // plus everything under /assets/
// Only these Host / Origin values are accepted. This blocks other websites open in the
// user's browser from sending scripts to /api/run (CSRF) or reaching it via DNS rebinding.
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://*.googleusercontent.com; connect-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://accounts.google.com"
};

function send(res, status, obj) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/* ---------------------------------------------------------------- Octave lookup */
function works(exe) {
  try { const r = spawnSync(exe, ['--version'], { timeout: 20000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); return r.status === 0; }
  catch { return false; }
}
function findOctave() {
  const candidates = [];
  if (process.env.OCTAVE_PATH) candidates.push(process.env.OCTAVE_PATH);
  candidates.push('octave-cli', 'octave');
  if (process.platform === 'win32') {   // the Windows installer does not add Octave to PATH by default
    const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files'].filter(Boolean);
    for (const base of new Set(bases)) {
      try {
        const dir = path.join(base, 'GNU Octave');
        const versions = fs.readdirSync(dir).filter(d => /^Octave-/i.test(d)).sort().reverse();
        for (const v of versions) for (const exe of ['octave-cli.exe', 'octave.exe']) candidates.push(path.join(dir, v, 'mingw64', 'bin', exe));
      } catch { /* folder not present */ }
    }
  }
  for (const c of candidates) if (works(c)) return c;
  return null;
}
let octaveExe = null;

/* ------------------------------------------------------------------ execution */
function killProcessTree(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      // `child.kill()` alone can leave Octave descendants running on Windows.
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true, stdio: 'ignore'
      }).on('error', () => { try { child.kill(); } catch {} });
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch { try { child.kill('SIGKILL'); } catch {} }
    }
  } catch { try { child.kill('SIGKILL'); } catch {} }
}

function runOctave(code) {
  return new Promise(resolve => {
    if (activeRuns >= MAX_CONCURRENT_RUNS) {
      return resolve({ ok: false, stdout: '', stderr: 'SMAT is already running a program. Wait for it to finish, then try again.', plot: null, busy: true });
    }
    activeRuns++;
    const releaseRun = () => { activeRuns = Math.max(0, activeRuns - 1); };
    if (!octaveExe) octaveExe = findOctave();
    if (!octaveExe) {
      releaseRun();
      return resolve({ ok: false, stdout: '', stderr: 'Could not find GNU Octave. Install it from https://octave.org/download/ (or set OCTAVE_PATH to the octave executable) and try again.', plot: null });
    }
    let dir;
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smat-'));
      const file = path.join(dir, 'smat_script.m');
      fs.writeFileSync(file, code + "\ntry; drawnow(); if ~isempty(get(0,'children')), print('-dpng','smat_plot.png'); end; catch; end;\n", 'utf8');
      const child = spawn(octaveExe, ['--quiet', '--no-gui', 'smat_script.m'], {
        cwd: dir, windowsHide: true, detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '', stderr = '', done = false, timedOut = false, outputTruncated = false;
      const appendLimited = (current, chunk) => {
        const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(current, 'utf8');
        if (remaining <= 0) { outputTruncated = true; return current; }
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        if (buf.length > remaining) outputTruncated = true;
        return current + buf.subarray(0, remaining).toString('utf8');
      };
      const finish = (ok, extra = {}) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        let plot = null;
        try {
          const f = path.join(dir, 'smat_plot.png');
          if (fs.existsSync(f) && fs.statSync(f).size <= 5 * 1024 * 1024) plot = fs.readFileSync(f).toString('base64');
          else if (fs.existsSync(f)) stderr = appendLimited(stderr, '\nSMAT plot omitted because it exceeds the 5 MB limit.');
        } catch {}
        if (outputTruncated) stderr = appendLimited(stderr, '\nSMAT output was truncated at the configured limit.');
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
        releaseRun();
        resolve({ ok, stdout, stderr, plot, ...extra });
      };
      child.stdout.on('data', d => { stdout = appendLimited(stdout, d); });
      child.stderr.on('data', d => { stderr = appendLimited(stderr, d); });
      child.on('error', e => {
        octaveExe = null;
        finish(false, { stderr: 'Could not start GNU Octave. Check the installation and OCTAVE_PATH. Details: ' + e.message });
      });
      child.on('close', status => finish(status === 0 && !timedOut, timedOut
        ? { stderr: appendLimited(stderr, `\nSMAT stopped execution after ${Math.round(TIMEOUT_MS / 1000)} seconds.`) }
        : {}));
      const timer = setTimeout(() => {
        timedOut = true;
        killProcessTree(child);
        setTimeout(() => finish(false, {
          stderr: appendLimited(stderr, `\nSMAT stopped execution after ${Math.round(TIMEOUT_MS / 1000)} seconds.`)
        }), 1500);
      }, TIMEOUT_MS);
    } catch (e) {
      if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
      releaseRun();
      resolve({ ok: false, stdout: '', stderr: 'Could not prepare the execution workspace: ' + e.message, plot: null });
    }
  });
}

/* --------------------------------------------------------------------- server */
const server = http.createServer((req, res) => {
  const host = String(req.headers.host || '').toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return send(res, 403, { ok: false, stderr: 'Forbidden host.' });
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://' + host).pathname); }
  catch { return send(res, 400, { ok: false, stderr: 'Bad request.' }); }

  if (req.method === 'GET' && pathname === '/api/status') {
    if (!octaveExe) octaveExe = findOctave();
    return send(res, 200, { ok: true, engine: 'GNU Octave bridge', octave: !!octaveExe });
  }
  if (pathname === '/api/run') {
    if (req.method !== 'POST') return send(res, 405, { ok: false, stderr: 'Use POST.' });
    if (req.headers.origin && !ALLOWED_ORIGINS.has(req.headers.origin)) return send(res, 403, { ok: false, stderr: 'Forbidden origin.' });
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(res, 415, { ok: false, stderr: 'Content-Type must be application/json.' });
    const chunks = []; let size = 0, tooBig = false;
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) tooBig = true; else chunks.push(chunk); });
    req.on('error', () => { /* client went away */ });
    req.on('end', async () => {
      if (tooBig) return send(res, 413, { ok: false, stderr: 'Script is too large (1 MB limit).' });
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
      catch (e) { return send(res, 400, { ok: false, stderr: 'Invalid request: ' + e.message }); }
      if (!data || typeof data.code !== 'string') return send(res, 400, { ok: false, stderr: 'Expected a code string.' });
      if (Buffer.byteLength(data.code, 'utf8') > MAX_BODY) return send(res, 413, { ok: false, stderr: 'Script is too large (256 KB limit).' });
      try {
        const result = await runOctave(data.code);
        send(res, result.busy ? 429 : 200, result);
      }
      catch (e) { send(res, 500, { ok: false, stderr: 'Internal error: ' + e.message }); }
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); return res.end('Method not allowed'); }
  if (pathname === '/') pathname = '/index.html';
  if (!PUBLIC_FILES.has(pathname) && !pathname.startsWith('/assets/')) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
  const full = path.resolve(ROOT, '.' + pathname);
  if (!full.startsWith(ROOT + path.sep)) { res.writeHead(403, SECURITY_HEADERS); return res.end('Forbidden'); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Close the other SMAT window, or start on another port (for example: set PORT=8081 and run again).`);
  else console.error('Server error: ' + e.message);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`SMAT local workspace: http://127.0.0.1:${PORT}`);
  console.log('Local-only server. Keep this terminal open.');
  octaveExe = findOctave();
  console.log(octaveExe
    ? `GNU Octave found: ${octaveExe}`
    : 'GNU Octave was NOT found. SMAT will use its built-in browser engine until Octave is installed (https://octave.org/download/) or OCTAVE_PATH is set.');
});
