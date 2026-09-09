const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.cwd();
const OUT_JSON = path.join(ROOT, "docs", "surveys.json");
const OUT_HTML = path.join(ROOT, "docs", "survey-says.html");
const OUT_HTML_3 = path.join(ROOT, "docs", "survey-says-3.html");
const OUT_HTML_5 = path.join(ROOT, "docs", "survey-says-5.html");
const OUT_HTML_7 = path.join(ROOT, "docs", "survey-says-7.html");
const SEED = path.join(ROOT, "data-seed.json");
const ROTATION_STATE = path.join(ROOT, "mjr-survey-rotation.json");

const SOURCES = [
  {
    name: "Talker Research",
    url: "https://talker.news/feed/",
    filter: "talker-research"
  },
  {
    name: "Pew Research Center",
    url: "https://www.pewresearch.org/publications/feed/"
  },
  {
    name: "AP-NORC Center",
    url: "https://apnorc.org/feed/"
  },
  {
    name: "AP-NORC Center",
    url: "https://apnorc.org/topics/culture-and-society/feed/"
  },
  {
    name: "AP-NORC Center",
    url: "https://apnorc.org/topics/science-and-technology/feed/"
  },
  {
    name: "AP-NORC Center",
    url: "https://apnorc.org/topics/younger-generations/feed/"
  },
  {
    name: "AP-NORC Center",
    url: "https://apnorc.org/topics/education/feed/"
  },
  {
    name: "AP-NORC Center",
    url: "https://apnorc.org/topics/media-insight-project/feed/"
  },
  {
    name: "Edison Research",
    url: "https://www.edisonresearch.com/feed/"
  },
  {
    name: "Ipsos",
    url: "https://www.ipsos.com/en-us/rss.xml"
  },
  {
    name: "CivicScience",
    url: "https://civicscience.com/feed/"
  },
  {
    name: "The Harris Poll",
    url: "https://theharrispoll.com/feed/"
  }
];

const MAX_POOL = 140;
const MAX_AGE_DAYS = 180;
const AP_NORC_MAX_AGE_DAYS = 365;
const RECENT_SHOWN_DAYS = 7;
const MAX_WIDGET_ITEMS = 7;
const MAX_PER_SOURCE = 2;

function maxAgeDaysForSource(source) {
  return source === "AP-NORC Center"
    ? AP_NORC_MAX_AGE_DAYS
    : MAX_AGE_DAYS;
}

