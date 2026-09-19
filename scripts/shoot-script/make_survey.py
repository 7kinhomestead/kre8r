#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_survey.py — the page Cari fills in.

Two pages, printable, mostly boxes to tick with a line for words. Written to
her, in plain language, no jargon. It asks which sample she wants for each kind
of shoot and everything else that makes a shoot day stop.

    python make_survey.py   ->  H:\\edit-staging\\SHOOT-DOCS\\CARI-SURVEY.pdf
"""

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import pdfout   # noqa: E402
import render   # noqa: E402

OUT = r'H:\edit-staging\SHOOT-DOCS'


#: two sheets of paper, and still room to write
SURVEY_CSS = u"""
@page{margin:.42in .5in .38in .5in}
body{font-size:9.1pt;line-height:1.32}
.q{margin:0 0 6px;padding:5px 8px}
.q .ask{font-size:9.8pt;margin:1px 0 4px}
.opt{font-size:9.1pt}
.opts{gap:3px 12px}
.bx{width:12px;height:12px}
.write{height:14px;margin-top:4px}
.write.tall{height:24px}
"""


def opts(items, column=False, per_line=None):
    cls = 'opts col' if column else 'opts'
    return '<div class="%s">%s</div>' % (
        cls, ''.join('<span class="opt"><span class="bx"></span>%s</span>' % render.esc(i)
                     for i in items))


def q(n, ask, inner='', note=None, write=1, tall=False):
    body = ['<div class="q"><div class="n">%d</div><div class="ask">%s</div>' % (n, render.esc(ask))]
    if note:
        body.append('<div class="small">%s</div>' % render.esc(note))
    body.append(inner)
    for _ in range(write):
        body.append('<div class="write%s"></div>' % (' tall' if tall else ''))
    body.append('</div>')
    return ''.join(body)


QUESTIONS = [
    q(1, 'Today\u2019s kind of shoot \u2014 Jason talking to the lens while he does things. '
         'Which one do you want?',
      opts(['A1  standard screenplay', 'A2  tick-and-setup gutter', 'A3  big type, two setups a page']),
      note='The samples are in the SAMPLES folder; the code is in the bottom corner of every page.'),
    q(2, 'A sit-down interview. Which one?',
      opts(['B1  standard screenplay', 'B2  question cards only', 'B3  big type'])),
    q(3, 'A work day on a project. Which one?',
      opts(['C1  gutter, with the list of every setup at the back',
            'C2  big type, with the list of every setup at the back'])),
    q(4, 'Pickups \u2014 a short day going back for bits. Which one?',
      opts(['D1  standard screenplay', 'D2  big type'])),
    q(5, 'Type size, outdoors, in the sun, on paper.',
      opts(['the normal size is fine', 'one size bigger', 'as big as A3/B3/C2',
            'depends on the day'])),
    q(6, 'What are you actually holding on the day?',
      opts(['paper', 'phone', 'tablet', 'paper, and the phone as backup', 'something else \u2192'])),
    q(7, 'How much of what Jason says do you want to see?',
      opts(['every word of it',
            'the first line and the last line, and the topic in between',
            'just the topic \u2014 he talks, I shoot',
            'what we do now: written lines where they matter, topic for the rest'], column=True)),
    q(8, 'When the script points at something we already filmed, how do you want it written?',
      opts(['a couple of plain sentences: who, doing what, about what',
            'a plain sentence and the day it happened',
            'leave it out unless I have to know',
            'other \u2192'], column=True),
      note='Right now it reads: "Cari and Jason up on the pad in the rain, working out whether '
           'the tarp went over the sand or under it."'),
    q(9, 'Tick any word that has ever made you stop and wonder what it meant.',
      opts(['the sitting', 'natives', 'PTC', 'the vehicle', 'serving', 'history act', 'spine',
            'the weave', 'pickup A / pickup B', 'card', 'run sheet', 'in / out', 'beat']),
      note='The house words. The glossary sheet has what each one is supposed to mean.'),
    q(10, 'What do you need to know the night before?',
      opts(['how many setups', 'how long it will take', 'what he is wearing',
            'what props or tools have to be to hand', 'where on the property',
            'whether any of the kids are in it', 'what happens if it rains',
            'nothing \u2014 morning is fine'])),
    q(11, 'When something changes on the day, or we go again, how should it be marked?',
      opts(['I write on the paper', 'reprint the page', 'just tell me, I will remember',
            'a box on the page to tick per take'], column=True)),
    q(12, 'What makes you stop in the middle of a shoot? Tick all of them.',
      opts(['I cannot find where we are on the page',
            'I do not know who "he" is in a sentence',
            'I cannot tell what has to be on camera',
            'a word I do not know',
            'too small to read out here',
            'I do not know how long the take should run',
            'the order on the page is not the order we are shooting'], column=True)),
    q(13, 'Anything else. Anything at all \u2014 this is the part that changes what gets built.',
      '', write=2, tall=True),
]


def html():
    body = ['<h1>CARI \u2014 ABOUT THE SHOOT PAPERWORK</h1>',
            '<div class="lede">You said it: standard screenplay, one chunk then the next, no '
            'editor\u2019s notes, and plain words for anything we already filmed. This is to get '
            'the rest of it right the first time. Tick what fits, scribble on it, hand it back. '
            'Nothing here is a test \u2014 whatever you pick is what the machine builds from then '
            'on.</div>']
    body.extend(QUESTIONS)
    body.append('<p class="small">Thank you. \u2014 Jason &amp; Ledger, Sep 19 2026</p>')
    return render.paper_html('Cari — about the shoot paperwork', ''.join(body),
                             foot_left='7 KIN HOMESTEAD \u00b7 SHOOT PAPERWORK',
                             foot_right='for Cari \u00b7 Sep 19 2026',
                             extra_css=render.TIGHT_CSS + SURVEY_CSS)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--no-pdf', action='store_true')
    a = ap.parse_args(argv)
    if not os.path.isdir(a.out):
        os.makedirs(a.out)
    hp = os.path.join(a.out, 'CARI-SURVEY.html')
    pdfout.write_html(hp, html())
    print('  html %s' % hp)
    if a.no_pdf:
        return 0
    return 0 if pdfout.print_pdf(hp, os.path.join(a.out, 'CARI-SURVEY.pdf')) else 1


if __name__ == '__main__':
    sys.exit(main())
