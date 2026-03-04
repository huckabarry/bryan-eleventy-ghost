const GhostContentAPI = require("@tryghost/content-api");
const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
const rssPlugin = require("@11ty/eleventy-plugin-rss");

const ghostApi = new GhostContentAPI({
  url: process.env.GHOST_URL,
  key: process.env.GHOST_CONTENT_API_KEY,
  version: "v5.71"
});

let nowPostsPromise;

function extractFirstImage(post) {
  const html = String(post && post.html ? post.html : "");
  const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
  const altMatch = html.match(/<img[^>]+alt=["']([^"']*)["'][^>]*>/i);

  if (imgMatch) {
    return {
      src: imgMatch[1],
      alt: altMatch ? altMatch[1] : post.title || ""
    };
  }

  if (post && post.feature_image) {
    return {
      src: post.feature_image,
      alt: post.title || ""
    };
  }

  return null;
}

async function fetchNowPosts() {
  if (!nowPostsPromise) {
    nowPostsPromise = ghostApi.posts.browse({
      include: "tags,authors",
      limit: 100,
      filter: "tag:now"
    });
  }

  const posts = await nowPostsPromise;

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
      timeZone: "UTC"
    }).formatToParts(new Date(date));

    const day = parts.find((part) => part.type === "day")?.value || "";
    const month = (parts.find((part) => part.type === "month")?.value || "").toUpperCase();

    return `${day} ${month}`.trim();
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

  eleventyConfig.addCollection("photoPosts", async () => {
    const posts = await fetchNowPosts();

    return posts
      .map((post) => ({
        ...post,
        firstImage: extractFirstImage(post)
      }))
      .filter((post) => post.firstImage);
  });

  eleventyConfig.addCollection("tagPages", async () => {
    const posts = await fetchNowPosts();
    const tags = new Map();

    posts.forEach((post) => {
      (post.tags || []).forEach((tag) => {
        if (!tag || !tag.slug || tag.slug === "now" || tag.visibility === "internal") {
          return;
        }

        if (!tags.has(tag.slug)) {
          tags.set(tag.slug, {
            ...tag,
            url: `/tags/${tag.slug}/`,
            posts: []
          });
        }

        tags.get(tag.slug).posts.push(post);
      });
    });

    return Array.from(tags.values()).sort((a, b) => a.name.localeCompare(b.name));
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
