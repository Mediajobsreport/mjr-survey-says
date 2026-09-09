const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const OUT_JSON = path.join(process.cwd(), "docs", "surveys.json");
const OUT_HTML = path.join(process.cwd(), "docs", "survey-says.html");
const OUT_HTML_3 = path.join(process.cwd(), "docs", "survey-says-3.html");
const OUT_HTML_5 = path.join(process.cwd(), "docs", "survey-says-5.html");
const OUT_HTML_7 = path.join(process.cwd(), "docs", "survey-says-7.html");
const SEED = path.join(process.cwd(), "data-seed.json");

const SOURCES = [
  {
    name: "Talker Research",
    url: "https://talker.news/feed/",
    mode: "rss",
    filter: "talker-research"
  },
  {
    name: "Pew Research Center",
    url: "https://www.pewresearch.org/publications/feed/",
    mode: "rss"
  },
  {
    name: "AP-NORC Center",
    url: "https://apnorc.org/feed/",
    mode: "rss"
  },
  {
    name: "AP-NORC Center",
    url: "https://apnorc.org/topics/culture-and-society/feed/",
    mode: "rss"
  },
  {
    name: "AP-NORC Center",
    url: "https://apnorc.org/topics/science-and-technology/feed/",
    mode: "rss"
  },
  {
    name: "AP-NORC Center",
    url: "https://apnorc.org/topics/younger-generations/feed/",
    mode: "rss"
  },
  {
    name: "AP-NORC Center",
    url: "https://apnorc.org/topics/education/feed/",
    mode: "rss"
  },
  {
    name: "AP-NORC Center",
    url: "https://apnorc.org/topics/media-insight-project/feed/",
    mode: "rss"
  },
  {
    name: "Edison Research",
    url: "https://www.edisonresearch.com/feed/",
    mode: "rss"
  }
];

const MAX_POOL = 140;
const MAX_AGE_DAYS = 180;
const AP_NORC_MAX_AGE_DAYS = 365;

const ROTATION_STATE = path.join(
  process.cwd(),
  "mjr-survey-rotation.json"
);

const RECENT_SHOWN_DAYS = 7;
const MAX_WIDGET_ITEMS = 7;

function maxAgeDaysForSource(source) {
  return source === "AP-NORC Center"
    ? AP_NORC_MAX_AGE_DAYS
    : MAX_AGE_DAYS;
}

function decodeXml(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'");
}

