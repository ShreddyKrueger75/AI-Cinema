# AI Cinema — Bloody Finger website blurb

## AI Cinema

**Browser-based AI video editor for the BYOM era.**

Build cinematic shorts without leaving the browser. Storyboard scenes on a timeline, generate stills and motion with the models you already pay for (Replicate, Runway, ElevenLabs, Pollinations), drop in your own footage, mix voiceover and music tracks, color-grade the whole thing, then render an MP4 — all client-side with ffmpeg.wasm.

**What you get:**
- Premiere-style timeline with VIDEO, GRAPHICS, VOICEOVER and MUSIC tracks
- Bring-your-own-model: Replicate, Runway, ElevenLabs, Pollinations, more
- Import your own video, audio, and images — they letterbox cleanly into any aspect (9:16, 16:9, 1:1)
- Per-segment music and voiceover generation with prompt control
- True color grading with downloadable .cube LUT
- Title cards via Google Fonts, graphic overlays, crossfade / fade-to-black transitions
- 7 starter templates: Product Reveal, Social Story, YouTube Pre-Roll, Tutorial, Brand Anthem, Logo Reveal, Blank Canvas

**Zero-server stance.** Your API keys live in your browser, not on our servers. Calls go direct from your browser to the provider (Replicate and Runway relay through a thin proxy because they block CORS — keys transit in memory per request, never stored or logged).

**Free on GitHub.** [github.com/shreddykrueger75/ai-cinema](https://github.com/shreddykrueger75/ai-cinema) — clone it, fork it, deploy it, break it. MIT licensed.

Try it: **[ai-cinema-red.vercel.app](https://ai-cinema-red.vercel.app)**

*Built for the love of the game. — Bloody Finger Software*
