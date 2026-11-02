# Spotify + YouTube search Worker

This Cloudflare Worker provides a small search proxy for Tone Matcher HD500.
It keeps Spotify and YouTube credentials out of the public GitHub Pages frontend.

## 1. Create API credentials

- Spotify: create an app in the Spotify Developer Dashboard and copy its Client ID and Client Secret.
- YouTube: create a Google Cloud project, enable YouTube Data API v3, and create an API key. Restrict the key to YouTube Data API v3 where possible.

## 2. Deploy the Worker

1. Open Cloudflare Dashboard → Workers & Pages → Create → Worker.
2. Create a Worker named `tone-matcher-search`.
3. Paste the contents of `cloudflare-worker/index.js` into the editor and deploy.
4. Open Worker Settings → Variables and Secrets.
5. Add these as **Secret** values (not plain text variables):
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`
   - `YOUTUBE_API_KEY`
6. Deploy the Worker again after adding secrets.
7. Copy the Worker URL, for example `https://tone-matcher-search.<your-subdomain>.workers.dev`.

## 3. Endpoint

GET `/search?q=Metallica&source=both`

- `source=spotify`: Spotify artists, tracks, and albums
- `source=youtube`: YouTube videos
- `source=both`: both services

The only allowed browser origin is currently `https://elsadaii.github.io`.

## Notes

- This Worker is a search integration, not a verified POD HD500 preset database.
- Spotify and YouTube results identify reference artists, songs, albums, and videos. Tone values remain application-generated starting points.
- Do not commit API keys or paste them into the public GitHub repository.
- Cloudflare Workers Free currently has a daily request quota; check Cloudflare's current limits before high-volume use.


## 4. Enable real YouTube tab audio analysis

The Tone Matcher page can capture a short audio-only recording from a YouTube browser tab after the user explicitly chooses the tab and shares its audio. It converts a short excerpt to mono WAV in the browser and sends that excerpt to this Worker. The Worker forwards it to OpenAI's gpt-audio-1.5 model and returns a structured tone description. The model request uses store=false; normal API data-handling terms still apply.

1. In Cloudflare Dashboard, open the Worker that serves tone-matcher-api.elsadaiprivat.workers.dev.
2. Replace its source with the updated cloudflare-worker/index.js from this repository and deploy.
3. Under Worker Settings → Variables and Secrets, add OPENAI_API_KEY as a Secret. Never add the key to index.html or commit it.
4. Deploy the Worker again and reload the Tone Matcher site.

The endpoint is POST /analyze-tone. If the secret is missing or the updated Worker has not been deployed, the page still creates a clearly labelled local-analysis fallback preset; it does not label the fallback as AI.

The browser captures approximately 15 seconds, converts at most 12 seconds to 24 kHz mono WAV, and limits the request size. The Worker includes a lightweight per-IP request guard; configure a Cloudflare Rate Limiting rule for /analyze-tone as an additional cost safeguard. OpenAI API usage is billed separately from ChatGPT subscriptions. The model may still be uncertain when guitar is buried in the full mix; this does not isolate guitar stems.
