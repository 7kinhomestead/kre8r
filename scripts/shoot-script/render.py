#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
render.py — ShootScript's printable layouts.

Everything is plain HTML printed by headless Edge (see pdfout.py), so the
typography is Courier and the page is Letter, exactly like the hand-made
EP6-TELFORD-SHOOT-SCRIPT-CARI.html that Cari is shooting from today.

Three layouts of the same script:
  classic  — standard screenplay, one continuous read
  gutter   — screenplay with a left-hand tick-and-setup gutter
  large    — one setup per half page, big type, for reading outdoors in sun

Nothing but the two-line title block appears before scene 1. Notes and boneyard
never reach the shooting copy; the editor's copy shows the notes in red.
"""

import html as htmlmod
import re

import fountain

NOTE_INK = '#9a2617'   # the editor's second colour. Never used on Cari's copy.


def esc(s):
    return htmlmod.escape('' if s is None else str(s), quote=True)


def rich(s):
    """Escape, then honour Fountain emphasis, then keep hard line breaks."""
    s = esc(s)
    s = re.sub(r'\*\*\*(.+?)\*\*\*', r'<b><i>\1</i></b>', s, flags=re.S)
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s, flags=re.S)
    s = re.sub(r'\*(.+?)\*', r'<i>\1</i>', s, flags=re.S)
    s = re.sub(r'_(.+?)_', r'<u>\1</u>', s, flags=re.S)
    return s.replace('\n', '<br/>')


def short_label(heading):
    """'EXT. DRY SLOPE, IN THE SUN — DAY' -> 'DRY SLOPE, IN THE SUN'"""
    h = re.sub(r'^(INT\.?/EXT\.?|INT/EXT|I/E|EXT\.?|INT\.?|EST\.?)\s*', '', heading.strip(), flags=re.I)
    h = re.split(r'\s+[—–-]\s+', h)[0]
    return h.strip(' .')


# ── page shell ────────────────────────────────────────────────────────────────

_SHELL = u"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>%(title)s</title>
<style>
%(css)s
/* the running corner label — a <tfoot> so Chromium repeats it on every page */
.page-frame{width:100%%;border-collapse:collapse}
.page-frame > tbody > tr > td, .page-frame > tfoot > tr > td{padding:0;border:0}
.pagefoot{display:flex;justify-content:space-between;gap:16px;padding-top:8px;
  font:9pt "Courier New",Courier,monospace;color:#555;letter-spacing:.06em}
@media print{html,body{background:#fff}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}
</style></head>
<body><table class="page-frame">
<tfoot><tr><td><div class="pagefoot"><span>%(footl)s</span><span>%(footr)s</span></div></td></tr></tfoot>
<tbody><tr><td>
%(body)s
</td></tr></tbody></table></body></html>"""


def page(title, css, body, foot_left='', foot_right=''):
    return _SHELL % dict(title=esc(title), css=css, body=body,
                         footl=esc(foot_left), footr=esc(foot_right))


# ── plain paper (glossary, survey, the conventions sheet) ─────────────────────

PAPER_CSS = u"""
@page{size:Letter;margin:.7in .75in .6in .75in}
body{font:10.5pt/1.5 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#111;margin:0}
h1{font:700 17pt "Courier New",monospace;margin:0 0 4px;letter-spacing:.01em}
.lede{font-size:11pt;margin:0 0 16px;padding-bottom:10px;border-bottom:2px solid #111}
h2{font:700 11pt "Courier New",monospace;letter-spacing:.14em;text-transform:uppercase;
   margin:20px 0 8px;padding-bottom:4px;border-bottom:1px solid #111;break-after:avoid}
h3{font:700 10.5pt "Courier New",monospace;margin:14px 0 6px;break-after:avoid}
p{margin:0 0 9px}
.defs{display:grid;grid-template-columns:1.85in 1fr;gap:0}
.defs .t{font-weight:700;padding:5px 10px 5px 0;border-bottom:1px dotted #bbb;break-inside:avoid}
.defs .d{padding:5px 0;border-bottom:1px dotted #bbb;break-inside:avoid}
.house{break-inside:avoid;border:1px solid #ccc;border-left:4px solid #111;padding:9px 12px;margin:0 0 9px}
.house .hd{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
.house .term{font:700 12pt "Courier New",monospace}
.house .tag{font:700 8.5pt "Courier New",monospace;letter-spacing:.12em;border:1.5px solid #111;
  padding:2px 7px;white-space:nowrap}
.house .tag.retire{background:#111;color:#fff}
.house .swap{font-size:10pt;margin-top:4px}
.house .swap b{font-family:"Courier New",monospace}
.house .src{font-size:9pt;color:#555;margin-top:4px}
.q{break-inside:avoid;margin:0 0 13px;padding:9px 11px;border:1px solid #bbb}
.q .n{font:700 10pt "Courier New",monospace;letter-spacing:.1em;color:#555}
.q .ask{font-size:11pt;font-weight:600;margin:2px 0 7px}
.opts{display:flex;flex-wrap:wrap;gap:6px 18px;margin-bottom:6px}
.opt{display:flex;align-items:center;gap:7px;font-size:10.5pt}
.opts.col{flex-direction:column;gap:5px}
.bx{display:inline-block;width:13px;height:13px;border:1.5px solid #111;flex:0 0 auto}
.write{border-bottom:1px solid #666;height:17px;margin-top:7px}
.write.tall{height:34px}
.small{font-size:9.5pt;color:#444}
ul{margin:0 0 9px 18px;padding:0}
li{margin-bottom:4px}
code{font-family:"Courier New",monospace;font-size:10pt;background:#f2f2f2;padding:1px 3px}
.two{column-count:2;column-gap:26px}
"""


