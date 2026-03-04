# Low Velocity Now Feed

An Eleventy site that pulls content from a Ghost instance and publishes only posts tagged `now`.

This repo is intentionally narrower than the original Ghost starter. It is not a full Ghost theme replacement. It builds a filtered static front-end over a larger Ghost site.

## Installing

```bash
yarn
```

## Running

```bash
yarn start
```

## Required environment variables

- `GHOST_URL`
- `GHOST_CONTENT_API_KEY`
- `SITE_URL`

## Content scope

The Eleventy `posts` collection filters Ghost content with:

```js
filter: "tag:now"
```

That means posts from the underlying Ghost site only appear here when they carry the `now` tag.

## Build

```bash
yarn build
```
