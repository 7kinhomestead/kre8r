---
name: rr-motion
description: Use for ANY Remotion, motion, animation, card, loop, montage, exhibit, end card, lower third or how-to video request for 7 Kin Homestead or Rock Rich (the house motion identity, "the Ledger in motion"). Covers the tokens, the three faces, the pad and the carbon night, the motion grammar (springs, draw-ons, dropped prints, the brass cord, the tap ring, the handwritten line, the end sheet), the formats and fps rules, the render recipe in C:\Users\18054\rr-cards, the laws (no AI images, no em dashes, every number sourced, "video" never "film"), and the review step. Reusable components live in rr-cards/src/rr.
---

# ROCK RICH MOTION (the Ledger, in motion)

Every animation for 7 Kin Homestead / Rock Rich is drawn in ballpoint on a legal pad: ink lines that draw themselves, real pictures dropped on the pad like prints, a pen that writes the words that matter. It is the same material as the door (`H:\edit-staging\LANDING-SAMPLES\G-one-site`, DOOR-AS-RULED.md "Identity" and "Motion"). Build from the kit, not from scratch.

- Project: `C:\Users\18054\rr-cards` (Remotion 4, React, no git: back up a file before you edit it).
- Kit: `rr-cards/src/rr/` (import from `./rr` or `./rr/<File>`). What each export does: `components.md` beside this file.
- Proof: composition `rr-example-card` (`src/rr/Example.tsx`) uses every piece once; `out/rr-example/example.mp4`.
- Reference pieces: `src/Switchboard.tsx` (day loop), `src/CommunityMontage.tsx` (day montage), `src/SwitchboardHowto.tsx` (night how-to). All three import the kit and render pixel-identical to their pre-kit versions (verified Oct 16 2026).

## 1. The identity in one screen

**Tokens** (`src/rr/tokens.ts`, from `css/ledger-tokens.css`; never invent a hex):

| role | DAY (the pad) | NIGHT (carbon paper) | use |
|---|---|---|---|
| paper | `#F5ECB8` canary | `#12162A` | the surface, the jack face |
| sheet | `#FBF6DA` | `#171B31` | a clean sheet laid on top, the end card, a phone screen before load |
| ink | `#1D2A57` ballpoint | `#F1E6A6` | every line and word |
| margin | `#C2353A` | `#E2574E` | the red: **one use per screen** (a ring, an underline) |
| rule | `#8DB0D6` | `#33416E` | ruled lines, the carbon offset under a board |
| pencil | `#55534B` | `#A3A6B4` | secondary text, source lines |
| chip | `#A39A86` chipboard | `#2A2F45` | borders, the cord's core |
| brass | `#F5ECB8` (hatched in ink) | `#C9A65A` | the plug's metal |
| photo | `#FFFDF7` | `#FFFDF7` | a print's white border |

The pad's own double red margin is the paper, not the "one red".

**Three faces, three jobs:**
- **Archivo condensed caps** (800, 75% width via the `wdth` axis; `CAPS` style, `DISPLAY` family): display, labels, jack names, the address. Letterspace 0.13em for small labels, 0.015em for big ones.
- **Nanum Pen Script** (`pen`): the hand. Notes, corrections, print captions, the end-card sentence. ONLY those. Never body text, never a label.
- **Source Serif 4** (`serif`, `serifItalic`): reading and source lines.

**Day or night:**
- **Day, the canary pad** (default): exhibits, loops for the web pages, montages, anything about the work, the land, the money, the community. Ruled lines at the 28 px rhythm scaled to the frame (30 at 1200x600, 36 to 40 at 1080 wide), double red margin on a full pad.
- **Night, carbon paper**: how-tos and anything that follows a day piece and must read as a different beat (the links how-to played right after the montage). Faint rules (opacity 0.45), no margin, the brass turns real brass.
- **The older overlay family** (`Card.tsx`, `LowerThird.tsx`, `SourceCredit.tsx`, `Ep10Acres.tsx`: Bebas Neue, DM Sans, Old Standard italic, `#E03030` red bar on a dark plate) is what the episodes already carry over picture (definitions, archival source credits, history exhibits). Keep using it where a season already uses it; do not mix it with the Ledger inside one piece. `src/tut/brand.ts` + `kit.tsx` are the .land tool tutorial chassis (black, Bebas, per-tool accent); use them only for those tutorials.

## 2. The motion grammar

One thing moves at a time. Nothing boils (all wobble is seeded, static per frame). The pad never arrives: it is finished in frame 0. Every draw-on finishes in well under 1.2 s.

