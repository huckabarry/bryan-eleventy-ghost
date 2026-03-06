#!/usr/bin/env node

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const ROOT_DIR = path.resolve(__dirname, "..");
const POSTS_ROOT = path.join(ROOT_DIR, "src", "reading-books");
const IMAGES_ROOT = path.join(ROOT_DIR, "src", "assets", "reading-images");
const DEFAULT_AUTHOR = "Bryan Robb";
const FEED_URL = "https://bookwyrm.social/user/bryan/rss";
const BOOK_HOST = "https://bookwyrm.social";
const MAX_ITEMS = 120;

const pageHtmlCache = new Map();

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function decodeHtmlEntities(value) {
  const text = String(value == null ? "" : value);
  const named = { amp: "&", apos: "'", quot: "\"", lt: "<", gt: ">", nbsp: " " };
  const toCodePoint = (num) => {
    if (!Number.isInteger(num) || num < 0 || num > 0x10ffff) {
      return "";
    }
    try {
      return String.fromCodePoint(num);
    } catch (error) {
      return "";
    }
  };

  return text
    .replace(/&#(\d+);/g, (_, dec) => toCodePoint(Number.parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => toCodePoint(Number.parseInt(hex, 16)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (match, name) => {
      const key = String(name).toLowerCase();
      return Object.prototype.hasOwnProperty.call(named, key) ? named[key] : match;
    });
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function escapeYaml(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"");
}

function normalizeDate(value) {
  const parsed = new Date(value || Date.now());
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function dayKey(isoDate) {
  return normalizeDate(isoDate).slice(0, 10);
}

function toAbsoluteUrl(url, base = BOOK_HOST) {
  try {
    return new URL(url, base).toString();
  } catch (error) {
    return "";
  }
}

function extractTag(xml, tagName) {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = String(xml || "").match(re);
  if (!match) {
    return "";
  }
  return decodeHtmlEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim());
}

function parseRssItems(xml) {
  const channelItems = String(xml || "").match(/<item>[\s\S]*?<\/item>/gi) || [];

  return channelItems.slice(0, MAX_ITEMS).map((itemXml) => {
    const title = stripHtml(extractTag(itemXml, "title"));
    const link = toAbsoluteUrl(extractTag(itemXml, "link"), BOOK_HOST);
    const descriptionHtml = extractTag(itemXml, "description");
    const descriptionText = stripHtml(descriptionHtml);
    const pubDate = extractTag(itemXml, "pubDate");
    const bookHrefMatch =
      itemXml.match(/href=["'](\/book\/[^"']+)["']/i) ||
      itemXml.match(/href=["'](https?:\/\/[^"']+\/book\/[^"']+)["']/i);
    const bookUrl = bookHrefMatch ? toAbsoluteUrl(bookHrefMatch[1], BOOK_HOST) : "";
    const italicTitleMatch = descriptionHtml.match(/<i>([^<]+)<\/i>/i);

    return {
      title,
      link,
      description: descriptionText,
      date: pubDate,
      bookUrl,
      descriptionBookTitle: italicTitleMatch ? stripHtml(italicTitleMatch[1]) : ""
    };
  });
}

function classifyItem(item) {
  const title = String(item && item.title ? item.title : "").toLowerCase();
  if (title.includes("started reading")) {
    return "started";
  }
  if (title.includes("finished reading")) {
    return "finished";
  }
  if (title.startsWith("review of ")) {
    return "review";
  }
  return "";
}

function deriveBookTitle(item) {
  if (item.descriptionBookTitle) {
    return item.descriptionBookTitle;
  }
  const reviewMatch = String(item.title || "").match(/^review of\s+"([^"]+)"/i);
  if (reviewMatch && reviewMatch[1]) {
    return reviewMatch[1].trim();
  }
  const readingMatch = String(item.title || "").match(/reading\s+(.+?)\s+by\s+/i);
  if (readingMatch && readingMatch[1]) {
    return readingMatch[1].trim();
  }
  return String(item.title || "").trim();
}