function stripHtml(s = "") {
  return decodeXml(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function tag(block, name) {
  const m = block.match(
    new RegExp(
      `<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,
      "i"
    )
  );

  return m ? stripHtml(m[1]) : "";
}

function tags(block, name) {
  const re = new RegExp(
    `<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,
    "gi"
  );

  return [...block.matchAll(re)]
    .map(m => stripHtml(m[1]))
    .filter(Boolean);
}

function parseRss(xml) {
  const blocks =
    xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];

  return blocks.map(b => ({
    title: tag(b, "title"),
    link: tag(b, "link"),
    date: tag(b, "pubDate"),
    description: tag(b, "description"),
    content: tag(b, "content:encoded"),
    creator:
      tag(b, "dc:creator") ||
      tag(b, "author"),
    categories: tags(b, "category")
  }));
}

function isTalkerResearchArticle(article) {
  const haystack = [
    article.creator || "",
    ...(article.categories || []),
    article.title || "",
    article.description || "",
    article.content || ""
  ].join(" ");

  return /\bTalker Research\b/i.test(haystack);
}

function sentences(text = "") {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map(s => s.trim())
    .filter(
      s =>
        s.length >= 35 &&
        s.length <= 330
    );
}

function inferTopic(text = "") {
  const t = text.toLowerCase();

  const rules = [
    [
      "Technology",
      /\b(ai|artificial intelligence|chatbot|smartphone|internet|online|social media|technology|digital)\b/
    ],
    [
      "Entertainment",
      /\b(streaming|television|tv|movie|music|podcast|radio|entertainment)\b/
    ],
    [
      "Money",
      /\b(money|cost|price|inflation|financial|economy|spending|income|cash|debt)\b/
    ],
    [
      "Work",
      /\b(work|job|employee|employer|workplace|career|office)\b/
    ],
    [
      "Shopping",
      /\b(shop|shopping|retail|store|purchase|consumer|buy)\b/
    ],
    [
      "Food & Dining",
      /\b(food|restaurant|meal|fast food|grocery|dining)\b/
    ],
    [
      "Family & Life",
      /\b(parent|child|family|relationship|dating|marriage|home)\b/
    ],
    [
      "Health",
      /\b(health|doctor|medical|hospital|fitness|sleep)\b/
    ]
  ];

  for (const [name, re] of rules) {
    if (re.test(t)) {
      return name;
    }
  }

  return "Life & Culture";
}

function isPolitical(text = "") {
  return /\b(trump|biden|democrat|republican|congress|senate|house of representatives|election|vote|voter|partisan|political party|white house|supreme court|immigration policy|foreign policy|president|governor)\b/i.test(
    text
  );
}

function talkFor(topic) {
  const prompts = {
    Technology:
      "Would this number be higher or lower among your friends and coworkers?",

    Entertainment:
      "Does this match your own viewing, listening or entertainment habits?",

    Money:
      "Where do you see this showing up most in your own budget?",

    Work:
      "Does this sound like your workplace, or is your experience completely different?",

    Shopping:
      "What purchase or shopping habit have you changed the most lately?",

    "Food & Dining":
      "Does this match the way you eat, order or dine out?",

    "Family & Life":
      "Would your family or friends agree with this finding?",

    Health:
      "Has this changed the way you think about your own health choices?",

    "Life & Culture":
      "Does this number surprise you, or does it sound about right?"
  };

  return (
    prompts[topic] ||
    prompts["Life & Culture"]
  );
}

function makeQuestion(sentence, stat) {
  let s = sentence
    .replace(/\s+/g, " ")
    .trim();

  /*
   * RATIO QUESTIONS
   *
   * Examples:
   * "3 in 10 donated between $51 and $100."
   * "Another 3 in 10 donated between $51 and $100."
   * "Nearly 2 in 3 Americans use..."
   *
   * We want:
   * "How many donated between $51 and $100?"
   */

  if (
    /\bin\b/i.test(stat) &&
    !stat.includes("%")
  ) {
    const escaped = stat.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    /*
     * Remove transition/qualifier words before
     * the ratio so they don't become part of
     * the generated question.
     */
    let cleaned = s.replace(
      /^(another|about|around|roughly|nearly|almost|approximately|only|just|more than|less than)\s+/i,
      ""
    );

    /*
     * Ratio begins the sentence.
     *
     * "3 in 10 donated between $51 and $100."
     *
     * becomes:
     *
     * "How many donated between $51 and $100?"
     */
    if (
      new RegExp(
        `^${escaped}\\s+`,
        "i"
      ).test(cleaned)
    ) {
      let tail = cleaned
        .replace(
          new RegExp(
            `^${escaped}\\s+`,
            "i"
          ),
          ""
        )
        .replace(/[.!]+$/, "")
        .trim();

      tail = tail.replace(
        /^of\s+/i,
        ""
      );

      if (tail) {
        return `How many ${tail}?`;
      }
    }

    /*
     * Ratio occurs later in the sentence.
     * Favor the wording after the ratio instead
     * of inserting "how many" awkwardly.
     */
    const ratioMatch = cleaned.match(
      new RegExp(
        `${escaped}\\s+(.+?)[.!]?$`,
        "i"
      )
    );

    if (
      ratioMatch &&
      ratioMatch[1]
    ) {
      let tail = ratioMatch[1]
        .replace(/[.!?]+$/, "")
        .trim();

      tail = tail.replace(
        /^of\s+/i,
        ""
      );

      if (tail) {
        return `How many ${tail}?`;
      }
    }

    /*
     * Safe fallback for unusual ratio sentences.
     */
    return "How many people matched this survey finding?";
  }

  /*
   * PERCENTAGE QUESTIONS
   */

  const escaped =
    stat.replace("%", "\\%");

  /*
   * "42% of Americans..."
   */
  let m = s.match(
    new RegExp(
      `^${escaped}\\s+of\\s+(.+?)[.!]?$`,
      "i"
    )
  );

  if (m) {
    return `What percentage of ${m[1].replace(
      /[.!?]+$/,
      ""
    )}?`;
  }

  /*
   * "Among adults, 42%..."
   */
  m = s.match(
    new RegExp(
      `^(Among\\s+[^,]+,\\s*)${escaped}\\s+(.+?)[.!]?$`,
      "i"
    )
  );

  if (m) {
    return `${m[1]}what percentage ${m[2].replace(
      /[.!?]+$/,
      ""
    )}?`;
  }

  /*
   * Percent shown in parentheses.
   */
  m = s.match(
    new RegExp(
      `^(.+?)\\s+\\(${escaped}\\)(.+?)[.!]?$`,
      "i"
    )
  );

  if (m) {
    return `What percentage ${m[2]
      .replace(
        /^[,;:\s-]+/,
        ""
      )
      .replace(
        /[.!?]+$/,
        ""
      )}?`;
  }

  /*
   * General percentage fallback.
   */
  const replaced = s.replace(
    new RegExp(
      escaped,
      "i"
    ),
    "what percentage"
  );

  return (
    replaced.replace(
      /[.!]+$/,
      ""
    ) +
    (
      replaced.endsWith("?")
        ? ""
        : "?"
    )
  );
}

function normalizeRatio(raw) {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\bOne\b/i, "1")
    .replace(/\bTwo\b/i, "2")
    .replace(/\bThree\b/i, "3")
    .replace(/\bFour\b/i, "4")
    .replace(/\bFive\b/i, "5")
    .replace(/\bSix\b/i, "6")
    .replace(/\bSeven\b/i, "7")
    .replace(/\bEight\b/i, "8")
    .replace(/\bNine\b/i, "9")
    .replace(/\bTen\b/i, "10")
    .trim();
}

function findStats(sentence) {
  const found = [];

  /*
   * Percentages
   */
  for (
    const m of sentence.matchAll(
      /\b(?!1000)(\d{1,2}|100)%\b/g
    )
  ) {
    const n = Number(m[1]);

    if (
      n >= 5 &&
      n <= 95
    ) {
      found.push({
        stat: m[0],
        index: m.index,
        type: "percent"
      });
    }
  }

  /*
   * Numeric ratios:
   * 2 in 3
   * 4 in 5
   */
  for (
    const m of sentence.matchAll(
      /\b([1-9]|10)\s+in\s+([2-9]|10)\b/gi
    )
  ) {
    const a = Number(m[1]);
    const b = Number(m[2]);

    if (a < b) {
      found.push({
        stat: `${a} in ${b}`,
        index: m.index,
        type: "ratio"
      });
    }
  }

  /*
   * Word ratios:
   * two in three
   * four in five
   */
  const words =
    "(?:one|two|three|four|five|six|seven|eight|nine|ten)";

  const wordRe = new RegExp(
    `\\b(${words})\\s+in\\s+(${words})\\b`,
    "gi"
  );

  const nums = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10
  };

  for (
    const m of sentence.matchAll(
      wordRe
    )
  ) {
    const a =
      nums[m[1].toLowerCase()];

    const b =
      nums[m[2].toLowerCase()];

    if (a < b) {
      found.push({
        stat: `${a} in ${b}`,
        index: m.index,
        type: "ratio"
      });
    }
  }

  const seen = new Set();

  return found
    .sort(
      (a, b) =>
        a.index - b.index
    )
    .filter(x => {
      const k =
        `${x.stat}|${x.index}`;

      if (seen.has(k)) {
        return false;
      }

      seen.add(k);

      return true;
    });
}

