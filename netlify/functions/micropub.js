"use strict";

const crypto = require("crypto");

const DEFAULT_STATUS_DIR = "src/status";
const DEFAULT_AUTHOR = "Bryan Robb";

function json(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders
    },
    body: JSON.stringify(payload)
  };
}

function noContent(statusCode, extraHeaders = {}) {
  return {
    statusCode,
    headers: extraHeaders,
    body: ""
  };
}

function getBearerToken(event) {
  const raw = event.headers?.authorization || event.headers?.Authorization || "";
  const match = String(raw).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function b64urlDecode(input) {
  const normalized = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function verifySignedPayload(token, secret) {
  const [encodedPayload, sig] = String(token || "").split(".");
  if (!encodedPayload || !sig || !secret) {
    return null;
  }

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    const payload = JSON.parse(b64urlDecode(encodedPayload));
    if (payload.exp && Math.floor(Date.now() / 1000) > Number(payload.exp)) {
      return null;
    }
    return payload;
  } catch (error) {
    return null;
  }
}

function requireAuth(event) {
  const expected = String(process.env.MICROPUB_TOKEN || "").trim();
  const secret = String(process.env.INDIEAUTH_SECRET || process.env.MICROPUB_TOKEN || "").trim();
  if (!expected && !secret) {
    return { ok: false, statusCode: 500, error: "MICROPUB_TOKEN is not configured" };
  }

  const provided = getBearerToken(event);
  if (!provided) {
    return { ok: false, statusCode: 401, error: "Unauthorized" };
  }

  if (expected && provided === expected) {
    return { ok: true };
  }

  const payload = verifySignedPayload(provided, secret);
  if (payload && payload.t === "access") {
    return { ok: true };
  }

  return { ok: false, statusCode: 401, error: "Unauthorized" };
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

function firstWords(value, count = 8) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, count)
    .join(" ");
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'");
}

function normalizeContentText(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(raw);
  if (!looksLikeHtml) {
    return raw;
  }

  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/^<p[^>]*>/i, "")
    .replace(/<\/p>$/i, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return decodeHtmlEntities(normalized);
}

