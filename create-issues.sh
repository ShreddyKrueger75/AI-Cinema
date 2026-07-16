#!/bin/bash
# Create GitHub issues from deployment checklist

cd "$(dirname "$0")"

echo "Creating GitHub issues..."

# Issue 1: AUTH_SECRET
gh issue create \
  --title "Set AUTH_SECRET in production environment" \
  --body "BLOCKING: Required for deploy.

AUTH_SECRET must be set in Vercel environment variables before deploying to production. The app will throw on first request without it.

Generate a secure 32-byte secret:
\`\`\`bash
openssl rand -base64 32
\`\`\`

Set as AUTH_SECRET in Vercel project settings → Environment Variables.

See: app/auth.ts:9-11, app/login/page.tsx (error handling)" \
  --label "security,blocking"

# Issue 2: APP_URL
gh issue create \
  --title "Configure APP_URL for password reset email links" \
  --body "BLOCKING: Required for password reset flow to work.

Set either \`APP_URL\` or \`NEXT_PUBLIC_APP_URL\` to your production domain so password reset emails link to the correct host.

The app defaults to Host header (vulnerable to injection) if neither is set. With the security fix, it now reads from env vars.

Examples:
- \`APP_URL=https://cinema.yoursite.com\`
- \`NEXT_PUBLIC_APP_URL=https://cinema.yoursite.com\`

See: lib/app-url.ts, app/forgot-password/page.tsx" \
  --label "security,blocking"

# Issue 3: Provider keys
gh issue create \
  --title "Audit and set all provider API keys before deploy" \
  --body "Verify these are set in Vercel environment:

- REPLICATE_API_TOKEN (for image/motion generation)
- RUNWAY_API_SECRET (for motion generation fallback)
- ELEVENLABS_API_KEY (for VO/music generation)
- POLLINATIONS_API_KEY (for fallback image generation, if used)

The app will gracefully degrade if these aren't set, but users won't be able to generate content.

See: lib/replicate.ts, lib/runway.ts, lib/elevenlabs.ts, lib/generate.ts" \
  --label "configuration,high"

# Issue 4: Vercel KV
gh issue create \
  --title "Configure Vercel KV for production sign-in" \
  --body "User sign-in is currently disabled in production (shows 'Cloud accounts are not configured').

To enable user accounts:

1. Create a Vercel KV database
2. Set these env vars in Vercel:
   - \`KV_REST_API_URL\`
   - \`KV_REST_API_TOKEN\`

Without KV, users can still use the editor without signing in (it works fine as a guest). Sign-in is only needed to sync projects across devices.

See: lib/users.ts, auth.ts, app/signup/page.tsx" \
  --label "configuration,high"

# Issue 5: Replicate URL refresh
gh issue create \
  --title "Cache Replicate signed URLs, refresh on 403" \
  --body "Replicate motion URLs expire after 24 hours. Currently we re-fetch them from IDB at render time, but there's no refresh logic.

If a render job runs >24h after the motion was generated, the URL will 403 and the render fails.

Add:
- 24h TTL tracking on stored URLs
- 403 refresh + retry logic in lib/render.ts
- Fallback to re-fetch from Replicate API if needed

See: lib/asset-store.ts, lib/render.ts" \
  --label "enhancement,medium"

# Issue 6: Transition preservation
gh issue create \
  --title "Custom transition settings lost when reordering sections" \
  --body "When you drag a section to reorder, custom transition settings (type, duration) reset to defaults.

The transition should follow the section it's attached to.

See: lib/store.ts (moveSectionTo), section update logic" \
  --label "bug,medium"

# Issue 7: LUT export
gh issue create \
  --title "Color grading LUT export differs from ffmpeg render" \
  --body "When you export a .cube LUT file, the colors don't match what's rendered in the MP4.

Likely cause: LUT generation vs. ffmpeg grading filter use different color space assumptions or gamma handling.

See: lib/grade.ts (buildCubeLUT), lib/render.ts (ffmpeg color grading filter)" \
  --label "bug,medium"

# Issue 8: File size limits
gh issue create \
  --title "Add file size caps on imports" \
  --body "Prevent abuse by capping:

- Imported project JSON: 50 MB (currently unlimited)
- Imported video/audio: 2 GB (currently unlimited)
- Extracted poster frame (image): 10 MB (currently unlimited)

Add validation in import handlers + show user-friendly errors if exceeded.

See: app/page.tsx (import handlers), lib/serialize.ts" \
  --label "enhancement,low"

echo "✅ All issues created!"
