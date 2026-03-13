# Claude Code Guidelines

## About

A comprehensive TypeScript library for health, fitness, and smartwatch data that provides unified access to Oura Ring, WHOOP, Apple Health, Fitbit, Withings, Renpho, Garmin, Polar, Suunto, Coros, and Wahoo. It includes smart scale body composition tracking, FIT file parsing, training load analysis (TSS/NP/IF/CTL/ATL/TSB), sleep quality scoring, recovery analysis, and data export to GPX/TCX/CSV/GeoJSON. All platforms share a common `HealthDriver` interface and there is a 22-command CLI for syncing and analyzing data.

## Linting

- Use **pickier** for linting — never use eslint directly
- Run `bunx --bun pickier .` to lint, `bunx --bun pickier . --fix` to auto-fix
- When fixing unused variable warnings, prefer `// eslint-disable-next-line` comments over prefixing with `_`

## Frontend

- Use **stx** for templating — never write vanilla JS (`var`, `document.*`, `window.*`) in stx templates
- Use **crosswind** as the default CSS framework which enables standard Tailwind-like utility classes
- stx `<script>` tags should only contain stx-compatible code (signals, composables, directives)

## Dependencies

- **buddy-bot** handles dependency updates — not renovatebot
- **better-dx** provides shared dev tooling as peer dependencies — do not install its peers (e.g., `typescript`, `pickier`, `bun-plugin-dtsx`) separately if `better-dx` is already in `package.json`
- If `better-dx` is in `package.json`, ensure `bunfig.toml` includes `linker = "hoisted"`

## Commits

- Use conventional commit messages (e.g., `fix:`, `feat:`, `chore:`)
