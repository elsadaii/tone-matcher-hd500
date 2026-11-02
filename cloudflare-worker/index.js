const ALLOWED_ORIGIN = "https://elsadaii.github.io";

let spotifyToken = null;
let spotifyTokenExpiresAt = 0;

function cors(origin) {
  const allowed = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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


const toneAnalysisRateBuckets = new Map();
function encodeBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  }
  return btoa(binary);
}
function parseModelJson(text) {
  const cleaned = String(text || "").trim();
  const first = cleaned.indexOf("{"), last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Model tidak mengembalikan JSON analisis.");
  return JSON.parse(cleaned.slice(first, last + 1));
}
function clampNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
}
function normalizeToneAnalysis(value) {
  const roles = ["clean", "rhythm", "lead", "ambient", "unknown"];
  const gains = ["clean", "edge", "crunch", "high_gain"];
  const allowedEffects = ["compressor", "overdrive", "noise_gate", "chorus", "phaser", "delay", "reverb", "wah"];
  return {
    tone_label: String(value.tone_label || "Audio Tone Estimate").slice(0, 80),
    role: roles.includes(value.role) ? value.role : "unknown",
    gain: gains.includes(value.gain) ? value.gain : "crunch",
    brightness: clampNumber(value.brightness, 55),
    low_weight: clampNumber(value.low_weight, 50),
    mid_focus: clampNumber(value.mid_focus, 55),
    presence: clampNumber(value.presence, 50),
    effects: Array.isArray(value.effects) ? [...new Set(value.effects.map(x => String(x).toLowerCase()).filter(x => allowedEffects.includes(x)))].slice(0, 8) : [],
    confidence: ["low", "medium", "high"].includes(value.confidence) ? value.confidence : "low",
    notes: String(value.notes || "Karakter tone diperkirakan dari audio campuran.").slice(0, 900)
  };
}
async function analyzeToneAudio(request, env, origin) {
  if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY belum dipasang pada Cloudflare Worker." }, 503, origin);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  for (const [key, record] of toneAnalysisRateBuckets) {
    if (now - record.start > 10 * 60 * 1000) toneAnalysisRateBuckets.delete(key);
  }
  const bucket = toneAnalysisRateBuckets.get(ip) || { start: now, count: 0 };
  if (bucket.count >= 4) return json({ error: "Batas sementara tercapai. Coba lagi beberapa menit." }, 429, origin);
  bucket.count += 1;
  toneAnalysisRateBuckets.set(ip, bucket);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Body permintaan bukan JSON yang valid." }, 400, origin); }
  const audio = String(body.audio || "");
  if (body.format !== "wav" || !audio || audio.length > 1050000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) {
    return json({ error: "Cuplikan WAV tidak valid atau terlalu besar (maksimal sekitar 750 KB sebelum base64)." }, 400, origin);
  }
  const video = body.video || {};
  const videoTitle = String(video.title || "Tidak diketahui").slice(0, 180);
  const videoChannel = String(video.channel || "Tidak diketahui").slice(0, 120);
  const metrics = body.metrics && typeof body.metrics === "object" ? body.metrics : {};
  const metricText = key => metrics[key] === undefined || metrics[key] === null ? "n/a" : String(metrics[key]);
  const audioPrompt = [
    "Analyze the actual music audio supplied below for a guitar-tone matching preset for a Line 6 POD HD500.",
    "Listen to the sound, not just the supplied video metadata. The recording may be a full mix, so distinguish audible evidence from uncertainty. Do not claim exact guitar, amp, cabinet, microphone, or pedal models.",
    "Describe the electric guitar tone as heard: clean/edge/crunch/high-gain, rhythmic/lead/ambient/clean role, low-mid-high balance, brightness, mid focus, presence, compression, distortion, modulation, delay, and reverb.",
    "Only list effects when there is audible evidence. Do not infer delay or reverb merely because they are common. If the guitar is not clearly separable, say so and lower confidence.",
    "Use this compact schema and return one valid JSON object only, with no markdown or extra text:",
    '{"tone_label":"short description","role":"clean|rhythm|lead|ambient|unknown","gain":"clean|edge|crunch|high_gain","brightness":0-100,"low_weight":0-100,"mid_focus":0-100,"presence":0-100,"effects":["compressor|overdrive|noise_gate|chorus|phaser|delay|reverb|wah"],"confidence":"low|medium|high","notes":"brief evidence and limitations"}',
    "Video context (not proof of sound): title="+videoTitle+"; channel="+videoChannel+".",
    "Browser measurements for context only: low="+metricText("low")+", mid="+metricText("mid")+", high="+metricText("high")+", centroid="+metricText("centroid")+" Hz, dynamics="+metricText("dynamicsDb")+" dB, estimated BPM="+metricText("bpm")+".",
    "Do not repeat the measurements as if they prove the identity of the guitar sound."
  ].join("\n");
  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": "Bearer " + env.OPENAI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-audio-1.5",
      modalities: ["text"],
      max_completion_tokens: 500,
      store: false,
      messages: [{ role: "user", content: [
        { type: "text", text: audioPrompt },
        { type: "input_audio", input_audio: { data: audio, format: "wav" } }
      ] }]
    })
  });
  const result = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const message = result.error && result.error.message ? result.error.message : "OpenAI API menolak permintaan (" + upstream.status + ").";
    return json({ error: message }, 502, origin);
  }
  const choices = result.choices || [];
  const message = choices[0] && choices[0].message ? choices[0].message : {};
  let responseText = "";
  if (typeof message.content === "string") responseText = message.content;
  else if (Array.isArray(message.content)) responseText = message.content.map(part => part.text || "").join("\n");
  try {
    return json({ analysis: normalizeToneAnalysis(parseModelJson(responseText)), model: "gpt-audio-1.5", stored: false }, 200, origin);
  } catch (error) {
    return json({ error: error.message || "Hasil AI tidak dapat dibaca." }, 502, origin);
  }
}

async function searchYouTube(q, env) {
  if (!env.YOUTUBE_API_KEY) throw new Error("YouTube API belum dikonfigurasi di Cloudflare Secrets.");
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", q);
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "50");
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
    const requestUrl = new URL(request.url);
    if (origin && origin !== ALLOWED_ORIGIN) return json({ error: "Origin tidak diizinkan" }, 403, origin);
    if (requestUrl.pathname === "/analyze-tone") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
      if (origin !== ALLOWED_ORIGIN) return json({ error: "Origin tidak diizinkan" }, 403, origin);
      return analyzeToneAudio(request, env, origin);
    }
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, origin);
    if (requestUrl.pathname !== "/search") return json({ error: "Not found" }, 404, origin);
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