function decodeXml(s = "") {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&#038;/g, "&")
    .replace(/&#8217;/g, "’")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#8230;/g, "…")
    .replace(/&nbsp;/g, " ");
}

function stripHtml(s = "") {
  return decodeXml(String(s))
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

function rawTag(block, name) {
  const m = block.match(
    new RegExp(
      `<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,
      "i"
    )
  );

  return m
    ? decodeXml(m[1]).trim()
    : "";
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
    link:
      tag(b, "link") ||
      tag(b, "guid"),
    date:
      tag(b, "pubDate") ||
      tag(b, "dc:date"),
    description:
      rawTag(b, "description"),
    content:
      rawTag(b, "content:encoded"),
    creator:
      tag(b, "dc:creator") ||
      tag(b, "author"),
    categories:
      tags(b, "category")
  }));
}

function parseAtom(xml) {
  const blocks =
    xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];

  return blocks.map(b => {
    const linkMatch =
      b.match(
        /<link\b[^>]*href=["']([^"']+)["'][^>]*>/i
      );

    return {
      title:
        tag(b, "title"),

      link:
        linkMatch
          ? decodeXml(linkMatch[1])
          : "",

      date:
        tag(b, "updated") ||
        tag(b, "published"),

      description:
        rawTag(b, "summary"),

      content:
        rawTag(b, "content"),

      creator:
        tag(b, "name"),

      categories:
        []
    };
  });
}

function parseFeed(xml) {
  const rss =
    parseRss(xml);

  return rss.length
    ? rss
    : parseAtom(xml);
}

function isTalkerResearchArticle(article) {
  const haystack = [
    article.creator || "",
    ...(article.categories || []),
    article.title || "",
    stripHtml(
      article.description || ""
    ),
    stripHtml(
      article.content || ""
    )
  ].join(" ");

  return /\bTalker Research\b/i.test(
    haystack
  );
}

function sentences(text = "") {
  return stripHtml(text)
    .replace(/\s+/g, " ")
    .split(
      /(?<=[.!?])\s+(?=[A-Z0-9“"'])/
    )
    .map(s => s.trim())
    .filter(
      s =>
        s.length >= 35 &&
        s.length <= 360
    );
}

function inferTopic(text = "") {
  const t =
    text.toLowerCase();

  const rules = [
    [
      "Work",
      /\b(work|job|employee|employees|employer|workplace|career|office|worker|workers|employed)\b/
    ],
    [
      "Technology",
      /\b(ai|artificial intelligence|chatbot|chatbots|smartphone|internet|online|social media|technology|digital|crypto|cryptocurrency)\b/
    ],
    [
      "Entertainment",
      /\b(streaming|streamed radio|radio|television|tv|movie|movies|music|podcast|podcasts|entertainment|audio|sports streaming)\b/
    ],
    [
      "Money",
      /\b(money|cost|price|inflation|financial|finance|economy|spending|income|cash|debt|donation|donate|donated|crowdfunding|expense|charity|charitable)\b/
    ],
    [
      "Shopping",
      /\b(shop|shopping|retail|store|purchase|consumer|buy|bought|discount|discounts)\b/
    ],
    [
      "Food & Dining",
      /\b(food|restaurant|meal|fast food|grocery|dining|eat|eating|order|ordering)\b/
    ],
    [
      "Family & Life",
      /\b(parent|parents|child|children|family|relationship|dating|marriage|home|caregiver|childcare|daycare)\b/
    ],
    [
      "Health",
      /\b(health|wellness|doctor|medical|hospital|fitness|sleep|medicine|insurance)\b/
    ]
  ];

  for (
    const [name, re]
    of rules
  ) {
    if (re.test(t)) {
      return name;
    }
  }

  return "Life & Culture";
}

function inferTopicFromFinding(
  sentence = "",
  title = ""
) {
  const fromSentence =
    inferTopic(sentence);

  return fromSentence !==
    "Life & Culture"
      ? fromSentence
      : inferTopic(title);
}

function isPolitical(text = "") {
  return /\b(trump|biden|democrats?|republicans?|congress|senate|house of representatives|election|elections|vote|votes|voter|voters|partisan|political party|white house|supreme court|immigration policy|foreign policy|president|presidential|governor|governors|candidate|candidates)\b/i.test(
    text
  );
}
function talkForFinding(
  topic,
  sentence = "",
  title = ""
) {
  const s =
    sentence.toLowerCase();

  const h =
    `${sentence} ${title}`.toLowerCase();

  if (
    /\bnew year(?:'s)? eve\b/.test(h)
  ) {
    return "Do you usually stay up until midnight on New Year’s Eve, or are you asleep before the countdown?";
  }

  if (
    /\bcrowdfund(?:ing|ed)?\b/.test(h)
  ) {
    return "Have you ever donated to a crowdfunding campaign? What made you decide to give?";
  }

  if (
    /\bcharit(?:y|ies|able)\b/.test(h) ||
    /\bdonat(?:e|ed|ion|ions)\b/.test(s)
  ) {
    return "What type of cause are you most likely to donate to, and what makes you trust an organization enough to give?";
  }

  if (
    /\bstreamed radio|streaming radio|radio stream\b/.test(s)
  ) {
    return "How often do you listen to a radio station through an app or stream instead of a regular radio?";
  }

  if (
    /\bsports streaming\b/.test(h)
  ) {
    return "Have streaming services made it easier or harder for you to watch the sports you want?";
  }

  if (
    /\bradio\b/.test(s)
  ) {
    return "Does this match the way you or the people around you use radio?";
  }

  if (
    /\bpodcast\b/.test(s)
  ) {
    return "How do your own podcast habits compare with this finding?";
  }

  if (
    /\bhealth|wellness\b/.test(s) &&
    /\binfluencer/.test(s)
  ) {
    return "Would you trust health advice from an influencer, or do you want it from a medical professional?";
  }

  if (
    /\bcrypto|cryptocurrency\b/.test(s)
  ) {
    return "Have you ever owned or used cryptocurrency, or have you stayed away from it completely?";
  }

  if (
    /\bsocial media\b/.test(s)
  ) {
    return "Does this match the way you and your friends actually use social media?";
  }

  if (
    /\b(ai|artificial intelligence|chatbot)\b/.test(s)
  ) {
    return "What everyday task are you most willing to hand over to AI?";
  }

  if (
    /\b(parent|parents|kid|kids|child|children)\b[\s\S]{0,100}\b(care|childcare|daycare)\b|\b(care|childcare|daycare)\b[\s\S]{0,100}\b(parent|parents|kid|kids|child|children)\b/.test(
      h
    )
  ) {
    return "When choosing care for a child, what matters most: cost, location, trust or flexibility?";
  }

  const prompts = {
    Technology:
      "Would this number be higher or lower among your friends and coworkers?",

    Entertainment:
      "Does this match your own viewing, listening or entertainment habits?",

    Money:
      "Does this finding match the way you are spending, saving or giving right now?",

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

  return prompts[topic] ||
    prompts["Life & Culture"];
}

function startsWithVerbPhrase(
  text = ""
) {
  return /^(donated|donate|gave|give|contributed|contribute|spent|spend|said|say|use|used|uses|watch|watched|watches|listen|listened|listens|buy|bought|buys|shop|shopped|shops|prefer|preferred|prefers|agree|agreed|agrees|believe|believed|believes|think|thought|thinks|reported|report|reports|have|had|has|are|were|is|want|wanted|wants|plan|planned|plans|expect|expected|expects|feel|felt|feels|chose|choose|chooses|selected|select|selects|experienced|experience|experiences|received|receive|receives|paid|pay|pays|borrowed|borrow|borrows|saved|save|saves|get|gets|got)\b/i.test(
    text.trim()
  );
}

function fixBroadcastGrammar(
  text = ""
) {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /\bAustralians\s+(\d{1,2})-(\d{1,2})\b/gi,
      "Australians ages $1–$2"
    )
    .replace(
      /\bAmericans\s+(\d{1,2})-(\d{1,2})\b/gi,
      "Americans ages $1–$2"
    )
    .replace(
      /\badults\s+(\d{1,2})-(\d{1,2})\b/gi,
      "adults ages $1–$2"
    )
    .replace(
      /\bpeople\s+(\d{1,2})-(\d{1,2})\b/gi,
      "people ages $1–$2"
    )
    .replace(
      /\blistening\s+to\b/gi,
      "listen to"
    )
    .replace(
      /\busing\s+/gi,
      "use "
    )
    .replace(
      /\bwatching\s+/gi,
      "watch "
    )
    .replace(
      /\bgetting\s+/gi,
      "get "
    );
}

function regexEscape(s = "") {
  return String(s).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function stripTrailingSemicolonClause(
  sentence = "",
  rawStat = ""
) {
  const s =
    sentence
      .replace(/\s+/g, " ")
      .trim();

  const semi =
    s.indexOf(";");

  if (semi < 0) {
    return s;
  }

  const statIndex =
    s
      .toLowerCase()
      .indexOf(
        String(rawStat)
          .toLowerCase()
      );

  if (
    statIndex >= 0 &&
    statIndex < semi
  ) {
    return s
      .slice(0, semi)
      .trim();
  }

  return s;
}

function contextualPopulationFromTitle(
  title = "",
  sentence = ""
) {
  const h =
    `${title} ${sentence}`
      .toLowerCase();

  if (
    /\bcrowdfund(?:ing|ed)?\b/.test(h)
  ) {
    return "people who donated to a crowdfunding campaign";
  }

  if (
    /\bcharit(?:y|ies|able)\b/.test(h)
  ) {
    return "adults who made charitable donations";
  }

  return "";
}

function containsUndefinedReference(
  text = ""
) {
  return /\b(these|those|such)\s+(factors?|issues?|things?|reasons?|circumstances?|conditions?|changes?|effects?|events?|concerns?|problems?|pressures?|challenges?|results?|findings?)\b/i.test(
    text
  );
}

function isMalformedDonationQuestion(
  question = "",
  context = "",
  sourceUrl = ""
) {
  const q =
    question
      .replace(/\s+/g, " ")
      .trim();

  const h =
    `${context} ${sourceUrl}`
      .toLowerCase();

  if (
    /^how many people\s+(donated|gave|contributed)\b/i.test(q) &&
    /\bcrowdfund(?:ing|ed)?\b/.test(h)
  ) {
    return true;
  }

  if (
    /^how many people\s+(donated|gave|contributed)\b/i.test(q) &&
    /\$\s*\d/.test(q)
  ) {
    return true;
  }

  return false;
}

function isAmbiguousMultiYearQuestion(
  question = ""
) {
  const q =
    question
      .replace(/\s+/g, " ")
      .trim();

  const years =
    q.match(
      /\b(?:19|20)\d{2}\b/g
    ) || [];

  const uniqueYears =
    [...new Set(years)];

  if (
    uniqueYears.length < 2
  ) {
    return false;
  }

  if (
    /\b(compared|compare|versus|vs\.?|than)\b/i.test(q)
  ) {
    return true;
  }

  if (
    /\bthis year\b/i.test(q)
  ) {
    return true;
  }

  if (
    /\bin\s+(?:19|20)\d{2}\b[\s\S]{0,100}\band\b[\s\S]{0,100}\bin\s+(?:19|20)\d{2}\b/i.test(
      q
    )
  ) {
    return true;
  }

  return false;
}

function isUnsupportedSportsSuperFanQuestion(
  question = "",
  context = ""
) {
  const h =
    `${question} ${context}`
      .toLowerCase();

  return (
    /\bsuper fans?\b/.test(h) &&
    /\bsports streaming services?\b/.test(h) &&
    /\b1 in 5\b/.test(h)
  );
}

function hasBadQuestionLanguage(
  question = ""
) {
  const q =
    question
      .replace(/\s+/g, " ")
      .trim();

  if (!q) {
    return true;
  }

  if (
    /^in a survey about\b/i.test(q)
  ) {
    return true;
  }

  if (
    /\b(matched this survey finding|matched the survey finding|this survey finding|this finding|the finding above|the survey finding above|the research topic)\b/i.test(
      q
    )
  ) {
    return true;
  }

  if (
    containsUndefinedReference(q)
  ) {
    return true;
  }

  if (
    isAmbiguousMultiYearQuestion(q)
  ) {
    return true;
  }

  if (
    /^how many\s+those who\b/i.test(q)
  ) {
    return true;
  }

  if (
    /\bhow many\s+(donated|said|used|use|listening|watching|getting|prefer|agreed|believe|think)\b/i.test(
      q
    )
  ) {
    return true;
  }

  if (
    /\bhow many\s+[^?]{0,80}\b(listening|using|watching|getting|adopting)\b/i.test(
      q
    )
  ) {
    return true;
  }

  if (
    /;\s*[^?]+\?/i.test(q)
  ) {
    return true;
  }

  if (
    /\b\d{1,3}%\b/.test(q) ||
    /\b\d+\s+in\s+\d+\b/i.test(q)
  ) {
    return true;
  }

  return false;
}

function questionHasStandaloneContext(
  question = ""
) {
  const q =
    question
      .replace(/\s+/g, " ")
      .trim();

  if (
    hasBadQuestionLanguage(q)
  ) {
    return false;
  }

  if (
    /\b(this|that|these|those)\s+(number|result|stat|statistic|finding|survey|factor|issue|thing|reason|condition|effect)\b/i.test(
      q
    )
  ) {
    return false;
  }

  return true;
}

function findStats(
  sentence = ""
) {
  const found = [];

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
      /\b(?!1000)(\d{1,2}|100)%\b/g
    )
  ) {
    const n =
      Number(m[1]);

    if (
      n >= 5 &&
      n <= 95
    ) {
      found.push({
        stat: m[0],
        raw: m[0],
        index: m.index,
        type: "percent"
      });
    }
  }

  for (
    const m of sentence.matchAll(
      /\b([1-9]|10)\s+in\s+([2-9]|10)\b/gi
    )
  ) {
    const a =
      Number(m[1]);

    const b =
      Number(m[2]);

    if (a < b) {
      found.push({
        stat: `${a} in ${b}`,
        raw: m[0],
        index: m.index,
        type: "ratio"
      });
    }
  }

  const wordWord =
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+in\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi;

  for (
    const m of sentence.matchAll(
      wordWord
    )
  ) {
    const a =
      nums[
        m[1].toLowerCase()
      ];

    const b =
      nums[
        m[2].toLowerCase()
      ];

    if (a < b) {
      found.push({
        stat: `${a} in ${b}`,
        raw: m[0],
        index: m.index,
        type: "ratio"
      });
    }
  }

  const wordNumber =
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+in\s+([2-9]|10)\b/gi;

  for (
    const m of sentence.matchAll(
      wordNumber
    )
  ) {
    const a =
      nums[
        m[1].toLowerCase()
      ];

    const b =
      Number(m[2]);

    if (a < b) {
      found.push({
        stat: `${a} in ${b}`,
        raw: m[0],
        index: m.index,
        type: "ratio"
      });
    }
  }

  const numberWord =
    /\b([1-9]|10)\s+in\s+(two|three|four|five|six|seven|eight|nine|ten)\b/gi;

  for (
    const m of sentence.matchAll(
      numberWord
    )
  ) {
    const a =
      Number(m[1]);

    const b =
      nums[
        m[2].toLowerCase()
      ];

    if (a < b) {
      found.push({
        stat: `${a} in ${b}`,
        raw: m[0],
        index: m.index,
        type: "ratio"
      });
    }
  }

  const seen =
    new Set();

  return found
    .sort(
      (a, b) =>
        a.index - b.index
    )
    .filter(x => {
      const k =
        `${x.raw.toLowerCase()}|${x.index}`;

      if (
        seen.has(k)
      ) {
        return false;
      }

      seen.add(k);
      return true;
    });
}
function isolateFindingClause(
  sentence,
  target,
  allStats = []
) {
  const raw =
    target.raw ||
    target.stat;

  let s =
    stripTrailingSemicolonClause(
      sentence,
      raw
    );

  if (
    containsUndefinedReference(s)
  ) {
    return "";
  }

  const sentenceYears =
    s.match(
      /\b(?:19|20)\d{2}\b/g
    ) || [];

  if (
    new Set(
      sentenceYears
    ).size >= 2 &&
    /\b(compared|compare|versus|vs\.?|than|this year)\b/i.test(
      s
    )
  ) {
    return "";
  }

  const targetIndex =
    s
      .toLowerCase()
      .indexOf(
        raw.toLowerCase()
      );

  if (
    targetIndex < 0
  ) {
    return "";
  }

  if (
    allStats.length > 1
  ) {
    const later =
      allStats
        .filter(x =>
          (
            (x.raw || x.stat)
              .toLowerCase() !==
            raw.toLowerCase()
          ) ||
          x.index !== target.index
        )
        .map(x => {
          const xRaw =
            x.raw ||
            x.stat;

          const idx =
            s
              .toLowerCase()
              .indexOf(
                xRaw.toLowerCase(),
                targetIndex +
                raw.length
              );

          return idx;
        })
        .filter(
          idx =>
            idx >
            targetIndex
        )
        .sort(
          (a, b) =>
            a - b
        );

    if (
      later.length
    ) {
      const nextStat =
        later[0];

      const between =
        s.slice(
          targetIndex +
          raw.length,
          nextStat
        );

      const cutMatch =
        between.match(
          /(?:,?\s+(?:and|while|but|whereas|compared with|compared to)\s+|[;—])/i
        );

      if (
        !cutMatch
      ) {
        return "";
      }

      const cutAt =
        targetIndex +
        raw.length +
        cutMatch.index;

      s =
        s
          .slice(
            0,
            cutAt
          )
          .trim()
          .replace(
            /[,;:—-]+$/,
            ""
          )
          .trim();
    }
  }

  const remaining =
    findStats(s);

  if (
    remaining.length > 1
  ) {
    return "";
  }

  if (
    containsUndefinedReference(s)
  ) {
    return "";
  }

  return s;
}

function stripRatioLead(
  sentence,
  rawStat
) {
  const escaped =
    regexEscape(rawStat);

  return sentence
    .replace(
      new RegExp(
        `^(about|around|roughly|nearly|almost|approximately|only|just|more than|less than|another)?\\s*${escaped}\\s+`,
        "i"
      ),
      ""
    )
    .replace(
      /^of\s+/i,
      ""
    )
    .replace(
      /[.!?]+$/,
      ""
    )
    .trim();
}

function cleanRatioTail(
  tail = ""
) {
  return fixBroadcastGrammar(
    tail
  )
    .replace(
      /\badopting\b/gi,
      "have adopted"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function makeThoseWhoQuestion(
  tail = ""
) {
  const clean =
    tail
      .replace(/\s+/g, " ")
      .trim()
      .replace(
        /[.!?]+$/,
        ""
      );

  const m =
    clean.match(
      /^those who (.+?)\s+(believe|believed|think|thought|say|said|report|reported|feel|felt|agree|agreed|expect|expected|use|used|have|had|are|were|want|wanted|prefer|preferred)\s+(.+)$/i
    );

  if (!m) {
    return "";
  }

  const population =
    m[1].trim();

  const verb =
    m[2].trim();

  const remainder =
    m[3].trim();

  if (
    !population ||
    !verb ||
    !remainder
  ) {
    return "";
  }

  return `Among those who ${population}, how many ${verb} ${remainder}?`;
}

function makeRatioQuestion(
  sentence,
  target,
  articleTitle = ""
) {
  const s =
    sentence
      .replace(/\s+/g, " ")
      .trim();

  const raw =
    target.raw ||
    target.stat;

  const escaped =
    regexEscape(raw);

  const beginsWithRatio =
    new RegExp(
      `^(about|around|roughly|nearly|almost|approximately|only|just|more than|less than|another)?\\s*${escaped}\\s+`,
      "i"
    ).test(s);

  if (
    beginsWithRatio
  ) {
    let tail =
      cleanRatioTail(
        stripRatioLead(
          s,
          raw
        )
      );

    if (!tail) {
      return "";
    }

    if (
      /\bsuper fans?\b/i.test(
        tail
      ) &&
      /\bsports streaming services?\b/i.test(
        tail
      )
    ) {
      return "";
    }

    if (
      /^those who\b/i.test(
        tail
      )
    ) {
      return makeThoseWhoQuestion(
        tail
      );
    }

    if (
      /^Americans\s+have used crypto\b/i.test(
        tail
      )
    ) {
      return "How many Americans have used cryptocurrency?";
    }

    if (
      /^(donated|gave|contributed)\b/i.test(
        tail
      )
    ) {
      const population =
        contextualPopulationFromTitle(
          articleTitle,
          s
        );

      if (
        !population
      ) {
        return "";
      }

      return `Among ${population}, how many ${tail}?`;
    }

    if (
      /^(Americans|U\.S\. adults|US adults|Australians|adults|people|parents|workers|employees|consumers|respondents|listeners|viewers|shoppers|students|teens|teenagers|women|men|young women|young men)\b/i.test(
        tail
      )
    ) {
      return `How many ${tail}?`;
    }

    if (
      startsWithVerbPhrase(
        tail
      )
    ) {
      return `How many people ${tail}?`;
    }

    return `How many ${tail}?`;
  }

  const idx =
    s
      .toLowerCase()
      .indexOf(
        raw.toLowerCase()
      );

  if (
    idx < 0
  ) {
    return "";
  }

  let before =
    s
      .slice(0, idx)
      .replace(
        /[,;:\s-]+$/,
        ""
      )
      .trim();

  let after =
    s
      .slice(
        idx +
        raw.length
      )
      .replace(
        /^[,;:\s-]+/,
        ""
      )
      .replace(
        /[.!?]+$/,
        ""
      )
      .trim()
      .replace(
        /^of\s+/i,
        ""
      );

  after =
    cleanRatioTail(
      after
    );

  if (
    !after ||
    containsUndefinedReference(
      after
    )
  ) {
    return "";
  }

  if (
    /\bsuper fans?\b/i.test(
      `${s} ${after}`
    ) &&
    /\bsports streaming services?\b/i.test(
      `${s} ${after}`
    )
  ) {
    return "";
  }

  if (
    /^those who\b/i.test(
      after
    )
  ) {
    return makeThoseWhoQuestion(
      after
    );
  }

  if (
    /^among\b/i.test(
      before
    )
  ) {
    const population =
      before
        .replace(
          /^among\s+/i,
          ""
        )
        .trim();

    if (
      !population
    ) {
      return "";
    }

    if (
      startsWithVerbPhrase(
        after
      )
    ) {
      return `Among ${population}, how many people ${after}?`;
    }

    return `Among ${population}, how many ${after}?`;
  }

  const populationMatch =
    before.match(
      /\b(Americans|U\.S\. adults|US adults|Australians|adults|parents|workers|employees|consumers|respondents|listeners|viewers|shoppers|teens|teenagers|children|students|people|women|men)\b[^,;:]*/i
    );

  if (
    populationMatch
  ) {
    const population =
      fixBroadcastGrammar(
        populationMatch[0]
      );

    if (
      /^who\b/i.test(
        after
      )
    ) {
      return `How many ${population} ${after}?`;
    }

    if (
      startsWithVerbPhrase(
        after
      )
    ) {
      return `How many ${population} ${after}?`;
    }
  }

  if (
    /^(donated|gave|contributed)\b/i.test(
      after
    )
  ) {
    const population =
      contextualPopulationFromTitle(
        articleTitle,
        s
      );

    if (
      !population
    ) {
      return "";
    }

    return `Among ${population}, how many ${after}?`;
  }

  return "";
}

function makePercentageQuestion(
  sentence,
  target
) {
  const s =
    sentence
      .replace(/\s+/g, " ")
      .trim();

  const raw =
    target.raw ||
    target.stat;

  const escaped =
    regexEscape(raw);

  let m =
    s.match(
      new RegExp(
        `^${escaped}\\s+of\\s+(.+?)[.!]?$`,
        "i"
      )
    );

  if (m) {
    return `What percentage of ${fixBroadcastGrammar(
      m[1]
        .replace(
          /[.!?]+$/,
          ""
        )
    )}?`;
  }

  m =
    s.match(
      new RegExp(
        `^(Among\\s+[^,]+,\\s*)${escaped}\\s+(.+?)[.!]?$`,
        "i"
      )
    );

  if (m) {
    return `${m[1]}what percentage ${fixBroadcastGrammar(
      m[2]
        .replace(
          /[.!?]+$/,
          ""
        )
    )}?`;
  }

  const replaced =
    fixBroadcastGrammar(
      s.replace(
        new RegExp(
          escaped,
          "i"
        ),
        "what percentage"
      )
    );

  return (
    replaced
      .replace(
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

function makeQuestion(
  sentence,
  target,
  articleTitle = "",
  allStats = []
) {
  const isolated =
    isolateFindingClause(
      sentence,
      target,
      allStats
    );

  if (
    !isolated
  ) {
    return "";
  }

  let q =
    target.type === "ratio"
      ? makeRatioQuestion(
          isolated,
          target,
          articleTitle
        )
      : makePercentageQuestion(
          isolated,
          target
        );

  q =
    fixBroadcastGrammar(q)
      .replace(
        /\s+\?/g,
        "?"
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  if (
    !questionHasStandaloneContext(
      q
    )
  ) {
    return "";
  }

  if (
    findStats(q).length > 0
  ) {
    return "";
  }

  if (
    /\b\d{1,3}%\b/.test(q) ||
    /\b\d+\s+in\s+\d+\b/i.test(q)
  ) {
    return "";
  }

  return q;
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
  const d =
    new Date(raw);

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
  const d =
    new Date(
      `${raw}T12:00:00Z`
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
      `${date}T00:00:00Z`
    ).getTime()
  ) / 86400000;
}

function cleanFindingContext(
  sentence = ""
) {
  return stripHtml(
    sentence
  )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .replace(
      /^[-–—\s]+/,
      ""
    )
    .replace(
      /["“”]+/g,
      "”"
    )
    .slice(
      0,
      260
    );
}
function extractCandidates(
  article,
  sourceName
) {
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

    if (
      !clean
    ) {
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

  const seen =
    new Set();

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

    if (
      containsUndefinedReference(
        sentence
      )
    ) {
      continue;
    }

    const sentenceYears =
      sentence.match(
        /\b(?:19|20)\d{2}\b/g
      ) || [];

    if (
      new Set(
        sentenceYears
      ).size >= 2 &&
      /\b(compared|compare|versus|vs\.?|than|this year)\b/i.test(
        sentence
      )
    ) {
      continue;
    }

    if (
      /\bsuper fans?\b/i.test(
        sentence
      ) &&
      /\bsports streaming services?\b/i.test(
        sentence
      )
    ) {
      continue;
    }

    if (
      /\b(discount|off sale|battery|humidity|chance of rain)\b/i.test(
        sentence
      ) &&
      !/\bshopping|stores?|online|consumer\b/i.test(
        sentence
      )
    ) {
      continue;
    }

    const stats =
      findStats(
        sentence
      );

    if (
      !stats.length
    ) {
      continue;
    }

    for (
      const found of
      stats.slice(0, 2)
    ) {
      const key =
        `${article.link}|${sentence}|${found.stat}|${found.raw}`;

      if (
        seen.has(key)
      ) {
        continue;
      }

      seen.add(key);

      const question =
        makeQuestion(
          sentence,
          found,
          article.title,
          stats
        );

      const isolated =
        isolateFindingClause(
          sentence,
          found,
          stats
        );

      const topic =
        inferTopicFromFinding(
          isolated ||
          sentence,
          article.title
        );

      const published =
        isoDate(
          article.date
        );

      const findingContext =
        cleanFindingContext(
          isolated ||
          sentence
        );

      out.push({
        id:
          hashId([
            sourceName,
            article.link,
            sentence,
            found.stat
          ]),

        topic,

        question,

        answer:
          found.stat,

        stat:
          found.stat,

        context:
          findingContext
            ? `Finding: ${findingContext}`
            : "From a recent survey finding.",

        talk:
          talkForFinding(
            topic,
            isolated ||
            sentence,
            article.title
          ),

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

function explainUsability(
  item
) {
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
    item.question.length > 240
  ) {
    return "question_length";
  }

  if (
    !questionHasStandaloneContext(
      item.question
    )
  ) {
    return "standalone";
  }

  if (
    isMalformedDonationQuestion(
      item.question,
      item.context || "",
      item.source_url || ""
    )
  ) {
    return "standalone";
  }

  if (
    isAmbiguousMultiYearQuestion(
      item.question
    )
  ) {
    return "standalone";
  }

  if (
    isUnsupportedSportsSuperFanQuestion(
      item.question,
      item.context || ""
    )
  ) {
    return "standalone";
  }

  if (
    findStats(
      item.question
    ).length > 0
  ) {
    return "standalone";
  }

  if (
    isPolitical(
      `${item.question} ${item.context || ""}`
    )
  ) {
    return "political";
  }

  if (
    containsUndefinedReference(
      `${item.question} ${item.context || ""}`
    )
  ) {
    return "standalone";
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

    if (
      n >= 2
    ) {
      continue;
    }

    picked.push(
      item
    );

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
            x.id ===
            item.id
        )
      ) {
        picked.push(
          item
        );
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
    pickWidgetItems(
      items
    )
      .slice(
        0,
        limit
      );

  const topics =
    [
      ...new Set(
        picked.map(
          x =>
            x.topic
        )
      )
    ]
      .sort();

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
      )}${
        item.context
          ? ` — ${escapeHtml(item.context)}`
          : ""
      }
    </p>

    <p class="mjrss-talk">
      <strong>Talk About It:</strong>
      ${escapeHtml(
        item.talk ||
        talkForFinding(
          item.topic,
          item.question
        )
      )}
    </p>

    <div class="mjrss-source">
      <strong>Source:</strong>
      <a
        href="${escapeHtml(item.source_url)}"
        target="_blank"
        rel="noopener noreferrer"
      >${escapeHtml(item.source)}</a>
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
      : {
          history: []
        };

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
  days =
    RECENT_SHOWN_DAYS
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
      ids.add(
        id
      );
    }
  }

  return ids;
}

function sourceCount(
  chosen,
  source
) {
  return chosen
    .filter(
      x =>
        x.source ===
        source
    )
    .length;
}

function pickDailyRotation(
  pool,
  count,
  state
) {
  const recent =
    recentShownIds(
      state
    );

  const newestFirst =
    arr =>
      [...arr]
        .sort(
          (a, b) =>
            String(
              b.published_at ||
              b.source_date ||
              ""
            )
              .localeCompare(
                String(
                  a.published_at ||
                  a.source_date ||
                  ""
                )
              )
        );

  const ordered = [
    ...newestFirst(
      pool.filter(
        x =>
          !recent.has(
            x.id
          )
      )
    ),

    ...newestFirst(
      pool.filter(
        x =>
          recent.has(
            x.id
          )
      )
    )
  ];

  const chosen = [];

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
        x =>
          x.topic
      )
    );

  for (
    const item of
    ordered
  ) {
    if (
      chosen.length >=
      count
    ) {
      break;
    }

    if (
      chosen.some(
        x =>
          x.id ===
          item.id
      )
    ) {
      continue;
    }

    if (
      sourceCount(
        chosen,
        item.source
      ) >=
      MAX_PER_SOURCE
    ) {
      continue;
    }

    if (
      usedTopics.has(
        item.topic
      )
    ) {
      continue;
    }

    chosen.push(
      item
    );

    usedTopics.add(
      item.topic
    );
  }

  for (
    const item of
    ordered
  ) {
    if (
      chosen.length >=
      count
    ) {
      break;
    }

    if (
      chosen.some(
        x =>
          x.id ===
          item.id
      )
    ) {
      continue;
    }

    if (
      sourceCount(
        chosen,
        item.source
      ) >=
      MAX_PER_SOURCE
    ) {
      continue;
    }

    chosen.push(
      item
    );
  }

  for (
    const item of
    ordered
  ) {
    if (
      chosen.length >=
      count
    ) {
      break;
    }

    if (
      chosen.some(
        x =>
          x.id ===
          item.id
      )
    ) {
      continue;
    }

    chosen.push(
      item
    );
  }

  return chosen
    .slice(
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
            "MediaJobsReport-SurveySays/2.6 (+https://www.mediajobsreport.com/)",

          accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5"
        },

        redirect:
          "follow"
      }
    );

  if (
    !r.ok
  ) {
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

  const diag = {};

  const ensureDiag =
    source => {

      if (
        !diag[source]
      ) {
        diag[source] = {
          discovered: 0,
          rejectedMissing: 0,
          rejectedQuestionLength: 0,
          rejectedStandalone: 0,
          rejectedPolitical: 0,
          rejectedAge: 0,
          rejectedDuplicate: 0,
          accepted: 0
        };
      }

      return diag[source];
    };

  const seed =
    fs.existsSync(
      SEED
    )
      ? JSON.parse(
          fs.readFileSync(
            SEED,
            "utf8"
          )
        )
      : [];

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

  let discovered = [];

  for (
    const source of
    SOURCES
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
        parseFeed(
          xml
        );

      console.log(
        `  RSS items: ${articles.length}`
      );

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

      const before =
        discovered.length;

      for (
        const article of
        articles
      ) {
        discovered.push(
          ...extractCandidates(
            article,
            source.name
          )
        );
      }

      const added =
        discovered.length -
        before;

      ensureDiag(
        source.name
      ).discovered +=
        added;

      console.log(
        `  Findings discovered from ${source.name}: ${added}`
      );

    } catch (
      err
    ) {
      console.warn(
        `  Source failed: ${err.message}`
      );
    }
  }

  const merged = [
    ...discovered,
    ...previous,
    ...seed
  ];

  const discoveredObjects =
    new Set(
      discovered
    );

  const dedup =
    new Map();

  for (
    const item of
    merged
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
        "standalone"
      ) {
        d.rejectedStandalone++;

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
      dedup.has(
        key
      )
    ) {
      if (
        discoveredObjects.has(
          item
        )
      ) {
        ensureDiag(
          item.source ||
          "Unknown"
        )
          .rejectedDuplicate++;
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

  const allUsable =
    [...dedup.values()]
      .sort(
        (a, b) =>
          String(
            b.published_at ||
            b.source_date ||
            ""
          )
            .localeCompare(
              String(
                a.published_at ||
                a.source_date ||
                ""
              )
            )
      );

  const items =
    allUsable
      .slice(
        0,
        MAX_POOL
      );

  const finalIds =
    new Set(
      items.map(
        x =>
          x.id
      )
    );

  for (
    const item of
    discovered
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
      finalIds.has(
        key
      )
    ) {
      ensureDiag(
        item.source ||
        "Unknown"
      )
        .accepted++;
    }
  }

  for (
    const [
      source,
      d
    ] of
    Object.entries(
      diag
    )
  ) {
    console.log(
      `Diagnostics ${source}: ` +
      `discovered=${d.discovered}, ` +
      `missing=${d.rejectedMissing}, ` +
      `question_length=${d.rejectedQuestionLength}, ` +
      `standalone=${d.rejectedStandalone}, ` +
      `political=${d.rejectedPolitical}, ` +
      `age=${d.rejectedAge}, ` +
      `duplicate=${d.rejectedDuplicate}, ` +
      `accepted=${d.accepted}`
    );
  }

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

  fs.writeFileSync(
    OUT_HTML,
    buildWidgetHtml(
      daily3,
      3
    )
  );

  rotationState.history = [
    {
      date:
        dateKey(),

      ids:
        daily7.map(
          x =>
            x.id
        )
    },

    ...(
      rotationState.history ||
      []
    )
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
    `Source diversity target: maximum ${MAX_PER_SOURCE} items per source when enough alternatives exist.`
  );

  console.log(
    "Static widgets: 3 / 5 / 7 generated in docs/"
  );

})().catch(
  err => {
    console.error(
      err
    );

    process.exit(
      1
    );
  }
);
