# MJR Survey Says

Automated source-backed survey/statistics feed for **📊 MJR SURVEY SAYS** in MJR Radio Prep.

## What it does

- Reads the official Pew Research Center publications RSS feed.
- Rejects obvious political material for the Prep widget.
- Extracts percentage-based survey findings.
- Keeps a rolling, de-duplicated pool in `docs/surveys.json`.
- Generates a complete static widget page at `docs/survey-says.html`.
- Shows 3 items by default with 5/7 expansion and topic filtering.
- Runs automatically each day through GitHub Actions.

## GitHub Pages

Pages should publish from the `main` branch `/docs` folder.

Expected URLs:

- JSON: `https://mediajobsreport.github.io/mjr-survey-says/surveys.json`
- Static widget: `https://mediajobsreport.github.io/mjr-survey-says/survey-says.html`

## Recommended Prep embed

Because the Prep editor did not reliably run remote-data JavaScript, use the generated static widget as an iframe:

```html
<iframe
  src="https://mediajobsreport.github.io/mjr-survey-says/survey-says.html"
  title="MJR Survey Says"
  loading="lazy"
  style="width:100%;height:720px;border:0;display:block;"
></iframe>
```

The iframe loads a fully rendered HTML document; it does not require the Prep page itself to fetch JSON.

## Source policy

Initial automation uses only Pew Research Center's official RSS feed. It does not scrape Pew article pages. Additional sources should be added only when their API/RSS/licensing permits automated use.
