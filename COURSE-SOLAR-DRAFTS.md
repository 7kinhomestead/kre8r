# Intermediate Off-Grid Solar — Module Drafts
*Draft for Jason's review. Voice: Jason Rutland. Blueprint: `SOLAR-COURSE-BLUEPRINT.md`. Research: `SOLAR-COURSE-RESEARCH.md`.*

> **CONVENTION:** every lesson opens with a `‹SOURCE — PULL BEFORE PUBLISH›` tag (strip before publish). `📊 [DIAGRAM — Claude builds: …]` marks where an SVG diagram goes (Claude builds those, not the draft). 📹 video · 🔬 research · ✏️ writing · 🔧 tool · 🛒 affiliate · ⚖️ disclaimer.
> **ANCHOR SYSTEM:** Jason's real rig = SunGold Power inverter + 4× LiTime 230Ah @ 48V (~12kWh), becoming his mother-in-law's RV power. EG4 12k / 35× CW 450W = Rock Rich S2 (advanced), kept OUT. **Affiliate:** SunGold + LiTime for the build gear; Signature Solar/EG4 for everything else + the step-up. **Don't re-teach the free *Understanding* course** (components/batteries/cost 101) — assume it. **The paid value = the written supplements** (BOM decoded, spec-sheet guide, fault-code lookup) a video can't be.

---

# Module 1 — Design YOUR System

### Lesson 1.1 — The tool that does it right
> ‹SOURCE — PULL BEFORE PUBLISH: `thAV7GHobsg` "I Built You A Tool To Make Solar Design Simple (And Free)" — Jason WAS a pro (designed/sold/installed); every company quote-tool is "really really wrong," worse off-grid; his free Sizer lives in the toolshed: energy audit → location (real NASA sun data) → full system + materials list at 3 price points.›

Here's a thing I can say that most folks selling you solar can't: I used to do this for a living. Designed it, sold it, installed it. And I'll tell you a secret from the inside — every quote that comes out of those fancy company design tools is wrong. Not a little wrong. *Thousands*-of-dollars wrong. And if you're off-grid? It's not even in the right zip code, because those tools are built to guess at a grid-tied house from its square footage, not to actually power your life off a battery.

So I built one that does it right, it's free, and it takes about five minutes. You log every appliance you actually plan to run — not a guess, the real list — it pulls the real NASA sun data for *your* dirt, and it hands you a full system design and a complete materials list at three price points. Every bit and bob.

**What you'll take:** The number that matters isn't your house's square footage — it's what *you* actually run. A design built on real loads is the difference between lights that stay on and a system you cuss at every cloudy week.

**Your move this week:** 🔧 Open the **Solar Sizer**, run your appliance list, and screenshot the design it spits out. That's our starting point — the next lesson shows you the math under the hood so you know it's not lying to you.

### Lesson 1.2 — Run the numbers yourself (so you know the tool isn't lying)
> ‹SOURCE — PULL BEFORE PUBLISH: `_tZdSuMgyYo` "How Much Solar Will You Need To Live Off Grid?" — data plate (V×A=W); duty cycle (fridge runs ~30% → 120W×7.2h=864Wh/day); sum all → daily Wh; ÷ average irradiance (sun-hours, ~6 in his area); ×125% for inefficiency/cloudy days; STC ~80% real-world rule → panel count.›

I'm not gonna hand you a black box and tell you to trust it — that's what the solar companies do. So let's do the math by hand once. Do it once and you'll never be at the mercy of a salesman's spreadsheet again.

Find the data plate on anything you want to run — it'll list volts and amps. Volts times amps equals watts. A mini fridge pulling 1 amp at 120 volts is 120 watts. But here's the part everybody fumbles: it's not running *all* day. A fridge compressor cycles maybe 30% of the time — so in 24 hours it's actually pulling those 120 watts for about 7.2 hours. 120 × 7.2 = **864 watt-hours a day.** Do that for everything on your list and add it up. Say you land at 4,000.

Now divide by your **sun-hours** — how many good hours of sun your spot actually gets (Google your average irradiance; ours runs about 6). And then — write this down — multiply by **125%**, because clouds happen and nothing's perfect. That's your real target. And panels never hit their sticker number, so plan on about **80% of the STC rating** on the label. *Ask me how I know.*

**What you'll take:** Watts × hours = watt-hours, sun-hours sets your array, and you pad it 25% or you'll be hauling a generator out in February. This is the whole design in one breath.

**Your move this week:** Hand-calc just your top three power hogs (fridge, well pump, whatever) and compare your total to what the Sizer gave you. When they line up, you'll *trust* the tool — and you'll know how to argue with anybody who tells you different.

### Lesson 1.3 — The shape of your system (and why 48V)
> ‹SOURCE — PULL BEFORE PUBLISH: ✏️🔬 research (48V cuts current ~4× vs 12V → smaller/cheaper/safer wire; DC-coupled architecture; the four pieces sized to the load) + 📊 system-flow diagram + anchor on Jason's SunGold + 4× LiTime 230Ah @ 48V rig.›
> 📊 [DIAGRAM — Claude builds: the 5-stage system flow (Solar → Charge Ctrl → 48V Battery → Inverter → Loads) with the high-current battery→inverter bus highlighted gold + the "5,000W = 104A@48V vs 417A@12V" callout. **BUILT.**]

Look at the diagram up top — that's every off-grid system that's ever existed, in five boxes. Sun hits the **panels**, a **charge controller** turns that into something your **battery** can drink, the battery feeds an **inverter**, and the inverter hands your house regular 120/240-volt power. On my rig — the one this whole course is built around — that's a SunGold inverter and four LiTime batteries at 48 volts, and a couple of those boxes (the controller and the inverter) live in one all-in-one case.

Now, why 48 volts and not 12? Pure physics, and it's the one number that quietly decides how much your build costs. Watts equals volts times amps — so for the *same* power, the higher your voltage, the *lower* your current. A 5,000-watt load is about **104 amps at 48 volts** but a brutal **417 amps at 12 volts.** Current is what forces you into fat, expensive copper and big scary fuses. Cut the current to a quarter and your wire gets smaller, cheaper, and a whole lot safer. That's the entire reason every real off-grid system this size runs 48 volts. That's just science.

**What you'll take:** Five boxes, one flow, and one rule — go 48V at this size so the *current* (and your wire bill) stays sane. Everything we build from here hangs on that gold line in the diagram.

**Your move this week:** On your Sizer design, find three numbers: your battery voltage (should be 48), your array watts, and your inverter's continuous watts. Those three are the spine of your system — write 'em where you'll see 'em. Module 2 is where we walk your shopping list part by part.

---

# Module 2 — Every Part, Explained (the BOM)

### Lesson 2.1 — What's actually in the box (and the one rule for the whole list)
> ‹SOURCE — PULL BEFORE PUBLISH: 📹 `OFrqbN9HMBQ` "What We Use for Our Off Grid Solar Array" (panels→charge controller→batteries→inverter→distribution, the five real boxes on his property) + 🔬 Pass-1 synthesis (full BOM: panels, racking, MPPT/all-in-one, LiFePO4+BMS, inverter, combiner, DC/AC disconnects, breakers/fuses, SPD, busbars, shunt, cable, grounding) + ✏️ the "need-it-or-skip-it" framing that runs the whole module.›

Oh, hello. Didn't see you standing there with your shopping cart full of question marks. Good — pull up a stump, because this is the part nobody sells you straight.

Here's the problem with every off-grid solar shopping list you've ever found online: it's either a sales sheet trying to talk you into the deluxe everything, or it's some forum guy's pile of gear that worked for *his* dirt and might burn down *yours*. I used to design and sell and install these systems for a living, and I'll tell you the dirty secret of the whole trade — half the line items on a "complete kit" are there because they pad the invoice, and half the ones you actually need to keep your family safe get left off because they're boring and cheap and nobody gets a commission on a busbar.

So that's what this whole module is. We walk your list one part at a time, and for every single thing I'm going to tell you four things: what it is, what it does, why it's in the system, and the one that's worth the whole nineteen bucks — **when you genuinely need it and when you can safely skip it.** That last one is the entire game. Knowing what to *not* buy is how a guy who started with negative twenty-seven dollars in the bank builds a system that runs five kids and a freezer.

One rule before we start handling parts. Look at my actual array — the one out behind the chickens. It's panels, a charge controller, a battery bank, an inverter, and a little distribution panel. *Five things.* Everything else on the big list — the fuses, the busbars, the disconnects, the surge protector — those aren't *more system.* They're the safety and the plumbing that connect those five things without killing you or melting your wire. So when you look at a forty-line bill of materials and feel your stomach drop, remember: it's still five boxes. The rest is glue and seatbelts. That's just science.

📊 [DIAGRAM — Claude builds: annotated BOM exploded view — the five "core" boxes (panels / charge controller / battery+BMS / inverter / distribution) drawn large and in color, with the "glue & seatbelts" parts (combiner, DC disconnect, AC disconnect, fuses/breakers, SPD, busbars, shunt, ground rod, cable) called out in a second tier connecting them. Each part tagged CORE / SAFETY / PLUMBING.]

**What you'll take:** A complete off-grid system is five working parts plus the safety and plumbing that join them. The skill isn't buying everything — it's knowing which line items keep your family alive and which ones are just somebody's commission.

**Your move this week:** Print your Solar Sizer materials list and put one of three letters next to every line — **C** for core, **S** for safety, **P** for plumbing. You won't know all of them yet. That's fine — that blank spot is exactly the lesson you're about to read. By the end of this module every line has a letter and you'll know why it's there.

---

### Lesson 2.2 — The four big boxes: panels, racking, the brain, and the battery
> ‹SOURCE — PULL BEFORE PUBLISH: 📹 `OFrqbN9HMBQ` (8× Canadian Solar panels built into a water-shedding frame; old Harbor Freight charge controller; SunGold 6548 all-in-one with built-in 48V charge controller + generator-start; Duracell golf-cart 6V-in-series-to-48V → course anchor is the LiTime 230Ah rig) + 🔬 Pass-1 findings #2 (DC-coupled), #3 (all-in-one), #4 (inverter 1.2× + heat derate), #6 (MPPT rated by output amps), #7 (LiFePO4 12kWh bank). ⚓ Anchor: SunGold inverter + 4× LiTime 230Ah @ 48V.›

These are the four you already kind of know from the free course, so I'm not going to re-explain what a solar panel *is* — you know it makes power when the sun hits it. What the free course doesn't tell you is **when each one is a need versus a skip,** and that's where your money lives.

**Solar panels.** What they are: your income. Everything downstream just stores and converts what these collect. On my array that's eight Canadian Solar panels — and here's a thing I did that most folks don't think of: I built them *into* the frame so the whole structure sheds rainwater for catchment, and the chickens live underneath in the shade. A panel's a roof that happens to make electricity. *Need-it-or-skip-it:* you can't skip panels, obviously, but you *can* skip the premium-brand markup. A panel is a panel — the binding number is the spec sheet, which is all of Module 3. **Need: always. The judgment call is how many and which spec, not whether.**

**Racking.** What it is: the metal that holds the panels at the sun and keeps them from becoming kites in a windstorm. *Need-it-or-skip-it:* you need *something* — panels flat on the dirt is how you grow a panel-shaped garden of regret. But you do *not* need a four-hundred-dollar engineered rail kit to start. Mine's a welded frame doing double duty as a water roof and a chicken condo. **Need: yes, the function. Skip: the fancy branded rail if you can build or scrounge a sound mount.** Just get the angle and the anchoring right — that's Module 4.

**The brain — charge controller / all-in-one inverter.** This is the box that does the most thinking, and it's where I want you to make the smartest single decision in your whole build. A charge controller takes the wild voltage off your panels and turns it into something your battery can safely drink. The inverter takes the DC out of the battery and turns it into the 120/240-volt AC your house actually uses. *Now* — you can buy those as two separate boxes, or you can buy one **all-in-one** that has the charge controller, the inverter, and a battery charger all in one case. My SunGold 6548 is exactly that: built-in 48-volt charge controller, and it'll even kick on a generator when the battery gets low. The research backs this hard — for anything under about six to eight kilowatts, the **DC-coupled all-in-one is simpler, more robust, and actually charges your battery more efficiently** (MPPT charging runs up around 99% versus the high-80s/low-90s for the AC-coupled way of doing it). *Need-it-or-skip-it:* for a 5kW homestead, **skip the separate-components route — buy the all-in-one.** Fewer boxes, fewer wires, fewer things to wire wrong at 11pm. The representative mid-size unit in the research is the EG4 6000XP (6kW inverter, 8kW of solar input) — that's the kind of one-box brain we mean. Mine's the SunGold flavor of the same idea.

