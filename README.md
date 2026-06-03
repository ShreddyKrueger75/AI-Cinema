# AI Cinema

**Cinematic video, made easy. Bring your own model.**

A free, browser-based AI video creation tool from [Bloody Finger Software](https://bloodyfinger.software). Build cinematic short-form video on a timeline. Generation calls go directly from your browser to provider APIs using your own keys — nothing runs on an AI Cinema server.

Sister product to [TheAdBench.AI](https://theadbench.ai).

## Run it

```
pnpm install
pnpm dev
```

Open `http://localhost:3000`. The first paint is fully usable with **zero keys** — Pollinations (free) for stills, Ken Burns CSS for motion. Add keys via the **🔑 Keys** dialog to switch on real providers.

## What works today

- **Timeline** — sections, transitions, audio tracks, grade strip, project header. Click anything to edit it inline.
- **Stage 1 + Stage 2 flow** — image prompt → still → motion prompt → clip, per the spec's two-stage clip model.
- **Versions** — keep multiple takes per section, switch the active one from the timeline.
- **Briefs / Grades / Music / Title styles** — four "feel" layers, each with a library of built-ins plus your own saves.
- **Templates** — Product Reveal, Title card only, Tutorial (16:9), Dark drop (neo-noir bundle), Blank canvas.
- **Live providers** (BYOM, calls go direct from browser to provider):
  - Stills via **Replicate** — Flux 1.1 Pro, Flux Schnell, SDXL, Ideogram v2.
  - Motion via **Replicate** — MiniMax Video-01 (image-to-video).
  - Voice via **ElevenLabs** TTS.
  - Music via **ElevenLabs Music**.
- **Render** — full `ffmpeg.wasm` pipeline: xfade transitions, VO + music mix, grade applied as a 3D LUT, MP4 export with `+faststart`.
- **Persistence** — Zustand + localStorage for project, providers, and library. Export / import projects as JSON. Keys are never in the export.

## Stack

- Next.js 15 (App Router) + TypeScript strict
- React 19
- Zustand for state (sliced: project, providers, library, gen-state)
- Tailwind v4 for tokens
- `@ffmpeg/ffmpeg` 0.12 for the render pipeline (needs COOP/COEP — set in `next.config.ts`)
- Vercel static deploy

## License

MIT. See `LICENSE`.

Built for the love of the game.
