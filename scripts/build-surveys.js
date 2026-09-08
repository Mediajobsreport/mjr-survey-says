const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const OUT_JSON = path.join(process.cwd(), "docs", "surveys.json");
const OUT_HTML = path.join(process.cwd(), "docs", "survey-says.html");
const SEED = path.join(process.cwd(), "data-seed.json");

const SOURCES = [
  {
    name: "Pew Research Center",
    url: "https://www.pewresearch.org/publications/feed/",
    mode: "rss"
  }
];

const MAX_POOL = 60;
const MAX_AGE_DAYS = 120;
const MAX_WIDGET_ITEMS = 7;

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
function escapeHtml(s="") {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
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
function isPolitical(text="") {
  return /\b(trump|biden|democrat|republican|congress|senate|house of representatives|election|vote|voter|partisan|political party|white house|supreme court|immigration policy|foreign policy|president|governor)\b/i.test(text);
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
  let m = s.match(new RegExp(`^${escaped}\\s+of\\s+(.+?)[.!]?$`, "i"));
  if (m) return `What percentage of ${m[1].replace(/[.!?]+$/,"")}?`;
  m = s.match(new RegExp(`^(Among\\s+[^,]+,\\s*)${escaped}\\s+(.+?)[.!]?$`, "i"));
  if (m) return `${m[1]}what percentage ${m[2].replace(/[.!?]+$/,"")}?`;
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
function displayDate(raw) {
  const d = new Date(raw + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return raw || "";
  return d.toLocaleDateString("en-US", {month:"short", day:"numeric", year:"numeric", timeZone:"UTC"});
}
function ageDays(date) {
  return (Date.now() - new Date(date + "T00:00:00Z").getTime()) / 86400000;
}
function extractCandidates(article, sourceName) {
  if (isPolitical(`${article.title} ${article.description} ${article.content}`)) return [];
  const base = [article.description, article.content].filter(Boolean).join(" ");
  const seen = new Set();
  const out = [];
  for (const sentence of sentences(base)) {
    if (isPolitical(sentence)) continue;
    const matches = [...sentence.matchAll(/\b(?!1000)(\d{1,2}|100)%\b/g)];
    if (!matches.length) continue;
    if (/\b(discount|off sale|battery|humidity|chance of rain)\b/i.test(sentence)) continue;
    for (const match of matches.slice(0,2)) {
      const stat = match[0];
      const n = Number(match[1]);
      if (n < 5 || n > 95) continue;
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
  if (isPolitical(`${item.question} ${item.context || ""}`)) return false;
  if (item.auto_generated && ageDays(item.published_at || item.source_date) > MAX_AGE_DAYS) return false;
  return true;
}
function pickWidgetItems(items) {
  const picked = [];
  const topicCount = new Map();
  for (const item of items) {
    const n = topicCount.get(item.topic) || 0;
    if (n >= 2) continue;
    picked.push(item);
    topicCount.set(item.topic, n + 1);
    if (picked.length >= MAX_WIDGET_ITEMS) break;
  }
  if (picked.length < MAX_WIDGET_ITEMS) {
    for (const item of items) {
      if (!picked.some(x => x.id === item.id)) picked.push(item);
      if (picked.length >= MAX_WIDGET_ITEMS) break;
    }
  }
  return picked;
}
function buildWidgetHtml(items) {
  const picked = pickWidgetItems(items);
  const topics = [...new Set(picked.map(x => x.topic))].sort();
  const options = topics.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("\n");
  const cards = picked.map((item, i) => {
    const extraClass = i >= 3 ? " mjrss-extra" : "";
    return `<article class="mjrss-card${extraClass}" data-topic="${escapeHtml(item.topic)}">
      <div class="mjrss-main">
        <div class="mjrss-meta"><span class="mjrss-topic">${escapeHtml(item.topic)}</span><span class="mjrss-date">${escapeHtml(displayDate(item.source_date || item.published_at))}</span></div>
        <p class="mjrss-question">${escapeHtml(item.question)}</p>
        <p class="mjrss-context"><strong>Answer:</strong> ${escapeHtml(item.answer || item.stat)}${item.context ? ` — ${escapeHtml(item.context)}` : ""}</p>
        <p class="mjrss-talk"><strong>Talk About It:</strong> ${escapeHtml(item.talk || talkFor(item.topic))}</p>
        <div class="mjrss-source"><strong>Source:</strong> <a href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.source)}</a></div>
      </div>
      <div class="mjrss-statbox"><span class="mjrss-stat">${escapeHtml(item.stat)}</span><span class="mjrss-answerlabel">Answer</span></div>
    </article>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MJR Survey Says</title>
<style>
html,body{margin:0;padding:0;background:transparent;font-family:Roboto,Arial,sans-serif}#mjrSurveySays{--mjrss-blue:#192A56;--mjrss-ink:#172033;--mjrss-muted:#687386;--mjrss-line:#dfe5ee;--mjrss-soft:#f5f7fb;width:100%;margin:0;background:#fff;border:1px solid var(--mjrss-line);border-radius:0 0 10px 10px;overflow:hidden;color:var(--mjrss-ink);box-sizing:border-box}#mjrSurveySays,#mjrSurveySays *{box-sizing:border-box}#mjrSurveySays .mjrss-head{background:var(--mjrss-blue);color:#fff;text-align:center;padding:11px 14px 10px}#mjrSurveySays .mjrss-head h2{margin:0;color:#fff;font-size:21px;line-height:1.1;font-weight:800}#mjrSurveySays .mjrss-head p{margin:4px 0 0;color:#fff;font-size:12px;line-height:1.3;opacity:.9}#mjrSurveySays .mjrss-toolbar{padding:7px 10px;border-bottom:1px solid var(--mjrss-line);background:#fff;display:flex;justify-content:flex-start}#mjrSurveySays .mjrss-toolbar label{display:flex;gap:6px;align-items:center;font-size:11px;font-weight:700;color:var(--mjrss-blue)}#mjrSurveySays .mjrss-topicfilter{border:1px solid #cfd7e5;border-radius:6px;background:#fff;color:var(--mjrss-blue);padding:5px 8px;font:700 11px/1 Roboto,Arial,sans-serif}#mjrSurveySays .mjrss-card{display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:12px;padding:10px 14px;border-bottom:1px solid var(--mjrss-line);background:#fff}#mjrSurveySays .mjrss-card:nth-child(even){background:#fafbfe}#mjrSurveySays .mjrss-extra{display:none}#mjrSurveySays .mjrss-meta{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-bottom:4px}#mjrSurveySays .mjrss-topic{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--mjrss-blue)}#mjrSurveySays .mjrss-date{font-size:10px;color:var(--mjrss-muted)}#mjrSurveySays .mjrss-question{margin:0 0 4px;color:var(--mjrss-ink);font-size:15px;line-height:1.3;font-weight:800}#mjrSurveySays .mjrss-context,#mjrSurveySays .mjrss-talk{margin:0 0 5px;color:var(--mjrss-ink);font-size:12px;line-height:1.35}#mjrSurveySays .mjrss-source{color:var(--mjrss-muted);font-size:10.5px;line-height:1.3}#mjrSurveySays .mjrss-source a{color:var(--mjrss-blue);text-decoration:underline}#mjrSurveySays .mjrss-statbox{align-self:center;justify-self:stretch;background:var(--mjrss-soft);border:1px solid var(--mjrss-line);border-radius:8px;padding:9px 8px;text-align:center}#mjrSurveySays .mjrss-stat{display:block;color:var(--mjrss-blue);font-size:24px;line-height:1;font-weight:900}#mjrSurveySays .mjrss-answerlabel{display:block;margin-top:4px;color:var(--mjrss-muted);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}#mjrSurveySays .mjrss-controls{display:flex;justify-content:center;gap:6px;padding:8px 10px;background:#fff}#mjrSurveySays .mjrss-control{border:1px solid #cfd7e5;border-radius:6px;background:#fff;color:var(--mjrss-blue);padding:6px 10px;font:700 11px/1 Roboto,Arial,sans-serif;cursor:pointer}#mjrSurveySays .mjrss-control.active{background:var(--mjrss-blue);border-color:var(--mjrss-blue);color:#fff}@media(max-width:680px){#mjrSurveySays .mjrss-card{grid-template-columns:minmax(0,1fr) 84px;gap:8px;padding:9px 10px}#mjrSurveySays .mjrss-question{font-size:14px}#mjrSurveySays .mjrss-context,#mjrSurveySays .mjrss-talk{font-size:11.5px}#mjrSurveySays .mjrss-stat{font-size:20px}}@media(max-width:480px){#mjrSurveySays .mjrss-card{grid-template-columns:1fr}#mjrSurveySays .mjrss-statbox{justify-self:start;min-width:84px}}
</style>
</head>
<body>
<div id="mjrSurveySays">
  <div class="mjrss-head"><h2>📊 MJR SURVEY SAYS</h2><p>Fresh, source-backed surveys and stats for on-air conversation.</p></div>
  <div class="mjrss-toolbar"><label><span>Topic</span><select class="mjrss-topicfilter" aria-label="Filter Survey Says by topic"><option value="all">All Topics</option>${options}</select></label></div>
  <div class="mjrss-cards">${cards}</div>
  <div class="mjrss-controls"><button type="button" data-count="3" class="mjrss-control active">Show Less</button><button type="button" data-count="5" class="mjrss-control">Show 5</button><button type="button" data-count="7" class="mjrss-control">Show 7</button></div>
</div>
<script>
(function(){var root=document.getElementById("mjrSurveySays");if(!root)return;var controls=root.querySelectorAll(".mjrss-control");var filter=root.querySelector(".mjrss-topicfilter");var cards=root.querySelectorAll(".mjrss-card");var count=3;function update(){var topic=filter.value;var shown=0;cards.forEach(function(card){var match=(topic==="all"||card.getAttribute("data-topic")===topic);var visible=match&&shown<count;card.style.display=visible?"grid":"none";if(visible)shown++;});controls.forEach(function(btn){btn.classList.toggle("active",Number(btn.getAttribute("data-count"))===count);});}controls.forEach(function(btn){btn.addEventListener("click",function(){count=Number(btn.getAttribute("data-count"));update();});});filter.addEventListener("change",update);update();})();
</script>
</body>
</html>`;
}
async function fetchText(url) {
  const r = await fetch(url, {headers: {"user-agent":"MediaJobsReport-SurveySays/1.1 (+https://www.mediajobsreport.com/)"}, redirect:"follow"});
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return await r.text();
}

(async () => {
  console.log("Building MJR Survey Says feed + static widget...");
  const seed = JSON.parse(fs.readFileSync(SEED, "utf8"));
  let previous = [];
  if (fs.existsSync(OUT_JSON)) {
    try { const old = JSON.parse(fs.readFileSync(OUT_JSON, "utf8")); previous = Array.isArray(old.items) ? old.items : []; } catch {}
  }

  let discovered = [];
  for (const source of SOURCES) {
    try {
      console.log(`Fetching ${source.name}: ${source.url}`);
      const xml = await fetchText(source.url);
      const articles = parseRss(xml);
      console.log(`  RSS items: ${articles.length}`);
      for (const article of articles) discovered.push(...extractCandidates(article, source.name));
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

  const payload = {updated_at: new Date().toISOString(), count: items.length, items};
  fs.mkdirSync(path.dirname(OUT_JSON), {recursive:true});
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + "\n");
  fs.writeFileSync(OUT_HTML, buildWidgetHtml(items));
  console.log(`Published ${items.length} Survey Says items (${discovered.length} discovered this run).`);
  console.log(`Static widget: ${OUT_HTML}`);
})().catch(err => { console.error(err); process.exit(1); });
