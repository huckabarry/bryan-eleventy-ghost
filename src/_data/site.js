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
  if (process.env.SITE_URL) {
    siteData.url = process.env.SITE_URL;
  }

  return siteData;
};

