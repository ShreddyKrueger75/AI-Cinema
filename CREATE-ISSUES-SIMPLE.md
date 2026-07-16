# How to Create GitHub Issues - Simple Version

## What You Need First

1. Open your terminal
2. Make sure you're in the Cinema AI folder:
```
cd /Users/johnlacroix/Claude\ Projects/Cinema\ AI
```

3. Check if you can use GitHub from terminal:
```
gh auth login
```
   - If it asks you to log in, follow the instructions
   - If it works fine, you're good to go

## The Easy Way (Recommended)

Just copy-paste this ONE command and hit Enter:

```bash
bash create-issues.sh
```

That's it. It will create all 8 issues for you automatically.

---

## The Hard Way (If the script doesn't work)

If the script fails, you can create each issue one at a time.

### Issue #1: AUTH_SECRET (do this first)

Copy and paste this entire block:

```bash
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
```

### Issue #2: APP_URL

```bash
gh issue create \
  --title "Configure APP_URL for password reset email links" \
  --body "BLOCKING: Required for password reset flow to work.

Set either \`APP_URL\` or \`NEXT_PUBLIC_APP_URL\` to your production domain so password reset emails link to the correct host.

Examples:
- \`APP_URL=https://cinema.yoursite.com\`
- \`NEXT_PUBLIC_APP_URL=https://cinema.yoursite.com\`

See: lib/app-url.ts, app/forgot-password/page.tsx" \
  --label "security,blocking"
```

### Issue #3: Provider Keys

```bash
gh issue create \
  --title "Audit and set all provider API keys before deploy" \
  --body "Verify these are set in Vercel environment:

- REPLICATE_API_TOKEN
- RUNWAY_API_SECRET
- ELEVENLABS_API_KEY
- POLLINATIONS_API_KEY

See: lib/replicate.ts, lib/runway.ts, lib/elevenlabs.ts, lib/generate.ts" \
  --label "configuration,high"
```

### Issue #4: Vercel KV

```bash
gh issue create \
  --title "Configure Vercel KV for production sign-in" \
  --body "User sign-in is currently disabled in production.

To enable user accounts:

1. Create a Vercel KV database
2. Set these env vars in Vercel:
   - \`KV_REST_API_URL\`
   - \`KV_REST_API_TOKEN\`

See: lib/users.ts, auth.ts, app/signup/page.tsx" \
  --label "configuration,high"
```

### Issue #5: Replicate URL Refresh

```bash
gh issue create \
  --title "Cache Replicate signed URLs, refresh on 403" \
  --body "Replicate motion URLs expire after 24 hours. If a render job runs >24h after the motion was generated, the URL will fail.

Add 403 refresh + retry logic in lib/render.ts.

See: lib/asset-store.ts, lib/render.ts" \
  --label "enhancement,medium"
```

### Issue #6: Transition Preservation

```bash
gh issue create \
  --title "Custom transition settings lost when reordering sections" \
  --body "When you drag a section to reorder, custom transition settings reset to defaults.

The transition should follow the section it's attached to.

See: lib/store.ts" \
  --label "bug,medium"
```

### Issue #7: LUT Export

```bash
gh issue create \
  --title "Color grading LUT export differs from ffmpeg render" \
  --body "When you export a .cube LUT file, the colors don't match what's rendered in the MP4.

See: lib/grade.ts, lib/render.ts" \
  --label "bug,medium"
```

### Issue #8: File Size Limits

```bash
gh issue create \
  --title "Add file size caps on imports" \
  --body "Prevent abuse by capping:

- Imported project JSON: 50 MB
- Imported video/audio: 2 GB
- Extracted poster frame: 10 MB

See: app/page.tsx, lib/serialize.ts" \
  --label "enhancement,low"
```

---

## What You're Actually Doing

You're telling GitHub to create 8 to-do items (called "issues") on your project. Each one is a task that needs to be done before the app goes live.

- **BLOCKING** = Must do before shipping
- **HIGH** = Should do before shipping
- **MEDIUM** = Do soon after shipping
- **LOW** = Nice to have eventually

---

## What to Do If Nothing Works

If none of this works:
1. Go to GitHub.com
2. Go to your Cinema AI repository
3. Click "Issues" tab
4. Click "New Issue" button
5. Manually type the title and description from the DEPLOYMENT-ISSUES.md file

It's slower but it'll work.
