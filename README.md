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


## Daily rotation (v1.3)
The builder now keeps `mjr-survey-rotation.json` with the IDs shown during recent runs. Each daily build prefers findings that have not appeared during the previous 7 days, then fills remaining slots from the rolling pool. It also favors topic variety before repeating a topic. The 3- and 5-item widgets are always subsets of the same 7-item daily selection.


## Source visibility and Talker priority (v1.4)
The build log now reports how many usable findings were discovered from each source. If the rolling pool contains a usable Talker Research item, the daily selector places one Talker item in the default 3-item view before filling the remaining slots by freshness and topic variety. The log also reports the source mix for the default 3 and full 7 selections.


## Deployment fix (v1.5)
The GitHub Action now stages the entire `docs/` folder plus `mjr-survey-rotation.json`.

This ensures that:
- `survey-says-3.html`
- `survey-says-5.html`
- `survey-says-7.html`
- `survey-says.html`
- `surveys.json`

are all committed after each build, and the daily rotation history persists between GitHub Action runs.


## Expanded sources (v1.6)

Added official RSS sources:
- **AP-NORC Center** — Culture & Society
- **AP-NORC Center** — Science & Technology
- **AP-NORC Center** — Younger Generations
- **AP-NORC Center** — Education
- **AP-NORC Center** — Media Insight Project
- **Edison Research** — research, audio, podcast and consumer-media insights

The existing political-content filter remains active. The daily selector now favors both source diversity and topic diversity, while still guaranteeing a Talker Research item in the default 3 whenever a usable Talker item exists.

The rolling pool was increased from 90 to 140 items to accommodate the broader source set.

CivicScience is intentionally NOT included because its published Terms of Service prohibit automated scripts from collecting information from its service.
