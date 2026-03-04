# Afterword

Afterword is an Eleventy static site front end for a Ghost CMS backend.

It is not a Ghost theme. Ghost remains the content source of truth, and Eleventy builds a filtered, custom-designed static site from that content for deployment.

## Architecture

- Ghost provides posts and site data through the Content API
- Eleventy renders the public static frontend
- Netlify deploys the generated `_site` output

## Content model

The site currently pulls in posts tagged with one or more of these tags:

- `afterword`
- `status`
- `listening`
- `books`
- `gallery`

Some legacy tags are still tolerated during migration:

- `now`
- `now-playing`
- `now-reading`
- `photos`

## Required environment variables

- `GHOST_URL`
- `GHOST_ADMIN_URL`
- `GHOST_ADMIN_KEY`
- `SITE_URL`

## Install

```bash
yarn
```

## Run

```bash
yarn start
```

## Build

```bash
yarn build
```

## Note

The current visual direction is a personal adaptation of the earlier Afterword site I built on Pika.page. This repo is its own Eleventy implementation, but that earlier site was the design reference point.
