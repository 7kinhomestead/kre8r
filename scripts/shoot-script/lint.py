#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
lint.py — the rules that protect Cari's copy.

Everything here is checked against WHAT SHE WILL SEE: the printed elements of
the shooting copy. Anything inside [[notes]] or /* boneyard */ is exempt, on
purpose — that is where the editor's paperwork lives.

ERROR (exit code 1)
  preamble        anything printed before scene 1 that is not the title block
  forward-ref     "see page", "below", "later in", "as described in scene N" (N ahead)
  jargon          an editor's word outside [[notes]] — list in lint-rules.json

WARN (exit code 0)
  quote-no-synopsis   a 2-8 word quotation used as a reference with no = synopsis near it
  house-jargon        a house word that has an industry word, or is not yet defined
  no-on-camera        a scene with no !ON CAMERA line
"""

import io
import json
import os
import re

RULES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lint-rules.json')

_QUOTE = re.compile(u'[“"]([^”"]{2,200})[”"]')


class Finding(object):
    __slots__ = ('level', 'rule', 'line', 'scene', 'text', 'why')

    def __init__(self, level, rule, line, scene, text, why):
        self.level, self.rule, self.line = level, rule, line
        self.scene, self.text, self.why = scene, text, why

    def __repr__(self):
        return '%s %s line %s' % (self.level, self.rule, self.line)


def load_rules(path=RULES_PATH):
    with io.open(path, encoding='utf-8') as f:
        return json.load(f)


def _compile(entry):
    flags = 0 if entry.get('case_sensitive') else re.I
    return re.compile(entry['pattern'], flags)


def _printed_text(el):
    """What Cari reads for this element (notes are already out of el.text)."""
    if el.type == 'scene_heading':
        return el.text
    if el.type in ('action', 'character', 'parenthetical', 'dialogue',
                   'synopsis', 'transition', 'centered'):
        return el.text
    return ''


def lint(script, rules=None):
    rules = rules or load_rules()
    out = []

    banned = [(e, _compile(e)) for e in rules.get('banned', [])]
    house = [(e, _compile(e)) for e in rules.get('house_jargon', [])]
    fwd = [(e, _compile(e)) for e in rules.get('forward_reference', [])]
    fwd_scene = [(e, _compile(e)) for e in rules.get('forward_reference_scene', [])]
    cues = [c.lower() for c in rules.get('reference_cues', [])]

    # ── ERROR: anything printed before scene 1 ───────────────────────────────
    for el in script.preamble():
        t = _printed_text(el)
        if t.strip():
            out.append(Finding('ERROR', 'preamble', el.line, None, t.split('\n')[0][:90],
                               'Nothing goes before scene 1 but the title block. '
                               'Move it into the scene it belongs to, or into [[notes]].'))

    scenes = script.scenes()
    scene_has_synopsis = {}
    for num, head, els in scenes:
        scene_has_synopsis[num] = any(e.type == 'synopsis' for e in els)

    # ── per element ──────────────────────────────────────────────────────────
    for el in script.elements:
        t = _printed_text(el)
        if not t.strip():
            continue
        scene = el.scene

        for entry, rx in banned:
            m = rx.search(t)
            if m:
                out.append(Finding('ERROR', 'jargon:' + entry['id'], el.line, scene,
                                   _excerpt(t, m), entry['why']))

        for entry, rx in fwd:
            m = rx.search(t)
            if m:
                out.append(Finding('ERROR', 'forward-ref:' + entry['id'], el.line, scene,
                                   _excerpt(t, m),
                                   'A forward reference. Cari reads one chunk, then the next — '
                                   'say it where it happens or leave it out.'))

        for entry, rx in fwd_scene:
            for m in rx.finditer(t):
                try:
                    target = int(m.group(1))
                except (IndexError, ValueError):
                    continue
                if scene and target > scene:
                    out.append(Finding('ERROR', 'forward-ref:' + entry['id'], el.line, scene,
                                       _excerpt(t, m),
                                       'Points forward to setup %d. Nothing on her copy may point '
                                       'at something she has not read yet.' % target))

        for entry, rx in house:
            m = rx.search(t)
            if m:
                ind = entry.get('industry') or ''
                say = (' Industry word: %s.' % ind) if ind and ind != '(none)' else ''
                out.append(Finding('WARN', 'house-jargon:' + entry['id'], el.line, scene,
                                   _excerpt(t, m),
                                   '%s (%s).%s %s' % (entry['id'], entry.get('status', '?'),
                                                      say, entry.get('why', ''))))

        # quoted fragment used as a reference
        if el.type in ('action', 'parenthetical', 'dialogue', 'synopsis'):
            for m in _QUOTE.finditer(t):
                words = m.group(1).split()
                if not (2 <= len(words) <= 8):
                    continue
                # a quotation is "used as a reference" when it sits in stage direction,
                # or when the sentence around it points at something already filmed.
                around = (t[:m.start()][-90:] + ' ' + t[m.end():][:90]).lower()
                is_reference = el.type in ('action', 'parenthetical') or \
                    any(c in around for c in cues)
                if not is_reference:
                    continue
                if scene and scene_has_synopsis.get(scene):
                    continue
                out.append(Finding('WARN', 'quote-no-synopsis', el.line, scene, _excerpt(t, m),
                                   'A few words in quotes is not a reference she can shoot. '
                                   'Add a plain synopsis line: = Cari and Jason on the pad, '
                                   'working out how the tarp goes on.'))

    out.extend(voice_findings(script, rules))

    # ── WARN: a setup with nothing that must be on camera ────────────────────
    for num, head, els in scenes:
        if not any(e.is_on_camera for e in els):
            out.append(Finding('WARN', 'no-on-camera', head.line, num, head.text[:90],
                               'This setup has no !ON CAMERA line. If nothing has to be seen, '
                               'say so; if something does, she needs to know before rolling.'))

    out.sort(key=lambda f: (f.line, 0 if f.level == 'ERROR' else 1))
    return out


# ── the voice rules (Cari + Jason, Sep 19 2026) ───────────────────────────────

def _named_people(texts, crew):
    """
    Proper names in a stretch of script, minus the crew — who "he" could be.
    Each element is scanned on its own, and the first word of every sentence is
    skipped, so an ordinary capital at the start of a line is never a person.
    """
    names = set()
    for text in ([texts] if isinstance(texts, str) else texts):
        for sent in re.split(r'(?<=[.!?;:])\s+|\n', text):
            toks = re.findall(r"[A-Za-z][A-Za-z']*", sent)
            for t in toks[1:]:                  # skip the first word of each sentence
                t = re.sub(r"'s$", '', t)
                if re.match(r'^[A-Z][a-z]{2,}$', t) and t.upper() not in crew:
                    names.add(t)
    return names


def voice_findings(script, rules):
    """
    Jason's lines are written the way he says them: FIRST PERSON.
    Cari's questions are written the way she asks them: TO him, as a question.
    """
    v = (rules or {}).get('voice') or {}
    crew = set(n.upper() for n in v.get('crew_names') or [])
    interviewer = (v.get('interviewer_character') or 'INTERVIEWER').upper()
    third = re.compile(v.get('third_person') or r'\b(he|him|his|himself)\b', re.I)
    second = re.compile(v.get('second_person') or r'\b(you|your|yours)\b', re.I)
    openers = [o.lower() for o in (v.get('question_openers') or [])]

    # every printed word of each setup, so we can see who "he" could be
    scene_text = {}
    for num, head, els in script.scenes():
        scene_text[num] = [head.text] + [_printed_text(e) for e in els]

    out = []
    for b in script.blocks():
        said = ' '.join(t for kind, t, _d in b['parts'] if kind == 'line').strip()
        if not said:
            continue
        who = b['character']

        if who == interviewer:
            if not second.search(said):
                out.append(Finding('ERROR', 'voice:not-to-him', b['line'], b['scene'], said[:110],
                                   'An interview question is written the way Cari asks it, to '
                                   'Jason: "You told me ... — where were you coming from?" '
                                   'Not as a topic to be covered.'))
            elif '?' not in said and not any(o in said.lower() for o in openers):
                out.append(Finding('ERROR', 'voice:not-a-question', b['line'], b['scene'], said[:110],
                                   'This is a subject, not a question. Ask it out loud the way '
                                   'she would ask it, and put the question mark on it.'))
            continue

        # an on-camera speaker talking about himself in the third person
        if re.search(r'\b%s\b' % re.escape(who), said, re.I):
            out.append(Finding('ERROR', 'voice:own-name', b['line'], b['scene'], said[:110],
                               '%s does not say "%s" about himself. Write it as "I".'
                               % (who.title(), who.title())))
            continue
        m = third.search(said)
        if m:
            others = _named_people(scene_text.get(b['scene']) or [said], crew)
            if not others:
                out.append(Finding('ERROR', 'voice:third-person', b['line'], b['scene'],
                                   _excerpt(said, m),
                                   'This is his line — he says it. Write it in the first person: '
                                   '"I can\'t afford the crusher. The rock and the hands, I '
                                   'already have." If the "he" is somebody else, name them in '
                                   'this setup so Cari knows who it is.'))
    return out


def _excerpt(text, m):
    a = max(0, m.start() - 28)
    b = min(len(text), m.end() + 28)
    s = text[a:b].replace('\n', ' ')
    return ('...' if a else '') + s + ('...' if b < len(text) else '')


def report(findings, source, script=None):
    errs = [f for f in findings if f.level == 'ERROR']
    warns = [f for f in findings if f.level == 'WARN']
    L = []
    L.append('SHOOTSCRIPT LINT')
    L.append('source: %s' % source)
    L.append('rules : %s' % RULES_PATH)
    L.append('')
    if not findings:
        L.append('Clean. Nothing on Cari\'s copy breaks her rules.')
    for f in findings:
        where = 'line %-4d' % f.line
        scene = ('setup %-3s' % f.scene) if f.scene else 'before 1 '
        L.append('%-5s %s %s %s' % (f.level, where, scene, f.rule))
        L.append('        %s' % f.text)
        L.append('        -> %s' % f.why)
        L.append('')
    L.append('%d error%s, %d warning%s.'
             % (len(errs), '' if len(errs) == 1 else 's',
                len(warns), '' if len(warns) == 1 else 's'))
    if errs:
        L.append('')
        L.append('ERRORS MUST BE FIXED BEFORE SHE PRINTS IT.')
    return '\n'.join(L) + '\n'
