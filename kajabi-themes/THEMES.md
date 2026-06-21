# 7 Kin course themes — color variants (upload-ready)

Reusable Kajabi course themes, one accent color per subject. **All four share the same
gamified `7kin-course-template` base and the same completion beacon pointed at the always-on
land box** (`https://7kinhomestead.land/api/kajabi-track` → Orchard points). The only thing
that differs between them is the accent color (`color_primary` + `brand.primary_color`).

Grab the zip from THIS folder (not Downloads) and import it in Kajabi:
**Settings → Themes → Add Theme → Import**, then assign it to the course in Customize.
Same color on two courses = import that zip once per course (each product gets its own theme instance).

| Zip | Accent | Hex | Assign to |
|---|---|---|---|
| `7kin-theme-TEAL-land.zip` | 🟦 Teal | `#00C4B4` | Land On A Shoestring Budget *(already done)* |
| `7kin-theme-ORANGE-rockrich.zip` | 🟧 Rock Rich orange | `#E8862E` | **Rock Rich Starting System** + **Becoming Rock Rich** |
| `7kin-theme-GOLD-solar.zip` | 🟨 Gold | `#ffb400` | **DIY Off-Grid Solar From Scratch** + **Understanding Off Grid Solar** |
| `7kin-theme-AZURE-ooyw.zip` | 🟦 Azure | `#2E91FC` | **Out of Your Own Way** |

Notes:
- **Rock Rich Starting System** is the one with 1,709 members whose beacon currently points at a
  dead ngrok tunnel — importing the orange theme fixes its tracking *and* recolors it in one move.
- The base hero image is a generic placeholder; set each course's own hero in Customize (like the
  "Land" sign on the Land course).
- Colors sourced from the live tools/brand: teal = Land Finder `--teal`, gold = Solar Sizer `--gold`,
  orange = the Orchard `--orange`, azure = palette blue.

## Source + how to regenerate / recolor
`garden-course/7kin-course-template/` is the canonical base (teal). To make another color, swap the
two `#00C4B4` values in `config/settings_data.json` (`color_primary` + `brand.primary_color`) and
re-zip the `7kin-course-template/` folder so it sits at the zip root (no `zip` binary on this box —
use Python `zipfile`; see the generator pattern in the git history for this folder).
