# Object front end

React + TypeScript (Vite, Tailwind v4, shadcn/ui). Served by the Python back end from `dist/`.

- `npm run dev`: Vite dev server; `/api` is proxied to `http://127.0.0.1:8790`.
- `npm test`: Vitest.
- `npm run build`: type-check and build to `dist/`.

Fonts (Inter) and icons (Phosphor via `@iconify-json/ph`) are bundled; nothing is fetched at runtime.