function normalizeDate(value) {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function uniqueTimestamp(date) {
  const d = new Date(date);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${hh}${mi}${ss}`;
}

function collectSearchParam(params, key) {
  return [...params.getAll(key), ...params.getAll(`${key}[]`)]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function extractString(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    if (typeof value.html === "string") {
      return value.html;
    }
    if (typeof value.value === "string") {
      return value.value;
    }
  }
  return String(value);
}

function normalizeTags(inputTags) {
  const values = Array.isArray(inputTags) ? inputTags : [];
  const normalized = values
    .map((tag) => slugify(tag))
    .filter(Boolean);

  if (!normalized.includes("status")) {
    normalized.unshift("status");
  }

  return [...new Set(normalized)];
}

function parseUrlEncodedBody(rawBody) {
  const params = new URLSearchParams(rawBody || "");
  const content = collectSearchParam(params, "content")[0] || "";
  const name = collectSearchParam(params, "name")[0] || "";
  const published = collectSearchParam(params, "published")[0] || "";
  const slug = collectSearchParam(params, "mp-slug")[0] || collectSearchParam(params, "slug")[0] || "";
  const tags = collectSearchParam(params, "category");
  const photos = collectSearchParam(params, "photo");
  const videos = collectSearchParam(params, "video");
  const photoAlts = collectSearchParam(params, "mp-photo-alt");
  const videoAlts = collectSearchParam(params, "mp-video-alt");
  const updateContent = collectSearchParam(params, "replace[content]")[0] || "";
  const updateName = collectSearchParam(params, "replace[name]")[0] || "";
  const updateStatus = collectSearchParam(params, "replace[post-status]")[0] || "";
  const updateUrl = collectSearchParam(params, "url")[0] || "";

  return {
    action: params.get("action") || "",
    url: updateUrl,
    type: params.get("h") || "entry",
    content,
    name,
    published,
    slug,
    tags,
    photos,
    videos,
    photoAlts,
    videoAlts,
    replace: {
      name: updateName,
      content: updateContent,
      postStatus: updateStatus
    }
  };
}

function collectObjectValues(properties, key) {
  const value = properties?.[key];
  if (Array.isArray(value)) {
    return value.map((item) => extractString(item)).filter(Boolean);
  }
  if (value != null) {
    const stringValue = extractString(value);
    return stringValue ? [stringValue] : [];
  }
  return [];
}

function readReplaceString(replace, key) {
  if (!replace || typeof replace !== "object") {
    return "";
  }
  const value = replace[key];
  if (Array.isArray(value)) {
    return extractString(value[0]);
  }
  return extractString(value);
}

function parseJsonBody(rawBody) {
  const body = JSON.parse(rawBody || "{}");
  const properties = body.properties || {};
  const contentValue = collectObjectValues(properties, "content")[0];
  const nameValue = collectObjectValues(properties, "name")[0];
  const publishedValue = collectObjectValues(properties, "published")[0];
  const slugValue = collectObjectValues(properties, "mp-slug")[0];
  const categoryValues = collectObjectValues(properties, "category");
  const photoValues = collectObjectValues(properties, "photo");
  const videoValues = collectObjectValues(properties, "video");
  const photoAltValues = collectObjectValues(properties, "mp-photo-alt");
  const videoAltValues = collectObjectValues(properties, "mp-video-alt");
  const entryType = Array.isArray(body.type) ? body.type[0] : body.type;
  const replace = body.replace || {};

  return {
    action: body.action || "",
    url: extractString(body.url),
    type: entryType || "h-entry",
    content: extractString(contentValue),
    name: extractString(nameValue),
    published: extractString(publishedValue),
    slug: extractString(slugValue),
    tags: categoryValues,
    photos: photoValues,
    videos: videoValues,
    photoAlts: photoAltValues,
    videoAlts: videoAltValues,
    replace: {
      name: readReplaceString(replace, "name"),
      content: readReplaceString(replace, "content"),
      postStatus: readReplaceString(replace, "post-status")
    }
  };
}

function parseMicropubRequest(event) {
  const contentType = String(event.headers?.["content-type"] || event.headers?.["Content-Type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType === "application/json") {
    return parseJsonBody(event.body);
  }

  if (contentType === "application/x-www-form-urlencoded" || !contentType) {
    return parseUrlEncodedBody(event.body);
  }

  if (contentType === "multipart/form-data") {
    throw new Error("multipart/form-data is not supported yet. Use photo URLs for now.");
  }

  throw new Error(`Unsupported content-type: ${contentType}`);
}

function buildMarkdownPost(entry) {
  const publishedAt = normalizeDate(entry.published);
  const tags = normalizeTags(entry.tags);
  const normalizedContent = normalizeContentText(entry.content);
  const baseSlug = slugify(entry.slug || firstWords(entry.name || normalizedContent || "status", 8)) || "status";
  const title = String(entry.name || "").trim();
  const textBody = normalizedContent;
  const imageLines = (entry.photos || []).map((url, index) => {
    const alt = String(entry.photoAlts?.[index] || "").trim();
    return `![${alt || "status image"}](${url})`;
  });
  const videoLines = (entry.videos || []).map((url, index) => {
    const alt = String(entry.videoAlts?.[index] || "").trim();
    return `[${alt || "status video"}](${url})`;
  });
  const body = [textBody, ...imageLines, ...videoLines].filter(Boolean).join("\n\n").trim();
  const finalBody = body || "Status update.";

  const fileName = `${uniqueTimestamp(publishedAt)}-${baseSlug}.md`;
  const frontMatter = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `date: ${publishedAt}`,
    "tags:",
    ...tags.map((tag) => `  - ${tag}`),
    `slug: ${JSON.stringify(baseSlug)}`,
    `author: ${JSON.stringify(DEFAULT_AUTHOR)}`,
    "---",
    "",
    finalBody
  ].join("\n");

  return {
    slug: baseSlug,
    fileName,
    markdown: frontMatter
  };
}

function getGitHubConfig() {
  const token = String(process.env.GITHUB_TOKEN || "").trim();
  const repo = String(process.env.GITHUB_REPO || "").trim(); // owner/repo
  const branch = String(process.env.GITHUB_BRANCH || "main").trim();
  const statusDir = String(process.env.MICROPUB_STATUS_DIR || DEFAULT_STATUS_DIR).trim();

  if (!token || !repo) {
    return {
      ok: false,
      error: "GITHUB_TOKEN and GITHUB_REPO must be configured"
    };
  }

  if (!/^[^/]+\/[^/]+$/.test(repo)) {
    return {
      ok: false,
      error: "GITHUB_REPO must be in the format owner/repo"
    };
  }

  return { ok: true, token, repo, branch, statusDir };
}

async function githubRequest(path, options) {
  const response = await fetch(`https://api.github.com${path}`, options);
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = { raw: text };
  }

  return { ok: response.ok, status: response.status, data };
}