def paper_html(title, body, foot_left='', foot_right='', extra_css=''):
    return page(title, PAPER_CSS + extra_css, body, foot_left=foot_left, foot_right=foot_right)


#: squeeze a paper document onto fewer sheets without making it unreadable
TIGHT_CSS = u"""
@page{margin:.5in .55in .42in .55in}
body{font-size:9.7pt;line-height:1.38}
h1{font-size:15pt}
.lede{font-size:10pt;margin-bottom:10px;padding-bottom:7px}
h2{font-size:10pt;margin:11px 0 5px}
.q{margin:0 0 7px;padding:6px 9px}
.q .ask{font-size:10.2pt;margin:1px 0 5px}
.opt{font-size:9.6pt}
.opts{gap:4px 14px;margin-bottom:4px}
.opts.col{gap:3px}
.write{height:15px;margin-top:5px}
.write.tall{height:26px}
li{margin-bottom:2px}
ul{margin-bottom:6px}
.small{font-size:9pt}
.defs .t,.defs .d{padding:3px 8px 3px 0}
.house{padding:7px 10px;margin-bottom:7px}
"""


# ── screenplay CSS ────────────────────────────────────────────────────────────

_BASE_CSS = u"""
@page{size:Letter;margin:.6in .7in .55in .7in}
body{font:%(size)s/%(lead)s "Courier New",Courier,monospace;color:#000;margin:0}
h1{font:700 %(h1)s "Courier New",monospace;margin:0 0 2px;letter-spacing:.02em}
.sub{font-size:%(sub)s;margin:0 0 14px;border-bottom:2px solid #000;padding-bottom:6px}
.scene{break-inside:avoid;margin:0 0 %(gap)s}
.slug{font-weight:700;text-transform:uppercase;border-top:1px solid #000;padding-top:8px;margin-bottom:6px}
.lbl{font-weight:700}
.action{margin:4px 0}
.must{margin:6px 0;padding:5px 8px;border:1.5px solid #000}
.char{margin:10px 0 0 2.2in;font-weight:700}
.dial{margin:0 1.2in 0 1.2in}
.dial.brief{border-left:2px solid #bbb;padding-left:10px;margin-left:1.05in}
.paren{margin:0 1.8in 0 1.7in}
.syn{margin:6px 0 6px .35in;padding-left:10px;border-left:3px solid #999;font-style:italic}
.syn b{font-style:normal;letter-spacing:.08em}
.trans{text-align:right;margin:8px 0;font-weight:700}
.ctr{text-align:center;margin:8px 0}
.box{display:inline-block;width:12px;height:12px;border:1.5px solid #000;margin-right:8px;vertical-align:-1px}
.note{color:%(noteink)s;margin:4px 0 4px .2in;font-size:%(notesize)s}
.note b{letter-spacing:.08em}
.pb{break-after:page}
/* trailing setup index */
.index{break-before:page;margin-top:0}
.index h2{font:700 13pt "Courier New",monospace;margin:0 0 10px;border-bottom:2px solid #000;padding-bottom:5px}
.index .row{display:grid;grid-template-columns:.3in .45in 1fr;gap:8px;padding:7px 0;border-bottom:1px dotted #999;break-inside:avoid}
.index .row .n{font-weight:700}
"""