**Springs** (`SPRINGS` in tokens.ts):
- `glide` `{ damping: 200 }` with `durationInFrames`: travel, shove, anything that must not overshoot. Cord travel 11 f at 24 fps; how-to cord travel = seat - start (42 f at 30).
- `seat` `{ damping: 7, stiffness: 180, mass: 0.5 }`: the plug seating, one bright bounce. Starts 1 frame before travel ends.
- `drop` `{ damping: 15, stiffness: 140, mass: 0.7 }`, 16 f: a print falling onto the pad.
- `sheet` `{ damping: 16, stiffness: 150, mass: 0.7 }`, 16 f: the end sheet landing on the stack.
- Older family: card enter `{14, 160, 0.9}`, verdict stamp `{11, 300, 0.7}`, lower-third parts `{200, mass 0.6}` staggered 0/5/10/16/21/30 f.

**Draw-ons** (SVG `pathLength=1`, `strokeDasharray "1 1"`, offset `1 - p`; `drawOn(p)`): an ink arrow 16 f ease-out cubic with the head appearing over its last 15%; an underline or box 14 f; the jack ring 9 f; the tap ring 10 f; the drawn phone outline 30 f ease in-out cubic, then the screen edge, speaker and buttons fade in over the last 50/30/20% of the draw. Exits are 8 f fades, labels lift 14 px as they go.

**The dropped print** (`DroppedPrint`): white border (20 px at 640 wide picture), bottom strip ~18% of the picture width carrying a pen caption tilted within 1.2 deg, two strips of torn masking tape at the top corners (-32..-42 deg and 30..42 deg). It falls from 90 px up at 1.22x with a +5 deg tumble and a far soft shadow; lands near center with a seeded jitter (40 x 30 px) and tilt (1.2 to 3.2 deg); pushes in to 1.05x while it is on top; when the next print lands it is shoved (glide, 22 f) to its slot at 0.76 to 0.8 scale. A tall capture pans down inside its window while on top. One print about every 4 s (122 f at 30).

**The cord** (`PatchCord`, or `Jack` + `Plug` + `CordLine` + `cordCurve` for a board): the plug leaves 22 px right of its jack, the hand arcs it up (46 to 120 px) and noses it up to -16/-18 deg going out, level when seated; it enters the jack by jackR + 2 and the target jack pulses 1.08x; the red ring draws round the landing jack. Withdraw: pull out first (40% of the 7 f), then the cord swings home on `bezier(0.55, 0, 0.85, 0.6)`. The cord is an ink casing with a chipboard core 4.4 px narrower, hanging in a sag of 0.26 to 0.36 x its length. The jacks it touches draw on top of it.

**The tap ring** (`Tap`): an ink fingertip (r 44 at 1080x1920, 28 smaller) rises 60 px into place over 14 f, presses to 0.82 and back over 10 f, then the red ring draws round it and widens to 1.65 r over 14 f, fading to 40% by +44 f. It is the screen's one red.

