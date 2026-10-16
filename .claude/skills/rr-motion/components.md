# rr-motion components (C:\Users\18054\rr-cards\src\rr)

Import from `./rr` (barrel `index.ts`) or from the file. Every piece is frame-driven (`useCurrentFrame`), seeded and deterministic. Defaults reproduce the house pieces exactly; palette props switch day and night. Usage of every piece in one place: `src/rr/Example.tsx` (composition `rr-example-card`).

## tokens.ts
- `DAY`, `NIGHT`: `Palette` = `{ paper, sheet, ink, margin, rule, pencil, chip, brass, photo }` (hexes in SKILL.md section 1).
- Faces: `pen` (Nanum Pen Script), `archivo` (Archivo 800, weight only), `serif` / `serifItalic` (Source Serif 4), `DISPLAY` (Archivo with the `wdth` axis loaded from Google, falls back to `archivo`), `CAPS` (style: DISPLAY, 800, 75% stretch; add `fontSize`, `letterSpacing`, `textTransform`).
- Motion: `SPRINGS.glide | seat | drop | sheet`, `DROP_FRAMES` (16), `SHOVE_FRAMES` (22), `PEN_STUTTER`, `handwrite(frame, at, dur = 24)`.
- Helpers: `ramp(f, a, b, easing?)` (clamped 0..1), `lerp`, `clamp01`, `mulberry(seed)` (seeded random), `inkLine(x1, y1, x2, y2, seed, amp, over)`, `inkRect(x, y, w, h, seed, amp)`, `inkCircle(cx, cy, r, seed, sweep = 384, start = -110, wobble = 0.035)` (path `d` strings), `drawOn(p)` (spread onto a path to draw it on), type `Pt`.

## Pad.tsx
- `Pad({ w, h, step = 28, palette = DAY, ruleWidth = 1.2, ruleOpacity = 0.85, marginX?, marginWidth = 1.4, marginOpacity = 0.75 })`: full-frame pad layer. Day montage: `step={40} marginX={92}`. Night: `palette={NIGHT} ruleWidth={1} ruleOpacity={0.45}`, no `marginX`.
- `PadRules({ w, count, first, step, color, width, opacity })`: rules as an SVG fragment (line i at `first + i*step + 0.5`), for drawing inside your own `<svg>` (Switchboard does this).
- `MarginLines({ x, h, color, width, opacity })`: the double red margin, SVG fragment.

## Print.tsx
- `DroppedPrint({ src, caption, size, index, arrive, leave, center, slot, stackScale, holdFrames = 120, fullH?, palette })`: the falling, pushing-in, shoved print. `src` is a resolved `staticFile(...)`. `leave = null` keeps it on top. `fullH` = a tall capture that pans.
- `PrintFace({ src, caption, size, seed, pan, fullH, palette, captionInk })`: the static print (border, picture window, sheen, pen caption, tape).
- `Tape({ x, y, rot, w, h, seed })`: torn masking tape.
- `PrintSize = { imgW, imgH, side, bottom, captionSize, tape: { w, h } }`, `printBox(size) -> { W, H }`, `Slot = { x, y, r }`.
- Montage sizes: vertical `imgW 640, side 20, bottom 118, caption 74, tape 170x50`; square `380, 12, 70, 46, 100x32`. Phone captures: `imgH = round(imgW * 812 / 375)`.

## Cord.tsx
- `PatchCord({ from, to, start, seat, withdraw, plugScale, cordW, lift = 70, label?, palette = NIGHT, plug = PLUG_NIGHT })`: one self-contained patch (labelled jack, cord, plug, seat bounce, withdraw). Renders its own full-frame `<svg>`. Day: `palette={DAY} plug={PLUG_DAY}`.
- `Jack({ x, y, r, scale = 1, fill, ink, rim = 2.3 })`, `Plug({ s, colors })` (tip at origin, pointing +x, length `PLUG_LEN` = 55 before scale), `PLUG_DAY`, `PLUG_NIGHT`, `CordLine({ d, w, ink, core })`, `cordCurve(A, rear, rad, { kxMin, sagK, c1k = 0.7, c2k = 1, grow })`: the parts, for a board with several patches (Switchboard.tsx keeps its own patch timing and uses these).

## Phone.tsx
- `Phone({ canvas, screen: { x, y, w, h }, bezel: { side, top, bottom, radius }, draw, opacity = 1, strokeW = 6, ink, screenFill, children })`: the ink phone that draws itself; children render clipped inside the screen. Screen height for a 375x812 capture: `w * 812 / 375`.
- `ScreenShot({ src, capW, capH, screenW, scroll, x = 0, opacity = 1 })`: a capture inside the screen, scrolled in capture pixels, slid by `x` for a screen change.

## Label.tsx
- `CapsLabel({ text, at, until, x, y, w, size, align = "center", color = NIGHT.ink })`: big caps, wipes on in 12 f, lifts off from `until - 2`.
- `SourceLine({ text, at, x, y, w?, size = 30, align = "left", italic = true, color = DAY.pencil })`: the source line under any number or quote.

## PenLine.tsx
- `PenLine({ text, from, to, top, height, size, left = 0, right = 0, rotate = -0.6, justify = "center", rhythm = "even" | "pen", color = DAY.ink })`: a handwritten line that writes itself. Keep the box tight to the text.

## Ink.tsx
- `Arrow({ a, b, bow, at, until, w, ink = NIGHT.ink, halo = NIGHT.paper })`: bowed ink arrow with a paper-coloured halo under it (pass `DAY.ink`, `DAY.paper` by day).
- `Mark({ d, at, until, w, ink })`: any path drawn on (underline, box, strike).
- `Tap({ p, at, until, r, ink, red })`: fingertip press and red ring.
- `InkRing({ cx, cy, r, seed, progress, color, width = 3, opacity = 1 })`: the drawn ring as an SVG fragment (the switchboard's landing ring).

## EndCard.tsx
- `EndSheet({ at, box: { w, h, x, y, size, lineH, addrSize }, marginX, lines = FREE_SENTENCE, address = ADDRESS, underlineW?, times?, palette = DAY })`: the clean sheet, the sentence, the address, the red underline. Vertical box `960x900 @ 540,960, size 116, lineH 146, addr 58`; square `900x640 @ 540,540, 92, 106, 46`. Takes about 108 f after `at`.
- `BioEndCard({ at, canvasW, y, penSize, addrSize, stroke, line = "link in bio", address, ink })`: the night end card (returns siblings; place it straight in the composition). Takes about 74 f.
- `ADDRESS` = `www.7kinhomestead.com`; `FREE_SENTENCE` = the ruled sentence in three lines.

## Not in the kit (copy from the source file if needed)
- The switchboard board itself (strips, screws, carbon offset under the board) and its five-patch timing: `src/Switchboard.tsx`.
- The how-to's beat table, capture coordinate mapping (`toCanvas`) and screen slide: `src/SwitchboardHowto.tsx`.
- The older overlay family: `src/Card.tsx` (cards, legal-pad receipts, concessions, verdict stamp), `src/LowerThird.tsx` (definitions), `src/SourceCredit.tsx` (archival credits), `src/Ep10Acres.tsx` (a sourced-endpoints data exhibit); control surfaces `cards.json`, `lowerthirds.json`, `credits.json`.
