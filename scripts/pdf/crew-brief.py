#!/usr/bin/env python3
"""
Crew Brief PDF Generator — Kre8r
Reads project data as JSON from stdin, writes PDF bytes to stdout.
Usage: python crew-brief.py < data.json > output.pdf
"""

import sys
import json
import io

try:
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import inch
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
    from reportlab.lib.colors import HexColor, white, black
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer,
        Table, TableStyle, KeepTogether
    )
except ImportError:
    sys.stderr.write('[crew-brief] ERROR: reportlab not installed. Run: pip install reportlab\n')
    sys.exit(2)


# ── PALETTE (matches director.html dark theme) ──────────────────────
C_BG     = HexColor('#0e0f0e')
C_TEAL   = HexColor('#3ecfb2')
C_AMBER  = HexColor('#f0b942')
C_GREEN  = HexColor('#5cba8a')
C_DIM    = HexColor('#8a9487')
C_BORDER = HexColor('#d0d8d0')
C_CARD   = HexColor('#f7f9f7')
C_HDR_SUB= HexColor('#9ab0a8')

PAGE_W, PAGE_H = letter
MARGIN = 0.75 * inch


def S(name, **kw):
    return ParagraphStyle(name, **kw)


STYLES = {
    'title':    S('title',    fontName='Helvetica-Bold', fontSize=26, textColor=white,            leading=30),
    'hdr_sub':  S('hdr_sub',  fontName='Helvetica',      fontSize=10, textColor=C_HDR_SUB,        leading=14),
    'sec':      S('sec',      fontName='Helvetica-Bold', fontSize=8,  textColor=C_TEAL,           leading=10,
                              spaceBefore=14, spaceAfter=6),
    'concept':  S('concept',  fontName='Helvetica',      fontSize=11, textColor=HexColor('#222'),  leading=17),
    'meta_lbl': S('meta_lbl', fontName='Helvetica-Bold', fontSize=9,  textColor=HexColor('#666'),  leading=12),
    'meta_val': S('meta_val', fontName='Helvetica',      fontSize=10, textColor=HexColor('#111'),  leading=14),
    'beat_idx': S('beat_idx', fontName='Helvetica-Bold', fontSize=9,  textColor=HexColor('#999'),  leading=11),
    'beat_name':S('beat_name',fontName='Helvetica-Bold', fontSize=13, textColor=HexColor('#111'),  leading=16),
    'beat_fn':  S('beat_fn',  fontName='Helvetica-Oblique', fontSize=10, textColor=HexColor('#666'), leading=13),
    'beat_note':S('beat_note',fontName='Helvetica',      fontSize=10, textColor=HexColor('#444'),  leading=14),
    'th_label': S('th_label', fontName='Helvetica-Bold', fontSize=8,  textColor=C_TEAL,           leading=10),
    'th_text':  S('th_text',  fontName='Helvetica-Oblique', fontSize=11, textColor=HexColor('#1a6a5a'), leading=16),
    'km_name':  S('km_name',  fontName='Helvetica-Bold', fontSize=11, textColor=HexColor('#111'),  leading=14),
    'km_th':    S('km_th',    fontName='Helvetica-Oblique', fontSize=10, textColor=HexColor('#1a6a5a'), leading=14),
    'footer':   S('footer',   fontName='Helvetica',      fontSize=8,  textColor=HexColor('#888'),  leading=10,
                              alignment=TA_CENTER),
}

SHOT_TYPES = {
    'talking_head': ('TALKING HEAD', HexColor('#d8f0eb'), HexColor('#0a5a4a')),
    'broll':        ('B-ROLL',       HexColor('#f0f0d4'), HexColor('#5a5a0a')),
    'action':       ('ACTION',       HexColor('#f0d8d8'), HexColor('#6a1a1a')),
}