function hashId(parts) {
  return crypto
    .createHash("sha1")
    .update(
      parts.join("|")
    )
    .digest("hex")
    .slice(0, 16);
}

function isoDate(raw) {
  const d = new Date(raw);

  return Number.isNaN(
    d.getTime()
  )
    ? new Date()
        .toISOString()
        .slice(0, 10)
    : d
        .toISOString()
        .slice(0, 10);
}

function displayDate(raw) {
  const d = new Date(
    raw + "T12:00:00Z"
  );

  if (
    Number.isNaN(
      d.getTime()
    )
  ) {
    return raw || "";
  }

  return d.toLocaleDateString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC"
    }
  );
}

function ageDays(date) {
  return (
    Date.now() -
    new Date(
      date + "T00:00:00Z"
    ).getTime()
  ) / 86400000;
}

function extractCandidates(
  article,
  sourceName
) {
  if (
    isPolitical(
      `${article.title} ${article.description} ${article.content}`
    )
  ) {
    return [];
  }

  const chunks = [
    article.title,
    article.description,
    article.content
  ].filter(Boolean);

  const candidateSentences = [];

  for (
    const chunk of chunks
  ) {
    const clean =
      stripHtml(chunk)
        .replace(/\s+/g, " ")
        .trim();

    if (!clean) {
      continue;
    }

    if (
      chunk === article.title ||
      clean.length < 35
    ) {
      candidateSentences.push(
        clean
      );
    }

    candidateSentences.push(
      ...sentences(clean)
    );
  }

  const seen = new Set();
  const out = [];

  for (
    const sentence of
    candidateSentences
  ) {
    if (
      !sentence ||
      isPolitical(sentence)
    ) {
      continue;
    }

    /*
     * Remove common false-positive
     * percentage contexts.
     */
    if (
      /\b(discount|off sale|battery|humidity|chance of rain)\b/i.test(
        sentence
      )
    ) {
      continue;
    }

    const stats =
      findStats(sentence);

    if (!stats.length) {
      continue;
    }

    /*
     * Limit each sentence to two
     * findings so one paragraph
     * doesn't overwhelm the pool.
     */
    for (
      const found of
      stats.slice(0, 2)
    ) {
      const stat =
        found.stat;

      const key =
        `${article.link}|${sentence}|${stat}`;

      if (
        seen.has(key)
      ) {
        continue;
      }

      seen.add(key);

      const topic =
        inferTopic(
          `${article.title} ${sentence}`
        );

      const published =
        isoDate(article.date);

      out.push({
        id: hashId([
          sourceName,
          article.link,
          sentence,
          stat
        ]),

        topic,

        question:
          makeQuestion(
            sentence,
            stat
          ),

        answer: stat,

        stat,

        context:
          article.title
            ? `From “${article.title}.”`
            : "From a recent survey finding.",

        talk:
          talkFor(topic),

        source:
          sourceName,

        source_url:
          article.link,

        source_date:
          published,

        published_at:
          published,

        auto_generated:
          true
      });
    }
  }

  return out;
}

