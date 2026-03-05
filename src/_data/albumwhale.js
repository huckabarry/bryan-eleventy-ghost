// src/_data/albumwhale.js
const Parser = require("rss-parser");
const parser = new Parser({
  headers: {
    "User-Agent": "afterword.blog (Eleventy) AlbumWhale fetcher"
  }
});

const FEED_URL = "https://albumwhale.com/bryan/listening-now.atom";
const LIST_PAGE_URL = "https://albumwhale.com/bryan/listening-now";

// One-build caches
let listPageHtmlCache = null;

function pickFirstTruthy(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function toAbsoluteUrl(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return url || null;
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "afterword.blog (Eleventy) AlbumWhale cover scraper",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Pull "album_68569" from "...#album_68569"
function getAlbumAnchorId(link) {
  if (!link) return null;
  const hashIndex = link.indexOf("#");
  if (hashIndex === -1) return null;
  const fragment = link.slice(hashIndex + 1).trim();
  // Album Whale uses ids like album_12345
  return fragment.startsWith("album_") ? fragment : null;
}

// Extract the HTML for one album block by id="album_12345"
function extractAlbumBlockHtml(listHtml, albumId) {
  if (!listHtml || !albumId) return null;

  // Try id="album_12345" (common) and id='album_12345'
  const idPattern = albumId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escape
  const re = new RegExp(
    `(id=["']${idPattern}["'][\\s\\S]*?)(?=\\bid=["']album_\\d+["']|$)`,
    "i"
  );

  const match = listHtml.match(re);
  return match?.[1] ? match[1] : null;
}

function extractCoverFromAlbumBlock(blockHtml, pageUrl) {
  if (!blockHtml) return null;

  // Prefer an actual <img ...> inside the album block
  // (This tends to be the artwork thumbnail/cover)
  const img = blockHtml.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
  if (img?.[1]) return toAbsoluteUrl(img[1], pageUrl);

  // Or an "Image:" link if present
  const imageAnchor = blockHtml.match(/<a[^>]+href=["']([^"']+)["'][^>]*>\s*Image:/i);
  if (imageAnchor?.[1]) return toAbsoluteUrl(imageAnchor[1], pageUrl);

  return null;
}

async function getListPageHtml() {
  if (listPageHtmlCache) return listPageHtmlCache;
  listPageHtmlCache = await fetchText(LIST_PAGE_URL);
  return listPageHtmlCache;
}

module.exports = async function () {
  const feed = await parser.parseURL(FEED_URL);

  const items = (feed.items || []).map((item) => {
    const title = item.title || "";
    const link = item.link || "";
    const date = item.isoDate || item.pubDate || null;

    // Sometimes the feed provides a cover, but Album Whale often doesn’t.
    const feedCover = pickFirstTruthy(
      item.enclosure?.url,
      item.itunes?.image,
      item["media:content"]?.url,
      item["media:thumbnail"]?.url
    );

    return { title, link, date, cover: feedCover };
  });

  // Only fetch/scrape the list page if we need covers.
  const needsScrape = items.some((a) => !a.cover && getAlbumAnchorId(a.link));
  const listHtml = needsScrape ? await getListPageHtml() : null;

  const filled = items.map((album) => {
    if (album.cover) return album;

    const albumId = getAlbumAnchorId(album.link);
    if (!albumId || !listHtml) return album;

    const block = extractAlbumBlockHtml(listHtml, albumId);
    const cover = extractCoverFromAlbumBlock(block, LIST_PAGE_URL);

    return { ...album, cover: cover || null };
  });

  return filled;
};
