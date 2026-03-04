const GhostContentAPI = require("@tryghost/content-api");
const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
const rssPlugin = require("@11ty/eleventy-plugin-rss");
const ghostApi = new GhostContentAPI({
  url: process.env.GHOST_URL,
  key: process.env.GHOST_CONTENT_API_KEY,
  version: "v5.71"
});

async function fetchNowPosts() {
  const posts = await ghostApi.posts.browse({
    include: "tags,authors",
    limit: 100,
    filter: "tag:now"
  });

  console.log(
    `[afterword] fetched ${posts.length} Ghost posts for filter tag:now`
  );

  if (posts.length > 0) {
    console.log(
      `[afterword] sample posts: ${posts
        .slice(0, 5)
        .map((post) => post.slug)
        .join(", ")}`
    );
  }

  return posts;
}

module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(syntaxHighlight);
  eleventyConfig.addPlugin(rssPlugin);
  eleventyConfig.addLayoutAlias("base", "layouts/default.njk");

  eleventyConfig.addFilter("dateReadable", (date) => {
    return new Date(date).toDateString();
  });

  eleventyConfig.addFilter("dateDisplay", (date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC"
    }).formatToParts(new Date(date));

    const day = parts.find((part) => part.type === "day")?.value || "";
    const month = (parts.find((part) => part.type === "month")?.value || "").toUpperCase();
    const year = parts.find((part) => part.type === "year")?.value || "";

    return `${day} ${month} ${year}`.trim();
  });

  eleventyConfig.addFilter("htmlDateString", (dateObj) => {
    return new Date(dateObj).toISOString().split("T")[0];
  });

  eleventyConfig.addFilter("getReadingTime", (html) => {
    const text = String(html || "").replace(/<[^>]*>/g, " ");
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
  });

  eleventyConfig.addCollection("posts", async () => {
    return await fetchNowPosts();
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