function isUsable(item) {
  if (
    !item ||
    !item.question ||
    !item.source_url ||
    !item.stat
  ) {
    return false;
  }

  if (
    item.question.length < 25 ||
    item.question.length > 280
  ) {
    return false;
  }

  if (
    isPolitical(
      `${item.question} ${item.context || ""}`
    )
  ) {
    return false;
  }

  if (
    item.auto_generated &&
    ageDays(
      item.published_at ||
      item.source_date
    ) >
    maxAgeDaysForSource(
      item.source
    )
  ) {
    return false;
  }

  return true;
}

function pickWidgetItems(
  items
) {
  const picked = [];
  const topicCount =
    new Map();

  for (
    const item of items
  ) {
    const n =
      topicCount.get(
        item.topic
      ) || 0;

    if (n >= 2) {
      continue;
    }

    picked.push(item);

    topicCount.set(
      item.topic,
      n + 1
    );

    if (
      picked.length >=
      MAX_WIDGET_ITEMS
    ) {
      break;
    }
  }

  if (
    picked.length <
    MAX_WIDGET_ITEMS
  ) {
    for (
      const item of items
    ) {
      if (
        !picked.some(
          x =>
            x.id === item.id
        )
      ) {
        picked.push(item);
      }

      if (
        picked.length >=
        MAX_WIDGET_ITEMS
      ) {
        break;
      }
    }
  }

  return picked;
}

