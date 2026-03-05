const Parser = require("rss-parser");
const parser = new Parser();

module.exports = async function () {
  const feed = await parser.parseURL(
    "https://albumwhale.com/bryan/listening-now.atom"
  );

  return feed.items.map(item => ({
    title: item.title || "",
    link: item.link || "",
    date: item.pubDate || item.isoDate || null,

    // Covers in Atom feeds can show up in different places depending on the publisher.
    // Keep this flexible.
    cover:
      item.enclosure?.url ||
      item.itunes?.image ||
      item["media:content"]?.url ||
      null
  }));
};
