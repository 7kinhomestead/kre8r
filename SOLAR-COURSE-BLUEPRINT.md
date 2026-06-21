# Intermediate Off-Grid Solar — LOCKED Blueprint
*Garden ($19) course. Drafted Jun 21 2026. Scope + ladder in `GARDEN-COURSES-PLAN.md`; research in `SOLAR-COURSE-RESEARCH.md` (38 verified findings); video corpus = `data/course-corpus.json`.*

**The promise:** *"Design and build YOUR off-grid system — hands in the wire."* Past the free basics, short of NABCEP-pro (that's Rock Rich S2's 15kW/40kWh build). Target rig: **~5kW solar / 12kWh LiFePO4 / 48V**, plus **RV/van** and **solar generators**.

**⚓ ANCHOR SYSTEM (real, on the property, running):** Jason's **SunGold Power inverter + 4× LiTime 230Ah @ 48V (~12kWh)** — the exact intermediate-sized rig, genuinely his, and it's **about to become his mother-in-law's lived-in RV power** → Module 6 (RV/Van) is a real case study, not theory. The big **EG4 12k + EG4 batteries + 35× CW 450W panels = the ADVANCED Rock Rich S2 build (15kW/40kWh)** — deliberately OUT of this course. Clean ladder. *(This means the course builds on SunGold/LiTime gear; the EG4 examples in the research stay as spec-sheet teaching examples / the "step-up" path — see affiliate note below.)*

**Why it's worth $19** (the rule for every lesson): the *video* shows Jason doing it; the **written supplement + diagram** is the thing a video can't be — searchable, on your phone in the field, the part you re-read mid-build. Don't re-teach the free *Understanding* course (components 101, batteries 101, basic cost) — **assume it.**

Source tags: 📹 Jason video · 🔬 research finding · ✏️ new writing · 📊 diagram (Claude builds the SVG) · 🔧 live tool · 🛒 affiliate.

---

## Module 1 — Design YOUR System
*Start from your real loads, end with a shopping list you understand.*
- 📹 `thAV7GHobsg` "I Built You A Tool To Make Solar Design Simple (And Free)" — the **Solar Sizer** cold-open (like Land opened on the Freedom Calculator)
- 📹 `_tZdSuMgyYo` "How Much Solar Will You Need To Live Off Grid?"
- 🔧 **Solar Sizer** — load audit → 5kW/12kWh-class shopping list
- 🔬 the 48V default (4000W = 333A @12V but **83A @48V** → smaller/cheaper wire), DC-coupled architecture, sizing the four pieces to YOUR load
- ✏️ "size for your real life, not a fantasy" (your water-mistake parallel) · 📊 **system block diagram** (panels→MPPT/all-in-one→battery→inverter→loads, with where the current is high vs low)

## Module 2 — Every Part, Explained (the BOM)
*The signature written supplement: your shopping list, decoded — what each part is, what it does, and when you genuinely need it vs can skip it.*
- 📹 `OFrqbN9HMBQ` "What We Use for Our Off Grid Solar Array"
- 🔬 the full component-by-component BOM (panels, racking, MPPT/all-in-one, LiFePO4 bank + BMS, inverter, combiner, DC/AC disconnects, breakers/fuses, SPD, busbars, shunt, cable, grounding) — **need-it-vs-skip-it** for each
- ✏️ the per-component reference (with your build photos) · 📊 **annotated BOM diagram** + a "do I actually need this component?" decision tree

## Module 3 — Buy It Right (read the spec sheet, dodge the trap)
*The second big written supplement — turn a datasheet from marketing into a decision.*
- 📹 `2qyyDvAC2Yk` "Testing The Ampeak 3000w Inverter" (real-gear eval)
- 🔬 **PV-input vs AC-output** (EG4 12000XP: 24kW PV in / 12kW AC out = 2×), **continuous vs surge** watts, **Voc cold-weather rise** that fries controllers, **BMS current limit** bottleneck, Ah-needs-voltage, power-station inflation
- ✏️ "anatomy of a spec sheet" walkthrough · 📊 **annotated spec-sheet diagram** (call out the numbers that actually bind)
- 🛒 **AFFILIATE (locked):** the exact build gear → **SunGold** (inverter) + **LiTime** (batteries) links; **Signature Solar / EG4** for everything else (panels, wire, breakers, racking — they carry basically all of it) AND the "step-up" path to the S2-class EG4 rig. Frame honestly: "here's my exact rig + where I got it; for the rest, and for when you go bigger, here's the one-stop shop."

