# Cloud backend files added

- `Dockerfile` — installs GNU Octave + headless plotting packages, runs as non-root.
- `cloud-api.js` — authenticated API endpoints `/healthz`, `/api/status`, `/api/run`.
- `functions/api/status.js` — Cloudflare Pages Function proxy for status.
- `functions/api/run.js` — Cloudflare Pages Function proxy for code execution.
- `CLOUD-DEPLOYMENT-STEP-BY-STEP.md` — staged test and deployment instructions.

Existing `server.js` and frontend files are preserved. The cloud API is only a staged prototype. It does not implement per-job sandbox isolation or block outbound network access; do not expose it for unrestricted public execution.
