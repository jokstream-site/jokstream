# JokStream Ultimate Clean Edition

Static Netlify website. The archive root contains `index.html`, `app.js`, `style.css`, `sw.js`, `manifest.json`, `_headers`, and icons.

## Included
- Full-screen same-page channel overlay: video above, channel chat below, with a close button.
- Supabase Realtime shared chat and Presence-based count of connected sessions in the selected room.
- Hls.js adaptive bitrate for HLS manifests that contain multiple renditions; P2P Media Loader is attempted when its library and browser support are available.
- Dynamic client-side title, description, and JSON-LD when a channel is selected.
- Owner-supplied Monetag zones: Vignette `12117072`, Popunder `12117037`, and banner `12117045`.
- Popunder script loading is limited by a 30-minute local-storage timestamp when storage is available. Monetag's own delivery logic may still affect actual impressions and browser behavior.
- Owner Cloudflare Worker URL for HTTP stream URLs using `?url=`.

## Important limitations
- Presence counts connected sessions, not verified human viewers; multiple tabs/devices and dropped connections can affect the number. Confirm Supabase Realtime Presence is enabled for this project.
- The Vignette script is not guaranteed to behave as a 5-second skippable pre-roll. Monetag controls ad format, eligibility, and timing. The site does not attempt to fake ad completion or pre-buffer video behind an ad overlay.
- Client-side dynamic metadata can help the current page experience, but it does not guarantee indexing or rankings. Search engines generally need crawlable page URLs and server-rendered metadata for reliable per-channel indexing.
- The public channel playlist is fetched when the page loads. No rapid scraping of third-party sources is performed.
- The player does not spoof headers to evade geographic restrictions, bypass DRM, or defeat access controls. Use only sources you are authorized to watch and redistribute. A proxy cannot guarantee every stream works; the Worker must correctly rewrite HLS child playlists/segments and support CORS/range requests.
- Adaptive bitrate requires source-provided renditions. A completely dead internet connection cannot receive new live segments. P2P is best-effort and requires compatible peers/network conditions.
- The Supabase browser publishable key is public by design; do not put a service-role key in client files. Keep RLS policies and abuse controls enabled.

## Netlify deployment
Upload the ZIP contents to the site's publish root, not as a nested ZIP file. Confirm `index.html` and `sw.js` are at the root. After deployment, verify `https://YOUR-DOMAIN/sw.js` loads the supplied Monetag service worker, then complete verification in Monetag.

## Checks
This package was checked for ZIP integrity and JavaScript syntax locally. Live channel playback, the Cloudflare Worker, actual Monetag delivery, and cross-device Presence/chat must still be tested on the deployed domain.
