"use strict";

const crypto = require("crypto");

const DEFAULT_MEDIA_DIR = "src/assets/status-images";

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

function extensionFromMime(mime) {
  const normalized = String(mime || "").toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/avif") return "avif";
  return "";
}

function getSiteUrl() {
  const configured = String(process.env.SITE_URL || "").trim() || "https://afterword.blog";
  return /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
}

function getGitHubConfig() {
  const token = String(process.env.GITHUB_TOKEN || "").trim();
  const repo = String(process.env.GITHUB_REPO || "").trim();
  const branch = String(process.env.GITHUB_BRANCH || "main").trim();
  const mediaDir = String(process.env.MICROPUB_MEDIA_DIR || DEFAULT_MEDIA_DIR).trim();

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

  return { ok: true, token, repo, branch, mediaDir };
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

async function commitMediaToGitHub(config, targetPath, contentBase64) {
  const body = {
    message: `micropub: add media ${targetPath.split("/").pop()}`,
    content: contentBase64,
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
}

function parseMultipart(event) {
  const contentType = String(event.headers?.["content-type"] || event.headers?.["Content-Type"] || "");
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) {
    throw new Error("Missing multipart boundary");
  }

  const boundary = boundaryMatch[1].trim().replace(/^"|"$/g, "");
  const rawBuffer = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64")
    : Buffer.from(event.body || "", "utf8");
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = rawBuffer.indexOf(delimiter);

  while (start !== -1) {
    const next = rawBuffer.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const partBuffer = rawBuffer.slice(start + delimiter.length + 2, next - 2); // trim CRLF
    if (partBuffer.length > 0) {
      parts.push(partBuffer);
    }
    start = next;
  }

  for (const part of parts) {
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) continue;

    const rawHeaders = part.slice(0, headerEnd).toString("utf8");
    const body = part.slice(headerEnd + 4);
    const disposition = rawHeaders.match(/content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
    if (!disposition) continue;

    const name = disposition[1];
    const filename = disposition[2] || "";
    const typeMatch = rawHeaders.match(/content-type:\s*([^\r\n]+)/i);
    const mime = typeMatch ? typeMatch[1].trim().toLowerCase() : "application/octet-stream";

    if (name === "file" && filename) {
      return {
        filename,
        mime,
        buffer: body
      };
    }
  }

  throw new Error("No file field found in multipart upload");
}

function sanitizeFilename(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[^A-Za-z0-9._-]/g, "-");
}

function buildMediaTarget(config, upload) {
  const safeName = sanitizeFilename(upload.filename || "");
  const providedStem = safeName.replace(/\.[^.]+$/, "");
  const stem = slugify(providedStem) || `upload-${Date.now()}`;
  const extFromName = (safeName.match(/\.([A-Za-z0-9]+)$/) || [])[1] || "";
  const ext = extFromName.toLowerCase() || extensionFromMime(upload.mime) || "bin";
  const fileName = `${Date.now()}-${stem}.${ext}`;
  const path = `${config.mediaDir.replace(/\/+$/, "")}/${fileName}`;
  const url = `${getSiteUrl().replace(/\/+$/, "")}/${path.replace(/^src\//, "")}`;

  return { path, url };
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = requireAuth(event);
  if (!auth.ok) {
    return json(auth.statusCode, { error: auth.error });
  }

  const contentType = String(event.headers?.["content-type"] || event.headers?.["Content-Type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "multipart/form-data") {
    return json(400, {
      error: "Unsupported content-type. Use multipart/form-data with file field 'file'."
    });
  }

  try {
    const upload = parseMultipart(event);
    const github = getGitHubConfig();
    if (!github.ok) {
      return json(500, { error: github.error });
    }

    const target = buildMediaTarget(github, upload);
    await commitMediaToGitHub(github, target.path, upload.buffer.toString("base64"));

    return noContent(201, { Location: target.url });
  } catch (error) {
    return json(400, { error: error.message });
  }
};
