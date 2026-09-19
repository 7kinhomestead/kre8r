#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_conventions.py — the one-page sheet: how to write a shoot script here.

Fountain, plus exactly two house conventions, plus the two voice rules Cari and
Jason set on Sep 19 2026. Writes HOW-TO-WRITE-A-SHOOT-SCRIPT.md and .pdf into
H:\\edit-staging\\SHOOT-DOCS so the rule and the tool never drift apart.
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

SECTIONS = [
    ('The format is Fountain', [
        'Plain text. Any editor. The standard is at fountain.io and we have not changed it.',
        'A line starting INT. or EXT. is a setup. They number themselves, in shooting order.',
        'A line on its own is action. A CAPS name on its own line starts dialogue. '
        '(Something in brackets) under the name is a parenthetical.',
        'Two square brackets make a note: [[like this]]. Notes never reach Cari\u2019s copy \u2014 '
        'that is where every editor\u2019s join, clip id and beat lives.',
        'A line starting with = is a synopsis of something already filmed. It DOES print, in '
        'plain words: who, doing what, about what.',
        '/* This is the boneyard. Anything in here is deleted outright. */',
    ]),
    ('House convention 1 \u2014 !ON CAMERA:', [
        'An action line beginning !ON CAMERA: is the load-bearing direction. It prints in a box '
        'and it is the one thing the setup fails without.',
        'Example:  !ON CAMERA: the hand picking the rock up off the ground.',
        'Every setup should have one. The lint warns when one does not.',
    ]),
    ('House convention 2 \u2014 (exactly) and (in his own words)', [
        'A parenthetical containing the word exactly means the line under it is written and gets '
        'said word for word.',
        'A parenthetical containing in his own words means the line under it is a BRIEFING \u2014 '
        'what the chunk is about. He absorbs it and says it however it comes out. This is the '
        'absorb-and-restate law: only fully his words go on camera.',
        'Both print. Cari can see at a glance which lines are fixed and which ones will wander.',
    ]),
    ('Voice rule 1 \u2014 his lines are in the first person', [
        'Cari, Sep 19 2026: a line she hands him is a line he SAYS, so write it as he says it.',
        'Yes: "I can\u2019t afford the crusher. The rock and the hands, I already have."',
        'No:  "The crusher is what he cannot afford."',
        'This covers written lines and briefings both. Action stays third person present, the way '
        'screenplays are written: "Jason kneels and sets the rock down."',
        'If a "he" in his mouth is somebody else \u2014 Telford, McAdam \u2014 name that person in '
        'the same setup so Cari knows who it is. The lint errors when it cannot tell.',
    ]),
    ('Voice rule 2 \u2014 questions are written the way Cari asks them', [
        'An interview question is dialogue by a character called INTERVIEWER, written in the '
        'second person, to Jason, ending in a question mark.',
        'Yes: "You told me the sand had to stay dry while we were on the pad. Where were you '
        'coming from on that?"',
        'No:  "His thoughts on the tarp." That is a topic, not a question. The lint errors on it.',
        'Questions do not have to look like screenplay. They print as numbered cards in big type.',
    ]),
    ('The title page \u2014 what the script library reads', [
        'Title:  EP6 \u00b7 THE TELFORD HISTORY TALK      (line one of her copy)',
        'Shoot:  SHOOT SCRIPT \u00b7 10 setups, shot in this order   (line two, and that is all '
        'that may appear before setup 1)',
        'Episode: EP6      Shoot-Type: A      Shoot-Date: 2026-09-19',
        'Interviewer: Cari   (whose name goes on the question cards)',
        'Shoot-Type is A narrated to lens \u00b7 B sit-down \u00b7 C work day \u00b7 D pickups. '
        'It ends up in manifest.json so the Division 4 script library can file it later.',
    ]),
    ('The command', [
        'python C:\\Users\\18054\\kre8r\\scripts\\shoot-script\\shootscript.py <file.fountain>',
        'Out comes: SHOOT-SCRIPT-CARI.pdf, EDITORS-COPY.pdf, lines-<NAME>.md for everyone who '
        'speaks, QUESTION-CARD.pdf if anybody is interviewing, LINT.txt and manifest.json.',
        'If LINT.txt has one ERROR in it, nobody prints Cari\u2019s copy until it is fixed.',
    ]),
]


#: it is called a one-page sheet, so it is one page: two columns, tight leading
ONE_PAGE_CSS = u"""
@page{margin:.45in .5in .4in .5in}
body{font-size:8.6pt;line-height:1.3}
h1{font-size:14pt}
.lede{font-size:9pt;margin-bottom:8px;padding-bottom:6px}
.cols{column-count:2;column-gap:20px}
h2{font-size:9pt;margin:8px 0 4px;break-after:avoid;break-inside:avoid}
.cols > h2:first-child{margin-top:0}
ul{margin:0 0 6px 15px}
li{margin-bottom:2px}
"""


def markdown():
    L = ['# HOW TO WRITE A SHOOT SCRIPT', '',
         '*Fountain, plus two house conventions and two voice rules. One page. '
         'Sep 19 2026.*', '']
    for head, bullets in SECTIONS:
        L.append('## %s' % head)
        L.extend('- %s' % b for b in bullets)
        L.append('')
    return '\n'.join(L).rstrip() + '\n'


def html():
    out = ['<h1>HOW TO WRITE A SHOOT SCRIPT</h1>',
           '<div class="lede">Fountain, plus two house conventions and two voice rules. '
           'Everything else about the format is somebody else\u2019s standard, on purpose.</div>']
    out.append('<div class="cols">')
    for head, bullets in SECTIONS:
        out.append('<h2>%s</h2><ul>%s</ul>'
                   % (render.esc(head),
                      ''.join('<li>%s</li>' % render.esc(b) for b in bullets)))
    out.append('</div>')
    return render.paper_html('How to write a shoot script', ''.join(out),
                             foot_left='7 KIN HOMESTEAD \u00b7 SHOOT SCRIPT CONVENTIONS',
                             foot_right='Sep 19 2026',
                             extra_css=render.TIGHT_CSS + ONE_PAGE_CSS)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--no-pdf', action='store_true')
    a = ap.parse_args(argv)
    if not os.path.isdir(a.out):
        os.makedirs(a.out)
    md = os.path.join(a.out, 'HOW-TO-WRITE-A-SHOOT-SCRIPT.md')
    with io.open(md, 'w', encoding='utf-8') as f:
        f.write(markdown())
    print('  md   %s' % md)
    hp = os.path.join(a.out, 'HOW-TO-WRITE-A-SHOOT-SCRIPT.html')
    pdfout.write_html(hp, html())
    print('  html %s' % hp)
    if a.no_pdf:
        return 0
    return 0 if pdfout.print_pdf(hp, os.path.join(a.out, 'HOW-TO-WRITE-A-SHOOT-SCRIPT.pdf')) else 1


if __name__ == '__main__':
    sys.exit(main())
