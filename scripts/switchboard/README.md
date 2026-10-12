# THE SWITCHBOARD puller

Runs on Jason's PC once an hour. It reads the recent videos from Facebook, YouTube and TikTok, makes a small picture for each one, guesses where each video should send a viewer, and sends the list to the house (`www.7kinhomestead.com`), which shows it on `/links-switchboard`.

The Facebook Page token stays on this PC. It is read from the desktop app's database (`%APPDATA%\kre8r\kre8r.db`, read-only) and used only inside the request to Facebook. It is never printed, logged or written anywhere. The house never talks to Facebook.

## Run it

From `C:\Users\18054\kre8r`:

| command | what it does |
|---|---|
| `node scripts/switchboard-pull.js` | pull everything and send it to the house |
| `node scripts/switchboard-pull.js --dry-run` | pull everything, write what it would send to `scripts/switchboard/last-push.json`, send nothing |
| `node scripts/switchboard-pull.js --local` | send to a dev house at `http://localhost:3001` |
| `node scripts/switchboard-pull.js --check` | pull nothing; exit 1 with one line if the newest saved post is older than 48 hours, or a platform has not had a good pull in 48 hours |

To send somewhere else, set `HOUSE_URL` first (PowerShell: `$env:HOUSE_URL = "https://staging.example"`). `--local` beats `HOUSE_URL`. The default is `https://www.7kinhomestead.com`.

Each run prints one summary line:

```
switchboard: fb=10 yt=7 tt=10 (tiktok: embed, manual=0) dry-run
```

`embed` means the TikTok creator embed page was read this run; `kept-last-good` means it was not and the last good TikTok list was used. `manual=N` is how many TikTok rows came from the manual seeds. Any platform that fails prints one line of its own above the summary and keeps its last good list.

The send uses `INTERNAL_API_KEY` from `C:\Users\18054\kre8r\.env` in the `x-internal-key` header. The house must have the same value.

## Where things come from

- **Facebook:** Graph v21.0, the Page's `/videos` and `/video_reels`, 10 each, merged by id, newest first.
- **YouTube:** the channel's public RSS feed (no key). When the feed is down (it returns 404 for every channel at times, as it did on Oct 11 2026), the puller reads the public channel videos page instead and opens each new video's page once for its exact date. The fallback sees long videos only, not Shorts.
- **TikTok:** the public creator embed page `https://www.tiktok.com/embed/@7kinhomestead` (no key, no login), one fetch per run, never retried. It carries the recent videos (id, description, cover); the date comes from the video id, which holds its upload time. When it fails or has no videos, the last good TikTok list is kept. The profile page is not read: since Oct 2026 its video list is empty (it loads them separately, and a headless browser got an empty answer too). **Watch-for:** on Oct 11 2026 the embed page's newest video was Sep 25, so it can run behind; add the newest TikToks as manual seeds below when it does.
- **TikTok manual seeds:** `scripts/switchboard/manual-posts.json`, a JSON array (it ships empty: `[]`). For each TikTok video URL in it the puller asks TikTok's public oEmbed endpoint (`https://www.tiktok.com/oembed?url=...`, no key, no login) for the title and cover, and builds the row like any other: caption = the title, picture from the cover, date from `posted_at` or from the video id itself (a TikTok id carries its upload time), destination from the rules. Give `label` and/or `destination_url` to set the destination yourself; that row is then marked `how: "manual"`. Every seeded row carries `manual: true`. If oEmbed fails for one URL, that URL keeps its last cached copy and one line is printed. A good oEmbed read counts as a good TikTok pull for `--check`. Take a URL out of the file and its row drops out on the next run. A seed and an automatic TikTok row with the same id: the seed wins.

  Example (JSON has no comments, so it lives here; copy the array into the file):

  ```
  // scripts/switchboard/manual-posts.json
  [
    // rules pick the destination (this one says "how much solar", so: the solar designer)
    { "url": "https://www.tiktok.com/@7kinhomestead/video/7689539101359459614" },
    // destination set by hand; label from the rules table, url looked up from it
    { "url": "https://www.tiktok.com/@7kinhomestead/video/<id>", "label": "the land finder" },
    // any destination, any label, and a date when the id's own date is not wanted
    { "url": "https://www.tiktok.com/@7kinhomestead/video/<id>", "label": "the house",
      "destination_url": "https://www.7kinhomestead.com/", "posted_at": "2026-10-11T19:00:00Z" }
  ]
  ```

  The TikTok URL is in the app: the video, Share, Copy link (the short `vm.tiktok.com` link must be opened once in a browser to get the long `/@7kinhomestead/video/<id>` form).

