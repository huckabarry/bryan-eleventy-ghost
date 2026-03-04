const GhostContentAPI = require("@tryghost/content-api");
const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
const rssPlugin = require("@11ty/eleventy-plugin-rss");

const ghostApi = new GhostContentAPI({
  url: process.env.GHOST_URL,
  key: process.env.GHOST_CONTENT_API_KEY,
  version: "v5.71"
});

let nowPostsPromise;
const INCLUDED_SITE_TAGS = [
  "afterword",
  "status",
  "listening",
  "books",
  "gallery",
  "now-playing",
  "now-reading",
  "photos",
  "now"
];

function extractFirstImage(post) {
  const html = String(post && post.html ? post.html : "");
  const cleanedHtml = html
    .replace(/<figure[^>]*class=["'][^"']*kg-bookmark-card[^"']*["'][\s\S]*?<\/figure>/gi, "")
    .replace(/<div[^>]*class=["'][^"']*kg-bookmark-card[^"']*["'][\s\S]*?<\/div>/gi, "");
  const preferredMatches = [
    /<figure[^>]*class=["'][^"']*kg-image-card[^"']*["'][\s\S]*?<img[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*>/i,
    /<figure[^>]*class=["'][^"']*kg-gallery-card[^"']*["'][\s\S]*?<img[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*>/i,
    /<img(?![^>]*class=["'][^"']*kg-bookmark-(?:thumbnail|icon)[^"']*["'])[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*>/i,
    /<img(?![^>]*class=["'][^"']*kg-bookmark-(?:thumbnail|icon)[^"']*["'])[^>]+src=["']([^"']+)["'][^>]*>/i
  ];

  for (const pattern of preferredMatches) {
    const match = cleanedHtml.match(pattern);
    if (match && match[1]) {
      if (/\.(png)(\?|$)/i.test(match[1])) {
        continue;
      }
      if (/favicon|bookwyrm|avatar|screenshot|screen-shot|screen_shot/i.test(match[1])) {
        continue;
      }
      return {
        src: match[1],
        alt: match[2] || post.title || ""
      };
    }
  }

  if (post && post.feature_image) {
    return {
      src: post.feature_image,
      alt: post.title || ""
    };
  }

  return null;
}

function stripFirstImage(html) {
  const source = String(html || "");
  const patterns = [
    /<figure[^>]*class=["'][^"']*kg-image-card[^"']*["'][\s\S]*?<\/figure>/i,
    /<figure[^>]*class=["'][^"']*kg-gallery-card[^"']*["'][\s\S]*?<\/figure>/i,
    /<figure[\s\S]*?<img[^>]*>[\s\S]*?<\/figure>/i,
    /<p>\s*<img[^>]*>\s*<\/p>/i,
    /<img[^>]*>/i
  ];

  for (const pattern of patterns) {
    if (pattern.test(source)) {
      return source.replace(pattern, "").trim();
    }
  }

  return source;
}

function postHasTag(post, slug) {
  return (post.tags || []).some((tag) => tag && tag.slug === slug);
}

function parseTagSlugs(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
}

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

function getStatusLabel(post) {
  if (postHasTag(post, "status")) {
    return "";
  }

  return post.title || "";
}

function getPlainTextPreview(post, maxLength = 220) {
  const text = String(post && post.html ? post.html : "")
    .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return "";
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trimEnd()}…`;
}

function getStatusPreview(post) {
  const excerpt = String(post && post.excerpt ? post.excerpt : "").trim();

  if (excerpt) {
    return excerpt;
  }

  const preview = getPlainTextPreview(post);

  if (preview) {
    return preview;
  }

  return String(post && post.title ? post.title : "").trim();
}

function getLocalPostSlug(post) {
  const ghostSlug = String(post && post.slug ? post.slug : "").trim();

  if (!postHasTag(post, "status")) {
    return ghostSlug;
  }

  if (ghostSlug && ghostSlug !== "untitled") {
    return ghostSlug;
  }

  const words = getStatusPreview(post).split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
  const derivedSlug = slugify(words);

  return derivedSlug || ghostSlug || "status";
}

function getLocalPostUrl(post) {
  return `/${getLocalPostSlug(post)}/`;
}

function getCollectionIndex(posts, currentPost) {
  const items = Array.isArray(posts) ? posts : [];
  const currentId = currentPost && currentPost.id;
  const currentSlug = currentPost && currentPost.slug;
  const currentLocalSlug = currentPost ? getLocalPostSlug(currentPost) : "";

  return items.findIndex((post) => {
    if (currentId && post.id === currentId) {
      return true;
    }

    if (currentSlug && post.slug === currentSlug) {
      return true;
    }

    return currentLocalSlug && getLocalPostSlug(post) === currentLocalSlug;
  });
}

async function fetchNowPosts() {
  if (!nowPostsPromise) {
    nowPostsPromise = ghostApi.posts.browse({
      include: "tags,authors",
      limit: 100,
      filter: `tag:[${INCLUDED_SITE_TAGS.join(",")}]`
    });
  }

  const posts = await nowPostsPromise;

  console.log(
    `[afterword] fetched ${posts.length} Ghost posts for filter ${INCLUDED_SITE_TAGS
      .map((tag) => `tag:${tag}`)
      .join(" OR ")}`
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
    const month = parts.find((part) => part.type === "month")?.value || "";

    return `${day} ${month}`.trim();
  });

  eleventyConfig.addFilter("htmlDateString", (dateObj) => {
    return new Date(dateObj).toISOString().split("T")[0];
  });

  eleventyConfig.addFilter("rfc3339Date", (dateObj) => {
    return new Date(dateObj).toISOString();
  });

  eleventyConfig.addFilter("rfc822Date", (dateObj) => {
    return new Date(dateObj).toUTCString();
  });

  eleventyConfig.addFilter("getReadingTime", (html) => {
    const text = String(html || "").replace(/<[^>]*>/g, " ");
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
  });

  eleventyConfig.addFilter("withTagSlug", (posts, slug) => {
    return (posts || []).filter((post) => postHasTag(post, slug));
  });

  eleventyConfig.addFilter("withAnyTagSlugs", (posts, slugs) => {
    const tagSlugs = parseTagSlugs(slugs);
    return (posts || []).filter((post) =>
      tagSlugs.some((slug) => postHasTag(post, slug))
    );
  });

  eleventyConfig.addFilter("withoutTagSlug", (posts, slug) => {
    return (posts || []).filter((post) => !postHasTag(post, slug));
  });

  eleventyConfig.addFilter("withoutAnyTagSlugs", (posts, slugs) => {
    const tagSlugs = parseTagSlugs(slugs);
    return (posts || []).filter(
      (post) => !tagSlugs.some((slug) => postHasTag(post, slug))
    );
  });

  eleventyConfig.addFilter("hasTagSlug", (post, slug) => {
    return postHasTag(post, slug);
  });

  eleventyConfig.addFilter("feedTitle", (post) => {
    return getStatusLabel(post);
  });

  eleventyConfig.addFilter("localPostUrl", (post) => {
    return getLocalPostUrl(post);
  });

  eleventyConfig.addFilter("localPostSlug", (post) => {
    return getLocalPostSlug(post);
  });

  eleventyConfig.addFilter("statusPreview", (post) => {
    return getStatusPreview(post);
  });

  eleventyConfig.addFilter("getPreviousPost", (posts, currentPost) => {
    const index = getCollectionIndex(posts, currentPost);
    return index >= 0 ? posts[index + 1] || null : null;
  });

  eleventyConfig.addFilter("getNextPost", (posts, currentPost) => {
    const index = getCollectionIndex(posts, currentPost);
    return index > 0 ? posts[index - 1] || null : null;
  });

  eleventyConfig.addFilter("firstImage", (post) => {
    return extractFirstImage(post);
  });

  eleventyConfig.addFilter("stripFirstImage", (html) => {
    return stripFirstImage(html);
  });

  eleventyConfig.addCollection("posts", async () => {
    return await fetchNowPosts();
  });

  eleventyConfig.addCollection("photoPosts", async () => {
    const posts = await fetchNowPosts();

    return posts
      .filter((post) => postHasTag(post, "gallery") || postHasTag(post, "photos"))
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
