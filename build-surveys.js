const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const OUT = path.join(process.cwd(), "docs", "surveys.json");
const SEED = path.join(process.cwd(), "data-seed.json");

// Official Pew Research Center publications RSS.
const SOURCES = [
  {
    name: "Pew Research Center",
    url: "https://www.pewresearch.org/publications/feed/",
    mode: "rss"
  }
];

const MAX_POOL = 60;
const MAX_AGE_DAYS = 120;

function decodeXml(s="") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'");
}
function stripHtml(s="") {
  return decodeXml(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? stripHtml(m[1]) : "";
}
function parseRss(xml) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return blocks.map(b => ({
    title: tag(b, "title"),
    link: tag(b, "link"),
    date: tag(b, "pubDate"),
    description: tag(b, "description"),
    content: tag(b, "content:encoded")
  }));
}
function sentences(text="") {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map(s => s.trim())
    .filter(s => s.length >= 35 && s.length <= 330);
}
function inferTopic(text="") {
  const t = text.toLowerCase();
  const rules = [
    ["Technology", /\b(ai|artificial intelligence|chatbot|smartphone|internet|online|social media|technology|digital)\b/],
    ["Entertainment", /\b(streaming|television|tv|movie|music|podcast|radio|entertainment)\b/],
    ["Money", /\b(money|cost|price|inflation|financial|economy|spending|income|cash|debt)\b/],
    ["Work", /\b(work|job|employee|employer|workplace|career|office)\b/],
    ["Shopping", /\b(shop|shopping|retail|store|purchase|consumer|buy)\b/],
    ["Food & Dining", /\b(food|restaurant|meal|fast food|grocery|dining)\b/],
    ["Family & Life", /\b(parent|child|family|relationship|dating|marriage|home)\b/],
    ["Health", /\b(health|doctor|medical|hospital|fitness|sleep)\b/]
  ];
  for (const [name, re] of rules) if (re.test(t)) return name;
  return "Life & Culture";
}
function talkFor(topic) {
  const prompts = {
    "Technology":"Would this number be higher or lower among your friends and coworkers?",
    "Entertainment":"Does this match your own viewing, listening or entertainment habits?",
    "Money":"Where do you see this showing up most in your own budget?",
    "Work":"Does this sound like your workplace, or is your experience completely different?",
    "Shopping":"What purchase or shopping habit have you changed the most lately?",
    "Food & Dining":"Does this match the way you eat, order or dine out?",
    "Family & Life":"Would your family or friends agree with this finding?",
    "Health":"Has this changed the way you think about your own health choices?",
    "Life & Culture":"Does this number surprise you, or does it sound about right?"
  };
  return prompts[topic] || prompts["Life & Culture"];
}
function makeQuestion(sentence, pct) {
  let s = sentence.replace(/\s+/g, " ").trim();
  const escaped = pct.replace("%", "\\%");
  // Best radio-friendly pattern: "42% of U.S. adults say..." -> "What percentage of U.S. adults say...?"
  let m = s.match(new RegExp(`^${escaped}\\s+of\\s+(.+?)[.!]?$`, "i"));
  if (m) return `What percentage of ${m[1].replace(/[.!?]+$/,"")}?`;

  // "Among X, 42% say..." -> "Among X, what percentage say...?"
  m = s.match(new RegExp(`^(Among\\s+[^,]+,\\s*)${escaped}\\s+(.+?)[.!]?$`, "i"));
  if (m) return `${m[1]}what percentage ${m[2].replace(/[.!?]+$/,"")}?`;

  // General fallback.
  const replaced = s.replace(new RegExp(escaped, "i"), "what percentage");
  return replaced.replace(/[.!]+$/, "") + (replaced.endsWith("?") ? "" : "?");
}
function hashId(parts) {
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}
function isoDate(raw) {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0,10) : d.toISOString().slice(0,10);
}
function ageDays(date) {
  return (Date.now() - new Date(date + "T00:00:00Z").getTime()) / 86400000;
}
function extractCandidates(article, sourceName) {
  const base = [article.description, article.content].filter(Boolean).join(" ");
  const seen = new Set();
  const out = [];
  for (const sentence of sentences(base)) {
    const matches = [...sentence.matchAll(/\b(?!1000)(\d{1,2}|100)%\b/g)];
    if (!matches.length) continue;

    // Avoid obvious non-survey noise.
    if (/\b(discount|off sale|battery|humidity|chance of rain)\b/i.test(sentence)) continue;

    for (const match of matches.slice(0,2)) {
      const stat = match[0];
      const n = Number(match[1]);
      if (n < 5 || n > 95) continue; // reduces dates/noisy edge cases
      const key = `${article.link}|${sentence}|${stat}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const topic = inferTopic(`${article.title} ${sentence}`);
      const published = isoDate(article.date);
      out.push({
        id: hashId([sourceName, article.link, sentence, stat]),
        topic,
        question: makeQuestion(sentence, stat),
        answer: stat,
        stat,
        context: article.title ? `From “${article.title}.”` : "From a recent survey finding.",
        talk: talkFor(topic),
        source: sourceName,
        source_url: article.link,
        source_date: published,
        published_at: published,
        auto_generated: true
      });
    }
  }
  return out;
}
function isUsable(item) {
  if (!item || !item.question || !item.source_url || !item.stat) return false;
  if (item.question.length < 25 || item.question.length > 280) return false;
  if (item.auto_generated && ageDays(item.published_at || item.source_date) > MAX_AGE_DAYS) return false;
  return true;
}
async function fetchText(url) {
  const r = await fetch(url, {
    headers: {"user-agent":"MediaJobsReport-SurveySays/1.0 (+https://www.mediajobsreport.com/)"},
    redirect: "follow"
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return await r.text();
}

(async () => {
  console.log("Building MJR Survey Says feed...");
  const seed = JSON.parse(fs.readFileSync(SEED, "utf8"));
  let previous = [];
  if (fs.existsSync(OUT)) {
    try {
      const old = JSON.parse(fs.readFileSync(OUT, "utf8"));
      previous = Array.isArray(old.items) ? old.items : [];
    } catch {}
  }

  let discovered = [];
  for (const source of SOURCES) {
    try {
      console.log(`Fetching ${source.name}: ${source.url}`);
      const xml = await fetchText(source.url);
      const articles = parseRss(xml);
      console.log(`  RSS items: ${articles.length}`);
      for (const article of articles) {
        discovered.push(...extractCandidates(article, source.name));
      }
    } catch (err) {
      console.warn(`  Source failed: ${err.message}`);
    }
  }

  const merged = [...discovered, ...previous, ...seed];
  const dedup = new Map();
  for (const item of merged) {
    const key = item.id || hashId([item.source, item.source_url, item.question]);
    if (!dedup.has(key) && isUsable(item)) dedup.set(key, {...item, id:key});
  }

  const items = [...dedup.values()]
    .sort((a,b) => String(b.published_at || b.source_date).localeCompare(String(a.published_at || a.source_date)))
    .slice(0, MAX_POOL);

  const payload = {
    updated_at: new Date().toISOString(),
    count: items.length,
    items
  };

  fs.mkdirSync(path.dirname(OUT), {recursive:true});
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Published ${items.length} Survey Says items (${discovered.length} discovered this run).`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
