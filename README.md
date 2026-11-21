# JOKSTREAM

A responsive English-language streaming interface that brings Live TV, movies and series into one application.

## Architecture

- **Frontend:** Static HTML, CSS and JavaScript in the repository root.
- **Live TV:** Cloudflare Worker at `https://jokstream-api.abdonarjah.workers.dev`.
- **Movie and series discovery:** TMDB API through the JOKFLIX Cloudflare Worker at `https://jokflix.abdonarjah.workers.dev`.
- **Playback:** VidSrc embeds using TMDB IDs.
- **External subtitles:** OpenSubtitles endpoints exposed by the JOKSTREAM API Worker.

## Cloudflare services

### JOKFLIX

The `jokflix` Worker is a server-side TMDB gateway. It uses the existing Cloudflare secret bindings:

- `TMDB_TOKEN` (Bearer token, preferred)
- `TMDB_API_KEY` (API key fallback)

The public frontend calls `/api/{tmdb-path}`. TMDB credentials are never sent to the browser. Example endpoints:

- `/health`
- `/api/trending/movie/week?language=en-US`
- `/api/movie/{tmdb_id}?append_to_response=credits,videos,similar,external_ids`
- `/api/tv/{tmdb_id}/season/{season_number}`

### JOKSTREAM API

The existing `jokstream-api` Worker is used for the live channel catalogue, stream relay and external subtitles:

- `GET /api/catalog?kind=live&page=1&limit=100`
- `GET /stream/live/{stream_id}.ts`
- `GET /api/subtitles?query={title}&type=movie&languages=en,ar`
- `GET /api/subtitles/download?file_id={file_id}`

The Worker has existing D1, KV and secret bindings. Keep provider credentials and subtitle API keys in Cloudflare secrets; never copy them into frontend files.

## Playback and popup restrictions

VidSrc supports movie and TV embeds by TMDB or IMDB ID, subtitle language preferences, custom subtitle URLs, player events and parent-page playback commands. JOKSTREAM uses a sandboxed cross-origin iframe without the `allow-popups` permission, plus parent-page popup hardening. The iframe sandbox can affect third-party player features; test playback on the target browsers. A parent page cannot guarantee control over every popup or overlay created internally by a third-party provider.

External subtitles are fetched through the JOKSTREAM API Worker and passed to VidSrc as a HTTPS `sub_url`. Built-in VidSrc subtitle selection remains available in the provider player.

## Deployment

The repository is a static site. A Cloudflare Worker named `jokstream-site` serves the current `main` branch from GitHub at `https://jokstream-site.abdonarjah.workers.dev/`, with short edge caching. The Worker was deployed through the Cloudflare API. The original repository can also be published through a connected static host such as Netlify.

The Worker reads the public GitHub raw files at request time, so updates committed to `main` become visible after the edge cache expires. For a larger production deployment, consider moving the files to Cloudflare Workers Static Assets.

## Release checks

1. Open the JOKFLIX Worker `/health` endpoint and confirm `tmdbConfigured: true`.
2. Open `/api/trending/movie/week?language=en-US` and confirm a TMDB `results` array is returned.
3. Open the JOKSTREAM API `/health` endpoint and confirm the database and cache are connected.
4. Open `/api/catalog?kind=live&page=1&limit=100` and confirm the channel list is returned.
5. Test a live stream, a movie, a TV episode, built-in subtitles, and an external subtitle track in the browsers you intend to support.

## Rights and availability

Use only live streams and video sources you are authorized to access and distribute. TMDB provides discovery metadata and artwork; VidSrc availability is controlled by the third-party provider and is not guaranteed by JOKSTREAM. No client-side overlay can guarantee suppression of all third-party popups.
