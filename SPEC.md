# AI Cinema

**Cinematic video, made easy. Bring your own model.**

A browser-based AI video creation tool. Build cinematic short-form video on a timeline. Generation calls go directly from the user's browser to provider APIs using the user's own keys. Nothing runs on an AI Cinema server. Free. MIT. Built for the love of the game.

The sister product to TheAdBench.AI in the Bloody Finger Software family.

---

## Pedigree

This reconciles two earlier drafts:

- The **AI Cinema / Bloody Finger** spec — Next.js, BYOM-only, `ffmpeg.wasm`, Section/Version model, Brief/Grade/Music/Title layers. Matches the mockup at `docs/mockup.html`.
- An earlier **Cinema AI** brain-dump — React+Reactflow, Anthropic prompt-to-project scaffold, Scene/Shot model, Character/Environment libraries, "house models."

Where they conflict, the Bloody Finger spec wins because the mockup commits to it. Good ideas from the brain-dump survive in altered form — see **Ideas folded back in** at the end.

---

## Mental model

The timeline IS the cut. A project is a horizontal sequence of **sections**. Click a section to open its **flow panel**. Render = stitch the active version of each section, apply transitions, layer audio, finish with a grade.

No nodes. No wires. Not a graph editor.

```
0:00      0:03      0:06      0:09      0:12      0:15      0:18
├─────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
 01   ◇   02   ◇   03   ◇   04   ◇   05   ◇   06
 Open fade Rev. cut Det. fade Brl. cut Title fade CTA
 v2 ▾     v1 ▾     v3 ▾     v1 ▾     —        —

 ▒▒▒▒▒  ▒▒▒▒▒▒▒▒  ▒▒▒▒▒▒  ▒▒▒▒▒▒▒▒▒▒▒    ← VO segments
 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓     ← music bed
                            ▓▓ GRADE: Warm Cinematic ▓▓
```

---

## Sections, versions, two-stage clip generation

Two section types:

- **`clip`** — generates a video in two stages
- **`title`** — text card, FFmpeg-rendered, no AI

Every clip is built in two stages, because video gen is slow and expensive — get the image right, then commit to motion:

1. **Still** — image prompt → image gen → pick a still
2. **Motion** — motion prompt → video gen (img-to-vid) → clip

**Stills are intermediate. Versions are clip-level.** Each clip version records which still it came from. Drop your own image into Stage 1 to skip image gen entirely (product photo, brand asset, etc.).

The **last frame of each clip auto-pipes** into the next section's Stage 1 input for free shot-to-shot continuity. The user can override.

---

## The four "feel" layers

Project-wide identity. All four save to libraries — build once, reuse forever.

| | What it controls | Saved as |
|---|---|---|
| **Brief** | Generation consistency — injected into every image and motion prompt | `Library / Briefs` |
| **Grade** | Color finishing pass (FFmpeg, not AI) | `Library / Grades` — exportable as `.cube` LUT |
| **Music** | Project-wide audio bed | `Library / Music` (prompt + reference) |
| **Title style** | Font, color, motion preset for title cards | `Library / Titles` |

Future move: bundle all four as a single **Look** preset.

The brain-dump's "Character" and "Environment" libraries are subsumed by **Brief** for v1 — a Brief carries named entities and reference image URLs. Standalone Character/Environment libraries are a v2 consideration.

---

## Transitions

FFmpeg-native, zero cost. Three types only:

- **Cut**
- **Crossfade** (0.4s default — the cinematic default)
- **Fade to black**

---

## Audio

Two tracks:

- **VO segments** — per-section optional, TTS-generated, auto-fits to clip duration
- **Music bed** — one continuous track for the project, ducks −6dB under VO

---

## Render

Everything happens in the browser via `ffmpeg.wasm`:

1. Concatenate active version of each section
2. Apply transitions at boundaries
3. Mix VO segments at their timecodes
4. Layer music, auto-duck under VO
5. Apply Grade as final color filter
6. Output MP4

Zero AI Cinema infra. The user's machine does the encoding. The user's keys pay the providers.

---

## Data model

```
project       → sections[], transitions[], vo_segments[], music_track?,
                grade?, brief?, title_settings?, aspect, duration
section       → type ('clip' | 'title'), versions[], duration
version (clip)  → still_ref + motion_config + output_url
version (title) → text + style + output_url
still         → image_prompt, model, input_ref?, output_url
transition    → from, to, type ('cut' | 'crossfade' | 'fade_black'), duration
vo_segment    → text, voice, start, duration, output_url, versions[]
music_track   → prompt, model, output_url, versions[]
grade         → adjustments (JSON), name, thumbnail
brief         → visual, lighting, camera, palette, subject, avoid, name, refs?
```

Stills are listed separately because a single still can back multiple clip versions (try different motions on the same image). Eight-ish entities. Fits in localStorage for a typical project (~200KB without binary blobs; blobs go to IndexedDB once we add them).

