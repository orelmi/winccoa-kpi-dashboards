# CLAUDE.md — Project instructions for Claude Code

## Rules

- **Always update documentation** after any code change. This includes:
  - `README.md` — Keep features list and getting started instructions current
  - `docs/` — Update relevant detailed documentation files when architecture or behavior changes
  - Code comments — Update JSDoc / CTRL comments when function signatures or behavior change

## Project Overview

WinCC OA KPI Dashboard — A multi-page web application for configuring and analyzing KPI/OEE metrics in Siemens WinCC OA (SCADA).

## Architecture

- **webview/** — HTML pages loaded via `loadSnippet()` in WebView EWO
  - Each page is self-contained and can be loaded independently
  - Navigation between pages is handled by the CTRL panel script (`loadSnippet`)
  - In simulation mode (no WinCC OA), pages use `window.location` for navigation
- **scripts/libs/** — CTRL libraries for WinCC OA data access
- **panels/** — WinCC OA XML panels hosting the WebView

## Key Conventions

- ALL WinCC OA data access goes through `toCtrl` → `messageReceived` → CTRL (never direct JS DP access)
- Domain-oriented API: `kpi.js` abstracts WinCC OA specifics from consumer modules
- Modules use IIFE pattern with `init()`, `load()`, `render()`, `getAll()` methods
- Modules are safe for data-only loading (render/init guard missing DOM elements)
