# DaVinci Resolve Integration — Kre8Ωr Workflow Guide

**For: 7 Kin Homestead**
**Camera format: Blackmagic RAW (.braw)**
**Edit suite: DaVinci Resolve (Windows)**

---

This is your working reference for how a video project moves from camera card to published YouTube video using the Kre8Ωr + DaVinci Resolve pipeline. Read it once all the way through, then use it as a lookup doc when something breaks or you forget where you are.

---

## Table of Contents

1. [The Complete Workflow — Plain English](#1-the-complete-workflow--plain-english)
2. [Enabling DaVinci Resolve Scripting API](#2-enabling-davinci-resolve-scripting-api)
3. [The Timeline Progression](#3-the-timeline-progression)
4. [The Creator Grade Step](#4-the-creator-grade-step)
5. [Bin Structure](#5-bin-structure)
6. [Storage Architecture](#6-storage-architecture)
7. [Project Naming Convention](#7-project-naming-convention)
8. [The davinci_project State Machine](#8-the-davinci_project-state-machine)
9. [Contributing Personal Color Grading Without Breaking Things](#9-contributing-personal-color-grading-without-breaking-things)
10. [Manual Recovery — When Automation Breaks](#10-manual-recovery--when-automation-breaks)

---

## 1. The Complete Workflow — Plain English

Here's the full lifecycle of a video project from the moment you pick up the camera to the moment it's on YouTube.

### Step 1 — Shoot

You're shooting BRAW on the Blackmagic camera. Cards go to your archive/camera drive when you're done. The BRAWs live there permanently — they never move again. The archive drive is read-only as far as the pipeline is concerned. You read from it; you never write to it during post.

### Step 2 — VaultΩr Ingest

Open Kre8Ωr in your browser (`http://localhost:3000/vault.html`) and point VaultΩr at the intake folder on your archive drive. It scans every BRAW file, reads the metadata via ffprobe (duration, resolution, codec, creation timestamp), generates a thumbnail, and stores a record in the SQLite database.

If ffprobe can't read a BRAW directly (this can happen — BRAW support in ffprobe is version-dependent), VaultΩr logs what it can and flags the clip for manual review. The file is still catalogued; it just may have fewer metadata fields filled in.

Each ingested clip gets a record in the `footage` table with:
- The original file path on the archive drive
- Duration, resolution, codec
- Shot type and quality flag (assigned by Claude Vision or you manually)
- A logical `organized_path` — a reference name, not an actual file move

VaultΩr does not move, copy, or touch the original BRAW files. It only reads them.

### Step 3 — Proxy Export

Before DaVinci Resolve touches anything, you need proxies. BRAWs are enormous — 3840x2160 at high bitrates. You can't scrub through 40 minutes of that on a timeline without a dedicated GPU setup.

Proxies are H.264 or DNxHD files at 1/4 resolution, stored on your NVMe working drive (not the archive drive — see [Storage Architecture](#6-storage-architecture)). Kre8Ωr triggers the proxy render via ffmpeg. Once proxies are ready, the project state moves to `proxies_rendering`, then to `awaiting_creator_grade` when the renders complete.

### Step 4 — DaVinci Project Creation

Kre8Ωr creates the DaVinci Resolve project via the scripting API. It:
- Creates a new project named with the correct convention (see [Naming Convention](#7-project-naming-convention))
- Sets up the bin structure (see [Bin Structure](#5-bin-structure))
- Imports the proxy clips into the `02_PROXIES` bin
- Creates the first timeline: `01_PROXY_GRADE`
- Sets the Color Space Transform (CST) node on every clip — BRAW → Rec.709 base grade

At this point DaVinci Resolve has a project with your proxies and a base technical grade. Your footage is legible. Nothing creative has been done yet.

### Step 5 — Creator Grade

This is where you sit down in DaVinci Resolve. Open the project, go to the Color page, and work in `01_PROXY_GRADE`. The base CST node is already there on every clip. Your job is to add your personal look on top of it.

Read [The Creator Grade Step](#4-the-creator-grade-step) before you touch anything.

When you're happy with the look, go back to Kre8Ωr and click **Mark Grade Approved**. This flips the project state to `grade_approved` and tells the automation it can move forward.

### Step 6 — Rough Cut Assembly

Kre8Ωr uses the selects and cut points from VaultΩr/CutΩr (already identified during ingest) to assemble a rough cut timeline: `03_ROUGH_CUT`. This is an automated first pass — every approved clip in rough order, with handles. It's not a finished edit. It's a starting point.

The state moves to `rough_cut_ready`.

### Step 7 — Creator Review

Open `03_ROUGH_CUT` in the Edit page. Watch it. The review process in Kre8Ωr's ReviewΩr interface (`http://localhost:3000/reviewr.html`) lets you mark sections for keeps, cuts, and restructures.

When you're done reviewing, mark it approved in Kre8Ωr. State moves to `awaiting_creator_review` → `picture_lock`.

### Step 8 — Picture Lock

The `05_PICTURE_LOCK` timeline is the final edit. No more structural changes after this point. Audio cleanup happens in `04_AUDIO`. Once picture lock is signed off, delivery begins.

### Step 9 — Delivery

Kre8Ωr creates the delivery timelines automatically:
- `06_DELIVERY_YT` — full YouTube render settings (H.264, 3840x2160 or 1920x1080, high bitrate)
- `07_DELIVERY_SHORTS` — vertical crop for YouTube Shorts
- `08_DELIVERY_SOCIAL` — square/vertical for TikTok, Instagram, Facebook

You render from each delivery timeline in DaVinci Resolve's Deliver page. State moves to `delivery_ready`.

---

## 2. Enabling DaVinci Resolve Scripting API

The Kre8Ωr automation talks to DaVinci Resolve through its Python scripting API over a local network socket. This is not enabled by default. You have to turn it on once.

**Windows instructions:**

1. Open DaVinci Resolve
2. Go to **DaVinci Resolve** menu → **Preferences**
3. Click the **System** tab at the top
4. Click **General** in the left sidebar
5. Find the section labeled **External Scripting Using**
6. Set it to **Local** (not Network — Local uses a local socket, no port needed)
7. Click **Save**
8. Restart DaVinci Resolve

That's it. There is no port field in Local mode — Local scripting uses a named socket, not TCP. The `9237` port only applies to Network mode, which you don't need.

**Verify it's working:**

With Resolve open, run this in a Python terminal:

```python
import DaVinciResolveScript as dvr
resolve = dvr.scriptapp('Resolve')
print(resolve.GetVersionString())
```

If you get a version string back (e.g. `18.6.4`), you're connected. If you get an import error, check the `RESOLVE_SCRIPT_API` and `RESOLVE_SCRIPT_LIB` environment variables are set (see the Python scripting setup section in the Resolve manual).

**Important:** DaVinci Resolve must be running and have a project open for the scripting API to respond. Kre8Ωr checks this before sending commands and will return a clear error if Resolve isn't available.

---

## 3. The Timeline Progression

Each timeline in a Kre8Ωr project has a specific job. They're created in order by automation — don't manually create timelines with these names, and don't rename them. The automation matches by name.

| Timeline | Purpose | Created By | When |
|---|---|---|---|
| `01_PROXY_GRADE` | Color grade working timeline — proxies only | Kre8Ωr | Project creation |
| `02_SELECTS` | Approved clips pulled from grade — your keeper pile | Kre8Ωr | After grade approved |
| `03_ROUGH_CUT` | Automated first-pass assembly from selects | Kre8Ωr | After selects populated |
| `04_AUDIO` | Audio sweetening — music, SFX, dialogue cleanup | Kre8Ωr | After rough cut |
| `05_PICTURE_LOCK` | Final locked edit — no structural changes after this | Kre8Ωr | After creator review |
| `06_DELIVERY_YT` | YouTube delivery render timeline | Kre8Ωr | After picture lock |
| `07_DELIVERY_SHORTS` | YouTube Shorts delivery timeline | Kre8Ωr | After picture lock |
| `08_DELIVERY_SOCIAL` | TikTok / Instagram / Facebook delivery | Kre8Ωr | After picture lock |

**The rule:** Never work in a timeline that Kre8Ωr hasn't created yet. If `03_ROUGH_CUT` doesn't exist, it's because the grade hasn't been approved. Mark the grade approved first, let Kre8Ωr create the timeline, then open it.

**The database record:** Every timeline has a row in the `davinci_timelines` table with `project_id`, `timeline_name`, `timeline_index`, and `state`. The state tracks: `pending` → `active` → `awaiting_creator` → `complete`.

---

## 4. The Creator Grade Step

This is the one step that's entirely manual and entirely yours. Here's exactly what to do and what to avoid.

### What Kre8Ωr Sets Up For You

When the project is created, every clip in `01_PROXY_GRADE` gets a node graph with one node already in place:

```
[Camera RAW Settings] → [01 CST — BRAW to Rec.709] → [Output]
```

The CST node converts the BRAW log footage to a usable Rec.709 image. Without it, everything looks flat, dark, and washed out. That's normal for log footage. The CST node is doing its job.

**Do not delete or modify the CST node.** If you break it, you break the base grade on that clip and your proxies will look wrong. If you accidentally delete it, you can re-add it: Effects → Color Space Transform, set Input to BRAW (BRGW) and Output to Rec.709.

### What You Add

Add nodes after the CST node. The node graph should look like this when you're done:

```
[Camera RAW Settings] → [01 CST — BRAW to Rec.709] → [02 Look] → [Output]
```

Your Look node is where you put your personal grade — contrast, saturation, specific lift/gamma/gain adjustments, any LUT you want to apply. Keep it simple. The CST is doing the heavy technical lifting; your Look node is the creative layer.

If you want multiple adjustment layers (e.g., a warmth adjustment, then a separate saturation pull), stack additional nodes after Look:

```
[Camera RAW Settings] → [01 CST] → [02 Look] → [03 Saturation] → [Output]
```

Just don't insert anything before the CST node.

### Applying the Grade Across Clips

Once you have your look dialed in on one clip, use Resolve's **Stills** panel to grab the grade, then apply it to other clips via **Paste Grades** or the **Flags/Stills** workflow. You can also use **Group Pre-Clip** or **Group Post-Clip** to apply a grade globally — but put global adjustments in Post-Clip, not Pre-Clip (which runs before the CST).

### Marking Grade Approved

When you're satisfied with the color work:

1. Open Kre8Ωr (`http://localhost:3000`)
2. Find the project in the dashboard
3. Click **Mark Grade Approved**

This updates the project state in the database to `grade_approved` and triggers Kre8Ωr to create `02_SELECTS` and begin rough cut assembly.

---

## 5. Bin Structure

DaVinci Resolve projects created by Kre8Ωr follow a consistent bin layout. Here's what each bin is for and what goes in it.

```
Master Project
├── 00_PROJECT_DOCS
├── 01_SCRIPTS
├── 02_PROXIES
│   ├── B-ROLL
│   ├── DIALOGUE
│   └── TALKING-HEAD
├── 03_AUDIO
│   ├── MUSIC
│   ├── SFX
│   └── DIALOGUE_RAW
├── 04_GRAPHICS
│   ├── TITLES
│   ├── LOWER-THIRDS
│   └── THUMBNAILS
├── 05_EXPORTS
│   ├── YOUTUBE
│   ├── SHORTS
│   └── SOCIAL
├── 06_REFERENCE
└── 07_ARCHIVE
```

**00_PROJECT_DOCS** — The brief, shot list, script, and package information from Kre8Ωr. Usually brought in as text notes or PDF. If you need to know what the video is about or what the approved hook is, look here.

**01_SCRIPTS** — The full script and any approved changes. If you're doing a voice-led edit, the locked script lives here.

**02_PROXIES** — All your proxy clips, organized by shot type to match the VaultΩr categories. BRAW originals are never imported here — only proxies. Sub-bins mirror the VaultΩr shot types: `b-roll`, `dialogue`, `talking-head`. If you shot other types (action, establishing), Kre8Ωr creates those sub-bins automatically.

**03_AUDIO** — Everything audio. MUSIC gets the licensed/generated tracks from SoundΩr. SFX gets any foley or ambient files. DIALOGUE_RAW holds any separately recorded audio if you used a dedicated recorder.

**04_GRAPHICS** — Motion graphics, titles, lower thirds, and thumbnail source files. GraphΩr exports land here.

**05_EXPORTS** — Output render files land here as project references after delivery. Keeps the project self-contained for archiving.

**06_REFERENCE** — Anything you're using for reference but not in the edit — mood boards, reference videos, color palette images. Good habit for matching look or tone.

**07_ARCHIVE** — Old versions, rejected cuts, test grades. Stuff you're not using but don't want to delete yet. When a project ships, move anything unnecessary here before archiving.

---

## 6. Storage Architecture

Getting this right prevents a lot of pain. The core principle: **originals stay on the archive drive, working files stay on the NVMe, DaVinci projects stay in Resolve's database**.

### Drives

```
Archive Drive (large, slow is fine — USB3 or internal HDD)
└── Camera/
    └── 2026-03-15_ChickenCoop/
        ├── Clip_001.braw
        ├── Clip_002.braw
        └── ...

NVMe Working Drive (fast — this is where you edit from)
└── Proxies/
    └── 2026-03-15_ChickenCoop/
        ├── Clip_001_proxy.mp4
        ├── Clip_002_proxy.mp4
        └── ...

DaVinci Resolve Database (managed by Resolve — don't touch the files directly)
└── (Resolve's internal database location)
```

### The Rules

**Never store proxies on the same drive as BRAWs.** This is about speed and safety. Proxies need fast random-access read speeds for smooth scrubbing. BRAWs need sequential read speeds for playback. Mixing them on a slow archive drive means both suffer. And if the archive drive fails, you lose both your originals and your working files.

**Never move BRAWs after ingest.** VaultΩr records the full file path at ingest time. If you move the BRAW, the `footage` table record points to a dead path. If you need to reorganize, update the paths in the database first (or re-ingest). The `organized_path` field is a display reference — it shows what the file would be called in an organized structure, but VaultΩr does not actually move files.

**The Kre8Ωr database lives at:**
```
C:\Users\18054\kre8r\database\kre8r.db
```
Back this up. It contains your entire project history, all cut decisions, captions, emails, analytics — everything. A periodic copy to a cloud sync folder is worth doing.

### Recommended Folder Structure

```
C:\Users\18054\Videos\                    (NVMe working drive)
├── intake\                               (drop new cards here for VaultΩr)
├── organized\                            (logical reference root — no actual files moved)
└── proxies\
    └── YYYY-MM-DD_ProjectName\
        ├── b-roll\
        ├── dialogue\
        └── talking-head\

D:\Camera\                               (archive drive)
└── YYYY-MM-DD_ShootDescription\
    ├── Clip_001.braw
    └── ...
```

---

## 7. Project Naming Convention

Every project in Kre8Ωr and DaVinci Resolve follows this format:

```
YYYY-MM-DD_ProjectName_ID
```

**Example:**
```
2026-03-15_ChickenCoopBuild_047
```

**Why this format matters:**

- **Date prefix** — Resolve sorts projects alphabetically. With dates first, they sort chronologically by default. Finding last month's project is a three-second scroll, not a search.
- **Descriptive name** — Short, human-readable. No spaces (Resolve handles them but it creates headaches in scripting). Use CamelCase or hyphens.
- **ID suffix** — The Kre8Ωr project ID from the database. This is the link between Resolve's project and the Kre8Ωr record. If you ever need to look up what project a Resolve timeline belongs to, the ID tells you exactly which row to query.

**The database link:** When Kre8Ωr creates a DaVinci project, it stores the Resolve project name in the `davinci_timelines` table alongside the `project_id`. This is how automation knows which Resolve project to open when it needs to create a new timeline.

**Don't rename DaVinci projects after Kre8Ωr creates them.** The automation looks up projects by name. A renamed project is an orphaned project.

---

## 8. The davinci_project State Machine

Every Kre8Ωr project that has a DaVinci component tracks its progress through a defined set of states. These are stored in the `davinci_timelines` table and in the project's `pipeline_state`.

### State Definitions

| State | Meaning | What's Happening |
|---|---|---|
| `created` | DaVinci project exists | Bins set up, proxies imported, `01_PROXY_GRADE` created |
| `proxies_rendering` | ffmpeg proxy jobs are running | Do not open the project yet — proxies are still being written |
| `awaiting_creator_grade` | Proxies done, ready for color work | Open Resolve, work in `01_PROXY_GRADE` |
| `grade_approved` | Creator signed off on grade | Automation picks this up and builds selects + rough cut |
| `rough_cut_ready` | `03_ROUGH_CUT` assembled | Creator can open Resolve and review the rough cut |
| `awaiting_creator_review` | Rough cut waiting for feedback | Open ReviewΩr, watch it, mark sections |
| `picture_lock` | Edit is locked | `05_PICTURE_LOCK` confirmed, delivery timelines being created |
| `delivery_ready` | All delivery timelines exist | Render from Resolve's Deliver page |

### Valid Transitions

```
created
  └─→ proxies_rendering
        └─→ awaiting_creator_grade
              └─→ grade_approved
                    └─→ rough_cut_ready
                          └─→ awaiting_creator_review
                                └─→ picture_lock
                                      └─→ delivery_ready
```

There's no going backwards in this table — that's intentional. If you need to re-grade after a rough cut, you don't roll back the state; you work in `01_PROXY_GRADE` again and the grade cascades forward via Resolve's linked grades.

### Checking the Current State

In the Kre8Ωr dashboard (`http://localhost:3000`), the project card shows the current state. You can also query the database directly if something looks wrong — see [Manual Recovery](#10-manual-recovery--when-automation-breaks).

---

## 9. Contributing Personal Color Grading Without Breaking Things

The color pipeline is the most fragile part of the DaVinci integration. Here's how to stay in your lane without accidentally wrecking the automation.

### The One Rule

**Only do color work in `01_PROXY_GRADE` during the grade step.** That's your window. Before Kre8Ωr has created the timeline, there's nothing to work in. After you've marked the grade approved, the grade is locked and downstream timelines inherit it. If you open `01_PROXY_GRADE` after picture lock and start changing things, your changes won't propagate — and you'll confuse yourself wondering why the delivery render doesn't match.

### The Node Graph — Where to Add Your Adjustments

```
[Camera RAW Settings]
        ↓
[01 CST — BRAW to Rec.709]     ← Don't touch this. Ever.
        ↓
[02 Look]                       ← Your primary creative grade goes here
        ↓
[03 Saturation] (optional)      ← Additional adjustments stack after Look
        ↓
[Output]
```

Nodes run top to bottom. The CST must come first because it converts the raw log signal into a color-managed image. Everything after it is working with that corrected signal. If you put a creative grade before the CST, you're grading log footage and your results will be unpredictable.

### Using Group Grades

If you want one look applied across the whole project:

1. Select all clips in `01_PROXY_GRADE`
2. Right-click → Add Into a New Group
3. In the Group Post-Clip section, add your global look node

The Group Post-Clip runs after the per-clip CST. This is the right place for a project-wide LUT or overall color cast adjustment.

Do not use Group Pre-Clip for creative grading — it runs before the CST node on each clip.

### Timelines to Leave Alone

- `02_SELECTS` — created by automation, do not manually add or remove clips
- `03_ROUGH_CUT` — assembly only, don't restructure it manually (use ReviewΩr)
- `04_AUDIO` — edit audio here but don't touch the video track
- `05_PICTURE_LOCK` — once created, this is read-only until delivery is done
- `06_DELIVERY_YT`, `07_DELIVERY_SHORTS`, `08_DELIVERY_SOCIAL` — these are render timelines, not edit timelines

---

## 10. Manual Recovery — When Automation Breaks

Scripts fail. Resolve crashes. The SQLite database gets into a weird state. Here's how to diagnose and fix it without panic.

### First: Check What State Things Are In

Open a terminal and query the database directly:

```bash
cd C:/Users/18054/kre8r
node -e "
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

initSqlJs().then(SQL => {
  const buf = fs.readFileSync('./database/kre8r.db');
  const db = new SQL.Database(buf);

  // Check davinci_timelines for a project
  const rows = db.exec('SELECT * FROM davinci_timelines ORDER BY project_id, timeline_index');
  console.log(JSON.stringify(rows, null, 2));
});
"
```

This shows you every timeline record and its current state. If a timeline row exists in the database but the timeline doesn't exist in Resolve, you have a desync.

### Check Project State

```bash
node -e "
const initSqlJs = require('sql.js');
const fs = require('fs');

initSqlJs().then(SQL => {
  const buf = fs.readFileSync('./database/kre8r.db');
  const db = new SQL.Database(buf);

  const rows = db.exec(\`
    SELECT p.id, p.title, p.current_stage, ps.stage_status
    FROM projects p
    LEFT JOIN pipeline_state ps ON ps.project_id = p.id
    WHERE p.status != 'archived'
    ORDER BY p.created_at DESC
    LIMIT 10
  \`);
  console.log(JSON.stringify(rows, null, 2));
});
"
```

### Common Failure Scenarios

**Scenario: Proxy render started but Kre8Ωr crashed mid-render**

The state is stuck at `proxies_rendering`. The proxies may be partially rendered.

1. Check the proxy output folder — are the files there? Complete?
2. If complete: manually update the project state via the Kre8Ωr API:
   ```
   POST http://localhost:3000/api/projects/{id}/state
   Body: { "state": "awaiting_creator_grade" }
   ```
3. If incomplete: delete the partial proxy files and re-trigger the proxy render from the Kre8Ωr dashboard.

**Scenario: DaVinci project creation script failed halfway through**

The project was created in Resolve but the bins or timelines weren't set up completely.

1. Check what exists in Resolve — open the project and look at the Media Pool. Is `01_PROXY_GRADE` there?
2. If the timeline is missing: you can run the timeline creation script manually via the Kre8Ωr operator endpoint, or create it manually in Resolve with the exact name `01_PROXY_GRADE` (case-sensitive, exact match).
3. Update the `davinci_timelines` table to reflect what actually exists.

**Scenario: A DaVinci project got created twice**

This happens if the creation script ran, got a timeout, and then ran again. You'll have two projects in Resolve with nearly identical names.

1. In Resolve's Project Manager, find the duplicates. One will have all the bins and timelines, one may be empty.
2. Delete the empty/incomplete one in Resolve.
3. In the Kre8Ωr database, check the `davinci_timelines` table for that project_id — there should be one set of timeline rows. If there are duplicates, delete the extra rows:
   ```bash
   node -e "
   const initSqlJs = require('sql.js');
   const fs = require('fs');

   initSqlJs().then(SQL => {
     const buf = fs.readFileSync('./database/kre8r.db');
     const db = new SQL.Database(buf);
     // List timelines for the affected project (replace PROJECT_ID)
     const rows = db.exec('SELECT * FROM davinci_timelines WHERE project_id = PROJECT_ID');
     console.log(JSON.stringify(rows, null, 2));
   });
   "
   ```
4. Keep the timeline rows that correspond to the correct Resolve project. Delete the others.

**Scenario: Grade was approved in Kre8Ωr but `02_SELECTS` was never created**

The state moved forward but the automation didn't fire or failed silently.

1. Check the Kre8Ωr server logs (`node server.js` output) for errors around the grade approval timestamp.
2. Manually trigger the selects creation via the operator panel (`http://localhost:3000/operator.html`).
3. If that's not available, create `02_SELECTS` manually in Resolve with that exact name and populate it by dragging approved clips from `01_PROXY_GRADE`.

**Scenario: Resolve isn't responding to the scripting API**

1. Is Resolve actually open? It has to be running.
2. Is a project open in Resolve? The API needs an active project context for most commands.
3. Go back and verify the scripting settings (see [Section 2](#2-enabling-davinci-resolve-scripting-api)). Confirm mode is set to **Local**.
4. Try restarting Resolve.
5. Check that the `RESOLVE_SCRIPT_API` and `RESOLVE_SCRIPT_LIB` environment variables point to the correct paths in your Resolve installation.

### Re-Running a Script with Correct Arguments

If a script needs to be re-run for a specific project, the Kre8Ωr operator API accepts project IDs directly:

```
POST http://localhost:3000/api/operator/davinci/setup
Body: { "project_id": 47 }
```

Replace `47` with the actual project ID from the database. The endpoint will check the current state and only perform actions appropriate for that state — it won't, for example, re-create a project that already exists.

### Golden Rule for Manual Recovery

After any manual fix, query the `davinci_timelines` table again and confirm the state matches reality in Resolve. The database is the source of truth for Kre8Ωr. Resolve is the source of truth for what's actually been edited. They need to agree.

---

*This document covers the DaVinci Resolve integration as built in Kre8Ωr Phase 3. The scripting layer, timeline names, bin structure, and state machine are all implemented in `src/routes/operator.js` and the `davinci_timelines` schema in `database/schema.sql`.*

*Last updated: 2026-03-29*
