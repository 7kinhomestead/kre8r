'use strict';

const SAVE_THE_CAT = [
  { index:1,  name:"Opening Image",        target_pct:0,  emotional_function:"Establish the world as it is before anything changes. A single image or moment that captures the starting state.", reality_note:"What does life look like at the start of this story? What are you doing, where are you, what's the mood?" },
  { index:2,  name:"Theme Stated",         target_pct:5,  emotional_function:"Someone says (or implies) what this story is really about. The thesis of the episode.", reality_note:"What's the deeper point of this video beyond the surface topic? When do you say it out loud?" },
  { index:3,  name:"Set-Up",               target_pct:1,  emotional_function:"Establish the world, the people, the stakes. What does the audience need to know before things change?", reality_note:"Context, background, who's involved, what the situation is." },
  { index:4,  name:"Catalyst",             target_pct:10, emotional_function:"The inciting incident. Something happens that sets the story in motion. No going back.", reality_note:"What was the moment things changed? The discovery, the decision, the problem that started everything." },
  { index:5,  name:"Debate",               target_pct:12, emotional_function:"The protagonist wrestles with whether to go. Internal conflict, weighing options.", reality_note:"What were you unsure about? What almost made you not do this? Be honest about the doubt." },
  { index:6,  name:"Break into Two",       target_pct:25, emotional_function:"The decision is made. We enter the upside-down world. The adventure begins.", reality_note:"The moment you committed. When you said yes, bought the thing, started the project." },
  { index:7,  name:"B Story",              target_pct:30, emotional_function:"A secondary storyline begins — often where the real theme lives. A relationship, a parallel lesson.", reality_note:"Is there a person, relationship, or parallel situation woven into this story? What's the emotional undercurrent?" },
  { index:8,  name:"Fun and Games",        target_pct:30, emotional_function:"The promise of the premise. This is what the audience came to see. The bulk of the content.", reality_note:"The actual doing of the thing. The process, the work, the moments that make this video worth watching." },
  { index:9,  name:"Midpoint",             target_pct:50, emotional_function:"A false victory or false defeat. Stakes are raised. The story shifts.", reality_note:"Halfway through — what changed? What worked better than expected or worse than expected?" },
  { index:10, name:"Bad Guys Close In",    target_pct:55, emotional_function:"Things start to go wrong. External pressure, internal doubt, complications mount.", reality_note:"What went wrong? What was harder than expected? What almost derailed everything?" },
  { index:11, name:"All Is Lost",          target_pct:75, emotional_function:"The lowest point. The worst moment. Everything seems to have failed.", reality_note:"The moment you were most frustrated, defeated, or ready to quit. Be real about this." },
  { index:12, name:"Dark Night of the Soul", target_pct:75, emotional_function:"Sitting with the failure. Processing. The quiet before the solution.", reality_note:"What did you think about at the worst moment? What did you almost decide?" },
  { index:13, name:"Break into Three",     target_pct:80, emotional_function:"The solution appears. A new idea, a realization, help arrives.", reality_note:"What changed? What was the insight, the fix, the person who helped, the thing you tried differently?" },
  { index:14, name:"Finale",               target_pct:80, emotional_function:"Execute the solution. The climax. Everything comes together.", reality_note:"The resolution. What happened when you applied the solution? Show the result." },
  { index:15, name:"Final Image",          target_pct:99, emotional_function:"The world as it is now. Mirror of the Opening Image but changed.", reality_note:"Where are you now compared to where you started? What does this look like after?" }
];

const STORY_CIRCLE = [
  { index:1, name:"You",    target_pct:0,  emotional_function:"Establish the hero in their comfort zone.", reality_note:"Who are you and what is normal for you right now?" },
  { index:2, name:"Need",   target_pct:10, emotional_function:"Something is wrong or missing. A want or need emerges.", reality_note:"What problem, gap, or desire started this story?" },
  { index:3, name:"Go",     target_pct:25, emotional_function:"Cross the threshold. Enter the unknown.", reality_note:"The moment you committed and stepped into unfamiliar territory." },
  { index:4, name:"Search", target_pct:37, emotional_function:"The road of trials. Adapt to the new situation.", reality_note:"The process, the struggle, the figuring-it-out phase." },
  { index:5, name:"Find",   target_pct:50, emotional_function:"Get what you were looking for — but at a cost.", reality_note:"The result, the discovery, the thing you were working toward." },
  { index:6, name:"Take",   target_pct:62, emotional_function:"Pay the price. The consequence of getting what you wanted.", reality_note:"What did it cost? What changed because of what you found?" },
  { index:7, name:"Return", target_pct:75, emotional_function:"Come back to where you started — but different.", reality_note:"Back to normal life — but what's different now?" },
  { index:8, name:"Change", target_pct:87, emotional_function:"The transformation is complete. The lesson lands.", reality_note:"What do you know now that you didn't before? What changed in you?" }
];

