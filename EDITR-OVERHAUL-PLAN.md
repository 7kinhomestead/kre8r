# EditΩr Overhaul Plan — Diagnosis & Modernization

*Read-only audit of the EditΩr/AssemblΩr pipeline, June 12 2026. No code was changed.*

**The one-paragraph verdict:** The assistant-editor brain (AssemblΩr) is actually good — the beat-mapping architecture is the right idea and the pain log shows it improving every session. What's killing the experience is everything around it: the DaVinci handoff uses the most fragile possible method (a live remote-control connection that silently drops clips), the transcription engine is a 2023-era setup running below its potential on your hardware, and the system has a habit of reporting success when nothing actually happened. All three are fixable, and one of them — the DaVinci handshake — can be largely *replaced* with a boring, reliable file format that's existed in editing for decades.

---

## Part 1: Diagnosis — Top 5 Failure Points, Ranked by Pain

### #1. The DaVinci handshake: live remote-control where a file handoff would do

**What's happening:** Every time Kre8r talks to Resolve, it opens a live puppet-strings connection (Python scripting API) and performs a long choreography: connect, find the project by exact name, find the media pool, create timelines, append clips one at a time with carefully-tuned sleep delays. Every step has preconditions — Resolve running, the right project open, sometimes the Edit page active, scripting enabled — and any miss produces a generic error or, worse, *silent* partial success.

**The evidence (this is your most-documented pain):**
- `AppendToTimeline` **silently rejects clips** when two beats from the same long take have overlapping in/out points — half your beats vanish from the timeline with no error (DEVNOTES §DaVinci, Sessions 75–77). The per-beat-timeline + compound-clip workaround fixed it, but at the cost of a much more complex choreography.
- Resolve drops rapid-fire API calls unless the script sleeps between them — the current fix is hand-tuned 0.2–0.3s delays (`scripts/davinci/build-selects.py`), which is timing-luck, not engineering.
- The **freeze-frame bug** (ClipsΩr clips render as stills when frame ranges overlap) is still unresolved — paused at Session 74.
- DaVinci 21 **renamed API methods** and broke several scripts (Session 77); you're partly editing manually while that's re-mapped. This will happen again at every major Resolve release.
- Frame rates are **hardcoded inconsistently**: 24fps in create-project ([create-project.py:326](scripts/davinci/create-project.py)) and add-timeline, 25fps in braw-proxy-export ([braw-proxy-export.py:626](scripts/davinci/braw-proxy-export.py)), 29.97 default in clip-markers. Any mismatch = clips at wrong positions.
- If a script dies midway, Resolve is left in a half-built state with no rollback and no retry ([davinci.js:35-66](src/routes/davinci.js) has no recovery path).

### #2. Silent failures — the system says "done" when nothing happened

