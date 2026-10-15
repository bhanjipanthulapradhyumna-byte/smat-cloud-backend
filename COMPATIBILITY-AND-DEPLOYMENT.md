# SMAT: MATLAB-compatible execution upgrade notes

## What this ZIP actually provides
- A browser UI and lightweight JavaScript fallback.
- A Node.js local server that calls GNU Octave when Octave is installed.
- Octave-generated plot images returned to the UI.
- A set of example `.m` programs in `examples/`, including loops, matrix left division, 2-D graphs, circles, polygons, contour plots, mesh/surface plots, 3-D parametric curves, root finding and ODE solving.

## Run locally on Windows
1. Install Node.js LTS.
2. Install GNU Octave.
3. Extract the ZIP.
4. Double-click `START-SMAT-WINDOWS.bat`.
5. Open the local URL shown in the terminal (normally `http://127.0.0.1:8080`).
6. Load an example `.m` file into the editor and press Run.

The server is intentionally bound to `127.0.0.1`. **Do not deploy this exact local execution server as a public internet service.** It is designed for one user's own computer, not a multi-user hosted website.

## To make it a public website
Use a separate backend service/container with GNU Octave installed, and execute each user's code in an isolated sandbox/container with:
- no host filesystem access or secrets,
- no network access by default,
- CPU, memory, process and wall-clock limits,
- per-user rate limits and authentication,
- bounded output and temporary storage cleanup,
- queueing for concurrent jobs,
- monitoring and abuse protection.

The current `server.js` includes local reliability guardrails (bounded request/output, one concurrent run, timeout, temporary workspaces and cleanup), but it is **not a security sandbox**. It does not provide strong CPU/memory/disk quotas or isolate arbitrary Octave code from the Windows account. The current `server.js` is not a public multi-user execution service. Hosting only the static files will not provide Octave execution.

## Compatibility reality
GNU Octave supports a broad practical subset of MATLAB syntax and scientific computing, but it is not a drop-in replacement for every MATLAB product. MathWorks-only toolboxes, Simulink, App Designer, hardware interfaces, proprietary functions, and some graphics or version-specific behaviours may not work unchanged. Additional Octave packages may be needed for some functions.

## Plot notes
2-D and 3-D plot commands can run in Octave, but this version exports the current Octave figure as a PNG image. It does not yet provide full MATLAB desktop graphics interactivity, live 3-D rotation, multiple independent exported figures, or every graphics handle/property.

## Examples
See `examples/`. Start with `01_arithmetic_and_arrays.m`, then `03_2d_graphs.m`, `04_parametric_geometry_circle.m`, and `06_3d_surface.m`.
