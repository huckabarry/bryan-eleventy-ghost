const GhostAdminAPI = require("@tryghost/admin-api");
const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
const rssPlugin = require("@11ty/eleventy-plugin-rss");
const RssParser = require("rss-parser");
const fs = require("fs");

const ghostApi = new GhostAdminAPI({
  url: process.env.GHOST_ADMIN_URL || process.env.GHOST_URL,
  key: process.env.GHOST_ADMIN_KEY,
  version: "v5.71"
});

let nowPostsPromise;
const rssParser = new RssParser({
  customFields: {
    item: [["content:encoded", "contentEncoded"], "creator", "category", "guid"]
  }
});
const INCLUDED_SITE_TAGS = [
  "afterword",
  "status",
  "listening",
  "books",
  "gallery",
  "now-playing",
  "now-reading",
  "photos",
  "now"
];
const STATUS_MAX_CHARACTERS = 500;

function isUsablePhotoUrl(url) {
  const value = String(url || "");

  if (!value) {
    return false;
  }

  if (/\.(png)(\?|$)/i.test(value)) {
    return false;
  }

  if (/favicon|bookwyrm|avatar|screenshot|screen-shot|screen_shot/i.test(value)) {
    return false;
  }

  return true;
}

function getImageAlt(fragment, fallback = "") {
  const match = String(fragment || "").match(/\salt=["']([^"']*)["']/i);
  return match ? match[1] : fallback;
}