def shot_badge(shot_type, w):
    label, bg, fg = SHOT_TYPES.get(shot_type, SHOT_TYPES['talking_head'])
    p = Paragraph(label, ParagraphStyle('sb', fontName='Helvetica-Bold', fontSize=7, textColor=fg, leading=9))
    t = Table([[p]], colWidths=[w])
    t.setStyle(TableStyle([
        ('BACKGROUND',    (0, 0), (-1, -1), bg),
        ('TOPPADDING',    (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING',   (0, 0), (-1, -1), 7),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 7),
        ('ALIGN',         (0, 0), (-1, -1), 'CENTER'),
    ]))
    return t


def thin_line(w):
    """Horizontal rule as a minimal table row."""
    t = Table([['']], colWidths=[w])
    t.setStyle(TableStyle([
        ('LINEABOVE',     (0, 0), (-1, -1), 0.5, C_BORDER),
        ('TOPPADDING',    (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ('LEFTPADDING',   (0, 0), (-1, -1), 0),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 0),
    ]))
    return t


def build_beat_card(beat, card_w):
    """
    card_w = full column width for the outer card table.
    Padding inside card = 14pt left/right, so inner content = card_w - 28pt.
    """
    pad    = 14
    inner  = card_w - 2 * pad

    idx       = beat.get('index', 0)
    name      = beat.get('name', f'Beat {idx}')
    ef        = (beat.get('emotional_function') or '').strip()
    reality   = (beat.get('reality_note') or beat.get('notes') or '').strip()
    th        = (beat.get('talking_head_prompt') or '').strip()
    shot_type = beat.get('shot_type') or 'talking_head'
    if th:
        shot_type = 'talking_head'

    badge_w = 0.95 * inch
    num_w   = inner - badge_w - 4   # 4pt gap

    # Row 1: beat number + shot type badge
    top = Table(
        [[Paragraph(f'BEAT {str(idx).zfill(2)}', STYLES['beat_idx']),
          shot_badge(shot_type, badge_w)]],
        colWidths=[num_w, badge_w],
    )
    top.setStyle(TableStyle([
        ('LEFTPADDING',   (0, 0), (-1, -1), 0),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 0),
        ('TOPPADDING',    (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN',         (1, 0), (1,  0),  'RIGHT'),
    ]))

    # Assemble content rows
    rows = [
        [top],
        [Paragraph(name, STYLES['beat_name'])],
    ]
    if ef:
        rows.append([Paragraph(ef, STYLES['beat_fn'])])
    if reality:
        rows.append([Spacer(1, 2)])
        rows.append([Paragraph(reality, STYLES['beat_note'])])

    if th:
        th_content = Table(
            [[Paragraph('SAY TO CAMERA', STYLES['th_label'])],
             [Paragraph(f'"{th}"',        STYLES['th_text'])]],
            colWidths=[inner - 20],   # 10pt left/right padding inside TH box
        )
        th_content.setStyle(TableStyle([
            ('LEFTPADDING',   (0, 0), (-1, -1), 0),
            ('RIGHTPADDING',  (0, 0), (-1, -1), 0),
            ('TOPPADDING',    (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (0,  0),  3),
            ('BOTTOMPADDING', (0, 1), (0,  1),  0),
        ]))
        th_box = Table([[th_content]], colWidths=[inner])
        th_box.setStyle(TableStyle([
            ('BACKGROUND',    (0, 0), (-1, -1), HexColor('#eaf6f3')),
            ('LINEBEFORE',    (0, 0), (0,  -1), 3, C_TEAL),
            ('TOPPADDING',    (0, 0), (-1, -1), 9),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 9),
            ('LEFTPADDING',   (0, 0), (-1, -1), 10),
            ('RIGHTPADDING',  (0, 0), (-1, -1), 10),
        ]))
        rows.append([Spacer(1, 6)])
        rows.append([th_box])

    inner_table = Table(rows, colWidths=[inner])
    inner_table.setStyle(TableStyle([
        ('LEFTPADDING',   (0, 0), (-1, -1), 0),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 0),
        ('TOPPADDING',    (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))

    card = Table([[inner_table]], colWidths=[card_w])
    card.setStyle(TableStyle([
        ('BACKGROUND',    (0, 0), (-1, -1), white),
        ('BOX',           (0, 0), (-1, -1), 1, C_BORDER),
        ('TOPPADDING',    (0, 0), (-1, -1), pad),
        ('BOTTOMPADDING', (0, 0), (-1, -1), pad + 2),
        ('LEFTPADDING',   (0, 0), (-1, -1), pad),
        ('RIGHTPADDING',  (0, 0), (-1, -1), pad),
    ]))
    return card


def build_pdf(data):
    buf = io.BytesIO()

    project = data.get('project', {})
    beats   = data.get('beats', [])
    config  = data.get('config', {})
    date    = data.get('date', '')

    title        = project.get('title') or 'Untitled Project'
    high_concept = (project.get('high_concept') or config.get('high_concept')
                    or project.get('topic') or '').strip()
    structure    = (project.get('story_structure') or config.get('story_structure') or '').strip()
    duration_min = project.get('duration_minutes') or config.get('estimated_duration_minutes')

    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        rightMargin=MARGIN,
        leftMargin=MARGIN,
        topMargin=0.5 * inch,
        bottomMargin=MARGIN,
    )
    doc_w = PAGE_W - 2 * MARGIN   # 504 pt @ 0.75in margins

    story = []

    # ── DARK HEADER ─────────────────────────────────────────────────
    struct_label = structure.replace('_', ' ').upper() if structure else ''
    sub_parts = []
    if struct_label:
        sub_parts.append(struct_label)
    if duration_min:
        sub_parts.append(f'{int(duration_min)} MIN TARGET')
    sub_parts.append(f'CREW BRIEF  {date}')

    hdr_inner = Table(
        [[Paragraph(title, STYLES['title'])],
         [Paragraph('  '.join(sub_parts), STYLES['hdr_sub'])]],
        colWidths=[doc_w - 48],   # doc_w minus left/right pad (24 each)
    )
    hdr_inner.setStyle(TableStyle([
        ('LEFTPADDING',   (0, 0), (-1, -1), 0),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 0),
        ('TOPPADDING',    (0, 0), (0,  0),  0),
        ('BOTTOMPADDING', (0, 0), (0,  0),  6),
        ('TOPPADDING',    (0, 1), (0,  1),  0),
        ('BOTTOMPADDING', (0, 1), (0,  1),  0),
    ]))

    hdr = Table([[hdr_inner]], colWidths=[doc_w])
    hdr.setStyle(TableStyle([
        ('BACKGROUND',    (0, 0), (-1, -1), C_BG),
        ('TOPPADDING',    (0, 0), (-1, -1), 28),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 28),
        ('LEFTPADDING',   (0, 0), (-1, -1), 24),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 24),
    ]))
    story.append(hdr)
    story.append(Spacer(1, 16))

    # ── HIGH CONCEPT ────────────────────────────────────────────────
    if high_concept:
        story.append(Paragraph('HIGH CONCEPT', STYLES['sec']))
        concept_card = Table(
            [[Paragraph(high_concept, STYLES['concept'])]],
            colWidths=[doc_w],
        )
        concept_card.setStyle(TableStyle([
            ('BACKGROUND',    (0, 0), (-1, -1), C_CARD),
            ('BOX',           (0, 0), (-1, -1), 1, C_BORDER),
            ('TOPPADDING',    (0, 0), (-1, -1), 12),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
            ('LEFTPADDING',   (0, 0), (-1, -1), 16),
            ('RIGHTPADDING',  (0, 0), (-1, -1), 16),
        ]))
        story.append(concept_card)
        story.append(Spacer(1, 8))

    # ── PROJECT META ────────────────────────────────────────────────
    th_count = len([b for b in beats if b.get('talking_head_prompt') or b.get('shot_type') == 'talking_head'])
    meta_rows = []
    if struct_label:
        meta_rows.append(('STORY STRUCTURE', struct_label))
    if duration_min:
        meta_rows.append(('TARGET DURATION', f'{int(duration_min)} minutes'))
    meta_rows.append(('TOTAL BEATS',      str(len(beats))))
    meta_rows.append(('TALKING HEAD SHOTS', str(th_count)))

    if meta_rows:
        lbl_w  = 1.7 * inch
        val_w  = doc_w - lbl_w
        m_data = [[Paragraph(lbl, STYLES['meta_lbl']), Paragraph(val, STYLES['meta_val'])]
                  for lbl, val in meta_rows]
        meta_t = Table(m_data, colWidths=[lbl_w, val_w])
        meta_t.setStyle(TableStyle([
            ('TOPPADDING',    (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('LEFTPADDING',   (0, 0), (-1, -1), 0),
            ('RIGHTPADDING',  (0, 0), (-1, -1), 0),
            ('LINEBELOW',     (0, 0), (-1, -2), 0.5, C_BORDER),
            ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        story.append(meta_t)

    # ── BEAT MAP ────────────────────────────────────────────────────
    story.append(Paragraph('BEAT MAP', STYLES['sec']))

    for beat in beats:
        card = build_beat_card(beat, doc_w)
        story.append(KeepTogether([card, Spacer(1, 8)]))

    # ── KEY MOMENTS ─────────────────────────────────────────────────
    key_beats = [b for b in beats if (b.get('talking_head_prompt') or '').strip()]
    if key_beats:
        story.append(Paragraph('KEY MOMENTS  -  TALKING HEAD SHOTS', STYLES['sec']))
        idx_w = 0.45 * inch
        con_w = doc_w - idx_w

        for b in key_beats:
            idx  = b.get('index', '')
            name = b.get('name', '')
            th   = (b.get('talking_head_prompt') or '').strip()

            km = Table(
                [[Paragraph(str(idx).zfill(2),
                            ParagraphStyle('ki', fontName='Helvetica-Bold', fontSize=18,
                                           textColor=C_TEAL, leading=22)),
                  [Paragraph(name, STYLES['km_name']),
                   Spacer(1, 3),
                   Paragraph(f'"{th}"', STYLES['km_th'])]]],
                colWidths=[idx_w, con_w],
            )
            km.setStyle(TableStyle([
                ('BACKGROUND',    (0, 0), (-1, -1), HexColor('#f0faf8')),
                ('BOX',           (0, 0), (-1, -1), 1, HexColor('#c0e0d8')),
                ('TOPPADDING',    (0, 0), (-1, -1), 10),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
                ('LEFTPADDING',   (0, 0), (-1, -1), 14),
                ('RIGHTPADDING',  (0, 0), (-1, -1), 14),
                ('VALIGN',        (0, 0), (-1, -1), 'TOP'),
            ]))
            story.append(km)
            story.append(Spacer(1, 6))

    # ── FOOTER ──────────────────────────────────────────────────────
    story.append(Spacer(1, 16))
    story.append(thin_line(doc_w))
    story.append(Spacer(1, 6))
    story.append(Paragraph(f'Kre8r  -  Crew Brief  -  {title}  -  {date}', STYLES['footer']))

    doc.build(story)
    return buf.getvalue()


if __name__ == '__main__':
    try:
        raw  = sys.stdin.buffer.read()
        data = json.loads(raw)
        pdf_bytes = build_pdf(data)
        sys.stdout.buffer.write(pdf_bytes)
    except Exception as e:
        sys.stderr.write(f'[crew-brief] ERROR: {e}\n')
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
