require("dotenv").config();

module.exports = async function () {
  const configuredUrl = process.env.SITE_URL || "https://afterword.blog";
  const normalizedSiteUrl = /^https?:\/\//i.test(configuredUrl)
    ? configuredUrl
    : `https://${configuredUrl}`;
  const data = {
    title: "Afterword",
    description: "Hey! I’m Bryan, an urban planner and design thinker living in the Pacific Northwest with my wife and two young kids. Afterword is a blog where I post about everyday life.",
    logo: "https://cdn.u.pika.page/2S770Bf-Ta8Bf_SF3tDUa-2fIeZocDjl3ewqMmBvJSk/fn:IMG_8710/plain/s3://pika-production/aj4090bxube83j7rhj151mum2ssn",
    url: normalizedSiteUrl
  };

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
    pingback: `https://webmention.io/${data.domain}/xmlrpc`,
    api: "https://webmention.io/api/mentions.jf2"
  };
  data.relMe = [
    "https://urbanists.social/@bryan",
    "https://bsky.app/profile/afterword.blog"
  ];
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
      url: "/now/"
    },
    {
      label: "About",
      url: "/about/"
    }
  ];
  return data;
};
