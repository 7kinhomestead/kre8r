#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
shootscript.py — one plain-text source in, a two-person crew's paperwork out.

    python shootscript.py H:\\edit-staging\\SHOOT-DOCS\\EP6-TELFORD.fountain

Writes into <out>/<slug>/ :

    SHOOT-SCRIPT-CARI.pdf   standard screenplay, notes stripped, nothing before setup 1
    EDITORS-COPY.pdf        the same script with the [[notes]] shown in red
    lines-<NAME>.md         every character's lines, on their own, in shooting order
    QUESTION-CARD.pdf       the INTERVIEWER's questions, big type, one per block
    LINT.txt                the rules that protect Cari's copy (exit 1 on ERROR)

Options
    --out DIR        where the folder goes (default: beside the .fountain file)
    --layout NAME    classic (default) | gutter | large
    --index          add a trailing tick-off list of every setup
    --corner TEXT    page-corner label (used for the sample formats)
    --no-pdf         HTML only, skip Edge
    --lint-only      print the lint report and stop
"""

import argparse
import datetime
import hashlib
import io
import json
import os
import re
import sys

VERSION = '1.0.0'

#: what the Division 4 script library will file this under
SHOOT_TYPES = {
    'A': 'narrated pieces to lens with action',
    'B': 'sit-down interview with question cards',
    'C': 'project work day with a setup list',
    'D': 'pickups',
}

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import fountain          # noqa: E402
import lint as lintmod   # noqa: E402
import pdfout            # noqa: E402
import render            # noqa: E402


def slugify(s):
    s = re.sub(r'[^A-Za-z0-9]+', '-', s).strip('-')
    return s.upper() or 'SHOOT'


def write_text(path, text):
    d = os.path.dirname(os.path.abspath(path))
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(text)
    print('  txt  %s  (%.1f KB)' % (path, len(text.encode('utf-8')) / 1024.0))
    return path


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def write_manifest(dest, src, script, findings, produced):
    """
    A self-describing folder, so the Division 4 script library in OrgΩr can take
    it in later without anybody remembering what it was. Read from the title page:
    Title, Episode, Shoot-Type (A-D), Shoot-Date.
    """
    t = script.title
    stype = (t.get('shoot-type') or t.get('shoot type') or '').strip().upper()[:1]
    errs = [f for f in findings if f.level == 'ERROR']
    warns = [f for f in findings if f.level == 'WARN']
    files = []
    for name, role in produced:
        p = os.path.join(dest, name)
        if not os.path.exists(p):
            continue
        files.append({'file': name, 'role': role,
                      'format': os.path.splitext(name)[1].lstrip('.').lower(),
                      'bytes': os.path.getsize(p)})
    man = {
        'schema': 'kre8r.shootscript.manifest/1',
        'tool': {'name': 'shootscript', 'version': VERSION},
        'generated_at': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
        'division': 'Content Production (Division 4)',
        'title': t.get('title') or os.path.splitext(os.path.basename(src))[0],
        'subtitle': t.get('shoot') or t.get('subtitle') or '',
        'episode': t.get('episode') or '',
        'shoot_type': stype,
        'shoot_type_label': SHOOT_TYPES.get(stype, ''),
        'shoot_date': t.get('shoot-date') or t.get('shoot date') or t.get('date') or '',
        'source': {'file': os.path.basename(src), 'path': os.path.abspath(src),
                   'sha256': sha256(src), 'bytes': os.path.getsize(src)},
        'setups': len(script.scenes()),
        'characters': script.characters(),
        'lint': {'clean': not errs, 'errors': len(errs), 'warnings': len(warns),
                 'report': 'LINT.txt',
                 'findings': [{'level': f.level, 'rule': f.rule, 'line': f.line,
                               'setup': f.scene} for f in findings]},
        'files': files,
    }
    path = os.path.join(dest, 'manifest.json')
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(json.dumps(man, indent=2, ensure_ascii=False) + '\n')
    print('  json %s' % path)
    return path


def build(src, out_dir=None, layout='classic', want_pdf=True, trailing_index=False,
          corner='', lint_only=False):
    script = fountain.parse_file(src)
    stem = os.path.splitext(os.path.basename(src))[0]
    slug = slugify(stem)

    base = out_dir or os.path.dirname(os.path.abspath(src))
    dest = os.path.join(base, slug)
    if not os.path.isdir(dest):
        os.makedirs(dest)

    findings = lintmod.lint(script)
    errs = [f for f in findings if f.level == 'ERROR']
    report = lintmod.report(findings, src, script)
    lint_path = os.path.join(dest, 'LINT.txt')
    write_text(lint_path, report)
    if lint_only:
        sys.stdout.write('\n' + report)
        return 1 if errs else 0

    produced = [('LINT.txt', 'lint_report')]

    def emit(name, html, role):
        hp = os.path.join(dest, name + '.html')
        pdfout.write_html(hp, html)
        print('  html %s  (%.0f KB)' % (hp, os.path.getsize(hp) / 1024.0))
        produced.append((name + '.html', role))
        if want_pdf:
            if not pdfout.print_pdf(hp, os.path.join(dest, name + '.pdf')):
                raise SystemExit('PDF failed for %s' % name)
            produced.append((name + '.pdf', role))

    # 1. Cari's copy — no notes, ever.
    emit('SHOOT-SCRIPT-CARI',
         render.script_html(script, layout=layout, show_notes=False,
                            doc_label='SHOOT SCRIPT', corner=corner,
                            foot_left='SHOOT SCRIPT — CARI', trailing_index=trailing_index),
         'cari_script')

    # 2. The editor's copy — the same script, with the notes back in.
    emit('EDITORS-COPY',
         render.script_html(script, layout=layout, show_notes=True,
                            doc_label="EDITOR'S COPY", corner=corner,
                            foot_left="EDITOR'S COPY — NOT FOR THE SHOOT",
                            trailing_index=trailing_index),
         'editor_copy')

    # 3. Sides — one file per character.
    for name in script.characters():
        fn = 'lines-%s.md' % name.replace(' ', '-')
        write_text(os.path.join(dest, fn), render.sides_md(script, name))
        produced.append((fn, 'lines:%s' % name))

    # 4. Question cards, if anyone is interviewing.
    qhtml = render.question_card_html(script, 'INTERVIEWER', corner=corner)
    if qhtml:
        emit('QUESTION-CARD', qhtml, 'question_card')
    else:
        print('  --   no INTERVIEWER lines; no question card')

    # 5. The folder says what it is, so the script library can take it later.
    write_manifest(dest, src, script, findings, produced)

    print('\n%s' % report.strip().splitlines()[-1])
    if errs:
        sys.stderr.write('\n*** %d LINT ERROR(S) — DO NOT PRINT CARI\'S COPY YET. See %s\n'
                         % (len(errs), lint_path))
    return 1 if errs else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build a two-person crew's shoot paperwork "
                                             "from one Fountain file.")
    ap.add_argument('source', help='the .fountain file')
    ap.add_argument('--out', default=None, help='output directory (default: beside the source)')
    ap.add_argument('--layout', default='classic', choices=('classic', 'gutter', 'large'))
    ap.add_argument('--index', action='store_true', help='trailing tick-off list of every setup')
    ap.add_argument('--corner', default='', help='page-corner label')
    ap.add_argument('--no-pdf', action='store_true')
    ap.add_argument('--lint-only', action='store_true')
    a = ap.parse_args(argv)

    if not os.path.exists(a.source):
        ap.error('no such file: %s' % a.source)
    return build(a.source, out_dir=a.out, layout=a.layout, want_pdf=not a.no_pdf,
                 trailing_index=a.index, corner=a.corner, lint_only=a.lint_only)


if __name__ == '__main__':
    sys.exit(main())
