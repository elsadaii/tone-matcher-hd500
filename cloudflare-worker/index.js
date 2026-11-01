const ALLOWED_ORIGIN = "https://elsadaii.github.io";

let spotifyToken = null;
let spotifyTokenExpiresAt = 0;

function cors(origin) {
  const allowed = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" }
  });
}

async function getSpotifyToken(env) {
  if (spotifyToken && Date.now() < spotifyTokenExpiresAt - 60000) return spotifyToken;
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    throw new Error("Spotify API belum dikonfigurasi di Cloudflare Secrets.");
  }
  const credentials = btoa(env.SPOTIFY_CLIENT_ID + ":" + env.SPOTIFY_CLIENT_SECRET);
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + credentials,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!response.ok) throw new Error("Spotify authentication gagal (" + response.status + ").");
  const data = await response.json();
  spotifyToken = data.access_token;
  spotifyTokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return spotifyToken;
}

async function searchSpotify(q, env) {
  const token = await getSpotifyToken(env);
  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("q", q);
  url.searchParams.set("type", "artist,track,album");
  url.searchParams.set("limit", "8");
  const response = await fetch(url, {
    headers: { "Authorization": "Bearer " + token }
  });
  if (!response.ok) throw new Error("Spotify search gagal (" + response.status + ").");
  const data = await response.json();
  const artists = (data.artists?.items || []).map(x => ({
    kind: "artist", name: x.name, detail: (x.genres || []).slice(0, 3).join(" · "),
    image: x.images?.[0]?.url || null, url: x.external_urls?.spotify || null,
    id: x.id
  }));
  const tracks = (data.tracks?.items || []).map(x => ({
    kind: "track", name: x.name,
    detail: (x.artists || []).map(a => a.name).join(", ") + " · " + (x.album?.name || ""),
    image: x.album?.images?.[0]?.url || null, url: x.external_urls?.spotify || null,
    id: x.id
  }));
  const albums = (data.albums?.items || []).map(x => ({
    kind: "album", name: x.name,
    detail: (x.artists || []).map(a => a.name).join(", "),
    image: x.images?.[0]?.url || null, url: x.external_urls?.spotify || null,
    id: x.id
  }));
  return [...artists, ...tracks, ...albums];
}

async function searchYouTube(q, env) {
  if (!env.YOUTUBE_API_KEY) throw new Error("YouTube API belum dikonfigurasi di Cloudflare Secrets.");
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", q);
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "10");
  url.searchParams.set("videoCategoryId", "10");
  url.searchParams.set("key", env.YOUTUBE_API_KEY);
  const response = await fetch(url);
  if (!response.ok) throw new Error("YouTube search gagal (" + response.status + ").");
  const data = await response.json();
  return (data.items || []).map(x => ({
    kind: "video", name: x.snippet?.title || "YouTube video",
    detail: x.snippet?.channelTitle || "",
    description: x.snippet?.description || "",
    publishedAt: x.snippet?.publishedAt || null,
    image: x.snippet?.thumbnails?.medium?.url || x.snippet?.thumbnails?.default?.url || null,
    url: "https://www.youtube.com/watch?v=" + x.id.videoId,
    id: x.id.videoId
  }));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, origin);
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname !== "/search") return json({ error: "Not found" }, 404, origin);
    if (origin && origin !== ALLOWED_ORIGIN) return json({ error: "Origin tidak diizinkan" }, 403, origin);
    const q = (requestUrl.searchParams.get("q") || "").trim().slice(0, 100);
    const source = requestUrl.searchParams.get("source") || "both";
    if (q.length < 2) return json({ error: "Masukkan minimal 2 karakter." }, 400, origin);
    if (!["spotify", "youtube", "both"].includes(source)) {
      return json({ error: "Sumber pencarian tidak valid." }, 400, origin);
    }
    const result = {};
    const errors = {};
    const tasks = [];
    if (source === "spotify" || source === "both") {
      tasks.push(searchSpotify(q, env).then(x => result.spotify = x).catch(e => errors.spotify = e.message));
    }
    if (source === "youtube" || source === "both") {
      tasks.push(searchYouTube(q, env).then(x => result.youtube = x).catch(e => errors.youtube = e.message));
    }
    await Promise.all(tasks);
    return json({ query: q, results: result, errors }, 200, origin);
  }
};