async function commitStatusToGitHub(config, built) {
  const targetPath = `${config.statusDir.replace(/\/+$/, "")}/${built.fileName}`;
  const body = {
    message: `micropub: add status ${built.slug}`,
    content: Buffer.from(built.markdown, "utf8").toString("base64"),
    branch: config.branch
  };

  const result = await githubRequest(
    `/repos/${config.repo}/contents/${encodeURIComponent(targetPath).replace(/%2F/g, "/")}`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${config.token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  if (!result.ok) {
    const errorMessage = result.data?.message || "GitHub write failed";
    throw new Error(`${errorMessage} (status ${result.status})`);
  }

  return result.data;
}

function decodeGitHubContent(rawContent) {
  return Buffer.from(String(rawContent || "").replace(/\n/g, ""), "base64").toString("utf8");
}

async function fetchGitHubFile(config, path) {
  const result = await githubRequest(
    `/repos/${config.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(config.branch)}`,
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${config.token}`,
        accept: "application/vnd.github+json"
      }
    }
  );

  if (!result.ok || !result.data?.content || !result.data?.sha) {
    const message = result.data?.message || "Unable to fetch existing status file";
    throw new Error(`${message} (status ${result.status})`);
  }

  return {
    path,
    sha: result.data.sha,
    content: decodeGitHubContent(result.data.content)
  };
}

async function listStatusFiles(config) {
  const root = config.statusDir.replace(/\/+$/, "");
  const result = await githubRequest(
    `/repos/${config.repo}/contents/${encodeURIComponent(root).replace(/%2F/g, "/")}?ref=${encodeURIComponent(config.branch)}`,
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${config.token}`,
        accept: "application/vnd.github+json"
      }
    }
  );

  if (!result.ok || !Array.isArray(result.data)) {
    const message = result.data?.message || "Unable to list status directory";
    throw new Error(`${message} (status ${result.status})`);
  }

  return result.data
    .filter((item) => item?.type === "file" && /\.md$/i.test(item?.name || ""))
    .map((item) => item.name);
}

function parseFrontMatter(markdown) {
  const raw = String(markdown || "");
  const lines = raw.split("\n");
  const result = {
    title: "",
    date: "",
    tags: ["status"],
    slug: "",
    author: DEFAULT_AUTHOR,
    body: ""
  };

  if (lines[0] !== "---") {
    result.body = raw.trim();
    return result;
  }

  let i = 1;
  let inTags = false;
  const tags = [];

  while (i < lines.length) {
    const line = lines[i];
    if (line === "---") {
      i += 1;
      break;
    }

    if (/^\s*tags:\s*$/.test(line)) {
      inTags = true;
      i += 1;
      continue;
    }

    if (inTags && /^\s*-\s+/.test(line)) {
      tags.push(line.replace(/^\s*-\s+/, "").trim());
      i += 1;
      continue;
    }

    inTags = false;
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (match) {
      const key = match[1];
      const value = match[2];
      if (key === "title") result.title = safeJsonValue(value);
      if (key === "date") result.date = String(value || "").trim();
      if (key === "slug") result.slug = safeJsonValue(value);
      if (key === "author") result.author = safeJsonValue(value) || DEFAULT_AUTHOR;
    }
    i += 1;
  }

  result.tags = normalizeTags(tags.length > 0 ? tags : ["status"]);
  result.body = lines.slice(i).join("\n").trim();
  return result;
}

function safeJsonValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    try {
      return JSON.parse(text.replace(/^'|'$/g, "\""));
    } catch (error) {
      return text.slice(1, -1);
    }
  }
  return text;
}

function extractGeneratedMedia(body) {
  const lines = String(body || "").split("\n");
  const photos = [];
  const photoAlts = [];
  const videos = [];
  const videoAlts = [];
  const textLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const photoMatch = trimmed.match(/^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/i);
    if (photoMatch) {
      photos.push(photoMatch[2]);
      photoAlts.push(photoMatch[1]);
      continue;
    }

    const videoMatch = trimmed.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/i);
    if (videoMatch) {
      videos.push(videoMatch[2]);
      videoAlts.push(videoMatch[1]);
      continue;
    }

    textLines.push(line);
  }

  return {
    text: textLines.join("\n").trim(),
    photos,
    photoAlts,
    videos,
    videoAlts
  };
}

function renderMarkdown(meta) {
  const body = String(meta.body || "").trim();
  return [
    "---",
    `title: ${JSON.stringify(meta.title || "")}`,
    `date: ${normalizeDate(meta.date)}`,
    "tags:",
    ...normalizeTags(meta.tags).map((tag) => `  - ${tag}`),
    `slug: ${JSON.stringify(meta.slug || "status")}`,
    `author: ${JSON.stringify(meta.author || DEFAULT_AUTHOR)}`,
    "---",
    "",
    body || "Status update."
  ].join("\n");
}

