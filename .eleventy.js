const GhostContentAPI = require("@tryghost/content-api");
const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
const rssPlugin = require("@11ty/eleventy-plugin-rss");
const ghostApi = new GhostContentAPI({
  url: process.env.GHOST_URL,
  key: process.env.GHOST_CONTENT_API_KEY,
  version: "v5.71"
});

module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(syntaxHighlight);
  eleventyConfig.addPlugin(rssPlugin);
  eleventyConfig.addLayoutAlias("base", "layouts/default.njk");

  eleventyConfig.addFilter("dateReadable", (date) => {
    return new Date(date).toDateString();
  });

  eleventyConfig.addFilter("htmlDateString", (dateObj) => {
    return new Date(dateObj).toISOString().split("T")[0];
  });

  eleventyConfig.addCollection("posts", async () => {
    return await ghostApi.posts.browse({
      include: "tags,authors",
      limit: 100,
      filter: "tag:now"
    });
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
