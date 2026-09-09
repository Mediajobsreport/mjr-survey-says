const OAI_BASE = "https://dataverse.unc.edu/oai";
const OAI_SET = "odum_all";

const MAX_PAGES = 10;
const LOOKBACK_DAYS = 730;

const POLITICAL_RE =
  /\b(trump|biden|democrat|republican|congress|senate|house of representatives|election|electoral|vote|voter|partisan|political party|white house|supreme court|president|governor|campaign|candidate)\b/i;

const SURVEY_RE =
  /\b(survey|poll|public opinion|questionnaire|respondent|respondents|interview|interviews|attitudes|opinions)\b/i;

const PERCENT_RE =
  /\b(?:[5-9]|[1-8]\d|9[0-5])%\b/g;

const NUMERIC_RATIO_RE =
  /\b([1-9]|10)\s+in\s+([2-9]|10)\b/gi;

const WORD_RATIO_RE =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+in\s+(two|three|four|five|six|seven|eight|nine|ten)\b/gi;

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'");
}

function stripHtml(value = "") {
  return decodeXml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlValues(block, tagName) {
  const re = new RegExp(
    `<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`,
    "gi"
  );

  return [...block.matchAll(re)]
    .map(match => stripHtml(match[1]))
    .filter(Boolean);
}

function firstXmlValue(block, tagName) {
  return xmlValues(block, tagName)[0] || "";
}

function parseRecords(xml) {
  const blocks =
    xml.match(/<record\b[\s\S]*?<\/record>/gi) || [];

  return blocks.map(block => {
    const header =
      block.match(/<header\b[\s\S]*?<\/header>/i)?.[0] || "";

    const metadata =
      block.match(/<metadata\b[\s\S]*?<\/metadata>/i)?.[0] || "";

    const identifier =
      firstXmlValue(header, "identifier");

    const datestamp =
      firstXmlValue(header, "datestamp");

    const titles =
      xmlValues(metadata, "dc:title");

    const descriptions =
      xmlValues(metadata, "dc:description");

    const subjects =
      xmlValues(metadata, "dc:subject");

    const creators =
      xmlValues(metadata, "dc:creator");

    const publishers =
      xmlValues(metadata, "dc:publisher");

    const dates =
      xmlValues(metadata, "dc:date");

    const identifiers =
      xmlValues(metadata, "dc:identifier");

    const title =
      titles[0] || "";

    const description =
      descriptions.join(" ");

    const text = [
      title,
      description,
      subjects.join(" "),
      creators.join(" "),
      publishers.join(" ")
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const url =
      identifiers.find(value =>
        /^https?:\/\//i.test(value)
      ) || "";

    return {
      identifier,
      datestamp,
      title,
      description,
      subjects,
      creators,
      publishers,
      dates,
      identifiers,
      url,
      text
    };
  });
}

function getResumptionToken(xml) {
  const match =
    xml.match(
      /<resumptionToken(?:\s[^>]*)?>([\s\S]*?)<\/resumptionToken>/i
    );

  return match
    ? stripHtml(match[1])
    : "";
}

function daysAgo(days) {
  const date = new Date(
    Date.now() - days * 86400000
  );

  return date
    .toISOString()
    .slice(0, 10);
}

function extractStats(text = "") {
  const stats = [];

  for (
    const match of text.matchAll(PERCENT_RE)
  ) {
    stats.push(match[0]);
  }

  for (
    const match of text.matchAll(NUMERIC_RATIO_RE)
  ) {
    const a = Number(match[1]);
    const b = Number(match[2]);

    if (a < b) {
      stats.push(
        `${a} in ${b}`
      );
    }
  }

  for (
    const match of text.matchAll(WORD_RATIO_RE)
  ) {
    stats.push(match[0]);
  }

  return [...new Set(stats)];
}

function shorten(text = "", max = 240) {
  if (text.length <= max) {
    return text;
  }

  return (
    text.slice(0, max - 1).trim() +
    "…"
  );
}

async function fetchText(url) {
  const response =
    await fetch(url, {
      headers: {
        "user-agent":
          "MediaJobsReport-SurveySays/1.0 (+https://www.mediajobsreport.com/)"
      },
      redirect: "follow"
    });

  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}`
    );
  }

  return response.text();
}

async function fetchOdumRecords() {
  const allRecords = [];

  let token = "";
  let page = 0;

  const from =
    daysAgo(LOOKBACK_DAYS);

  while (page < MAX_PAGES) {
    page++;

    let url;

    if (token) {
      url =
        `${OAI_BASE}?verb=ListRecords` +
        `&resumptionToken=${encodeURIComponent(token)}`;
    } else {
      url =
        `${OAI_BASE}?verb=ListRecords` +
        `&metadataPrefix=oai_dc` +
        `&set=${encodeURIComponent(OAI_SET)}` +
        `&from=${encodeURIComponent(from)}`;
    }

    console.log(
      `Fetching Odum OAI page ${page}...`
    );

    const xml =
      await fetchText(url);

    const records =
      parseRecords(xml);

    console.log(
      `  Records returned: ${records.length}`
    );

    allRecords.push(
      ...records
    );

    token =
      getResumptionToken(xml);

    if (!token) {
      break;
    }
  }

  return allRecords;
}

(async () => {
  console.log("");
  console.log(
    "MJR Survey Says — Odum Institute Diagnostic"
  );
  console.log(
    "============================================"
  );
  console.log("");

  console.log(
    `OAI set: ${OAI_SET}`
  );

  console.log(
    `Lookback: ${LOOKBACK_DAYS} days`
  );

  console.log("");

  const records =
    await fetchOdumRecords();

  const unique =
    new Map();

  for (
    const record of records
  ) {
    const key =
      record.identifier ||
      record.url ||
      record.title;

    if (
      key &&
      !unique.has(key)
    ) {
      unique.set(
        key,
        record
      );
    }
  }

  const items = [
    ...unique.values()
  ];

  const surveyLike =
    items.filter(item =>
      SURVEY_RE.test(item.text)
    );

  const political =
    surveyLike.filter(item =>
      POLITICAL_RE.test(item.text)
    );

  const nonPolitical =
    surveyLike.filter(item =>
      !POLITICAL_RE.test(item.text)
    );

  const withStats =
    nonPolitical
      .map(item => ({
        ...item,
        stats:
          extractStats(item.text)
      }))
      .filter(item =>
        item.stats.length
      );

  console.log("");
  console.log(
    "ODUM DIAGNOSTIC RESULTS"
  );
  console.log(
    "-----------------------"
  );

  console.log(
    `Unique published records: ${items.length}`
  );

  console.log(
    `Survey/poll-like records: ${surveyLike.length}`
  );

  console.log(
    `Political survey records excluded: ${political.length}`
  );

  console.log(
    `Nonpolitical survey records: ${nonPolitical.length}`
  );

  console.log(
    `Nonpolitical records with percentages/ratios in metadata: ${withStats.length}`
  );

  console.log("");

  if (!withStats.length) {
    console.log(
      "No directly usable survey statistics were found in the public metadata."
    );

    console.log("");
    console.log(
      "This does NOT mean Odum is unusable."
    );

    console.log(
      "It means the useful statistics are probably inside dataset files/codebooks rather than the OAI metadata."
    );

    console.log("");
  } else {
    console.log(
      "POTENTIAL SURVEY SAYS ITEMS"
    );

    console.log(
      "---------------------------"
    );

    withStats
      .slice(0, 20)
      .forEach(
        (item, index) => {
          console.log("");

          console.log(
            `${index + 1}. ${item.title}`
          );

          console.log(
            `   Stats: ${item.stats.join(", ")}`
          );

          console.log(
            `   Date: ${item.datestamp || item.dates[0] || "Unknown"}`
          );

          console.log(
            `   Description: ${shorten(item.description || "No description")}`
          );

          if (item.url) {
            console.log(
              `   URL: ${item.url}`
            );
          }
        }
      );

    console.log("");
  }

  console.log(
    "MOST RECENT NONPOLITICAL SURVEY-LIKE RECORDS"
  );

  console.log(
    "-------------------------------------------"
  );

  nonPolitical
    .sort(
      (a, b) =>
        String(
          b.datestamp || ""
        ).localeCompare(
          String(
            a.datestamp || ""
          )
        )
    )
    .slice(0, 20)
    .forEach(
      (item, index) => {
        console.log("");

        console.log(
          `${index + 1}. ${item.title}`
        );

        console.log(
          `   Date: ${item.datestamp || item.dates[0] || "Unknown"}`
        );

        console.log(
          `   Description: ${shorten(item.description || "No description")}`
        );

        if (item.url) {
          console.log(
            `   URL: ${item.url}`
          );
        }
      }
    );

  console.log("");
  console.log(
    "Diagnostic complete."
  );
  console.log("");

})().catch(error => {
  console.error("");
  console.error(
    "Odum diagnostic failed:"
  );

  console.error(
    error.message
  );

  console.error("");

  process.exit(1);
});