function buildWidgetHtml(
  items,
  limit = 3
) {
  const picked =
    pickWidgetItems(items)
      .slice(0, limit);

  const topics = [
    ...new Set(
      picked.map(
        x => x.topic
      )
    )
  ].sort();

  const options =
    topics
      .map(
        t =>
          `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`
      )
      .join("\n");

  const cards =
    picked
      .map(
        item =>
          `<article class="mjrss-card" data-topic="${escapeHtml(item.topic)}">
  <div class="mjrss-main">

    <div class="mjrss-meta">
      <span class="mjrss-topic">${escapeHtml(item.topic)}</span>
      <span class="mjrss-date">${escapeHtml(
        displayDate(
          item.source_date ||
          item.published_at
        )
      )}</span>
    </div>

    <p class="mjrss-question">${escapeHtml(
      item.question
    )}</p>

    <p class="mjrss-context">
      <strong>Answer:</strong>
      ${escapeHtml(
        item.answer ||
        item.stat
      )}
      ${
        item.context
          ? ` — ${escapeHtml(item.context)}`
          : ""
      }
    </p>

    <p class="mjrss-talk">
      <strong>Talk About It:</strong>
      ${escapeHtml(
        item.talk ||
        talkFor(item.topic)
      )}
    </p>

    <div class="mjrss-source">
      <strong>Source:</strong>
      <a href="${escapeHtml(
        item.source_url
      )}"
      target="_blank"
      rel="noopener noreferrer">${escapeHtml(
        item.source
      )}</a>
    </div>

  </div>

  <div class="mjrss-statbox">
    <span class="mjrss-stat">${escapeHtml(
      item.stat
    )}</span>
    <span class="mjrss-answerlabel">Answer</span>
  </div>
</article>`
      )
      .join("\n");

  return `<!doctype html>
<html lang="en">

<head>

<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>MJR Survey Says</title>

<style>

html,
body {
  margin:0;
  padding:0;
  background:transparent;
  font-family:Roboto,Arial,sans-serif;
}

#mjrSurveySays {
  --mjrss-blue:#192A56;
  --mjrss-ink:#172033;
  --mjrss-muted:#687386;
  --mjrss-line:#dfe5ee;
  --mjrss-soft:#f5f7fb;

  width:100%;
  margin:0;
  background:#fff;
  border:1px solid var(--mjrss-line);
  border-radius:0 0 10px 10px;
  overflow:hidden;
  color:var(--mjrss-ink);
  box-sizing:border-box;
}

#mjrSurveySays,
#mjrSurveySays * {
  box-sizing:border-box;
}

#mjrSurveySays .mjrss-head {
  background:var(--mjrss-blue);
  color:#fff;
  text-align:center;
  padding:11px 14px 10px;
}

#mjrSurveySays .mjrss-head h2 {
  margin:0;
  color:#fff;
  font-size:21px;
  line-height:1.1;
  font-weight:800;
}

#mjrSurveySays .mjrss-head p {
  margin:4px 0 0;
  color:#fff;
  font-size:12px;
  line-height:1.3;
  opacity:.9;
}

#mjrSurveySays .mjrss-toolbar {
  padding:7px 10px;
  border-bottom:1px solid var(--mjrss-line);
  background:#fff;
  display:flex;
  justify-content:flex-start;
}

#mjrSurveySays .mjrss-toolbar label {
  display:flex;
  gap:6px;
  align-items:center;
  font-size:11px;
  font-weight:700;
  color:var(--mjrss-blue);
}

#mjrSurveySays .mjrss-topicfilter {
  border:1px solid #cfd7e5;
  border-radius:6px;
  background:#fff;
  color:var(--mjrss-blue);
  padding:5px 8px;
  font:700 11px/1 Roboto,Arial,sans-serif;
}

#mjrSurveySays .mjrss-card {
  display:grid;
  grid-template-columns:minmax(0,1fr) 110px;
  gap:12px;
  padding:10px 14px;
  border-bottom:1px solid var(--mjrss-line);
  background:#fff;
}

#mjrSurveySays .mjrss-card:nth-child(even) {
  background:#fafbfe;
}

#mjrSurveySays .mjrss-meta {
  display:flex;
  gap:7px;
  align-items:center;
  flex-wrap:wrap;
  margin-bottom:4px;
}

#mjrSurveySays .mjrss-topic {
  font-size:10px;
  font-weight:800;
  text-transform:uppercase;
  letter-spacing:.04em;
  color:var(--mjrss-blue);
}

#mjrSurveySays .mjrss-date {
  font-size:10px;
  color:var(--mjrss-muted);
}

#mjrSurveySays .mjrss-question {
  margin:0 0 4px;
  color:var(--mjrss-ink);
  font-size:15px;
  line-height:1.3;
  font-weight:800;
}

#mjrSurveySays .mjrss-context,
#mjrSurveySays .mjrss-talk {
  margin:0 0 5px;
  color:var(--mjrss-ink);
  font-size:12px;
  line-height:1.35;
}

#mjrSurveySays .mjrss-source {
  color:var(--mjrss-muted);
  font-size:10.5px;
  line-height:1.3;
}

#mjrSurveySays .mjrss-source a {
  color:var(--mjrss-blue);
  text-decoration:underline;
}

#mjrSurveySays .mjrss-statbox {
  align-self:center;
  justify-self:stretch;
  background:var(--mjrss-soft);
  border:1px solid var(--mjrss-line);
  border-radius:8px;
  padding:9px 8px;
  text-align:center;
}

#mjrSurveySays .mjrss-stat {
  display:block;
  color:var(--mjrss-blue);
  font-size:24px;
  line-height:1;
  font-weight:900;
}

#mjrSurveySays .mjrss-answerlabel {
  display:block;
  margin-top:4px;
  color:var(--mjrss-muted);
  font-size:9px;
  font-weight:700;
  text-transform:uppercase;
  letter-spacing:.05em;
}

@media(max-width:680px) {

  #mjrSurveySays .mjrss-card {
    grid-template-columns:minmax(0,1fr) 84px;
    gap:8px;
    padding:9px 10px;
  }

  #mjrSurveySays .mjrss-question {
    font-size:14px;
  }

  #mjrSurveySays .mjrss-context,
  #mjrSurveySays .mjrss-talk {
    font-size:11.5px;
  }

  #mjrSurveySays .mjrss-stat {
    font-size:20px;
  }
}

@media(max-width:480px) {

  #mjrSurveySays .mjrss-card {
    grid-template-columns:1fr;
  }

  #mjrSurveySays .mjrss-statbox {
    justify-self:start;
    min-width:84px;
  }
}

</style>

</head>

<body>

<div id="mjrSurveySays">

  <div class="mjrss-head">

    <h2>📊 MJR SURVEY SAYS</h2>

    <p>
      Fresh, source-backed surveys and stats for on-air conversation.
    </p>

  </div>

  <div class="mjrss-toolbar">

    <label>

      <span>Topic</span>

      <select
        class="mjrss-topicfilter"
        aria-label="Filter Survey Says by topic"
      >

        <option value="all">
          All Topics
        </option>

        ${options}

      </select>

    </label>

  </div>

  <div class="mjrss-cards">
    ${cards}
  </div>

</div>

<script>

(function(){

  var root =
    document.getElementById(
      "mjrSurveySays"
    );

  if (!root) {
    return;
  }

  var filter =
    root.querySelector(
      ".mjrss-topicfilter"
    );

  var cards =
    root.querySelectorAll(
      ".mjrss-card"
    );

  function update() {

    var topic =
      filter.value;

    cards.forEach(
      function(card) {

        card.style.display =
          (
            topic === "all" ||
            card.getAttribute(
              "data-topic"
            ) === topic
          )
            ? "grid"
            : "none";

      }
    );
  }

  filter.addEventListener(
    "change",
    update
  );

  update();

})();

</script>

</body>

</html>`;
}