_GUTTER_CSS = u"""
.scene{display:grid;grid-template-columns:1.15in 1fr;gap:0 12px;border-top:1px solid #000;padding-top:8px}
.scene .gut{border-right:1px solid #bbb;padding-right:10px}
.scene .gut .num{font:700 20pt "Courier New",monospace;line-height:1}
.scene .gut .tick{display:block;width:22px;height:22px;border:2px solid #000;margin:6px 0 8px}
.scene .gut .where{font-size:8.5pt;line-height:1.25;text-transform:uppercase}
.slug{border-top:none;padding-top:0}
.char{margin-left:1.6in}
.dial{margin:0 .5in 0 .55in}
.dial.brief{margin-left:.4in}
.paren{margin:0 1.1in 0 1.05in}
"""

_LARGE_CSS = u"""
.scene{min-height:4.15in;border-top:2px solid #000;padding-top:10px;margin-bottom:14px}
.char{margin-left:1.5in}
.dial{margin:0 .45in 0 .5in}
.dial.brief{margin-left:.35in}
.paren{margin:0 1in 0 .95in}
.must{border-width:2px;padding:8px 10px}
"""


def script_css(layout):
    if layout == 'large':
        base = _BASE_CSS % dict(size='15pt', lead='1.5', h1='17pt', sub='11.5pt', gap='16px',
                                noteink=NOTE_INK, notesize='11pt')
        return base + _LARGE_CSS
    if layout == 'gutter':
        base = _BASE_CSS % dict(size='12pt', lead='1.45', h1='15pt', sub='10.5pt', gap='18px',
                                noteink=NOTE_INK, notesize='9.5pt')
        return base + _GUTTER_CSS
    return _BASE_CSS % dict(size='12pt', lead='1.45', h1='15pt', sub='10.5pt', gap='20px',
                            noteink=NOTE_INK, notesize='9.5pt')


# ── the script ────────────────────────────────────────────────────────────────

def _title_lines(script):
    t = script.title
    line1 = t.get('title') or (script.path or 'SHOOT SCRIPT')
    line2 = t.get('shoot') or t.get('subtitle') or ''
    return line1, line2


def _render_elements(els, show_notes, layout):
    """One HTML chunk per element, 1:1 with `els` (a chunk may be '')."""
    out = []
    for el in els:
        h = ''
        if el.type == 'action':
            if el.is_on_camera:
                h = ('<div class="must"><span class="lbl">MUST BE ON CAMERA:</span> %s</div>'
                     % rich(el.on_camera_text))
            else:
                h = '<div class="action">%s</div>' % rich(el.text)
        elif el.type == 'character':
            h = '<div class="char">%s</div>' % rich(el.text)
        elif el.type == 'parenthetical':
            h = '<div class="paren">%s</div>' % rich(el.text)
        elif el.type == 'dialogue':
            h = '<div class="dial">%s</div>' % rich(el.text)
        elif el.type == 'synopsis':
            h = '<div class="syn"><b>EARLIER, ON TAPE:</b> %s</div>' % rich(el.text)
        elif el.type == 'transition':
            h = '<div class="trans">%s</div>' % rich(el.text)
        elif el.type == 'centered':
            h = '<div class="ctr">%s</div>' % rich(el.text)
        elif el.type == 'page_break':
            h = '<div class="pb"></div>'
        if show_notes:
            h += ''.join('<div class="note"><b>NOTE:</b> %s</div>' % rich(nt) for nt in el.notes)
        out.append(h)
    return out


def script_html(script, layout='classic', show_notes=False,
                doc_label='SHOOT SCRIPT', corner='', foot_left='',
                trailing_index=False):
    line1, line2 = _title_lines(script)
    body = ['<h1>%s</h1>' % rich(line1)]
    if line2:
        body.append('<div class="sub">%s</div>' % rich(line2))
    else:
        body.append('<div class="sub">%s</div>' % esc(doc_label))

    pre = script.preamble()
    if pre:
        chunks = _render_elements(pre, show_notes, layout)
        body.extend(chunks)

    for num, head, els in script.scenes():
        chunks = _render_elements(els, show_notes, layout)
        # briefing rule: dialogue under (in his own words) gets a light left rule
        mode = None
        for k, el in enumerate(els):
            if el.type == 'character':
                mode = None
            elif el.type == 'parenthetical':
                mode = el.delivery or mode
            elif el.type == 'dialogue' and mode == 'briefing' and k < len(chunks):
                chunks[k] = chunks[k].replace('class="dial"', 'class="dial brief"', 1)
        slug = '%d. %s' % (num, head.text)
        headnotes = ''
        if show_notes:
            headnotes = ''.join('<div class="note"><b>NOTE:</b> %s</div>' % rich(nt)
                                for nt in head.notes)
        if layout == 'gutter':
            body.append(
                '<div class="scene"><div class="gut"><div class="num">%d</div>'
                '<span class="tick"></span><div class="where">%s</div></div><div class="col">'
                '<div class="slug">%s</div>%s%s</div></div>'
                % (num, esc(short_label(head.text)), rich(head.text), headnotes, ''.join(chunks)))
        else:
            body.append('<div class="scene"><div class="slug"><span class="box"></span>%s</div>%s%s</div>'
                        % (rich(slug), headnotes, ''.join(chunks)))

    if trailing_index:
        rows = []
        for num, head, els in script.scenes():
            what = next((e.on_camera_text for e in els if e.is_on_camera), None)
            if not what:
                what = next((e.text.split('\n')[0] for e in els if e.type == 'action'), '')
            rows.append('<div class="row"><div><span class="box"></span></div>'
                        '<div class="n">%d</div><div><b>%s</b><br/>%s</div></div>'
                        % (num, esc(short_label(head.text)), rich(what)))
        body.append('<div class="index"><h2>EVERY SETUP TODAY — TICK AS YOU GO</h2>%s</div>'
                    % ''.join(rows))

    return page(line1, script_css(layout), '\n'.join(body),
                foot_left=foot_left or doc_label, foot_right=corner)