**The handwritten line** (`PenLine`): Nanum Pen revealed left to right by an opening clip, never typed letter by letter. Even rhythm for the end sheet (20 f a line, 2 f between), or `rhythm="pen"` for a note: word by word with pen lifts (`PEN_STUTTER`, the switchboard's 24 f note). Each line sits a hair off level (-0.6, +0.8 deg). Keep the line's box tight to the text: the clip opens across the box, and whatever overflows the box is cut.

**The end card**: every piece ends on the hand. Day (`EndSheet`): a clean ruled sheet drops on the stack, the ruled sentence writes itself ("Rock Rich is free." / "So is almost" / "everything inside it."), then the address `www.7kinhomestead.com` fades in Archivo, then the red pen line draws under it. Night (`BioEndCard`): the address wipes on in caps, "link in bio" in pen, an ink arrow up to where the bio sits. Last 5 s of a long piece; hold the finished card at least 1.5 s.

**Loops**: frame 0 and the last frame are the same picture (cord home, note on the pad). Anything that draws must also leave before the end.

**Reduced motion / poster** = the finished state: pick the frame where everything is drawn and seated (switchboard frame 60). Name it in the file header.

## 3. Formats

| what | size | fps | length | codec |
|---|---|---|---|---|
| web loop (links page, door exhibits) | 1200x600 (2:1) | **24** | 6 s = 144 f, seamless | h264 crf 24 yuv420p + vp9 webm crf 36 + poster webp q82; all three under 600 KB |
| social vertical (TikTok, Reels, Shorts) | 1080x1920 | **30** | FB Reels hard cap 90 s | h264 crf 22 yuv420p, no audio |
| social square (teaser, feed) | 1080x1080 | 30 (24 when it is a web loop re-laid) | same timing as the vertical | h264 crf 22 |
| episode card / overlay | 3840x2160, transparent | **30** | per cards.json `seconds` | ProRes 4444, `yuva444p10le`, alpha |
| one print alone for the cut | 1080x1920, transparent | 30 | 120 f | ProRes 4444 |

24 vs 30: web loops are 24 (lighter files, the loop is short and slow). Anything that goes into an edit timeline or onto a social platform is 30 (the episode timelines and all registered cards are 30). Never mix rates inside one composition. Put both layouts behind one component with a `layout` prop (`"landscape" | "square"`, `"vertical" | "square"`) and a Layout object of numbers, as the three reference pieces do.

## 4. The render recipe

From `C:\Users\18054\rr-cards` (Remotion config already sets PNG frames, so alpha survives, and overwrite on):

```
# register: append one <Composition> to src/Root.tsx (append only, never reorder)

# stills for review (one bundle, many frames)
node scripts/tut-stills.mjs <composition-id> out/<project>/stills 0 60 300 12.5s

# h264, no audio (pages, social)
npx remotion render src/index.ts <id> out/<project>/<name>.mp4 --codec=h264 --crf=22 --pixel-format=yuv420p --muted --log=error

# web loop extras
npx remotion render src/index.ts <id> out/<project>/loop.webm --codec=vp9 --crf=36 --pixel-format=yuv420p --muted --log=error
npx remotion still src/index.ts <id> out/<project>/poster.png --frame=<poster frame>
"C:\Users\18054\kre8r\node_modules\ffmpeg-static\ffmpeg.exe" -v error -y -i poster.png -c:v libwebp -quality 82 -compression_level 6 poster.webp

# cards with alpha (ProRes 4444), the batch.py way
npx remotion render <id> <dst>.mov --codec=prores --prores-profile=4444 --pixel-format=yuva444p10le [--props=<file.json>]
```

- `scripts/render-switchboard.cmd` is the whole web-loop recipe as one script (mp4, webm, poster, square, copies to the site and the house); `batch.py` is the card batch (skips files that exist over 1 MB, props through a temp JSON file, never inline).
- **The audio strip:** every deliverable is silent. Render with `--muted`. If a file arrives with a track anyway: `ffmpeg -i in.mp4 -c copy -an out.mp4`. Confirm with ffprobe that there is no audio stream (`C:\Users\18054\kre8r\node_modules\ffprobe-static\bin\win32\x64\ffprobe.exe -v error -show_entries stream=codec_type,codec_name,pix_fmt,width,height,r_frame_rate -of csv=p=0 <file>`).
- webp needs libwebp: Remotion's bundled ffmpeg has none, use ffmpeg-static from the kre8r repo.
- **Where outputs go:** render into `rr-cards/out/<project>/`, then copy the deliverables to `H:\edit-staging\<project>\` (e.g. `EP3\CARDS\`, `TIKTOK-UPDATE-2026-10-16\montage\`). Web-page assets also go to the site sample and the house only when the brief says so (see render-switchboard.cmd). Never write to C:\ outside the repos.
- Pictures live in `rr-cards/public/<project>/` and load with `staticFile()`.
- Media drives: never an unbounded search on H:, D: or F: (bounded `find -maxdepth`).

## 5. The laws

1. **No AI images.** Every picture is real: a capture of a real page, a frame of Jason's footage, an archival photo (PD/CC, credited on screen and logged in credits.json), or vector drawn in code. Check each capture before it becomes a print: some house pages carry generated banner art (the Tool Shed and Courses headers did, Oct 16 2026); pick a capture without it or crop it out. Kids never.
2. **No em dashes on screen** (or en dashes used as one). Commas, periods, parentheses. That includes captions, labels, end cards, the description you write for the upload.
3. **Every number sourced.** A number on screen traces to a primary source (his words with a date, a ledger, USDA, Studio). It carries a `SourceLine` under the exhibit. If the shape between two sourced endpoints is hand-set, no number shows mid-motion (Ep10Acres rule). No source, no number.
4. **"Video", never "film".**
5. **His words are his.** On-screen sentences are quoted from his rulings or transcripts, never paraphrased (the free sentence is fixed: `FREE_SENTENCE`). Machine words live only in the routing layer.
6. **Red once per screen.** No sound unless the brief asks. Nothing on a first screen of a web page moves.

## 6. The review step (do not skip)

1. Render stills at the beats: frame 0, every draw-on finished, the poster frame, mid end card, last frame. For a loop, also the last frame against frame 0.
2. Look at every still yourself (Read the PNG). Check: text clipped or overflowing its box, anything off canvas, two reds on one screen, an em dash or an unsourced number anywhere in the frame (including inside captures), AI-looking art in a capture, labels colliding with drawings.
3. Fix, re-render the stills, look again. Repeat until clean. A contact sheet (Pillow, 5 to 8 frames side by side) is the fastest way to see the timing.
4. When refactoring a shipped piece: render the same frames before and after and compare with Pillow `ImageChops.difference(...).getbbox()`; any difference means leave the original untouched.
5. Render the deliverables, ffprobe each (size, codec, pix_fmt, fps, duration, no audio), and report: paths, sizes in KB/MB, durations in seconds and frames, the poster frame.