Two numbers to get right on the brain so you don't cuss it later. **Size the inverter at least 1.2× your biggest continuous load,** and know that it *derates with heat* — the research example is a 6kW unit that may only push about 4.8kW once it's sitting in 40°C heat. Buy a little bigger than the sticker suggests, because your inverter will spend July hot. And the **charge controller is rated by its output amps,** so it carries more solar wattage at higher voltage — a 100-amp controller handles roughly 4,800W at 48V (versus only ~1,200W at 12V). That number right there is half the reason we went 48V in Module 1.

**The battery bank.** What it is: your savings account. The panels are the paycheck; the battery is what you live on after dark and during that cloudy week in February. Now — full honesty, because that's the deal between us — the battery on my array in that old video is a string of Duracell golf-cart batteries, 6-volt lead-acid wired in series up to 48 volts. They worked. But **this course is built around the rig I'd actually tell you to buy: four LiTime 230Ah LiFePO4 batteries at 48 volts — about 12 kilowatt-hours.** Why LiFePO4 and not the golf-cart route? The research is lopsided: LiFePO4 runs **4,000 to 8,000-plus cycles,** it'll take a deeper discharge without complaining, and a typical off-grid home wants 10–30 kWh of storage — so a ~12kWh bank gives you roughly a day-plus of autonomy depending on how frugal you run. *Need-it-or-skip-it:* you cannot skip a battery on a true off-grid system. But you **can and should skip lead-acid** for a new build — the lithium costs more up front and saves you money and headaches across its life. A dollar saved across 6,000 cycles is worth more than a dollar earned. **Need: always lithium for a new off-grid build.**

📊 [DIAGRAM — Claude builds: the four "core" boxes laid out left-to-right — Panels (+ racking under them), the all-in-one brain (showing the three functions folded inside: charge controller + inverter + AC charger), and the 48V LiFePO4 bank — with the key sizing numbers pinned to each (panels = spec-sheet driven, inverter = 1.2× load & derates with heat, controller = rated by output amps ≈ 4,800W@48V, battery = ~12kWh / 4,000–8,000 cycles).]

**What you'll take:** Panels are income, the all-in-one is the brain (buy one box, not three, under ~6kW), the battery is savings — and for a new build it's lithium, full stop. Size the inverter 1.2× over your load and expect it to lose some muscle in the heat.

**Your move this week:** On your Sizer list, circle your inverter's continuous-watt rating and multiply your single biggest appliance's running watts by 1.2. If the inverter number isn't comfortably above that, you sized too tight — note it. We fix sizing mistakes on paper for free; we fix them in the field by buying the box twice.

---

### Lesson 2.3 — The seatbelts: every safety and plumbing part, need-it-or-skip-it
> ‹SOURCE — PULL BEFORE PUBLISH: 🔬 Pass-1 findings #5 (battery cable + overcurrent: 4/0 AWG & ~250–400A for a 5.5kW/48V inverter; 2/0 & 110A for 3000W), #8 (combiner box = strings + per-string fuses + busbars + optional SPD/disconnect; NO hard 3-string rule), #9 (DC + AC disconnects required, NEC 690.13/690.15), #10 (exactly ONE neutral-ground bond), #11 (functionally-grounded inverter eliminates separate DC grounding ELECTRODE, not module-frame EGC). ✏️ shunt/monitor, busbars, SPD framing. ⚖️ every code line is awareness-level — verify against your gear's manual + local AHJ.›

This is the lesson the kit-sellers skim and the forum heroes get wrong, so this is the one to re-read on your phone in the driveway with parts in your hand. None of these make power. Every one of them is a seatbelt or a length of plumbing — and a couple of them are the difference between "off-grid homestead" and "the fire marshal has questions."

I'm going to go fast and honest, need-it-or-skip-it on each. And the disclaimer that rides on this entire lesson: **every code and sizing number here is a rule of thumb to make you smart enough to ask the right question — your gear's own manual and your local inspector (the AHJ) are the final word. Verify your own.** DC arcs don't care about your feelings.

**Cable / wire.** What it is: the veins. The fatter and shorter, the less power you waste as heat. *Need-it-or-skip-it:* never skip, never cheap out, never go thinner than the table says. For a ~5kW / 5,500W inverter at 48V the research points at **4/0 AWG battery cable**; a smaller 3,000W unit at 48V wants **2/0 AWG.** (And here's the 48V payoff again — that same 3,000W at *12V* would need the giant 4/0 instead of 2/0. Higher voltage, smaller veins, cheaper build.) **Need: always — and the gauge is set by the table, not by what's on sale.**

**Breakers & fuses (overcurrent protection).** What they are: the thing that lets go before your wire melts. *Need-it-or-skip-it:* **never skip.** Sized to the run: that 5,500W/48V inverter pairs with roughly a **250A breaker or 400A fuse**; the 3,000W/48V unit wants about **110A.** Those numbers look way bigger than the steady draw on purpose — they carry surge and voltage-drop headroom. **Need: always, on every leg the manual calls for.** This is the cheapest insurance in the entire box.

**DC disconnect and AC disconnect.** What they are: big manual switches that let you fully kill power to work on the thing without getting bitten. *Need-it-or-skip-it:* the code (NEC 690.13 and 690.15) calls for a disconnecting means on **both** the DC side (array-to-inverter) and the AC side (inverter-to-panel). **Need: yes — and not just for the inspector. The day you need to work hot or shut it all down in an emergency, this is the switch your hand goes to. Skip it and the only "off switch" is unbolting a live battery cable, which is a fool's errand.** (Small print: the line-side terminals can stay live even when it's open — that's why they wear a warning label. Respect it.)

**PV combiner box.** What it is: a junction that takes several *strings* of panels, fuses each one, and combines them into one feed — and it can house busbars, a disconnect, and a surge protector. *Need-it-or-skip-it:* this is a genuine **skip for a lot of you.** You need a combiner when you've got **multiple strings to gather and protect.** Running a single string into an all-in-one? You may not need a combiner box at all. (And ignore anybody who tells you "you must have one above exactly three strings" — that hard rule got knocked down in the research. It's about how many strings you actually have, not a magic number.) **Need: only with multiple strings. Single string into the all-in-one → skip.**

**Surge protective device (SPD).** What it is: a sacrificial chunk that eats a voltage spike — nearby lightning, a surge — so it dies instead of your expensive brain. *Need-it-or-skip-it:* **optional-but-smart.** Not strictly required for the system to run, genuinely worth it if you're up on a ridge, out in the open, or anywhere lightning likes to visit. **Need: situational — cheap insurance where weather is mean. Skippable on a sheltered, low-exposure site if the budget's bleeding.**

**Busbars.** What they are: a chunky metal bar that lets a bunch of wires share one connection point cleanly — your battery negatives, your grounds. *Need-it-or-skip-it:* **need it the moment you've got more than a couple of wires landing on one terminal.** Trying to stack five ring terminals on one battery post is how you get a loose, hot, arcing mess. A busbar is a few bucks and makes the whole build neater and safer. **Need: yes, on any real multi-wire build. The neat junk-pile move, not a splurge.**

**Battery shunt / monitor.** What it is: a little meter that watches every amp going in and out so you actually know your true state of charge — your fuel gauge. *Need-it-or-skip-it:* **technically a skip — the system runs without it.** But running an off-grid battery with no real monitor is driving cross-country with the gas gauge taped over. *Ask me how I know.* On the old array we could never figure out why phones died fast and chargers cooked — turned out we were flying blind on a bad inverter and no real read on the system. A shunt would've told the truth. **Need: not for function — yes for sanity. Cheap, and it ends the guessing.**

**Grounding & bonding.** What it is: the safety path that sends a fault to the dirt instead of through *you.* This is the one people botch. Two things to burn in: **(1) you bond neutral-to-ground at exactly ONE point** — one main bonding jumper, no more. Multiple bonds put stray current onto your grounding wires, which is its own hazard. For off-grid, that single bond is **enabled** at the inverter. **(2)** A modern functionally-grounded inverter (transformerless, UL1741-listed) can spare you a *separate* DC grounding electrode system — but **your module frames still have to be bonded.** That part never goes away. *Need-it-or-skip-it:* **none of this is skippable. Ever.** Get the *one bond* right and the *frames bonded* — and because grounding is where code is strictest and most local, this is the spot to verify against your inverter's manual and, for the AC tie-in, lean on a licensed electrician. **Need: always — and verify, don't guess.**

📊 [DIAGRAM — Claude builds: "Do I actually need this component?" decision tree. One entry node per safety/plumbing part, each flowing to a NEED / SKIP / SITUATIONAL leaf with the deciding question on the branch — e.g. Combiner → "More than one PV string?" Yes=NEED / No=SKIP; SPD → "Exposed/high-lightning site?" Yes=NEED / No=optional; Shunt → "Want a real fuel gauge?" → strongly-recommended; Cable/Breakers/Disconnects/Grounding all hard-wired to NEED with their sizing rule on the leaf (4/0 & ~250–400A @ 5.5kW/48V, one neutral-ground bond, frames always bonded).]

**What you'll take:** Cable, overcurrent protection, both disconnects, and grounding are never-skip — they're the seatbelts. The combiner and SPD are situational, the shunt is sanity-not-survival, and the busbar is the cheap neat-junk-pile move. Knowing the four you can't skip is most of staying alive.

**Your move this week:** Go back to your three-letter list from Lesson 2.1 and finish it — every line now gets C, S, or P, and every S (safety) line gets a checkmark only once you've confirmed its size against your gear's manual. Anything you can't size yet is a Module 3 problem, which is exactly where we're headed: learning to read the spec sheet so the catalog stops lying to you. I'll catch you in the next one.

---

# Module 3 — Buy It Right (read the spec sheet, dodge the trap)

