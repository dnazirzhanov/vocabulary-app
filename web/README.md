# Web frontend

Vite + React + TypeScript, plain CSS Modules on top of `src/styles/tokens.css`.

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # lesson-session reducer tests (node:test)
npm run build        # typecheck + production build
npm run screenshots  # with the dev server running: captures every lesson state at
                     # 320/390/768/1280/1440px into screenshots/ and prints a layout report
```

`npm run screenshots` drives the locally installed Google Chrome through `playwright-core`; no browser download is needed.

## Layout

- `src/lesson/lessonSession.ts` — lesson state machine and answer checking (no React, unit-tested)
- `src/lesson/LessonScreen.tsx` — the multiple-choice exercise screen and its composition notes
- `src/illustrations/` — original SVG illustrations; house style is described in `index.tsx`
- `src/styles/tokens.css` — colours (with measured contrast), type, spacing, radii, motion