function readRotationState() {
  try {
    const parsed =
      JSON.parse(
        fs.readFileSync(
          ROTATION_STATE,
          "utf8"
        )
      );

    return Array.isArray(
      parsed.history
    )
      ? parsed
      : { history: [] };

  } catch {

    return {
      history: []
    };

  }
}

function writeRotationState(
  state
) {
  fs.writeFileSync(
    ROTATION_STATE,
    JSON.stringify(
      state,
      null,
      2
    ) + "\n"
  );
}

function dateKey(
  d = new Date()
) {
  return d
    .toISOString()
    .slice(0, 10);
}

function recentShownIds(
  state,
  days = RECENT_SHOWN_DAYS
) {
  const cutoff =
    Date.now() -
    days * 86400000;

  const ids =
    new Set();

  for (
    const row of
    state.history || []
  ) {
    const t =
      Date.parse(
        row.date || ""
      );

    if (
      !Number.isFinite(t) ||
      t < cutoff
    ) {
      continue;
    }

    for (
      const id of
      row.ids || []
    ) {
      ids.add(id);
    }
  }

  return ids;
}

function pickDailyRotation(
  pool,
  count,
  state
) {
  const recent =
    recentShownIds(state);

  const fresh =
    pool.filter(
      x =>
        !recent.has(x.id)
    );

  const fallback =
    pool.filter(
      x =>
        recent.has(x.id)
    );

  const newestFirst =
    arr =>
      [...arr].sort(
        (a, b) =>
          String(
            b.published_at ||
            b.source_date ||
            ""
          ).localeCompare(
            String(
              a.published_at ||
              a.source_date ||
              ""
            )
          )
      );

  const orderedFresh =
    newestFirst(fresh);

  const orderedFallback =
    newestFirst(fallback);

  const ordered = [
    ...orderedFresh,
    ...orderedFallback
  ];

  const chosen = [];

  /*
   * Keep Talker in the default group
   * whenever a usable Talker item exists.
   */
  const talker =
    ordered.find(
      x =>
        x.source ===
        "Talker Research"
    );

  if (
    talker &&
    count > 0
  ) {
    chosen.push(
      talker
    );
  }

  const usedTopics =
    new Set(
      chosen.map(
        x => x.topic
      )
    );

  /*
   * Prefer topic variety.
   */
  for (
    const item of ordered
  ) {
    if (
      chosen.length >= count
    ) {
      break;
    }

    if (
      chosen.some(
        x =>
          x.id === item.id
      )
    ) {
      continue;
    }

    if (
      !usedTopics.has(
        item.topic
      )
    ) {
      chosen.push(
        item
      );

      usedTopics.add(
        item.topic
      );
    }
  }

  /*
   * Fill remaining positions
   * by freshness.
   */
  for (
    const item of ordered
  ) {
    if (
      chosen.length >= count
    ) {
      break;
    }

    if (
      !chosen.some(
        x =>
          x.id === item.id
      )
    ) {
      chosen.push(
        item
      );
    }
  }

  return chosen.slice(
    0,
    count
  );
}