# ── question cards ────────────────────────────────────────────────────────────

_QCARD_CSS = u"""
@page{size:Letter;margin:.7in}
body{font:16pt/1.45 "Courier New",Courier,monospace;color:#000;margin:0}
h1{font:700 18pt "Courier New",monospace;margin:0 0 4px}
.sub{font-size:12pt;margin:0 0 18px;border-bottom:2px solid #000;padding-bottom:6px}
.q{break-inside:avoid;border:2px solid #000;padding:14px 16px;margin:0 0 16px;min-height:1in}
.q .n{font:700 22pt "Courier New",monospace;float:left;margin:-2px 14px 0 0}
.q .t{overflow:hidden}
.q .where{font-size:11pt;color:#444;margin-top:10px;clear:both;padding-top:8px;border-top:1px dotted #999}
.tick{display:inline-block;width:18px;height:18px;border:2px solid #000;margin-right:10px;vertical-align:-3px}
"""


def question_card_html(script, character='INTERVIEWER', corner='', title=None):
    qs = []
    for b in script.blocks():
        if b['character'] != character.upper():
            continue
        text = ' '.join(fountain.strip_emphasis(t).strip()
                        for kind, t, _d in b['parts'] if kind == 'line')
        if text.strip():
            qs.append((b['scene'], text.strip()))
    line1, line2 = _title_lines(script)
    asker = script.title.get('interviewer') or character.title()
    body = ['<h1>%s</h1>' % rich(title or line1),
            '<div class="sub">QUESTION CARDS &middot; %s asks these &middot; '
            'tick each one off as you get it</div>' % esc(asker)]
    for i, (scene, q) in enumerate(qs, 1):
        body.append('<div class="q"><div class="n">%d</div><div class="t">'
                    '<span class="tick"></span>%s</div>'
                    '<div class="where">setup %s</div></div>'
                    % (i, rich(q), esc(str(scene) if scene else '-')))
    if not qs:
        return None
    return page((title or line1) + ' — questions', _QCARD_CSS, '\n'.join(body),
                foot_left='QUESTION CARDS', foot_right=corner)


# ── sides ─────────────────────────────────────────────────────────────────────

def sides_md(script, character):
    """All of one person's lines, in shooting order, with what kind of line each is."""
    line1, _ = _title_lines(script)
    out = ['# %s — ALL OF %s\'S LINES' % (line1, character.upper()), '',
           '*In shooting order. **Exactly** = say it word for word. '
           '**In his own words** = this is what the chunk is about; say it however it comes out.*',
           '']
    heads = {num: head.text for num, head, _ in script.scenes()}
    seen_scene = None
    found = False
    for b in script.blocks():
        if b['character'] != character.upper():
            continue
        found = True
        if b['scene'] != seen_scene:
            seen_scene = b['scene']
            out.append('')
            out.append('## %s. %s' % (b['scene'], heads.get(b['scene'], '')))
            out.append('')
        mode = None
        for kind, text, delivery in b['parts']:
            if kind == 'paren':
                mode = delivery or mode
                out.append('*%s*' % fountain.strip_emphasis(text).strip('()'))
            else:
                t = fountain.strip_emphasis(text).replace('\n', ' ')
                if mode == 'briefing':
                    out.append('> %s' % t)
                else:
                    out.append('**%s**' % t)
        out.append('')
    if not found:
        out.append('_No lines for %s in this script._' % character.upper())
    return '\n'.join(out).rstrip() + '\n'
