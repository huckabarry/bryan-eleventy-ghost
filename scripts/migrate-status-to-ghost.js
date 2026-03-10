#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_SITE_URL = "https://afterword.blog";
const STATUS_ROOT = path.join(process.cwd(), "src", "status");
const CHECKPOINT_PATH = path.join(
  process.cwd(),
  ".cache",
  "ghost-status-migration-checkpoint.json"
);

function parseArgs(argv) {
  const args = {
    apply: false,
    since: null,
    limit: null,
    checkpoint: CHECKPOINT_PATH,
    siteUrl: process.env.GHOST_ADMIN_URL || DEFAULT_SITE_URL,
    tags: ["status", "afterword"],
    visibility: "paid",
    updateExisting: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--since") args.since = argv[i + 1];
    else if (arg === "--limit") args.limit = Number(argv[i + 1]);
    else if (arg === "--checkpoint") args.checkpoint = argv[i + 1];
    else if (arg === "--site-url") args.siteUrl = argv[i + 1];
    else if (arg === "--update-existing") args.updateExisting = true;
  }

  return args;
}

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function loadCheckpoint(filePath) {
  if (!fs.existsSync(filePath)) {
    return { uploaded: {}, skippedExisting: {}, failed: {} };
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function saveCheckpoint(filePath, data) {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function toBase64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signAdminJwt(adminApiKey) {
  const [id, secretHex] = adminApiKey.split(":");
  if (!id || !secretHex) {
    throw new Error("Invalid GHOST_ADMIN_API_KEY format. Expected <id>:<secret>.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: id }));
  const payload = toBase64Url(
    JSON.stringify({
      iat: now - 5,
      exp: now + 5 * 60,
      aud: "/admin/",
    })
  );
  const unsigned = `${header}.${payload}`;
  const signature = crypto
    .createHmac("sha256", Buffer.from(secretHex, "hex"))
    .update(unsigned)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${unsigned}.${signature}`;
}

function parseFrontMatter(raw) {
  if (!raw.startsWith("---\n")) {
    return { data: {}, body: raw };
  }
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) {
    return { data: {}, body: raw };
  }

  const fm = raw.slice(4, end);
  const body = raw.slice(end + 5);
  const lines = fm.split("\n");
  const data = {};
  let currentListKey = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && currentListKey) {
      if (!Array.isArray(data[currentListKey])) data[currentListKey] = [];
      data[currentListKey].push(stripQuotes(listItem[1].trim()));
      continue;
    }

    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;
    const key = pair[1];
    const value = pair[2];
    if (value === "") {
      currentListKey = key;
      if (!Array.isArray(data[key])) data[key] = [];
    } else {
      currentListKey = null;
      data[key] = stripQuotes(value.trim());
    }
  }

  return { data, body };
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "_template.md") {
      files.push(fullPath);
    }
  }
  return files;
}

function collectCandidateFiles(statusRoot, sinceDate) {
  const years = [];
  const currentYear = new Date().getFullYear();
  for (let y = sinceDate.getFullYear(); y <= currentYear; y += 1) years.push(String(y));

  const files = [];
  for (const year of years) {
    const yearDir = path.join(statusRoot, year);
    if (fs.existsSync(yearDir) && fs.statSync(yearDir).isDirectory()) {
      files.push(...walkFiles(yearDir));
    }
  }

  const topLevel = fs.readdirSync(statusRoot, { withFileTypes: true });
  for (const entry of topLevel) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;
    if (entry.name === "_template.md") continue;
    const yearPrefix = entry.name.slice(0, 4);
    if (/^\d{4}$/.test(yearPrefix) && Number(yearPrefix) >= sinceDate.getFullYear()) {
      files.push(path.join(statusRoot, entry.name));
    }
  }

  return Array.from(new Set(files));
}

function deriveSlug(filePath, frontmatterSlug) {
  if (frontmatterSlug && frontmatterSlug.trim()) return frontmatterSlug.trim();
  const name = path.basename(filePath, ".md");
  const withoutDate = name
    .replace(/^\d{4}-\d{2}-\d{2}-\d{6}-/, "")
    .replace(/^\d{4}-\d{2}-\d{2}-/, "");
  return withoutDate;
}

function deriveTitle(frontmatterTitle, slug, body) {
  if (frontmatterTitle && frontmatterTitle.trim()) return frontmatterTitle.trim();
  if (slug && slug.trim()) return slugToTitle(slug.trim());
  const first = body.trim().split(/\s+/).slice(0, 8).join(" ");
  return first || "Status";
}

function slugToTitle(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatInline(text) {
  let out = escapeHtml(text);
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<img alt="$1" src="$2" />');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<a href="$2">$1</a>');
  out = out.replace(
    /(^|[\s(])((https?:\/\/|mailto:)[^\s<]+[^\s<.,:;"')\]])/g,
    '$1<a href="$2">$2</a>'
  );
  return out;
}

function markdownToHtml(markdown) {
  const text = markdown.replace(/\r\n/g, "\n").trim();
  if (!text) return "<p></p>";
  const blocks = text.split(/\n\s*\n/);
  const html = blocks
    .map((block) => {
      const line = block.trim();
      if (line.startsWith("![")) {
        return formatInline(line);
      }
      return `<p>${formatInline(line).replace(/\n/g, "<br />")}</p>`;
    })
    .join("\n");
  return html;
}

function resolveLocalImagePath(src) {
  const normalized = src.trim();
  if (normalized.startsWith("/assets/status-images/")) {
    return path.join(process.cwd(), "src", normalized.replace(/^\//, ""));
  }
  if (normalized.startsWith("assets/status-images/")) {
    return path.join(process.cwd(), "src", normalized);
  }
  return null;
}

async function ghostFetch({ siteUrl, adminApiKey, endpoint, method = "GET", body = null }) {
  const base = siteUrl.replace(/\/+$/, "");
  const url = `${base}/ghost/api/admin${endpoint}`;
  const token = signAdminJwt(adminApiKey);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Ghost ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ghost API ${method} ${endpoint} failed (${res.status}): ${text}`);
  }

  return res.json();
}

async function ghostUploadImage({ siteUrl, adminApiKey, localPath, ref }) {
  const base = siteUrl.replace(/\/+$/, "");
  const url = `${base}/ghost/api/admin/images/upload/`;
  const token = signAdminJwt(adminApiKey);
  const data = fs.readFileSync(localPath);
  const ext = path.extname(localPath).toLowerCase();
  const mimeByExt = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
  };
  const mime = mimeByExt[ext] || "application/octet-stream";
  const form = new FormData();
  form.append("file", new Blob([data], { type: mime }), path.basename(localPath));
  form.append("ref", ref || localPath);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Ghost ${token}`,
    },
    body: form,
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ghost image upload failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  return json.images?.[0]?.url || null;
}

async function rewriteAndUploadImages({ html, siteUrl, adminApiKey, checkpoint, relPath }) {
  const matches = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)];
  if (matches.length === 0) return html;

  let updated = html;
  checkpoint.imageUploads = checkpoint.imageUploads || {};
  for (const match of matches) {
    const src = match[1];
    const localPath = resolveLocalImagePath(src);
    if (!localPath || !fs.existsSync(localPath)) continue;

    let hostedUrl = checkpoint.imageUploads[localPath];
    if (!hostedUrl) {
      hostedUrl = await ghostUploadImage({
        siteUrl,
        adminApiKey,
        localPath,
        ref: `${relPath}:${path.basename(localPath)}`,
      });
      if (!hostedUrl) continue;
      checkpoint.imageUploads[localPath] = hostedUrl;
    }

    updated = updated.split(`src="${src}"`).join(`src="${hostedUrl}"`);
  }
  return updated;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function oneYearAgoIso() {
  const now = new Date();
  const d = new Date(now);
  d.setFullYear(now.getFullYear() - 1);
  return d.toISOString();
}

function normalizeDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const adminApiKey = process.env.GHOST_ADMIN_API_KEY;
  if (!adminApiKey) {
    throw new Error("Missing GHOST_ADMIN_API_KEY environment variable.");
  }

  const sinceDate = normalizeDate(args.since || oneYearAgoIso());
  if (!sinceDate) {
    throw new Error(`Invalid --since value: ${args.since}`);
  }

  const checkpoint = loadCheckpoint(args.checkpoint);

  console.log(`Scanning status files under ${STATUS_ROOT} ...`);
  const files = collectCandidateFiles(STATUS_ROOT, sinceDate);
  console.log(`Found ${files.length} markdown files. Parsing front matter/date filter ...`);
  const candidates = [];

  let parsedCount = 0;
  for (const filePath of files) {
    parsedCount += 1;
    if (parsedCount % 20 === 0) {
      console.log(`Parsed ${parsedCount}/${files.length} files ...`);
    }
    const relPath = path.relative(process.cwd(), filePath);
    const raw = fs.readFileSync(filePath, "utf8");
    const { data, body } = parseFrontMatter(raw);
    const postDate = normalizeDate(data.date);
    if (!postDate) continue;
    if (postDate < sinceDate) continue;

    candidates.push({
      filePath,
      relPath,
      date: postDate,
      slug: deriveSlug(filePath, data.slug),
      title: deriveTitle(data.title, deriveSlug(filePath, data.slug), body),
      html: markdownToHtml(body),
    });
  }

  candidates.sort((a, b) => a.date - b.date);
  const selected = args.limit ? candidates.slice(0, args.limit) : candidates;

  console.log(
    `Found ${candidates.length} status file(s) since ${sinceDate.toISOString()}. Processing ${selected.length}.`
  );
  console.log(
    `Mode: ${args.apply ? "APPLY (live upload)" : "DRY RUN"} | Visibility: ${args.visibility} | Tags: ${args.tags.join(", ")}`
  );

  let uploaded = 0;
  let skippedExisting = 0;
  let skippedCheckpoint = 0;
  let failed = 0;

  for (const post of selected) {
    if (checkpoint.uploaded[post.relPath] || checkpoint.skippedExisting[post.relPath]) {
      skippedCheckpoint += 1;
      continue;
    }

    try {
      const slugFilter = encodeURIComponent(`slug:${post.slug}`);
      const existing = await ghostFetch({
        siteUrl: args.siteUrl,
        adminApiKey,
        endpoint: `/posts/?limit=1&formats=html&filter=${slugFilter}`,
      });
      if (existing.posts && existing.posts.length > 0) {
        if (!args.apply || !args.updateExisting) {
          checkpoint.skippedExisting[post.relPath] = {
            slug: post.slug,
            existingId: existing.posts[0].id,
          };
          skippedExisting += 1;
          saveCheckpoint(args.checkpoint, checkpoint);
          console.log(`SKIP existing slug: ${post.slug} (${post.relPath})`);
          continue;
        }

        let updatedHtml = await rewriteAndUploadImages({
          html: post.html,
          siteUrl: args.siteUrl,
          adminApiKey,
          checkpoint,
          relPath: post.relPath,
        });
        const current = existing.posts[0];
        if (current.html && current.html.trim()) {
          // Keep existing Ghost content if local body is empty.
          updatedHtml = updatedHtml.trim() ? updatedHtml : current.html;
        }
        const updatePayload = {
          posts: [
            {
              id: current.id,
              updated_at: current.updated_at,
              title: post.title,
              slug: post.slug,
              html: updatedHtml,
              status: "published",
              visibility: args.visibility,
              tags: args.tags.map((name) => ({ name })),
              published_at: post.date.toISOString(),
            },
          ],
        };
        const updatedPost = await ghostFetch({
          siteUrl: args.siteUrl,
          adminApiKey,
          endpoint: `/posts/${current.id}/?source=html`,
          method: "PUT",
          body: updatePayload,
        });
        checkpoint.uploaded[post.relPath] = {
          id: updatedPost.posts[0].id,
          slug: updatedPost.posts[0].slug,
          published_at: updatedPost.posts[0].published_at,
          updated: true,
        };
        uploaded += 1;
        saveCheckpoint(args.checkpoint, checkpoint);
        console.log(`UPD   ${updatedPost.posts[0].slug} (${post.relPath})`);
        await sleep(150);
        continue;
      }

      if (!args.apply) {
        console.log(`DRY  ${post.date.toISOString()} ${post.slug} (${post.relPath})`);
        continue;
      }

      const htmlWithHostedImages = await rewriteAndUploadImages({
        html: post.html,
        siteUrl: args.siteUrl,
        adminApiKey,
        checkpoint,
        relPath: post.relPath,
      });

      const payload = {
        posts: [
          {
            title: post.title,
            slug: post.slug,
            html: htmlWithHostedImages,
            status: "published",
            visibility: args.visibility,
            tags: args.tags.map((name) => ({ name })),
            published_at: post.date.toISOString(),
          },
        ],
      };

      const created = await ghostFetch({
        siteUrl: args.siteUrl,
        adminApiKey,
        endpoint: "/posts/?source=html",
        method: "POST",
        body: payload,
      });

      checkpoint.uploaded[post.relPath] = {
        id: created.posts[0].id,
        slug: created.posts[0].slug,
        published_at: created.posts[0].published_at,
      };
      uploaded += 1;
      saveCheckpoint(args.checkpoint, checkpoint);
      console.log(`OK    ${created.posts[0].slug} (${post.relPath})`);
      await sleep(150);
    } catch (err) {
      checkpoint.failed[post.relPath] = {
        slug: post.slug,
        error: String(err.message || err),
      };
      failed += 1;
      saveCheckpoint(args.checkpoint, checkpoint);
      console.error(`FAIL  ${post.slug} (${post.relPath})`);
      console.error(`      ${err.message || err}`);
    }
  }

  console.log("");
  console.log("Migration complete.");
  console.log(`Uploaded: ${uploaded}`);
  console.log(`Skipped (already in Ghost): ${skippedExisting}`);
  console.log(`Skipped (checkpoint): ${skippedCheckpoint}`);
  console.log(`Failed: ${failed}`);
  console.log(`Checkpoint: ${args.checkpoint}`);
}

run().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
