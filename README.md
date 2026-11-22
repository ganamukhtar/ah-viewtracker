# Aggregated views

A standalone America House viewership page. It totals recorded views across the movement’s TikTok, Instagram, YouTube, and X accounts, in the same visual system as the public counter on [america.co/quests](https://america.co/quests): navy field, gold title, green live dot, cream figure.

The page is static HTML and vanilla ES modules, plus a small Node collector, so it can later move into the america.co site at a path like `/views`.

Creator accounts are in the data and are included in the home total. Category and platform both start on All. A platform that has not been read is left blank. It is never stored or added as zero.

## Run locally

```bash
npm install
npm start
```

Open [http://127.0.0.1:8741](http://127.0.0.1:8741). The dev server uses port 8741 so it does not collide with other apps.

```bash
npm test
TIKTOK_PUBLIC=1 npm run collect
```

`npm test` checks the counting rules. `npm run collect` refreshes `data/snapshot.json`. Copy `.env.example` to `.env` to turn collectors on; the file is gitignored.

## What the page does

The home hero is every account on every platform. Category and platform both start on All, so Creators are included and the hero totals cover every account. The gold title stays “The movement’s total viewership.” Under the red view total are followers, likes, and comments for the same accounts. A metric with no reading is left blank.

The view total is a whole number. On load, the red total and the follower, like, and comment tiles count up from zero to the live value with an ease-out over about 2.25 seconds, then the view total steps up once a second as estimated views accumulate. That count-up lands on the live projected value. Reduced motion shows the live total immediately. After the opening count-up, the count never steps down. A higher snapshot eases in. Followers, likes, and comments then show the latest recorded totals for the current filter.

**See all accounts** opens [/accounts](/accounts), a separate page with a compact total. Category and platform chips are multi-select. All is exclusive: choosing All clears the others, choosing a specific chip clears All, choosing a selected chip again turns it off, and an empty selection falls back to All. The default chips are All and All. Search still matches the name and the handle.

## Seed snapshot

`data/snapshot.json` was collected at `2026-11-22T00:58:52.371Z` with `TIKTOK_PUBLIC=1` and no API keys. Every number in it was read from a public TikTok profile or TikTok’s public embed. Nothing was filled in by hand.

**TikTok returned real data for every configured TikTok account. YouTube, Instagram, and X are Not connected** until their keys are set.

In that seed, the quests-and-fan total was **11,007 views**. Five of the 24 accounts in that cohort have a view report:

| Account | Views | How it was read |
| --- | ---: | --- |
| Quest for World Peace | 6,335 | All 7 public videos |
| America House DC | 4,516 | 10 of 39 videos, partial |
| America Clipping | 124 | The 1 public video |
| Brandon Conceicao Podcast | 32 | 10 of 23 videos, partial |
| Brandon Debates | 0 | Public profile lists no videos |

Partial means TikTok’s embed did not return every video on the profile, so the play sum is real and incomplete. It is included in the total and labeled. Followers and likes on those profiles are the profile totals, not a sample. America House DC, for example, was 113 followers and 910 likes.

Creator accounts were read in the same pass and are included in the hero by default. Public examples: @ganadelrey about 1,151,076 plays, 3,000,000 likes, and 13,400 followers; @robnelsonlive 398,218 plays and 180,100 likes; @talktometaylor 58,000 likes and 1,889 followers; @evolutionarybrandon 19,516 plays. Those play totals are the public embed’s list, so several are partial.

Each TikTok platform also stores a `viewsPerSecond` pace from post age and play count. The view total uses that pace until a later snapshot shows a measured gain, and only displays whole views.

## Environment variables

Collectors run only when their variables are present. A missing key does not zero out the last good reading.

| Variable | Unlocks |
| --- | --- |
| `YOUTUBE_API_KEY` | YouTube Data API v3 `channels.list` statistics: lifetime views and subscribers. Also reads likes and comments on the latest public videos. Those recent sums are shown on the account and are **not** added to the likes or comments columns. Set `YOUTUBE_RECENT_ENGAGEMENT=0` to skip them. |
| `IG_BUSINESS_ACCOUNT_ID` and `IG_ACCESS_TOKEN` | Instagram Graph API Business Discovery. Both are required. Followers are recorded whenever the call succeeds. View, like, and comment sums are recorded only when every media item was returned with that field. |
| `X_BEARER_TOKEN` | X API v2. Followers come from user `public_metrics`. Like, reply, and impression sums are recorded only when the timeline is fully read and every post includes the field. `impression_count` often needs a higher X API access level; followers are still saved without it. |
| `TIKTOK_PUBLIC=1` | Public TikTok profile (followers, lifetime likes, video count) and the public embed (play counts). There is no free official API for third-party TikTok accounts. |
| `APIFY_TOKEN` | Optional TikTok path. Default actor is `clockworks/tiktok-scraper`. Override with `APIFY_TIKTOK_ACTOR` (`owner/name`). If the actor fails and `TIKTOK_PUBLIC=1`, the public reader still runs. An incomplete video list does not replace a better reading, and a failure does not wipe older numbers. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob store for snapshots. Required for a Vercel cron run to keep what it collects. Without it, production keeps serving the committed `data/snapshot.json`. |
| `CRON_SECRET` | If set, `POST` or `GET /api/collect` requires `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret`. Vercel Cron sends the bearer token when this variable exists. Set it before the collector URL is public. |
| `COLLECT_DELAY_MS` | Pause between platform calls. Default 200. |

YouTube handles can take an optional `id` (channel id) beside `handle`. The known channel id for `@americahousedc` is already in `accounts.json`. X handles keep the casing of the real username. `@questforquest` on X is an unrelated person and is not configured.

## Deploy on Vercel (free Hobby plan)

The site is the GitHub repo [ganamukhtar/ah-viewtracker](https://github.com/ganamukhtar/ah-viewtracker): static HTML plus two Node functions. There is no build step. The committed `data/snapshot.json` already has real TikTok numbers, so the first deploy works with no keys.

1. In Vercel, choose **Add New… → Project** and import `ganamukhtar/ah-viewtracker`.
2. Framework preset: **Other**.
3. Root directory: the repository root (leave it as `./`).
4. Build command: leave empty. Output directory: leave empty. Install command can stay `npm install` (it installs `@vercel/blob` for when a Blob token is set).
5. Environment variables, all optional on the first deploy:

   | Name | Value |
   | --- | --- |
   | `YOUTUBE_API_KEY` | YouTube Data API v3 key |
   | `IG_BUSINESS_ACCOUNT_ID` | Instagram business account id |
   | `IG_ACCESS_TOKEN` | Token that can call Business Discovery on that account |
   | `X_BEARER_TOKEN` | X API v2 app bearer token |
   | `TIKTOK_PUBLIC` | `1` to keep reading public TikTok profiles |
   | `BLOB_READ_WRITE_TOKEN` | Vercel Blob read/write token, so the daily cron can store new snapshots |
   | `CRON_SECRET` | Any long random string. Vercel sends it as `Authorization: Bearer …` on the cron request |

6. Deploy.

`vercel.json` schedules `/api/collect` once a day at 13:00 UTC (`0 13 * * *`). That is the Hobby plan limit, so the first deploy is not rejected for the cron expression. On a Pro plan, change that schedule to `*/30 * * * *` (every 30 minutes) or `17 * * * *` (hourly) and redeploy. Hobby function runs are also short, so a full collection of every platform can be cut off; each account is merged onto the last good reading, and a failed call does not write zeros. You can refresh `data/snapshot.json` locally with `TIKTOK_PUBLIC=1 npm run collect` and push that file instead.

`/api/views-feed` serves the Blob snapshot when `BLOB_READ_WRITE_TOKEN` is set and a blob exists. Otherwise it serves the committed `data/snapshot.json`. Without the Blob token, the daily cron runs and then discards what it collected.

## Moving this into america.co

Keep the vanilla page. A typical mount is `america.co/views`:

- `index.html`, `accounts.html`, `views.js`, `styles/`, `favicon.svg`, `accounts.json`, `data/snapshot.json`
- `api/views-feed.js` and `api/collect.js`, with `lib/` and `collector/` available to those functions
- the cron entry and the environment variables above

Do not point this page at `/api/movement-feed`. That feed is a different rollup (GIPHY and websites). This one is account-level and uses `/api/views-feed`.

Edit accounts in `accounts.json`. Each entry has `id`, `handle`, `name`, `category` (`quests`, `fan`, or `creators`), and `platforms`. A platform object is `{ "handle": "...", "id": "optional" }`. Omit a platform that should not be tracked. Instagram handles that are not confirmed on america.co are omitted on purpose; add them when they are confirmed.

## Counting rules

- Missing, failed, and unconfigured readings are `null`. Sums skip `null`. They do not become zero.
- An observed zero stays zero. Brandon Debates currently has a public profile with no videos, so its view count is 0.
- A failed collect keeps the previous numbers and marks that platform stale.
- A successful collect that leaves a field empty keeps the previous number for that field.
- TikTok embed play counts are marked partial when fewer videos come back than the profile lists.
- YouTube’s recent-video likes and comments are not lifetime totals and are not added to those columns.
- On load, the hero and the follower, like, and comment tiles count up from zero over about 2.25 seconds and land on the live value. Reduced motion skips that count-up. After it, the on-screen total never moves down. A higher snapshot eases in over about a second. A lower one is kept as the floor and the pace continues from there.

## Automatic refresh (no paid keys)

`.github/workflows/refresh.yml` runs every 30 minutes on GitHub Actions. It installs `yt-dlp`, runs `node collector/run.js`, and commits `data/snapshot.json` to `main`, which makes Vercel redeploy (about 48 deploys a day, under the Hobby limit of 100). Run it by hand from the repo's **Actions → Refresh numbers → Run workflow**.

What is read without keys:

| Platform | Source | Numbers |
| --- | --- | --- |
| TikTok | public profile + every public video via `yt-dlp` | followers, likes, comments, total plays |
| YouTube | public channel page | lifetime channel views, subscribers |
| Instagram | public profile preview | followers |
| X | public profile via api.fxtwitter.com | followers |

A failed read keeps the last good number and is never stored as zero. Optional repo secrets `YOUTUBE_API_KEY`, `X_BEARER_TOKEN`, `IG_BUSINESS_ACCOUNT_ID`, `IG_ACCESS_TOKEN` switch a platform to its official API.

From any machine with push access, `./refresh.sh` collects and publishes in one command (`./refresh.sh --no-push` collects only).