const VSL_ARC = [
  { index:1, name:"Hook",      target_pct:0,  emotional_function:"Stop the scroll. Create immediate curiosity or recognition.", reality_note:"What's the one thing that makes someone stop and watch?" },
  { index:2, name:"Problem",   target_pct:10, emotional_function:"Name the pain. Make them feel seen and understood.", reality_note:"What problem does your audience have that this video addresses?" },
  { index:3, name:"Agitation", target_pct:20, emotional_function:"Make the problem feel urgent. What happens if nothing changes?", reality_note:"Why does this problem matter? What's the cost of staying stuck?" },
  { index:4, name:"Solution",  target_pct:35, emotional_function:"Introduce the answer. Hope arrives.", reality_note:"What's the solution you're presenting? How does it change things?" },
  { index:5, name:"Proof",     target_pct:50, emotional_function:"Show it works. Credibility, results, evidence.", reality_note:"What proof do you have? Results, testimonials, your own story." },
  { index:6, name:"Offer",     target_pct:75, emotional_function:"The specific ask. What they get, what it costs, why now.", reality_note:"What exactly are you offering? Be specific and clear." },
  { index:7, name:"CTA",       target_pct:90, emotional_function:"The direct call to action. One clear next step.", reality_note:"What's the one thing you want them to do right now?" }
];

const FREE_FORM = [];

const CONFESSION_ARC = [
  { index:1, name:"Uncomfortable Admission",   target_pct:0,  emotional_function:"Admit something uncomfortable upfront — creates immediate vulnerability and trust.", reality_note:"What's the thing you're admitting? Say it clearly and honestly." },
  { index:2, name:"Why It Matters",             target_pct:15, emotional_function:"Establish the stakes of the admission — why does this matter to the audience?", reality_note:"Why should the viewer care about what you just admitted?" },
  { index:3, name:"What You Discovered",        target_pct:35, emotional_function:"The investigation or journey that followed the admission.", reality_note:"What did you find out? What changed in your thinking?" },
  { index:4, name:"The Uncomfortable Truth",    target_pct:65, emotional_function:"The real conclusion — even harder to say than the opening admission.", reality_note:"What's the truth that most people don't want to hear?" },
  { index:5, name:"What To Do About It",        target_pct:85, emotional_function:"Actionable resolution — give the viewer something to do with this information.", reality_note:"What's the practical takeaway? What should someone do with this?" }
];

const BEFORE_AFTER_BRIDGE = [
  { index:1, name:"Pain of Before",             target_pct:0,  emotional_function:"Paint the painful starting state vividly. Make the audience feel the before.", reality_note:"What was life like before? Be specific about the struggle." },
  { index:2, name:"The Exact Moment of Change", target_pct:20, emotional_function:"The inciting moment — pinpoint when everything shifted.", reality_note:"What exactly happened? The moment things changed." },
  { index:3, name:"The Bridge — What You Did",  target_pct:35, emotional_function:"The specific actions taken across the transformation.", reality_note:"What did you do? The actual steps, decisions, and work." },
  { index:4, name:"The After",                  target_pct:65, emotional_function:"Show the after state clearly — let the result speak.", reality_note:"What does life look like now? Show the result, don't just tell it." },
  { index:5, name:"How They Can Get There",     target_pct:85, emotional_function:"Give the audience a path — make the transformation accessible.", reality_note:"What's the clear next step for someone watching this?" }
];