async function fetchText(
  url
) {
  const r =
    await fetch(
      url,
      {
        headers: {
          "user-agent":
            "MediaJobsReport-SurveySays/1.1 (+https://www.mediajobsreport.com/)"
        },
        redirect: "follow"
      }
    );

  if (!r.ok) {
    throw new Error(
      `${r.status} ${r.statusText}`
    );
  }

  return await r.text();
}

(async () => {

  console.log(
    "Building MJR Survey Says feed + static widget..."
  );

  /*
   * DIAGNOSTICS
   */

  const diag = {};

  const ensureDiag =
    source => {

      if (!diag[source]) {
        diag[source] = {
          discovered: 0,
          rejectedMissing: 0,
          rejectedQuestionLength: 0,
          rejectedPolitical: 0,
          rejectedAge: 0,
          rejectedDuplicate: 0,
          accepted: 0
        };
      }

      return diag[source];
    };

  const explainUsability =
    item => {

      if (
        !item ||
        !item.question ||
        !item.source_url ||
        !item.stat
      ) {
        return "missing";
      }

      if (
        item.question.length < 25 ||
        item.question.length > 280
      ) {
        return "question_length";
      }

      if (
        isPolitical(
          `${item.question} ${item.context || ""}`
        )
      ) {
        return "political";
      }

      if (
        item.auto_generated &&
        ageDays(
          item.published_at ||
          item.source_date
        ) >
        maxAgeDaysForSource(
          item.source
        )
      ) {
        return "age";
      }

      return "ok";
    };

  /*
   * LOAD SEED DATA
   */

  const seed =
    JSON.parse(
      fs.readFileSync(
        SEED,
        "utf8"
      )
    );

  /*
   * LOAD PREVIOUS POOL
   */

  let previous = [];

  if (
    fs.existsSync(
      OUT_JSON
    )
  ) {
    try {

      const old =
        JSON.parse(
          fs.readFileSync(
            OUT_JSON,
            "utf8"
          )
        );

      previous =
        Array.isArray(
          old.items
        )
          ? old.items
          : [];

    } catch {}
  }

  /*
   * FETCH SOURCES
   */

  let discovered = [];

  for (
    const source of SOURCES
  ) {
    try {

      console.log(
        `Fetching ${source.name}: ${source.url}`
      );

      const xml =
        await fetchText(
          source.url
        );

      let articles =
        parseRss(xml);

      console.log(
        `  RSS items: ${articles.length}`
      );

      /*
       * Talker publishes several kinds
       * of stories. Only use material
       * identified as Talker Research.
       */
      if (
        source.filter ===
        "talker-research"
      ) {
        articles =
          articles.filter(
            isTalkerResearchArticle
          );

        console.log(
          `  Talker Research items: ${articles.length}`
        );
      }

      const beforeSource =
        discovered.length;

      for (
        const article of articles
      ) {
        discovered.push(
          ...extractCandidates(
            article,
            source.name
          )
        );
      }

      const addedBySource =
        discovered.length -
        beforeSource;

      ensureDiag(
        source.name
      ).discovered +=
        addedBySource;

      console.log(
        `  Usable findings discovered from ${source.name}: ${addedBySource}`
      );

    } catch (err) {

      console.warn(
        `  Source failed: ${err.message}`
      );

    }
  }

  /*
   * MERGE NEW + PREVIOUS + SEED
   */

  const merged = [
    ...discovered,
    ...previous,
    ...seed
  ];

  const discoveredObjects =
    new Set(discovered);

  const dedup =
    new Map();

  for (
    const item of merged
  ) {
    const key =
      item.id ||
      hashId([
        item.source,
        item.source_url,
        item.question
      ]);

    const reason =
      explainUsability(
        item
      );

    if (
      discoveredObjects.has(
        item
      )
    ) {
      const d =
        ensureDiag(
          item.source ||
          "Unknown"
        );

      if (
        reason ===
        "missing"
      ) {
        d.rejectedMissing++;

      } else if (
        reason ===
        "question_length"
      ) {
        d.rejectedQuestionLength++;

      } else if (
        reason ===
        "political"
      ) {
        d.rejectedPolitical++;

      } else if (
        reason ===
        "age"
      ) {
        d.rejectedAge++;
      }
    }

    if (
      reason !== "ok"
    ) {
      continue;
    }

    if (
      dedup.has(key)
    ) {
      if (
        discoveredObjects.has(
          item
        )
      ) {
        ensureDiag(
          item.source ||
          "Unknown"
        ).rejectedDuplicate++;
      }

      continue;
    }

    dedup.set(
      key,
      {
        ...item,
        id: key
      }
    );
  }

  /*
   * SORT AND LIMIT ROLLING POOL
   */

  const allUsable = [
    ...dedup.values()
  ].sort(
    (a, b) =>
      String(
        b.published_at ||
        b.source_date ||
        ""
      ).localeCompare(
        String(
          a.published_at ||
          a.source_date ||
          ""
        )
      )
  );

  const items =
    allUsable.slice(
      0,
      MAX_POOL
    );

  const finalIds =
    new Set(
      items.map(
        x => x.id
      )
    );

  /*
   * COUNT ACCEPTED NEW FINDINGS
   */

  for (
    const item of discovered
  ) {
    const reason =
      explainUsability(
        item
      );

    const key =
      item.id ||
      hashId([
        item.source,
        item.source_url,
        item.question
      ]);

    if (
      reason === "ok" &&
      finalIds.has(key)
    ) {
      ensureDiag(
        item.source ||
        "Unknown"
      ).accepted++;
    }
  }

  /*
   * PRINT DIAGNOSTICS
   */

  for (
    const [source, d]
    of Object.entries(diag)
  ) {
    console.log(
      `Diagnostics ${source}: ` +
      `discovered=${d.discovered}, ` +
      `missing=${d.rejectedMissing}, ` +
      `question_length=${d.rejectedQuestionLength}, ` +
      `political=${d.rejectedPolitical}, ` +
      `age=${d.rejectedAge}, ` +
      `duplicate=${d.rejectedDuplicate}, ` +
      `accepted=${d.accepted}`
    );
  }

  /*
   * WRITE JSON POOL
   */

  const payload = {
    updated_at:
      new Date()
        .toISOString(),

    count:
      items.length,

    items
  };

  fs.mkdirSync(
    path.dirname(
      OUT_JSON
    ),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    OUT_JSON,
    JSON.stringify(
      payload,
      null,
      2
    ) + "\n"
  );

  /*
   * DAILY ROTATION
   */

  const rotationState =
    readRotationState();

  const daily7 =
    pickDailyRotation(
      items,
      7,
      rotationState
    );

  const daily5 =
    daily7.slice(
      0,
      5
    );

  const daily3 =
    daily7.slice(
      0,
      3
    );

  /*
   * GENERATE STATIC PAGES
   */

  fs.writeFileSync(
    OUT_HTML_3,
    buildWidgetHtml(
      daily3,
      3
    )
  );

  fs.writeFileSync(
    OUT_HTML_5,
    buildWidgetHtml(
      daily5,
      5
    )
  );

  fs.writeFileSync(
    OUT_HTML_7,
    buildWidgetHtml(
      daily7,
      7
    )
  );

  /*
   * Default alias = 3 items
   */

  fs.writeFileSync(
    OUT_HTML,
    buildWidgetHtml(
      daily3,
      3
    )
  );

  /*
   * SAVE ROTATION HISTORY
   */

  rotationState.history = [
    {
      date:
        dateKey(),

      ids:
        daily7.map(
          x => x.id
        )
    },

    ...(rotationState.history || [])
      .filter(
        x =>
          x.date !==
          dateKey()
      )

  ].slice(
    0,
    30
  );

  writeRotationState(
    rotationState
  );

  /*
   * FINAL BUILD REPORT
   */

  console.log(
    `Published ${items.length} Survey Says items (${discovered.length} discovered this run).`
  );

  const mix3 =
    daily3.reduce(
      (m, x) => {
        m[x.source] =
          (
            m[x.source] ||
            0
          ) + 1;

        return m;
      },
      {}
    );

  const mix7 =
    daily7.reduce(
      (m, x) => {
        m[x.source] =
          (
            m[x.source] ||
            0
          ) + 1;

        return m;
      },
      {}
    );

  console.log(
    `Default 3 source mix: ${JSON.stringify(mix3)}`
  );

  console.log(
    `Full 7 source mix: ${JSON.stringify(mix7)}`
  );

  console.log(
    `Daily rotation selected ${daily7.length} items; avoiding the previous ${RECENT_SHOWN_DAYS} days when possible.`
  );

  console.log(
    "Static widgets: 3 / 5 / 7 generated in docs/"
  );

})().catch(
  err => {

    console.error(err);

    process.exit(1);

  }
);
