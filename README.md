# SMAT Scientific Computing Studio — Octave-powered upgrade

SMAT keeps its existing responsive UI and adds an optional real GNU Octave execution engine for broader MATLAB-language compatibility.

## Windows setup
1. Install Node.js LTS: https://nodejs.org/
2. Install GNU Octave: https://octave.org/download/ . SMAT finds it automatically (PATH, the default `C:\Program Files\GNU Octave\...` folder, or the `OCTAVE_PATH` environment variable pointing at `octave-cli.exe`).
3. Extract this ZIP to a normal folder (not inside a browser cache).
4. Double-click `START-SMAT-WINDOWS.bat`.
5. Open the address printed in the terminal, normally http://127.0.0.1:8080 . Keep the terminal open while using SMAT. The terminal also tells you whether Octave was found; if not, SMAT falls back to the built-in browser engine.
6. Load a `.m` script and press Run. When served through this local server, scripts are executed by GNU Octave rather than the limited in-browser interpreter. Plots are exported from Octave into the plot pane.

## MATLAB-style examples included
The Help & examples page now includes runnable starter scripts for arithmetic, matrices, 2-D plotting, loops, vectorization, logical indexing, statistics, user-defined functions, root finding (`fzero`), ODE solving (`ode45`), 3-D surfaces (`surf`), and complex numbers. Advanced examples require GNU Octave; the browser fallback intentionally supports a smaller subset.

## Compatibility expectations
SMAT executes `.m` scripts with GNU Octave when launched through the included local server and Octave is installed. This covers a broad practical portion of MATLAB syntax, but **cannot guarantee every MATLAB program**. Programs depending on MathWorks-only toolboxes, Simulink, App Designer, proprietary functions, hardware interfaces, or version-specific behaviour may need adaptation. GNU Octave packages may also need to be installed separately. Always check the Octave error output and consult the GNU Octave documentation when a function is unavailable.

## Additional runnable examples\nSee the `examples/` folder for separate `.m` files covering matrix left division, loops, 2-D graphs, circles, polygons, 3-D surfaces, contours, 3-D parametric curves, root finding and ODE solving. See `COMPATIBILITY-AND-DEPLOYMENT.md` for public-hosting limitations and the recommended safe architecture.\n\n## Local execution guardrails
The local bridge now includes basic guardrails for a single-user local workspace:
- Script request body capped at 256 KB.
- One active Octave run at a time; extra run requests receive HTTP 429.
- Execution timeout configurable with `SMAT_TIMEOUT_MS` (1–60 seconds; default 30 seconds).
- Console output is capped, and oversized automatic plot output is omitted.
- Each run gets a fresh temporary directory that is removed after completion.
- Timeout handling attempts to terminate the Octave process tree.

These are reliability guardrails, **not a security sandbox**. An Octave script can still perform actions available to the Windows account running SMAT, and temporary disk usage is not fully quota-controlled. Only run code you trust. Keep the service bound to `127.0.0.1`; do not expose it directly to the public internet.

## Test it
Try:
```matlab
x = 0:0.1:10;
y = exp(-0.3*x).*sin(2*pi*x);
plot(x,y);
title('Damped signal');
xlabel('Time (s)');
ylabel('Amplitude');
```

## Important scope and safety
- This is a substantial compatibility upgrade, not a claim of perfect MATLAB/MathWorks equivalence. GNU Octave supports much of the MATLAB language but differs in some functions, toolboxes, Simulink, app-building, and edge cases. See https://octave.org/ and https://docs.octave.org/.
- SMAT invokes local Octave on your computer. Treat `.m` files as executable code and only run scripts you trust.
- The included server binds only to `127.0.0.1` and has no authentication because it is intended for local use. It rejects requests whose Host/Origin are not `127.0.0.1`/`localhost` or whose content type is not JSON, so other websites open in your browser cannot send scripts to it. Do not change it to listen on a public interface or expose its execution endpoint to the internet.
- The original browser interpreter remains as a fallback when opening `index.html` directly, but it supports only a subset of MATLAB syntax (arithmetic, ranges, vectors/matrices and indexing, `for`/`while`/`if`, common math functions, `fprintf`, 2-D line plots). It does not support user-defined functions, `switch`, `try`, cell arrays or complex numbers. Use the local server for Octave execution.
- Google Identity Services provides a browser-only profile display after a Google Web client ID is configured. It does not create a server session or protect data. No Firebase, Google API scopes beyond basic identity, or MathWorks software is included.

## Files
- `index.html`, `style.css`, `app.js`: existing SMAT UI and fallback browser engine
- `server.js`: local static server and Octave execution bridge
- `START-SMAT-WINDOWS.bat`: Windows launcher
- `package.json`: Node runtime metadata
- `assets/smat-logo.png`: SMAT logo; `assets/favicon.png`: small browser-tab icon

## Browser-saved programs
The web interface's **Save** action asks for a filename and writes a `.m` file to a chosen local location in browsers that support the file-save picker. Other browsers download it to their configured Downloads location. When browser storage permits, a quick-reopen copy is also kept in the Saved Programs list; that list is local to the browser and does not sync. **Export** remains a direct download.

The **SMAT** wordmark uses the self-hosted Amoria WOFF2 font in `assets/amoria.woff2`; the “Signal playground” heading remains in the standard interface font. The supplied font is marked **personal use only; no commercial use allowed**. Its accompanying personal-use notice is included in `assets/AMORIA-PERSONAL-USE-NOTICE.txt`. Obtain the commercial webfont license before any commercial use.

## Google profile sign-in
The Profile page uses Google Identity Services. Add your public Web application client ID to `google-auth-config.js` and authorize the site's exact JavaScript origin in Google Cloud Console; follow `GOOGLE-OAUTH-SETUP.md`. Never add a client secret to browser code. This static implementation displays the account name, email, and photo only; it does not verify a server session, store the ID token, protect scripts, or sync profiles.