const MYTH_BUSTER = [
  { index:1, name:"State the Common Belief",    target_pct:0,  emotional_function:"Establish the thing everyone believes — give it full credibility first.", reality_note:"What's the conventional wisdom you're about to destroy?" },
  { index:2, name:"Why People Believe It",      target_pct:15, emotional_function:"Validate why the myth exists — this isn't stupid thinking, it's understandable.", reality_note:"Where does this belief come from? Why does it make sense on the surface?" },
  { index:3, name:"Dismantle It — Point 1",     target_pct:30, emotional_function:"First crack in the belief. Start the dismantling.", reality_note:"First piece of evidence that the common belief is wrong." },
  { index:4, name:"Dismantle It — Point 2",     target_pct:50, emotional_function:"The evidence builds. The myth crumbles further.", reality_note:"Second piece of evidence. Make it stronger than the first." },
  { index:5, name:"Dismantle It — Point 3",     target_pct:65, emotional_function:"The final blow. The myth is destroyed.", reality_note:"Third and decisive piece of evidence. This should be the most compelling." },
  { index:6, name:"Reveal the Truth",           target_pct:80, emotional_function:"The real answer emerges from the rubble of the myth.", reality_note:"What's actually true? State it clearly and boldly." },
  { index:7, name:"The Better Path",            target_pct:90, emotional_function:"Practical guidance — what to do instead now that the myth is gone.", reality_note:"What should someone do with this new truth?" }
];

const DOCUMENTARY_ARC = [
  { index:1, name:"Set the Scene",              target_pct:0,  emotional_function:"Establish the world, the location, the stakes. Cinema-style opening.", reality_note:"Where are you? What's the situation? Set it up like a documentary." },
  { index:2, name:"Inciting Moment",            target_pct:10, emotional_function:"Something happens that kicks the story into gear.", reality_note:"What's the problem, event, or discovery that starts the story?" },
  { index:3, name:"Follow the Problem",         target_pct:25, emotional_function:"Real-time pursuit — the camera follows the action as it unfolds.", reality_note:"What happens next? Follow it as it develops, unresolved." },
  { index:4, name:"Crisis Point",               target_pct:60, emotional_function:"The worst moment — things get harder, more complicated, more uncertain.", reality_note:"When did it feel most uncertain or difficult? The peak of tension." },
  { index:5, name:"Resolution",                 target_pct:80, emotional_function:"The outcome reveals itself — not necessarily the expected one.", reality_note:"What happened? How did it resolve — or not resolve?" },
  { index:6, name:"Reflection",                 target_pct:92, emotional_function:"Step back from the story and find the meaning.", reality_note:"What does this experience mean? What did you learn from following it?" }
];

const TUTORIAL_WITH_STAKES = [
  { index:1, name:"What We're Building + Why It Matters", target_pct:0,  emotional_function:"Establish the goal and its significance — this isn't just a tutorial, it's a story.", reality_note:"What are we building/doing? Why does it actually matter?" },
  { index:2, name:"The Challenge / What Could Go Wrong",  target_pct:15, emotional_function:"Raise the stakes before the tutorial starts — something real is at risk.", reality_note:"What could fail? What are the real consequences of getting this wrong?" },
  { index:3, name:"Step by Step with Real Problems",      target_pct:30, emotional_function:"The tutorial itself — but showing the actual complications as they happen.", reality_note:"Show the real process including mistakes, adjustments, and problem-solving." },
  { index:4, name:"The Result",                           target_pct:80, emotional_function:"The reveal — did it work? Show the actual outcome.", reality_note:"What was the result? Be honest about what worked and what didn't." },
  { index:5, name:"Lesson Learned",                       target_pct:90, emotional_function:"The takeaway that elevates this beyond a how-to.", reality_note:"What would you do differently? What's the one thing someone watching should know?" }
];

const EXPLAINER_PYRAMID = [
  { index:1, name:"Shocking Conclusion First",            target_pct:0,  emotional_function:"Drop the counterintuitive conclusion at the very start — create immediate cognitive dissonance.", reality_note:"What's the conclusion? State it boldly before explaining anything." },
  { index:2, name:"Zoom Out to Context",                  target_pct:15, emotional_function:"Pull back — where does this conclusion sit? Why should anyone care?", reality_note:"What's the bigger picture context that makes this conclusion matter?" },
  { index:3, name:"Drill into Evidence",                  target_pct:30, emotional_function:"Build the case piece by piece — data, examples, proof.", reality_note:"What's your evidence? Walk through it systematically." },
  { index:4, name:"Return to Conclusion with New Meaning",target_pct:75, emotional_function:"Circle back to the opening conclusion — it lands differently now that the evidence is in.", reality_note:"Restate the conclusion. It should feel earned now." },
  { index:5, name:"What This Means for YOU",              target_pct:88, emotional_function:"Make it personal — the conclusion applied to the viewer's life.", reality_note:"What should someone watching this actually do about it?" }
];

