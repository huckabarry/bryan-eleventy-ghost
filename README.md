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
- `MICROPUB_TOKEN` (shared bearer token for Micropub clients)
- `GITHUB_TOKEN` (GitHub token with repo write access)
- `GITHUB_REPO` (`owner/repo`, used by Micropub function to commit status markdown)

Optional:

- `GITHUB_BRANCH` (default: `main`)
- `MICROPUB_STATUS_DIR` (default: `src/status`)
- `SITE_LOGO` (override local avatar path)

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

## Micropub endpoint

This site includes a Netlify Micropub endpoint at:

- `/micropub`

Current behavior:

- Supports create (`h-entry`) posts.
- Writes new markdown files into `src/status/` via GitHub API commits.
- Returns `201 Created` with a `Location` header to the new permalink.
- Supports `q=config` and `q=syndicate-to`.

Current limitation:

- `multipart/form-data` media upload is not supported yet.
- For photos, provide URL-based photos (`photo` property) so they can be embedded as Markdown image links.

## Note

The current visual direction is a personal adaptation of the earlier Afterword site I built on Pika.page. This repo is its own Eleventy implementation, but that earlier site was the design reference point.
