'use strict';

const fs   = require('fs');
const path = require('path');

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, TableOfContents, LevelFormat,
  Bookmark, VerticalAlign,
} = require('docx');

// ─── DARK THEME COLOR SYSTEM ──────────────────────────────────────────────────
// Matched to 7-Kin-Content-OS-Architecture.docx reference
const TEAL      = '00C4B4';   // main teal — headings, accents, borders
const TEAL_DIM  = '007A6F';   // dim teal for secondary labels
const BG_DEEP   = '0A2E2B';   // deep teal — phase headers, cover, closing panel
const BG_DARK   = '1A1A1A';   // near-black — card backgrounds
const BG_MID    = '222222';   // slightly lighter — alternating table rows
const BG_CODE   = '0D0D0D';   // near-black — code blocks
const BG_DARK_A = '251A06';   // dark amber tint — if/then rows
const BG_DARK_R = '200A0A';   // dark red tint — warning boxes
const WHITE     = 'FFFFFF';   // white — primary headings
const SILVER    = 'D0D0D0';   // light silver — body text
const DIM       = '888888';   // dim gray — captions, URLs, notes
const AMBER     = 'F59E0B';   // amber — if conditions, warnings
const AMBER_HD  = 'B45309';   // dark amber — if/then header
const RED       = 'EF4444';   // red — errors, do-not-do
const RED_HD    = 'B91C1C';   // dark red — warning box header

const OUTPUT = path.join('C:/Users/18054/outputs', 'Kre8r-Production-Runbook-V2.docx');

// ─── PAGE CONSTANTS ────────────────────────────────────────────────────────────
const W  = 9360;  // content width DXA (US Letter, 0.75" margins)
const NO_BORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  insideH: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  insideV: { style: BorderStyle.NONE, size: 0, color: 'auto' },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function sp(n = 1) {
  return Array.from({ length: n }, () =>
    new Paragraph({
      children: [new TextRun('')],
      spacing: { before: 0, after: 0 },
    })
  );
}

/** Teal horizontal rule */
function tealRule() {
  return new Paragraph({
    children: [new TextRun('')],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: TEAL, space: 1 } },
    spacing: { before: 80, after: 200 },
  });
}

/** Dim horizontal rule — between tool sections */
function dimRule() {
  return new Paragraph({
    children: [new TextRun('')],
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: '333333', space: 1 } },
    spacing: { before: 200, after: 160 },
  });
}

/** Full-width single-cell table with no borders — used for cover + phase headers */
function panel(bgColor, marginTB, marginLR, children) {
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [W],
    borders: NO_BORDER,
    rows: [new TableRow({ children: [new TableCell({
      width: { size: W, type: WidthType.DXA },
      shading: { fill: bgColor, type: ShadingType.CLEAR },
      margins: { top: marginTB, bottom: marginTB, left: marginLR, right: marginLR },
      borders: NO_BORDER,
      children,
    })]})],
  });
}

// ─── COVER ────────────────────────────────────────────────────────────────────
function coverHeader() {
  return panel(BG_DEEP, 560, 440, [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'KRE8', font: 'Arial', size: 88, bold: true, color: WHITE }),
                 new TextRun({ text: 'Ω', font: 'Arial', size: 88, bold: true, color: TEAL }),
                 new TextRun({ text: 'R', font: 'Arial', size: 88, bold: true, color: WHITE })],
      spacing: { before: 0, after: 80 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: 'PRODUCTION RUNBOOK V2',
        font: 'Arial', size: 32, bold: true, color: TEAL, characterSpacing: 120,
      })],
      spacing: { before: 0, after: 100 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: 'Plan it.  Make it.  Distribute it.  MirrΩr it.',
        font: 'Arial', size: 22, color: SILVER, italics: true,
      })],
      spacing: { before: 0, after: 60 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' }),
        font: 'Arial', size: 20, color: DIM,
      })],
      spacing: { before: 0, after: 0 },
    }),
  ]);
}

// ─── PHASE HEADER ─────────────────────────────────────────────────────────────
function phaseHeader(phase, title, philosophy) {
  return [
    new Paragraph({ children: [new PageBreak()] }),
    panel(BG_DEEP, 280, 360, [
      new Paragraph({
        children: [new TextRun({
          text: '── ' + phase.toUpperCase() + ' ──',
          font: 'Arial', size: 18, bold: true, color: TEAL, characterSpacing: 120,
        })],
        spacing: { before: 0, after: 60 },
      }),
      new Paragraph({
        children: [new TextRun({ text: title, font: 'Arial', size: 42, bold: true, color: WHITE })],
        spacing: { before: 0, after: 0 },
      }),
    ]),
    new Paragraph({
      children: [new TextRun({ text: philosophy, font: 'Arial', size: 22, color: SILVER, italics: true })],
      spacing: { before: 200, after: 200 },
      indent: { left: 360, right: 360 },
      border: { left: { style: BorderStyle.SINGLE, size: 8, color: TEAL, space: 4 } },
    }),
    tealRule(),
  ];
}