const HEROS_GAUNTLET = [
  { index:1, name:"Normal World",                  target_pct:0,  emotional_function:"Establish the status quo before the challenge.", reality_note:"What's normal? What's the world before the gauntlet begins?" },
  { index:2, name:"Impossible Challenge Accepted", target_pct:10, emotional_function:"The hero commits to something that seems beyond their reach.", reality_note:"What's the challenge? State it clearly — make it sound hard." },
  { index:3, name:"Obstacle 1",                    target_pct:20, emotional_function:"First challenge — sets expectations, establishes the stakes.", reality_note:"First obstacle. How was it overcome?" },
  { index:4, name:"Obstacle 2",                    target_pct:45, emotional_function:"Second challenge — harder than the first, raises the stakes.", reality_note:"Second obstacle. Harder than the first. How did you handle it?" },
  { index:5, name:"Obstacle 3 + Moment of Doubt",  target_pct:65, emotional_function:"The hardest challenge + the lowest emotional point.", reality_note:"The third and worst obstacle. The moment you doubted yourself." },
  { index:6, name:"Unexpected Solution",           target_pct:80, emotional_function:"The breakthrough — often comes from an unexpected angle.", reality_note:"What solved it? The insight or action that turned it around." },
  { index:7, name:"Victory + Lesson",              target_pct:90, emotional_function:"The resolution and the earned wisdom.", reality_note:"What was won? What was learned that couldn't be learned any other way?" }
];

const VIRALITY_PYRAMID = [
  { index:1, name:"Believable Conflict (Real Stakes)", target_pct:0,  emotional_function:"Establish stakes that feel real — not manufactured drama.", reality_note:"What's the real conflict? What's actually at stake?" },
  { index:2, name:"The Impossible Goal Stated Clearly",target_pct:15, emotional_function:"Name the audacious goal — it should sound genuinely difficult.", reality_note:"What are you trying to do? Make it sound as hard as it is." },
  { index:3, name:"First Vulnerable Step",             target_pct:30, emotional_function:"The first imperfect attempt — shown with honesty.", reality_note:"The first real action. Show the vulnerability of beginning." },
  { index:4, name:"Honest Struggle Shown",             target_pct:50, emotional_function:"The messy middle — real difficulty without manufactured resolution.", reality_note:"What's actually hard? Show it without cleaning it up." },
  { index:5, name:"Payoff That Validates the Journey", target_pct:82, emotional_function:"The resolution that makes the struggle worthwhile.", reality_note:"The result. Does it validate what was risked? Be honest." }
];

const PERMISSION_STRUCTURE = [
  { index:1, name:"The Thing Everyone Wants But Thinks They Can't Have", target_pct:0,  emotional_function:"Name the desire that most people have but have been told isn't possible.", reality_note:"What's the thing? Name it directly — don't dance around it." },
  { index:2, name:"Why They Think They Can't Have It",                   target_pct:15, emotional_function:"Validate the objection — acknowledge the real barriers that hold people back.", reality_note:"What are the actual objections? List them honestly." },
  { index:3, name:"Proof That's Wrong — You Did It",                    target_pct:30, emotional_function:"Your story as evidence that it IS possible.", reality_note:"What's your proof? Walk through how you actually did it." },
  { index:4, name:"The Exact Path",                                      target_pct:65, emotional_function:"Specific, actionable — not vague inspiration.", reality_note:"What's the actual path? Be specific enough to be useful." },
  { index:5, name:"You're Allowed to Want This",                         target_pct:88, emotional_function:"Explicit permission — many people need to hear this out loud.", reality_note:"Give them permission. Say it directly. This is the emotional release." }
];

const DUAL_TIMELINE = [
  { index:1, name:"Present Moment (In the Middle of Something)", target_pct:0,  emotional_function:"Drop in at a moment of tension — in medias res.", reality_note:"Where are you right now in the story? Drop in mid-action." },
  { index:2, name:"Flashback to How It Started",                 target_pct:15, emotional_function:"Cut to the beginning — contrast with the present.", reality_note:"How did this start? The origin of the situation." },
  { index:3, name:"Back to Present, Deeper In",                  target_pct:30, emotional_function:"Return to present — things have developed further.", reality_note:"Back to now — what's happening at a deeper level?" },
  { index:4, name:"Earlier Flashback, More Context",             target_pct:50, emotional_function:"Another layer of past — filling in the emotional backstory.", reality_note:"More context from the past. What does this add to understanding?" },
  { index:5, name:"Present Resolution",                          target_pct:72, emotional_function:"The present timeline resolves — the outcome.", reality_note:"What happens in the present? How does it resolve?" },
  { index:6, name:"Full Circle Moment",                          target_pct:90, emotional_function:"The moment where past and present unify into understanding.", reality_note:"The moment where it all connects. The emotional payoff." }
];

