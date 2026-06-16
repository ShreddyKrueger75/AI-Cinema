# AI Cinema Adversarial Review — 2026-06-16

Reviewer: Mr. Robot (`docs/agents/mr-robot.md`)
Build: `main` @ `dcc7a22`
Verdict: **HOLD**

---

## P0 (cannot ship)

- **`music_segments` never play in preview and never render to MP4** · `app/page.tsx:2361-2366`, `lib/render.ts:394-454`
  Repro: import any audio file via the MUSIC row IMPORT button, hit Play. Silent. Render. The exported `out.mp4` also has no music. Same for the audio extracted from a video import (which gets written into `music_segments` at `app/page.tsx:1577-1585` and is then ignored on every consumer).
  Why P0: a feature shipped two weeks ago (`f8d2a1d`, `e2b6bda`) writes data that the preview and the renderer both silently drop. The user's imported music makes it into the project file and into the timeline UI, but never into anything that plays. Data is preserved, output is wrong.

- **`graphics` overlays never render to MP4** · `lib/render.ts` (no reference to `project.graphics`)
  Repro: load Product Reveal template (which seeds an "Available Now" graphic), click Render. The graphic appears in stage preview but is absent in the exported MP4. This compounds with the v3→v4 title migration (`6e74e7d`): every legacy title section becomes a graphic overlay; every legacy project loses all titles in render after upgrading.
  Why P0: silent visual data loss on every render.

- **Imported videos and images die on page refresh** · `app/page.tsx:1550, 1591, 1463, 1928, 1979, 3993, 4116, 4252`
  Repro: Import a video via the VIDEO row IMPORT, save to library, refresh, reopen. `output_url` is a stale `blob:` URL from the previous page session. The stage shows blank. Render plan throws "motion not generated". The comment at `app/page.tsx:4467` says "blob URLs die on page refresh, breaking every still" for Pollinations stills — yet imports are still using `URL.createObjectURL` and never converting to data URL.
  Why P0: import flow ships work product that is gone after one F5.

- **Generation jobs cannot be cancelled mid-flight; closing the modal orphans the job, results still write to the project** · `app/page.tsx:4415-4699` (no `AbortController` on still/motion/VO/music jobs)
  Repro: Start a Runway gen-4 motion job. Close the FlowPanel modal before it finishes. The pending fetch keeps polling. When it eventually returns, `updateClipVersion(section.id, version.id, { output_url })` writes back. If the user has deleted that section or replaced its content in the meantime, the late write reanimates a deleted section or stomps fresh edits.
  Why P0: undeclared side effects after user-initiated dismissal + user is billed for a job they think they cancelled.

## P1 (breaks a core flow)

- **Host header injection in password reset URL** · `app/forgot-password/page.tsx:30-35`
  Repro: `curl -X POST https://your-deploy/forgot-password -H 'Host: attacker.com' -d 'email=victim@example.com'`. Vercel forwards the `Host` header. The server builds `https://attacker.com/reset-password/<token>` and emails it to the victim. Victim clicks → token leaks to attacker → attacker resets victim's password.
  Why P1: full account takeover via crafted request.

- **`AUTH_SECRET` falls back to a guessable value if env var is unset in production** · `auth.ts:9-11`
  Repro: deploy without setting `AUTH_SECRET`. Secret becomes `ai-cinema-preview-fallback-${VERCEL_GIT_COMMIT_SHA ?? "local"}-do-not-use-in-prod`. Commit SHA is public via GitHub. Anyone can forge JWTs.
  Why P1: silent downgrade to a known secret + no startup assertion that prod has a real one.

- **Open auth-laundering proxy: no origin/CSRF check on `/api/proxy/replicate/*`, `/api/proxy/pollinations/*`, `/api/runway/*`** · `app/api/proxy/replicate/[...path]/route.ts`, `app/api/proxy/pollinations/[...path]/route.ts`, `app/api/runway/generate/route.ts`
  Repro: `curl -X POST https://your-deploy/api/proxy/replicate/v1/predictions -H 'x-provider-key: <attacker-key>' -d '...'`. Server happily relays to Replicate. Anyone in the world can use your Vercel deployment as a relay; you pay the function-invocation cost.
  Why P1: trivially abused, no rate limit, no allow-list.

