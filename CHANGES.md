# Fixes in this version

## Crashes / broken features (browser engine and UI)
- **New script, Reset example, Help examples and Recent scripts all crashed** with `Cannot set properties of null` (code referenced a `crumbName` element that does not exist). Fixed.
- **The default example and every `0:0.1:10` range failed** ("Unexpected token :"): the range operator was tokenized but never parsed. Ranges now work (`a:b`, `a:s:b`).
- `.^` (element-wise power) was rejected; added.
- Unary minus precedence was wrong (`-2^2` gave 4, now -4); `^` is now left-associative like MATLAB/Octave.
- `for` loops: nested loops silently broke; `if`/`elseif`/`else`/`while`/`break`/`continue` were missing. Rewritten as a proper nested block parser with comparison/logical operators.
- Several statements on one line (`a=1; b=2;`) failed; `#` comments, `...` continuation, multi-line matrices, `x(i)` indexing, `x(i)=v` assignment, `x(end+1)`, `+=` all added.
- `disp(x)` without a semicolon printed twice. `trace()` always returned 0. `det(5)` threw an error. `transpose()` of a vector was wrong. `round(-2.5)` gave -2 (now -3 as in Octave). `Inf`, `NaN`, `e`, `eps`, `max(a,b)`, `linspace`, `mod`, `rem`, `atan2`, `fprintf`, `sprintf`, `num2str` added; `sum/mean/min/max` on matrices now work column-wise. `figure`, `hold on`, `grid on`, `legend`, `clc`, `clear`, `close all` are accepted.
- Infinite loops froze the tab; execution is now capped (200,000 operations) with a clear message. Errors report the script line number.
- The command line (`»`) rejected a trailing `;`, double-printed `disp`, and mis-parsed `x == 3`; it now shares the script engine and keeps variables.
- Switching to the **Plots** tab erased an Octave-generated plot. Fixed.
- The Run button could be clicked repeatedly during a long Octave run; it is now disabled while running and the request has a timeout.
- Plot colours were left over from the old dark theme (near-black grid on white); plot now matches the teal theme, has x-axis ticks, supports `hold on` with several lines, skips NaN points, and the y-axis label no longer overlaps the numbers. Plot titles are HTML-escaped.
- A corrupted/blocked `localStorage` no longer breaks start-up. Export/Save works in Firefox/Safari (download URL was revoked too early). Mobile menu closes when tapping outside. Footer text no longer says scripts "stay in your browser" (they are sent to the local server in Octave mode).
- Added favicon (stops a 404), `aria-label`s, `&amp;` escapes, visible keyboard focus. Removed unused authentication CSS and the inline script (so a strict Content-Security-Policy can be used).

## Server / Octave bridge
- **Security:** any website open in your browser could previously POST JSON to `http://127.0.0.1:8080/api/run` and run code on your computer. The server now requires `Content-Type: application/json`, a local `Host`, and a local `Origin`, and sends CSP/anti-framing headers.
- Only `index.html`, `style.css`, `app.js` and `assets/` are served (previously `server.js`, `package.json`, etc. were downloadable).
- Octave is auto-detected (PATH, `octave-cli`, default Windows install folders, `OCTAVE_PATH`) and the status is shown at start-up and in the app; if Octave is missing, SMAT says so and uses the browser engine instead of failing.
- Octave's stdin is closed (scripts calling `input()` no longer hang for 30 s); UTF-8 request bodies are decoded correctly; timeouts clean up reliably; "port already in use" gives a readable message.

## Launcher
- `START-SMAT-WINDOWS.bat`: used to refuse to start when `octave` was not on PATH even if `OCTAVE_PATH` was set (contradicting the README); now relies on the server's detection. Saved with Windows (CRLF) line endings.


## MATLAB workflow improvements
- Added 8 additional example scripts: vectorized/element-wise arithmetic, logical indexing, statistics, user-defined functions, numerical root finding, ODE solving, 3-D surface plotting, and complex-number calculations.
- Updated the Help & examples page to distinguish the lightweight browser fallback from GNU Octave execution and to explain MATLAB compatibility limits without claiming full MathWorks equivalence.


## Local backend guardrails update
- Reduced maximum script request size to 256 KB.
- Added bounded console output and a 5 MB cap for the automatically returned plot.
- Limited execution to one active Octave job to avoid local resource spikes.
- Clamped execution timeout to 1–60 seconds (default 30 seconds).
- Added process-tree termination attempt on timeout and retained per-run temporary-directory cleanup.
- Updated docs to clearly state that this local bridge is not a sandbox and must not be exposed publicly.
