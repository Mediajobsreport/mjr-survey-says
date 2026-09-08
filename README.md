# MJR Survey Says

Automatic source-backed survey/stat feed for the MJR Radio Prep page.

## What it does

- Runs every day with GitHub Actions.
- Reads the official Pew Research Center publications RSS feed.
- Looks for usable percentage-based findings in RSS excerpts.
- Converts qualifying findings into concise "guess the number" questions.
- Keeps a rolling pool and deduplicates old items.
- Publishes `docs/surveys.json`.
- The Prep widget loads the JSON automatically, shows 3 items by default, and can expand to 5 or 7.
- If the feed is temporarily unavailable, the widget uses its built-in fallback items.

## GitHub setup

1. Create a public GitHub repository named `mjr-survey-says`.
2. Upload the contents of this folder to the repository root.
3. In GitHub: **Settings → Pages**.
4. Set **Deploy from a branch**.
5. Branch: `main`; Folder: `/docs`.
6. Save.
7. Open **Actions → Build MJR Survey Says → Run workflow** once.

Expected feed URL:

`https://mediajobsreport.github.io/mjr-survey-says/surveys.json`

The included widget already points to that URL.

## Daily schedule

The workflow is scheduled for 08:15 UTC daily, before the normal MJR Prep production window.

## Source policy

The first automatic adapter uses Pew Research Center's official RSS feed. It does not spider or scrape Pew article pages. Each displayed item links to the original source.

The project is intentionally adapter-based so other survey publishers can be added later when we identify an appropriate RSS/API/licensed source.

## Important editorial note

The automated generator is deliberately conservative. It only creates items when an RSS excerpt contains a clear numeric percentage. This avoids inventing survey results. Keep the source link visible in the widget.

## Files

- `.github/workflows/build-surveys.yml` — daily automation
- `scripts/build-surveys.js` — feed builder
- `data-seed.json` — fallback/seed items
- `docs/surveys.json` — published feed
- `survey-says-widget.html` — Prep embed