- **Replicate motion `output_url` stored verbatim, expires in ~24h** · `app/page.tsx:4684-4687`
  Repro: generate a motion via Replicate (e.g. MiniMax). `pred.output` is `https://replicate.delivery/...?token=...` — short-lived signed URL. Stored as-is in the project. Wait 24h. Reload. Video is 403, render fetches fail.
  Why P1: stills use `fetchAsDataUrl(url)` to inline, motions don't. Asymmetric. Comment in code (line 4553-4554) acknowledges the issue for stills but the same fix isn't applied to motion outputs.

- **`extractVideoPosterDataUrl` and `measureAudioDuration` can hang forever** · `app/page.tsx:395-432, 434-454`
  Repro: import a corrupted .mp4 (truncated mid-stream). Neither `loadeddata` nor `error` fires in some browsers. Promise never resolves. The `await` in the import handler hangs. User clicks IMPORT a second time, queue another hung promise. No timeout, no race against `setTimeout`.
  Why P1: a malformed file silently bricks the import surface until reload.

- **`pickFile()` Promise never resolves on Cancel** · `app/page.tsx:303-311`
  Repro: click IMPORT, click Cancel in the file picker. `input.onchange` never fires. Calling promise pending forever. Closure retains state. Re-importing works (new picker, new promise) but the prior chain leaks.
  Why P1: every import button has this. Memory leak proportional to user impatience.

- **No file-size cap on imports** · `app/page.tsx:1538-1594, 1921-1939, 1971-1989, 4242-4271`
  Repro: import a 4GB video. `URL.createObjectURL` succeeds. `extractVideoPosterDataUrl` runs through the browser. Then `renderProject` calls `fetchFile(blob:url)` which allocates a 4GB Uint8Array inside ffmpeg.wasm. Tab OOM-crashes.
  Why P1: no validation before render, no warning, hard crash.

- **`importProjectJSON` accepts garbage; bypasses migration** · `lib/serialize.ts:11-30`
  Repro 1: craft `{"schema_version":1,"id":"x","name":"x","aspect":"9:16","sections":[{"id":"a","type":"clip","duration_s":"five",...}]}`. Imports fine. NaN propagates through every layout calc.
  Repro 2: export an old v1 project (with `type: "title"` sections), import it back into a current build. The persisted-store migration `migrateTitleSectionsToGraphics` only runs on `useStore.persist.rehydrate`; `setProject(importedJSON)` bypasses it. Title sections survive intact, which conflicts with the post-migration assumption that title sections no longer exist.
  Why P1: import surface is the JSON file format, and the validator is one shallow `in` check.

- **Auth.js error string surfaced raw to UI** · `app/login/page.tsx:39-44`
  Repro: enter wrong password. UI shows: "⚠ Read more at https://errors.authjs.dev#credentialssignin". No `if (err.type === "CredentialsSignin") show("Invalid email or password.")`.
  Why P1: the worst possible auth UX, leaks framework identity, broken on first impression.

- **Pollinations and Replicate signing — confused-deputy in proxy** · `app/api/proxy/replicate/[...path]/route.ts:23-25`
  Repro: `POST /api/proxy/replicate/some/path/here?evil=true` — the path and query are concatenated raw. Encoded `..` segments (`%2e%2e/`) and embedded `@` in the path would attempt to swap host. WHATWG URL parsing on `https://api.replicate.com/foo@evil.com/bar` resolves to `api.replicate.com` host (with `foo@evil.com/bar` as path), so this specific vector is contained. But there is no positive validation that the final URL stays on `api.replicate.com`. One Next.js routing change away from SSRF.
  Why P1: defense-in-depth missing; assertion would be one line.

## P2 (ugly / surprising)

- **Custom transitions silently reset to default crossfade on section reorder** · `lib/store.ts:181-203` (`reconcileTransitions`)
  Repro: change the transition between sections 2 and 3 to `fade_black`. Drag section 2 to position 4. The transition that was 2→3 is now (whatever)→(whatever-else); `reconcileTransitions` doesn't find a matching `from/to`, inserts default `crossfade 0.4`.

- **Admin reset secret check is not timing-safe** · `app/admin-reset/page.tsx:32`
  `if (secret !== expected)` — should be `crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected))`. Practically hard to exploit over the open internet, but trivial to fix.

- **No rate limit on `forgot-password`, `signup`, `login`, `admin-reset`, or any proxy route** · all under `app/`
  Email enumeration via signup latency. Password-reset email bombing — Resend free tier exhausts quickly.

