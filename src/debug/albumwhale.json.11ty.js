module.exports = class {
  data() {
    return {
      permalink: "/debug/albumwhale.json",
      eleventyExcludeFromCollections: true
    };
  }

  render({ albumwhale }) {
    return JSON.stringify(albumwhale, null, 2);
  }
};