async function updateStatusInGitHub(config, targetPath, currentSha, markdown, slug) {
  const body = {
    message: `micropub: update status ${slug || "status"}`,
    content: Buffer.from(markdown, "utf8").toString("base64"),
    branch: config.branch,
    sha: currentSha
  };

  const result = await githubRequest(
    `/repos/${config.repo}/contents/${encodeURIComponent(targetPath).replace(/%2F/g, "/")}`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${config.token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  if (!result.ok) {
    const errorMessage = result.data?.message || "GitHub update failed";
    throw new Error(`${errorMessage} (status ${result.status})`);
  }
}

async function resolveStatusFileFromUrl(config, urlValue) {
  const url = new URL(String(urlValue || ""));
  const slug = slugify(url.pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop() || "");
  if (!slug) {
    throw new Error("Could not resolve slug from update URL");
  }

  const files = await listStatusFiles(config);
  const candidates = files
    .filter((name) => name.toLowerCase().endsWith(`-${slug}.md`))
    .sort();
  if (candidates.length === 0) {
    throw new Error(`No status markdown file found for slug: ${slug}`);
  }

  const latest = candidates[candidates.length - 1];
  return {
    slug,
    path: `${config.statusDir.replace(/\/+$/, "")}/${latest}`
  };
}

function applyMicropubUpdate(existingMarkdown, request) {
  const current = parseFrontMatter(existingMarkdown);
  const existingMedia = extractGeneratedMedia(current.body);
  const replacedText = normalizeContentText(request.replace?.content || "");
  const nextText = replacedText || existingMedia.text;
  const hasIncomingPhotos = Array.isArray(request.photos) && request.photos.length > 0;
  const hasIncomingVideos = Array.isArray(request.videos) && request.videos.length > 0;
  const nextPhotos = hasIncomingPhotos ? request.photos : existingMedia.photos;
  const nextPhotoAlts = hasIncomingPhotos ? request.photoAlts || [] : existingMedia.photoAlts;
  const nextVideos = hasIncomingVideos ? request.videos : existingMedia.videos;
  const nextVideoAlts = hasIncomingVideos ? request.videoAlts || [] : existingMedia.videoAlts;

  const imageLines = (nextPhotos || []).map((photo, index) => {
    const alt = String(nextPhotoAlts?.[index] || "").trim();
    return `![${alt || "status image"}](${photo})`;
  });
  const videoLines = (nextVideos || []).map((video, index) => {
    const alt = String(nextVideoAlts?.[index] || "").trim();
    return `[${alt || "status video"}](${video})`;
  });

  const mergedBody = [nextText, ...imageLines, ...videoLines].filter(Boolean).join("\n\n").trim();
  const nextTitle = String(request.replace?.name || current.title || "").trim();
  const statusValue = String(request.replace?.postStatus || "").trim().toLowerCase();
  const nextTags = normalizeTags(current.tags);
  if (statusValue === "draft" && !nextTags.includes("draft")) {
    nextTags.push("draft");
  }
  if (statusValue === "published") {
    const withoutDraft = nextTags.filter((tag) => tag !== "draft");
    nextTags.length = 0;
    nextTags.push(...withoutDraft);
  }

  return renderMarkdown({
    title: nextTitle,
    date: current.date,
    tags: nextTags,
    slug: current.slug || slugify(firstWords(nextText || nextTitle || "status", 8)) || "status",
    author: current.author || DEFAULT_AUTHOR,
    body: mergedBody
  });
}

function getSiteUrl() {
  const configured = String(process.env.SITE_URL || "").trim() || "https://afterword.blog";
  return /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
}

function getMicropubConfig() {
  return {
    "post-types": [
      {
        type: "h-entry",
        name: "Note",
        properties: ["content"]
      },
      {
        type: "h-entry",
        name: "Photo",
        properties: ["photo", "content"]
      },
      {
        type: "h-entry",
        name: "Article",
        properties: ["name", "content"]
      }
    ],
    destination: `${getSiteUrl().replace(/\/+$/, "")}/micropub`,
    "media-endpoint": `${getSiteUrl().replace(/\/+$/, "")}/micropub/media`
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  if (event.httpMethod === "GET") {
    const query = event.queryStringParameters || {};
    const q = String(query.q || "").trim().toLowerCase();

    if (q === "config" || !q) {
      return json(200, getMicropubConfig());
    }

    if (q === "post-types") {
      return json(200, { "post-types": getMicropubConfig()["post-types"] });
    }

    if (q === "syndicate-to") {
      return json(200, { "syndicate-to": [] });
    }

    return json(400, { error: `Unsupported query: ${q}` });
  }

  const auth = requireAuth(event);
  if (!auth.ok) {
    return json(auth.statusCode, { error: auth.error });
  }

  try {
    const request = parseMicropubRequest(event);
    const action = String(request.action || "").trim().toLowerCase();
    if (action && action !== "update") {
      return json(400, {
        error: `Unsupported action: ${request.action}`
      });
    }

    const github = getGitHubConfig();
    if (!github.ok) {
      return json(500, { error: github.error });
    }

    if (action === "update") {
      if (!request.url) {
        return json(400, { error: "Missing url for action=update" });
      }
      const target = await resolveStatusFileFromUrl(github, request.url);
      const existing = await fetchGitHubFile(github, target.path);
      const updatedMarkdown = applyMicropubUpdate(existing.content, request);
      await updateStatusInGitHub(github, target.path, existing.sha, updatedMarkdown, target.slug);
      return noContent(204);
    }

    const type = String(request.type || "").toLowerCase();
    if (type && type !== "entry" && type !== "h-entry") {
      return json(400, { error: `Unsupported type: ${request.type}` });
    }

    const built = buildMarkdownPost(request);
    await commitStatusToGitHub(github, built);
    const location = `${getSiteUrl().replace(/\/+$/, "")}/${built.slug}/`;

    return noContent(201, {
      Location: location
    });
  } catch (error) {
    return json(400, { error: error.message });
  }
};