- **Imported v1 project JSON bypasses store migration** · `app/page.tsx:1143` + `lib/store.ts:790-797`
  `setProject(result.project)` plugs the raw JSON straight in. The `migrate` function only runs through `persist.rehydrate`.

- **Music ducking only handles `music_track`, doesn't compound across overlapping VO** · `app/page.tsx:2430-2441`

- **VO `<audio>` elements use `output_url` as data URL** · `app/page.tsx:2450-2459`
  Re-mounting an `<audio>` for every VO segment in the project — even if VO is not in the current window — preloads every clip into memory.

- **Stage video resets to `currentTime = 0` on every play toggle** · `app/page.tsx:2895-2906`
  Video starts from frame 0 even when entering its section mid-playhead, while audio plays from the correct offset.

- **`removeGraphic`, `removeVOSegment`, `removeMusicSegment`, `removeStill`, `removeClipVersion` all delete without confirmation** · `app/page.tsx:3894, 4005, 4131, 5262, etc.`
  Clip deletion uses `confirmAsk`. The other six destructive deletes don't.

- **Render preview throttles in background tabs** · `app/page.tsx:881-920`
  Background-tabbed preview desyncs. Audio elements keep playing through.

- **Re-import of a clip doesn't revoke the previous `blob:` URL** · `app/page.tsx:4252-4271`
  Old object URL leaks.

- **`renderTitleCardPng` measures text with whatever font is currently loaded** · `lib/render.ts:69-119`
  No `document.fonts.ready` await. Canvas falls back to system font, measurements wrong.

- **Waveform decode cache has no eviction** · `lib/waveform.ts:5`

- **`buildCubeLUT` math does NOT match `buildFFmpegGradeFilter`** · `lib/grade.ts:92-207`
  `.cube` export uses the rich `applyGrade`. Render uses `eq + colorbalance + curves`. Two different transforms. Exported LUT applied in a real NLE produces a visibly different image than `out.mp4`.

- **`crossfade` and `cut` both render as `xfade=transition=fade`** · `lib/render.ts:352-353`
  A "cut" is actually a 40ms fade.

- **History debounce loses entries on unmount during pending window** · `app/page.tsx:560-562`

- **History is in-memory only** · `lib/history.ts`
  Refresh wipes undo.

- **`schema_version` constant is `1` in code but persistence migration is at `4`** · `lib/types.ts:132`, `lib/store.ts:789`
  Two different versioning schemes for the same data model.

- **Free Ken-Burns path bypasses the Pollinations proxy even when a token is set** · `app/page.tsx:4587-4598`

- **localStorage quota silently exceeded** · `lib/store.ts` + zustand persist
  Zustand `persist` doesn't surface `QuotaExceededError`.

- **Migration crashes editor if a v3 title section has `duration_s` undefined / NaN** · `lib/store.ts:100-154`

## P3 (nit)

- `console.warn` calls remain in production · `app/page.tsx:2395, 2421, 2901`
- `pendingHistoryPush.current` cleanup runs on every mount/unmount cycle
- `addClipSection` then `useStore.getState().setActiveSection(null)` immediately after is fragile
- The "RESET PROJECT" `confirmAsk` doesn't mention the destroyed history
- `crypto.randomUUID().slice(0,8)` collides after ~3000 IDs (~birthday on 32-bit)
- `gradeToCssFilter` uses `hue-rotate` to approximate tint
- `extractVideoPosterDataUrl` sets `video.currentTime = 0.1` before any media is loaded
- Edit modal "RESET PROJECT" wipes provider keys-required prompts state but not the keys
- The default project sets `schema_version: 1` but `revision: 3`

## What I could not test

- **Live API failures**: 401 / 429 / 5xx from Replicate / Runway / ElevenLabs / Pollinations
- **Actual host-header injection on Vercel** behavior behind the proxy
- **`fadeblack` xfade availability** in `@ffmpeg/core@0.12.10` minimal build
- **Mobile gate behavior under live resize**
- **localStorage quota limits**
- **Token-replay on password reset**: `consumePasswordResetToken` does `kv.get` then `kv.del` non-atomically
- **Auth.js `redirectTo` validation**
- **`<input type="file">` Cancel event behavior cross-browser**
- **xfade timing on cumulative offset**: float drift over many sections

---

**Verdict: HOLD**