### Lesson 3.1 — The spec sheet is a magic trick (here's where to look)
> ‹SOURCE — PULL BEFORE PUBLISH: 📹 `2qyyDvAC2Yk` "Testing The Ampeak 3000w Inverter" ("I didn't know what I didn't know"; modified-vs-pure-sine wave lesson; only-buy-pure-sine rule; the budget unit's display shows watts/input V/SoC/output V & Hz) + 🔬 Pass-2 synthesis (read the datasheet not the hero number; the binding spec is rarely the one in the product name) + ✏️ "anatomy of a spec sheet" framing.›

Stop me if this sounds familiar. You've got three browser tabs open, three inverters that all say a big confident number on the front, and no earthly idea which one won't leave you in the dark. Good. That's the honest starting place, and it's a better starting place than where I started, which was buying a truck-stop inverter and finding out the hard way.

Let me regale you. Our first array was used panels, a clearance-rack charge controller, and that truck-stop inverter, and it sort of worked — except our phone batteries died stupid fast, our charging blocks got blazing hot and quit, and random electronics just acted the fool. The problem wasn't the gear being cheap. The problem was **I didn't know what I didn't know** — and the specific thing I didn't know was that the inverter was *modified* sine wave. Sensitive electronics hate that. It can flat damage them. So I made myself a rule I've never broken since: **I only buy pure-sine inverters.** I might not strictly need it for one job, but the day I move that inverter to another job that *does* need it, I'm covered.

That whole expensive lesson? It was sitting right there on the spec sheet the whole time, in two words I didn't know to look for. That's what this module is. A spec sheet is a magic trick — the manufacturer waves the big number in the product name to hold your eye, while the number that actually decides whether the thing works for you is sitting quietly in row eleven. We're going to learn to watch the other hand.

Here's the through-line for the whole module, so write it on your hand: **compare continuous watts (not peak), usable kWh (not nameplate), PV-input and AC-output as two separate lines, and always temperature-correct your panel voltage.** Four habits. Every trap in the next two lessons is just one of those four getting skipped. Even that little budget Ampeak I tested had a display that honestly showed me input voltage, state of charge, output voltage *and* hertz — a good unit doesn't hide the real numbers, it shows them to you. Learn to read them and no salesman owns you again.

📊 [DIAGRAM — Claude builds: "Anatomy of a spec sheet" — a stylized inverter/battery datasheet with the BIG hero number (the product name, e.g. "12000XP") greyed/struck, and bright callout arrows to the four numbers that actually bind: CONTINUOUS output watts, MAX PV INPUT (voltage + watts) as a separate line from AC OUTPUT, USABLE kWh (nameplate × DoD), and the temperature/Voc note. Caption: "the name is the magician's patter — read the other hand."]

**What you'll take:** The number in the product name is bait; the binding spec is somewhere lower on the sheet. Four habits decode any datasheet — continuous not peak, usable not nameplate, PV-input separate from AC-output, and temperature-correct your voltage. And only ever buy pure sine.

**Your move this week:** Pull the actual PDF spec sheet for the inverter you're eyeing. Don't read it yet — just find it and save it. Next lesson we read it together, and you'll spot the trap before I point at it.

---

### Lesson 3.2 — The inverter traps: PV-in vs AC-out, and continuous vs surge
> ‹SOURCE — PULL BEFORE PUBLISH: 🔬 Pass-2 findings #1 (PV-input vs AC-output separate lines — EG4 12000XP: 24kW PV in / 12kW AC out w/o PV, 15kW w/ PV ≈ 2×; Victron RS: 4,800–5,300W AC out but only 4,000W DC solar in) + #2 (continuous vs surge — EG4 12000XP 15,000W cont. vs 15,360W surge ~10s battery-only; Victron RS ~4,800–5,300W cont. vs 9kW/3s & 7kW/4min). All numbers are model+revision specific — read YOUR unit's sheet.›

Two traps live on every inverter sheet, and both are the same trick: **a unit's name matches one number while it quietly does a very different number on the line that actually matters to you.**

**Trap one — PV input is NOT AC output.** These are two separate spec lines and people read one as the other constantly. Take the EG4 12000XP. It'll *ingest* up to **24,000 watts of solar** (12kW per MPPT), but its **AC output is 12,000 watts** without PV assist (15,000 with). The solar input is roughly **double** the AC output. Now flip it the other way so you really feel it: the Victron Inverter RS Smart Solar puts out **4,800–5,300 watts of continuous AC**, but it only accepts **4,000 watts of DC solar** in. Same sheet, two completely different numbers — one unit's input dwarfs its output, the other's output beats its input. If you'd assumed "the watts is the watts," you'd size your panel array dead wrong on either one. **Read PV-input and AC-output as two separate lines, every time.** The leftover PV beyond what the inverter can output just goes to charging the battery or goes unused — it's not a bonus to your AC.

**Trap two — continuous is NOT surge.** Every inverter lists a continuous wattage and a surge (peak) wattage, and the surge number is a brief, time-limited, often-battery-only burst that you must **never** size a load to. The EG4 12000XP holds **15,000W continuous** but its surge of **15,360W lasts about 10 seconds, battery only.** The Victron RS sustains **~4,800–5,300W continuous** but can hit **9kW for 3 seconds and 7kW for 4 minutes** — and notice even its continuous number *derates with heat,* down to 4,500W at 40°C and 3,000W at a brutal 65°C. The surge is there to start a motor — a well pump, a compressor — that spikes hard for a half-second then settles. It is **not** the size of system you own. Size your real, all-day load against the **continuous** number, with that 1.2× cushion from Module 2, and treat surge as a separate "can it kick my biggest motor to life" check.

One honest caveat that *is* the lesson: these exact numbers are specific to these exact units **and even to the hardware revision** — the 12000XP's continuous rating actually shifted from 12kW to 15kW between revisions. That's not me hedging. That's the whole point of this module: **you read YOUR unit's own current sheet, because the number moved and the name didn't.**

📊 [DIAGRAM — Claude builds: two side-by-side "trap" panels. LEFT (PV-in ≠ AC-out): EG4 12000XP bar showing 24kW PV-IN towering over 12kW AC-OUT (≈2×), beside Victron RS showing 4,000W PV-IN shorter than ~5,300W AC-OUT — caption "two separate lines, every time." RIGHT (continuous ≠ surge): a timeline bar for each unit — continuous rating as the long steady band vs surge as a tiny 3–10 second spike (labeled "battery only"), with Victron's heat-derate steps (5,300W→4,500W@40°C→3,000W@65°C) shown shrinking the steady band.]

**What you'll take:** PV-input and AC-output are two different lines that can differ by 2×; size your array to the right one. Continuous is the system you own — surge is a few-second motor-starting burst you never build around. And continuous itself shrinks in the heat.

**Your move this week:** On the spec sheet you saved last lesson, find and write down four numbers: continuous AC watts, surge watts (and how many seconds), max PV input watts, and max PV input *voltage.* That last one is a killer all its own — it's the whole next lesson.

---

### Lesson 3.3 — The trap that fries gear, the battery lies, and where I actually bought my rig
> ‹SOURCE — PULL BEFORE PUBLISH: 🔬 Pass-2 findings #3 (every inverter/controller has a hard MAX PV input voltage the array Voc must never exceed — EG4 12000XP 500 VDC ceiling, >500 voids warranty; check Voc not Vmp) + #4 (Voc RISES as panels get cold, β ≈ −0.27 to −0.32%/°C; cold-morning Voc drives string sizing; failing to temp-correct = most dangerous string error; Victron worked example 3×SPM50-12 → 74.5V at −10°C) + #5 (STC is a lab figure; real panels run 20–35°C hotter, output below nameplate) + #6 (Ah is meaningless without voltage; Ah×V=Wh; EG4 LifePower4 51.2V×100Ah=5.12kWh) + #7 (BMS continuous-current limit bottlenecks a big inverter; LifePower4 BMS caps 100A ≈ 5.1kW → parallel batteries). 🛒 AFFILIATE (locked): SunGold (inverter) + LiTime (batteries) = exact build gear; Signature Solar/EG4 = everything else + the step-up. Frame honest.›

Two of the meanest traps left, and then I'll tell you exactly where I bought my own gear — no mystery, no affiliate weaseling.

**The trap that physically destroys your charge controller — cold Voc.** Here's the one that gets good, careful people, because it's counterintuitive. Every inverter and charge controller has a **hard maximum PV input voltage** your array must never exceed. The EG4 12000XP's ceiling is **500 VDC** — and the sheet says it plain: damage from going over 500 **is not covered under warranty.** Now the cruel part: **a panel's open-circuit voltage (Voc) RISES as it gets colder.** Not falls — *rises.* So your array might sit safely under the limit on a warm afternoon and then, on a clear cold January morning, climb right past the ceiling and **permanently fry the input.** This is the single most common and most dangerous string-sizing mistake there is. Two things save you: **(1)** check your panels' **Voc**, not Vmp — Voc is the highest voltage the open array ever presents — and **(2)** temperature-correct it for your coldest morning. The coefficient for crystalline silicon runs about **−0.27 to −0.32% per °C.** Victron's own worked example: three little SPM50-12 modules in series read about 66.6V at lab temp but climb to **74.5V at −10°C.** Run that math against your record low *before* you buy, because the controller you save is your own. (And this is exactly why the panel's STC sticker is a lab fiction in the first place — 25°C, perfect light — while a real panel bakes 20–35°C hotter at noon and reads differently cold. The label is a starting point, not a promise.)

**The battery lie — Ah is meaningless without voltage.** A battery listed at "100Ah" tells you *nothing* about how much energy it stores until you know its voltage, because **Amp-hours × Volts = Watt-hours.** A 100Ah battery at 12V is 1.28kWh. A 100Ah battery at 48V is **5.12kWh** — same Ah, **four times** the energy. The EG4 LifePower4 spells it out: 51.2V × 100Ah = 5.12kWh nameplate. So when you compare batteries, **convert everything to watt-hours** or you're comparing nonsense. And one more that bites people pairing a small battery to a big inverter: **the BMS sets a continuous-current limit that can bottleneck your whole system.** That LifePower4's BMS caps at 100A — which at 51.2V is only about **5.1kW** in or out of a *single* battery, no matter how big your inverter is. Bolt one of those to a 12–15kW inverter and you've starved it. That's *why* you parallel batteries — so the total BMS current actually feeds the inverter you bought. (It's also exactly why my anchor rig runs **four** LiTime 230Ah batteries, not one big number on a box.)

**Now — where I actually bought my rig, straight.** Here's the deal between us, no corporate fog: the **inverter on my build is a SunGold** and the **batteries are four LiTime 230Ah at 48V.** That's the real gear, genuinely on my property, genuinely about to go run my mother-in-law's RV. So if you want to copy *exactly* what I built, those are the two links — 🛒 **SunGold** for the inverter, 🛒 **LiTime** for the batteries. For everything else — your panels, wire, breakers, racking, disconnects, all of it — and for the day you outgrow this and want to step up to the bigger 12kW-class EG4 rig, 🛒 **Signature Solar / EG4** carries basically the whole list under one roof. So the honest version is: *here's my exact rig and where I got it; for the rest of the parts, and for when you go bigger, here's the one-stop shop.* I'm not the boss of you — buy wherever you want. But you asked what's actually behind my chickens, and that's it.

📊 [DIAGRAM — Claude builds: two stacked panels. TOP (cold-Voc trap): a thermometer axis from warm→cold with a panel-string voltage line RISING as temperature drops, crossing a red "MAX PV INPUT VOLTAGE (e.g. 500V) — WARRANTY VOID ABOVE" ceiling on the coldest morning; the Victron worked example (66.6V@25°C → 74.5V@−10°C) annotated on the curve. BOTTOM (Ah lie + BMS bottleneck): same "100Ah" battery shown at 12V=1.28kWh vs 48V=5.12kWh (×4), plus a single 48V/100Ah battery's 100A BMS (~5.1kW) drawn as a narrow pipe choking a 12–15kW inverter, with four batteries in parallel widening the pipe to feed it.]

**What you'll take:** Cold makes panel voltage rise — temperature-correct your Voc against your record low or the controller dies (and voids warranty). Ah means nothing without voltage; always convert to watt-hours. And a single battery's BMS current can choke a big inverter, which is why you parallel them. My real rig: SunGold inverter, four LiTime 230Ah at 48V.

**Your move this week:** Do the two-minute math that saves your gear. Take your panels' Voc, look up your area's record-low temperature, and multiply the cold rise in (about −0.3% per °C below 25°C, *added* to Voc as it gets colder) — confirm your worst-case string voltage lands safely under your controller's max-input ceiling. If it's close, drop a panel from the string. That one calculation is the whole reason this module is worth more than the video. Verify it against your own gear's manual and your local code — then go build. Love you. Bye-bye.

---

# Module 4 — Build It: Mount the Array & Set the Gear

### Lesson 4.1 — Racking: build the bones (and steal a second job from your array)
> ‹SOURCE — PULL BEFORE PUBLISH: 📹 `2gpl_eOaKvw` "DIY Solar Panel Installation - 4 SunGold 590w Full Process" (the wood-rack build off a junk-pile 4×6, high-side uprights + low-side 4×4, tilt toward the sun, the "this voids the warranty but it solves a bigger problem — water collection" justification) + 📹 `DOsEJEwStdE` "So We Built An Off Grid Solar Array To Start Over" (frame built to shed water → garden + covered storage underneath; "check Square before fastening the 2×6 hangers"). 🔬 racking/orientation basics. ✏️ the physical build order. Anchor: Jason's real SunGold rig.›

Most folks think the hard part of a solar build is the wires. It ain't. The hard part is the boring part nobody films — the racking. The bones. Get the bones wrong and crooked and out of square, and every single thing you bolt to it after that is gonna fight you. Ask me how I know.

So here's the order, and it matters: **frame first, panels second, wires dead last.** Module 5 is where we make it live. Today we just build something strong enough to hold a small tree's worth of glass and aluminum off the ground at the right angle, and — if you're me — get it to do a second job while it's up there.

My array sits on a wood rack I built out of some 4×6's I pulled out from under somebody's house when I was helping them clean it out. *Never underestimate the power and value of a well-curated junk pile.* High-side uprights, low-side 4×4's, so the whole face tilts toward the sun. Now — fair warning, and I'll say it again louder in a second — **mounting panels flat-faced on a frame like mine will more than likely void the panel warranty.** I do it anyway, on purpose, because that big flat tilted face becomes a roof. It sheds rain into a catchment for the garden and it gives me dry covered storage — and a place to sit when it's raining — underneath. That's a more expensive problem to solve than a panel warranty is worth to me. Your math might be different. *I'm not the boss of you.* But know the trade you're making before you make it, don't find out in a comment section.

Two rules of thumb on the angle, and then go verify against your own dirt:

- **Point the face at the sun, tilted up off flat.** A panel laid dead-flat collects every leaf, every bird, and a puddle. Tilt sheds all three and aims the glass where the power is.
- **South-ish, in the northern hemisphere, is the default** — but your trees, your ridgeline, and your worst season decide the rest. [VERIFY: exact tilt-angle-by-latitude numbers — not in the transcripts or research; teach it as "tilt toward the sun, steeper for winter-heavy use" and tell them to confirm for their latitude.]

And here's the one that'll save you an afternoon of cussing: **check square before you fasten.** On the "Start Over" array our joists came out a hair off-square and the panels wouldn't drop into their seats — had to pull hangers and redo it. A framing square costs four bucks. Pulling a 2×6 hanger you already lagged in costs you your whole evening.

📊 [DIAGRAM — Claude builds: a labeled side-and-front view of a tilted ground-mount wood rack — high-side uprights, low-side posts, the tilt angle called out, the 2×6 panel-seat hangers, and the "shed water → catchment + dry storage underneath" double-duty annotated. Show "CHECK SQUARE HERE" on the hanger detail.]

**What you'll take:** Frame first, and build it strong and *square* before a single panel touches it — because everything downstream inherits whatever you got wrong here. And if your rack can pull a second job — water off the garden, dry storage under — let it.

**Your move this week:** Decide your mounting surface and your tilt before you buy a thing. Walk your spot at the time of day and the season you need power most, and watch where the shadows fall. Sketch the rack. Count your junk pile. That sketch is your cut list.

### Lesson 4.2 — Set the panels & set the gear (and why you wire it LAST)
> ‹SOURCE — PULL BEFORE PUBLISH: 📹 `2gpl_eOaKvw` (heavy, awkward 590W bifacial panels — two-person lift; "the last connection is the only live one — run the wire first"; two isolated PV strings on the SunGold inverter let him mix old + new panels; "electrically similar" rule for adding to an existing string; all-in-one = controller + inverter in one case). 🔬 all-in-one/DC-coupled architecture (research Pass 1 #2,#3); bifacial. Anchor: SunGold inverter + the array it feeds.›
> 📊 [DIAGRAM — Claude builds: array layout / panel-placement diagram — the 4-panel SunGold rack from the front, the two ISOLATED PV strings color-coded back to the all-in-one's two MPPT inputs, the battery bank and the all-in-one box sited near each other on a wall, and the high-current battery↔inverter run kept SHORT. Mark "string A" / "string B" and "do NOT mix dissimilar panels within one string."]

Now we hang the glass and set the boxes. Two things to get straight before you lift anything.

**One: these panels are heavier and meaner than you think.** My SunGold 590-watt bifacials are roughly the size and weight of a small tree, and the good ones are built like a tank — double-walled extruded aluminum frame, thick glass, not those flimsy L-bracket corners. That quality is exactly why they're a two-person carry. Get a helper, watch your head (I bump mine about twenty times a build — that's just science), and slide each panel into its seat on the rack.

A word on **bifacial**, since it's why four of my new panels out-make eight of my old ones: they collect light off the *back* too — the errant photons that punch through and bounce off the ground hit the rear face and make a little extra power. Which means you want them up off the ground with something reflective-ish underneath and air behind them, not slapped flat against plywood. Free watts, if you mount them so they can breathe.

**Two — and this is the rule the whole next module hangs on: you set the panels now, but you do NOT wire them together yet.** Here's why, and burn it in: a solar panel sitting in the sun is making power whether you're ready or not. I sat in a safety class and watched panels indoors, upside down, no direct sun, still pumping out 75% of their rated voltage. So you treat every panel as live, always. The move — the same one I'll hammer in Module 5 — is you build the whole array, you run your wires, you do every safety connection while it's dead, and **the very last thing you ever do is one final connector click that makes it live, by which point your hands are nowhere near the dangerous voltage.** That's not me being cute. That's the entire reason a regular person can do this safely. *Run the wire first.* The last connection is the only hot one.

Now, **setting the gear.** On my rig the charge controller and the inverter live in one all-in-one box — that's the DC-coupled, single-box setup we picked back in Module 1 because it's simpler, more robust, and charges the battery more efficiently than splitting it out. Two siting rules:

- **Put the battery bank and the all-in-one close together, on a wall, out of the weather.** The fat, scary, expensive cable in your whole build is the one between the battery and the inverter — every inch you add there costs money and adds loss. Short run. We size that exact cable in Module 5.
- **Mount the box where it can breathe.** These things have fans and they shed heat; a baked inverter throttles itself or faults out. Good airflow, no direct sun cooking it.

One bonus from my SunGold I get asked about constantly: it has **two separate, isolated PV string inputs.** That's the only reason I could bolt four brand-new 590W panels onto the same system as eight old 400W panels — each kind got its own isolated string. **You cannot just toss a random new panel into an *existing* series string.** If you're adding to a string, the new panels have to be *electrically similar* — close on watts, volts, and amps, right off the label — or the mismatch drags the whole string down. Different panels, different strings. Say it with me: *electrically similar.*

**What you'll take:** Hang the panels, set the battery and all-in-one close and ventilated — and stop there. Panels placed, nothing connected. A built-but-dead array is exactly where you want to be walking into the wiring module. And if you're ever mixing panels: same string = electrically similar, or give the oddballs their own isolated input.

**Your move this week:** Get your panels physically on the rack and your battery + all-in-one mounted and breathing — and leave every wire disconnected. Snap a photo of your two MPPT inputs (or one, if that's your unit) and note which string feeds which. Next module, we make it safe, and *then* we make it live.

### Lesson 4.3 — Set the battery bank (the heavy, frozen-fingers stuff)
> ‹SOURCE — PULL BEFORE PUBLISH: 📹 `CyeHxhjiuvU` "Installing A 4000Wh LiFePO4 Watt Cycle Battery" (LiFePO4 vs lead-acid: 300-500 cycles vs 10-15× the deep cycles, energy density — 70Ah lead-acid swapped for a far denser lithium pack in ~same space; the COLD problem — lithium won't charge below freezing, low-temp shutoff is a feature, he insulates the box + adds a small mat heater; longer studs + plastic terminal insulators included; Bluetooth/BMS app; "no sizzling, that's a good sign"). 🔬 LiFePO4 chemistry + ~80-90% DoD usable (Pass 1 #7). Anchor: 4× LiTime 230Ah @ 48V main bank; the Watt Cycle pack = the mother-in-law's RV smaller-rig parallel.›

Last physical job before we touch a single connection: **set the battery bank and make it a happy place to live.** Lithium is fussy about exactly two things, and if you respect them it'll outlast everything else you own.

First, **why lithium at all** — because I was a lead-acid guy for years and I'll tell you what changed my mind. A lead-acid battery gives you maybe 300 to 500 cycles before it's cooked, and out here off-grid you discharge deeper and more often than you ever plan to, so a lead-acid bank you cycle daily is dead in a year, maybe two. I know folks will argue me on that — that's been my lived experience. LiFePO4 takes ten to fifteen times the deep cycles, packs way more energy in the same box, and you can run it down hard without murdering it. Double the sticker price, ten-plus times the usable life. *A dollar saved is worth more than a dollar earned,* and that math runs in lithium's favor every time off-grid. My main bank is four LiTime 230Ah batteries wired to 48 volts — the spine of this whole course. (When I put a single 4,000Wh lithium into my mother-in-law's motor home, same chemistry, smaller scale, same rules apply.)

Now the two things lithium is fussy about:

**One — the cold.** This is the one that bites people. Lithium chemistry **does not charge well below freezing** — push charge into a frozen lithium cell and you damage it. The good packs have a **low-temperature charge shutoff** built into the BMS, and that's a *feature*, not a fault — it's protecting your investment. But a tripped pack isn't charging when you need it. If your battery box sees freezing temps — mine's exposed to the outside — you **insulate the box and add a little gentle heat.** I lined the inside and dropped in a small seedling-mat-style heater, the kind for a greenhouse, just enough to keep it above the shutoff. [VERIFY: exact low-temp charge cutoff temperature for the specific pack — varies by battery; tell them to read their BMS spec. The "no charging below freezing / ~32°F" principle is solid; the precise cutoff is gear-specific.]

**Two — placement and terminals.** These packs are *dense* — a lot of energy in a compact, heavy box — so set them where they'll live permanently before they're full of charge, because you won't want to wrestle them twice. Two small things the good batteries get right: they ship **longer terminal studs** (so your lug actually reaches and seats) and little **plastic terminal insulators** that cap the posts. Use them. They exist so a dropped wrench across two terminals doesn't become a fireworks show.

I'm not torquing battery cables in this lesson on purpose — connection order and torque is Module 5, and it's the whole crown-jewel point of doing the wiring as one careful, deliberate sequence. For now: battery bank sited, insulated if it's cold, terminals capped, nothing connected. The best sound you'll hear when this all finally comes together next module is *no sizzling.* No sizzling is always a good sign.

**What you'll take:** Lithium pays you back in cycles, but it asks two things — keep it from charging frozen, and respect how much energy is sitting in that compact box. Set it, insulate it, cap the terminals, and leave it dead until the wiring module.

**Your move this week:** Site your battery bank in its final home and figure out your freeze plan *now*, before the first cold snap — insulation, a small heater, or a spot that just doesn't freeze. Read your pack's BMS spec for its low-temp charge cutoff and write it down. Module 5 — the big one — is where every dead wire you've left hanging finally gets connected, in the right order, safe.

---

# Module 5 — Wire It Safe (the connections) 🏅

### Lesson 5.1 — Read this first (the part the lawyers and I both insist on)
> ‹SOURCE — PULL BEFORE PUBLISH: ⚖️ in-voice disclaimer lesson. Synthesized from 📹 `Upjc6UuEYpE` + `kAF3bgcY9mk` (the recurring "electricians in the comments say this is dangerous" frame; assume every panel is hot; ~75% voltage even shaded), 🔬 Pass 1 caveat block (NEC + AHJ jurisdiction-dependent, rules of thumb vary by run length / temp / datasheet, verify your own gear + local code, licensed electrician for AC tie-in & inspection-bound work) and Pass 3 #20 (STOP signals: arc fault, ground fault, burning smell, melted lugs). ROUTES THROUGH LEGAL REVIEW BEFORE PUBLISH.›

Every single time I talk about solar online, an electrician or a solar installer shows up in the comments to tell everybody that regular people have no business doing this because it's so dangerous. And here's the honest truth: **the high-voltage DC in a solar array genuinely can hurt you or kill you.** A DC arc doesn't trip and let go the way you'd hope — it sustains, and it bites. So before one more word, let me say the thing plainly, in my own voice, because I'd rather you be a little scared and alive than confident and crispy.

**This module is education, not a code course, and I am not your electrician.** I'm a guy who used to do this for a living showing you how I do it on my own property. That's it. Three things have to be true for what follows to be safe for you:

1. **The code is the boss, and the code is local.** The NEC has editions that differ, and your county's Authority Having Jurisdiction — your AHJ — is the final word, full stop. Every gauge, every fuse, every grounding rule I give you is a **rule of thumb** that shifts with your cable length, your temperature, and your specific gear's manual. Verify your own equipment's manual *and* your local code before you trust any number on this page. When they disagree with me, they win.

2. **Know the line where you stop and call a pro.** Anything bound for inspection, any tie-in to grid AC, any work your jurisdiction says needs a licensed hand — that's a call to a licensed electrician, not a comment-section debate. And while you're building, these are hard STOP signals: **an arc-fault trip, a ground-fault trip, any burning smell, or a melted lug or connector.** When you hit one of those, you don't keep clearing the fault and hoping — you isolate the system and you find the hazard, and if you can't, you bring in a pro. *Safety third* is a bit; this part isn't.

3. **The whole method below exists to keep your hands off live voltage.** That's the actual secret, and it's why a careful regular person *can* do this: we do all the dangerous-looking stuff while the system is dead, and the only live moment is one connector click at the very end, with your body nowhere near it. Respect the sequence and you remove almost all of the risk. Skip ahead and freelance the order, and you put it right back.

**What you'll take:** DC solar can kill you, and that's exactly why we work dead and connect live-last. This module teaches the method and the rules of thumb — your gear's manual and your local AHJ teach you the law. Both, every time.

**Your move this week:** Before you wire anything, do two boring things. Find your local AHJ and what code edition they enforce. And read the wiring/grounding section of your actual inverter's manual cover to cover. You'll spot at least one number that's specific to *your* box, not the internet's.

### Lesson 5.2 — Safety FIRST: bonding & grounding (the part everyone skips and shouldn't)
> ‹SOURCE — PULL BEFORE PUBLISH: 📹 `Upjc6UuEYpE` "How to Make DIY Solar Safe and Easy" (bonding the panel frames together with green ground wire + ring terminals; "touch grass" = grounding; do ALL safety before any power connection) + 📹 `QusVSSZeZsw` "Remember This Step…" (driving the ground rod — 4 methods, SDS-Max spike is his favorite; ground clamp → wire → grounding bus in the controller; "do the bonding, do the grounding, THEN make connections with no power run to them"). 🔬 Pass 1 #10 (ONE neutral-ground bond, enabled off-grid), #11 (functionally-grounded inverter eliminates separate DC grounding ELECTRODE, NOT module-frame EGC bonding — verify your inverter's UL1741 listing). EGC bonding.›
> 📊 [DIAGRAM — Claude builds: a grounding/bonding overview — panel frames daisy-chained with a green EGC bonding jumper (panel→panel→panel), that EGC running to the grounding point, a driven ground rod with clamp, and a single clearly-flagged ⭐ NEUTRAL-GROUND BOND inside the inverter labeled "EXACTLY ONE — enabled for off-grid." Keep it conceptual, mark "verify location in YOUR inverter's manual."]

Here's the part of a DIY build almost everybody fumbles: they hang the panels and immediately start clicking wires together to "see it work." Wrong order. **Bonding and grounding come FIRST**, while there's no power anywhere, so that by the time you make the one live connection, every bit of safety is already standing.

Two words, and they're different things people mush together:

**Bonding** is tying all your metal together so it's at the same electrical potential — your panel frames, your racking, your metal boxes — so a fault can't make one chunk of metal hot relative to another and zap you when you touch both. You **bond the panel frames to each other** with a green equipment-grounding conductor, frame to frame to frame down the row. I do it with a green ground wire and ring terminals (you can buy little WEEB-style washers/lugs made for it; I usually crimp my own ring terminals because I've got a bag of them and I don't like spending money). Gauge depends on the system — on a little RV-class 400W setup I can bond with #12; **scale the wire to your array and verify it against code, don't copy my RV number onto a 5kW build.** [VERIFY: EGC/bonding conductor sizing table by system amperage — research gives the principle and the small-system example only; the gauge scales with overcurrent device size per NEC 250.122, tell them to size it to their breaker and confirm locally.]

**Grounding** is your hippie friend "touching grass," for your solar array. You drive a **ground rod** into the earth and tie the system's grounding to it so stray energy has a path straight to ground instead of through you. Driving that rod is one of the more soul-crushing jobs in solar — I've done it four ways (a sledge from a ladder is the worst; my wife holding the pipe with channel-locks while I swing is worse for the *marriage*; a fence-post pounder works; a spike attachment on an SDS-Max rotary hammer is my hands-down favorite). Then a ground clamp on the rod, a wire up into the box, onto the grounding bus.

Now the one rule in this whole module people get dangerously wrong, so read it twice:

> **There is exactly ONE neutral-to-ground bond in your entire system. One. Not zero, not two.**

That single bond — the main bonding jumper — ties your neutral to ground at one and only one point. Put in *two* and you create parallel paths that push return current onto your grounding conductors, which is exactly the thing grounding is supposed to prevent. For an **off-grid** system, that bond is **enabled at your inverter** (many off-grid inverters have a setting or a physical jumper for it). For a system that's *permanently* grid-tied, you **disable** it, because the utility already made that bond at the service entrance — two bonds, same problem. Off-grid: one bond, at your inverter. **Verify exactly where that single bond physically lives in your build — read your inverter's manual.**

One modern wrinkle worth knowing: a lot of today's inverters are "functionally grounded" — transformerless, UL1741-listed, with built-in ground-fault protection — and those can **eliminate the need for a separate DC grounding electrode system** by bringing the PV-circuit ground to the inverter's own grounding point. What that does *not* eliminate is bonding your **module frames** — you still daisy-chain those frames with the EGC, every time. [VERIFY: confirm the specific inverter's UL1741 listing and follow ITS manual — this is the 2-1 split-vote finding (Pass 1 #11); present as "if your inverter is functionally grounded, follow its grounding instructions; frame bonding always stays."]

**What you'll take:** Bonding ties your metal together; grounding ties your system to the earth — and you do both *before* any power connection. The one number to tattoo on the inside of your eyelids: **exactly one neutral-ground bond, enabled for off-grid, and verify where it sits in your gear.**

**Your move this week:** Drive your ground rod (borrow the SDS-Max, save your marriage) and run your frame-to-frame bonding jumper. Then open your inverter's manual and find the neutral-ground bond setting — confirm it's the *one* bond in your system and that it's enabled for off-grid. Don't connect any power yet. We size the cables next.

### Lesson 5.3 — Size the wire & the overcurrent protection (the method, not just my numbers)
> ‹SOURCE — PULL BEFORE PUBLISH: 🔬 Pass 1 #1 (48V cuts current ~4× vs 12V — 4000W = ~333A@12V vs ~83A@48V), #4 (inverter ≥1.2× continuous load, derates with heat), #5 (AltE table: 48V/3000W = 2/0 AWG + 110A; 48V/5500W = 4/0 AWG + 400A fuse / 250A breaker; same 3000W needs 4/0 at 12V but 2/0 at 48V), #6 (MPPT rated by output amps: 100A ≈ 4800W @48V), #8 (combiner box: per-string fuses, busbars, optional SPD/disconnect). Fuses sized ~125-175% of load. ✏️ teach the METHOD. Anchor: the ~5.5kW SunGold @48V rig.›
> 📊 [DIAGRAM — Claude builds: a wire-and-fuse sizing reference card — the AltE-derived table (48V 3000W → 2/0 AWG, 110A; 48V 5500W → 4/0 AWG, 400A fuse / 250A breaker; vs 12V 3000W → 4/0 AWG, 400A) shown as a clean grid, with the "I = Watts ÷ Volts" formula up top and a flag: "RULES OF THUMB — adjust for cable run length, ambient temp, and YOUR gear's datasheet."]

This is where the 48-volt decision from Module 1 pays for itself in copper. Watts equals volts times amps — flip it around: **amps equals watts divided by volts.** Same power, the higher your voltage, the lower your current, and **current is what sets your wire size and your fuse.** A 4,000-watt load is a brutal ~333 amps at 12 volts but only ~83 amps at 48 volts. That four-to-one cut is the whole reason your wire bill and your big scary fuses stay sane. *That's just science.*

So here's the **method**, then the numbers:

**Step 1 — figure your worst-case current.** Take the biggest continuous power that runs through that wire and divide by the system voltage. For the cable between a ~5,000-5,500W inverter and a 48V battery, that's roughly 104-115 amps continuous.

**Step 2 — size the wire to carry that current** (with headroom for the length of the run and the heat it'll see — a long, hot run needs to step up). 

**Step 3 — size the overcurrent protection ABOVE the steady draw but below the wire's limit.** Fuses and breakers get sized up around 125-175% of the load so a normal surge doesn't nuisance-trip, while still protecting the wire. That's why the fuse number looks way bigger than the running amps and that's correct, not a typo.

Now the rule-of-thumb numbers for a 48V build, straight off the established tables — **memorize the shape, verify the specifics for your run:**

| At 48V | Battery cable | Overcurrent |
|---|---|---|
| 3,000W inverter | 2/0 AWG | 110A fuse/breaker |
| **5,500W inverter** | **4/0 AWG** | **400A fuse (or 250A breaker)** |

And the punchline that makes the 48V case for you: that same 3,000W inverter at **12 volts** needs **4/0 AWG** — the same fat cable a 48V system only needs at 5,500W. Four times the power, same wire, because you quadrupled the voltage and quartered the current. My SunGold sits right around that 5kW-class line, so **4/0 cable** on the battery-to-inverter run is my number — yours depends on your exact inverter and run length, so check your manual's required gauge and don't go thinner than the book.

Two more sizing notes:

- **The MPPT/charge controller is rated by its output amps**, and it passes proportionally more PV at higher voltage — a 100A controller handles roughly 4,800W at 48V (vs only ~1,200W at 12V). For a ~5kW array at 48V, plan on ~100A+ of MPPT capacity; an all-in-one like mine bundles enough PV input to cover it in one box.
- **If you've got multiple PV strings, a combiner box** consolidates them and houses per-string fuses, busbars, and (optional but smart) a DC surge-protection device and disconnect. You need it when you've got multiple strings to aggregate and protect — not for a single small string.

**What you'll take:** Amps = watts ÷ volts; size the wire to the worst-case current, size the fuse/breaker above the load but below the wire. 48V keeps that current — and your copper bill — about a quarter of what 12V would. The table is the rule of thumb; your run length, your heat, and your gear's datasheet are the law.

**Your move this week:** Run the math on your own battery-to-inverter cable: biggest continuous watts ÷ 48 = your amps. Look up the gauge and overcurrent for that number, then open your inverter's manual and confirm the wire size it *requires*. Where they differ, go with the heavier copper and your local code. Next lesson, we connect it all — in order, torqued, and dead until the last click.

### Lesson 5.4 — The final DC connections: order, polarity, torque, and the live-last click
> ‹SOURCE — PULL BEFORE PUBLISH: 📹 `kAF3bgcY9mk` "Making Electrical Connections Safely…" (parallel vs series; determine +/− with a multimeter; wire-nut every conductor you're NOT working on so + can't touch −; MC4 click→tighten the gland→pull test; "never connect/disconnect under load"). 📹 `wGXEGchY2bc` "The Final DC Connections…" (series math 20V→39→59→79V; battery+ / battery− and PV+ / PV− into the controller; THE reverse-polarity trap — the wire you extend as positive gets a NEGATIVE MC4 end; insulated 1000V screwdriver; cut conductors individually; torque lugs to spec so they don't arc; on-board AFCI/GFCI, add DC breakers on bigger systems). 📹 `QusVSSZeZsw` (the safe sequence restated). 🔬 Pass 1 #9 (manual DC + AC disconnects required, both sides). Anchor: SunGold all-in-one.›
> 📊 [DIAGRAM — Claude builds: ★ THE CENTERPIECE — the full fused-and-grounded 48V off-grid wiring diagram. PV strings → combiner (per-string fuses) → DC DISCONNECT → all-in-one (MPPT + inverter, with the ⭐ single neutral-ground bond flagged) → 4/0 battery cable with main DC fuse/breaker → 48V LiFePO4 bank; AC side → AC DISCONNECT → loads/sub-panel; green EGC bonding all metal + run to the ground rod. Label every overcurrent device, both disconnects, the single N-G bond, polarity on the DC runs, and "connect in this numbered order." This is the diagram people screenshot to their phone.]

Everything in this module has been building to a sequence. Do it in this order and the only live moment is the very last click, with your hands clear. Look at the centerpiece diagram up top the whole time — that's every connection in this lesson, numbered.

**First, series vs parallel, quick.** **Parallel** (all the pluses together, all the minuses together) multiplies amps, keeps voltage the same — you'd want it on a 12V RV where everything's 12V. **Series** (plus of one panel to minus of the next, down the line) *raises voltage and keeps current low* — and low current is less heat, less loss, smaller wire, which is why a real off-grid array runs series. You can watch the voltage climb as you go: two of my little panels in series read ~39V, three ~59V, four ~79V. Pick your wiring for your system; for a 48V build you're stacking voltage with series strings.

Now **the sequence.** Every step, the system is dead until the very end:

**1. Wire-nut every conductor you are NOT actively working on.** This is the cheapest safety habit in solar. A DC circuit only flows when negative and positive complete a path — so if every idle wire end is capped, there is no path, no arc, no bite. Cap them as you go.

**2. Determine polarity with your multimeter — don't trust your eyeballs.** Set it to DC volts, put red on one panel lead and black on the other. A *negative* reading means your leads are backwards; flip them, and when it reads positive you know the wire under your red lead is the **plus**. Mark it (tape, or a wire nut). New panels usually label +/− on the connectors already, but confirm.

**3. Build your series string with MC4 connectors — plus of one to minus of the next.** Strip about 3/8" (or whatever *your* MC4 brand's instructions say), make sure the copper's straight and the gland nut's loose, push the pins until you **hear the click**, then tighten the gland down — that compresses a little rubber seal for a weather-resistant joint. **Pull test** every one. Never click these together or apart **under load** — that's how you get an arc. Keep the idle ends capped.

**4. Here's the trap that causes 90% of "my controller's dead" headaches: reverse polarity at the connector.** When you put an MC4 end on the wire you're running back to the controller, remember you're just *extending* a wire. The wire you've marked **positive** needs the **NEGATIVE-style MC4 connector** on its end — because that negative end is what mates with the positive coming off the array. Get the connector gender right to the polarity down the *entire* line or you'll send reversed polarity into the controller and chase a ghost for an hour. Same color to same polarity, end to end.

**5. Land your wires at the all-in-one while it's dead** — PV positive to PV+, PV negative to PV−, battery positive to BAT+, battery negative to BAT−, green to ground. Two tradecraft habits here: use an **insulated screwdriver** (the good ones are rated to 1,000V — hold the insulated part), and when you trim multi-conductor cable, **cut each conductor individually, never all at once** — because one day you'll chomp through a live multi-wire and get a spark that ruins your cutters and maybe your hand. Build the habit while it's dead so it's automatic when it isn't.

**6. Torque every lug to spec.** Not "snug," not "gutentight" — to the manufacturer's number with a tool. A loose lug arcs and heats, and a hot loose lug is how you find melted connectors later. This is also where your **DC disconnect** and, on the AC side, your **AC disconnect** live — and you want both. Code requires a manual disconnecting means on **both** the DC (array-to-inverter) and AC (inverter-to-loads) sides so you can fully kill the system for service. Some all-in-ones have AFCI/GFCI and built-in protection on board; on a bigger system you still add proper DC breakers. Disconnects aren't optional polish — they're how future-you works on this safely.

**7. The live-last click.** Everything's landed, torqued, grounded, bonded, capped. Now — and only now — you make the **one final MC4 connection** that energizes the array. One click. You were never near hot voltage the entire build, because you saved the only live connection for last. Then you read your controller: battery voltage climbing, charge amps flowing, system alive. The sound you're listening for the whole time is *no sizzling*. No sizzling is always a good sign.

That's the crown jewel — not a single trick, but the *order*. Bonding and grounding first, everything connected dead, polarity verified, lugs torqued, disconnects in, and the live connection saved for one final click with your hands clear. Do it that way and the dangerous part was never dangerous.

**What you'll take:** The safety isn't a gadget — it's the sequence. Cap idle wires, verify polarity with a meter, get MC4 gender right to dodge the reverse-polarity trap, torque every lug, put disconnects on both sides, and make the one live connection dead last. That order is the whole reason a regular careful person can do this and walk away.

**Your move this week:** Before you energize anything, walk the centerpiece diagram against your real build and check off all seven steps in order — especially the capped idle ends, the polarity marks, and both disconnects. Verify your lug torque numbers in your inverter's manual. Then, and only then, make the last click — and watch the charge amps roll in. Catch you in the next module, where we turn it on for real and troubleshoot it when it talks back.

---

# Module 6 — Smaller Rigs: RV/Van & Solar Generators

### Lesson 6.1 — When the whole rig has to roll: RV & van power

> ‹SOURCE — PULL BEFORE PUBLISH: ✏️🔬 research Pass 1 (DC-coupled is the right topology for "small mobile (RV) and small/mid residential" — finding #2; 48V-vs-current physics scales down the same way — #1; LiFePO4 the chemistry — #7) + ⚓ anchor: Jason's SunGold + 4× LiTime 230Ah @ 48V rig is literally about to become his mother-in-law's lived-in RV power. RV-specific gear (DC-DC charger off the alternator, shore power, 12V house) is the new-writing layer — frame it as "same five boxes, three new rules." NOT in research as cited specs → no invented numbers, keep DC-DC / shore-power / 12V-house at the awareness level.›

So here's a fun wrinkle. That whole system we just spent five modules building — the SunGold and the four LiTime batteries sitting pretty at 48 volts — it's not staying put. It's about to go live in my mother-in-law's RV. Same boxes you already know, except now the house has wheels and a temper.

And that changes three things. Not the *fundamentals* — sun still hits panels, a controller still feeds the battery, the inverter still hands you wall power, that's the same five boxes from the diagram in Module 1 and they don't care that you're parked at a campground. What changes is the *rules around* those boxes.

**Rule one: you've got a second charger now, and it runs off the engine.** When you drive, your alternator is already making power. A **DC-DC charger** is the little box that takes that alternator power and feeds it into your house battery *safely* — without it, you can cook either the alternator or the battery, because they don't naturally speak the same language. This is the thing a house build doesn't have and a van absolutely needs. So now your battery has *three* ways to fill up: the sun, the engine while you drive, and —

**Rule two: shore power.** Pull into a spot with a plug, hook up, and you're charging off the grid like a normal mortal. Your inverter-charger handles that — it's the same all-in-one idea from Module 2, just wearing a different hat. Sun when you've got it, alternator when you're rolling, shore power when you're plugged in. Three taps, one tank.

**Rule three: half your stuff wants 12 volts, not 120.** An RV is full of **12V house loads** — the lights, the water pump, the fans, the fridge half the time — that run straight off the battery and never touch the inverter at all. That's actually a gift. Every load you run on 12V DC is a load you didn't have to spin the inverter up for, and the inverter sipping nothing at 3 a.m. is how you wake up with battery left.

Now — *should* a 48V rig like mine live in an RV? Honestly, most van builds run 12V because the whole rig is small and 12V plays nice with all that native 12V house wiring. Mine's 48V because it was built as a homestead system first and it's a hand-me-down second. Both work. The voltage math from Module 1 doesn't change — higher voltage, lower current, smaller wire — it just matters *less* when your whole array is two or three panels on a roof. The reason 48V is gospel for a 5kW house is the same reason it's optional for a van: there's barely any current to tame in the first place.

The real enemy in a rolling rig isn't voltage. It's **space and weight.** A roof only holds so many panels, and every pound you bolt down is a pound you drag up every hill for the life of the thing. So a van array is *small* on purpose, your battery is *exactly* as big as it needs to be and not an amp-hour more, and you lean hard on those 12V loads and that alternator charge to make up for the panels you couldn't fit.

📊 [DIAGRAM — Claude builds: the RV/van power system — same five-box spine as Module 1 but mobile, showing the THREE charge sources feeding one battery (roof solar → MPPT, alternator → DC-DC charger, shore-power plug → inverter/charger) and the battery splitting two ways: straight to 12V house loads (lights/pump/fans) AND up through the inverter to 120V outlets. Label the DC-DC charger and shore-power inlet as "the two boxes a house build doesn't have."]

**What you'll take:** A rolling rig is the same five boxes plus three rules — a DC-DC charger so the engine can charge you, a shore-power tap for when you're plugged in, and a pile of 12V loads that skip the inverter entirely. Space and weight are the real budget, not voltage.

**Your move this week:** Walk your RV (or the one you're dreaming about) and split every load into two columns: *runs on 12V straight off the battery* vs *needs the inverter and 120V*. That single list tells you how small your inverter can be and how hard you'll lean on DC — and it's the same load-audit muscle you built in Module 1.

### Lesson 6.2 — The solar generator: what a power station really does (and the trap)

> ‹SOURCE — PULL BEFORE PUBLISH: 📹 `jxebyWVwEFw` "ALLPOWERS S2000 vs Real Off Grid Demands" — Jason runs an SDS Max rotary hammer off the AllPowers S2000 (~2000W class) w/ a 200W solar charger to drill a boulder; 9 holes = ~7% capacity; plugs the panel in to top off mid-job. + 🔬 NOTE: research Pass 2 caveat explicitly says the portable-power-station rated-vs-surge / Wh-vs-runtime / solar-input-limit claims were NOT verified in the passes → so the spec-sheet *principles* are carried over from Pass 2's verified inverter findings (continuous-vs-surge #2, PV-input-vs-output #1), applied by analogy, and any hard "2000W station only takes ~500W PV" number is flagged generic/illustrative, not a cited spec. Tell the reader to read THEIR station's sheet.›

Let me tell you what I did with a box the size of a small cooler. I was excavating a hill by hand — most of the rocks I can move with a little imagination and leverage, but one of them was just *too big*. So I plugged an SDS Max rotary hammer — one of my biggest, hungriest power tools — into the AllPowers S2000, a roughly 2000-watt power station, drilled nine holes in that boulder, dropped in feathers and wedges, and split an immovable object into two semi-manageable ones. Nine holes cost me about **7%** of the battery. And while I worked, the **200-watt** solar panel was plugged in topping it back off. So yeah — a thing you carry with one hand helped me move part of a mountain.

That's the case *for* a power station, and it's a real one. No wiring, no breakers, no neutral-ground bond to lose sleep over. You unbox it, you plug in, it works. For a tool day, a tailgate, a power outage, a tiny cabin, a "I just need to run *something* right now" — a power station is the right answer and it's not close.

But here's where folks get robbed, so lean in. **A power station's name is a marketing number, not a promise.** You learned this exact lesson back in Module 3 with the big inverters, and it applies here word-for-word:

**Trap one — rated watts vs surge watts.** A "2000-watt" station means it can hand you 2000 watts *continuously*. The surge number — the brief spike it can survive for a few seconds when a motor kicks on — is bigger, and it's printed bigger, and it is a *lie of omission* if you size your life to it. A well pump or a compressor or a circular saw spikes hard for a half-second on startup. Size to the number it can hold *all day*, never the number it can hold for three seconds. Same rule as the wall-powered inverters. *(Research Pass 2, finding #2 — continuous and surge are separate spec lines; never size a load to the surge figure.)*

**Trap two — and this is the one nobody warns you about — the solar-input limit.** Your "2000-watt" station does NOT charge from 2000 watts of solar. That 2000 is what it can *output* to your tools. What it'll *accept* from solar panels is a completely separate, usually much smaller number. This is the *exact same split* I beat into you in Module 3: PV-input and AC-output are two different lines on the spec sheet and a unit's name can match one while it does something totally different on the other. On the big EG4 in that module the gap was 24kW of PV going in and 12kW of AC coming out. On a little power station the gap runs the *other* way and it stings — that S2000 of mine was topping off on a **200-watt** panel, not two thousand. So if you picture leaving a power station out in the sun and having it refill as fast as it drains, read the *solar input* spec first, because it might cap at a few hundred watts no matter how many panels you lean against it.

⚠️ One honest note for the record: those power-station numbers move fast and vary wildly by brand and model, and they're not the kind of primary-sourced specs the rest of this course is built on — so treat any "2000W station only takes ~500W of solar" as the *shape* of the trap, not a quote. **Read the input spec on YOUR exact station before you buy.** The principle is iron; the specific number is whatever your sheet says.

📊 [DIAGRAM — Claude builds: a "spec-sheet trap" callout for a portable power station — one box, three labeled numbers pulled apart: (1) RATED/continuous output watts [the name on the box], (2) SURGE watts [bigger, time-limited, "do NOT size to this"], (3) MAX SOLAR INPUT watts [separate and usually much smaller, "this caps how fast the sun refills it"]. Same visual language as the Module 3 anatomy-of-a-spec-sheet diagram so the reader connects them.]

**What you'll take:** A power station is plug-and-play freedom with no wiring — but its name is the *output* number. Size your loads to its continuous (not surge) rating, and check the *solar-input* limit before you dream of refilling it off the sun, because that's a separate and usually much smaller number.

**Your move this week:** Find the spec sheet for whatever power station you own or want, and write down three numbers in a row: continuous watts, surge watts, and max solar input watts. If you can't find that third number on the listing, that's the listing telling you something. 🛒

### Lesson 6.3 — Which rig is right for you (and when a power station beats a built system)

> ‹SOURCE — PULL BEFORE PUBLISH: ✏️ synthesis lesson — the decision framework across the three rigs (built 48V house system from M1-M5, RV/van from 6.1, power station from 6.2). 🔬 Pass 1 #7 (LiFePO4 + 10-30kWh typical home / 12kWh ~1 day autonomy) anchors why a power station is NOT a homestead. Power-station expandability = generic field knowledge, flagged. No invented capacity specs.›

So you've now seen three shapes of the same idea: the full built-out house system we spent Modules 1 through 5 on, the rolling RV/van rig, and the carry-it-with-one-hand power station. The trap is thinking one of them is *better*. They're not. They're answers to different questions, and the only mistake is bringing the wrong one to the fight.

**Reach for a power station when the job is small, temporary, or mobile.** Outage backup. A tool day off-grid like my boulder. A weekend in a tent. A tiny cabin you visit, not live in. The whole magic is that there's *nothing to install* — no breakers, no bonding, no liability module, no Linda. And a lot of them are **expandable** now — you can chain on extra battery modules as your needs grow, so you're not boxed in on day one. *(Expandability varies by brand and model — check your unit; it's not a universal feature.)*

**A power station beats a built system in exactly three spots:** when you can't (or won't) do permanent wiring, when the thing needs to move, and when your total need is genuinely small. Outside those three, a built system wins on cost-per-watt-hour and on sheer capacity every single time.

**Here's the wall a power station hits, and it's a hard one.** A homestead that runs a fridge, a freezer, well pump, lights, and a couple of devices is pulling real energy — the kind of build we're talking about lands somewhere around **12 kWh of battery**, which buys you roughly a *day* of breathing room, and a typical off-grid home wants somewhere in the **10 to 30 kWh** range. *(Research Pass 1, finding #7 — LiFePO4, 10-30kWh typical, ~1-2 days autonomy at 12kWh.)* A power station carrying a fraction of that, refilling off a couple hundred watts of panel, was never going to run your life. It'll run your *day*. That's the line: a power station is for a job; a built system is for a life.

**And the RV/van rig sits right in the middle** — it's a *built* system (it's wired, it's bonded, it lives there) that happens to roll. If your "homestead" has wheels, that's your answer, and Lesson 6.1 is your blueprint.

📊 [DIAGRAM — Claude builds: a decision tree / chart — top question "Does it need to MOVE?" → YES branches to "is it a vehicle you live in?" (→ RV/van built rig, Lesson 6.1) vs "carry it by hand?" (→ power station). NO branch → "what's the total daily need?" small/temporary/can't-wire → power station; runs a household (fridge/freezer/well/lights, ~10-30kWh) → full built 48V system (M1-M5). Each leaf labeled with the trade-off: power station = no install / capped capacity / capped solar input; built system = most capacity & cheapest per kWh / you wire it.]

**What you'll take:** Three rigs, three jobs. Power station for small/temporary/mobile and grab-and-go outages; RV/van for a home with wheels; full built 48V system for a household that needs 10-30kWh and a real day of autonomy. Match the rig to the job and you never overpay or undersize.

**Your move this week:** Put yourself on that decision tree. Be honest about whether your need is a *job* or a *life* — because that one answer decides whether you're buying a power station this weekend or building the system from Modules 1 through 5. Next module, we turn the thing on, keep it alive, and build you the field reference for the day it throws a code at you.

---

# Module 7 — Turn It On, Troubleshoot & Grow

### Lesson 7.1 — Commissioning: the boring checklist that saves your system

> ‹SOURCE — PULL BEFORE PUBLISH: ✏️🔬 commissioning lesson built from Pass 1 safety fundamentals (single neutral-ground bond #10, required DC+AC disconnects #9, EGC bonding #11) + Pass 2 (battery-type/voltage settings, Voc check #3) + Pass 3 #16/#17 (per-panel Voc within ~10% of rated in full sun) + the diagnostic spine "blank LCD = check battery/DC first, the screen runs on battery power" #15. This is the safe power-up ORDER, written new. Carries forward M5's settings; does not re-teach the wiring.›

You built it. Every fiber of you wants to flip everything on at once and bask in the glow of a job done. *Don't.* The fastest way to turn a weekend of good work into a puff of expensive smoke is to energize everything in the wrong order and find your mistakes all at the same time. Commissioning is just turning it on *slowly*, on purpose, in an order where each step proves the last one before you bet more on it.

Here's the order. Battery first, always. **The screen on your inverter runs on battery power** — so if you energize the battery side and your inverter wakes up and shows a display, that one little glow just told you your battery connection is good and your polarity isn't backwards. *(That's also the single most useful diagnostic fact in this whole course — Research Pass 3, finding #15 — and we'll lean on it hard in a minute.)* A dead-black screen at this step means stop and check the battery and the DC switch *before* you go one inch further.

Then, and only then:
1. **Battery DC on** → look for the display to light up. No light = no DC; fix that first.
2. **Confirm your settings before any solar or load.** Battery type set to *your* chemistry (LiFePO4), the right voltages dialed in, charge limits sane. The wrong battery type selected on the LCD is the root of a shocking number of "comms" faults you'll meet later in this module. *(Pass 2 — Ah needs voltage, BMS limits, and the right profile; Pass 3 — wrong battery brand on the LCD is a top comms-fault cause.)*
3. **Solar on next.** With panels live, glance at the incoming PV voltage. While you're here: before you ever connected those strings you should have measured each panel's open-circuit voltage in full sun and confirmed it reads **within about 10% of its rated number** *(Pass 3, #16)* — a temperature-corrected check, since cold panels read high and hot panels read low. If you skipped it, do it now, panel by panel; the one reading way under its siblings is the one with a problem *(#17)*.
4. **Loads last.** Bring your house online a circuit at a time, not all at once. Watch the inverter as the fridge, the pump, the big stuff kicks on. Anything trips, you know exactly which load did it.

And the three things you verify *physically* before any of this, because Module 5 drilled them into you: **exactly one neutral-ground bond** *(Pass 1, #10 — more than one puts current on your grounding conductors)*, your **DC and AC disconnects** present and working *(Pass 1, #9 — NEC wants a manual disconnect on both sides)*, and your equipment grounding actually bonded *(Pass 1, #11 — module frames bonded even on a modern functionally-grounded inverter)*. These aren't optional and they aren't this module's job to teach — they're M5's. This lesson just makes sure you *confirm* them before you trust the thing.

**What you'll take:** Commission in order — battery, settings, solar, loads — and let each step prove the one before it. The display lighting up on battery power is your first free diagnostic; a black screen here means stop and check DC. Confirm your single bond, your disconnects, and your battery-type setting *before* you bet the house on it.

**Your move this week:** Write your own power-up checklist on an index card and tape it inside the inverter cabinet door — battery, settings, solar, loads, in that order. The day you (or your mother-in-law, or whoever inherits this rig) need to restart it after a fault, that card is worth its weight in not-smoke.

### Lesson 7.2 — How to think when it breaks: the diagnostic order

> ‹SOURCE — PULL BEFORE PUBLISH: ✏️🔬 the diagnostic-LOGIC lesson (the "spine" before the lookup table) — Research Pass 3 synthesis: "blank LCD = no battery/DC first" #15; over-temp = airflow/ambient #6/#7/#11; overload = shed load #6/#7; comms-loss = cable pinout + correct battery brand selected #8/#12; per-panel Voc compare #16/#17; multimeter/clamp method. The ORDER = sun? wiring? setting? gear? Teaches the reader to diagnose, not just look up a number.›

📹 *(optional watch: `Tfy3tLdBApw` "Adding Solar To Your Off Grid Homestead" — Jason on why solar's the system to sort, and that "you can do it" confidence that runs under this whole module.)*

Before I hand you the lookup table — and I will, it's the next lesson and it's the real meat of what you paid for — you need the *thinking* that goes around it. Because a fault code is just the machine pointing at a neighborhood. *You* still have to find the house. And the way you find the house, almost every single time, is the same four questions in the same order, cheapest first.

**Sun? Wiring? Setting? Gear?** That's the spine. Work it top to bottom and you'll solve eight out of ten faults before you ever call anybody.

**1. Sun — is power even coming in?** Cloudy day, dawn, snow on the panels, a tree that grew, a tripped PV breaker. Half the "my system died" panics are just *the sun isn't doing what you assumed.* Free to check, so check it first.

**2. Wiring — is something loose, thin, or backwards?** This is where the *most* faults actually live, and the machine will tell you. A blank, dead screen points straight at no DC input — loose battery lugs, a thrown DC switch, reversed terminals — because remember, **the display runs on battery power** *(Pass 3, #15)*. And on the Victron side, a high-ripple fault is almost always *"loose DC cable connections and/or too-thin DC wiring"* in Victron's own words *(Pass 3, #2)*. Loose and undersized connections are the number-one cause of grief in a DIY rig. Torque your lugs. Then torque them again.

**3. Setting — did the gear just get told the wrong thing?** A *huge* share of scary-looking "comms" faults are nothing but the **wrong battery brand selected on the LCD**, or a comms cable with the wrong pinout *(Pass 3, #8 and #12)*. Nothing's broken. The inverter and the battery just aren't speaking the same dialect because somebody picked the wrong menu. Check the setting before you assume the hardware failed.

**4. Gear — is a part actually bad?** Only *after* sun, wiring, and setting come up clean do you start suspecting a dead panel, a failed component, a bad board. And even here you *measure* before you condemn: pull out the multimeter or clamp meter, check each panel's open-circuit voltage in full sun, and the module reading way below its siblings is your suspect *(Pass 3, #16/#17)*.

**The two tools that earn their place in the cabinet:** a **multimeter** (to read voltage — is the battery actually at 51-ish volts? is the panel making its Voc?) and a **clamp meter** (to read current *without* breaking a connection — is amperage flowing where it should?). You don't need a lab. You need to be able to ask the wire two honest questions: *do you have voltage, and do you have current?* Almost every diagnosis is some version of those two.

⚠️ **Codes vary by brand, model, AND firmware version — the same number can mean different things on two different units.** The order in *this* lesson is universal; the specific code in the *next* one is only as good as your owner's manual. Always confirm against YOUR unit's manual.

📊 [DIAGRAM — Claude builds: the troubleshooting decision tree — top node "It's not working / it threw a code." First branch: "Is the display ON?" NO → battery/DC path (check battery voltage w/ multimeter → DC switch → terminal polarity & torque). YES → walk the SUN → WIRING → SETTING → GEAR spine as four sequential gates, each with its check and its "if clean, go deeper." Two clearly-marked RED off-ramp nodes that dump straight out of the tree to "STOP — call a licensed electrician": (a) arc-fault / AFCI, (b) ground-fault / GFCI / burning smell / melted lugs. This tree is the visual centerpiece of the module.]

**What you'll take:** Diagnose in order — **sun, wiring, setting, gear** — cheapest and most-likely first. A dead screen means check DC; a comms fault usually means a wrong setting, not dead hardware; and you *measure* with a multimeter and clamp meter before you ever condemn a part.

**Your move this week:** Next time *anything* acts up — even a flickering light — force yourself to walk sun-wiring-setting-gear out loud before you touch a tool. Build the habit on the small stuff so it's automatic on the day it matters.

### Lesson 7.3 — The Fault-Code Field Reference (the third big written supplement)

> ‹SOURCE — PULL BEFORE PUBLISH: ✏️🔬 THE PAID-VALUE SUPPLEMENT. Every code below traces to Research Pass 3 with its finding number. NO invented codes. Brands a DIYer actually owns: Victron Err, MPP Solar/Voltronic numeric table, EG4 alarms, Growatt, plus the universal symptom-first entries. Every entry: code → what it means → first move. Lead with the hard "consult YOUR manual, codes vary by firmware" warning. This is a reference, not prose — keep it scannable.›

This is the part you'll have open on your phone in the cold with a headlamp on, and it's the part a video could never be. Bookmark it. **Read this warning first, every time:**

> ⚠️ **Fault codes, alarm wording, and even the menu/program numbers vary by brand, model, AND firmware version.** The *same number* can mean different things on two different units — on an older MPP Solar PIP-HS, code 07 was a low-battery condition; on a modern Voltronic-based all-in-one, 07 is *overload.* This is general field guidance to point you at the right neighborhood. **It does not replace your unit's own manual — pull that up and confirm before you act.** *(Research Pass 3 caveat, stated up front.)*

And before any table — the **symptom-first** entries, because the worst faults don't always throw a tidy code:

| Symptom | Most likely cause | First move |
|---|---|---|
| **Blank / dead LCD** | No battery/DC input — the screen runs on battery power | Multimeter the battery; check DC switch + terminal polarity & torque *(#15)* |
| **Over-temp / heat fault (any brand)** | Blocked airflow or hot ambient | Clear airflow, move out of direct sun; if siting's fine, suspect a loose internal temp sensor *(#6, #7, #11)* |
| **Overload fault (any brand)** | You're pulling more than it can hold | Shed load — switch off equipment until it clears *(#6, #7)* |
| **"Comms" / battery-not-talking fault** | Wrong battery type on LCD, or wrong comms-cable pinout | Set correct battery brand on the LCD; verify cable pinout *(#8, #12)* |
| **One panel underperforming** | Failed bypass diode / broken cell string | In full sun, measure each panel's Voc; the one ~>10% below its siblings is the suspect *(#16, #17)* |

#### Victron (MPPT / Inverter RS / Orion) — "Err" codes
*Read via the VictronConnect app, a remote panel, or the Toolkit App for LED-blink codes. The same Err list spans the whole MPPT/RS/Orion line. (Pass 3, #1.)*

| Code | Meaning | First move |
|---|---|---|
| **Err 11** | High battery ripple voltage | **Wiring.** Victron's own words: *"usually caused by loose DC cable connections and/or too-thin DC wiring."* Torque terminals; go thicker/shorter on DC cable *(#2)* |
| **Err 67** | Lost BMS connection | Charger was set to be BMS-controlled but hears nothing, so it drops output to the battery base voltage (12/24/36/48V) as a safety move. Check the BMS comms cable and battery-type config *(#3)* |
| **Err 1** | Battery high temperature | Let the battery cool; check ambient and ventilation *(#1, code-list reference)* |
| **Err 2** | Battery high voltage | Check charge settings and battery voltage; verify the right profile *(#1)* |

*(Victron publishes 60+ Err codes; the full list lives at victronenergy.com/live/mppt-error-codes — that's your master reference for any code not above. #1.)*

#### MPP Solar / Voltronic / Axpert all-in-ones (and rebrands like Voltacon) — numeric table
*The typical modern DIY all-in-one. ⚠️ Solid icon = FAULT (shutdown); flashing icon = WARNING (still running, with a beep pattern). (Pass 3, #4, #5.)*

| Code | Meaning | First move |
|---|---|---|
| **01** | Fan locked / fan fault | Check the cooling fan is free and spinning *(#4)* |
| **02** | Over-temperature (internal temp over ~100°C) | Check for blocked airflow or too-high ambient temp *(#4, #6, #7)* |
| **03** | Battery voltage too high | Check charge settings / battery voltage *(#4)* |
| **04** | Battery voltage too low *(as a warning, beeps once/sec)* | Charge the battery; check for loose connections *(#4, #5)* |
| **05** | Output short circuit / internal over-temp | Check wiring is connected well and remove the abnormal load *(#4, #6)* |
| **07** | Overload (110%+ for an extended time) *(warning beeps once/0.5 sec)* | **Shed load** — switch off equipment *(#4, #5, #6, #7)* |
| **08** | Bus voltage too high | Internal fault — restart; if it persists, service *(#4)* |
| **10** | Output power derating *(warning, beeps twice/3 sec)* | Reduce load; check temperature *(#5)* |
| **61** | Battery/BMS comms failure | Set battery type to USE / User-Defined to match your BMS *(#8)* |
| **80 / 20** | CAN / BMS comms fault (parallel setups) | Check parallel comms cables and the parallel-mode program setting *(#8)* |
| **F72** | Current-sharing fault (parallel systems only) | Verify the parallel comms card + wiring; confirm parallel mode is enabled in the menu (often program 28) *(#9, #10)* |

> ⚠️ Reminder on this brand especially: **07 means overload on modern units but meant low-battery on the old PIP-HS**, and program numbers (e.g. "23" vs "28" for parallel mode) shift by model. Confirm in *your* manual *(#7, #8 weak-spot note)*.

#### EG4 (18kPV / hybrid line) — plain-language alarms
*EG4 spells its alarms out in words instead of numbers. (Pass 3, #11–#14.)*

| Alarm | Meaning | First move |
|---|---|---|
| **Temperature fault** | Heat sink too hot | Install/move to a well-ventilated spot out of direct sun; if siting's fine, check the internal NTC sensor connector is seated *(#11)* |
| **Bat com failure** | Inverter can't *talk* to the battery | Verify comms-cable pinout + that the correct battery brand is selected on the LCD *(#12)* |
| **Bat Fault** | Battery can't charge or discharge | Same pinout/brand checks, **plus** read the battery's own indicator and contact the battery supplier *(#12)* |
| **AFCI high** | ⚠️ PV **arc fault** detected | **Stop.** Check each PV string for correct Voc and short-circuit current before clearing the alarm — see the safety note below *(#13)* |
| **Trip by GFCI high** | ⚠️ AC-side leakage (**ground fault**) detected | **Stop.** Check for a ground fault on both grid and load side, then restart; if it persists, get help — see safety note *(#14)* |

#### Growatt — common codes
*⚠️ Lowest-confidence set in this reference (secondary sources); these are grid-tie/hybrid codes and mapping varies by model. Confirm against your manual. (Pass 3, #18, #19.)*

| Code | Meaning | First move |
|---|---|---|
| **Error 300** | AC voltage out of range | Check AC wiring (especially neutral and ground); verify grid compliance *(#18)* |
| **Error 302** | No AC connection | Check AC wiring and the AC breaker status *(#18)* |
| **Error 116** | EEPROM fault | Morning-only → contact Growatt; all-day → restart first, then service if it persists *(#19)* |
| **Error 405** | Relay fault | Restart; if it continues, contact Growatt (often a control-board issue) *(#19)* |

**A word on BMS faults across all brands:** when the *battery's* brain throws the fault, it's almost always one of three things — a comms cable that's loose or wrong-pinout, the wrong battery type selected on the inverter, or the BMS protecting itself (over/under voltage, over-current, over-temp) by cutting off. Check the cable and the setting first *(#8, #12)*. The BMS doing its job and shutting down is not a malfunction — it's the seatbelt working.

📊 [DIAGRAM — Claude builds: a one-page "fault-code quick card" — a clean printable grid grouping the symptom-first row, then Victron / MPP-Voltronic / EG4 / Growatt blocks, color-coded by severity (green = setting/shed-load fix-it-yourself, amber = wiring/measure, RED = AFCI/GFCI/burning/melted → STOP). Designed to be screenshot-and-keep-on-your-phone. This is the artifact the lesson is built to produce.]

**What you'll take:** A real, scannable field reference — symptom-first entries plus the actual code tables for the gear a DIYer owns. Most codes resolve to *airflow, shed-load, a loose wire, or a wrong setting.* And the same number can mean different things across brands and firmware, so this points you at the neighborhood — your manual names the house.

**Your move this week:** Find your inverter's manual (download the PDF, don't trust your memory), flip to its fault table, and screenshot it next to this card. Keep both on your phone. The day it throws a code in the dark, you'll have *your* table and *this* logic in one place.

### Lesson 7.4 — STOP signs, upkeep, and growing the system

> ‹SOURCE — PULL BEFORE PUBLISH: ✏️🔬 the safety STOP note (Pass 3 #20 — AFCI/GFCI/burning smell/melted lugs = call a licensed electrician, do NOT keep resetting) + preventive maintenance (synthesized: clean panels, torque-check lugs, watch for corrosion, log battery behavior) + expanding the system. 📹 `Tfy3tLdBApw` "Adding Solar To Your Off Grid Homestead" ($4,500 all-in, paid for itself ~18 months, DIY mat'l ~$1/W vs ~$3.50/W avg, ~2/3-3/4 of a company price is labor/profit/commission) + bonus 📹 `4nkt8HjTXXE` "DIY Solar Tracker Built Entirely From Scrap" (racking from a satellite dish + scrap; "well-curated junk pile" ethos; pay-what-you-want book). ⚖️ Land-style safety disclaimer.›

📹 *(watch: `Tfy3tLdBApw` "Adding Solar To Your Off Grid Homestead." Bonus: `4nkt8HjTXXE` "DIY Solar Tracker Built Entirely From Scrap.")*

Three lessons of troubleshooting and I've made you feel like you can fix anything. Mostly you can. But there's a hard line, and a beard-and-overalls fella with a multimeter does not cross it. **Some faults are not yours to clear — they're yours to stop at.**

⚖️ **STOP and call a licensed electrician — do NOT keep resetting — if you see any of these:**
- **An arc-fault (AFCI) trip.** That's the gear telling you there may be an *arc* somewhere in your DC — a tiny lightning bolt in your wiring. Check your strings, don't just keep clearing the alarm to make it go away *(Pass 3, #13, #20)*.
- **A ground-fault (GFCI) trip.** Current is leaking where it shouldn't. Find it; don't reset past it *(#14, #20)*.
- **A burning smell.** No code required. Off, isolated, investigated.
- **Melted lugs, scorched connectors, or discolored terminals.** That's heat from a bad connection, and heat is how fires start *(#20)*.

The thing that gets people hurt isn't the fault — it's *clearing the fault over and over to make the annoying beep stop* while the actual hazard sits there getting worse. DC arcs don't trip a breaker the way you'd hope, and they don't care about your weekend. Stop means stop. *Safety third* is a bit; this part isn't.

Now the calmer stuff — **keeping it alive.** A well-built solar system is gloriously low-maintenance, which is the whole point, but "low" isn't "none":
- **Panels:** wipe off dust, pollen, snow, and the gift bird left you. Dirty glass quietly steals watts.
- **Connections:** that torque check from commissioning isn't a one-time thing. Connections work loose with heat cycles, and a loose connection is the Err 11 / blank-screen gremlin you met three lessons ago. Re-torque on a schedule.
- **Corrosion:** eyeball your lugs and terminals for green crud or discoloration, especially anywhere weather gets at them.
- **Battery behavior:** glance at your monitor now and then. A bank that used to coast through the night and suddenly doesn't is *telling* you something before it strands you.

And then the fun part — **growing it.** Because you will. I'm the guy who built a solar tracker's racking out of a hunk of metal from an old satellite dish and a piece of scrap pipe, because *never underestimate the power and value of a well-curated junk pile.* A small array ought to be able to twirl and dip when you ask it to. The instinct to solve a problem with what you've already got instead of what you can buy — that's the whole game.

When you do add capacity, the spec-sheet discipline from Module 3 is exactly what keeps you out of trouble: more panels means more string voltage, and that **Voc still has to live under your controller's max input** — you don't get to forget cold-morning Voc just because the system already works *(Pass 2, #3)*. More battery means matching your BMS continuous current to what the inverter can pull, so you don't starve a big inverter with one little battery *(Pass 2, #7)*. Add within the boxes you already understand. Same five-box system from Module 1 — you're just making the boxes bigger.

And here's the closer, from a former solar professional who'll say it plain: this was never the scam they told you it was. Materials run about **a dollar a watt**; the national average install runs about **$3.50 a watt**, and **two-thirds to three-quarters of that gap is labor, company profit, and sales commission** — not magic, not gold-dipped panels. My whole rig — panels, batteries, electronics, wire, lumber for the racking, all in — was **$4,500**, and against what we used to hand the utility company it **paid for itself in about 18 months.** After that it's basically free power for 20 or 30 years, minus a battery here and there. You learned to design it, buy it, build it, wire it, turn it on, and fix it. You don't need them. That was the point the whole time.

**What you'll take:** Know the four STOP signs — arc fault, ground fault, burning smell, melted lugs — and call a pro instead of resetting past a hazard. Keep it alive with clean panels, re-torqued lugs, and an eye on the battery. Grow within the boxes you already understand, and remember the math: ~$1/watt in materials vs ~$3.50 average, and a rig that pays for itself in well under two years.

**Your move this week:** Put two recurring reminders on your phone — *"check panels & re-torque lugs"* on a season you'll remember, and *"glance at battery health."* Then go build something out of your junk pile. You've got the whole skill now. Skills are extremely lightweight — easy to pack, very difficult to steal. Go use it.

> I'll catch you in the next one.
