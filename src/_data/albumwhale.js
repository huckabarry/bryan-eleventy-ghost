// src/_data/albumwhale.js
const Parser = require("rss-parser");
const parser = new Parser({
  headers: {
    // Some feed endpoints behave better with an explicit UA
    "User-Agent": "afterword.blog (Eleventy) AlbumWhale fetcher"
  }
});

const FEED_URL = "https://albumwhale.com/bryan/listening-now.atom";

// Simple in-memory cache for a single build run
const coverCache = new Map();

function toAbsoluteUrl(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return url || null;
  }
}

function pickFirstTruthy(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function extractCoverFromHtml(html, pageUrl) {
  if (!html) return null;

  // 1) OpenGraph
  const og =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);

  if (og?.[1]) return toAbsoluteUrl(og[1], pageUrl);

  // 2) Twitter card
  const tw =
    html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);

  if (tw?.[1]) return toAbsoluteUrl(tw[1], pageUrl);

  // 3) Album Whale often includes an "Image: ..." link near the top.
  // Grab the href on the anchor that contains "Image:".
  const imageAnchor =
    html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>\s*Image:/i) ||
    html.match(/>\s*Image:[^<]*<\/a>/i); // fallback marker only

  if (imageAnchor?.[1]) return toAbsoluteUrl(imageAnchor[1], pageUrl);

  // 4) Some pages might include an <img ...> for the artwork
  const img =
    html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);

  if (img?.[1]) return toAbsoluteUrl(img[1], pageUrl);

  return null;
}

async function fetchText(url) {
  // Node 22 has global fetch on Netlify
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "afterword.blog (Eleventy) AlbumWhale cover scraper",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.text();
}

async function getCoverFromAlbumWhalePage(link) {
  if (!link) return null;

  if (coverCache.has(link)) return coverCache.get(link);

  try {
    const html = await fetchText(link);
    const cover = extractCoverFromHtml(html, link);
    coverCache.set(link, cover || null);
    return cover || null;
  } catch (err) {
    // Don’t fail the whole build if Album Whale is flaky.
    coverCache.set(link, null);
    return null;
  }
}

// Small concurrency limiter so you don’t create 50 parallel fetches
async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let i = 0;

  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await mapper(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

module.exports = async function () {
  const feed = await parser.parseURL(FEED_URL);

  const normalizedItems = (feed.items || []).map(item => {
    const title = item.title || "";
    const link = item.link || "";
    const date = item.isoDate || item.pubDate || null;

    // Covers in feeds can show up in different places depending on the publisher.
    const feedCover = pickFirstTruthy(
      item.enclosure?.url,
      item.itunes?.image,
      item["media:content"]?.url,
      item["media:thumbnail"]?.url
    );

    return { title, link, date, cover: feedCover };
  });

  // Fill in missing covers by scraping the album page
  const filled = await mapWithConcurrency(normalizedItems, 4, async (album) => {
    if (album.cover) return album;

    const scrapedCover = await getCoverFromAlbumWhalePage(album.link);
    return {
      ...album,
      cover: scrapedCover
    };
  });

  return filled;
};
