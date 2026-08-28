# Race Engineer - Cloudflare MVP

This folder is the temporary online Race Engineer UI/API.
It does not modify the existing `index.js` collector.

## Cloudflare deployment

Project root for Cloudflare: `race-engineer`
Deploy command: `npm run deploy`

Required Worker secrets:
- `SUPABASE_URL`
- `SUPABASE_KEY`

Optional variable in wrangler.toml:
- `DEFAULT_RACE_ID = "1"`

The UI is served by the same Worker and uses API routes:
- `/api/live`
- `/api/stints`
- `/api/drivers`
- `/api/pits`
- `/api/health`

## Security

Do not commit `.env`. The Supabase key is configured as a Cloudflare Worker secret and never sent to the browser.

## Current purpose

This first deployment makes the Race Engineer UI publicly accessible and lets us build/test against the real stored Supabase race data.
The existing Apex collector is still separate until the collector migration step.
