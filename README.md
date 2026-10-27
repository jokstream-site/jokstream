# JokStream Ultimate Clean Edition

Static Netlify website. The archive root contains `index.html`, `app.js`, `style.css`, `sw.js`, `manifest.json`, `_headers`, and icons.

## Included
- Full-screen same-page channel overlay: video above, channel chat below, with a close button.
- Supabase Realtime shared chat and Presence-based count of connected sessions in the selected room.
- Hls.js adaptive bitrate for HLS manifests that contain multiple renditions; P2P Media Loader is attempted when its library and browser support are available.
- Dynamic client-side title, description, and JSON-LD when a channel is selected.
- Owner-supplied Monetag zones: Vignette `12117072`, Popunder `12117037`, and banner `12117045`.
- Popunder script loading is limited by a 30-minute local-storage timestamp when storage is available. Monetag's own delivery logic may still affect actual impressions and browser behavior.
- Owner Cloudflare Worker URL for the directory response (`?get_list=true`) and authorized HTTP/HTTPS stream URLs encoded in the separate `proxy_url` query parameter. Both native playback and Hls.js use the proxied URL, with a 3-second manifest handshake deadline.

## Important limitations
- Presence counts connected sessions, not verified human viewers; multiple tabs/devices and dropped connections can affect the number. Confirm Supabase Realtime Presence is enabled for this project.
- The Vignette script is not guaranteed to behave as a 5-second skippable pre-roll. Monetag controls ad format, eligibility, and timing. The site does not attempt to fake ad completion or pre-buffer video behind an ad overlay.
- Client-side dynamic metadata can help the current page experience, but it does not guarantee indexing or rankings. Search engines generally need crawlable page URLs and server-rendered metadata for reliable per-channel indexing.
- The channel directory is fetched from the owner Worker when the page loads. Its root response must be Base64-encoded UTF-8 containing an M3U playlist or a JSON array of channel objects. The page reports an empty directory as zero channels rather than implying it loaded successfully.
- The player routes HTTP/HTTPS streams through the Worker. It does not bypass DRM or defeat access controls. Use only sources you are authorized to watch and redistribute. The Worker must correctly rewrite HLS child playlists/segments and encryption-key URLs and support CORS/range requests.
- Adaptive bitrate requires source-provided renditions. A completely dead internet connection cannot receive new live segments. P2P is best-effort and requires compatible peers/network conditions.
- The Supabase browser publishable key is public by design; do not put a service-role key in client files. Keep RLS policies and abuse controls enabled.

## Netlify deployment
Upload the ZIP contents to the site's publish root, not as a nested ZIP file. Confirm `index.html` and `sw.js` are at the root. After deployment, verify `https://YOUR-DOMAIN/sw.js` loads the supplied Monetag service worker, then complete verification in Monetag.

## Checks
This package was checked for ZIP integrity and JavaScript syntax locally. Live channel playback, the Cloudflare Worker, actual Monetag delivery, and cross-device Presence/chat must still be tested on the deployed domain.
