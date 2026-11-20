# F1 Weekend

A minimal, one-page Formula 1 schedule that displays the next race weekend in the viewer's local time zone. When no future race is published, it shows the final driver and constructor standings for the latest completed season.

## Run locally

```bash
pnpm install
pnpm dev
```

Open the local URL printed by Vite.

## Checks

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Data

The site uses the public [jolpica-f1 API](https://api.jolpi.ca/docs/):

- Alpha schedule endpoints provide seasons, rounds, circuits, and session timestamps.
- Ergast-compatible standings endpoints provide final driver and constructor classifications.
- All time-zone conversion happens in the browser with `Intl.DateTimeFormat`.

No API key, server, or persistent storage is required.
