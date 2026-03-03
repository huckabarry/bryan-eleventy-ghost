// Import required modules
const { EleventyServerlessBundlerPlugin } = require("@11ty/eleventy");
const GhostContentAPI = require("@tryghost/content-api");
const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
const rssPlugin = require("@11ty/eleventy-plugin-rss");

// Initialize Ghost API
const ghostApi = new GhostContentAPI({
  url: process.env.GHOST_URL,
  key: process.env.GHOST_CONTENT_API_KEY,
  version: "v5.0"
});

module.exports = function (eleventyConfig) {
  // Plugins
  eleventyConfig.addPlugin(syntaxHighlight);
  eleventyConfig.addPlugin(rssPlugin);

  // Passthrough copy
  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("css");
  eleventyConfig.addPassthroughCopy("js");

  // Add filters
  eleventyConfig.addFilter("dateReadable", (date) => {
    return new Date(date).toDateString();
  });

  // Collections
  eleventyConfig.addCollection("posts", async () => {
    return await ghostApi.posts.browse({
      include: "tags,authors",
      limit: "all",
      filter: "tag:now",
    });
  });

  eleventyConfig.addCollection("taggedPosts", async (collectionApi) => {
    const posts = await ghostApi.posts.browse({
      include: "tags,authors",
      limit: "all",
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

  // ActivityPub Route
  eleventyConfig.addCollection("activitypub", async () => {
    const posts = await ghostApi.posts.browse({
      include: "tags,authors",
      limit: 10
    });

    return posts.map((post) => {
      return {
        "@context": "https://www.w3.org/ns/activitystreams",
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
      };
    });
  });

  // JSON Feed
  eleventyConfig.addCollection("jsonFeed", async () => {
    const posts = await ghostApi.posts.browse({
      include: "tags,authors",
      limit: 20
    });

    return {
      version: "https://jsonfeed.org/version/1",
      title: "My Eleventy-Ghost Blog",
      home_page_url: process.env.SITE_URL,
      feed_url: `${process.env.SITE_URL}/feed.json`,
      items: posts.map((post) => ({
        id: post.id,
        url: `${process.env.SITE_URL}/posts/${post.slug}`,
        title: post.title,
        content_html: post.html,
        date_published: post.published_at,
        author: {
          name: post.primary_author.name,
          url: `${process.env.SITE_URL}/author/${post.primary_author.slug}`
        }
      }))
    };
  });

  // Eleventy Serverless for Dynamic Rendering
  eleventyConfig.addPlugin(EleventyServerlessBundlerPlugin, {
    name: "serverless", // The name of the serverless function
    functionsDir: "netlify/functions/"
  });

  // Base config
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