This is the trust-killer, and it's systemic, not one bug:
- **Frame analysis ran for two sessions, burned ~$920 in API cost, and wrote nothing** — the `visual_description` column was missing from one of the two database migration paths, and the column whitelist silently discarded the data (Sessions 80/91).
- Clips "placed" in DaVinci that were silently rejected (see #1).
- Unknown columns in DB writes vanish without a log line — the whitelist pattern in `updateFootage` swallows them.
- Your own words in the synthesis: *"How do I know if the system actually did what it said?"*

There is **no read-back validation anywhere in the pipeline** — no step that checks "did the thing I just claimed to do actually exist afterward."

### #3. Whisper transcription — wrong package, wrong era, idle GPU

- Kre8r runs **openai-whisper** (the original 2022 package), `medium` model by default ([transcribe.js:39](src/vault/transcribe.js)), with **no GPU flag** — it relies on auto-detect, and the logged 20–30s cold starts suggest it's likely running on CPU. Your machine has an **RTX 3070 Ti sitting right there**. Modern replacements (faster-whisper, WhisperX) run the *larger, more accurate* large-v3 model 4–10× faster than your current medium runs.
- **No voice separation:** the local path has zero diarization, so Cari's off-camera lines land in the transcript and confuse AssemblΩr's take detection. (The Resolve transcription path *does* filter her out — [resolve-transcribe.py:606-684](scripts/davinci/resolve-transcribe.py) — but it's off by default because of its own 45s cold-start fragility. So the quality feature lives on the unreliable path.)
- **One strike and you're out:** no retry on failure ([transcribe-queue.js:156-189](src/vault/transcribe-queue.js)), a 10-minute hard kill, and if Whisper hangs, the queue **blocks forever until server restart**. The queue is also in-memory only — restart loses all pending jobs.
- No VAD (voice activity detection) or noise handling — relevant for outdoor shoots with wind.

### #4. Visual context is one thin summary per 50-minute clip

Frame analysis samples up to 20 frames at 640px across the whole clip and produces **one** clip-level JSON ([frame-analysis-queue.js:116-181](src/vault/frame-analysis-queue.js)). But your workflow puts 7 takes of a beat inside one long clip — so when AssemblΩr compares Take 2 (at minute 4) against Take 6 (at minute 38), the only visual signal differentiating them is a percentage-based "peak energy zone" check with ±5% slop ([assemblr.js:373-396](src/editor/assemblr.js)). It can't see that Take 6 had better eye contact than Take 2, because nobody looked at frames *per take*. Clips not yet analyzed silently contribute no visual signal at all. This is your "not enough visual context" complaint, precisely located.

### #5. Runs are destructive and non-repeatable

- Re-running AssemblΩr **deletes all prior selects** with no undo ([editor.html:743-750](public/editor.html)) — re-rolling the dice costs you the previous answer even if it was better.
- Claude output is non-deterministic, so two runs on identical footage give different assemblies — fine *if* you could compare them, fatal when each run erases the last.
- Mid-run failures leave partial state in both the DB and Resolve.

*(Honorable mentions: 30-min proxy render timeout silently eats large BRAW files; shot-type misclassification routes clips wrong with no override surfaced; proxy↔BRAW matching by filename stem is fragile with truncated/duplicate names.)*

---

## Part 2: The Recommendation — Keep / Replace, Stage by Stage

| Stage | Verdict | In one line |
|---|---|---|
| Transcription | **Replace the engine, keep the plumbing** | Swap openai-whisper → WhisperX on your GPU; add diarization to filter Cari locally |
| Visual context | **Keep the design, fix the granularity** | Analyze per-take, not per-clip; Haiku keeps it cheap |
| Assembly (AssemblΩr) | **Keep — harden it** | The 2-call beat architecture is right; add read-back + non-destructive runs |
| Resolve handoff | **Replace the choreography with a file** | Generate FCPXML/OTIO; Resolve imports it natively. Kill 80% of the live API |

### Transcription: WhisperX on the 3070 Ti (free), hosted API as the escape hatch

Replace the openai-whisper CLI call with **WhisperX** (or faster-whisper + pyannote). What you get, in filmmaker terms:

- **Accuracy jump:** runs `large-v3` (the best Whisper) faster than your current `medium` runs today — large-v3-turbo on a 4090-class GPU transcribes at ~200× real time; on your 3070 Ti, expect a 50-minute take in roughly a minute or two instead of many minutes.
- **Word-level timestamps that are actually frame-tight** — WhisperX's forced alignment is the current standard; AssemblΩr's cut points get more precise for free.
- **Speaker diarization locally** — meaning the "remove Cari's line-feeds" filter moves from the fragile Resolve path into the reliable local path, where it should have been. Built-in VAD also helps outdoor audio.
- The output is the same segments+words JSON shape Kre8r already stores, so AssemblΩr doesn't change.

**Escape hatch if local ever annoys you:** hosted APIs are now absurdly cheap at your scale. AssemblyAI runs ~$0.15–0.37/hour of audio, Deepgram Nova-3 ~$0.46/hour — at 3–5 hours of footage a week that's **$2–8/month** for excellent quality with diarization included and zero local setup. Worth keeping as a config option, not the default (footage stays on your machine with local).

One caveat: first verify the current install is even using the GPU (`python -c "import torch; print(torch.cuda.is_available())"`). If that prints `False`, the single highest-value 10 minutes of this whole plan is installing CUDA-enabled torch.

### Visual context: same idea, right altitude

The frame-analysis design (sample frames → Claude vision → structured editorial JSON) is sound and current best practice for this kind of system. The fix is **where** it looks:

1. After Call 1 finds take boundaries in the transcript, **sample 2–3 frames per take occurrence** and get a short per-take visual verdict (eye contact, energy, anything broken in frame). That's the context Call 2 actually needs when choosing between Take 2 and Take 6.
2. Keep the cheap model (Haiku-class, ~$0.004/clip-level analysis) for the bulk pass; per-take sampling at 2–3 frames stays in pennies per project.
3. For b-roll, add **shot detection** (PySceneDetect, free/local) so one b-roll file becomes indexed shots rather than one blob.
4. Worth knowing: Gemini-class models now ingest **whole video natively** (~300 tokens/second of footage) — a 50-min clip is ~900k tokens, so per-take frame sampling into Claude remains the cost-sane approach for you; native video is an option for short b-roll classification later.

### Assembly: AssemblΩr stays — it's the part worth owning

The 2-call architecture (Call 1 tags where each beat occurs across takes; Call 2 makes the editorial pick) matches how commercial tools work and is tuned to *your* workflow (full-video retakes in one long clip, beat maps from PipΩr, your voice profile). The pain log shows it converging: full-take selection fixed, gold-moment assignment fixed, sort order fixed. Don't replace it. Harden it:

- **Read-back before success** — after every write (selects to DB, timeline to Resolve), read it back and report what's *actually* there. This single principle addresses failure point #2 across the whole system.
- **Non-destructive runs** — version each assembly run instead of deleting the last one; "Run 3 vs Run 2" comparison instead of Russian roulette.
- **Coverage report before assembly** — surface "Beat 4 has no usable footage" *before* the full pass, not at rough-cut review (this is already in your WISHLIST).

**Buy-instead-of-build check:** [Eddie AI](https://www.heyeddie.ai/) ($25/mo Plus, $100/mo Pro) does overnight rough cuts from raw footage and exports to Resolve — it's the closest commercial analog and worth a one-month trial *as a benchmark* to steal patterns from (their stringout-first flow, alternates-on-track-2 layout). But it doesn't know your beat maps, your script, or your voice profile — the integration with the rest of Kre8r's pipeline is exactly the moat. Verdict: keep building, trial Eddie once for ideas.

### Resolve handoff: this is the big one — replace the puppet strings with a file

Here's the move that changes your life the most. Today Kre8r *performs the edit inside Resolve by remote control* — every clip placement is a live API call that can be silently dropped, needs sleep delays, and breaks when Blackmagic renames a method. The industry-standard alternative is to **write the edit decision into a timeline interchange file** and let Resolve import it:

- **FCPXML or OTIO** (OpenTimelineIO, the Academy Software Foundation's open format): Kre8r generates one file from the selects — every cut, in/out point, track, and marker — and Resolve creates the entire timeline from it **natively, in one atomic operation**. Either Jason right-clicks the Media Pool → Timelines → Import (two clicks, zero API), or one tiny script calls `ImportTimelineFromFile()` — a single API call replacing hundreds.
- What this kills outright: the AppendToTimeline silent-rejection bug (and the per-beat-timeline workaround built around it), the sleep-delay pacing, the freeze-frame cache collisions, mid-run partial timelines, and most DaVinci-version API churn — the import formats are decades-stable while the scripting API mutates every release.
- What it also gives you: the timeline file is a *saved artifact*. A failed import costs nothing — the file is still there; re-import. Two assembly runs = two files you can diff. This is "never lose creative state" in its purest form.
- Engineering notes for the build: encode times as rational numbers (1001/30000s etc.) — frame-rate sloppiness is the classic FCPXML gotcha; read the actual fps from each clip via ffprobe instead of today's hardcoded 24/25/29.97; all clips in a generated timeline should share the project frame rate. Python libraries exist (the official `opentimelineio` package writes both OTIO and FCPXML).

**Keep small scripting-API calls only where files can't reach:** triggering proxy renders, reading Resolve's transcription, and a new **health-check endpoint** ("Is Resolve running? Right project open? Scripting reachable?") that runs *before* any operation and tells you in plain English what to fix — instead of the current generic error from the server log.

**Also test, costs nothing:** DaVinci Resolve 20 Studio (which you own) shipped **AI IntelliScript** — paste a script, and Resolve itself matches transcribed footage to script lines and builds a timeline with best takes on Track 1 and alternates on Track 2. Reviewers report ~87% first-pass accuracy on clean audio. For pure talking-head spine assembly, this might replace a whole pipeline stage for free. It won't know your beat maps or gold moments — so the realistic outcome is: IntelliScript as a quick-and-dirty fallback path, AssemblΩr (via FCPXML) as the smart path. Spend one afternoon racing them on the same shoot.

---

## Part 3: The Phased Plan

### Phase 0 — Quick wins (one afternoon, no architecture)
| Task | Effort |
|---|---|
| Check `torch.cuda.is_available()`; install CUDA torch if False | 30 min — possibly the biggest single speedup available |
| Set `WHISPER_MODEL=turbo` in .env (already supported by the code) | 5 min |
| Test **IntelliScript** in Resolve 20 Studio on one real shoot — race it against AssemblΩr | 1–2 hrs, zero code |
| DaVinci **health check** endpoint + plain-English preflight in editor UI ("Resolve isn't running — open it and retry") | 1–2 hrs |
| Stop deleting selects on re-run — archive previous run instead | ~1 hr |

### Phase 1 — Transcription engine swap (1–2 working sessions)
- Replace the openai-whisper CLI call in [transcribe.js](src/vault/transcribe.js) with **WhisperX** (large-v3, word timestamps, diarization). Same output JSON shape — AssemblΩr untouched.
- Port the Cari filter (dominant-speaker + short-isolated-utterance, already written for the Resolve path) onto WhisperX's speaker labels.
- Queue hardening: persist queue to DB (survives restart), one automatic retry, watchdog that kills+fails a hung job instead of blocking forever.
- **Exit test:** a 50-min take transcribes in ~1–2 min, Cari's lines absent, server restart mid-queue resumes cleanly.

### Phase 2 — File-based Resolve handoff (2–3 sessions; the big rock)
- New module: selects → **FCPXML/OTIO generator** (use the `opentimelineio` Python lib; rational-number times; fps read per-clip via ffprobe).
- One thin script: connect → `ImportTimelineFromFile()` → **read back the timeline** (clip count, duration) → report truth. Manual Media-Pool import documented as the zero-API fallback.
- Gold moments and beat names become timeline **markers** in the same file.
- Retire build-selects per-beat choreography once the new path survives three real projects. Keep the old path behind a flag until then.
- **Exit test:** assembly → timeline in Resolve with every beat present, correct order, frame-accurate cuts — and the system *proves* it by reading the timeline back.

### Phase 3 — Per-take visual context (2 sessions)
- After Call 1 returns take boundaries: extract 2–3 frames per take occurrence (ffmpeg, already in place), batch through Haiku-class vision, store per-take verdicts.
- Inject per-take visuals into Call 2 (replacing the %-based peak-energy guess).
- PySceneDetect pass on b-roll → per-shot index in VaultΩr.
- Beat **coverage report** UI before full assembly.
- **Exit test:** Call 2's choice between two takes cites visual evidence ("Take 6: direct eye contact, animated" vs "Take 2: glancing at notes").

### Phase 4 — Trust layer + polish (ongoing, weave into other phases)
- **Read-back validation everywhere** + log any column the DB whitelist drops (the $920 bug class dies here).
- Single source of truth for schema — end the dual-migration-path drift.
- EditΩr Room: surface coverage gaps as conversation ("Beat 4 is thin — rewrite it, b-roll it, or reshoot?").
- Optional: trial **Jumper** ($29/mo or $249 lifetime; native Resolve integration) for semantic footage search — closest commercial match to the VaultΩr-search wishlist; cheaper to trial than to build.

---

## Part 4: What the Paid Pieces Cost at Your Scale

| Item | Cost | Notes |
|---|---|---|
| WhisperX / faster-whisper / PySceneDetect / OpenTimelineIO | **$0** | Open source, runs on hardware you own |
| AssemblyAI (optional hosted transcription) | ~$0.15–0.37/hr → **$2–8/mo** at 3–5 hrs/week | Diarization included; free tier covers testing |
| Deepgram (alternative) | ~$0.46/hr; **$200 free credit** (~430 hrs) | The free credit alone covers ~2 years at your volume |
| Claude vision, per-take frame analysis | **pennies per project** (Haiku-class, 2–3 frames/take) | The expensive Opus pass stays optional for hero clips |
| Eddie AI (benchmark trial) | $25/mo Plus / $100/mo Pro | One month as research, not a commitment |
| Jumper (footage search) | $29/mo or **$249 lifetime** | Only if VaultΩr search keeps hurting after Phase 3 |
| DaVinci Resolve Studio (IntelliScript etc.) | **$0** | You already own it |

**Bottom line:** the entire overhaul runs on free software plus single-digit dollars a month. The expensive thing was never the tools — it was the silent failures eating your time and trust. Phases 0–2 attack exactly those.

---

*Evidence sources: code audit of src/vault/, src/editor/assemblr.js, src/routes/davinci.js, scripts/davinci/ (citations inline above); DEVNOTES.md and SESSION-LOG.md Sessions 62–91 pain log. Research current as of June 2026: [WhisperX](https://github.com/m-bain/whisperx) · [Whisper variant comparison](https://modal.com/blog/choosing-whisper-variants) · [AssemblyAI pricing](https://www.assemblyai.com/blog/speech-to-text-api-pricing) · [Deepgram pricing](https://costbench.com/software/ai-transcription-apis/deepgram/) · [Resolve 20 AI features incl. IntelliScript](https://www.cined.com/davinci-resolve-20-released-with-handful-of-ai-assisted-features/) · [IntelliScript hands-on](https://fstoppers.com/post-production/two-new-tools-davinci-resolve-20-can-speed-your-editing-process-703996) · [Resolve OTIO/FCPXML import](https://www.steakunderwater.com/VFXPedia/__man/Resolve18-6/DaVinciResolve18_Manual_files/part1411.htm) · [Resolve scripting API ref (ImportTimelineFromFile)](https://gist.github.com/mhadifilms/2b84d469135315793220dbf2226cbe63) · [FCPXML frame-rate gotchas](https://fcp.cafe/developers/fcpxml/) · [Eddie AI](https://www.heyeddie.ai/) · [Jumper](https://getjumper.io/) · [Gemini video understanding](https://ai.google.dev/gemini-api/docs/video-understanding)*
