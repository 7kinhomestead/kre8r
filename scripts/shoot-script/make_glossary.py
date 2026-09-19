#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_glossary.py — one ground-truth word per thing.

Cari, Sep 19 2026: "I would love it if there was nomenclature I'm already
familiar with that is from the industry, because then at least one of us
already knows what it is."

So: the industry words first, each with a one-line plain definition. Then our
house words, each mapped to the industry word it replaces where one exists, and
flagged KEEP or RETIRE as a PROPOSAL for the two of them to rule on. Where a
house word cannot be sourced from anything written down, it says so and asks.

Writes H:\\edit-staging\\SHOOT-DOCS\\GLOSSARY.md and GLOSSARY.pdf from the same
table, so the two can never disagree.
"""

import argparse
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import pdfout   # noqa: E402
import render   # noqa: E402

OUT = r'H:\edit-staging\SHOOT-DOCS'

INDUSTRY = [
    ('setup', 'One camera position. Move the camera, it is a new setup — that is what the numbers on the shoot script count.'),
    ('take', 'One roll of the camera on the same setup. Take one, take two, take three.'),
    ('slate', 'The clap at the top of a take that names it and lines the sound up with the picture.'),
    ('coverage', 'All the angles of the same moment. Enough coverage means the cut has somewhere to go.'),
    ('master', 'One take of the whole thing start to finish, usually wide, that everything else cuts against.'),
    ('insert', 'A close shot of a thing — hands, a gauge, a bubble in a level — dropped in later.'),
    ('cutaway', 'A shot of something else nearby, used to jump over a cut without a jump.'),
    ('B-roll', 'Anything that is not the person talking. The pictures that run under the voice.'),
    ('pickup', 'A shot gone back for afterwards because the cut turned out to be short of something.'),
    ('MOS', 'Shot with no sound recorded. Picture only.'),
    ('room tone', 'Thirty seconds of the place with nobody talking. Sound uses it to hide the joins.'),
    ('wild line', 'A line recorded on its own, off camera, for the edit to lay in.'),
    ('walk and talk', 'He talks while walking and the camera travels with him.'),
    ('piece to camera (PTC)', 'He talks straight to the lens instead of to a person. Also called direct address.'),
    ('OTS', 'Over the shoulder — framed past one person\u2019s shoulder onto the other.'),
    ('WS / MS / CU', 'Wide shot, mid shot, close-up.'),
    ('two-shot', 'Both people in the same frame.'),
    ('blocking', 'Who stands where, and who moves when.'),
    ('mark', 'The spot on the ground he has to be standing on for the frame and the focus to be right.'),
    ('continuity', 'Keeping hat, gloves, props and light the same between takes so they cut together.'),
    ('sides', 'A few pages carrying only what one person needs — all of his lines, or all of the questions.'),
    ('dailies', 'The day\u2019s footage, watched back.'),
    ('call sheet', 'Who is needed, where, and at what time.'),
    ('shot list', 'The shots to get, in the order to get them.'),
    ('lock-off', 'Camera on the tripod, framed, and then not touched.'),
    ('handheld', 'Camera in the hands or on the shoulder.'),
    ('rack focus', 'Focus travels from one thing to another inside a single shot.'),
    ('headroom', 'The gap between the top of his head and the top of the frame.'),
    ('eyeline', 'Where he is looking — and whether it matches where he is supposed to be looking.'),
    ('crossing the line', 'The 180 rule. Once the camera crosses to the other side of the action, '
                          'left and right swap and the shots stop cutting together.'),
]

# term, industry word it replaces (or None), KEEP / RETIRE / DEFINE, definition, where it came from
HOUSE = [
    ('the sitting', 'sit-down (interview)', 'RETIRE',
     'A sit-down filming session — everyone parked, camera still, talking.',
     'Used for the Sep 15 sitting in the EP6 paperwork.'),
    ('natives', 'native short', 'DEFINE',
     None,
     'Only "stands alone as a native short (60\u2013120 s)" is written down anywhere '
     '(EP6 narration briefing). The bare plural "natives" is not defined. Define with Jason.'),
    ('PTC', 'piece to camera / direct address', 'KEEP',
     'He talks to the lens. Real industry shorthand — keep it, but spell it out the first time '
     'it appears in any document.',
     'Cari uses it herself in the Sep 19 recording.'),
    ('the vehicle', 'running prop / motif', 'RETIRE',
     'The object he carries through a stretch of the film so the pieces feel like one piece — '
     'on EP6, the rock.',
     'EP6 narration briefing: "PICK UP A ROCK (the vehicle \u2014 entry)".'),
    ('serving', 'sequence', 'RETIRE',
     'A block of narration that attaches to the episode at one point — EP6 had two.',
     'EP6 narration briefing: SERVING ONE \u2014 THE METHOD, SERVING TWO \u2014 THE PRICE. '
     'An edit word. It should never appear on a shooting copy.'),
    ('history act', None, 'KEEP',
     'The historical stretch of an episode, told over drawn pictures instead of over footage.',
     'Cari\u2019s own words in the Sep 19 recording ("the narrating of the history act"). '
     'No industry word covers it, so keep it and define it here.'),
    ('spine', 'running order / assembly', 'RETIRE',
     'The locked order of the tape that the episode is built on.',
     'EP6 narration briefing: "the locked spine", "the next spine beat". Edit word.'),
    ('the weave', None, 'DEFINE',
     None,
     'Appears only as "WEAVE-LAWS" in the routing form script. Nothing written down says what it '
     'means. Define with Jason.'),
    ('pickup A / pickup B', 'pickup', 'RETIRE',
     'A pickup shot with an edit label stuck on it.',
     'EP6 narration briefing: "P1 below is PICKUP B from the locked spine". '
     '"Pickup" is industry and stays; the letters are bookkeeping and go in the notes.'),
    ('card', 'title card / question card / media card', 'RETIRE',
     'Three different things wear this word: a graphic on screen, a page of questions, '
     'and the thing the camera records onto. Always say which.',
     'EP6 narration briefing: "no music-out, no card", "the honest-hammer card is already on tape".'),
    ('run sheet', None, 'KEEP',
     'The per-film checklist of targets cut from the routing form. An office document — '
     'it is not a call sheet and it should never turn up on a shoot.',
     'routing-battleplan.py: "the run sheet that Jason and the machine both work from".'),
]

INTRO = ('One word per thing. The first list is the industry\u2019s, so Cari already knows most of '
         'it; the second is ours, and every one of those is a PROPOSAL for Jason and Cari to rule '
         'on \u2014 KEEP it, or RETIRE it and use the industry word instead.')


def markdown():
    L = ['# SHOOT GLOSSARY — 7 Kin Homestead', '',
         '*%s*' % INTRO, '',
         '## THE INDUSTRY WORDS', '']
    for t, d in INDUSTRY:
        L.append('- **%s** — %s' % (t, d))
    L += ['', '## OUR WORDS — KEEP OR RETIRE?', '',
          'Each one is a proposal. Tick it on the survey or say it out loud; whatever you two rule '
          'becomes the only word the machine uses.', '']
    for term, ind, status, definition, source in HOUSE:
        L.append('### %s — **%s**' % (term, status))
        if ind:
            L.append('- Industry word: **%s**' % ind)
        L.append('- Means: %s' % (definition or '_not sourced anywhere written down — '
                                                'DEFINE WITH JASON_'))
        L.append('- Where it comes from: %s' % source)
        L.append('')
    return '\n'.join(L).rstrip() + '\n'


def html():
    rows = ''.join('<div class="t">%s</div><div class="d">%s</div>'
                   % (render.esc(t), render.esc(d)) for t, d in INDUSTRY)
    cards = []
    for term, ind, status, definition, source in HOUSE:
        cls = ' retire' if status == 'RETIRE' else ''
        tag = {'KEEP': 'KEEP', 'RETIRE': 'RETIRE?', 'DEFINE': 'DEFINE WITH JASON'}[status]
        swap = ('<div class="swap">Industry word: <b>%s</b></div>' % render.esc(ind)) if ind else \
               '<div class="swap">No industry word covers it.</div>'
        mean = definition or 'Not sourced anywhere written down. Jason has to say what it means.'
        cards.append('<div class="house"><div class="hd"><span class="term">%s</span>'
                     '<span class="tag%s">%s</span></div>%s<div>%s</div>'
                     '<div class="src">%s</div></div>'
                     % (render.esc(term), cls, tag, swap, render.esc(mean), render.esc(source)))
    body = ('<h1>SHOOT GLOSSARY</h1>'
            '<div class="lede">%s</div>'
            '<h2>The industry words</h2><div class="defs">%s</div>'
            '<h2>Our words &mdash; keep or retire?</h2>'
            '<p class="small">Each one is a proposal. Whatever you two rule becomes the only word '
            'the machine uses \u2014 in the scripts, in the notes and in the shoot sheets.</p>%s'
            % (render.esc(INTRO), rows, ''.join(cards)))
    return render.paper_html('Shoot glossary', body,
                             foot_left='7 KIN HOMESTEAD \u00b7 SHOOT GLOSSARY',
                             foot_right='Sep 19 2026')


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--no-pdf', action='store_true')
    a = ap.parse_args(argv)
    if not os.path.isdir(a.out):
        os.makedirs(a.out)
    md = os.path.join(a.out, 'GLOSSARY.md')
    with io.open(md, 'w', encoding='utf-8') as f:
        f.write(markdown())
    print('  md   %s' % md)
    hp = os.path.join(a.out, 'GLOSSARY.html')
    pdfout.write_html(hp, html())
    print('  html %s' % hp)
    if a.no_pdf:
        return 0
    return 0 if pdfout.print_pdf(hp, os.path.join(a.out, 'GLOSSARY.pdf')) else 1


if __name__ == '__main__':
    sys.exit(main())