function getBeats(structure) {
  switch (structure) {
    case 'save_the_cat':        return SAVE_THE_CAT;
    case 'story_circle':        return STORY_CIRCLE;
    case 'vsl_arc':             return VSL_ARC;
    case 'free_form':           return FREE_FORM;
    case 'confession_arc':      return CONFESSION_ARC;
    case 'before_after_bridge': return BEFORE_AFTER_BRIDGE;
    case 'myth_buster':         return MYTH_BUSTER;
    case 'documentary_arc':     return DOCUMENTARY_ARC;
    case 'tutorial_with_stakes':return TUTORIAL_WITH_STAKES;
    case 'explainer_pyramid':   return EXPLAINER_PYRAMID;
    case 'heros_gauntlet':      return HEROS_GAUNTLET;
    case 'virality_pyramid':    return VIRALITY_PYRAMID;
    case 'permission_structure':return PERMISSION_STRUCTURE;
    case 'dual_timeline':       return DUAL_TIMELINE;
    case 'episode_arc':         return EPISODE_ARC;
    default:                    return [];
  }
}

// Build a fresh beat map for a project config
// Copies the template and adds project-specific fields
function buildBeatMap(structure, estimatedDurationMinutes = null) {
  const template = getBeats(structure);
  const totalSecs = estimatedDurationMinutes ? estimatedDurationMinutes * 60 : null;
  return template.map(beat => ({
    ...beat,
    target_seconds:       totalSecs ? parseFloat(((beat.target_pct / 100) * totalSecs).toFixed(1)) : null,
    covered:              false,
    coverage_footage_ids: [],
    needs_coverage:       true,
    out_of_sequence:      false,
    notes:                null
  }));
}

const EPISODE_ARC = [
  { index:1, name:"Cold Open",        target_pct:0,  emotional_function:"Hook new AND returning viewers in 30 seconds. New viewers get curious. Returning viewers get the payoff of anticipation.", reality_note:"What moment drops the viewer into the action? What makes a new viewer stay and a returning viewer feel rewarded?" },
  { index:2, name:"Episode Promise",  target_pct:8,  emotional_function:"State clearly what THIS episode delivers. Set the expectation explicitly.", reality_note:"What does this specific episode give the viewer? Say it directly — what problem gets solved, what story gets told?" },
  { index:3, name:"Standalone Story", target_pct:20, emotional_function:"The self-contained conflict and resolution that works for any viewer, first episode or not.", reality_note:"What is the episode-level story? Someone with no context should be able to follow and enjoy this." },
  { index:4, name:"Arc Advancement",  target_pct:65, emotional_function:"One clear step forward in the season story. The returning viewer gets their reward here.", reality_note:"How does this episode move the season forward? What changes in the bigger story?" },
  { index:5, name:"Character Moment", target_pct:78, emotional_function:"Who these people are, not just what happened. The emotional truth that makes viewers care.", reality_note:"What moment reveals character? Not plot — the human moment that makes the audience feel something." },
  { index:6, name:"The Seed",         target_pct:90, emotional_function:"Plant the question that makes the next episode unmissable. End with a reason to come back.", reality_note:"What are you teasing for next time? What question, tension, or promise makes someone immediately want the next episode?" }
];

module.exports = {
  SAVE_THE_CAT, STORY_CIRCLE, VSL_ARC, FREE_FORM,
  CONFESSION_ARC, BEFORE_AFTER_BRIDGE, MYTH_BUSTER, DOCUMENTARY_ARC,
  TUTORIAL_WITH_STAKES, EXPLAINER_PYRAMID, HEROS_GAUNTLET,
  VIRALITY_PYRAMID, PERMISSION_STRUCTURE, DUAL_TIMELINE,
  EPISODE_ARC,
  getBeats, buildBeatMap
};
