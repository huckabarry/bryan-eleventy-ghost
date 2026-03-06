#!/usr/bin/env node

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const ROOT_DIR = path.resolve(__dirname, "..");
const POSTS_ROOT = path.join(ROOT_DIR, "src", "listening-albums");
const IMAGES_ROOT = path.join(ROOT_DIR, "src", "assets", "listening-images");
const DEFAULT_AUTHOR = "Bryan Robb";
const FEED_URL = "https://albumwhale.com/bryan/listening-now.atom";
const LIST_PAGE_URL = "https://albumwhale.com/bryan/listening-now";

let listPageHtmlCache = null;

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

function escapeYaml(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"");
}

function toIsoDate(value) {
  const parsed = new Date(value || Date.now());
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function dateParts(isoDate) {
  const date = new Date(isoDate);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return { year, month, day };
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

function decodeHtmlEntities(value) {
  const text = String(value == null ? "" : value);
  const named = {
    amp: "&",
    apos: "'",
    quot: "\"",
    lt: "<",
    gt: ">",
    nbsp: " "
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
      return Object.prototype.hasOwnProperty.call(named, key) ? named[key] : match;
    });
}

function extractTag(xml, tagName) {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = String(xml || "").match(re);
  return match ? decodeHtmlEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim()) : "";
}

function extractLinkHref(entry) {
  const match = String(entry || "").match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  return match ? match[1].trim() : "";
}

function parseAtomItems(xml) {
  const entries = String(xml || "").match(/<entry\b[\s\S]*?<\/entry>/gi) || [];

  return entries.map((entry) => {
    const title = extractTag(entry, "title");
    const updated = extractTag(entry, "updated");
    const published = extractTag(entry, "published");
    const link = extractLinkHref(entry);

    return {
      title,
      link,
      date: updated || published || null,
      cover: null
    };
  });
}

function toAbsoluteUrl(url, base) {
  try {
    return new URL(url, base).toString();
  } catch (error) {
    return url || "";
  }
}

function getAlbumAnchorId(link) {
  if (!link) {
    return "";
  }
  const hashIndex = link.indexOf("#");
  if (hashIndex === -1) {
    return "";
  }
  const fragment = link.slice(hashIndex + 1).trim();
  return fragment.startsWith("album_") ? fragment : "";
}