---

## State + persistence

- **In-memory:** Zustand store, sliced by concern (project, library, providers, render)
- **Persistence:** localStorage v1; swap to IndexedDB when reference images push us past ~5MB
- **No server-side persistence.** Projects export as `.json` for backup/share

Zustand is the one piece preserved from the brain-dump's stack — it's a persistence-agnostic state library, doesn't conflict with the BYOM/zero-infra stance.

---

## Providers (defaults)

| Surface | Model | Notes |
|---|---|---|
| Image | Flux 1.1 Pro (via Replicate) | Cheap, fast, top quality |
| Video | Runway Gen-4 (img-to-vid) | Best continuity, mature API |
| Voice | ElevenLabs | Distinct voices, fast |
| Music | ElevenLabs Music | Length-matches project. Fallback: Stable Audio via Replicate |
| Grade | FFmpeg | Free, deterministic, exports `.cube` |
| Titles | FFmpeg + Canvas | Free, fast, no AI |

**BYOM only in v1.** All keys live in browser localStorage. Calls go direct from user's browser to provider. Nothing proxied through any AI Cinema server. The brain-dump's "house models" (pre-wired demo keys for friction-free trial) are a v2 consideration and would need strict per-user caps to avoid the video-cost trap.

---

## Stack

- Next.js (App Router) + TypeScript
- React (no Reactflow — timeline is not a graph)
- Zustand for state
- Tailwind for styling
- `ffmpeg.wasm` for render
- localStorage v1; IndexedDB swap when needed
- Vercel static deploy
- MIT license

---

## What AI Cinema is not

- Not a node graph (no spaghetti wires)
- Not a power-user tool (curated nodes, no plugin system)
- Not generic AI art (cinematic, not anime/illustration)
- Not free-because-VC-paid (free because BYOM — providers pay providers)
- Not a startup (a craft project; ship when it's right)

---

## Defaults that ship cinematic out of the box

- 9:16 aspect, 18s total length, 6 × 3s clips
- Crossfade transitions, 0.4s
- Brief pre-loaded: `"warm 35mm hero, photoreal, golden hour, soft side light, shallow focus, cinematic photography, no logos, no text"`
- Grade pre-loaded: `Warm Cinematic` (warm mids, crushed blacks, teal shadow tint)
- Music prompt seed: `"slow cinematic build, low piano, distant strings, no drums"`
- Title font: JetBrains Mono Bold, Bone on Black

A user with API keys configured can hit **GENERATE** on a fresh project and get a cinematic-feeling 18s video on the first try. **That's the bar.**

---

## Build order

**Done:**
- Spec (this doc)
- Mockup at `docs/mockup.html`

**Next, in order:**

1. **Scaffold** — Next.js + TS + Tailwind + Zustand. Port mockup to `/` as a static page using design tokens lifted from the mockup CSS.
2. **State management** — project CRUD in Zustand, persist to localStorage, JSON import/export.
3. **Section flow panel** — Stage 1 → Stage 2 UI, version switching, no live gen yet.
4. **Provider settings page** — key entry, validation, never logged.
5. **First live integration:** Flux 1.1 Pro for stills.
6. **Runway Gen-4** for motion.
7. **ElevenLabs** voice.
8. **ElevenLabs Music**.
9. **Render pipeline** (`ffmpeg.wasm`) — concatenate, transitions, audio mix, grade.
10. **Grade library** + `.cube` LUT export.
11. **Brief library** + auto-prompt-injection into every gen call.
12. **Title sections** + FFmpeg render.
13. **Templates + library starters**.
14. **Public beta** — deploy to Vercel, MIT license, ship.

One thing at a time. Don't add fancy before the core pipeline works.

---

## Ideas folded back in (from the Cinema AI brain-dump)

**Carried forward in altered form:**

- **Zustand** for in-memory state (kept as-is — orthogonal to localStorage persistence)
- **Character/Environment consistency** — collapsed into the Brief layer with named entities + reference images. Standalone libraries can come in v2 if Brief proves too coarse.
- **Anthropic prompt-to-project scaffold** ("describe your commercial, get a starter project") — deferred to v2 as an onboarding flow. Compelling but not on the critical path; the timeline + render loop has to work first. Worth pulling forward if v1 ships smoothly.

**Dropped:**

- React + Reactflow (the timeline is not a graph)
- Server-side ffmpeg (defeats the BYOM/zero-infra stance)
- House models (BYOM only in v1)
- Scene → Shot hierarchy (Section → Version is simpler and matches the mockup)
- Project-scoped Character/Environment/Style libraries as distinct types (folded into Brief)

---

## Working agreement

PRs stay draft until explicitly approved. Never commit to main. Surface problems, don't invent solutions. Read actual diffs/logs, not summaries. Side-quest bugs become issues, they don't derail the current PR.