function deriveBookTitleFromRawTitle(rawTitle) {
  const title = String(rawTitle || "").trim();
  const reviewMatch = title.match(/^review(?::| of)\s+"?(.+?)"?(\s+\(\d+\s+stars\))?(?::|$)/i);
  if (reviewMatch && reviewMatch[1]) {
    return reviewMatch[1].trim();
  }
  const startedMatch = title.match(/started reading\s+(.+?)\s+by\s+/i);
  if (startedMatch && startedMatch[1]) {
    return startedMatch[1].trim();
  }
  const finishedMatch = title.match(/finished reading\s+(.+?)\s+by\s+/i);
  if (finishedMatch && finishedMatch[1]) {
    return finishedMatch[1].trim();
  }
  return title;
}

function deriveBookAuthorFromRawTitle(rawTitle) {
  const title = String(rawTitle || "").trim();
  const readingMatch = title.match(/reading\s+.+?\s+by\s+(.+)$/i);
  if (readingMatch && readingMatch[1]) {
    return readingMatch[1].trim();
  }
  return "";
}

async function fetchText(url) {
  const target = String(url || "").trim();
  if (!target) {
    return "";
  }
  if (pageHtmlCache.has(target)) {
    return pageHtmlCache.get(target);
  }

  const response = await fetch(target, {
    redirect: "follow",
    headers: {
      "User-Agent": "afterword.blog bookwyrm sync script",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${target}`);
  }

  const text = await response.text();
  pageHtmlCache.set(target, text);
  return text;
}

async function resolveBookUrlFromEntryUrl(entryUrl) {
  if (!entryUrl) {
    return "";
  }

  try {
    const html = await fetchText(entryUrl);
    const absMatch = html.match(/href=["'](https?:\/\/[^"']+\/book\/\d+)["']/i);
    if (absMatch && absMatch[1]) {
      return toAbsoluteUrl(absMatch[1], BOOK_HOST);
    }
    const relMatch = html.match(/href=["'](\/book\/\d+)["']/i);
    if (relMatch && relMatch[1]) {
      return toAbsoluteUrl(relMatch[1], BOOK_HOST);
    }
  } catch (error) {
    console.warn(`[bookwyrm-sync] unable to resolve book URL from ${entryUrl}: ${error.message}`);
  }

  return "";
}

async function getCoverFromBookUrl(bookUrl) {
  if (!bookUrl) {
    return "";
  }

  try {
    const html = await fetchText(bookUrl);
    const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (ogImage && ogImage[1]) {
      return toAbsoluteUrl(ogImage[1], BOOK_HOST);
    }
    const coverImg = html.match(/<img[^>]+class=["'][^"']*book-cover[^"']*["'][^>]+src=["']([^"']+)["']/i);
    if (coverImg && coverImg[1]) {
      return toAbsoluteUrl(coverImg[1], BOOK_HOST);
    }
  } catch (error) {
    console.warn(`[bookwyrm-sync] unable to resolve cover from ${bookUrl}: ${error.message}`);
  }

  return "";
}

function getUrlExtension(url) {
  try {
    const pathname = new URL(url).pathname || "";
    const ext = path.extname(pathname).toLowerCase();
    if (/^\.[a-z0-9]{2,5}$/.test(ext)) {
      return ext;
    }
  } catch (error) {
    return ".jpg";
  }
  return ".jpg";
}

async function downloadFile(url, destination) {
  if (!url) {
    return false;
  }
  if (fs.existsSync(destination)) {
    return false;
  }

  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "afterword.blog bookwyrm sync script"
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(destination, buffer);
  return true;
}

function splitFrontMatter(source) {
  const text = String(source || "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) {
    return { frontMatter: "", body: text };
  }
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) {
    return { frontMatter: "", body: text };
  }
  return {
    frontMatter: text.slice(4, end),
    body: text.slice(end + 5)
  };
}

function readFrontMatterValue(frontMatter, key) {
  const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const match = String(frontMatter || "").match(re);
  if (!match) {
    return "";
  }
  return String(match[1] || "").trim().replace(/^"|"$/g, "");
}

function readFrontMatterTags(frontMatter) {
  const lines = String(frontMatter || "").split("\n");
  const tags = [];
  let readingTags = false;

  for (const line of lines) {
    if (/^tags:\s*$/.test(line.trim())) {
      readingTags = true;
      continue;
    }
    if (readingTags) {
      const match = line.match(/^\s*-\s*(.+)\s*$/);
      if (match) {
        tags.push(match[1].trim().replace(/^"|"$/g, ""));
        continue;
      }
      if (line.trim()) {
        break;
      }
    }
  }

  return tags;
}

function extractImagePathFromBody(body) {
  const match = String(body || "").match(/!\[[^\]]*\]\((\/assets\/reading-images\/[^)]+)\)/i);
  return match ? match[1] : "";
}

function parseEventsFromBody(body) {
  const events = [];
  const lines = String(body || "").split("\n");

  lines.forEach((line) => {
    const match = line.match(/^\s*-\s*(\d{4}-\d{2}-\d{2})\s+(started|finished|reviewed)\b(.*)$/i);
    if (!match) {
      return;
    }

    events.push({
      date: normalizeDate(match[1]),
      type: match[2].toLowerCase() === "reviewed" ? "review" : match[2].toLowerCase(),
      note: stripHtml(match[3] || "").replace(/^[\s\-:–—]+/, "")
    });
  });

  return events;
}

function inferEventFromPost(title, tags, date, sourceUrl, description) {
  const normalizedTitle = String(title || "").toLowerCase();
  let type = "";

  if (normalizedTitle.startsWith("review:") || normalizedTitle.startsWith("review of")) {
    type = "review";
  } else if (normalizedTitle.includes("started reading")) {
    type = "started";
  } else if (normalizedTitle.includes("finished reading")) {
    type = "finished";
  } else if (tags.includes("now-reading")) {
    type = "started";
  } else if (tags.includes("books")) {
    type = "finished";
  }

  if (!type) {
    return null;
  }

  return {
    type,
    date: normalizeDate(date),
    sourceUrl: sourceUrl || "",
    note: description || ""
  };
}

function eventKey(event) {
  return `${dayKey(event.date)}|${event.type}|${String(event.sourceUrl || "").trim()}`;
}

function createBookRecord() {
  return {
    key: "",
    bookTitle: "",
    bookAuthor: "",
    bookUrl: "",
    coverPublicPath: "",
    coverRemoteUrl: "",
    candidatePaths: [],
    events: new Map(),
    fallbackEvents: []
  };
}

function upsertEvent(record, event) {
  if (!event || !event.type) {
    return;
  }
  const key = eventKey(event);
  const existing = record.events.get(key);
  if (!existing) {
    record.events.set(key, event);
    return;
  }
  if (String(event.note || "").length > String(existing.note || "").length) {
    record.events.set(key, event);
  }
}

function getEventSummary(events) {
  const hasFinished = events.some((e) => e.type === "finished");
  const hasStarted = events.some((e) => e.type === "started");
  if (hasStarted && !hasFinished) {
    return "Currently reading";
  }
  if (hasFinished) {
    const lastFinish = [...events]
      .filter((e) => e.type === "finished")
      .sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)))[0];
    return `Finished on ${dayKey(lastFinish.date)}`;
  }
  return "Reading log";
}

function createMarkdownForBook({
  title,
  bookAuthor,
  publishedAt,
  slug,
  tags,
  bookWyrmUrl,
  bookUrl,
  coverPublicPath,
  events,
  excerpt
}) {
  const frontMatter = [
    "---",
    `title: "${escapeYaml(title)}"`,
    `date: ${publishedAt}`,
    "tags:",
    ...tags.map((tag) => `  - ${tag}`),
    `slug: "${escapeYaml(slug)}"`,
    `author: "${escapeYaml(DEFAULT_AUTHOR)}"`,
    `book_author: "${escapeYaml(bookAuthor || "")}"`,
    `excerpt: "${escapeYaml(excerpt)}"`,
    `bookwyrm_url: "${escapeYaml(bookWyrmUrl || "")}"`,
    `book_url: "${escapeYaml(bookUrl || "")}"`,
    "---",
    ""
  ];

  const lines = [];

  if (coverPublicPath) {
    lines.push(`![](${coverPublicPath})`, "");
  }

  if (bookUrl) {
    lines.push(`Book page: [${title}](${bookUrl})`, "");
  }

  if (bookWyrmUrl) {
    lines.push(`BookWyrm profile entry: [View](${bookWyrmUrl})`, "");
  }

  lines.push("## Reading Log", "");

  events.forEach((event) => {
    const label = event.type === "started" ? "started" : event.type === "finished" ? "finished" : "reviewed";
    const note = String(event.note || "").trim();
    const source = String(event.sourceUrl || "").trim();
    const sourceText = source ? ` ([source](${source}))` : "";
    const noteText = note ? ` - ${note}` : "";
    lines.push(`- ${dayKey(event.date)} ${label}${noteText}${sourceText}`);
  });

  lines.push("");
  return frontMatter.concat(lines).join("\n");
}

async function listReadingMarkdownFiles() {
  const files = [];
  const walk = async (dir) => {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("_")) {
        files.push(fullPath);
      }
    }
  };
  await walk(POSTS_ROOT);
  return files;
}

function buildBookKey(bookUrl, title) {
  const canonicalTitle = deriveBookTitleFromRawTitle(title);
  return bookUrl || `title:${slugify(canonicalTitle)}`;
}

async function loadExistingRecords() {
  const records = new Map();
  const files = await listReadingMarkdownFiles();

  for (const filePath of files) {
    const source = await fsp.readFile(filePath, "utf8");
    const { frontMatter, body } = splitFrontMatter(source);
    const title = readFrontMatterValue(frontMatter, "title");
    const bookAuthor = readFrontMatterValue(frontMatter, "book_author");
    const bookUrl = readFrontMatterValue(frontMatter, "book_url");
    const bookWyrmUrl = readFrontMatterValue(frontMatter, "bookwyrm_url");
    const date = readFrontMatterValue(frontMatter, "date");
    const tags = readFrontMatterTags(frontMatter);
    const coverPath = extractImagePathFromBody(body);
    const key = buildBookKey(bookUrl, title);

    if (!records.has(key)) {
      records.set(key, createBookRecord());
    }

    const record = records.get(key);
    record.key = key;
    record.bookTitle = record.bookTitle || deriveBookTitleFromRawTitle(title);
    record.bookAuthor = record.bookAuthor || bookAuthor || deriveBookAuthorFromRawTitle(title);
    record.bookUrl = record.bookUrl || bookUrl;
    record.coverPublicPath = record.coverPublicPath || coverPath;
    record.candidatePaths.push(filePath);

    const inferred = inferEventFromPost(title, tags, date, bookWyrmUrl, "");
    if (inferred) {
      record.fallbackEvents.push(inferred);
    }
  }

  return records;
}

async function main() {
  await fsp.mkdir(POSTS_ROOT, { recursive: true });
  await fsp.mkdir(IMAGES_ROOT, { recursive: true });

  const records = await loadExistingRecords();
  const rssXml = await fetchText(FEED_URL);
  const feedItems = parseRssItems(rssXml);

  for (const item of feedItems) {
    const eventType = classifyItem(item);
    if (!eventType) {
      continue;
    }

    const bookTitle = deriveBookTitle(item);
    const resolvedBookUrl = item.bookUrl || (await resolveBookUrlFromEntryUrl(item.link));
    const key = buildBookKey(resolvedBookUrl, bookTitle);
    if (!records.has(key)) {
      records.set(key, createBookRecord());
    }
    const record = records.get(key);
    record.key = key;
    record.bookTitle = record.bookTitle || bookTitle;
    record.bookAuthor = record.bookAuthor || deriveBookAuthorFromRawTitle(item.title);
    record.bookUrl = record.bookUrl || resolvedBookUrl;

    upsertEvent(record, {
      type: eventType,
      date: normalizeDate(item.date),
      sourceUrl: item.link,
      note: item.description || ""
    });
  }

  // Reconcile any title-keyed records into URL-keyed records when titles match.
  const recordsByTitle = new Map();
  for (const record of records.values()) {
    const titleKey = slugify(deriveBookTitleFromRawTitle(record.bookTitle));
    if (!titleKey) {
      continue;
    }
    if (!recordsByTitle.has(titleKey)) {
      recordsByTitle.set(titleKey, []);
    }
    recordsByTitle.get(titleKey).push(record);
  }

  recordsByTitle.forEach((group) => {
    if (group.length < 2) {
      return;
    }

    const preferred = group.find((record) => record.bookUrl) || group[0];
    group.forEach((record) => {
      if (record === preferred) {
        return;
      }
      record.candidatePaths.forEach((p) => preferred.candidatePaths.push(p));
      preferred.coverPublicPath = preferred.coverPublicPath || record.coverPublicPath;
      preferred.bookUrl = preferred.bookUrl || record.bookUrl;
      preferred.bookTitle = preferred.bookTitle || record.bookTitle;
      preferred.bookAuthor = preferred.bookAuthor || record.bookAuthor;
      record.events.forEach((event) => upsertEvent(preferred, event));
      records.delete(record.key);
    });

    if (preferred.bookUrl && preferred.key !== preferred.bookUrl) {
      records.delete(preferred.key);
      preferred.key = preferred.bookUrl;
      records.set(preferred.key, preferred);
    }
  });

  let createdPosts = 0;
  let updatedPosts = 0;
  let removedPosts = 0;
  let downloadedImages = 0;
  let existingImages = 0;
  let failedImages = 0;
  const keepPaths = new Set();

  for (const record of records.values()) {
    if (!record.events.size && record.fallbackEvents.length) {
      record.fallbackEvents.forEach((event) => upsertEvent(record, event));
    }

    if (!record.bookTitle || !record.events.size) {
      continue;
    }

    const events = Array.from(record.events.values()).sort((a, b) =>
      normalizeDate(a.date).localeCompare(normalizeDate(b.date))
    );
    const firstDate = dayKey(events[0].date);
    const [year, month] = firstDate.split("-").slice(0, 2);
    const slug = slugify(record.bookTitle).slice(0, 90) || "book";
    const fileName = `${firstDate}-${slug}.md`;
    const targetDir = path.join(POSTS_ROOT, year, month);
    const targetPath = path.join(targetDir, fileName);

    await fsp.mkdir(targetDir, { recursive: true });

    const coverUrl = await getCoverFromBookUrl(record.bookUrl);
    if (coverUrl) {
      record.coverRemoteUrl = coverUrl;
      const hash = crypto.createHash("sha1").update(coverUrl).digest("hex").slice(0, 8);
      const ext = getUrlExtension(coverUrl);
      const imageName = `${slug}-${hash}${ext}`;
      const imageDir = path.join(IMAGES_ROOT, year);
      const imagePath = path.join(imageDir, imageName);
      await fsp.mkdir(imageDir, { recursive: true });

      try {
        const downloaded = await downloadFile(coverUrl, imagePath);
        if (downloaded) {
          downloadedImages += 1;
        } else {
          existingImages += 1;
        }
        record.coverPublicPath = `/assets/reading-images/${year}/${imageName}`;
      } catch (error) {
        failedImages += 1;
        console.warn(`[bookwyrm-sync] cover download failed for "${record.bookTitle}": ${error.message}`);
      }
    }

    const hasFinished = events.some((e) => e.type === "finished");
    const tags = hasFinished ? ["books"] : ["books", "now-reading"];
    const excerpt = getEventSummary(events);
    const newestSource = [...events]
      .filter((event) => event.sourceUrl)
      .sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)))[0];
    const markdown = createMarkdownForBook({
      title: record.bookTitle,
      bookAuthor: record.bookAuthor,
      publishedAt: normalizeDate(events[0].date),
      slug,
      tags,
      bookWyrmUrl: newestSource ? newestSource.sourceUrl : "",
      bookUrl: record.bookUrl,
      coverPublicPath: record.coverPublicPath,
      events,
      excerpt
    });

    const exists = fs.existsSync(targetPath);
    const previous = exists ? await fsp.readFile(targetPath, "utf8") : "";
    if (previous !== markdown) {
      await fsp.writeFile(targetPath, markdown, "utf8");
      if (exists) {
        updatedPosts += 1;
      } else {
        createdPosts += 1;
      }
    }
    keepPaths.add(targetPath);

    record.candidatePaths.forEach((candidate) => {
      if (candidate !== targetPath && fs.existsSync(candidate)) {
        fs.unlinkSync(candidate);
        removedPosts += 1;
      }
    });
  }

  const allFiles = await listReadingMarkdownFiles();
  for (const filePath of allFiles) {
    if (!keepPaths.has(filePath)) {
      fs.unlinkSync(filePath);
      removedPosts += 1;
    }
  }

  console.log(
    `[bookwyrm-sync] posts created: ${createdPosts}, posts updated: ${updatedPosts}, posts removed: ${removedPosts}, image downloads: ${downloadedImages}, image already present: ${existingImages}, image download failures: ${failedImages}`
  );
}

main().catch((error) => {
  console.error(`[bookwyrm-sync] fatal error: ${error.stack || error.message}`);
  process.exit(1);
});
