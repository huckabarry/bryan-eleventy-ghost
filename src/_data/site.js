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
  data.title = "Afterword";
  data.description = "Hey! I’m Bryan, an urban planner and design thinker living in the Pacific Northwest with my wife and two young kids. Afterword is a blog where I post about everyday life.";
  data.logo = "https://cdn.u.pika.page/2S770Bf-Ta8Bf_SF3tDUa-2fIeZocDjl3ewqMmBvJSk/fn:IMG_8710/plain/s3://pika-production/aj4090bxube83j7rhj151mum2ssn";
  data.navigation = [
    {
      label: "Home",
      url: "/"
    },
    {
      label: "Photos",
      url: "https://afterword.blog/photos"
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
