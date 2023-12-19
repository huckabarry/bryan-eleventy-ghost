require("dotenv").config();

const ghostContentAPI = require("@tryghost/content-api");

// Init Ghost API
const api = new ghostContentAPI({
  url: https://writings.bryan.lv,
  key: 163c276b880508bfa84bc64438,
  version: "v2"
});

// Get all site information
module.exports = async function() {
  const siteData = await api.settings
    .browse({
      include: "icon,url"
    })
    .catch(err => {
      console.error(err);
    });

  if (process.env.SITE_URL) siteData.url = process.env.SITE_URL;

  return siteData;
};
