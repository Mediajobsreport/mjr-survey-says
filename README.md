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


## Automated source adapters

### Talker Research
- Uses Talker's official RSS feed: `https://talker.news/feed/`
- The builder accepts only feed items explicitly identified as **Talker Research**.
- It does **not** crawl individual Talker story pages.
- Talker Research remains fully attributed and every widget item links to the originating Talker page.
- Talker News stories are excluded from this adapter.

### Pew Research Center
- Continues using Pew's official publications RSS feed.
- The rolling pool retains usable findings when a daily feed run has no new percentage-based candidates.

The builder keeps up to 90 usable survey items for up to 180 days, while the public widgets continue to show 3, 5, or 7 items.


### Talker ratio support (v1.2)
The Talker adapter now recognizes both percentage findings and common survey ratios such as `2 in 3`, `4 in 5`, `one in three`, and `four in five`. It also checks the RSS headline because Talker frequently places the strongest finding there.