// ─── TOOL SECTION ─────────────────────────────────────────────────────────────
function toolSection(icon, name, url, whatItDoes, whatItFrees, bullets, ifThens, note) {
  const parts = [];

  // ── Tool heading ─────────────────────────────────────────────────────────
  parts.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new Bookmark({ id: name.replace(/[^a-zA-Z]/g, ''), children: [
        new TextRun({ text: icon + '  ' + name, font: 'Arial', size: 34, bold: true, color: TEAL }),
      ]})],
      spacing: { before: 320, after: 60 },
    }),
    new Paragraph({
      children: [new TextRun({ text: url, font: 'Courier New', size: 20, color: DIM })],
      spacing: { before: 0, after: 160 },
    }),
  );

  // ── WHAT IT DOES ─────────────────────────────────────────────────────────
  parts.push(
    new Paragraph({
      children: [new TextRun({
        text: 'WHAT IT DOES',
        font: 'Arial', size: 17, bold: true, color: TEAL, characterSpacing: 100,
      })],
      spacing: { before: 0, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: '333333', space: 2 } },
    }),
    new Paragraph({
      children: [new TextRun({ text: whatItDoes, font: 'Arial', size: 22, color: SILVER })],
      spacing: { before: 120, after: 180 },
    }),
  );

  // ── WHAT IT FREES YOU TO DO ───────────────────────────────────────────────
  parts.push(
    new Table({
      width: { size: W, type: WidthType.DXA },
      columnWidths: [W],
      borders: NO_BORDER,
      rows: [new TableRow({ children: [new TableCell({
        width: { size: W, type: WidthType.DXA },
        shading: { fill: BG_DARK, type: ShadingType.CLEAR },
        margins: { top: 160, bottom: 160, left: 240, right: 240 },
        borders: {
          left: { style: BorderStyle.SINGLE, size: 14, color: TEAL },
          top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
          bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
          right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        },
        children: [
          new Paragraph({
            children: [new TextRun({
              text: 'WHAT IT FREES YOU TO DO',
              font: 'Arial', size: 16, bold: true, color: TEAL, characterSpacing: 80,
            })],
            spacing: { before: 0, after: 80 },
          }),
          new Paragraph({
            children: [new TextRun({ text: whatItFrees, font: 'Arial', size: 22, color: SILVER, italics: true })],
            spacing: { before: 0, after: 0 },
          }),
        ],
      })]})],
    }),
  );

  // ── QUICK START bullets ───────────────────────────────────────────────────
  if (bullets && bullets.length) {
    parts.push(...sp(1));
    parts.push(new Paragraph({
      children: [new TextRun({
        text: 'QUICK START',
        font: 'Arial', size: 17, bold: true, color: TEAL, characterSpacing: 100,
      })],
      spacing: { before: 0, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: '333333', space: 2 } },
    }));
    bullets.forEach(b => {
      parts.push(new Paragraph({
        numbering: { reference: 'bullets', level: 0 },
        children: [typeof b === 'string'
          ? new TextRun({ text: b, font: 'Arial', size: 21, color: SILVER })
          : b],
        spacing: { before: 40, after: 40 },
      }));
    });
  }

  // ── IF/THEN table ─────────────────────────────────────────────────────────
  if (ifThens && ifThens.length) {
    parts.push(...sp(1));
    const headerRow = new TableRow({ tableHeader: true, children: [
      new TableCell({
        width: { size: 3600, type: WidthType.DXA },
        shading: { fill: BG_DEEP, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        borders: { right: { style: BorderStyle.SINGLE, size: 2, color: '003D35' }, top: { style: BorderStyle.NONE, size: 0, color: 'auto' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' }, left: { style: BorderStyle.NONE, size: 0, color: 'auto' } },
        children: [new Paragraph({ children: [new TextRun({ text: 'IF…', font: 'Arial', size: 18, bold: true, color: TEAL, characterSpacing: 80 })] })],
      }),
      new TableCell({
        width: { size: 5760, type: WidthType.DXA },
        shading: { fill: BG_DEEP, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        borders: { top: { style: BorderStyle.NONE, size: 0, color: 'auto' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' }, left: { style: BorderStyle.NONE, size: 0, color: 'auto' }, right: { style: BorderStyle.NONE, size: 0, color: 'auto' } },
        children: [new Paragraph({ children: [new TextRun({ text: 'THEN…', font: 'Arial', size: 18, bold: true, color: TEAL, characterSpacing: 80 })] })],
      }),
    ]});

    const dataRows = ifThens.map(([cond, action], i) => new TableRow({ children: [
      new TableCell({
        width: { size: 3600, type: WidthType.DXA },
        shading: { fill: i % 2 === 0 ? BG_DARK : BG_MID, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        borders: { right: { style: BorderStyle.SINGLE, size: 2, color: '333333' }, top: { style: BorderStyle.NONE, size: 0, color: 'auto' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' }, left: { style: BorderStyle.NONE, size: 0, color: 'auto' } },
        children: [new Paragraph({ children: [new TextRun({ text: cond, font: 'Arial', size: 20, color: AMBER, bold: true })] })],
      }),
      new TableCell({
        width: { size: 5760, type: WidthType.DXA },
        shading: { fill: i % 2 === 0 ? BG_DARK : BG_MID, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        borders: { top: { style: BorderStyle.NONE, size: 0, color: 'auto' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' }, left: { style: BorderStyle.NONE, size: 0, color: 'auto' }, right: { style: BorderStyle.NONE, size: 0, color: 'auto' } },
        children: [new Paragraph({ children: [new TextRun({ text: action, font: 'Arial', size: 20, color: SILVER })] })],
      }),
    ]}));

    parts.push(new Table({
      width: { size: W, type: WidthType.DXA },
      columnWidths: [3600, 5760],
      borders: NO_BORDER,
      rows: [headerRow, ...dataRows],
    }));
  }

  // ── Note ─────────────────────────────────────────────────────────────────
  if (note) {
    parts.push(...sp(1),
      new Paragraph({
        children: [new TextRun({ text: 'ⓘ  ' + note, font: 'Arial', size: 19, color: DIM, italics: true })],
        spacing: { before: 60, after: 60 },
        indent: { left: 200 },
      })
    );
  }

  // ── Screenshot placeholder ────────────────────────────────────────────────
  parts.push(
    ...sp(1),
    new Table({
      width: { size: W, type: WidthType.DXA },
      columnWidths: [W],
      borders: NO_BORDER,
      rows: [new TableRow({ children: [new TableCell({
        width: { size: W, type: WidthType.DXA },
        shading: { fill: BG_DARK, type: ShadingType.CLEAR },
        margins: { top: 200, bottom: 200, left: 200, right: 200 },
        verticalAlign: VerticalAlign.CENTER,
        borders: {
          top: { style: BorderStyle.DASHED, size: 2, color: '3A3A3A' },
          bottom: { style: BorderStyle.DASHED, size: 2, color: '3A3A3A' },
          left: { style: BorderStyle.DASHED, size: 2, color: '3A3A3A' },
          right: { style: BorderStyle.DASHED, size: 2, color: '3A3A3A' },
        },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '[  SCREENSHOT: ' + name + '  ]', font: 'Arial', size: 19, color: '444444', italics: true })],
        })],
      })]})],
    }),
    ...sp(1),
    dimRule(),
  );

  return parts;
}

// ─── DARK BOX ─────────────────────────────────────────────────────────────────
function darkBox(bgColor, borderColor, accentColor, labelText, lines) {
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [W],
    borders: NO_BORDER,
    rows: [new TableRow({ children: [new TableCell({
      width: { size: W, type: WidthType.DXA },
      shading: { fill: bgColor, type: ShadingType.CLEAR },
      margins: { top: 180, bottom: 180, left: 240, right: 240 },
      borders: {
        left: { style: BorderStyle.SINGLE, size: 14, color: borderColor },
        top: { style: BorderStyle.SINGLE, size: 3, color: borderColor },
        bottom: { style: BorderStyle.SINGLE, size: 3, color: borderColor },
        right: { style: BorderStyle.SINGLE, size: 3, color: borderColor },
      },
      children: [
        new Paragraph({
          children: [new TextRun({ text: labelText, font: 'Arial', size: 18, bold: true, color: accentColor, characterSpacing: 80 })],
          spacing: { before: 0, after: 100 },
        }),
        ...lines.map(line => new Paragraph({
          numbering: { reference: 'bullets', level: 0 },
          children: [new TextRun({ text: line, font: 'Arial', size: 21, color: SILVER })],
          spacing: { before: 40, after: 40 },
        })),
      ],
    })]})],
  });
}

// ─── CODE BOX ────────────────────────────────────────────────────────────────
function codeBox(lines) {
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [W],
    borders: NO_BORDER,
    rows: [new TableRow({ children: [new TableCell({
      width: { size: W, type: WidthType.DXA },
      shading: { fill: BG_CODE, type: ShadingType.CLEAR },
      margins: { top: 180, bottom: 180, left: 240, right: 240 },
      borders: {
        left: { style: BorderStyle.SINGLE, size: 10, color: TEAL },
        top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      },
      children: lines.map(line => new Paragraph({
        children: [new TextRun({ text: line || ' ', font: 'Courier New', size: 19, color: line ? TEAL : DIM })],
        spacing: { before: 20, after: 20 },
      })),
    })]})],
  });
}

// ─── BODY TEXT HELPERS ────────────────────────────────────────────────────────
function body(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Arial', size: 22, color: opts.color || SILVER, bold: !!opts.bold, italics: !!opts.italic })],
    spacing: { before: opts.before || 0, after: opts.after || 100 },
    indent: opts.indent ? { left: opts.indent } : undefined,
  });
}

