# JOKSTREAM — Known Good Baseline

## Snapshot identity

- Date: 2026-11-21
- Repository: `jokstream-site/jokstream`
- Default branch: `main`
- Baseline commit: `1756ea5bfc9219f37eb368e221036caefae5776e`
- Backup branch: `backup/known-good-2026-11-21`
- Backup branch URL: https://github.com/jokstream-site/jokstream/tree/backup/known-good-2026-11-21
- Site URL: https://jokstream-site.abdonarjah.workers.dev/
- Worker name: `jokstream-site`

## File blob identifiers at snapshot

| Path | Git blob SHA |
|---|---|
| `app.js` | `5e36bef174c8d2e53ae4b21e4938a03ae7f3759c` |
| `index.html` | `710184273162d516b0c851c3d6275b93e6cbe7e9` |
| `README.md` | `16150c1d08bd4e9547e58e6ea1506032db76b0b6` |
| `style.css` | `6cd16a47cc54c8f8740a9104ea91d3fe5ce957ee` |
| `manifest.json` | `888756de022be789fd1f0064b090124f61ecbb88` |
| `pwa-sw.js` | `432126eb9688c06927c880abd6d4fd7833bb3558` |
| `sw.js` | `dec3c996c72654b24c9551402a8bfeeb7248f010` |

هذه Git blob SHAs للتعرّف على المحتوى وليست أسراراً أو مفاتيح تشغيل.

## Confirmed code behavior at baseline

- `JOKFLIX_API` يشير إلى jokflix Worker.
- `JOKSTREAM_API` يشير إلى jokstream-api Worker.
- TMDB metadata uses jokflix.
- Live TV uses jokstream-api catalog and stream endpoints.
- Live playback tries MPEG-TS via mpegts.js, then HLS fallback.
- VOD embeds use `https://vidsrc.sh`.
- Movie embed path: `/embed/movie/{id}`.
- TV embed path: `/embed/tv/{id}/{season}/{episode}`.
- Player subtitle preference defaults to `ar,es,fr`, sanitized and capped at three languages.
- Player remote commands are sent through postMessage.
- Player progress and My List are stored locally.
- External subtitle search endpoint exists; attaching the selected external file is not confirmed complete in the current frontend implementation.

## Known-good report and limitations

The project owner reported that the site was working correctly before requesting this documentation. The previous interaction also confirmed from the user's own test that the external player controls worked and the popup behavior was acceptable at that time.

This is not a fresh end-to-end browser test performed as part of creating these documents. It is a recorded baseline, backed by the current repository commit and the user's report. Third-party services can change independently.

## Recent feature commits included in history

- `b7da14e1ec1025f20b71dfd41a8b7c12f72185d8` — Switch VOD player to documented vidsrc.sh embed and controls.
- `fc9cf091112a0de55a895035b764e49cc8c100fa` — Refresh player bundle cache after VidSrc switch.
- `239318880a71200d4a72ea9f4c9e0762787cc8ea` — Prioritize Arabic Spanish and French subtitle tracks.
- `1756ea5bfc9219f37eb368e221036caefae5776e` — Add subtitle language priority controls.

## Do not modify

- `jokstream-api` Worker/repository: excluded from scope.
- jokflix Worker secrets and bindings: do not change during frontend documentation or ordinary UI fixes.
- Cloudflare production bindings/metadata: preserve as-is during frontend deployment.

## Updating this file

Only update the baseline commit and backup branch after:
1. A new commit has been deployed to the correct Worker.
2. The deployed assets have been checked.
3. Live TV, VOD, subtitles, controls, and My List have been tested.
4. The owner confirms the site is good.

Do not label an untested commit as known-good.
