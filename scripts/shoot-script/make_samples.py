#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_samples.py — the sample formats Cari picks from.

Four shoot types, two or three visibly different layouts of the SAME content
each. (A) is today's real Telford shoot; (B), (C) and (D) are short made-up
water-tank shoots so the format is the only thing she has to judge.

    python make_samples.py [--out H:\\edit-staging\\SHOOT-DOCS\\SAMPLES]

Every page is stamped with its sample id in the corner, which is what she
writes on the survey.
"""

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import fountain          # noqa: E402
import lint as lintmod   # noqa: E402
import pdfout            # noqa: E402
import render            # noqa: E402

OUT = r'H:\edit-staging\SHOOT-DOCS\SAMPLES'
TELFORD = r'H:\edit-staging\SHOOT-DOCS\EP6-TELFORD.fountain'
SAMPLES = os.path.join(HERE, 'samples')

#  id,  source,                          layout,   what it is,                              index
PLAN = [
    ('A1', TELFORD, 'classic', 'A · narrated to lens · standard screenplay', False, False),
    ('A2', TELFORD, 'gutter', 'A · narrated to lens · tick-and-setup gutter', False, False),
    ('A3', TELFORD, 'large', 'A · narrated to lens · big type, two setups a page', False, False),

    ('B1', 'water-tank-interview.fountain', 'classic', 'B · sit-down · standard screenplay', False, False),
    ('B2', 'water-tank-interview.fountain', 'cards', 'B · sit-down · question cards only', False, False),
    ('B3', 'water-tank-interview.fountain', 'large', 'B · sit-down · big type', False, False),

    ('C1', 'water-tank-workday.fountain', 'gutter', 'C · work day · gutter + list of every setup', True, False),
    ('C2', 'water-tank-workday.fountain', 'large', 'C · work day · big type + list of every setup', True, False),

    ('D1', 'water-tank-pickups.fountain', 'classic', 'D · pickups · standard screenplay', False, False),
    ('D2', 'water-tank-pickups.fountain', 'large', 'D · pickups · big type, two a page', False, False),
]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--no-pdf', action='store_true')
    a = ap.parse_args(argv)

    if not os.path.isdir(a.out):
        os.makedirs(a.out)

    cache, bad = {}, 0
    for sid, src, layout, label, index, _x in PLAN:
        path = src if os.path.isabs(src) else os.path.join(SAMPLES, src)
        if path not in cache:
            cache[path] = fountain.parse_file(path)
            findings = lintmod.lint(cache[path])
            errs = [f for f in findings if f.level == 'ERROR']
            warns = [f for f in findings if f.level == 'WARN']
            print('%s  %d error(s), %d warning(s)' % (os.path.basename(path), len(errs), len(warns)))
            for f in findings:
                print('    %-5s line %-4d %s' % (f.level, f.line, f.rule))
            bad += len(errs)
        script = cache[path]

        name = '%s-%s' % (sid, layout.upper() + ('-TICKLIST' if index else ''))
        if layout == 'cards':
            html = render.question_card_html(script, 'INTERVIEWER', corner='SAMPLE ' + sid)
            if html is None:
                print('  %s skipped — no INTERVIEWER lines' % sid)
                continue
        else:
            html = render.script_html(script, layout=layout, show_notes=False,
                                      doc_label='SHOOT SCRIPT', corner='SAMPLE ' + sid,
                                      foot_left=label, trailing_index=index)
        hp = os.path.join(a.out, name + '.html')
        pdfout.write_html(hp, html)
        print('  html %s' % hp)
        if not a.no_pdf:
            if not pdfout.print_pdf(hp, os.path.join(a.out, name + '.pdf')):
                return 1
    print('\nSamples in %s' % a.out)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
