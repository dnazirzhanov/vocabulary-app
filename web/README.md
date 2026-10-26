# Web frontend

Vite + React + TypeScript, plain CSS Modules on top of `src/styles/tokens.css`. All learning state lives on the server; answers are checked by the API.

```sh
npm install
npm run dev          # http://localhost:5173 — proxies /api to the backend on :8000
npm test             # session state machine and helpers (node:test)
npm run test:e2e     # Playwright end-to-end tests against the running API
npm run lint         # ESLint (typescript-eslint, react-hooks)
npm run format       # Prettier (format:check in CI)
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + production build
npm run screenshots  # with `make dev` running: walks home → lesson → summary at
                     # 320/390/768/1280/1440px into screenshots/ and prints a layout report
```

TypeScript is pinned to 6.0 because typescript-eslint does not support TypeScript 7 yet.

`npm run screenshots` drives the locally installed Google Chrome through `playwright-core`; no browser download is needed.

## Layout

- `src/lib/api.ts` — typed API client; tells network failures from server errors
- `src/lesson/sessionRun.ts` — session state machine (answering → checking → feedback, retry); unit-tested
- `src/lesson/LessonScreen.tsx`, `ExerciseView.tsx` — the lesson screen and its three exercise types
- `src/home/HomeScreen.tsx` — deck entry: start, resume, progress
- `src/summary/SessionSummary.tsx` — end-of-session summary and the practise-mistakes flow
- `e2e/` — Playwright tests; each test is a fresh learner
- `src/illustrations/` — original SVG illustrations; house style is described in `index.tsx`
- `src/styles/tokens.css` — colours (with measured contrast), type, spacing, radii, motion