function sectionLabel(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Arial', size: 17, bold: true, color: TEAL, characterSpacing: 100 })],
    spacing: { before: 0, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: '333333', space: 2 } },
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// BUILD DOCUMENT CONTENT
// ══════════════════════════════════════════════════════════════════════════════
const children = [

  // ── COVER ──────────────────────────────────────────────────────────────────
  coverHeader(),
  ...sp(3),

  // ── MANIFESTO ──────────────────────────────────────────────────────────────
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new Bookmark({ id: 'manifesto', children: [
      new TextRun({ text: 'The Manifesto', font: 'Arial', bold: true }),
    ]})],
    spacing: { before: 240, after: 160 },
  }),
  panel(BG_DEEP, 360, 440, [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: 'Kre8Ωr exists because creative people spend too much time on things that aren\'t creative. It handles the research, the structure, the blank page, the distribution, the analysis — so you can spend your time on the thing nobody else can do: being you, on camera, telling your story. The tool is the support structure. You are the art.',
        font: 'Arial', size: 24, color: SILVER, italics: true,
      })],
    }),
  ]),
  ...sp(1),
  tealRule(),

  // ── TOOL PHILOSOPHY ────────────────────────────────────────────────────────
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new Bookmark({ id: 'philosophy', children: [
      new TextRun({ text: 'Tool Philosophy', font: 'Arial', bold: true }),
    ]})],
    spacing: { before: 240, after: 160 },
  }),
  body('Every tool in Kre8Ωr has two parts:', { bold: true, color: WHITE, after: 120 }),
  new Paragraph({
    numbering: { reference: 'numbers', level: 0 },
    children: [new TextRun({ text: 'What it does technically', font: 'Arial', size: 22, color: SILVER })],
    spacing: { before: 40, after: 40 },
  }),
  new Paragraph({
    numbering: { reference: 'numbers', level: 0 },
    children: [new TextRun({ text: 'What it frees you to do creatively', font: 'Arial', size: 22, color: SILVER })],
    spacing: { before: 40, after: 120 },
  }),
  body('The technical description tells you what buttons to push. The creative description is the reason the tool exists. Read both.', { italic: true, after: 200 }),
  tealRule(),

  // ── TOC ────────────────────────────────────────────────────────────────────
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: 'Table of Contents', font: 'Arial', bold: true })],
    spacing: { before: 0, after: 200 },
  }),
  new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }),
  new Paragraph({ children: [new PageBreak()] }),

  // ══════════════════════════════════════════════════════════════════════════
  // FOUNDATION — SOUL BUILDΩR
  // ══════════════════════════════════════════════════════════════════════════
  ...phaseHeader('FOUNDATION', 'Soul BuildΩr', 'Before the machine can work for you, it needs to know you. Not your handle or your niche — you. Your voice, your audience, your creative identity. Soul BuildΩr is the first fifteen minutes you spend with Kre8Ωr. Every tool after this runs on what you give it here.'),
  ...toolSection(
    '✨', 'Soul BuildΩr', '/soul-buildr.html',
    '15-minute onboarding wizard that learns your voice, audience, and creative identity. Generates creator-profile.json — the soul file that powers every other tool in the pipeline. First-run mode walks through 5 screens: Who You Are, Your Voice, Your Audience, Your Content, Your Setup. Update mode detects an existing profile and lets you update specific sections without rebuilding from scratch.',
    'Every tool in Kre8Ωr feels like it was built for you — because after Soul BuildΩr, it was. WritΩr writes in your voice. Id8Ωr research is filtered through your content angles. The machine is calibrated to you specifically before you touch anything else.',
    [
      'Screens: Manifesto → Who You Are → Your Voice (writing samples + tone slider) → Your Audience → Your Content → Your Setup → Generation',
      'Voice samples: paste 2–3 real captions, scripts, or emails. Claude reads your actual words.',
      'Update mode: returns existing users to update only what changed — voice, audience, content, setup, or MirrΩr intelligence',
      'Add Collaborator →: 3-screen sub-wizard builds a collaborator soul file. Plugs into WritΩr for multi-voice scripts.',
      'Export Soul 📤: downloads creator-soul-name.kre8r — portable soul file. Import Collaborator Soul 📥 accepts them.',
      'Generation is SSE-streamed — you watch Claude build the file in real time',
      'On completion: creator-profile.json is written and "Enter Kre8Ωr →" redirects to Id8Ωr',
    ],
    [
      ['Profile already exists', 'Update mode shows automatically — pick which section to refresh'],
      ['Generation error', 'Check your ANTHROPIC_API_KEY is set in .env'],
      ['Want to add Cari\'s voice', 'Add Collaborator in update mode — WritΩr auto-detects her soul file'],
    ],
    'The ✨ badge appears in nav until Soul BuildΩr is complete. It disappears once creator-profile.json exists.',
  ),

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 1 — PRE-PRODUCTION
  // ══════════════════════════════════════════════════════════════════════════
  ...phaseHeader('PHASE 1', 'Pre-Production', 'The work before the work. Research, structure, and script — handled before you ever pick up a camera. Pre-production is where most creators lose. They improvise what should be planned, and then wonder why the edit is hard.'),

  ...toolSection(
    '💡', 'Id8Ωr', '/id8r.html',
    'AI-powered concept generator. Researches your niche, finds content gaps, and generates 3 concept options — 2 from your established content angles and 1 novel Claude-invented angle (marked ✨ NEW ANGLE). Runs 3-phase deep research including competitor analysis, comment mining, and trend scanning. Builds a complete vision brief: 3 titles, 3 hooks, 3 thumbnail concepts, talking points, story entry point recommendation, and guardrails for what not to say.',
    'Instead of staring at a blank page wondering what to make next, Id8Ωr does the research so you can focus on picking the idea that excites you most. That excitement is the creative act. The research was never the creative part — finding the thing worth making is.',
    [
      'Mode: Shape It (guide Claude with a rough idea), Find It (browse your angles), Deep Dive (full research pass)',
      'Research runs in 3 phases with 120s between phases to respect rate limits',
      'Click "Send to PipΩr →" after Vision Brief is generated — arrives pre-filled',
      'If you already have a concept → skip Id8Ωr and go directly to PipΩr',
      'If you have footage already → choose Vault First entry point in PipΩr',
    ],
    [
      ['Project not appearing in PipΩr', 'Go back and click "Send to PipΩr" — it creates the project record'],
      ['Research phase hangs', 'Rate limit hit — wait 2 minutes, then retry from Phase 2'],
      ['Rate limit error', 'Wait 120s between research phases — this is expected behavior'],
    ],
    'Session data is stored in sessionStorage — closing the tab loses your research. Send to PipΩr before closing.',
  ),

  ...toolSection(
    '🗺️', 'PipΩr', '/pipr.html',
    'Story structure builder. Takes your concept and maps it to a proven narrative framework — Save the Cat, Story Circle, VSL Arc, or Free Form. Generates a beat map: the skeleton of your video broken into named beats with shot types, emotional functions, and duration targets. This beat map drives WritΩr, DirectΩr, EditΩr, and ComposΩr downstream. WHO\'S IN THIS VIDEO? section shows collaborator checkboxes when soul files exist — pre-checks primary creator, lets you add Cari or other collaborators to the project.',
    'Structure isn\'t the enemy of creativity — it\'s the container that holds it. PipΩr builds the architecture so you can fill it with your actual experience, your actual voice, your actual moments. The beats are a map, not a script. You still decide what happens inside each one.',
    [
      'Entry points: Script First, Shoot First, Hybrid, Vault First',
      'Arrives from Id8Ωr pre-filled — teal arrival banner confirms the handoff',
      'Story structures: Save the Cat (3-act with 15 beats), Story Circle (8 beats), VSL Arc (sales video), Free Form (custom)',
      'WHO\'S IN THIS VIDEO?: checkboxes appear when collaborator soul files exist. Primary pre-checked.',
      'Beat map is saved to database/projects/{id}/project-config.json',
      'Mark PipΩr complete before proceeding — WritΩr requires a complete beat map',
    ],
    [
      ['Project not in WritΩr dropdown', 'Complete PipΩr and mark it done first'],
      ['Arriving from Id8Ωr', 'Screen 0 (concept select) is skipped automatically'],
      ['Want to change structure mid-script', 'Reset PipΩr from the header menu — clears beat map only'],
    ],
    null,
  ),

  ...toolSection(
    '✍️', 'WritΩr', '/writr.html',
    'Script generator in your actual voice. Reads your beat map, Id8Ωr research brief, creator-profile.json voice analysis, and approved style. Simultaneously generates three versions: Full Script, Bullet Points, and Hybrid. If the project has collaborators (set in PipΩr), WritΩr loads each collaborator soul file and generates a multi-voice script — each beat labeled [JASON] or [CARI] in their own voice, not homogenized. Voice blend slider adjusts tone. Beat cards show emotional functions.',
    'The blank page is where creativity goes to die. WritΩr eliminates the blank page. What you get back is a starting point written in your voice — something to react to, improve, make your own. On collaborative projects, Cari\'s beats sound like Cari. The AI knows who\'s speaking.',
    [
      'Voice blend slider: 0 = raw Jason, 10 = polished production — start at 3',
      'Beat cards show emotional_function descriptions from your story structure',
      'Multi-voice: if project has collaborators, each beat gets a [SPEAKER] label — [JASON] or [CARI]',
      'Content intelligence from MirrΩr is automatically injected into the generation prompt',
      'Approve the script before continuing — GateΩr requires an approved WritΩr script',
      'All 3 modes generate simultaneously — switch tabs without re-generating',
    ],
    [
      ['Network error mid-generation', 'Click Retry — do NOT refresh the page'],
      ['Script feels off-voice', 'Adjust voice slider left and regenerate — or paste a new writing sample in Soul BuildΩr'],
      ['Project not in dropdown', 'Go to PipΩr and complete the beat map first'],
      ['Multi-voice not activating', 'Add collaborators to project via WHO\'S IN THIS VIDEO? in PipΩr'],
    ],
    'The Retry button uses cached prompt context — refreshing the page loses it.',
  ),

  ...toolSection(
    '🎬', 'DirectΩr', '/director.html',
    'Converts your PipΩr beat map into a production shot list. Each beat becomes a set of shots — talking head, b-roll suggestions, cutaways — based on your story structure and entry point. When an approved script with [JASON] / [CARI] speaker labels exists, speaker badges appear on each shot card: [J] in teal for Jason, [C] in amber for Cari. Generates a professional crew brief PDF. Creates an offline ShootDay package (QR code) for day-of reference.',
    'On shoot day your only job is to be present and perform. DirectΩr already handled the planning. Shot cards now show who speaks each beat — Cari sees her shots, you see yours, no confusion on a 2-person shoot.',
    [
      '"📱 Send to ShootDay →" generates offline package accessible via QR code',
      '"📄 Download PDF" generates crew brief',
      'Speaker badges: [J] teal = Jason, [C] amber = Cari — populated from approved script labels',
      'Amber warning banner appears if project title has no number — data shows numbered titles outperform',
    ],
    [
      ['Amber title warning appears', 'Consider adding a dollar amount, day count, or quantity to the title'],
      ['Speaker badges not showing', 'Approve a WritΩr script with collaborators first — labels auto-parsed from [JASON]/[CARI] markers'],
      ['PDF not generating', 'Check browser print dialog — PDF uses browser print-to-PDF'],
    ],
    null,
  ),

  ...toolSection(
    '📋', 'ShootDay', '/shootday.html',
    'Mobile-first shoot day tracker. Shows beat cards with shot types, talking head prompts, reality notes, and coverage status. Speaker badges [J] and [C] appear on beat cards when a multi-voice script exists — so everyone on set knows whose beat it is. Offline-capable — loads on Cari\'s phone via QR code without needing the Kre8Ωr server to be running.',
    'You stay in creative/performance mode. The machine tracks whether you got the shot. Speaker badges mean Cari knows which beats are hers without asking.',
    [
      'Swipe right = Good take | Swipe left = Skip | Tap = details',
      'Tabs: Shots · WritΩr Script · Review · Settings',
      'Beat progress shown at top — green = covered, gray = pending',
      'Speaker badge [J]/[C] on each beat card — parsed from approved script labels',
      'Works offline — designed to load once via QR then function without connection',
    ],
    [
      ['ShootDay not loading on phone', 'Must be on same WiFi as Kre8Ωr server, or load while connected then go offline'],
      ['Beat marks not saving', 'Marks save locally to phone — they sync back to server when reconnected'],
      ['No speaker badges showing', 'Badges appear after a script with [JASON]/[CARI] labels is approved in WritΩr'],
    ],
    null,
  ),

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 2 — PRODUCTION
  // ══════════════════════════════════════════════════════════════════════════
  ...phaseHeader('PHASE 2', 'Production', 'You\'re on camera. This is the only part of the pipeline Kre8Ωr can\'t do for you — and the only part it would never try. Everything before this was preparation. Everything after this is refinement. Right now you just need to be present.'),

  ...toolSection(
    '📺', 'TeleprΩmpter', '/teleprompter.html',
    '3-device professional teleprompter system. The display device shows the script in large scrolling text. The control device (second phone or tablet) lets Cari adjust speed and position remotely. The voice device (third device) uses microphone input to automatically adjust scroll speed to match your speaking pace.',
    'A teleprompter doesn\'t make you less authentic — it makes sure your best thinking makes it to camera. The spontaneous moments still happen. You just don\'t lose your train of thought in the middle of an important point. The script is a net, not a leash.',
    [
      'Setup: QR codes appear on setup screen for Voice and Control device deep-links (?mode=voice, ?mode=control)',
      'Session code required on voice device load — generated fresh each session',
      'Mirror mode: flip horizontally for half-mirror teleprompter setups',
      'No navigation bar on this page — intentionally distraction-free for use on set',
    ],
    [
      ['Voice sync not working', 'Allow microphone permissions on voice device — check browser settings'],
      ['Speed feels off', 'Switch to manual control mode on the control device — override voice sync'],
    ],
    'TeleprΩmpter is intentionally nav-free. Use your browser\'s back button to leave.',
  ),

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 3 — POST-PRODUCTION
  // ══════════════════════════════════════════════════════════════════════════
  ...phaseHeader('PHASE 3', 'Post-Production', 'The footage exists. Now the work is finding the performance inside it, assembling it into something that flows, and giving it the music and texture that makes it feel like a production. Kre8Ωr handles the cataloging, the selects logic, and the music generation. The creative calls are still yours.'),

  ...toolSection(
    '🗄️', 'VaultΩr', '/vault.html',
    'Footage intelligence database. Watches D:\\kre8r\\intake for new files and auto-processes them on arrival. Classifies shot types via Claude Vision (talking-head, b-roll, action, dialogue, completed-video, unusable). BRAW proxy workflow: drop BRAW file in intake, DaVinci exports proxy, proxy links back to BRAW record via _proxy.mp4 naming convention.',
    'Every moment you captured is preserved and searchable. Your creative gold doesn\'t get buried in a hard drive. The clip of Cari\'s reaction when the solar first worked — VaultΩr remembers it even when you don\'t. Years from now you can search "solar" and find it.',
    [
      'Drop footage in D:\\kre8r\\intake — watcher auto-detects within 30 seconds',
      'DaVinci Resolve must be OPEN for BRAW proxy generation via Python API',
      'BRAW proxy naming: original.braw → original_proxy.mp4 (auto-linked)',
      'Voice analysis button on completed-video cards → feeds WritΩr voice library',
      'Shot types: talking-head, b-roll, action, dialogue, completed-video, unusable',
      'Footage linked to projects via the project selector on each clip card',
    ],
    [
      ['VaultΩr not detecting footage', 'Verify watcher started on D:/kre8r/intake in startup log'],
      ['BRAW proxy fails', 'Open DaVinci Resolve first — Python API requires Resolve running'],
      ['BRAW proxy timeout', 'Large files may exceed 30min — restart proxy job from the clip card'],
      ['Shot type classified wrong', 'Edit manually from the clip card — classification is a starting point'],
    ],
    'Raw footage and proxies live on D:\\ (Big Ol\' Storage Drive). Never write footage to C:\\ — limited space.',
  ),

  ...toolSection(
    '✂️', 'EditΩr', '/editor.html',
    'AI selects builder — SelectsΩr v2 engine. Reads your approved WritΩr script and the VaultΩr footage assigned to the project. Classifies clips by shot type and routes them to the correct selection logic based on your shoot mode (SCRIPTED, HYBRID, FREEFORM). Suggests which clips cover which script beats. Transcribes talking-head clips via local Whisper.',
    'The rough assembly work happens automatically. You make the creative calls on what stays. EditΩr narrows 3 hours of footage down to a stack of selects — you decide the order, the pacing, the moments that matter.',
    [
      'Shoot modes: SCRIPTED (script-first matching), HYBRID (partial script), FREEFORM (b-roll driven)',
      'Requires: approved WritΩr script + VaultΩr footage assigned to project',
      'Transcription via local Whisper — proxy_path must be set on clips before transcription',
      'Accepts talking-head and talking_head (both formats normalized at intake)',
    ],
    [
      ['No footage appearing', 'Assign footage to project from VaultΩr first'],
      ['Transcription not running', 'Check proxy_path is set on clip — edit from VaultΩr clip card'],
      ['WritΩr script not loading', 'Approve the script in WritΩr before opening EditΩr'],
    ],
    null,
  ),

  ...toolSection(
    '👁️', 'ReviewΩr', '/reviewr.html',
    'Rough cut approval interface. Review the assembled selects from EditΩr, approve or request changes before moving to distribution. Single clear decision: does this cut work?',
    'One clear decision point — does this cut work? Yes or no. No context switching, no tool-hopping. ReviewΩr is the creative checkpoint before the machine handles the rest.',
    [],
    [
      ['Cut feels wrong', 'Return to EditΩr and adjust clip selection — ReviewΩr feedback routes back'],
    ],
    null,
  ),

  ...toolSection(
    '🎵', 'ComposΩr', '/composor.html',
    'Scene analysis and music generation. Analyzes your cut for emotional beats and pacing. Writes Suno-formatted music prompts (200 character limit for optimal results). Generates music via kie.ai API when credits are available, or provides prompts for manual Suno workflow. Pushes selected tracks to DaVinci Resolve 04_AUDIO timeline at scene positions, normalized to -6dB.',
    'Music sets the emotional temperature of a scene. ComposΩr handles the search, the prompt writing, and the placement — so you can focus on whether the edit feels right emotionally. The question you\'re answering is "does this feel like what I intended?" not "how do I write a Suno prompt."',
    [
      'Chrome automation (AutomatΩr connected): "Generate All in Suno" button appears',
      'No API credits: copy prompts manually to suno.com/create',
      'DaVinci must be OPEN with your project loaded to push audio timeline',
      '"Push to DaVinci →" creates 04_AUDIO timeline with tracks at scene positions at -6dB',
      'Suno prompt limit: 200 characters — ComposΩr respects this automatically',
    ],
    [
      ['kie.ai 402 error', 'No credits remaining — use manual Suno workflow'],
      ['kie.ai 429 error', 'Rate limited — wait 60 seconds and retry'],
      ['DaVinci push fails', 'Ensure DaVinci is open and the correct project is loaded'],
      ['ComposΩr spinning/stalled', 'State may be stalled — refresh ComposΩr and regenerate from the last scene'],
    ],
    null,
  ),

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 4 — DISTRIBUTION
  // ══════════════════════════════════════════════════════════════════════════
  ...phaseHeader('PHASE 4', 'Distribution', 'The video is done. Now it needs to reach people. Distribution used to mean 2 hours of copy-paste context-switching across five platforms. In Kre8Ωr it means making four decisions and clicking approve. The machine handles the rest.'),

  ...toolSection(
    '🔒', 'GateΩr', '/m1-approval-dashboard.html',
    'Final content approval dashboard — Gate A. Review everything before it goes out: the selected package (title, hook, thumbnail concept, description), the script, all captions, all emails. Single approval action unlocks the downstream distribution tools.',
    'One place to confirm everything is right before the world sees it. GateΩr is the pause between creation and publication — the moment where you decide this is what you want to put out. That decision is always yours.',
    [
      'Requires approved WritΩr script and at least one package from PackageΩr',
      'Gate A approval unlocks PackageΩr, CaptionΩr, and MailΩr for this project',
    ],
    [
      ['GateΩr shows no projects', 'Approve the WritΩr script first — GateΩr requires script approval'],
    ],
    null,
  ),

  ...toolSection(
    '📦', 'PackageΩr', '/m2-package-generator.html',
    'Generates YouTube titles, descriptions, tags, and thumbnail text from your approved script and creator profile. Produces 3 package options with different title angles — emotional, curiosity, or keyword-led. You pick one, it locks in as your publishing package.',
    'No more staring at the description box. The copy is done. PackageΩr gives you three options because the best title for a video isn\'t always obvious until you see alternatives side by side.',
    [],
    [
      ['Generated titles feel generic', 'Check Soul BuildΩr voice profile — run with fresh writing samples'],
    ],
    null,
  ),

  ...toolSection(
    '💬', 'CaptionΩr', '/m3-caption-generator.html',
    'Platform-optimized captions for TikTok, YouTube Shorts, Instagram, Lemon8, and Facebook. Each platform gets the right length, format, and hashtag strategy based on your approved package and creator profile. TikTok gets punchy and mobile-first. YouTube gets keyword-rich. Lemon8 gets visual and lifestyle-oriented.',
    'One video, five platform captions, zero copy-paste thinking. CaptionΩr means you never again write "check out my new video" because you ran out of time to write something better.',
    [
      'All 5 platforms generated simultaneously — switch tabs without re-generating',
      'Hashtags auto-populated based on platform norms and your content pillars from Soul BuildΩr',
    ],
    [],
    null,
  ),

  ...toolSection(
    '📧', 'MailΩr', '/mailor.html',
    'Email broadcast and blog post generator. Reads your project context automatically — approved script, package title, hook — and generates in your voice for your community tiers. Voice blend slider available. Generates A/B subject line variants. Blog post mode creates a long-form article version of your video for SEO.',
    'Publishing a video used to mean 2 hours of context-switching: write the email, write the blog, post to the community. MailΩr keeps you in creative mode — the writing is done, you just review and approve.',
    [
      'Kajabi connection banner shows API connection status',
      'Blog + community post checkboxes control what gets generated alongside the email',
      'Voice blend slider adjusts email tone — lower for more personal/raw, higher for polished',
      'A/B subject line testing built in — pick the winner after 4 hours',
      'Project context auto-injected if approved script exists — no copy-paste needed',
    ],
    [
      ['Kajabi connection error', 'Check OAuth2 credentials in .env — re-authenticate from AudiencΩr'],
      ['Project not loading context', 'Approve script in WritΩr first — MailΩr requires approval'],
    ],
    'Kajabi broadcasts must be sent manually via copy-paste — Kajabi API has no broadcast endpoint yet.',
  ),

  ...toolSection(
    '🤖', 'AutomatΩr', '/automator.html',
    'Playwright browser automation. Connects to your live Chrome session via remote debugging. Sends Kajabi broadcasts, community posts, and email sequences automatically. Finds and fills forms, navigates Kajabi admin, and submits without you touching the keyboard.',
    'The distribution happens while you\'re already on to the next creative thing. AutomatΩr is the final step where the machine actually does the sending — not just the writing.',
    [
      'Chrome must be running with --remote-debugging-port=9222',
      'Click "Connect Chrome →" before any automation tasks',
      'Always Preview before sending to full list — check the actual email/post looks right',
      'Community posts: AutomatΩr navigates to Kajabi community and posts on your behalf',
    ],
    [
      ['Chrome not connecting', 'Close Chrome completely, relaunch with: chrome.exe --remote-debugging-port=9222'],
      ['AutomatΩr finds wrong page', 'Check you\'re logged into the right Kajabi account before connecting'],
      ['Automation fails mid-task', 'Do not retry automatically — check Kajabi to see what completed before retrying'],
    ],
    'Always preview before sending to your full list. AutomatΩr can send to real members — verify the content first.',
  ),

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 5 — LEARN
  // ══════════════════════════════════════════════════════════════════════════
  ...phaseHeader('PHASE 5', 'Learn — MirrΩr', 'The best coaches don\'t tell you who to be — they show you who you already are at your best. MirrΩr shows you the patterns in your own work that you can\'t see from inside it. Two hundred and sixty videos later, the data knows things about your channel that you don\'t. Then you decide what to do with that information.'),

  ...toolSection(
    '🔭', 'MirrΩr', '/mirrr.html',
    'Channel intelligence system. Imports your entire YouTube history via YouTube Data API. Displays your Content Universe as a 3D stellar constellation — each video is a star, plotted by content cluster (theme/longitude), view performance (stellar class/color), and altitude above or below the sphere surface. Generates coaching reports, niche definitions, audience profiles, and content secrets. Thumbnail A/B testing via Claude Vision. Two-pass Claude clustering classifies all 260+ videos into thematic groups. Secrets surface non-obvious patterns in your catalog and can be saved to Soul BuildΩr — injected into future Id8Ωr concepts automatically.',
    'The best analysis isn\'t telling you what to make — it\'s showing you what already works and why. MirrΩr is the feedback loop between your past content and your next idea. The stellar map makes abstract performance data feel visceral: a cluster of blue supergiants in a corner of the sphere is a content territory you haven\'t fully mined yet.',
    [
      'Stellar classification: O (blue, viral 10x+), B (blue-white, 5-10x), A (white, 2-5x), G (yellow, avg), M (red, low performer)',
      'Node position: longitude = content cluster, altitude = performance above/below channel average',
      'Glow halos appear on Class A/B/O videos — the bright spots are where to go next',
      'Shorts hidden by default — toggle "Show Shorts" to include them in the universe',
      '"Discover Secrets →" runs content secrets analysis — unlocks every 10 new long-form videos',
      '"Save Insights to My Soul →" writes secrets to creator-profile.json — feeds Id8Ωr',
      'Thumbnail A/B: paste two thumbnail concepts, Claude Vision scores both',
      'Coaching report: full channel audit with 90-day action plan in your voice',
    ],
    [
      ['Universe shows 265 projects in pipeline', 'Pipeline filter fixed — YouTube imports excluded from all tool dropdowns'],
      ['Secrets gate locked', 'Gate unlocks every 10 new long-form videos — use Force Refresh to override'],
      ['Import guard active', 'Channel already imported — use Sync YouTube Data to update stats'],
      ['Niche label not appearing', 'Run Content DNA first — niche is generated during cluster analysis'],
    ],
    'MirrΩr is the only tool that reads ALL projects including YouTube imports. Every other tool is filtered to native Kre8Ωr projects only.',
  ),

  // ══════════════════════════════════════════════════════════════════════════
  // FILE PATHS
  // ══════════════════════════════════════════════════════════════════════════
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new Bookmark({ id: 'filepaths', children: [
      new TextRun({ text: 'File Paths & Where Everything Lives', font: 'Arial', bold: true }),
    ]})],
    spacing: { before: 0, after: 200 },
  }),
  codeBox([
    'Footage Intake:        D:\\kre8r\\intake',
    'Proxy Files:           D:\\kre8r\\proxy',
    'Music Files:           [app]\\public\\music\\{project_id}\\',
    'Beat Maps:             [app]\\database\\projects\\{project_id}\\project-config.json',
    'Creator Soul File:     [app]\\creator-profile.json',
    'Collaborator Souls:    [app]\\creator-profile-{slug}.json',
    'Database:              [app]\\database\\kre8r.db',
    'All Scripts/Captions:  Stored in SQLite database (not filesystem)',
    'Id8Ωr Research:        Stored in database as id8r_data JSON (saved at Send to PipΩr)',
    '',
    'NOTE: Raw research links from Id8Ωr session are NOT permanently saved.',
    'Only the synthesized Vision Brief is preserved.',
  ]),
  ...sp(1),
  sectionLabel('STORAGE RULES'),
  new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { before: 40, after: 40 },
    children: [new TextRun({ text: 'D:\\ (Big Ol\' Storage Drive) — all footage, proxies, and VaultΩr paths point here', font: 'Arial', size: 21, color: SILVER })] }),
  new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { before: 40, after: 40 },
    children: [new TextRun({ text: 'C:\\ (main drive) — limited space. NEVER write footage or proxies here', font: 'Arial', size: 21, color: RED, bold: true })] }),
  new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { before: 40, after: 40 },
    children: [new TextRun({ text: 'H:\\ (camera SSD) — Blackmagic BRAW files land here after shoot, then moved to D:\\', font: 'Arial', size: 21, color: SILVER })] }),

  // ══════════════════════════════════════════════════════════════════════════
  // DAVINCI PIPELINE
  // ══════════════════════════════════════════════════════════════════════════
  ...sp(1),
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new Bookmark({ id: 'davinci', children: [
      new TextRun({ text: 'DaVinci Integration', font: 'Arial', bold: true }),
    ]})],
    spacing: { before: 240, after: 160 },
  }),
  body('DaVinci Resolve Studio 20.3.2.9 must be RUNNING before any DaVinci API calls. Kre8Ωr communicates via Python scripting API on port 9237, Local mode, Windows only.', { after: 160 }),
  new Paragraph({
    children: [new TextRun({ text: 'TRIGGER 1 — BRAW Proxy (VaultΩr)', font: 'Arial', size: 22, bold: true, color: TEAL })],
    spacing: { before: 0, after: 80 },
  }),
  ...[
    'Open DaVinci Resolve',
    'Drop .braw file in D:\\kre8r\\intake — VaultΩr watcher auto-detects',
    'VaultΩr calls DaVinci Python API → proxy generated → linked in database',
    'Proxy naming: original.braw → original_proxy.mp4 (auto-linked via findBrawByBasename)',
  ].map(t => new Paragraph({ numbering: { reference: 'numbers', level: 0 }, spacing: { before: 40, after: 40 },
    children: [new TextRun({ text: t, font: 'Arial', size: 21, color: SILVER })] })),
  ...sp(1),
  new Paragraph({
    children: [new TextRun({ text: 'TRIGGER 2 — Audio Timeline (ComposΩr)', font: 'Arial', size: 22, bold: true, color: TEAL })],
    spacing: { before: 0, after: 80 },
  }),
  ...[
    'Open DaVinci Resolve with your project loaded',
    'In ComposΩr, select tracks for each scene and click "Push to DaVinci →"',
    'Creates 04_AUDIO timeline with selected music tracks at scene positions at -6dB',
  ].map(t => new Paragraph({ numbering: { reference: 'numbers', level: 0 }, spacing: { before: 40, after: 40 },
    children: [new TextRun({ text: t, font: 'Arial', size: 21, color: SILVER })] })),
  ...sp(1),
  darkBox(BG_DARK_R, RED, RED, '⚠  WHAT KRE8ΩR DOES NOT DO IN DAVINCI', [
    'Does not create video timelines',
    'Does not place footage or clips',
    'Does not export or render video',
    'The edit is yours — DaVinci integration is audio placement only',
  ]),

  // ══════════════════════════════════════════════════════════════════════════
  // COMMON MISTAKES
  // ══════════════════════════════════════════════════════════════════════════
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new Bookmark({ id: 'mistakes', children: [
      new TextRun({ text: 'Common Mistakes', font: 'Arial', bold: true }),
    ]})],
    spacing: { before: 0, after: 200 },
  }),
  darkBox(BG_DARK_R, RED, RED, '⚠  DO NOT DO THESE THINGS', [
    'Starting WritΩr before PipΩr is complete — WritΩr requires a beat map',
    'Running AutomatΩr without Chrome connected first — connect before any task',
    'Dropping footage in the wrong folder — must be D:\\kre8r\\intake not C:\\',
    'Forgetting to Approve script in WritΩr before going to GateΩr',
    'Clicking "Send to PipΩr" before the Vision Brief is generated in Id8Ωr',
    'Refreshing the page during WritΩr generation — click Retry instead',
    'Editing the .db file directly with sqlite3 CLI while the server is running',
    'Writing footage or proxies to C:\\ — limited space, will fill the drive',
  ]),

  // ══════════════════════════════════════════════════════════════════════════
  // IF/THEN GUIDE
  // ══════════════════════════════════════════════════════════════════════════
  ...sp(1),
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new Bookmark({ id: 'ifthen', children: [
      new TextRun({ text: 'If / Then Decision Guide', font: 'Arial', bold: true }),
    ]})],
    spacing: { before: 240, after: 200 },
  }),
  new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [4200, 5160],
    borders: NO_BORDER,
    rows: [
      new TableRow({ tableHeader: true, children: [
        new TableCell({ width: { size: 4200, type: WidthType.DXA }, shading: { fill: BG_DEEP, type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 160, right: 160 },
          borders: { right: { style: BorderStyle.SINGLE, size: 2, color: '003D35' }, top: { style: BorderStyle.NONE, size: 0, color: 'auto' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' }, left: { style: BorderStyle.NONE, size: 0, color: 'auto' } },
          children: [new Paragraph({ children: [new TextRun({ text: 'IF THIS HAPPENS…', font: 'Arial', size: 18, bold: true, color: TEAL, characterSpacing: 60 })] })] }),
        new TableCell({ width: { size: 5160, type: WidthType.DXA }, shading: { fill: BG_DEEP, type: ShadingType.CLEAR }, margins: { top: 100, bottom: 100, left: 160, right: 160 },
          borders: { top: { style: BorderStyle.NONE, size: 0, color: 'auto' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' }, left: { style: BorderStyle.NONE, size: 0, color: 'auto' }, right: { style: BorderStyle.NONE, size: 0, color: 'auto' } },
          children: [new Paragraph({ children: [new TextRun({ text: 'DO THIS', font: 'Arial', size: 18, bold: true, color: TEAL, characterSpacing: 60 })] })] }),
      ]}),
      ...[
        ['Project not in WritΩr dropdown', 'Complete PipΩr beat map and mark it done first'],
        ['WritΩr network error', 'Click Retry — do NOT refresh the page'],
        ['AutomatΩr can\'t find Chrome', 'Close Chrome, relaunch with --remote-debugging-port=9222'],
        ['ComposΩr spinning with no result', 'State may be stalled — refresh and regenerate from last scene'],
        ['VaultΩr not detecting footage', 'Verify startup log shows "Watching: D:/kre8r/intake"'],
        ['Suno automation fails', 'Use manual copy/paste workflow — copy prompts to suno.com/create'],
        ['Pipeline shows 260+ projects', 'Those are YouTube imports from MirrΩr — fixed in this build'],
        ['BRAW proxy fails or times out', 'Ensure DaVinci is open — large files may need job restarted'],
        ['Secrets gate locked in MirrΩr', 'Gate requires 10 new long-form videos — use Force Refresh to override'],
        ['Nav shows ✨ badge on Soul BuildΩr', 'Soul BuildΩr not yet complete — run it to configure creator profile'],
        ['Id8Ωr research hangs between phases', 'Wait 120 seconds — rate limit between phases is intentional'],
        ['DaVinci audio push fails', 'Open DaVinci and load the correct project before pushing from ComposΩr'],
      ].map(([cond, action], i) => new TableRow({ children: [
        new TableCell({ width: { size: 4200, type: WidthType.DXA }, shading: { fill: i % 2 === 0 ? BG_DARK : BG_MID, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 160, right: 160 },
          borders: { right: { style: BorderStyle.SINGLE, size: 2, color: '333333' }, top: { style: BorderStyle.NONE, size: 0, color: 'auto' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' }, left: { style: BorderStyle.NONE, size: 0, color: 'auto' } },
          children: [new Paragraph({ children: [new TextRun({ text: cond, font: 'Arial', size: 20, bold: true, color: AMBER })] })] }),
        new TableCell({ width: { size: 5160, type: WidthType.DXA }, shading: { fill: i % 2 === 0 ? BG_DARK : BG_MID, type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 160, right: 160 },
          borders: { top: { style: BorderStyle.NONE, size: 0, color: 'auto' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' }, left: { style: BorderStyle.NONE, size: 0, color: 'auto' }, right: { style: BorderStyle.NONE, size: 0, color: 'auto' } },
          children: [new Paragraph({ children: [new TextRun({ text: action, font: 'Arial', size: 20, color: SILVER })] })] }),
      ]})),
    ],
  }),

  // ══════════════════════════════════════════════════════════════════════════
  // CLOSING PANEL
  // ══════════════════════════════════════════════════════════════════════════
  new Paragraph({ children: [new PageBreak()] }),
  panel(BG_DEEP, 560, 480, [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'The tool is the support structure.', font: 'Arial', size: 36, color: WHITE, bold: true })],
      spacing: { after: 120 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'You are the ', font: 'Arial', size: 52, color: WHITE, bold: true }),
        new TextRun({ text: 'art', font: 'Arial', size: 52, color: TEAL, bold: true }),
        new TextRun({ text: '.', font: 'Arial', size: 52, color: WHITE, bold: true }),
      ],
      spacing: { after: 200 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: 'Kre8Ωr\'s job is to make sure the support structure never gets in the way of the art.',
        font: 'Arial', size: 24, color: SILVER, italics: true,
      })],
      spacing: { after: 120 },
    }),
  ]),
  ...sp(2),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({ text: 'SINE ', font: 'Arial', size: 20, color: DIM, characterSpacing: 200 }),
      new TextRun({ text: 'RESIST', font: 'Arial', size: 20, color: TEAL, characterSpacing: 200 }),
      new TextRun({ text: 'ENTIA', font: 'Arial', size: 20, color: DIM, characterSpacing: 200 }),
    ],
  }),
];

