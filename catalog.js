/* JokStream Cloudflare catalog: live channels, movies, series and episode details. */
(() => {
  "use strict";
  const API = "https://jokstream-api.abdonarjah.workers.dev";
  const PAGE_SIZE = 24;
  const state = {
    movies: { page: 1, total: 0, items: [], loading: false },
    series: { page: 1, total: 0, items: [], loading: false },
    liveCountries: new Set(),
    liveCountry: ""
  };
  const $ = (id) => document.getElementById(id);
  const text = (value, max = 180) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const safeId = (value) => String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const imageFor = (item, kind) => kind === "movies" ? (item.stream_icon || item.cover || "") : (item.cover || item.stream_icon || "");
  const idFor = (item, kind) => safeId(kind === "series" ? (item.series_id ?? item.id) : (item.stream_id ?? item.id));
  const titleFor = (item) => text(item.name || item.title || item.series_name || item.stream_name || "Untitled", 140);

  async function api(path) {
    const response = await fetch(API + path, { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) throw new Error(payload.error || ("Cloudflare API error " + response.status));
    return payload;
  }

  function card(item, kind) {
    const id = idFor(item, kind);
    const title = titleFor(item);
    const image = imageFor(item, kind);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "media-card";
    card.setAttribute("aria-label", (kind === "movies" ? "View movie " : "View series ") + title);
    const poster = document.createElement("span");
    poster.className = "media-poster";
    if (image && /^https?:\/\//i.test(image)) {
      const img = document.createElement("img");
      img.src = image;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.onerror = () => { poster.classList.add("poster-fallback"); poster.textContent = title.slice(0, 1); };
      poster.appendChild(img);
    } else {
      poster.classList.add("poster-fallback");
      poster.textContent = title.slice(0, 1);
    }
    const info = document.createElement("span");
    info.className = "media-card-info";
    const name = document.createElement("strong");
    name.textContent = title;
    const meta = document.createElement("small");
    meta.textContent = [item.year, item.genre, item.rating ? "★ " + item.rating : ""].filter(Boolean).join(" · ") || (kind === "movies" ? "Movie" : "Series");
    info.append(name, meta);
    card.append(poster, info);
    card.addEventListener("click", () => openDetails(item, kind));
    return card;
  }

  function renderShelf(kind) {
    const host = $(kind + "Grid");
    const data = state[kind];
    if (!host) return;
    host.replaceChildren();
    if (!data.items.length) {
      host.innerHTML = '<div class="empty-state">No titles are available in this section yet.</div>';
      return;
    }
    const fragment = document.createDocumentFragment();
    data.items.forEach((item) => fragment.appendChild(card(item, kind)));
    host.appendChild(fragment);
    const more = $("loadMore" + (kind === "movies" ? "Movies" : "Series"));
    if (more) more.hidden = data.items.length >= data.total;
    const count = $(kind + "Count");
    if (count) count.textContent = data.total.toLocaleString() + " titles";
  }

  async function loadShelf(kind, reset = false) {
    const data = state[kind];
    if (data.loading) return;
    if (reset) { data.page = 1; data.items = []; data.total = 0; }
    data.loading = true;
    const host = $(kind + "Grid");
    if (reset && host) host.innerHTML = '<div class="empty-state">Loading from Cloudflare…</div>';
    try {
      const payload = await api("/api/catalog?kind=" + kind + "&page=" + data.page + "&limit=" + PAGE_SIZE);
      const items = Array.isArray(payload.items) ? payload.items : [];
      data.total = Number(payload.total || items.length);
      data.items = data.items.concat(items);
      renderShelf(kind);
    } catch (error) {
      if (!data.items.length && host) host.innerHTML = '<div class="empty-state">Could not load this catalog. Please try again.</div>';
      console.error("JokStream " + kind + " catalog:", error);
    } finally {
      data.loading = false;
    }
  }

  function detailModal() {
    let modal = $("mediaDetailsModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "mediaDetailsModal";
    modal.className = "modal";
    modal.hidden = true;
    modal.innerHTML = '<div class="modal-backdrop" data-media-close></div><div class="modal-card media-detail-card" role="dialog" aria-modal="true" aria-labelledby="mediaDetailTitle"><button type="button" class="modal-close" data-media-close aria-label="Close">×</button><div id="mediaDetailBody"></div></div>';
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-media-close]").forEach((node) => node.addEventListener("click", closeDetails));
    return modal;
  }

  function closeDetails() {
    const modal = $("mediaDetailsModal");
    if (modal) modal.hidden = true;
    document.body.style.overflow = "";
  }

  function playMedia(name, url, kind, id) {
    const media = {
      name: text(name, 140),
      group: kind === "movie" ? "Movies" : kind === "series" ? "Series" : "Live",
      country: "",
      url,
      logo: "",
      shareGate: false,
      chatRoom: "jokstream-" + kind + "-" + safeId(id)
    };
    closeDetails();
    if (typeof window.requestPlayChannel === "function") window.requestPlayChannel(media, null);
    else if (typeof window.playChannel === "function") window.playChannel(media, null);
  }

  async function openDetails(item, kind) {
    const modal = detailModal();
    const body = $("mediaDetailBody");
    const id = idFor(item, kind);
    const title = titleFor(item);
    const poster = imageFor(item, kind);
    body.innerHTML = '<div class="media-detail-layout">' +
      (poster && /^https?:\/\//i.test(poster) ? '<img class="media-detail-poster" src="' + esc(poster) + '" alt="" referrerpolicy="no-referrer">' : '<div class="media-detail-poster poster-fallback">' + esc(title.slice(0, 1)) + '</div>') +
      '<div class="media-detail-copy"><p class="eyebrow">' + (kind === "movies" ? "MOVIE" : "SERIES") + '</p><h2 id="mediaDetailTitle">' + esc(title) + '</h2>' +
      '<p class="media-detail-meta">' + esc([item.year, item.genre, item.rating ? "★ " + item.rating : "", item.duration].filter(Boolean).join(" · ")) + '</p>' +
      '<p class="media-detail-plot">' + esc(item.plot || item.description || "Details supplied by the content provider.") + '</p>' +
      (kind === "movies" ? '<button id="playMovieButton" class="button button-primary full-width" type="button">▶ Play movie</button>' : '<div id="episodeList" class="episode-list"><div class="empty-state">Loading seasons and episodes…</div></div>') +
      '</div></div>';
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    if (kind === "movies") {
      $("playMovieButton").addEventListener("click", () => {
        const ext = text(item.container_extension || "mp4", 8).replace(/[^a-z0-9]/gi, "") || "mp4";
        playMedia(title, API + "/stream/movie/" + id + "." + ext, "movie", id);
      });
      return;
    }
    try {
      const payload = await api("/api?action=get_series_info&series_id=" + encodeURIComponent(id));
      const data = payload.data || {};
      const episodes = data.episodes || {};
      const host = $("episodeList");
      host.replaceChildren();
      const seasons = Object.keys(episodes).sort((a, b) => Number(a) - Number(b));
      if (!seasons.length) {
        host.innerHTML = '<div class="empty-state">No episodes were returned by the provider.</div>';
        return;
      }
      seasons.forEach((season) => {
        const section = document.createElement("section");
        section.className = "season-block";
        const heading = document.createElement("h3");
        heading.textContent = "Season " + season;
        section.appendChild(heading);
        const list = document.createElement("div");
        list.className = "episode-items";
        (Array.isArray(episodes[season]) ? episodes[season] : []).forEach((episode, index) => {
          const episodeId = safeId(episode.id || episode.episode_id);
          const episodeTitle = text(episode.title || episode.name || ("Episode " + (index + 1)), 140);
          if (!episodeId) return;
          const button = document.createElement("button");
          button.type = "button";
          button.className = "episode-item";
          const label = document.createElement("span");
          label.textContent = episodeTitle;
          const number = document.createElement("small");
          number.textContent = "S" + season + " · E" + (episode.episode_num || index + 1);
          button.append(label, number);
          button.addEventListener("click", () => {
            const ext = text(episode.container_extension || "mp4", 8).replace(/[^a-z0-9]/gi, "") || "mp4";
            playMedia(title + " — " + episodeTitle, API + "/stream/series/" + episodeId + "." + ext, "series", episodeId);
          });
          list.appendChild(button);
        });
        section.append(heading, list);
        host.appendChild(section);
      });
    } catch (error) {
      $("episodeList").innerHTML = '<div class="empty-state">Could not load episode details. Please try again later.</div>';
      console.error("JokStream series details:", error);
    }
  }

  async function loadLiveFromCloudflare() {
    try {
      const payload = await api("/api/catalog?kind=live&page=1&limit=100");
      const items = Array.isArray(payload.items) ? payload.items : [];
      if (!items.length || !Array.isArray(window.__jokstreamLiveFallback)) {
        // Keep the existing channel directory available if the provider returns no live channels.
        if (!items.length) return;
      }
      if (typeof allChannels === "undefined") return;
      allChannels = items.map((item) => {
        const id = idFor(item, "movies");
        const name = titleFor(item);
        const category = text(item.category_name || item.group || "Other", 80);
        const country = text(item.country || item.tvg_country || item.country_name || "", 80);
        return {
          name, group: category, country,
          logo: typeof item.stream_icon === "string" ? item.stream_icon : "",
          url: API + "/stream/live/" + id + ".ts",
          shareGate: false,
          chatRoom: "live-" + id
        };
      }).filter((channel) => channel.url.endsWith(".ts"));
      allChannels.sort((a, b) => a.name.localeCompare(b.name));
      if (typeof populateCategories === "function") populateCategories();
      if (typeof applyChannelFilters === "function") applyChannelFilters();
      const counter = $("channelCount");
      if (counter) counter.textContent = allChannels.length.toLocaleString();
      renderCountryFilters();
    } catch (error) {
      console.warn("Cloudflare live catalog unavailable; retaining the existing directory.", error);
    }
  }

  function renderCountryFilters() {
    const host = $("countryQuickFilters");
    if (!host || typeof allChannels === "undefined") return;
    const countries = [...new Set(allChannels.map((channel) => text(channel.country, 80)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    host.replaceChildren();
    const choices = [{ label: "All countries", value: "" }, ...countries.map((country) => ({ label: country, value: country }))];
    choices.forEach((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "category-chip";
      button.textContent = choice.label;
      button.setAttribute("aria-pressed", String(choice.value === state.liveCountry));
      button.addEventListener("click", () => {
        state.liveCountry = choice.value;
        host.querySelectorAll("button").forEach((node) => node.setAttribute("aria-pressed", String(node === button)));
        if (typeof filteredChannels !== "undefined") {
          const query = text($("channelSearch")?.value, 120).toLowerCase();
          const category = $("categoryFilter")?.value || "";
          const smart = $("categoryFilter")?.dataset.smartCategory || "";
          const base = allChannels.filter((channel) => (!state.liveCountry || channel.country === state.liveCountry) &&
            (!query || (channel.name + " " + channel.country + " " + channel.group).toLowerCase().includes(query)) &&
            (!category || channel.group === category) &&
            (!smart || (channel.name + " " + channel.group).toLowerCase().includes(smart.toLowerCase())));
          filteredChannels = base;
          visibleCount = 30;
          if (typeof renderChannels === "function") renderChannels();
        }
      });
      host.appendChild(button);
    });
  }

  function setupSearchAndFilters() {
    const liveSearch = $("channelSearch");
    const category = $("categoryFilter");
    if (liveSearch) liveSearch.addEventListener("input", renderCountryFilters);
    if (category) category.addEventListener("change", renderCountryFilters);
    $("loadMoreMovies")?.addEventListener("click", () => { state.movies.page += 1; loadShelf("movies"); });
    $("loadMoreSeries")?.addEventListener("click", () => { state.series.page += 1; loadShelf("series"); });
    $("mediaDetailsModal")?.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDetails(); });
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupSearchAndFilters();
    loadLiveFromCloudflare();
    loadShelf("movies", true);
    loadShelf("series", true);
  });
})();