function extractAlbumBlockHtml(listHtml, albumId) {
  if (!listHtml || !albumId) {
    return "";
  }

  const escapedId = albumId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(id=["']${escapedId}["'][\\s\\S]*?)(?=\\bid=["']album_\\d+["']|$)`, "i");
  const match = listHtml.match(re);
  return match && match[1] ? match[1] : "";
}

function extractCoverFromAlbumBlock(blockHtml, pageUrl) {
  if (!blockHtml) {
    return "";
  }

  const imageMatch = blockHtml.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
  if (imageMatch && imageMatch[1]) {
    return toAbsoluteUrl(imageMatch[1], pageUrl);
  }

  const imageAnchor = blockHtml.match(/<a[^>]+href=["']([^"']+)["'][^>]*>\s*Image:/i);
  if (imageAnchor && imageAnchor[1]) {
    return toAbsoluteUrl(imageAnchor[1], pageUrl);
  }

  return "";
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "afterword.blog albumwhale sync script",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.text();
}

async function getListPageHtml() {
  if (listPageHtmlCache) {
    return listPageHtmlCache;
  }
  listPageHtmlCache = await fetchText(LIST_PAGE_URL);
  return listPageHtmlCache;
}

async function fetchAlbumWhale() {
  const feedXml = await fetchText(FEED_URL);
  const albums = parseAtomItems(feedXml);
  const needsScrape = albums.some((item) => !item.cover && getAlbumAnchorId(item.link));
  const listHtml = needsScrape ? await getListPageHtml() : "";

  return albums.map((album) => {
    if (album.cover) {
      return album;
    }
    const albumId = getAlbumAnchorId(album.link);
    if (!albumId || !listHtml) {
      return album;
    }
    const block = extractAlbumBlockHtml(listHtml, albumId);
    const cover = extractCoverFromAlbumBlock(block, LIST_PAGE_URL);
    return {
      ...album,
      cover: cover || null
    };
  });
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
      "User-Agent": "afterword.blog albumwhale sync script"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(destination, buffer);
  return true;
}

function createMarkdown({
  title,
  isoDate,
  slug,
  albumWhaleUrl,
  coverPublicPath,
  albumWhaleOrder
}) {
  const frontMatter = [
    "---",
    `title: "${escapeYaml(title)}"`,
    `date: ${isoDate}`,
    "tags:",
    "  - listening",
    `slug: "${escapeYaml(slug)}"`,
    `author: "${escapeYaml(DEFAULT_AUTHOR)}"`,
    `albumwhale_url: "${escapeYaml(albumWhaleUrl || "")}"`,
    `albumwhale_order: ${Number.isInteger(albumWhaleOrder) ? albumWhaleOrder : 9999}`,
    "---",
    ""
  ];

  const body = [];

  if (coverPublicPath) {
    body.push(`![](${coverPublicPath})`, "");
  }

  if (albumWhaleUrl) {
    body.push(`Listened on [Album Whale](${albumWhaleUrl}).`);
  }

  if (!body.length) {
    body.push("Listening entry.");
  }

  body.push("");
  return frontMatter.concat(body).join("\n");
}

async function main() {
  const albums = await fetchAlbumWhale();

  if (!Array.isArray(albums) || albums.length === 0) {
    console.log("[albumwhale-sync] no entries found");
    return;
  }

  let createdPosts = 0;
  let updatedPosts = 0;
  let downloadedImages = 0;
  let existingImages = 0;
  let failedImages = 0;

  for (const [albumIndex, album] of albums.entries()) {
    const title = String(album && album.title ? album.title : "").trim() || "Untitled album";
    const albumWhaleUrl = String(album && album.link ? album.link : "").trim();
    const isoDate = toIsoDate(album && album.date ? album.date : undefined);
    const { year, month, day } = dateParts(isoDate);
    const slugBase = slugify(title).slice(0, 90) || "album";
    const baseName = `${year}-${month}-${day}-${slugBase}`;

    const postDir = path.join(POSTS_ROOT, year, month);
    await fsp.mkdir(postDir, { recursive: true });
    const postPath = path.join(postDir, `${baseName}.md`);

    let coverPublicPath = "";
    const coverUrl = String(album && album.cover ? album.cover : "").trim();

    if (coverUrl) {
      const hash = crypto.createHash("sha1").update(coverUrl).digest("hex").slice(0, 8);
      const ext = getUrlExtension(coverUrl);
      const imageName = `${baseName}-${hash}${ext}`;
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
        coverPublicPath = `/assets/listening-images/${year}/${imageName}`;
      } catch (error) {
        failedImages += 1;
        console.warn(`[albumwhale-sync] cover download failed for "${title}": ${error.message}`);
      }
    }

    const markdown = createMarkdown({
      title,
      isoDate,
      slug: baseName,
      albumWhaleUrl,
      coverPublicPath,
      albumWhaleOrder: albumIndex
    });

    const alreadyExists = fs.existsSync(postPath);
    const previous = alreadyExists ? await fsp.readFile(postPath, "utf8") : "";

    if (previous !== markdown) {
      await fsp.writeFile(postPath, markdown, "utf8");
      if (alreadyExists) {
        updatedPosts += 1;
      } else {
        createdPosts += 1;
      }
    }
  }

  console.log(
    `[albumwhale-sync] posts created: ${createdPosts}, posts updated: ${updatedPosts}, image downloads: ${downloadedImages}, image already present: ${existingImages}, image download failures: ${failedImages}`
  );
}

main().catch((error) => {
  console.error(`[albumwhale-sync] fatal error: ${error.stack || error.message}`);
  process.exit(1);
});
