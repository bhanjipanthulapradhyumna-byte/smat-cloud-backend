# SMAT cloud backend prototype — deployment guide

## What this package does

- Keeps the existing SMAT frontend and local `server.js` unchanged.
- Adds `cloud-api.js`, a GNU Octave HTTP API intended for private/staged cloud testing.
- Adds a Dockerfile that installs GNU Octave, headless plotting support, and runs as a non-root Linux user.
- Adds Cloudflare Pages Functions at `functions/api/status.js` and `functions/api/run.js`. These proxy requests from the existing frontend to the backend while keeping the backend token server-side.

## Critical safety limitation

**This is a cloud integration prototype, not a production security sandbox. Do not enable unrestricted public execution of arbitrary user code.** A container and an API token are not sufficient isolation. Octave programs may attempt network access, consume resources, or exploit software vulnerabilities. Before opening execution to the public, put each job in a separately restricted runner with enforced CPU/memory/process/disk quotas, no network by default, no cloud credentials, short lifetime, and a tested isolation boundary. Add rate limiting and abuse monitoring at the edge. Do not attach privileged cloud service accounts to the runner.

The `cloud-api.js` includes an API-token check, request/output bounds, a single active run per instance, a timeout, a temporary working directory, and a minimal environment passed to Octave. These are defense-in-depth measures, not a sandbox.

## Part A — test the Docker image locally first

Requirements: Docker Desktop installed and running.

From this folder, build the image:

```bash
docker build -t smat-octave-cloud .
```

Create a long random token and run the container. Replace `REPLACE_WITH_A_LONG_RANDOM_SECRET` with a random secret of at least 32 bytes. Do not commit it to source control.

```bash
docker run --rm --name smat-cloud-test \
  -p 127.0.0.1:8080:8080 \
  -e SMAT_API_TOKEN=REPLACE_WITH_A_LONG_RANDOM_SECRET \
  --memory=1g --cpus=1 --pids-limit=128 \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --cap-drop=ALL --security-opt=no-new-privileges \
  smat-octave-cloud
```

If Octave requires additional writable paths in this read-only test, do not casually remove all restrictions; investigate the exact required path and allow only that path. Then, in another terminal, check health:

```bash
curl http://127.0.0.1:8080/healthz
```

Check authenticated status (replace the token):

```bash
curl -H "Authorization: Bearer REPLACE_WITH_A_LONG_RANDOM_SECRET" http://127.0.0.1:8080/api/status
```

Test a simple script:

```bash
curl -X POST http://127.0.0.1:8080/api/run \
  -H "Authorization: Bearer REPLACE_WITH_A_LONG_RANDOM_SECRET" \
  -H "Content-Type: application/json" \
  --data '{"code":"A = [2 1; 1 -1]; b = [5; 1]; disp(A\\b); x = 0:0.1:6.28; plot(x,sin(x));"}'
```

Do not publish this test token. The local port is bound to loopback only.

## Part B — deploy a private/staged backend

A container host such as Google Cloud Run can host the image, but it is usage-based and requires billing setup. Free-tier eligibility and charges can change; verify current pricing before deploying. Budget alerts are not hard spending caps.

1. Create a dedicated cloud project for SMAT.
2. Enable the required container build/deploy services and configure billing only after checking pricing.
3. Store a strong random value as a Secret Manager secret named `smat-api-token`.
4. Build and push this Docker image to the provider's container registry.
5. Deploy the image as a low-capacity staged service with a low maximum instance count, a bounded request timeout, and no privileged service account permissions. Configure `SMAT_API_TOKEN` from Secret Manager and `SMAT_TIMEOUT_MS=30000`.
6. Keep the backend URL private from ordinary users where the platform permits. If the provider requires a publicly reachable endpoint, the application token is an additional gate—not a replacement for sandboxing.
7. Test `/healthz` and `/api/status`. Then test matrix output and plot output using the token. Do not test malicious scripts on this prototype.

Exact cloud CLI commands vary by project, region, registry, and current provider UI. Review provider documentation before running commands that create billable resources.

## Part C — connect Cloudflare Pages

The `functions/` folder must be deployed with the frontend as Cloudflare Pages Functions. Do not upload just the `index.html` file if you need the API routes.

In the Cloudflare Pages project, add these **server-side** environment variables/secrets for the Production environment (and Preview only if needed):

- `SMAT_BACKEND_URL`: the HTTPS base URL of the staged backend, without `/api/run` at the end.
- `SMAT_BACKEND_TOKEN`: the same strong token configured as `SMAT_API_TOKEN` on the backend.

Use the dashboard's secret option for the token. Never place the token in `app.js`, `index.html`, a `VITE_` variable, or any other browser-visible file.

Deploy the whole project folder, including `functions/api/run.js` and `functions/api/status.js`. After deployment, the existing frontend's relative calls to `/api/status` and `/api/run` should be routed through these Pages Functions. Confirm in browser developer tools that the browser talks to your Cloudflare Pages domain and that the token is never present in browser requests.

## Part D — staged verification

- [ ] `/api/status` reports `octave: true` through the Cloudflare website.
- [ ] Matrix arithmetic and `A\\b` return correct output.
- [ ] 2-D plot displays on the website.
- [ ] PNG and TXT download workflows still work.
- [ ] A script exceeding the timeout is stopped.
- [ ] A request without the backend token receives `401` directly from the backend.
- [ ] Oversized requests are rejected.
- [ ] The site works from a phone while the PC is off.
- [ ] Logs and billing dashboard show no unexpected usage.

Passing this checklist proves the staged integration works; it does **not** certify the service as safe for unrestricted public code execution. Do not announce public arbitrary-code execution until the isolated job runner, network restrictions, hard resource quotas, rate limits, and abuse controls have been implemented and independently tested.
