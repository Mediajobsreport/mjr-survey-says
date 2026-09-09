const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.cwd();
const DOCS = path.join(ROOT, 'docs');
const OUT_JSON = path.join(DOCS, 'surveys.json');
const OUT_HTML = path.join(DOCS, 'survey-says.html');
const OUT_HTML_3 = path.join(DOCS, 'survey-says-3.html');
const OUT_HTML_5 = path.join(DOCS, 'survey-says-5.html');
const OUT_HTML_7 = path.join(DOCS, 'survey-says-7.html');
const SEED = path.join(ROOT, 'data-seed.json');
const ROTATION_STATE = path.join(ROOT, 'mjr-survey-rotation.json');

const MAX_POOL = 140;
const MAX_AGE_DAYS = 180;
const AP_NORC_MAX_AGE_DAYS = 365;
const RECENT_SHOWN_DAYS = 7;
const MAX_WIDGET_ITEMS = 7;
const MAX_PER_SOURCE = 2;
const MAX_DEEP_FETCH = 14;

const RSS_SOURCES = [
  { name: 'Talker Research', url: 'https://talker.news/feed/', filter: 'talker-research' },
  { name: 'Pew Research Center', url: 'https://www.pewresearch.org/publications/feed/' },
  { name: 'AP-NORC Center', url: 'https://apnorc.org/feed/' },
  { name: 'AP-NORC Center', url: 'https://apnorc.org/topics/culture-and-society/feed/' },
  { name: 'AP-NORC Center', url: 'https://apnorc.org/topics/science-and-technology/feed/' },
  { name: 'AP-NORC Center', url: 'https://apnorc.org/topics/younger-generations/feed/' },
  { name: 'AP-NORC Center', url: 'https://apnorc.org/topics/education/feed/' },
  { name: 'AP-NORC Center', url: 'https://apnorc.org/topics/media-insight-project/feed/' },
  { name: 'Edison Research', url: 'https://www.edisonresearch.com/feed/', deepFetch: true },
  { name: 'Ipsos', url: 'https://www.ipsos.com/en-us/rss.xml', deepFetch: true },
  { name: 'CivicScience', url: 'https://civicscience.com/feed/' }
];

const HTML_DISCOVERY = [
  {
    name: 'The Harris Poll',
    url: 'https://theharrispoll.com/topic/america-this-week/',
    match: /\/articles\/america-this-week-[^?#"']+/i,
    max: 12
  },
  {
    name: 'The Harris Poll',
    url: 'https://theharrispoll.com/articles/',
    match: /\/articles\/[^?#"']+/i,
    max: 10
  }
];

function maxAgeDaysForSource(source) {
  return source === 'AP-NORC Center' ? AP_NORC_MAX_AGE_DAYS : MAX_AGE_DAYS;
}

function decodeXml(s = '') {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#0*38;/g, '&')
    .replace(/&#8217;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8230;/g, '…')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripHtml(s = '') {
  return decodeXml(String(s))
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? stripHtml(m[1]) : '';
}

function rawTag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? decodeXml(m[1]).trim() : '';
}

function tags(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'gi');
  return [...block.matchAll(re)].map(m => stripHtml(m[1])).filter(Boolean);
}

function parseRss(xml) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return blocks.map(b => ({
    title: tag(b, 'title'),
    link: tag(b, 'link') || tag(b, 'guid'),
    date: tag(b, 'pubDate') || tag(b, 'dc:date'),
    description: rawTag(b, 'description'),
    content: rawTag(b, 'content:encoded'),
    creator: tag(b, 'dc:creator') || tag(b, 'author'),
    categories: tags(b, 'category')
  }));
}

function parseAtom(xml) {
  const blocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return blocks.map(b => {
    const lm = b.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
    return {
      title: tag(b, 'title'),
      link: lm ? decodeXml(lm[1]) : '',
      date: tag(b, 'updated') || tag(b, 'published'),
      description: rawTag(b, 'summary'),
      content: rawTag(b, 'content'),
      creator: tag(b, 'name'),
      categories: []
    };
  });
}

function parseFeed(xml) {
  const rss = parseRss(xml);
  return rss.length ? rss : parseAtom(xml);
}

function isTalkerResearchArticle(article) {
  const h = [article.creator || '', ...(article.categories || []), article.title || '', stripHtml(article.description || ''), stripHtml(article.content || '')].join(' ');
  return /\bTalker Research\b/i.test(h);
}

function normalizeUrl(href, base) {
  try {
    const u = new URL(decodeXml(href), base);
    u.hash = '';
    return u.toString();
  } catch {
    return '';
  }
}