## Module 4 — Build It: Mount the Array & Set the Gear
*Hands-on assembly — racking, panels, battery, mounting the all-in-one.*
- 📹 `2gpl_eOaKvw` "DIY Solar Panel Installation — 4 SunGold 590w, Full Process"
- 📹 `CyeHxhjiuvU` "Installing A 4000Wh LiFePO4 Watt Cycle Battery"
- 📹 `DOsEJEwStdE` "So We Built An Off Grid Solar Array To Start Over"
- 🔬 racking/orientation basics, array layout · ✏️ the physical build order · 📊 **layout/mounting diagram**

## Module 5 — Wire It Safe (the connections) 🏅 crown jewel
*The detailed electrical module the free course only gestures at. Liability-heavy — Linda reviews before ship.*
- 📹 `Upjc6UuEYpE` "How to Make DIY Solar Safe and Easy"
- 📹 `kAF3bgcY9mk` "Making Electrical Connections Safely…"
- 📹 `wGXEGchY2bc` "The Final DC Connections on a DIY Off Grid Solar Array"
- 📹 `QusVSSZeZsw` "Remember This Step on Your Off Grid DIY Solar Build"
- 📹 `IkJUbW9hN2Y` "Building Our Off Grid Homestead… (Electrical Work)"
- 🔬 wire-gauge + overcurrent (fuse/breaker) sizing method, **exactly ONE neutral-ground bond**, required DC + AC disconnects, EGC bonding, 4/0 cable + ~250-400A breaker for a 5.5kW 48V inverter
- ✏️ connection order + torque · 📊 **full wiring diagram** (fused, grounded, disconnects) · ⚖️ "DC arcs kill / verify NEC + your AHJ / when to call a licensed electrician" (Land-style disclaimer)

## Module 6 — Smaller Rigs: RV/Van & Solar Generators
*The two setups you flagged — different rules, same fundamentals.*
- 📹 `jxebyWVwEFw` "ALLPOWERS S2000 vs Real Off Grid Demands"
- 🔬 RV/van: DC-DC charger off the alternator, shore power, 12V house, space/weight limits, smaller arrays · solar generators: rated-vs-surge watts, **the solar-input limit** (a "2000W" station may only accept ~500W of PV), expandability, when a power station beats a built system
- ✏️ "which rig is right for you" · 📊 **RV system diagram** + a power-station decision chart

## Module 7 — Turn It On, Troubleshoot & Grow
*Commission it, keep it alive, and the field reference for when it throws a code.*
- 📹 `Tfy3tLdBApw` "Adding Solar To Your Off Grid Homestead" (expanding)
- 🔬 **fault-code + troubleshooting reference** — "blank LCD = check battery/DC first (the screen runs on battery power)", Victron Err 11 = loose/thin DC wiring, Err 67 = lost BMS comms, the MPP Solar/Voltronic numeric table, EG4 alarms; diagnostic order (sun? wiring? setting? gear?); multimeter/clamp method; preventive maintenance
- ✏️ the **fault-code lookup table** (the third big written supplement) + commissioning checklist + expansion guide · 📊 **troubleshooting decision tree**
- 📹 bonus: `4nkt8HjTXXE` "DIY Solar Tracker Built Entirely From Scrap"; the 3200W array build series as an optional "watch the full build."

---

## The three written supplements (the paid value)
1. **The BOM, decoded** (M2) — every part: what / why / need-or-skip, with photos.
2. **How to read a spec sheet** (M3) — the binding numbers + the marketing traps.
3. **Fault-code + troubleshooting field reference** (M7) — symptoms → diagnosis → fix, per common brand.

## Diagrams Claude builds (SVG)
System block · annotated BOM · BOM decision tree · anatomy-of-a-spec-sheet · array layout/mounting · **full wiring diagram** (the centerpiece) · RV system · power-station decision chart · troubleshooting tree.

## Excluded (would rehash the free *Understanding* course)
`PmZhdYSB4pM` (components overview), `Fz5FZXaesCk` + `YRkqc62y0cA` (cost overview).

## Build pipeline (when approved)
Draft lessons from transcripts + the 3 research reports → build the diagrams → yt-dlp the videos → MCP course + **gold theme** → Linda reviews the wiring/safety module → landing page (gold) → add to Garden offer.
