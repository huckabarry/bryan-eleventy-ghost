"use strict";

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

function requireAuth(event) {
  const expected = String(process.env.MICROPUB_TOKEN || "").trim();
  if (!expected) {
    return { ok: false, statusCode: 500, error: "MICROPUB_TOKEN is not configured" };
  }

  const provided = getBearerToken(event);
  if (!provided || provided !== expected) {
    return { ok: false, statusCode: 401, error: "Unauthorized" };
  }

  return { ok: true };
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

  return {
    action: params.get("action") || "",
    type: params.get("h") || "entry",
    content,
    name,
    published,
    slug,
    tags,
    photos
  };
}

function parseJsonBody(rawBody) {
  const body = JSON.parse(rawBody || "{}");
  const properties = body.properties || {};
  const contentValue = Array.isArray(properties.content) ? properties.content[0] : properties.content;
  const nameValue = Array.isArray(properties.name) ? properties.name[0] : properties.name;
  const publishedValue = Array.isArray(properties.published) ? properties.published[0] : properties.published;
  const slugValue = Array.isArray(properties["mp-slug"])
    ? properties["mp-slug"][0]
    : properties["mp-slug"];
  const categoryValues = Array.isArray(properties.category) ? properties.category : [];
  const photoValues = Array.isArray(properties.photo) ? properties.photo : [];
  const entryType = Array.isArray(body.type) ? body.type[0] : body.type;

  return {
    action: body.action || "",
    type: entryType || "h-entry",
    content: extractString(contentValue),
    name: extractString(nameValue),
    published: extractString(publishedValue),
    slug: extractString(slugValue),
    tags: categoryValues.map((value) => extractString(value)).filter(Boolean),
    photos: photoValues.map((value) => extractString(value)).filter(Boolean)
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
  const baseSlug = slugify(entry.slug || firstWords(entry.name || entry.content || "status", 8)) || "status";
  const title = String(entry.name || "").trim();
  const textBody = String(entry.content || "").trim();
  const imageLines = (entry.photos || []).map((url) => `![status image](${url})`);
  const body = [textBody, ...imageLines].filter(Boolean).join("\n\n").trim();
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

function getSiteUrl() {
  const configured = String(process.env.SITE_URL || "").trim() || "https://afterword.blog";
  return /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
}

exports.handler = async function (event) {
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  if (event.httpMethod === "GET") {
    const query = event.queryStringParameters || {};
    const q = String(query.q || "").trim().toLowerCase();
    const endpoint = `${getSiteUrl().replace(/\/+$/, "")}/micropub`;

    if (q === "config" || !q) {
      return json(200, {
        "post-types": [{ type: "h-entry", name: "Post" }],
        destination: endpoint
      });
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
    if (request.action) {
      return json(400, {
        error: "Only create operations are supported right now (no update/delete yet)."
      });
    }

    const type = String(request.type || "").toLowerCase();
    if (type && type !== "entry" && type !== "h-entry") {
      return json(400, { error: `Unsupported type: ${request.type}` });
    }

    const built = buildMarkdownPost(request);
    const github = getGitHubConfig();
    if (!github.ok) {
      return json(500, { error: github.error });
    }

    await commitStatusToGitHub(github, built);
    const location = `${getSiteUrl().replace(/\/+$/, "")}/${built.slug}/`;

    return noContent(201, {
      Location: location
    });
  } catch (error) {
    return json(400, { error: error.message });
  }
};