function extractAllImages(post) {
  const html = String(post && post.html ? post.html : "");
  const cleanedHtml = html
    .replace(/<figure[^>]*class=["'][^"']*kg-bookmark-card[^"']*["'][\s\S]*?<\/figure>/gi, "")
    .replace(/<div[^>]*class=["'][^"']*kg-bookmark-card[^"']*["'][\s\S]*?<\/div>/gi, "")
    .replace(/<figure[^>]*class=["'][^"']*kg-embed-card[^"']*["'][\s\S]*?<\/figure>/gi, "")
    .replace(/<div[^>]*class=["'][^"']*kg-embed-card[^"']*["'][\s\S]*?<\/div>/gi, "");
  const matches = [];
  const seen = new Set();
  const imagePattern = /<img(?![^>]*class=["'][^"']*kg-bookmark-(?:thumbnail|icon)[^"']*["'])[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = imagePattern.exec(cleanedHtml))) {
    const fragment = match[0];
    const classMatch = fragment.match(/\bclass=["']([^"']+)["']/i);
    const classNames = classMatch ? classMatch[1] : "";
    if (/(^|\s)(avatar|author|profile|icon)(\s|$)/i.test(classNames)) {
      continue;
    }

    const src = match[1];

    if (!isUsablePhotoUrl(src) || seen.has(src)) {
      continue;
    }

    seen.add(src);
    matches.push({
      src,
      alt: getImageAlt(fragment, post.title || "")
    });
  }

  if (!matches.length && post && post.feature_image && isUsablePhotoUrl(post.feature_image)) {
    matches.push({
      src: post.feature_image,
      alt: post.title || ""
    });
  }

  return matches;
}

function extractFirstImage(post) {
  return extractAllImages(post)[0] || null;
}

function stripFirstImage(html) {
  const source = String(html || "");
  const patterns = [
    /<figure[^>]*class=["'][^"']*kg-image-card[^"']*["'][\s\S]*?<\/figure>/i,
    /<figure[^>]*class=["'][^"']*kg-gallery-card[^"']*["'][\s\S]*?<\/figure>/i,
    /<figure[\s\S]*?<img[^>]*>[\s\S]*?<\/figure>/i,
    /<p>\s*<img[^>]*>\s*<\/p>/i,
    /<img[^>]*>/i
  ];

  for (const pattern of patterns) {
    if (pattern.test(source)) {
      return source.replace(pattern, "").trim();
    }
  }

  return source;
}

function stripBookmarkCardImages(html) {
  const source = String(html || "");

  return source
    .replace(
      /<(figure|div)([^>]*class=["'][^"']*kg-bookmark-card[^"']*["'][^>]*)>[\s\S]*?<\/\1>/gi,
      (block) => block.replace(/<img\b[^>]*>/gi, "")
    )
    .replace(/<div[^>]*class=["'][^"']*kg-bookmark-thumbnail[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<span[^>]*class=["'][^"']*kg-bookmark-icon[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, "")
    .replace(/<img[^>]*class=["'][^"']*kg-bookmark-(?:thumbnail|icon)[^"']*["'][^>]*>/gi, "");
}

function postHasTag(post, slug) {
  return (post.tags || []).some((tag) => tag && tag.slug === slug);
}

function parseTagSlugs(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
}

function toTagObjectFromSlug(tagSlug) {
  const normalizedSlug = slugify(tagSlug);
  if (!normalizedSlug) {
    return null;
  }
  return {
    slug: normalizedSlug,
    name: toTagName(normalizedSlug),
    visibility: "public"
  };
}

function resolveGhostContentBase() {
  const candidates = [process.env.GHOST_URL, process.env.GHOST_ADMIN_URL]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    const normalized = candidate.replace(/\/+$/, "").replace(/\/ghost$/i, "");
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function getGhostPostSlugFromUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    return slugify(parts.pop() || "");
  } catch (error) {
    return "";
  }
}

function mapGhostRssItemToPost(item) {
  const contentHtml = String(item && (item.contentEncoded || item.content || item["content:encoded"]) ? (item.contentEncoded || item.content || item["content:encoded"]) : "").trim();
  const dateValue = normalizeDate(item && (item.isoDate || item.pubDate) ? (item.isoDate || item.pubDate) : "", new Date().toISOString());
  const categories = []
    .concat(item && Array.isArray(item.categories) ? item.categories : [])
    .concat(item && item.category ? [item.category] : []);
  const tags = categories
    .map((value) => toTagObjectFromSlug(String(value || "")))
    .filter(Boolean);
  const slug = slugify(
    (item && item.slug) ||
      getGhostPostSlugFromUrl(item && item.link ? item.link : "") ||
      (item && item.guid) ||
      (item && item.title) ||
      ""
  );
  const title = String(item && item.title ? item.title : "").trim() || "Untitled";
  const authorName = String(item && item.creator ? item.creator : "").trim() || "Ghost";

  return {
    id: String(item && (item.guid || item.link || slug) ? (item.guid || item.link || slug) : `ghost-rss:${slug}`),
    uuid: String(item && (item.guid || item.link || slug) ? (item.guid || item.link || slug) : `ghost-rss:${slug}`),
    slug: slug || "post",
    title,
    html: contentHtml,
    excerpt: String(item && item.contentSnippet ? item.contentSnippet : "").trim(),
    feature_image: null,
    visibility: "public",
    published_at: dateValue,
    updated_at: dateValue,
    tags,
    primary_author: {
      name: authorName
    },
    authors: [
      {
        name: authorName
      }
    ]
  };
}

async function fetchGhostPostsFromRss(contentBase) {
  const base = String(contentBase || "").trim().replace(/\/+$/, "");
  if (!base) {
    return [];
  }

  const feedUrl = `${base}/rss/`;
  const feed = await rssParser.parseURL(feedUrl);
  const items = Array.isArray(feed && feed.items) ? feed.items : [];
  const posts = items.map((item) => mapGhostRssItemToPost(item));

  console.log(`[afterword] fetched ${posts.length} Ghost posts via RSS fallback`);
  return posts;
}

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

function getStatusLabel(post) {
  if (postHasTag(post, "status")) {
    return "";
  }

  return post.title || "";
}

function isUntitledPost(post) {
  const title = String(post && post.title ? post.title : "").trim().toLowerCase();
  return !title || title === "untitled" || title === "no subject";
}

function isListeningPost(post) {
  return postHasTag(post, "listening") || postHasTag(post, "now-playing");
}

function isBookPost(post) {
  return postHasTag(post, "books") || postHasTag(post, "now-reading");
}

function splitTitleByBy(value) {
  const text = String(value || "").trim();
  if (!text) {
    return { title: "", byline: "" };
  }

  const match = text.match(/^(.+?)\s+by\s+(.+)$/i);
  if (!match) {
    return { title: text, byline: "" };
  }

  return {
    title: String(match[1] || "").trim(),
    byline: String(match[2] || "").trim()
  };
}

function getMediaCardTitle(post) {
  const split = splitTitleByBy(post && post.title ? post.title : "");
  return split.title || String(post && post.title ? post.title : "").trim();
}

function getMediaCardSubtitle(post) {
  if (isListeningPost(post)) {
    const split = splitTitleByBy(post && post.title ? post.title : "");
    return split.byline;
  }

  if (isBookPost(post)) {
    const explicitAuthor = String(post && post.book_author ? post.book_author : "").trim();
    if (explicitAuthor) {
      return explicitAuthor;
    }

    const split = splitTitleByBy(post && post.title ? post.title : "");
    return split.byline;
  }

  return "";
}

function isLocalMarkdownPost(post) {
  const id = String(post && post.id ? post.id : "");
  return id.startsWith("local-");
}

function getPlainTextFromHtml(html) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function getPlainTextPreview(post, maxLength = 220) {
  const text = getPlainTextFromHtml(post && post.html ? post.html : "");

  if (!text) {
    return "";
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trimEnd()}…`;
}

function getStatusPreview(post) {
  const excerpt = decodeHtmlEntities(String(post && post.excerpt ? post.excerpt : "").trim());

  if (excerpt) {
    return excerpt;
  }

  const preview = getPlainTextPreview(post);

  if (preview) {
    return preview;
  }

  if (/<img\b/i.test(String(post && post.html ? post.html : ""))) {
    return "Photo update";
  }

  return decodeHtmlEntities(String(post && post.title ? post.title : "").trim());
}

function normalizeStatusLengthForCollections(post) {
  if (isLocalMarkdownPost(post)) {
    return post;
  }

  if (!postHasTag(post, "status")) {
    return post;
  }

  const bodyLength = getPlainTextFromHtml(post && post.html ? post.html : "").length;
  if (bodyLength <= STATUS_MAX_CHARACTERS) {
    return post;
  }

  return {
    ...post,
    tags: (post.tags || []).filter((tag) => !(tag && tag.slug === "status"))
  };
}

function firstWords(value, count = 7) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }

  const words = text.split(" ").filter(Boolean);
  if (words.length <= count) {
    return words.join(" ");
  }

  return `${words.slice(0, count).join(" ")}…`;
}

function isUntitledLikeTitle(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^[\(\[\{]\s*/, "")
    .replace(/\s*[\)\]\}]$/, "");
  const compact = normalized.replace(/[^a-z0-9]+/g, " ").trim();

  return !compact || compact === "untitled" || compact === "no subject" || compact === "nosubject";
}

function getLocalPostSlug(post) {
  const ghostSlug = String(post && post.slug ? post.slug : "").trim();

  if (!postHasTag(post, "status")) {
    return ghostSlug;
  }

  if (ghostSlug && ghostSlug !== "untitled") {
    return ghostSlug;
  }

  const words = getStatusPreview(post).split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
  const derivedSlug = slugify(words);

  return derivedSlug || ghostSlug || "status";
}

function getLocalPostUrl(post) {
  return `/${getLocalPostSlug(post)}/`;
}

function xmlEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cdataSafe(value) {
  return String(value == null ? "" : value).replace(/]]>/g, "]]]]><![CDATA[>");
}

function getCollectionIndex(posts, currentPost) {
  const items = Array.isArray(posts) ? posts : [];
  const currentId = currentPost && currentPost.id;
  const currentSlug = currentPost && currentPost.slug;
  const currentLocalSlug = currentPost ? getLocalPostSlug(currentPost) : "";

  return items.findIndex((post) => {
    if (currentId && post.id === currentId) {
      return true;
    }

    if (currentSlug && post.slug === currentSlug) {
      return true;
    }

    return currentLocalSlug && getLocalPostSlug(post) === currentLocalSlug;
  });
}

function normalizeDate(value, fallback = new Date(0).toISOString()) {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return parsed.toISOString();
}

function toTagName(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseLocalPostTags(value, requiredTag) {
  const rawTags = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

  const normalized = rawTags
    .map((tag) => slugify(tag))
    .filter(Boolean);

  const required = slugify(requiredTag || "");
  if (required && !normalized.includes(required)) {
    normalized.unshift(required);
  }

  const seen = new Set();
  return normalized
    .filter((tag) => {
      if (seen.has(tag)) {
        return false;
      }
      seen.add(tag);
      return true;
    })
    .map((tagSlug) => ({
      slug: tagSlug,
      name: toTagName(tagSlug),
      visibility: "public"
    }));
}

function createLocalMarkdownPost(item, options = {}) {
  const { idPrefix = "local-post", requiredTag = "" } = options;
  const data = (item && item.data) || {};
  const slug = slugify(data.slug || item.fileSlug || "");
  const publishedAt = normalizeDate(
    data.published_at || data.date || item.date,
    item && item.date ? new Date(item.date).toISOString() : new Date().toISOString()
  );
  const updatedAt = normalizeDate(data.updated_at || data.modified_at || publishedAt, publishedAt);
  const title = String(data.title || "").trim() || "Untitled";
  const markdownSource = readLocalMarkdownBody(item && item.inputPath ? item.inputPath : "");
  const html = markdownToSimpleHtml(markdownSource);
  const excerpt = String(data.excerpt || "").trim();
  const featureImage = data.feature_image || data.featureImage || "";
  const albumwhaleUrl = String(data.albumwhale_url || "").trim();
  const authorName = String(data.author || data.author_name || "Bryan Robb").trim() || "Bryan Robb";
  const albumwhaleOrder = Number.isFinite(Number(data.albumwhale_order)) ? Number(data.albumwhale_order) : null;
  const bookAuthor = String(data.book_author || "").trim() || null;

  return {
    id: `${idPrefix}:${slug || item.fileSlug || item.inputPath}`,
    uuid: `${idPrefix}:${slug || item.fileSlug || item.inputPath}`,
    slug: slug || item.fileSlug || "status",
    title,
    html,
    excerpt,
    feature_image: featureImage || null,
    albumwhale_url: albumwhaleUrl || null,
    albumwhale_order: albumwhaleOrder,
    book_author: bookAuthor,
    visibility: "published",
    published_at: publishedAt,
    updated_at: updatedAt,
    tags: parseLocalPostTags(data.tags, requiredTag),
    primary_author: {
      name: authorName
    },
    authors: [
      {
        name: authorName
      }
    ]
  };
}

function createLocalStatusPost(item) {
  return createLocalMarkdownPost(item, {
    idPrefix: "local-status",
    requiredTag: "status"
  });
}

function createLocalListeningPost(item) {
  return createLocalMarkdownPost(item, {
    idPrefix: "local-listening",
    requiredTag: "listening"
  });
}

function createLocalBookPost(item) {
  return createLocalMarkdownPost(item, {
    idPrefix: "local-book",
    requiredTag: ""
  });
}

function readLocalMarkdownBody(filePath) {
  if (!filePath) {
    return "";
  }

  try {
    const source = fs.readFileSync(filePath, "utf8");
    return stripFrontMatter(source).trim();
  } catch (error) {
    console.warn(`[afterword] unable to read local markdown ${filePath}: ${error.message}`);
    return "";
  }
}

function stripFrontMatter(source) {
  const text = String(source || "").replace(/\r\n/g, "\n");

  if (!text.startsWith("---\n")) {
    return text;
  }

  const end = text.indexOf("\n---\n", 4);
  if (end === -1) {
    return text;
  }

  return text.slice(end + 5);
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeHtmlEntities(value) {
  const text = String(value == null ? "" : value);
  const namedEntities = {
    amp: "&",
    apos: "'",
    quot: "\"",
    lt: "<",
    gt: ">",
    nbsp: " ",
    rsquo: "'",
    lsquo: "'",
    rdquo: "\"",
    ldquo: "\"",
    ndash: "-",
    mdash: "-"
  };
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
      return Object.prototype.hasOwnProperty.call(namedEntities, key) ? namedEntities[key] : match;
    });
}

function inlineMarkdownToHtml(text) {
  return escapeHtml(text).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
  });
}

function markdownToSimpleHtml(markdown) {
  const normalized = String(markdown || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return "";
  }

  const htmlBlocks = [];
  const paragraphLines = [];
  const imageOnlyLinePattern = /^!\[([^\]]*)\]\(([^)\s]+)\)(?:!\[([^\]]*)\]\(([^)\s]+)\))*$/;
  const imagePattern = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

  const flushParagraph = () => {
    if (!paragraphLines.length) {
      return;
    }

    const lineHtml = paragraphLines
      .map((line) => {
        return inlineMarkdownToHtml(line).replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => {
          return `<img src="${escapeHtml(src || "")}" alt="${escapeHtml(alt || "")}">`;
        });
      })
      .join("<br>");
    htmlBlocks.push(`<p>${lineHtml}</p>`);
    paragraphLines.length = 0;
  };

  normalized.split("\n").forEach((rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      return;
    }

    if (imageOnlyLinePattern.test(line)) {
      flushParagraph();
      let match;
      while ((match = imagePattern.exec(line)) !== null) {
        const alt = escapeHtml(match[1] || "");
        const src = escapeHtml(match[2] || "");
        htmlBlocks.push(`<p><img src="${src}" alt="${alt}"></p>`);
      }
      imagePattern.lastIndex = 0;
      return;
    }

    paragraphLines.push(rawLine);
  });

  flushParagraph();

  return htmlBlocks.join("\n");
}

function mergePostsByLocalSlug(posts) {
  const map = new Map();

  (posts || []).forEach((post) => {
    const slug = getLocalPostSlug(post);
    const key = slug || `id:${post.id || post.uuid || Math.random()}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, post);
      return;
    }

    if (isPostNewer(post, existing)) {
      map.set(key, post);
    }
  });

  return Array.from(map.values());
}

function getPostPublishedTime(post) {
  const value = new Date(post && post.published_at ? post.published_at : 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function getPostUpdatedTime(post) {
  const value = new Date(post && post.updated_at ? post.updated_at : 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function comparePostsDesc(a, b) {
  const publishedDiff = getPostPublishedTime(b) - getPostPublishedTime(a);
  if (publishedDiff !== 0) {
    return publishedDiff;
  }

  const updatedDiff = getPostUpdatedTime(b) - getPostUpdatedTime(a);
  if (updatedDiff !== 0) {
    return updatedDiff;
  }

  const aListeningOrder = Number.isFinite(Number(a && a.albumwhale_order)) ? Number(a.albumwhale_order) : null;
  const bListeningOrder = Number.isFinite(Number(b && b.albumwhale_order)) ? Number(b.albumwhale_order) : null;
  if (
    isListeningPost(a) &&
    isListeningPost(b) &&
    aListeningOrder !== null &&
    bListeningOrder !== null &&
    aListeningOrder !== bListeningOrder
  ) {
    return aListeningOrder - bListeningOrder;
  }

  const aSlug = getLocalPostSlug(a);
  const bSlug = getLocalPostSlug(b);
  return bSlug.localeCompare(aSlug);
}

function normalizeTitleKey(value) {
  return decodeHtmlEntities(String(value || ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getPostDayKey(post) {
  const value = String(post && post.published_at ? post.published_at : "").trim();
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function getListeningPostScore(post) {
  let score = 0;

  const id = String(post && post.id ? post.id : "");
  if (id.startsWith("local-listening:")) {
    score += 10;
  }

  if (String(post && post.albumwhale_url ? post.albumwhale_url : "").trim()) {
    score += 5;
  }

  if (/<img\b/i.test(String(post && post.html ? post.html : ""))) {
    score += 2;
  }

  return score;
}

function getListeningSourceKey(post) {
  const explicitSource = String(post && post.albumwhale_url ? post.albumwhale_url : "").trim();
  if (explicitSource) {
    return explicitSource;
  }

  const html = String(post && post.html ? post.html : "");
  const match = html.match(/https?:\/\/albumwhale\.com\/[^"'\\s<>]+/i);
  return match ? match[0] : "";
}

function dedupeListeningPosts(posts) {
  const nonListening = [];
  const listeningByKey = new Map();

  (posts || []).forEach((post) => {
    if (!isListeningPost(post)) {
      nonListening.push(post);
      return;
    }

    const sourceKey = getListeningSourceKey(post);
    const dayKey = getPostDayKey(post);
    const titleKey = normalizeTitleKey(post && post.title ? post.title : "");
    const dedupeKey = sourceKey || `${dayKey}|${titleKey}`;

    if (!sourceKey && (!dayKey || !titleKey)) {
      nonListening.push(post);
      return;
    }

    const existing = listeningByKey.get(dedupeKey);
    if (!existing || getListeningPostScore(post) > getListeningPostScore(existing)) {
      listeningByKey.set(dedupeKey, post);
    }
  });

  return [...nonListening, ...Array.from(listeningByKey.values())];
}

function getBookPostScore(post) {
  let score = 0;

  const id = String(post && post.id ? post.id : "");
  if (id.startsWith("local-book:")) {
    score += 10;
  }

  if (String(post && post.bookwyrm_url ? post.bookwyrm_url : "").trim()) {
    score += 5;
  }

  if (/<img\b/i.test(String(post && post.html ? post.html : ""))) {
    score += 2;
  }

  return score;
}

function dedupeBookPosts(posts) {
  const nonBooks = [];
  const booksByKey = new Map();

  (posts || []).forEach((post) => {
    if (!isBookPost(post)) {
      nonBooks.push(post);
      return;
    }

    const sourceKey = String(post && post.bookwyrm_url ? post.bookwyrm_url : "").trim();
    const dayKey = getPostDayKey(post);
    const titleKey = normalizeTitleKey(post && post.title ? post.title : "");
    const dedupeKey = sourceKey || `${dayKey}|${titleKey}`;

    if (!sourceKey && (!dayKey || !titleKey)) {
      nonBooks.push(post);
      return;
    }

    const existing = booksByKey.get(dedupeKey);
    if (!existing || getBookPostScore(post) > getBookPostScore(existing)) {
      booksByKey.set(dedupeKey, post);
    }
  });

  return [...nonBooks, ...Array.from(booksByKey.values())];
}

function isPostNewer(candidate, existing) {
  const publishedDiff = getPostPublishedTime(candidate) - getPostPublishedTime(existing);
  if (publishedDiff !== 0) {
    return publishedDiff > 0;
  }

  const updatedDiff = getPostUpdatedTime(candidate) - getPostUpdatedTime(existing);
  if (updatedDiff !== 0) {
    return updatedDiff > 0;
  }

  return getLocalPostSlug(candidate).localeCompare(getLocalPostSlug(existing)) > 0;
}

async function fetchNowPosts() {
  if (!nowPostsPromise) {
    const filter = "status:published";

    nowPostsPromise = ghostApi.posts
      .browse({
        formats: "html",
        include: "tags,authors",
        limit: 100,
        filter
      })
      .catch(async (adminError) => {
        const adminDetails = adminError && adminError.message ? adminError.message : String(adminError);
        console.warn(`[afterword] Ghost Admin API fetch failed; trying Content API fallback. ${adminDetails}`);

        const contentBase = resolveGhostContentBase();
        const contentKey = String(process.env.GHOST_CONTENT_API_KEY || "").trim();

        if (contentBase && contentKey) {
          try {
            const params = new URLSearchParams({
              key: contentKey,
              filter,
              include: "tags,authors",
              formats: "html",
              limit: "100"
            });
            const response = await fetch(`${contentBase}/ghost/api/content/posts/?${params.toString()}`, {
              method: "GET",
              headers: {
                Accept: "application/json"
              }
            });

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }

            const payload = await response.json();
            const posts = Array.isArray(payload && payload.posts) ? payload.posts : [];
            console.log(`[afterword] fetched ${posts.length} Ghost posts via Content API fallback`);
            return posts;
          } catch (contentError) {
            const contentDetails = contentError && contentError.message ? contentError.message : String(contentError);
            console.warn(`[afterword] Ghost Content API fallback failed. ${contentDetails}`);
          }
        }

        if (contentBase) {
          try {
            return await fetchGhostPostsFromRss(contentBase);
          } catch (rssError) {
            const rssDetails = rssError && rssError.message ? rssError.message : String(rssError);
            console.warn(`[afterword] Ghost RSS fallback failed; continuing with local posts only. ${rssDetails}`);
            return [];
          }
        }

        console.warn("[afterword] Ghost fallback unavailable; missing GHOST_URL and GHOST_ADMIN_URL.");
        return [];
      });
  }

  const posts = await nowPostsPromise;
  const sortedPosts = [...posts].sort(comparePostsDesc);

  console.log(`[afterword] fetched ${sortedPosts.length} Ghost posts for filter ${filter}`);

  if (sortedPosts.length > 0) {
    const visibilityCounts = sortedPosts.reduce((acc, post) => {
      const key = post && post.visibility ? post.visibility : "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    console.log(`[afterword] visibility counts: ${JSON.stringify(visibilityCounts)}`);

    console.log(
      `[afterword] sample posts: ${sortedPosts
        .slice(0, 5)
        .map((post) => `${post.slug}(${post.visibility || "unknown"})`)
        .join(", ")}`
    );

    const latestCandidates = sortedPosts.filter((post) => {
      const excludedTags = ["listening", "now-playing", "books", "now-reading", "gallery", "photos"];
      const hasExcludedTag = excludedTags.some((slug) => postHasTag(post, slug));
      const isUntitledStatus = postHasTag(post, "status") && isUntitledPost(post);
      return !hasExcludedTag && !isUntitledStatus;
    });

    console.log(
      `[afterword] latest candidates: ${latestCandidates
        .slice(0, 10)
        .map((post) => `${post.slug}:${post.title || "(no-title)"}`)
        .join(", ")}`
    );
  }

  return sortedPosts;
}

function getLocalStatusPosts(collectionApi) {
  if (!collectionApi || typeof collectionApi.getFilteredByGlob !== "function") {
    return [];
  }

  return collectionApi
    .getFilteredByGlob("src/status/**/*.md")
    .filter((item) => !(item.fileSlug || "").startsWith("_"))
    .map((item) => createLocalStatusPost(item));
}

function getLocalListeningPosts(collectionApi) {
  if (!collectionApi || typeof collectionApi.getFilteredByGlob !== "function") {
    return [];
  }

  return collectionApi
    .getFilteredByGlob("src/listening-albums/**/*.md")
    .filter((item) => !(item.fileSlug || "").startsWith("_"))
    .map((item) => createLocalListeningPost(item));
}

function getLocalBookPosts(collectionApi) {
  if (!collectionApi || typeof collectionApi.getFilteredByGlob !== "function") {
    return [];
  }

  return collectionApi
    .getFilteredByGlob("src/reading-books/**/*.md")
    .filter((item) => !(item.fileSlug || "").startsWith("_"))
    .map((item) => createLocalBookPost(item));
}

async function getMergedPosts(collectionApi) {
  const ghostPosts = await fetchNowPosts();
  const ghostPostsWithoutListening = ghostPosts.filter((post) => !isListeningPost(post));
  const localStatusPosts = getLocalStatusPosts(collectionApi);
  const localListeningPosts = getLocalListeningPosts(collectionApi);
  const localBookPosts = getLocalBookPosts(collectionApi);
  const mergedBySlug = mergePostsByLocalSlug([
    ...ghostPostsWithoutListening,
    ...localStatusPosts,
    ...localListeningPosts,
    ...localBookPosts
  ]);
  const statusBeforeNormalization = mergedBySlug.filter((post) => postHasTag(post, "status")).length;
  const normalizedPosts = mergedBySlug.map((post) => normalizeStatusLengthForCollections(post));
  const mergedPosts = dedupeBookPosts(dedupeListeningPosts(normalizedPosts)).sort(comparePostsDesc);
  const statusAfterNormalization = normalizedPosts.filter((post) => postHasTag(post, "status")).length;
  const longStatusCount = Math.max(0, statusBeforeNormalization - statusAfterNormalization);

  if (localStatusPosts.length > 0) {
    console.log(
      `[afterword] merged ${localStatusPosts.length} local status markdown post(s) from src/status`
    );
  }

  if (localListeningPosts.length > 0) {
    console.log(
      `[afterword] merged ${localListeningPosts.length} local listening markdown post(s) from src/listening-albums`
    );
  }

  if (localBookPosts.length > 0) {
    console.log(
      `[afterword] merged ${localBookPosts.length} local reading markdown post(s) from src/reading-books`
    );
  }

  if (ghostPosts.length !== ghostPostsWithoutListening.length) {
    console.log(
      `[afterword] excluded ${ghostPosts.length - ghostPostsWithoutListening.length} Ghost listening/now-playing post(s) in favor of local listening sources`
    );
  }

  if (longStatusCount > 0) {
    console.log(
      `[afterword] reclassified ${longStatusCount} status post(s) over ${STATUS_MAX_CHARACTERS} characters into regular posts`
    );
  }

  return mergedPosts;
}

module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(syntaxHighlight);
  eleventyConfig.addPlugin(rssPlugin);
  eleventyConfig.addLayoutAlias("base", "layouts/default.njk");
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });

  eleventyConfig.addFilter("dateReadable", (date) => {
    return new Date(date).toDateString();
  });

  eleventyConfig.addFilter("dateDisplay", (date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "short",
      timeZone: "UTC"
    }).formatToParts(new Date(date));

    const day = parts.find((part) => part.type === "day")?.value || "";
    const month = parts.find((part) => part.type === "month")?.value || "";

    return `${day} ${month}`.trim();
  });

  eleventyConfig.addFilter("dateDisplayWithYear", (date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC"
    }).formatToParts(new Date(date));

    const day = parts.find((part) => part.type === "day")?.value || "";
    const month = parts.find((part) => part.type === "month")?.value || "";
    const year = parts.find((part) => part.type === "year")?.value || "";

    return `${day} ${month} ${year}`.trim();
  });

  eleventyConfig.addFilter("htmlDateString", (dateObj) => {
    return new Date(dateObj).toISOString().split("T")[0];
  });

  eleventyConfig.addFilter("rfc3339Date", (dateObj) => {
    return new Date(dateObj).toISOString();
  });

  eleventyConfig.addFilter("rfc822Date", (dateObj) => {
    return new Date(dateObj).toUTCString();
  });

  eleventyConfig.addFilter("xmlEscape", (value) => {
    return xmlEscape(value);
  });

  eleventyConfig.addFilter("cdataSafe", (value) => {
    return cdataSafe(value);
  });

  eleventyConfig.addFilter("getReadingTime", (html) => {
    const text = String(html || "").replace(/<[^>]*>/g, " ");
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
  });

  eleventyConfig.addFilter("withTagSlug", (posts, slug) => {
    return (posts || []).filter((post) => postHasTag(post, slug));
  });

  eleventyConfig.addFilter("withAnyTagSlugs", (posts, slugs) => {
    const tagSlugs = parseTagSlugs(slugs);
    return (posts || []).filter((post) =>
      tagSlugs.some((slug) => postHasTag(post, slug))
    );
  });

  eleventyConfig.addFilter("withoutTagSlug", (posts, slug) => {
    return (posts || []).filter((post) => !postHasTag(post, slug));
  });

  eleventyConfig.addFilter("withoutAnyTagSlugs", (posts, slugs) => {
    const tagSlugs = parseTagSlugs(slugs);
    return (posts || []).filter(
      (post) => !tagSlugs.some((slug) => postHasTag(post, slug))
    );
  });

  eleventyConfig.addFilter("onlyUntitledPosts", (posts) => {
    return (posts || []).filter((post) => isUntitledPost(post));
  });

  eleventyConfig.addFilter("onlyTitledPosts", (posts) => {
    return (posts || []).filter((post) => !isUntitledPost(post));
  });

  eleventyConfig.addFilter("withoutUntitledStatusPosts", (posts) => {
    return (posts || []).filter((post) => !(postHasTag(post, "status") && isUntitledPost(post)));
  });

  eleventyConfig.addFilter("byPublishedDateDesc", (posts) => {
    return [...(posts || [])].sort(comparePostsDesc);
  });

  eleventyConfig.addFilter("onlyGhostPosts", (posts) => {
    return (posts || []).filter((post) => !isLocalMarkdownPost(post));
  });

  eleventyConfig.addFilter("onlyLocalPosts", (posts) => {
    return (posts || []).filter((post) => isLocalMarkdownPost(post));
  });

  eleventyConfig.addFilter("take", (posts, count = 10) => {
    const limit = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 10;
    return (posts || []).slice(0, limit);
  });

  eleventyConfig.addFilter("hasTagSlug", (post, slug) => {
    return postHasTag(post, slug);
  });

  eleventyConfig.addFilter("feedTitle", (post) => {
    return getStatusLabel(post);
  });

  eleventyConfig.addFilter("localPostUrl", (post) => {
    return getLocalPostUrl(post);
  });

  eleventyConfig.addFilter("localPostSlug", (post) => {
    return getLocalPostSlug(post);
  });

  eleventyConfig.addFilter("statusPreview", (post) => {
    return getStatusPreview(post);
  });

  eleventyConfig.addFilter("mediaCardTitle", (post) => {
    return getMediaCardTitle(post);
  });

  eleventyConfig.addFilter("mediaCardSubtitle", (post) => {
    return getMediaCardSubtitle(post);
  });

  eleventyConfig.addFilter("firstWords", (value, count = 7) => {
    return firstWords(value, count);
  });

  eleventyConfig.addFilter("isUntitledLikeTitle", (value) => {
    return isUntitledLikeTitle(value);
  });

  eleventyConfig.addFilter("rssDescription", (post) => {
    const excerpt = String(post && post.excerpt ? post.excerpt : "").trim();

    if (excerpt) {
      return excerpt;
    }

    return getPlainTextPreview(post, 400);
  });

  eleventyConfig.addFilter("getPreviousPost", (posts, currentPost) => {
    const index = getCollectionIndex(posts, currentPost);
    return index >= 0 ? posts[index + 1] || null : null;
  });

  eleventyConfig.addFilter("getNextPost", (posts, currentPost) => {
    const index = getCollectionIndex(posts, currentPost);
    return index > 0 ? posts[index - 1] || null : null;
  });

  eleventyConfig.addFilter("firstImage", (post) => {
    return extractFirstImage(post);
  });

  eleventyConfig.addFilter("stripFirstImage", (html) => {
    return stripFirstImage(html);
  });

  eleventyConfig.addFilter("feedHtml", (html) => {
    return stripBookmarkCardImages(html);
  });

  eleventyConfig.addCollection("posts", async (collectionApi) => {
    return await getMergedPosts(collectionApi);
  });

  eleventyConfig.addCollection("photoPosts", async (collectionApi) => {
    const posts = await getMergedPosts(collectionApi);

    return posts
      .filter((post) => postHasTag(post, "gallery") || postHasTag(post, "photos"))
      .flatMap((post) =>
        extractAllImages(post).map((image, index) => ({
          ...post,
          image,
          imageIndex: index
        }))
      );
  });

  eleventyConfig.addCollection("bookPosts", async (collectionApi) => {
    const posts = await getMergedPosts(collectionApi);

    return posts
      .filter((post) => postHasTag(post, "books") || postHasTag(post, "now-reading"))
      .map((post) => ({
        ...post,
        firstImage: extractFirstImage(post)
      }))
      .filter((post) => post.firstImage);
  });

  eleventyConfig.addCollection("tagPages", async (collectionApi) => {
    const posts = await getMergedPosts(collectionApi);
    const tags = new Map();

    posts.forEach((post) => {
      (post.tags || []).forEach((tag) => {
        if (!tag || !tag.slug || tag.slug === "now" || tag.visibility === "internal") {
          return;
        }

        if (!tags.has(tag.slug)) {
          tags.set(tag.slug, {
            ...tag,
            url: `/tags/${tag.slug}/`,
            posts: []
          });
        }

        tags.get(tag.slug).posts.push(post);
      });
    });

    return Array.from(tags.values()).sort((a, b) => a.name.localeCompare(b.name));
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site"
    },
    passthroughFileCopy: true
  };
};