Kept: the newest 10 per platform, nothing older than 60 days.

## Pictures

96 x 96 webp, scaled to cover then cut from the top, under 8 KB each, made with `ffmpeg-static` from the repo's `node_modules`. They are saved in `scripts/switchboard/thumbs/<platform>-<id>.webp` and reused, so a video's picture is downloaded once. YouTube uses `mqdefault.jpg` (no black bars). Pictures nobody uses and older than 60 days are deleted.

## Where each video sends people

`scripts/switchboard-rules.json`. First match wins, top to bottom, on the caption and its hashtags, case-insensitive. Add a word or a rule there; the next run uses it, no deploy.

- A YouTube video points at itself ("watch on YouTube") unless its title names a tool, then the tool wins.
- A clip that talks about an episode ("Full episode on YouTube: The Only Way to Become Self-Sufficient...") goes to that YouTube video when the caption quotes its title; otherwise to the same EP number; otherwise to the YouTube video that was newest when the clip went up.
- A video that matches nothing goes to "everything we make" (`/links-switchboard#all`), never to the email box.
- The standing footer line ("Rock Rich is free. So is almost everything inside it: www.7kinhomestead.com") rides on every Facebook post, so lines with a link in them are not read for words. A `link:` term still sees them, so a caption that links a tool goes to that tool.
- Jason's one-tap corrections live on the house (admin, Switchboard panel) and always win over these guesses.

## Files

| file | in git? |
|---|---|
| `scripts/switchboard-pull.js` | yes |
| `scripts/switchboard-rules.json` | yes |
| `scripts/switchboard/README.md` | yes |
| `scripts/switchboard/manual-posts.json` (TikTok seeds, ships `[]`) | yes |
| `scripts/switchboard/cache.json` (last good list per platform) | no |
| `scripts/switchboard/thumbs/` | no |
| `scripts/switchboard/last-push.json` (the `--dry-run` body) | no |

## Task Scheduler recipe (for Ledger to register; the builder did not)

Hourly pull:

1. Task Scheduler, Create Task (not Basic Task).
2. General: name `Switchboard Pull`. Choose **Run whether user is logged on or not**. Leave "Run with highest privileges" off.
3. Triggers, New: Daily, start today at 00:05, **Repeat task every 1 hour for a duration of Indefinitely**. Enabled.
4. Actions, New: Start a program.
   - Program: `node` (or the full path from `where node`)
   - Arguments: `C:\Users\18054\kre8r\scripts\switchboard-pull.js`
   - Start in: `C:\Users\18054\kre8r`
5. Settings: **Do not start a new instance** if one is running. Stop the task if it runs longer than 10 minutes.
6. OK, enter the Windows password when asked.

The same as one command (PowerShell, run as Jason; it asks for the Windows password):

```
schtasks /Create /TN "Switchboard Pull" /SC HOURLY /MO 1 /ST 00:05 /TR "cmd /c cd /d C:\Users\18054\kre8r && node C:\Users\18054\kre8r\scripts\switchboard-pull.js >> C:\Users\18054\kre8r\scripts\switchboard\pull.log 2>&1" /RU "%USERNAME%" /RP
```

Freshness watch (daily): the same recipe with Arguments `C:\Users\18054\kre8r\scripts\switchboard-pull.js --check`, a daily trigger, and the watch reading the exit code (1 = stale) and the one line it prints.
