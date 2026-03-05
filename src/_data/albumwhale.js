// src/_data/albumwhale.js
// Fetch Bryan's Album Whale "Listening Now" Atom feed and normalize entries for Eleventy.
// - Returns an array of { title, link, date, cover }
// - date is a real JS Date (so your existing dateDisplay/htmlDateString filters behave)

const Parser = require("rss-parser");

const parser = new Parser({
  timeout: 15000
});

module.exports = async function () {
  const feedUrl = "https://albumwhale.com/bryan/listening-now.atom";

  try {
    const feed = await parser.parseURL(feedUrl);

    return (feed.items || [])
      .map((item) => {
        const rawDate = item.isoDate || item.pubDate || null;

        // Covers in Atom feeds can show up in different places depending on the publisher.
        // Album Whale often does not include them, so this may be null.
        const cover =
          item.enclosure?.url ||
          item.itunes?.image ||
          item["media:content"]?.url ||
          item["media:thumbnail"]?.url ||
          null;

        return {
          title: item.title || "",
          link: item.link || "",
          date: rawDate ? new Date(rawDate) : null,
          cover
        };
      })
      // Most recent first, just in case the feed order changes
      .sort((a, b) => {
        const ad = a.date ? a.date.getTime() : 0;
        const bd = b.date ? b.date.getTime() : 0;
        return bd - ad;
      });
  } catch (error) {
    console.warn(`[afterword] Album Whale fetch failed: ${error.message}`);
    return [];
  }
};
