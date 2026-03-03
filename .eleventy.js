const GhostContentAPI = require("@tryghost/content-api");
const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
const rssPlugin = require("@11ty/eleventy-plugin-rss");
const CleanCSS = require("clean-css");

const ghostApi = new GhostContentAPI({
  url: process.env.GHOST_URL,
  key: process.env.GHOST_CONTENT_API_KEY,
  version: "v5.71" // Matches the v{major}.{minor} format required by Ghost 6
});

module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(syntaxHighlight);
  eleventyConfig.addPlugin(rssPlugin);
  eleventyConfig.addLayoutAlias("base", "layouts/default.njk");

  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("css");
  eleventyConfig.addPassthroughCopy("js");

  eleventyConfig.addFilter("dateReadable", (date) => {
    return new Date(date).toDateString();
  });

    // Add filters
  eleventyConfig.addFilter("dateReadable", (date) => {
    return new Date(date).toDateString();
  });

  // Add the missing cssmin filter
  eleventyConfig.addFilter("cssmin", function(code) {
    return new CleanCSS({}).minify(code).styles;
  });

    // Add filters
  eleventyConfig.addFilter("dateReadable", (date) => {
    return new Date(date).toDateString();
  });

  eleventyConfig.addFilter("cssmin", function(code) {
    return new CleanCSS({}).minify(code).styles;
  });

  // ADD THIS FILTER:
  eleventyConfig.addFilter("htmlDateString", (dateObj) => {
    return new Date(dateObj).toISOString().split('T')[0];
  });

  // Collections - Filtered for "now" tag
  eleventyConfig.addCollection("posts", async () => {
    return await ghostApi.posts.browse({
      include: "tags,authors",
      limit: 100, // Ghost 6 max limit per request
      filter: "tag:now",
    });
  });

  eleventyConfig.addCollection("taggedPosts", async (collectionApi) => {
    const posts = await ghostApi.posts.browse({
      include: "tags,authors",
      limit: 100, // Update from "all" to 100
      filter: "tag:now",
    });

    const tags = {};
    posts.forEach((post) => {
      if (post.tags) {
        post.tags.forEach((tag) => {
          if (!tags[tag.slug]) tags[tag.slug] = [];
          tags[tag.slug].push(post);
        });
      }
    });

    return tags;
  });

  // ActivityPub Route - Customized for your static domain identity
  eleventyConfig.addCollection("activitypub", async () => {
    const posts = await ghostApi.posts.browse({
      include: "tags,authors",
      limit: 20,
      filter: "tag:now"
    });

    return posts.map((post) => ({
      "@context": "https://www.w3.org",
      type: "Article",
      id: `${process.env.SITE_URL}/posts/${post.slug}`,
      name: post.title,
      url: `${process.env.SITE_URL}/posts/${post.slug}`,
      content: post.html,
      published: post.published_at,
      author: {
        type: "Person",
        id: `${process.env.SITE_URL}/author/${post.primary_author.slug}`,
        name: post.primary_author.name,
        url: `${process.env.SITE_URL}/author/${post.primary_author.slug}`
      }
    }));
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

