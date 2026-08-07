# AI Cinema

**Cinematic video, made easy. Bring your own model.**

A free, browser-based AI video creation tool from [Bloody Finger Software](https://bloodyfinger.software). Build cinematic short-form video on a timeline. Generation calls go directly from your browser to provider APIs using your own keys — nothing runs on an AI Cinema server.


## Run it

```
pnpm install
pnpm dev
```

Open `http://localhost:3000`. The first paint is fully usable with **zero keys** — Pollinations (free) for stills, Ken Burns CSS for motion. Add keys via the **🔑 Keys** dialog to switch on real providers.

## What works today

- **Timeline** — sections, transitions, audio tracks, grade strip, project header. Click anything to edit it inline.
- **Video → Storyboard** — drop a video and edit it as a storyboard. Shot detection runs locally (`ffmpeg.wasm` dense sampling + diff-based keyframe selection, ported from [movie-digest](https://github.com/ShreddyKrueger75/movie-digest)); with an Anthropic key, **Claude watches the keyframes** and writes each shot's title, description, and regeneration prompts. Edit any card by text or thumbnail — retitle, rewrite, reorder, merge, delete, retime — then apply it to the timeline as a real project, keyframes as stills.
- **Stage 1 + Stage 2 flow** — image prompt → still → motion prompt → clip, per the spec's two-stage clip model.
- **Versions** — keep multiple takes per section, switch the active one from the timeline.
- **Briefs / Grades / Music / Title styles** — four "feel" layers, each with a library of built-ins plus your own saves.
- **Templates** — Product Reveal, Title card only, Tutorial (16:9), Dark drop (neo-noir bundle), Blank canvas.
- **Live providers** (BYOM, calls go direct from browser to provider):
  - Stills via **Replicate** — Flux 1.1 Pro, Flux Schnell, SDXL, Ideogram v2.
  - Motion via **Replicate** — MiniMax Video-01 (image-to-video).
  - Voice via **ElevenLabs** TTS.
  - Music via **ElevenLabs Music**.
  - Vision via **Anthropic** — Claude Opus 5 watches uploaded footage for the storyboard flow.
- **Render** — full `ffmpeg.wasm` pipeline: xfade transitions, VO + music mix, grade applied as a 3D LUT, MP4 export with `+faststart`.
- **Persistence** — Zustand + localStorage for project, providers, and library. Export / import projects as JSON. Keys are never in the export.

## Cloud accounts (optional)

The editor works without login. Signing in adds cross-device sync for the project library and feel-layer presets.

Auth.js v5 + Vercel KV is the backend. To enable accounts on your deploy:

1. **Vercel dashboard → Storage → Create Database → KV.** Connect it to the project — that sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.
2. **Set `AUTH_SECRET`.** Generate one with `openssl rand -base64 32` and paste it into the project's Environment Variables.
3. Redeploy. `/signup` and `/login` are live; the status bar gains a `SIGN IN` link, then a `you@email` chip with sign-out once authenticated.

If `KV_REST_API_URL` is unset, the auth UI still renders but sign-up/sign-in returns a friendly "cloud accounts not configured" error.

## Stack

- Next.js 15 (App Router) + TypeScript strict
- React 19
- Auth.js v5 (`next-auth@5`) + Vercel KV + bcryptjs for email/password accounts
- Zustand for state (sliced: project, providers, library, gen-state, history, toasts)
- Tailwind v4 for tokens
- `@ffmpeg/ffmpeg` 0.12 for the render pipeline (needs COOP/COEP — set in `next.config.ts`)
- Vercel static deploy

## License

MIT. See `LICENSE`.

Built for the love of the game.
