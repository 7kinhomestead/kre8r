'use strict';

const SAVE_THE_CAT = [
  { index:1, name:"Opening Image", target_pct:0, emotional_function:"Establish the world as it is before anything changes. A single image or moment that captures the starting state.", reality_note:"What does life look like at the start of this story? What are you doing, where are you, what's the mood?" },
  { index:2, name:"Theme Stated", target_pct:5, emotional_function:"Someone says (or implies) what this story is really about. The thesis of the episode.", reality_note:"What's the deeper point of this video beyond the surface topic? When do you say it out loud?" },
  { index:3, name:"Set-Up", target_pct:1, emotional_function:"Establish the world, the people, the stakes. What does the audience need to know before things change?", reality_note:"Context, background, who's involved, what the situation is." },
  { index:4, name:"Catalyst", target_pct:10, emotional_function:"The inciting incident. Something happens that sets the story in motion. No going back.", reality_note:"What was the moment things changed? The discovery, the decision, the problem that started everything." },
  { index:5, name:"Debate", target_pct:12, emotional_function:"The protagonist wrestles with whether to go. Internal conflict, weighing options.", reality_note:"What were you unsure about? What almost made you not do this? Be honest about the doubt." },
  { index:6, name:"Break into Two", target_pct:25, emotional_function:"The decision is made. We enter the upside-down world. The adventure begins.", reality_note:"The moment you committed. When you said yes, bought the thing, started the project." },
  { index:7, name:"B Story", target_pct:30, emotional_function:"A secondary storyline begins — often where the real theme lives. A relationship, a parallel lesson.", reality_note:"Is there a person, relationship, or parallel situation woven into this story? What's the emotional undercurrent?" },
  { index:8, name:"Fun and Games", target_pct:30, emotional_function:"The promise of the premise. This is what the audience came to see. The bulk of the content.", reality_note:"The actual doing of the thing. The process, the work, the moments that make this video worth watching." },
  { index:9, name:"Midpoint", target_pct:50, emotional_function:"A false victory or false defeat. Stakes are raised. The story shifts.", reality_note:"Halfway through — what changed? What worked better than expected or worse than expected?" },
  { index:10, name:"Bad Guys Close In", target_pct:55, emotional_function:"Things start to go wrong. External pressure, internal doubt, complications mount.", reality_note:"What went wrong? What was harder than expected? What almost derailed everything?" },
  { index:11, name:"All Is Lost", target_pct:75, emotional_function:"The lowest point. The worst moment. Everything seems to have failed.", reality_note:"The moment you were most frustrated, defeated, or ready to quit. Be real about this." },
  { index:12, name:"Dark Night of the Soul", target_pct:75, emotional_function:"Sitting with the failure. Processing. The quiet before the solution.", reality_note:"What did you think about at the worst moment? What did you almost decide?" },
  { index:13, name:"Break into Three", target_pct:80, emotional_function:"The solution appears. A new idea, a realization, help arrives.", reality_note:"What changed? What was the insight, the fix, the person who helped, the thing you tried differently?" },
  { index:14, name:"Finale", target_pct:80, emotional_function:"Execute the solution. The climax. Everything comes together.", reality_note:"The resolution. What happened when you applied the solution? Show the result." },
  { index:15, name:"Final Image", target_pct:99, emotional_function:"The world as it is now. Mirror of the Opening Image but changed.", reality_note:"Where are you now compared to where you started? What does this look like after?" }
];

const STORY_CIRCLE = [
  { index:1, name:"You", target_pct:0, emotional_function:"Establish the hero in their comfort zone.", reality_note:"Who are you and what is normal for you right now?" },
  { index:2, name:"Need", target_pct:10, emotional_function:"Something is wrong or missing. A want or need emerges.", reality_note:"What problem, gap, or desire started this story?" },
  { index:3, name:"Go", target_pct:25, emotional_function:"Cross the threshold. Enter the unknown.", reality_note:"The moment you committed and stepped into unfamiliar territory." },
  { index:4, name:"Search", target_pct:37, emotional_function:"The road of trials. Adapt to the new situation.", reality_note:"The process, the struggle, the figuring-it-out phase." },
  { index:5, name:"Find", target_pct:50, emotional_function:"Get what you were looking for — but at a cost.", reality_note:"The result, the discovery, the thing you were working toward." },
  { index:6, name:"Take", target_pct:62, emotional_function:"Pay the price. The consequence of getting what you wanted.", reality_note:"What did it cost? What changed because of what you found?" },
  { index:7, name:"Return", target_pct:75, emotional_function:"Come back to where you started — but different.", reality_note:"Back to normal life — but what's different now?" },
  { index:8, name:"Change", target_pct:87, emotional_function:"The transformation is complete. The lesson lands.", reality_note:"What do you know now that you didn't before? What changed in you?" }
];

const VSL_ARC = [
  { index:1, name:"Hook", target_pct:0, emotional_function:"Stop the scroll. Create immediate curiosity or recognition.", reality_note:"What's the one thing that makes someone stop and watch?" },
  { index:2, name:"Problem", target_pct:10, emotional_function:"Name the pain. Make them feel seen and understood.", reality_note:"What problem does your audience have that this video addresses?" },
  { index:3, name:"Agitation", target_pct:20, emotional_function:"Make the problem feel urgent. What happens if nothing changes?", reality_note:"Why does this problem matter? What's the cost of staying stuck?" },
  { index:4, name:"Solution", target_pct:35, emotional_function:"Introduce the answer. Hope arrives.", reality_note:"What's the solution you're presenting? How does it change things?" },
  { index:5, name:"Proof", target_pct:50, emotional_function:"Show it works. Credibility, results, evidence.", reality_note:"What proof do you have? Results, testimonials, your own story." },
  { index:6, name:"Offer", target_pct:75, emotional_function:"The specific ask. What they get, what it costs, why now.", reality_note:"What exactly are you offering? Be specific and clear." },
  { index:7, name:"CTA", target_pct:90, emotional_function:"The direct call to action. One clear next step.", reality_note:"What's the one thing you want them to do right now?" }
];

const FREE_FORM = [];

function getBeats(structure) {
  switch (structure) {
    case 'save_the_cat':  return SAVE_THE_CAT;
    case 'story_circle':  return STORY_CIRCLE;
    case 'vsl_arc':       return VSL_ARC;
    case 'free_form':     return FREE_FORM;
    default:              return [];
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

module.exports = { SAVE_THE_CAT, STORY_CIRCLE, VSL_ARC, FREE_FORM, getBeats, buildBeatMap };