// ─── DOCUMENT ─────────────────────────────────────────────────────────────────
const doc = new Document({
  background: { color: '111111' },
  styles: {
    default: {
      document: { run: { font: 'Arial', size: 22, color: SILVER } },
    },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 40, bold: true, font: 'Arial', color: WHITE },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Arial', color: TEAL },
        paragraph: { spacing: { before: 280, after: 100 }, outlineLevel: 1 },
      },
      {
        id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial', color: WHITE },
        paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 2 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '▸',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 480, hanging: 240 } },
                   run: { font: 'Arial', size: 22, color: TEAL } } }],
      },
      {
        reference: 'numbers',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 480, hanging: 240 } },
                   run: { font: 'Arial', size: 22, color: TEAL } } }],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          children: [
            new TextRun({ text: 'KRE8ΩR', font: 'Arial', size: 16, color: TEAL, bold: true }),
            new TextRun({ text: '  PRODUCTION RUNBOOK V2', font: 'Arial', size: 16, color: DIM }),
            new TextRun({ text: '\t', font: 'Arial', size: 16 }),
            new TextRun({ text: 'SINE RESISTENTIA', font: 'Arial', size: 16, color: DIM, italics: true }),
          ],
          tabStops: [{ type: 'right', position: 8280 }],
          border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: TEAL, space: 1 } },
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          children: [
            new TextRun({ text: 'kre8r.app', font: 'Arial', size: 16, color: TEAL }),
            new TextRun({ text: '  —  Plan it. Make it. Distribute it. MirrΩr it.', font: 'Arial', size: 16, color: DIM }),
            new TextRun({ text: '\t', font: 'Arial', size: 16 }),
            new TextRun({ text: 'Page ', font: 'Arial', size: 16, color: DIM }),
            new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 16, color: TEAL }),
          ],
          tabStops: [{ type: 'right', position: 8280 }],
          border: { top: { style: BorderStyle.SINGLE, size: 3, color: TEAL, space: 1 } },
        })],
      }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUTPUT, buf);
  console.log('✓ Runbook written to:', OUTPUT);
  console.log('  Size:', (buf.length / 1024).toFixed(1), 'KB');
}).catch(err => {
  console.error('✗ Failed:', err.message);
  process.exit(1);
});
