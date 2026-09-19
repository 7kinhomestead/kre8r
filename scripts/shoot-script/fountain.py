#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fountain.py — a small, correct parser for the Fountain subset ShootScript uses.

Fountain (fountain.io) is the open plain-text screenplay standard. We parse only
what a shoot script needs, and we add NO syntax of our own beyond two house
conventions that are pure convention, not grammar:

  * an action line that begins "ON CAMERA:" is the load-bearing direction
    (write it as  !ON CAMERA: the hand picking the rock up  — the ! forces action)
  * a parenthetical containing "exactly" marks a written line; one containing
    "in his own words" marks a briefing.

Supported:
  title page keys (Key: value, indented continuations)
  scene headings  (INT./EXT./EST./I/E prefix, or forced with a leading .)
  action          (default, or forced with a leading !)
  character       (CAPS line after a blank line, or forced with @)
  parenthetical   ((wholly in parens) inside a dialogue block)
  dialogue
  synopsis        (= a plain synopsis of referenced footage — we DO print these)
  section         (# heading — captured, never printed)
  transition      (> TO BLACK, or a CAPS line ending in "TO:")
  centered        (> text <)
  page break      (===)
  notes           ([[ ... ]] — captured, stripped from the shooting copy)
  boneyard        (/* ... */ — deleted outright)

Standard library only. No dependencies, on purpose: this has to still run in
five years on a machine nobody has maintained.
"""

import re

__all__ = ['Element', 'Script', 'parse', 'parse_file', 'strip_emphasis']

# ── element ───────────────────────────────────────────────────────────────────


class Element(object):
    """One parsed chunk. `text` is always note-free and boneyard-free."""

    __slots__ = ('type', 'text', 'notes', 'line', 'block', 'scene')

    def __init__(self, type_, text, line, notes=None, block=None, scene=None):
        self.type = type_          # see TYPES below
        self.text = text
        self.notes = notes or []   # [[notes]] that were written inside this chunk
        self.line = line           # 1-based source line
        self.block = block         # dialogue block id (character/parenthetical/dialogue)
        self.scene = scene         # 1-based shooting-order scene number, None before scene 1

    # -- house conventions ----------------------------------------------------

    @property
    def is_on_camera(self):
        return self.type == 'action' and self.text.upper().startswith('ON CAMERA:')

    @property
    def on_camera_text(self):
        return self.text.split(':', 1)[1].strip() if self.is_on_camera else ''

    @property
    def delivery(self):
        """For a parenthetical: 'briefing', 'exact' or None."""
        if self.type != 'parenthetical':
            return None
        low = self.text.lower()
        if 'in his own words' in low or 'in her own words' in low or 'own words' in low:
            return 'briefing'
        if 'exactly' in low or 'verbatim' in low or 'word for word' in low:
            return 'exact'
        return None

    def __repr__(self):
        return 'Element(%s, %r, line=%d)' % (self.type, self.text[:40], self.line)


TYPES = ('scene_heading', 'action', 'character', 'parenthetical', 'dialogue',
         'synopsis', 'section', 'transition', 'centered', 'page_break', 'note_only')

#: types that appear on Cari's printed shooting copy
PRINTED = ('scene_heading', 'action', 'character', 'parenthetical', 'dialogue',
           'synopsis', 'transition', 'centered')


class Script(object):
    def __init__(self, title, elements, path=None):
        self.title = title        # OrderedDict-ish plain dict of title page keys (lowercased)
        self.elements = elements
        self.path = path

    # -- views ----------------------------------------------------------------

    def scenes(self):
        """[(number, heading_element, [elements...])] in shooting order."""
        out, cur = [], None
        for el in self.elements:
            if el.type == 'scene_heading':
                cur = (el.scene, el, [])
                out.append(cur)
            elif cur is not None:
                cur[2].append(el)
        return out

    def preamble(self):
        """Everything before the first scene heading (should be nothing)."""
        out = []
        for el in self.elements:
            if el.type == 'scene_heading':
                break
            out.append(el)
        return out

    def blocks(self):
        """Dialogue blocks: [{'character','cue','scene','parts':[(delivery,text)...],'line'}]."""
        out, by_id = [], {}
        for el in self.elements:
            if el.type == 'character':
                blk = {'character': character_name(el.text), 'cue': el.text,
                       'scene': el.scene, 'parts': [], 'line': el.line, 'notes': list(el.notes)}
                by_id[el.block] = blk
                out.append(blk)
            elif el.type in ('parenthetical', 'dialogue'):
                blk = by_id.get(el.block)
                if blk is None:
                    continue
                if el.type == 'parenthetical':
                    blk['parts'].append(('paren', el.text, el.delivery))
                else:
                    blk['parts'].append(('line', el.text, None))
                blk['notes'].extend(el.notes)
        return out

    def characters(self):
        seen, out = set(), []
        for b in self.blocks():
            if b['character'] not in seen:
                seen.add(b['character'])
                out.append(b['character'])
        return out

    def all_notes(self):
        return [(el.line, n) for el in self.elements for n in el.notes]


def character_name(cue):
    """JASON (V.O.) -> JASON ;  JASON ^ -> JASON"""
    name = re.sub(r'\s*\([^)]*\)\s*$', '', cue.strip())
    name = name.rstrip('^').strip()
    return name.upper()


# ── lexing helpers ────────────────────────────────────────────────────────────

_BONEYARD = re.compile(r'/\*.*?\*/', re.S)
_NOTE = re.compile(r'\[\[(.*?)\]\]', re.S)
_NOTE_TOKEN = re.compile('\x00N(\\d+)\x00')

_SCENE = re.compile(r'^(INT\.?/EXT\.?|INT/EXT|I/E|EXT\.?|INT\.?|EST\.?)([\s.].*)?$', re.I)
_CHAR = re.compile(r"^[A-Z][A-Z0-9 .,'\-&]*(\s*\([^)]*\))?\s*\^?$")
_TRANS = re.compile(r'^[A-Z0-9 \'\-]+ TO:$')
_TITLE_KEY = re.compile(r'^([A-Za-z][A-Za-z0-9 _-]*):\s*(.*)$')

#: keys we accept on a title page. Fountain allows any key; this list only decides
#: whether the FIRST line of a file starts a title page at all.
TITLE_KEYS = ('title', 'shoot', 'credit', 'author', 'authors', 'source', 'episode',
              'draft date', 'date', 'contact', 'notes', 'copyright', 'series',
              'crew', 'location', 'subtitle',
              # house keys the library reads out of the manifest
              'shoot-type', 'shoot type', 'shoot-date', 'shoot date', 'interviewer')


def _blank(s):
    return s.strip() == ''


def strip_emphasis(s):
    """Fountain emphasis markers out, for plain-text sides."""
    s = re.sub(r'\*\*\*(.+?)\*\*\*', r'\1', s, flags=re.S)
    s = re.sub(r'\*\*(.+?)\*\*', r'\1', s, flags=re.S)
    s = re.sub(r'\*(.+?)\*', r'\1', s, flags=re.S)
    s = re.sub(r'_(.+?)_', r'\1', s, flags=re.S)
    return s


# ── parser ────────────────────────────────────────────────────────────────────

def parse(text, path=None):
    text = text.replace('\r\n', '\n').replace('\r', '\n').replace('\t', '    ')

    # 1. boneyard: gone, but keep the line count honest
    text = _BONEYARD.sub(lambda m: '\n' * m.group(0).count('\n'), text)

    # 2. notes: lifted out, replaced by a token, line count preserved
    notes = []

    def _take(m):
        notes.append(m.group(1).strip())
        return '\x00N%d\x00' % (len(notes) - 1) + '\n' * m.group(0).count('\n')

    text = _NOTE.sub(_take, text)

    lines = text.split('\n')
    i, n = 0, len(lines)

    # 3. title page
    title = {}
    first = next((k for k in range(n) if not _blank(lines[k])), None)
    if first is not None:
        m = _TITLE_KEY.match(lines[first].strip())
        if m and m.group(1).strip().lower() in TITLE_KEYS:
            i = first
            key = None
            while i < n:
                raw = lines[i]
                if _blank(raw):
                    # a blank line ends the title page
                    i += 1
                    break
                m = _TITLE_KEY.match(raw.strip())
                if m and not raw.startswith((' ', '\t')):
                    key = m.group(1).strip().lower()
                    title[key] = m.group(2).strip()
                elif key:
                    title[key] = (title[key] + ' ' + raw.strip()).strip()
                i += 1

    # 4. body
    els = []
    block_id = 0
    scene_no = 0
    prev_blank = True

    def push(type_, text_, line_no, block=None):
        els.append(Element(type_, text_, line_no, block=block))

    while i < n:
        raw = lines[i]
        line_no = i + 1
        s = raw.strip()

        if _blank(s):
            prev_blank = True
            i += 1
            continue

        nxt = lines[i + 1] if i + 1 < n else ''
        nxt_blank = _blank(nxt)

        # page break
        if re.match(r'^=\s*=\s*=+\s*$', s):
            push('page_break', '', line_no)
            prev_blank = False
            i += 1
            continue

        # synopsis
        if s.startswith('=') and not s.startswith('=='):
            push('synopsis', s[1:].strip(), line_no)
            prev_blank = False
            i += 1
            continue

        # section
        if s.startswith('#'):
            push('section', s.lstrip('#').strip(), line_no)
            prev_blank = False
            i += 1
            continue

        # forced scene heading
        if s.startswith('.') and not s.startswith('..'):
            scene_no += 1
            push('scene_heading', s[1:].strip(), line_no)
            els[-1].scene = scene_no
            prev_blank = False
            i += 1
            continue

        # forced action
        if s.startswith('!'):
            body = [s[1:]]
            j = i + 1
            while j < n and not _blank(lines[j]) and not lines[j].strip().startswith(('!', '@', '=', '#')):
                body.append(lines[j].strip())
                j += 1
            push('action', '\n'.join(body).strip(), line_no)
            i = j
            prev_blank = False
            continue

        # forced character
        if s.startswith('@'):
            block_id += 1
            push('character', s[1:].strip(), line_no, block=block_id)
            i += 1
            prev_blank = False
            continue

        # centered
        if s.startswith('>') and s.endswith('<'):
            push('centered', s[1:-1].strip(), line_no)
            i += 1
            prev_blank = False
            continue

        # transition
        if s.startswith('>'):
            push('transition', s[1:].strip(), line_no)
            i += 1
            prev_blank = False
            continue

        # scene heading
        if prev_blank and _SCENE.match(s):
            scene_no += 1
            push('scene_heading', s, line_no)
            els[-1].scene = scene_no
            i += 1
            prev_blank = False
            continue

        # inside a dialogue block?
        in_dialogue = bool(els) and els[-1].type in ('character', 'parenthetical', 'dialogue') \
            and not prev_blank

        if in_dialogue:
            if s.startswith('(') and s.endswith(')'):
                push('parenthetical', s, line_no, block=block_id)
                i += 1
                continue
            body = [s]
            j = i + 1
            while j < n and not _blank(lines[j]) and not lines[j].strip().startswith('('):
                body.append(lines[j].strip())
                j += 1
            push('dialogue', '\n'.join(body), line_no, block=block_id)
            i = j
            continue

        # character cue
        if prev_blank and not nxt_blank and _CHAR.match(s) and re.search(r'[A-Z]', s) \
                and not _TRANS.match(s) and len(s) <= 60:
            block_id += 1
            push('character', s, line_no, block=block_id)
            i += 1
            prev_blank = False
            continue

        # unforced transition (SMASH CUT TO:)
        if prev_blank and nxt_blank and _TRANS.match(s):
            push('transition', s, line_no)
            i += 1
            prev_blank = False
            continue

        # action (default) — consume the run of non-blank lines
        body = [s]
        j = i + 1
        while j < n and not _blank(lines[j]) and not lines[j].strip().startswith(('!', '@', '=', '#', '>')) \
                and not _SCENE.match(lines[j].strip()):
            body.append(lines[j].strip())
            j += 1
        push('action', '\n'.join(body), line_no)
        i = j
        prev_blank = False

    # 5. pull the notes back out of the element text, tag scene numbers
    scene_no = 0
    out = []
    for el in els:
        found = _NOTE_TOKEN.findall(el.text)
        if found:
            el.notes = [notes[int(k)] for k in found]
            el.text = _NOTE_TOKEN.sub('', el.text)
            el.text = re.sub(r'[ \t]+\n', '\n', el.text)
            el.text = re.sub(r'\n{2,}', '\n', el.text).strip()
            el.text = re.sub(r'  +', ' ', el.text).strip()
            if not el.text:
                el.type = 'note_only'
        if el.type == 'scene_heading':
            scene_no += 1
            el.scene = scene_no
        else:
            el.scene = scene_no or None
        out.append(el)

    # title-page notes (a [[note]] written into a title value) — rare, but don't leak it
    for k, v in list(title.items()):
        found = _NOTE_TOKEN.findall(v)
        if found:
            title[k] = _NOTE_TOKEN.sub('', v).strip()

    return Script(title, out, path=path)


def parse_file(path):
    import io
    with io.open(path, encoding='utf-8') as f:
        return parse(f.read(), path=path)
