require("dotenv").config();
const ghostContentAPI = require("@tryghost/content-api");

// Init Ghost API with matching Netlify variables
const api = new ghostContentAPI({
  url: process.env.GHOST_URL, // Changed from GHOST_API_URL to GHOST_URL
  key: process.env.GHOST_CONTENT_API_KEY,
  version: "v5.0" // Changed from v2 to v5.0 for Ghost 6 compatibility
});

// Get all site information
module.exports = async function() {
  const siteData = await api.settings
    .browse()
    .catch(err => {
      console.error("Ghost API Error in site.js:", err);
    });

  // This line ensures your "Masked URL" is used instead of your backend Ghost URL
  // Replace your return block with this:
  const data = siteData || {}; // Safety fallback
  if (process.env.SITE_URL) {
    data.url = process.env.SITE_URL;
  }
  const normalizedSiteUrl = /^https?:\/\//i.test(data.url || "")
    ? data.url
    : `https://${data.url || ""}`;
  data.title = "Afterword";
  data.description = "Hey! I’m Bryan, an urban planner and design thinker living in the Pacific Northwest with my wife and two young kids. Afterword is a blog where I post about everyday life.";
  data.logo = "https://cdn.u.pika.page/2S770Bf-Ta8Bf_SF3tDUa-2fIeZocDjl3ewqMmBvJSk/fn:IMG_8710/plain/s3://pika-production/aj4090bxube83j7rhj151mum2ssn";
  data.url = normalizedSiteUrl;
  data.domain = new URL(normalizedSiteUrl).hostname;
  data.atprotoDid = process.env.ATPROTO_DID || "did:plc:vt4k6d3e5rjw65cuzaf3nufq";
  data.webfinger = {
    username: "bryan",
    profileUrl: "https://urbanists.social/@bryan",
    actorUrl: "https://urbanists.social/users/bryan"
  };
  data.webmentions = {
    username: data.domain,
    endpoint: `https://webmention.io/${data.domain}/webmention`,
    api: "https://webmention.io/api/mentions.jf2"
  };
  data.albumWhaleUrl = "https://albumwhale.com/bryan/listening-now";
  data.navigation = [
    {
      label: "Home",
      url: "/"
    },
    {
      label: "Photos",
      url: "/photos/"
    },
    {
      label: "Now",
      url: "https://afterword.blog/now"
    },
    {
      label: "About",
      url: "/about/"
    }
  ];
  return data;

};