function discoverLinks(html, baseUrl, matcher, max = 10) {
  const links = [];
  const seen = new Set();
  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const url = normalizeUrl(m[1], baseUrl);
    if (!url || !matcher.test(url)) continue;
    matcher.lastIndex = 0;
    const clean = url.replace(/[?#].*$/, '');
    if (seen.has(clean)) continue;
    seen.add(clean);
    links.push(clean);
    if (links.length >= max) break;
  }
  return links;
}

function htmlTitle(html = '') {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
             html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (og) return stripHtml(og[1]);
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return stripHtml(h1[1]);
  const t = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return t ? stripHtml(t[1]).replace(/\s+[|–-]\s+[^|–-]+$/, '').trim() : '';
}

function htmlDate(html = '') {
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return '';
}

function htmlMainText(html = '') {
  const candidates = [];
  for (const re of [
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    /<main\b[^>]*>([\s\S]*?)<\/main>/gi,
    /<div\b[^>]+class=["'][^"']*(?:entry-content|article-content|post-content|content-body|field--name-body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi
  ]) {
    for (const m of html.matchAll(re)) {
      const text = stripHtml(m[1]);
      if (text.length > 250) candidates.push(text);
    }
  }
  if (candidates.length) return candidates.sort((a, b) => b.length - a.length)[0];
  return stripHtml(html);
}

function sentences(text = '') {
  return stripHtml(text)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"'])/)
    .map(s => s.trim())
    .filter(s => s.length >= 35 && s.length <= 360);
}

function inferTopic(text = '') {
  const t = text.toLowerCase();
  const rules = [
    ['Work', /\b(work|job|employee|employees|employer|workplace|career|office|worker|workers|employed|hiring|manager|managers)\b/],
    ['Technology', /\b(ai|artificial intelligence|chatbot|chatbots|smartphone|internet|online|social media|technology|digital|crypto|cryptocurrency|biometric|privacy|tech)\b/],
    ['Entertainment', /\b(streaming|streamed radio|radio|television|tv|movie|movies|music|podcast|podcasts|entertainment|audio|sports streaming|sports fan|sports fans|game|gaming)\b/],
    ['Money', /\b(money|cost|price|inflation|financial|finance|economy|spending|income|cash|debt|donation|donate|donated|crowdfunding|expense|charity|charitable|budget|saving|savings)\b/],
    ['Shopping', /\b(shop|shopping|retail|store|purchase|consumer|buy|bought|discount|discounts|brand|brands)\b/],
    ['Food & Dining', /\b(food|restaurant|meal|fast food|grocery|dining|eat|eating|order|ordering|beverage|snack)\b/],
    ['Family & Life', /\b(parent|parents|child|children|family|relationship|dating|marriage|home|caregiver|childcare|daycare|kids|kid)\b/],
    ['Health', /\b(health|wellness|doctor|medical|hospital|fitness|sleep|medicine|insurance|healthcare)\b/]
  ];
  for (const [name, re] of rules) if (re.test(t)) return name;
  return 'Life & Culture';
}

function inferTopicFromFinding(sentence = '', title = '') {
  if (/\b(new year(?:'s)? eve|new year|christmas|thanksgiving|halloween|holiday plans?|midnight|valentine(?:'s)? day|easter)\b/i.test(sentence)) return 'Life & Culture';
  const fromSentence = inferTopic(sentence);
  return fromSentence !== 'Life & Culture' ? fromSentence : inferTopic(title);
}

function isPolitical(text = '') {
  return /\b(trump|biden|democrats?|republicans?|congress|senate|house of representatives|election|elections|vote|votes|voter|voters|partisan|political party|white house|supreme court|immigration policy|foreign policy|president|presidential|governor|governors|candidate|candidates|midterms?|maga)\b/i.test(text);
}

function talkForFinding(topic, sentence = '', title = '') {
  const s = sentence.toLowerCase();
  const h = `${sentence} ${title}`.toLowerCase();
  if (/\bnew year(?:'s)? eve\b/.test(h)) return 'Do you usually make it to midnight on New Year’s Eve, or are you asleep before the countdown?';
  if (/\braising children|circle of trust|wider circle\b/.test(h)) return 'Who do parents rely on most today when they need help, advice or someone they can trust with their kids?';
  if (/\bchildcare|daycare|child care\b/.test(h)) return 'When choosing care for a child, what matters most: cost, location, trust or flexibility?';
  if (/\bcrowdfund(?:ing|ed)?\b/.test(h)) return 'Have you ever donated to a crowdfunding campaign? What made you decide to give?';
  if (/\bcharit(?:y|ies|able)\b/.test(h) || /\bdonat(?:e|ed|ion|ions)\b/.test(s)) return 'What type of cause are you most likely to donate to, and what makes you trust an organization enough to give?';
  if (/\bstreamed radio|streaming radio|radio stream\b/.test(s)) return 'How often do you listen to a radio station through an app or stream instead of a regular radio?';
  if (/\bsports streaming\b/.test(h)) return 'Have streaming services made it easier or harder for you to watch the sports you want?';
  if (/\bradio\b/.test(s)) return 'Does this match the way you or the people around you use radio?';
  if (/\bpodcast\b/.test(s)) return 'How do your own podcast habits compare with this finding?';
  if (/\bhealth|wellness\b/.test(s) && /\binfluencer/.test(s)) return 'Would you trust health advice from an influencer, or do you want it from a medical professional?';
  if (/\bcrypto|cryptocurrency\b/.test(s)) return 'Have you ever owned or used cryptocurrency, or have you stayed away from it completely?';
  if (/\bsocial media\b/.test(s)) return 'Does this match the way you and your friends actually use social media?';
  if (/\b(ai|artificial intelligence|chatbot)\b/.test(s)) return 'What everyday task are you most willing to hand over to AI?';
  const prompts = {
    Technology: 'Would this number be higher or lower among your friends and coworkers?',
    Entertainment: 'Does this match your own viewing, listening or entertainment habits?',
    Money: 'Does this finding match the way you are spending, saving or giving right now?',
    Work: 'Does this sound like your workplace, or is your experience completely different?',
    Shopping: 'What purchase or shopping habit have you changed the most lately?',
    'Food & Dining': 'Does this match the way you eat, order or dine out?',
    'Family & Life': 'Would your family or friends agree with this finding?',
    Health: 'Has this changed the way you think about your own health choices?',
    'Life & Culture': 'Does this number surprise you, or does it sound about right?'
  };
  return prompts[topic] || prompts['Life & Culture'];
}

function regexEscape(s = '') {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NUM_WORD = '(?:one|two|three|four|five|six|seven|eight|nine|ten)';
const RATIO_RE = new RegExp(`\\b(?:[1-9]|10|${NUM_WORD})\\s+in\\s+(?:[2-9]|10|${NUM_WORD})\\b`, 'i');

function containsVisibleStat(text = '') {
  const q = String(text);
  return /\b\d{1,3}%/.test(q) || RATIO_RE.test(q);
}

function containsUndefinedReference(text = '') {
  return /\b(these|those|such)\s+(factors?|issues?|things?|reasons?|circumstances?|conditions?|changes?|effects?|events?|concerns?|problems?|pressures?|challenges?|results?|findings?)\b|\b(say|says|said|feel|feels|felt|do|does|did|think|thinks|thought)\s+the same\b|\bthe same\s*[–—-]/i.test(text);
}

function hasIncompleteMoreLessObject(text = '') {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return /\b(?:plan|plans|planned|planning|expect|expects|expected|want|wants|wanted|intend|intends|intended|likely)\s+(?:to\s+)?(?:give|spend|use|do|buy|save|pay|cut|consume|shop|travel|work)\s+(?:more|less)\b(?!\s+(?:on|for|to|than|money|time|hours?|dollars?|percent|percentage)\b)/i.test(t);
}


// v2.9: reject survey findings where the statistic has no explicit population.
// Example rejected: "42% are already using donor-advised funds."
// Example allowed:  "Among Millennials, 42% are already using donor-advised funds."
function hasUndefinedPopulationFinding(sentence = '', target = null) {
  if (!target) return false;
  const s = String(sentence).replace(/\s+/g, ' ').trim();
  const raw = String(target.raw || target.stat || '').trim();
  if (!raw) return false;
  const idx = s.toLowerCase().indexOf(raw.toLowerCase());
  if (idx < 0) return true;

  const before = s.slice(0, idx).trim();
  const after = s.slice(idx + raw.length).replace(/^[,;:\s-]+/, '').trim();
  const population = /\b(Americans|U\.S\. adults|US adults|adults|parents|workers|employees|consumers|respondents|listeners|viewers|shoppers|teens|teenagers|children|students|people|women|men|young women|young men|Gen Zers|Millennials|Gen Z|sports fans|hiring managers|households|dual-income households|donors|voters|users|customers|families)\b/i;

  // "42% of Millennials ..." carries its population immediately after the stat.
  if (/^of\s+/i.test(after) && population.test(after)) return false;

  // "Among Millennials, 42% ..." or "Of U.S. adults, 42% ..." carries it before the stat.
  if (population.test(before)) return false;

  // A bare stat followed by a verb/pronoun has no standalone population.
  if (/^(?:are|is|were|was|have|has|had|say|says|said|feel|feels|felt|think|thinks|thought|use|uses|used|plan|plans|planned|expect|expects|expected|want|wants|wanted|prefer|prefers|preferred|believe|believes|believed|report|reports|reported|they|their|them)\b/i.test(after)) return true;

  return false;
}

function hasMalformedPercentagePopulation(question = '') {
  const q = String(question).replace(/\s+/g, ' ').trim();
  return /^what percentage\s+(?:are|is|were|was|have|has|had|say|says|said|use|uses|used|plan|plans|planned|they|their|them)\b/i.test(q);
}

function cleanHeadlineCollision(text = '') {
  let t = String(text).replace(/\s+/g, ' ').trim();
  t = t
    .replace(/\s+[–—-]\s+Here[’']s What to Know.*$/i, '')
    .replace(/\s+Here[’']s What to Know.*$/i, '')
    .replace(/\s+In a new poll we conducted with\b.*$/i, '')
    .replace(/\s+In a new poll\b.*$/i, '')
    .replace(/\s+According to new research\b.*$/i, ' according to new research')
    .trim();
  return t;
}

function hasUnsafeCompoundStatAttachment(sentence = '', target = null) {
  if (!target) return false;
  const raw = target.raw || target.stat || '';
  const s = String(sentence).replace(/\s+/g, ' ').trim();
  const idx = s.toLowerCase().indexOf(String(raw).toLowerCase());
  if (idx < 0) return true;
  const before = s.slice(0, idx);
  const m = before.match(/\b(while|whereas|but)\b([^.!?]*)$/i);
  if (!m) return false;
  const clause = m[2] || '';
  return !/\b(Americans|U\.S\. adults|US adults|adults|parents|workers|employees|consumers|respondents|listeners|viewers|shoppers|teens|teenagers|students|people|women|men|Gen Zers|Millennials|Gen Z|sports fans|hiring managers|households|dual-income households)\b/i.test(clause);
}

function isAmbiguousMultiYearQuestion(question = '') {
  const years = question.match(/\b(?:19|20)\d{2}\b/g) || [];
  const uniqueYears = [...new Set(years)];
  return uniqueYears.length >= 2 && /\b(compared|compare|versus|vs\.?|than|this year)\b/i.test(question);
}

function isUnsupportedSportsSuperFanQuestion(question = '', context = '') {
  const h = `${question} ${context}`.toLowerCase();
  return /\bsuper fans?\b/.test(h) && /\bsports streaming services?\b/.test(h) && /\b1 in 5\b/.test(h);
}

function hasBadQuestionLanguage(question = '') {
  const q = question.replace(/\s+/g, ' ').trim();
  if (!q) return true;
  if (/^in a survey about\b/i.test(q)) return true;
  if (/\b(matched this survey finding|matched the survey finding|this survey finding|this finding|the finding above|the survey finding above|the research topic)\b/i.test(q)) return true;
  if (containsUndefinedReference(q)) return true;
  if (hasIncompleteMoreLessObject(q)) return true;
  if (isAmbiguousMultiYearQuestion(q)) return true;
  if (/^how many\s+those who\b/i.test(q)) return true;
  if (/\bhow many\s+(donated|said|used|use|listening|watching|getting|prefer|agreed|believe|think)\b/i.test(q)) return true;
  if (/\bhow many\s+[^?]{0,80}\b(listening|using|watching|getting|adopting)\b/i.test(q)) return true;
  if (/;\s*[^?]+\?/i.test(q)) return true;
  if (containsVisibleStat(q)) return true;
  return false;
}

function questionHasStandaloneContext(question = '') {
  const q = question.replace(/\s+/g, ' ').trim();
  if (hasBadQuestionLanguage(q)) return false;
  if (/\b(this|that|these|those)\s+(number|result|stat|statistic|finding|survey|factor|issue|thing|reason|condition|effect)\b/i.test(q)) return false;
  return true;
}

function findStats(sentence = '') {
  const found = [];
  const nums = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

  for (const m of sentence.matchAll(/\b(?!1000)(\d{1,2}|100)%/g)) {
    const n = Number(m[1]);
    if (n >= 5 && n <= 95) found.push({ stat: `${n}%`, raw: m[0], index: m.index, type: 'percent' });
  }
  for (const m of sentence.matchAll(/\b([1-9]|10)\s+in\s+([2-9]|10)\b/gi)) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a < b) found.push({ stat: `${a} in ${b}`, raw: m[0], index: m.index, type: 'ratio' });
  }
  for (const m of sentence.matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+in\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi)) {
    const a = nums[m[1].toLowerCase()], b = nums[m[2].toLowerCase()];
    if (a < b) found.push({ stat: `${a} in ${b}`, raw: m[0], index: m.index, type: 'ratio' });
  }
  for (const m of sentence.matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+in\s+([2-9]|10)\b/gi)) {
    const a = nums[m[1].toLowerCase()], b = Number(m[2]);
    if (a < b) found.push({ stat: `${a} in ${b}`, raw: m[0], index: m.index, type: 'ratio' });
  }
  for (const m of sentence.matchAll(/\b([1-9]|10)\s+in\s+(two|three|four|five|six|seven|eight|nine|ten)\b/gi)) {
    const a = Number(m[1]), b = nums[m[2].toLowerCase()];
    if (a < b) found.push({ stat: `${a} in ${b}`, raw: m[0], index: m.index, type: 'ratio' });
  }
  const seen = new Set();
  return found.sort((a, b) => a.index - b.index).filter(x => {
    const k = `${x.raw.toLowerCase()}|${x.index}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function stripTrailingSemicolonClause(sentence = '', rawStat = '') {
  const s = sentence.replace(/\s+/g, ' ').trim();
  const semi = s.indexOf(';');
  if (semi < 0) return s;
  const statIndex = s.toLowerCase().indexOf(String(rawStat).toLowerCase());
  return statIndex >= 0 && statIndex < semi ? s.slice(0, semi).trim() : s;
}

function isolateFindingClause(sentence, target, allStats = []) {
  const raw = target.raw || target.stat;
  let s = cleanHeadlineCollision(stripTrailingSemicolonClause(sentence, raw));
  if (containsUndefinedReference(s)) return '';
  if (hasIncompleteMoreLessObject(s)) return '';
  if (hasUndefinedPopulationFinding(s, target)) return '';
  if (hasUnsafeCompoundStatAttachment(s, target)) return '';
  const years = s.match(/\b(?:19|20)\d{2}\b/g) || [];
  if (new Set(years).size >= 2 && /\b(compared|compare|versus|vs\.?|than|this year)\b/i.test(s)) return '';

  // v2.7 quality rule: if a sentence contains more than one visible statistic,
  // reject the sentence rather than risk leaking another number into the question.
  if (allStats.length !== 1) return '';

  const idx = s.toLowerCase().indexOf(raw.toLowerCase());
  if (idx < 0) return '';
  return s;
}

function fixBroadcastGrammar(text = '') {
  return text
    .replace(/\s+/g, ' ').trim()
    .replace(/\bAmericans\s+(\d{1,2})-(\d{1,2})\b/gi, 'Americans ages $1–$2')
    .replace(/\badults\s+(\d{1,2})-(\d{1,2})\b/gi, 'adults ages $1–$2')
    .replace(/\bpeople\s+(\d{1,2})-(\d{1,2})\b/gi, 'people ages $1–$2')
    .replace(/\blistening\s+to\b/gi, 'listen to')
    .replace(/\busing\s+/gi, 'use ')
    .replace(/\bwatching\s+/gi, 'watch ')
    .replace(/\bgetting\s+/gi, 'get ');
}

function contextualPopulationFromTitle(title = '', sentence = '') {
  const h = `${title} ${sentence}`.toLowerCase();
  if (/\bcrowdfund(?:ing|ed)?\b/.test(h)) return 'people who donated to a crowdfunding campaign';
  if (/\bcharit(?:y|ies|able)\b/.test(h)) return 'adults who made charitable donations';
  return '';
}

function startsWithVerbPhrase(text = '') {
  return /^(donated|donate|gave|give|contributed|contribute|spent|spend|said|say|use|used|uses|watch|watched|watches|listen|listened|listens|buy|bought|buys|shop|shopped|shops|prefer|preferred|prefers|agree|agreed|agrees|believe|believed|believes|think|thought|thinks|reported|report|reports|have|had|has|are|were|is|want|wanted|wants|plan|planned|plans|expect|expected|expects|feel|felt|feels|chose|choose|chooses|selected|select|selects|experienced|experience|experiences|received|receive|receives|paid|pay|pays|borrowed|borrow|borrows|saved|save|saves|get|gets|got|would|could|will)\b/i.test(text.trim());
}

function stripRatioLead(sentence, rawStat) {
  const escaped = regexEscape(rawStat);
  return sentence
    .replace(new RegExp(`^(about|around|roughly|nearly|almost|approximately|only|just|more than|less than|another|over|under)?\\s*${escaped}\\s+`, 'i'), '')
    .replace(/^of\s+/i, '')
    .replace(/[.!?]+$/, '')
    .trim();
}

function cleanRatioTail(tail = '') {
  return fixBroadcastGrammar(tail)
    .replace(/\badopting\b/gi, 'have adopted')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeThoseWhoQuestion(tail = '') {
  const clean = tail.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
  const m = clean.match(/^those who (.+?)\s+(believe|believed|think|thought|say|said|report|reported|feel|felt|agree|agreed|expect|expected|use|used|have|had|are|were|want|wanted|prefer|preferred)\s+(.+)$/i);
  if (!m) return '';
  return `Among those who ${m[1].trim()}, how many ${m[2].trim()} ${m[3].trim()}?`;
}

function makeRatioQuestion(sentence, target, articleTitle = '') {
  const s = sentence.replace(/\s+/g, ' ').trim();
  const raw = target.raw || target.stat;
  const escaped = regexEscape(raw);
  const begins = new RegExp(`^(about|around|roughly|nearly|almost|approximately|only|just|more than|less than|another|over|under)?\\s*${escaped}\\s+`, 'i').test(s);

  if (begins) {
    const tail = cleanRatioTail(stripRatioLead(s, raw));
    if (!tail || containsUndefinedReference(tail)) return '';
    if (/\bsuper fans?\b/i.test(tail) && /\bsports streaming services?\b/i.test(tail)) return '';
    if (/^those who\b/i.test(tail)) return makeThoseWhoQuestion(tail);
    if (/^Americans\s+have used crypto\b/i.test(tail)) return 'How many Americans have used cryptocurrency?';
    if (/^(donated|gave|contributed)\b/i.test(tail)) {
      const pop = contextualPopulationFromTitle(articleTitle, s);
      return pop ? `Among ${pop}, how many ${tail}?` : '';
    }
    if (/^(Americans|U\.S\. adults|US adults|Australians|adults|people|parents|workers|employees|consumers|respondents|listeners|viewers|shoppers|students|teens|teenagers|women|men|young women|young men|Gen Zers|Millennials|Gen Z|sports fans|hiring managers|households|dual-income households)\b/i.test(tail)) return `How many ${tail}?`;
    if (startsWithVerbPhrase(tail)) return `How many people ${tail}?`;
    return `How many ${tail}?`;
  }

  const idx = s.toLowerCase().indexOf(raw.toLowerCase());
  if (idx < 0) return '';
  const before = s.slice(0, idx).replace(/[,;:\s-]+$/, '').trim();
  const after = cleanRatioTail(s.slice(idx + raw.length).replace(/^[,;:\s-]+/, '').replace(/[.!?]+$/, '').trim().replace(/^of\s+/i, ''));
  if (!after || containsUndefinedReference(after)) return '';
  if (/^those who\b/i.test(after)) return makeThoseWhoQuestion(after);

  const popMatch = before.match(/\b(Americans|U\.S\. adults|US adults|Australians|adults|parents|workers|employees|consumers|respondents|listeners|viewers|shoppers|teens|teenagers|children|students|people|women|men|Gen Zers|Millennials|Gen Z|sports fans|hiring managers|households|dual-income households)\b[^,;:]*/i);
  if (popMatch && startsWithVerbPhrase(after)) return `How many ${fixBroadcastGrammar(popMatch[0])} ${after}?`;
  return '';
}

function makePercentageQuestion(sentence, target) {
  const s = cleanHeadlineCollision(sentence).replace(/\s+/g, ' ').trim();
  const raw = target.raw || target.stat;
  const escaped = regexEscape(raw);

  let m = s.match(new RegExp(`^${escaped}\\s+of\\s+(.+?)[.!]?$`, 'i'));
  if (m) return `What percentage of ${fixBroadcastGrammar(m[1].replace(/[.!?]+$/, ''))}?`;

  m = s.match(new RegExp(`^(Among\\s+[^,]+,\\s*)${escaped}\\s+(.+?)[.!]?$`, 'i'));
  if (m) return `${m[1]}what percentage ${fixBroadcastGrammar(m[2].replace(/[.!?]+$/, ''))}?`;

  const idx = s.toLowerCase().indexOf(raw.toLowerCase());
  if (idx >= 0) {
    const before = s.slice(0, idx).replace(/[,;:\s-]+$/, '').trim();
    const after = s.slice(idx + raw.length).replace(/^[,;:\s-]+/, '').replace(/[.!?]+$/, '').trim();
    const pop = before.match(/\b(Americans|U\.S\. adults|US adults|adults|parents|workers|employees|consumers|respondents|listeners|viewers|shoppers|teens|teenagers|students|people|women|men|Gen Zers|Millennials|Gen Z|sports fans|hiring managers|households|dual-income households)\b[^,;:]*/i);
    if (pop && after && startsWithVerbPhrase(after)) return `What percentage of ${fixBroadcastGrammar(pop[0])} ${fixBroadcastGrammar(after)}?`;
  }

  const replaced = fixBroadcastGrammar(s.replace(new RegExp(escaped, 'i'), 'what percentage'));
  if (/^what percentage\b/i.test(replaced)) return replaced.replace(/[.!]+$/, '') + (replaced.endsWith('?') ? '' : '?');
  return '';
}

function makeQuestion(sentence, target, articleTitle = '', allStats = []) {
  const isolated = isolateFindingClause(sentence, target, allStats);
  if (!isolated) return '';
  let q = target.type === 'ratio' ? makeRatioQuestion(isolated, target, articleTitle) : makePercentageQuestion(isolated, target);
  q = fixBroadcastGrammar(q)
    .replace(/\bU\.S\. Adults Are\b/g, 'U.S. adults are')
    .replace(/\bGen Z Skip Weekend Plans to Save Money\b/g, 'Gen Z adults skip weekend plans to save money')
    .replace(/\s+\?/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
  if (!questionHasStandaloneContext(q)) return '';
  if (containsVisibleStat(q)) return '';
  if (hasMalformedPercentagePopulation(q)) return '';
  return q;
}

function hashId(parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

function isoDate(raw) {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

function displayDate(raw) {
  const d = new Date(`${raw}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? (raw || '') : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function ageDays(date) {
  return (Date.now() - new Date(`${date}T00:00:00Z`).getTime()) / 86400000;
}

function cleanFindingContext(sentence = '') {
  return stripHtml(sentence).replace(/\s+/g, ' ').trim().replace(/^[-–—\s]+/, '').slice(0, 260);
}

function extractCandidates(article, sourceName) {
  const chunks = [article.title, article.description, article.content].filter(Boolean);
  const candidateSentences = [];
  for (const chunk of chunks) {
    const clean = stripHtml(chunk).replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    candidateSentences.push(...sentences(clean));
    if (clean.length >= 35 && clean.length <= 360) candidateSentences.push(clean);
  }

  const seen = new Set();
  const out = [];
  for (const originalSentence of candidateSentences) {
    const sentence = cleanHeadlineCollision(originalSentence);
    if (!sentence || isPolitical(sentence) || containsUndefinedReference(sentence) || hasIncompleteMoreLessObject(sentence)) continue;
    const years = sentence.match(/\b(?:19|20)\d{2}\b/g) || [];
    if (new Set(years).size >= 2 && /\b(compared|compare|versus|vs\.?|than|this year)\b/i.test(sentence)) continue;
    if (/\bsuper fans?\b/i.test(sentence) && /\bsports streaming services?\b/i.test(sentence) && /\b1\s+in\s+5\b/i.test(sentence)) continue;
    if (/\b(discount|off sale|battery|humidity|chance of rain)\b/i.test(sentence) && !/\bshopping|stores?|online|consumer\b/i.test(sentence)) continue;

    const stats = findStats(sentence);
    if (stats.length !== 1) continue;
    const found = stats[0];
    const question = makeQuestion(sentence, found, article.title, stats);
    if (!question) continue;

    const isolated = isolateFindingClause(sentence, found, stats);
    if (!isolated) continue;
    const topic = inferTopicFromFinding(isolated, article.title);
    const published = isoDate(article.date);
    const findingContext = cleanFindingContext(isolated);
    const key = `${article.link}|${isolated}|${found.stat}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      id: hashId([sourceName, article.link, isolated, found.stat]),
      topic,
      question,
      answer: found.stat,
      stat: found.stat,
      context: findingContext ? `Finding: ${findingContext}` : `From a recent ${sourceName} survey finding.`,
      talk: talkForFinding(topic, isolated, article.title),
      source: sourceName,
      source_url: article.link,
      source_date: published,
      published_at: published,
      auto_generated: true
    });
  }
  return out;
}



// v3.0: one final broadcast-quality gate for EVERY record immediately before publication.
// This is deliberately independent of extraction path so fresh, cached, transformed,
// and seeded items all have to pass the same on-air readability test.
const BROADCAST_POPULATION_RE = /\b(?:Americans?|U\.S\. adults?|US adults?|adults?|parents?|mothers?|fathers?|workers?|employees?|employers?|consumers?|respondents?|listeners?|viewers?|shoppers?|teens?|teenagers?|children|kids?|students?|people|women|men|young women|young men|Gen Zers?|Gen Z adults?|Millennials?|Baby Boomers?|boomers?|sports fans?|hiring managers?|households?|dual-income households?|donors?|voters?|users?|customers?|families|caregivers?|homeowners?|renters?|drivers?|travelers?|diners?|patients?|podcast listeners?|radio listeners?|TV viewers?)\b/i;

function hasHeadlineDebris(question = '') {
  const q = String(question).replace(/\s+/g, ' ').trim();
  return /\bHere[’']s What to Know\b|\bIn a new poll(?: we conducted)?\b|\bRead More\b|\bWhat You Need to Know\b|\bEverything You Need to Know\b|\baccording to a new poll from\b[^?]{80,}/i.test(q);
}

function hasUndefinedQuestionPopulation(question = '') {
  const q = String(question).replace(/\s+/g, ' ').trim();
  if (!q) return true;

  // Any normal Survey Says question needs a named group somewhere before the measured behavior.
  // Allow an introductory condition such as "When ordering fast food, ..." or "Among employed U.S. adults, ...".
  if (!BROADCAST_POPULATION_RE.test(q)) return true;

  // "What percentage assume/use/say..." is missing the population even if a population is mentioned later.
  if (/^(?:when\s+[^,]+,\s*)?what percentage\s+(?!of\b)(?:assume|assumes|believe|believes|think|thinks|say|says|use|uses|used|are|is|were|was|have|has|had|plan|plans|prefer|prefers|want|wants|expect|expects|report|reports|feel|feels)\b/i.test(q)) return true;

  // "How many say/use/think..." likewise has no named group after How many.
  if (/^how many\s+(?:assume|assumes|believe|believes|think|thinks|say|says|use|uses|used|are|is|were|was|have|has|had|plan|plans|prefer|prefers|want|wants|expect|expects|report|reports|feel|feels)\b/i.test(q)) return true;

  return false;
}

function contextHasUndefinedPopulation(context = '') {
  const c = String(context).replace(/\s+/g, ' ').trim();
  const finding = c.replace(/^.*?Finding:\s*/i, '').trim();
  if (!finding) return false;

  // Bare-stat findings must name the population immediately after the stat or before it.
  const m = finding.match(/^\s*(?:\d{1,3}%|(?:[1-9]|10)\s+in\s+(?:[2-9]|10))\s+(.+)$/i);
  if (!m) return false;
  const tail = m[1].trim();
  if (/^of\s+/i.test(tail) && BROADCAST_POPULATION_RE.test(tail)) return false;
  if (BROADCAST_POPULATION_RE.test(finding)) return false;
  return /^(?:assume|assumes|are|is|were|was|have|has|had|say|says|said|feel|feels|felt|think|thinks|thought|use|uses|used|plan|plans|planned|expect|expects|expected|want|wants|wanted|prefer|prefers|preferred|believe|believes|believed|report|reports|reported|skip|skips|avoid|avoids|would|will|can|could|they|their|them)\b/i.test(tail);
}

// v3.1: semantic-integrity rule — one statistic, one measured clause, one question.
// Reject a finding when a numeric result shares a sentence with a separate qualitative
// measurement ("most", "many", "some", etc.) joined by and/while/but/though. This keeps
// the numeric answer from being accidentally applied to both clauses.
function contextHasMixedMeasurementClauses(context = '') {
  const c = String(context).replace(/\s+/g, ' ').trim();
  const finding = c.replace(/^.*?Finding:\s*/i, '').trim();
  if (!finding) return false;

  const statMatches = [...finding.matchAll(/\b(?:\d{1,3}%|(?:[1-9]|10)\s+in\s+(?:[2-9]|10))\b/gi)];
  if (statMatches.length !== 1) return false;

  const statIndex = statMatches[0].index ?? -1;
  if (statIndex < 0) return false;

  const connectorRe = /\b(?:and|while|but|though|although|whereas|however)\b|[:;]/gi;
  const connectors = [...finding.matchAll(connectorRe)];
  if (!connectors.length) return false;

  const qualitativeRe = /\b(?:most|many|some|few|a majority|the majority|a minority|the minority|more than half|less than half|about half|nearly half)\b/i;

  for (const m of connectors) {
    const idx = m.index ?? -1;
    if (idx < 0) continue;
    const left = finding.slice(0, idx).trim();
    const right = finding.slice(idx + m[0].length).trim();
    const statOnLeft = statIndex < idx;
    const otherSide = statOnLeft ? right : left;
    const statSide = statOnLeft ? left : right;

    // The nonnumeric side contains its own qualitative measurement, while the numeric
    // side contains our answer. Those are two separate findings and must not be merged.
    if (qualitativeRe.test(otherSide) && /\b(?:\d{1,3}%|(?:[1-9]|10)\s+in\s+(?:[2-9]|10))\b/i.test(statSide)) {
      return true;
    }
  }

  return false;
}

function finalBroadcastQualityGate(item) {
  if (!item || !item.question) return false;
  const q = String(item.question).replace(/\s+/g, ' ').trim();

  if (q.length < 25 || q.length > 240) return false;
  if (!/\?$/.test(q)) return false;
  if (containsVisibleStat(q)) return false;
  if (hasHeadlineDebris(q)) return false;
  if (hasBadQuestionLanguage(q)) return false;
  if (hasMalformedPercentagePopulation(q)) return false;
  if (hasUndefinedQuestionPopulation(q)) return false;
  if (hasIncompleteMoreLessObject(q)) return false;
  if (isAmbiguousMultiYearQuestion(q)) return false;
  if (containsUndefinedReference(q)) return false;
  if (contextHasUndefinedPopulation(item.context || '')) return false;
  if (contextHasMixedMeasurementClauses(item.context || '')) return false;

  // Catch copy collisions and headline prose that are technically grammatical but not an on-air question.
  if (/\b(?:In a nationwide poll of|In a survey of|The survey found|The poll found|we conducted with|highlighting the critical role)\b[^?]{90,}/i.test(q)) return false;

  return true;
}

function explainUsability(item) {
  if (!item || !item.question || !item.source_url || !item.stat) return 'missing';
  if (!finalBroadcastQualityGate(item)) return 'standalone';
  if (item.question.length < 25 || item.question.length > 240) return 'question_length';
  if (!questionHasStandaloneContext(item.question)) return 'standalone';
  if (containsVisibleStat(item.question)) return 'standalone';
  if (isAmbiguousMultiYearQuestion(item.question)) return 'standalone';
  if (isUnsupportedSportsSuperFanQuestion(item.question, item.context || '')) return 'standalone';
  if (isPolitical(`${item.question} ${item.context || ''}`)) return 'political';
  if (containsUndefinedReference(`${item.question} ${item.context || ''}`)) return 'standalone';
  if (hasIncompleteMoreLessObject(item.question)) return 'standalone';
  if (hasMalformedPercentagePopulation(item.question)) return 'standalone';
  if (/\bFinding:\s*\d{1,3}%\s+(?:are|is|were|was|have|has|had|say|says|said|use|uses|used|plan|plans|planned|they|their|them)\b/i.test(item.context || '')) return 'standalone';
  if (contextHasMixedMeasurementClauses(item.context || '')) return 'standalone';
  if (item.auto_generated && ageDays(item.published_at || item.source_date) > maxAgeDaysForSource(item.source)) return 'age';
  return 'ok';
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

function buildWidgetHtml(items, limit = 3) {
  const picked = pickWidgetItems(items).slice(0, limit);
  const topics = [...new Set(picked.map(x => x.topic))].sort();
  const options = topics.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('\n');
  const cards = picked.map(item => `<article class="mjrss-card" data-topic="${escapeHtml(item.topic)}">
  <div class="mjrss-main">
    <div class="mjrss-meta">
      <span class="mjrss-topic">${escapeHtml(item.topic)}</span>
      <span class="mjrss-date">${escapeHtml(displayDate(item.source_date || item.published_at))}</span>
    </div>
    <p class="mjrss-question">${escapeHtml(item.question)}</p>
    <p class="mjrss-context"><strong>Answer:</strong> ${escapeHtml(item.answer || item.stat)}${item.context ? ` — ${escapeHtml(item.context)}` : ''}</p>
    <p class="mjrss-talk"><strong>Talk About It:</strong> ${escapeHtml(item.talk || talkForFinding(item.topic, item.question))}</p>
    <div class="mjrss-source"><strong>Source:</strong> <a href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.source)}</a></div>
  </div>
  <div class="mjrss-statbox"><span class="mjrss-stat">${escapeHtml(item.stat)}</span><span class="mjrss-answerlabel">Answer</span></div>
</article>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MJR Survey Says</title>
<style>
html,body{margin:0;padding:0;background:transparent;font-family:Roboto,Arial,sans-serif}
#mjrSurveySays{--mjrss-blue:#192A56;--mjrss-ink:#172033;--mjrss-muted:#687386;--mjrss-line:#dfe5ee;--mjrss-soft:#f5f7fb;width:100%;margin:0;background:#fff;border:1px solid var(--mjrss-line);border-radius:0 0 10px 10px;overflow:hidden;color:var(--mjrss-ink);box-sizing:border-box}
#mjrSurveySays,#mjrSurveySays *{box-sizing:border-box}
#mjrSurveySays .mjrss-head{background:var(--mjrss-blue);color:#fff;text-align:center;padding:11px 14px 10px}
#mjrSurveySays .mjrss-head h2{margin:0;color:#fff;font-size:21px;line-height:1.1;font-weight:800}
#mjrSurveySays .mjrss-head p{margin:4px 0 0;color:#fff;font-size:12px;line-height:1.3;opacity:.9}
#mjrSurveySays .mjrss-toolbar{padding:7px 10px;border-bottom:1px solid var(--mjrss-line);background:#fff;display:flex;justify-content:flex-start}
#mjrSurveySays .mjrss-toolbar label{display:flex;gap:6px;align-items:center;font-size:11px;font-weight:700;color:var(--mjrss-blue)}
#mjrSurveySays .mjrss-topicfilter{border:1px solid #cfd7e5;border-radius:6px;background:#fff;color:var(--mjrss-blue);padding:5px 8px;font:700 11px/1 Roboto,Arial,sans-serif}
#mjrSurveySays .mjrss-card{display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:12px;padding:10px 14px;border-bottom:1px solid var(--mjrss-line);background:#fff}
#mjrSurveySays .mjrss-card:nth-child(even){background:#fafbfe}
#mjrSurveySays .mjrss-meta{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-bottom:4px}
#mjrSurveySays .mjrss-topic{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--mjrss-blue)}
#mjrSurveySays .mjrss-date{font-size:10px;color:var(--mjrss-muted)}
#mjrSurveySays .mjrss-question{margin:0 0 4px;color:var(--mjrss-ink);font-size:15px;line-height:1.3;font-weight:800}
#mjrSurveySays .mjrss-context,#mjrSurveySays .mjrss-talk{margin:0 0 5px;color:var(--mjrss-ink);font-size:12px;line-height:1.35}
#mjrSurveySays .mjrss-source{color:var(--mjrss-muted);font-size:10.5px;line-height:1.3}
#mjrSurveySays .mjrss-source a{color:var(--mjrss-blue);text-decoration:underline}
#mjrSurveySays .mjrss-statbox{align-self:center;justify-self:stretch;background:var(--mjrss-soft);border:1px solid var(--mjrss-line);border-radius:8px;padding:9px 8px;text-align:center}
#mjrSurveySays .mjrss-stat{display:block;color:var(--mjrss-blue);font-size:24px;line-height:1;font-weight:900}
#mjrSurveySays .mjrss-answerlabel{display:block;margin-top:4px;color:var(--mjrss-muted);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
@media(max-width:680px){#mjrSurveySays .mjrss-card{grid-template-columns:minmax(0,1fr) 84px;gap:8px;padding:9px 10px}#mjrSurveySays .mjrss-question{font-size:14px}#mjrSurveySays .mjrss-context,#mjrSurveySays .mjrss-talk{font-size:11.5px}#mjrSurveySays .mjrss-stat{font-size:20px}}
@media(max-width:480px){#mjrSurveySays .mjrss-card{grid-template-columns:1fr}#mjrSurveySays .mjrss-statbox{justify-self:start;min-width:84px}}
</style>
</head>
<body>
<div id="mjrSurveySays">
  <div class="mjrss-head"><h2>📊 MJR SURVEY SAYS</h2><p>Fresh, source-backed surveys and stats for on-air conversation.</p></div>
  <div class="mjrss-toolbar"><label><span>Topic</span><select class="mjrss-topicfilter" aria-label="Filter Survey Says by topic"><option value="all">All Topics</option>${options}</select></label></div>
  <div class="mjrss-cards">${cards}</div>
</div>
<script>
(function(){var root=document.getElementById('mjrSurveySays');if(!root)return;var filter=root.querySelector('.mjrss-topicfilter');var cards=root.querySelectorAll('.mjrss-card');function update(){var topic=filter.value;cards.forEach(function(card){card.style.display=(topic==='all'||card.getAttribute('data-topic')===topic)?'grid':'none';});}filter.addEventListener('change',update);update();})();
</script>
</body>
</html>`;
}

function readRotationState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ROTATION_STATE, 'utf8'));
    return Array.isArray(parsed.history) ? parsed : { history: [] };
  } catch {
    return { history: [] };
  }
}

function writeRotationState(state) {
  fs.writeFileSync(ROTATION_STATE, JSON.stringify(state, null, 2) + '\n');
}

function dateKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function recentShownIds(state, days = RECENT_SHOWN_DAYS) {
  const cutoff = Date.now() - days * 86400000;
  const ids = new Set();
  for (const row of state.history || []) {
    const t = Date.parse(row.date || '');
    if (!Number.isFinite(t) || t < cutoff) continue;
    for (const id of row.ids || []) ids.add(id);
  }
  return ids;
}

function sourceCount(chosen, source) {
  return chosen.filter(x => x.source === source).length;
}

function pickDailyRotation(pool, count, state) {
  const recent = recentShownIds(state);
  const newestFirst = arr => [...arr].sort((a, b) => String(b.published_at || b.source_date || '').localeCompare(String(a.published_at || a.source_date || '')));
  const ordered = [...newestFirst(pool.filter(x => !recent.has(x.id))), ...newestFirst(pool.filter(x => recent.has(x.id)))];
  const chosen = [];

  const talker = ordered.find(x => x.source === 'Talker Research');
  if (talker && count > 0) chosen.push(talker);
  const usedTopics = new Set(chosen.map(x => x.topic));

  for (const item of ordered) {
    if (chosen.length >= count) break;
    if (chosen.some(x => x.id === item.id)) continue;
    if (sourceCount(chosen, item.source) >= MAX_PER_SOURCE) continue;
    if (usedTopics.has(item.topic)) continue;
    chosen.push(item);
    usedTopics.add(item.topic);
  }
  for (const item of ordered) {
    if (chosen.length >= count) break;
    if (chosen.some(x => x.id === item.id)) continue;
    if (sourceCount(chosen, item.source) >= MAX_PER_SOURCE) continue;
    chosen.push(item);
  }
  for (const item of ordered) {
    if (chosen.length >= count) break;
    if (chosen.some(x => x.id === item.id)) continue;
    chosen.push(item);
  }
  return chosen.slice(0, count);
}

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      'user-agent': 'MediaJobsReport-SurveySays/3.1 (+https://www.mediajobsreport.com/)',
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.5'
    },
    redirect: 'follow'
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return await r.text();
}

async function enrichArticle(article) {
  if (!article.link) return article;
  try {
    const html = await fetchText(article.link);
    const main = htmlMainText(html);
    return {
      ...article,
      title: article.title || htmlTitle(html),
      date: article.date || htmlDate(html),
      content: main || article.content,
      description: article.description || ''
    };
  } catch (err) {
    console.warn(`    Deep fetch failed: ${article.link} — ${err.message}`);
    return article;
  }
}

async function fetchRssSource(source) {
  console.log(`Fetching ${source.name}: ${source.url}`);
  const xml = await fetchText(source.url);
  let articles = parseFeed(xml);
  console.log(`  RSS items: ${articles.length}`);

  if (source.filter === 'talker-research') {
    articles = articles.filter(isTalkerResearchArticle);
    console.log(`  Talker Research items: ${articles.length}`);
  }

  if (source.deepFetch) {
    const selected = articles.slice(0, MAX_DEEP_FETCH);
    const enriched = [];
    for (const article of selected) enriched.push(await enrichArticle(article));
    articles = [...enriched, ...articles.slice(MAX_DEEP_FETCH)];
    console.log(`  Deep-fetched article pages: ${enriched.length}`);
  }

  return articles;
}

async function fetchHtmlDiscoverySource(source) {
  console.log(`Discovering ${source.name}: ${source.url}`);
  const html = await fetchText(source.url);
  const links = discoverLinks(html, source.url, source.match, source.max);
  console.log(`  Article links discovered: ${links.length}`);
  const articles = [];
  for (const link of links) {
    try {
      const page = await fetchText(link);
      articles.push({
        title: htmlTitle(page),
        link,
        date: htmlDate(page),
        description: '',
        content: htmlMainText(page),
        creator: '',
        categories: []
      });
    } catch (err) {
      console.warn(`    Article fetch failed: ${link} — ${err.message}`);
    }
  }
  return articles;
}

(async () => {
  console.log('Building MJR Survey Says feed + static widget...');
  console.log('v3.1 final broadcast-quality gate: ON (one statistic = one measured clause = one question)');

  const diag = {};
  const ensureDiag = source => {
    if (!diag[source]) {
      diag[source] = { discovered: 0, missing: 0, question_length: 0, standalone: 0, political: 0, age: 0, duplicate: 0, accepted: 0 };
    }
    return diag[source];
  };

  const seed = fs.existsSync(SEED) ? JSON.parse(fs.readFileSync(SEED, 'utf8')) : [];
  let previous = [];
  if (fs.existsSync(OUT_JSON)) {
    try {
      const old = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
      previous = Array.isArray(old.items) ? old.items : [];
    } catch {}
  }

  let discovered = [];

  for (const source of RSS_SOURCES) {
    try {
      const articles = await fetchRssSource(source);
      const before = discovered.length;
      for (const article of articles) discovered.push(...extractCandidates(article, source.name));
      const added = discovered.length - before;
      ensureDiag(source.name).discovered += added;
      console.log(`  Findings discovered from ${source.name}: ${added}`);
    } catch (err) {
      console.warn(`  Source failed: ${err.message}`);
    }
  }

  const htmlSeen = new Set();
  for (const source of HTML_DISCOVERY) {
    try {
      const articles = await fetchHtmlDiscoverySource(source);
      const before = discovered.length;
      for (const article of articles) {
        if (htmlSeen.has(article.link)) continue;
        htmlSeen.add(article.link);
        discovered.push(...extractCandidates(article, source.name));
      }
      const added = discovered.length - before;
      ensureDiag(source.name).discovered += added;
      console.log(`  Findings discovered from ${source.name}: ${added}`);
    } catch (err) {
      console.warn(`  Source failed: ${err.message}`);
    }
  }

  const merged = [...discovered, ...previous, ...seed];
  const discoveredObjects = new Set(discovered);
  const dedup = new Map();

  for (const item of merged) {
    const key = item.id || hashId([item.source, item.source_url, item.question]);
    const reason = explainUsability(item);
    if (discoveredObjects.has(item) && reason !== 'ok') {
      const d = ensureDiag(item.source || 'Unknown');
      if (Object.prototype.hasOwnProperty.call(d, reason)) d[reason]++;
      else d.standalone++;
    }
    if (reason !== 'ok') continue;
    if (dedup.has(key)) {
      if (discoveredObjects.has(item)) ensureDiag(item.source || 'Unknown').duplicate++;
      continue;
    }
    dedup.set(key, { ...item, id: key });
  }

  const allUsable = [...dedup.values()].sort((a, b) => String(b.published_at || b.source_date || '').localeCompare(String(a.published_at || a.source_date || '')));
  const items = allUsable.slice(0, MAX_POOL);
  const finalIds = new Set(items.map(x => x.id));

  for (const item of discovered) {
    const key = item.id || hashId([item.source, item.source_url, item.question]);
    if (explainUsability(item) === 'ok' && finalIds.has(key)) ensureDiag(item.source || 'Unknown').accepted++;
  }

  for (const [source, d] of Object.entries(diag)) {
    console.log(`Diagnostics ${source}: discovered=${d.discovered}, missing=${d.missing}, question_length=${d.question_length}, standalone=${d.standalone}, political=${d.political}, age=${d.age}, duplicate=${d.duplicate}, accepted=${d.accepted}`);
  }

  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify({ updated_at: new Date().toISOString(), count: items.length, items }, null, 2) + '\n');

  const rotationState = readRotationState();
  const daily7 = pickDailyRotation(items, 7, rotationState);
  const daily5 = daily7.slice(0, 5);
  const daily3 = daily7.slice(0, 3);

  fs.writeFileSync(OUT_HTML_3, buildWidgetHtml(daily3, 3));
  fs.writeFileSync(OUT_HTML_5, buildWidgetHtml(daily5, 5));
  fs.writeFileSync(OUT_HTML_7, buildWidgetHtml(daily7, 7));
  fs.writeFileSync(OUT_HTML, buildWidgetHtml(daily3, 3));

  rotationState.history = [
    { date: dateKey(), ids: daily7.map(x => x.id) },
    ...(rotationState.history || []).filter(x => x.date !== dateKey())
  ].slice(0, 30);
  writeRotationState(rotationState);

  console.log(`Published ${items.length} Survey Says items (${discovered.length} discovered this run).`);
  const mix3 = daily3.reduce((m, x) => ((m[x.source] = (m[x.source] || 0) + 1), m), {});
  const mix7 = daily7.reduce((m, x) => ((m[x.source] = (m[x.source] || 0) + 1), m), {});
  console.log(`Default 3 source mix: ${JSON.stringify(mix3)}`);
  console.log(`Full 7 source mix: ${JSON.stringify(mix7)}`);
  console.log(`Daily rotation selected ${daily7.length} items; avoiding the previous ${RECENT_SHOWN_DAYS} days when possible.`);
  console.log(`Source diversity target: maximum ${MAX_PER_SOURCE} items per source when enough alternatives exist.`);
  console.log('Static widgets: 3 / 5 / 7 generated in docs/');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
