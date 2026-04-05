'use strict';

const fs = require('fs');
const path = require('path');

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageNumberElement, SimpleField, PageBreak, TableOfContents, LevelFormat,
  Bookmark, ExternalHyperlink, UnderlineType, VerticalAlign
} = require('docx');

// ─── COLORS ─────────────────────────────────────────────────────────────────
const C_DARK_BG  = "1A1F1A";
const C_TEAL     = "14B8A6";
const C_TEAL_DIM = "0D7A6E";
const C_AMBER_BG = "FEF3C7";
const C_AMBER    = "D97706";
const C_AMBER_BD = "F59E0B";
const C_RED_BG   = "FEE2E2";
const C_RED      = "DC2626";
const C_GRAY_BG  = "F3F4F6";
const C_GRAY     = "6B7280";
const C_BLUE_BG  = "EFF6FF";
const C_WHITE    = "FFFFFF";
const C_TEXT     = "111827";

// ─── OUTPUT PATH ─────────────────────────────────────────────────────────────
const OUTPUT_PATH = "C:/Users/18054/AppData/Local/Temp/outputs/Kre8r-Production-Runbook.docx";

// ─── NUMBERING CONFIG ────────────────────────────────────────────────────────
const STEP_REFS = [
  'steps-id8r','steps-pipr','steps-writr','steps-director','steps-shootday',
  'steps-teleprompter','steps-vaultr','steps-editor','steps-reviewr',
  'steps-composor','steps-gater','steps-packageer','steps-captionr',
  'steps-mailor','steps-automatr','steps-analytr'
];

function makeStepNumbering(ref) {
  return {
    reference: ref,
    levels: [{
      level: 0,
      format: LevelFormat.DECIMAL,
      text: "%1.",
      alignment: AlignmentType.LEFT,
      style: {
        paragraph: {
          indent: { left: 540, hanging: 360 }
        },
        run: {
          font: "Arial",
          size: 22,
          bold: true,
          color: C_TEAL
        }
      }
    }]
  };
}

const numberingConfig = [
  ...STEP_REFS.map(makeStepNumbering),
  {
    reference: 'bullets',
    levels: [{
      level: 0,
      format: LevelFormat.BULLET,
      text: "\u2022",
      alignment: AlignmentType.LEFT,
      style: {
        paragraph: { indent: { left: 540, hanging: 360 } },
        run: { font: "Arial", size: 22 }
      }
    }]
  },
  {
    reference: 'subbullets',
    levels: [{
      level: 0,
      format: LevelFormat.BULLET,
      text: "\u2013",
      alignment: AlignmentType.LEFT,
      style: {
        paragraph: { indent: { left: 900, hanging: 360 } },
        run: { font: "Arial", size: 20, color: C_GRAY }
      }
    }]
  }
];

// ─── TEXT HELPERS ─────────────────────────────────────────────────────────────
function regular(text) {
  return new TextRun({ text, font: "Arial", size: 22, color: C_TEXT });
}
function bold(text) {
  return new TextRun({ text, font: "Arial", size: 22, bold: true, color: C_TEXT });
}
function teal(text, size=22) {
  return new TextRun({ text, font: "Arial", size, bold: true, color: C_TEAL });
}
function white(text, size=22) {
  return new TextRun({ text, font: "Arial", size, bold: true, color: C_WHITE });
}
function gray(text, size=22) {
  return new TextRun({ text, font: "Arial", size, color: "666666" });
}

// ─── NO BORDER HELPER ─────────────────────────────────────────────────────────
function noBorder() {
  return {
    top:    { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    left:   { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    right:  { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  };
}

function singleBorder(color="CCCCCC") {
  return {
    top:    { style: BorderStyle.SINGLE, size: 4, color },
    bottom: { style: BorderStyle.SINGLE, size: 4, color },
    left:   { style: BorderStyle.SINGLE, size: 4, color },
    right:  { style: BorderStyle.SINGLE, size: 4, color },
  };
}

// ─── HELPER FUNCTIONS ─────────────────────────────────────────────────────────

/**
 * phaseHeader(num, title)
 * Full-width dark table with phase label
 */
function phaseHeader(num, title) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 9360, type: WidthType.DXA },
            shading: { fill: C_DARK_BG, type: ShadingType.CLEAR, color: "auto" },
            borders: noBorder(),
            margins: { top: 240, bottom: 240, left: 480, right: 480 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: `PHASE ${num}`, font: "Arial", size: 22, bold: true, color: C_TEAL }),
                  new TextRun({ text: " \u2014 ", font: "Arial", size: 22, color: "666666" }),
                  new TextRun({ text: title, font: "Arial", size: 32, bold: true, color: C_WHITE, allCaps: true }),
                ]
              })
            ]
          })
        ]
      })
    ]
  });
}

/**
 * toolSection(emoji, name, bookmarkId, tagline)
 */
function toolSection(emoji, name, bookmarkId, tagline) {
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [
        new Bookmark({
          id: bookmarkId,
          children: [
            new TextRun({ text: `${emoji}  ${name}`, font: "Arial", size: 28, bold: true, color: C_TEAL })
          ]
        })
      ],
      spacing: { before: 320, after: 160 }
    }),
    new Paragraph({
      children: [
        new TextRun({ text: tagline, font: "Arial", size: 22, italics: true, color: C_GRAY })
      ],
      spacing: { before: 0, after: 100 }
    })
  ];
}

/**
 * whatItDoes(text)
 */
function whatItDoes(text) {
  return new Paragraph({
    children: [
      new TextRun({ text, font: "Arial", size: 22, color: C_TEXT })
    ],
    spacing: { before: 120, after: 160 }
  });
}

/**
 * sectionLabel(text) — a small label like "STEPS"
 */
function sectionLabel(text) {
  return new Paragraph({
    children: [
      new TextRun({ text, font: "Arial", size: 20, bold: true, color: C_GRAY, allCaps: true })
    ],
    spacing: { before: 200, after: 80 }
  });
}

/**
 * step(ref, children[])
 */
function step(ref, children) {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    children,
    spacing: { before: 80, after: 80 }
  });
}

/**
 * screenshotBox(label)
 */
function screenshotBox(label) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 9360, type: WidthType.DXA },
            borders: singleBorder("CCCCCC"),
            shading: { fill: C_GRAY_BG, type: ShadingType.CLEAR, color: "auto" },
            margins: { top: 480, bottom: 480, left: 240, right: 240 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: "\uD83D\uDCF7", size: 36 })]
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: `[SCREENSHOT: ${label}]`, font: "Arial", size: 20, bold: true, color: C_GRAY })]
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: "Insert screenshot here", font: "Arial", size: 18, italics: true, color: "AAAAAA" })]
              })
            ]
          })
        ]
      })
    ],
    margins: { top: 120, bottom: 120 }
  });
}

/**
 * ifThenBox(rows[]) — rows is array of [ifText, thenText]
 */
function ifThenBox(rows) {
  const headerRow = new TableRow({
    children: [
      new TableCell({
        columnSpan: 2,
        width: { size: 9360, type: WidthType.DXA },
        shading: { fill: C_AMBER_BD, type: ShadingType.CLEAR, color: "auto" },
        borders: singleBorder(C_AMBER_BD),
        margins: { top: 120, bottom: 120, left: 240, right: 240 },
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: "\u26A1  IF / THEN DECISIONS", font: "Arial", size: 22, bold: true, color: C_WHITE })
            ]
          })
        ]
      })
    ]
  });

  const dataRows = rows.map(([ifText, thenText], i) => {
    const bg = i % 2 === 0 ? C_AMBER_BG : "FFFBEB";
    return new TableRow({
      children: [
        new TableCell({
          width: { size: 3780, type: WidthType.DXA },
          shading: { fill: bg, type: ShadingType.CLEAR, color: "auto" },
          borders: singleBorder(C_AMBER_BD),
          margins: { top: 100, bottom: 100, left: 200, right: 200 },
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: "IF  ", font: "Arial", size: 20, bold: true, color: C_AMBER }),
                new TextRun({ text: ifText, font: "Arial", size: 20, color: C_TEXT })
              ]
            })
          ]
        }),
        new TableCell({
          width: { size: 5580, type: WidthType.DXA },
          shading: { fill: bg, type: ShadingType.CLEAR, color: "auto" },
          borders: singleBorder(C_AMBER_BD),
          margins: { top: 100, bottom: 100, left: 200, right: 200 },
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: "THEN  ", font: "Arial", size: 20, bold: true, color: C_TEAL }),
                new TextRun({ text: thenText, font: "Arial", size: 20, color: C_TEXT })
              ]
            })
          ]
        })
      ]
    });
  });

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3780, 5580],
    rows: [headerRow, ...dataRows],
    margins: { top: 120, bottom: 120 }
  });
}

/**
 * mistakesBox(items[]) — items is array of TextRun arrays
 */
function mistakesBox(items) {
  const headerRow = new TableRow({
    children: [
      new TableCell({
        width: { size: 9360, type: WidthType.DXA },
        shading: { fill: C_RED, type: ShadingType.CLEAR, color: "auto" },
        borders: singleBorder(C_RED),
        margins: { top: 120, bottom: 120, left: 240, right: 240 },
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: "\u26A0\uFE0F  COMMON MISTAKES", font: "Arial", size: 22, bold: true, color: C_WHITE })
            ]
          })
        ]
      })
    ]
  });

  const dataRows = items.map((runs) => {
    // runs may be a flat array of TextRuns, or an array of TextRun arrays — flatten both cases
    const flatRuns = runs.flat ? runs.flat(Infinity) : [].concat(...runs);
    return new TableRow({
      children: [
        new TableCell({
          width: { size: 9360, type: WidthType.DXA },
          shading: { fill: C_RED_BG, type: ShadingType.CLEAR, color: "auto" },
          borders: singleBorder(C_RED),
          margins: { top: 100, bottom: 100, left: 200, right: 200 },
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: "\u2717  ", font: "Arial", size: 20, bold: true, color: C_RED }),
                ...flatRuns
              ]
            })
          ]
        })
      ]
    });
  });

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [headerRow, ...dataRows],
    margins: { top: 120, bottom: 120 }
  });
}

/**
 * dataFlowBar(from, to, what)
 */
function dataFlowBar(from, to, what) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 9360, type: WidthType.DXA },
            shading: { fill: "E6F7F5", type: ShadingType.CLEAR, color: "auto" },
            borders: {
              top:    { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              right:  { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              left:   { style: BorderStyle.SINGLE, size: 8, color: C_TEAL }
            },
            margins: { top: 100, bottom: 100, left: 200, right: 200 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: "DATA FLOW  ", font: "Arial", size: 18, bold: true, color: C_TEAL }),
                  new TextRun({ text: `${from} \u2192 ${to}: `, font: "Arial", size: 20, bold: true, color: C_TEXT }),
                  new TextRun({ text: what, font: "Arial", size: 20, color: C_TEXT })
                ]
              })
            ]
          })
        ]
      })
    ],
    margins: { top: 120, bottom: 120 }
  });
}

/**
 * tipBox(text)
 */
function tipBox(text) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 9360, type: WidthType.DXA },
            shading: { fill: C_BLUE_BG, type: ShadingType.CLEAR, color: "auto" },
            borders: {
              top:    { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              right:  { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              left:   { style: BorderStyle.SINGLE, size: 8, color: "3B82F6" }
            },
            margins: { top: 100, bottom: 100, left: 200, right: 200 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: "\uD83D\uDCA1  ", size: 22 }),
                  new TextRun({ text, font: "Arial", size: 20, color: C_TEXT })
                ]
              })
            ]
          })
        ]
      })
    ],
    margins: { top: 120, bottom: 120 }
  });
}

/**
 * spacerPara(before)
 */
function spacerPara(before) {
  return new Paragraph({ children: [], spacing: { before } });
}

/**
 * pageBreakPara()
 */
function pageBreakPara() {
  return new Paragraph({ children: [new PageBreak()] });
}

// ─── DOCUMENT BUILD ──────────────────────────────────────────────────────────

// Section 1: Cover Page
const coverChildren = [
  // Big dark header table
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 9360, type: WidthType.DXA },
            shading: { fill: "0E0F0E", type: ShadingType.CLEAR, color: "auto" },
            borders: noBorder(),
            margins: { top: 720, bottom: 480, left: 480, right: 480 },
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "KRE8\u03A9R", font: "Arial", size: 120, bold: true, color: C_WHITE })
                ]
              }),
              new Paragraph({ children: [], spacing: { before: 240 } }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "PRODUCTION RUNBOOK", font: "Arial", size: 44, bold: true, color: C_TEAL, allCaps: true })
                ]
              }),
              new Paragraph({ children: [], spacing: { before: 200 } }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: "7 Kin Homestead  \u2014  Complete Pipeline Guide", font: "Arial", size: 26, color: "999999" })
                ]
              }),
            ]
          })
        ]
      })
    ]
  }),
  spacerPara(600),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({ text: "The complete A-to-Z workflow for every video from first idea to published post.", font: "Arial", size: 24, italics: true, color: C_GRAY })
    ]
  }),
  spacerPara(200),
  // 4-column phase overview
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2340, 2340, 2340, 2340],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 2340, type: WidthType.DXA },
            shading: { fill: C_DARK_BG, type: ShadingType.CLEAR, color: "auto" },
            borders: noBorder(),
            margins: { top: 200, bottom: 200, left: 240, right: 240 },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "PHASE 1", font: "Arial", size: 22, bold: true, color: C_TEAL })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Pre-Production", font: "Arial", size: 20, color: C_GRAY })] }),
            ]
          }),
          new TableCell({
            width: { size: 2340, type: WidthType.DXA },
            shading: { fill: C_DARK_BG, type: ShadingType.CLEAR, color: "auto" },
            borders: noBorder(),
            margins: { top: 200, bottom: 200, left: 240, right: 240 },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "PHASE 2", font: "Arial", size: 22, bold: true, color: "60A5FA" })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Production", font: "Arial", size: 20, color: C_GRAY })] }),
            ]
          }),
          new TableCell({
            width: { size: 2340, type: WidthType.DXA },
            shading: { fill: C_DARK_BG, type: ShadingType.CLEAR, color: "auto" },
            borders: noBorder(),
            margins: { top: 200, bottom: 200, left: 240, right: 240 },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "PHASE 3", font: "Arial", size: 22, bold: true, color: "A78BFA" })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Post-Production", font: "Arial", size: 20, color: C_GRAY })] }),
            ]
          }),
          new TableCell({
            width: { size: 2340, type: WidthType.DXA },
            shading: { fill: C_DARK_BG, type: ShadingType.CLEAR, color: "auto" },
            borders: noBorder(),
            margins: { top: 200, bottom: 200, left: 240, right: 240 },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "PHASE 4", font: "Arial", size: 22, bold: true, color: "F472B6" })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Distribution", font: "Arial", size: 20, color: C_GRAY })] }),
            ]
          }),
        ]
      })
    ]
  }),
  spacerPara(600),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "15 Tools  \u2022  4 Phases  \u2022  Full Pipeline", font: "Arial", size: 22, color: C_GRAY })]
  }),
  pageBreakPara(),
];

// Section 2: Main content children
const mainChildren = [];

// ─── TABLE OF CONTENTS ───────────────────────────────────────────────────────
mainChildren.push(
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [
      new Bookmark({ id: "toc", children: [new TextRun({ text: "Table of Contents", font: "Arial", size: 36, bold: true, color: C_TEXT })] })
    ],
    spacing: { before: 360, after: 240 }
  }),
  new TableOfContents("Table of Contents", {
    hyperlink: true,
    headingStyleRange: "1-3"
  }),
  pageBreakPara()
);

// ─── INTRODUCTION ────────────────────────────────────────────────────────────
mainChildren.push(
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [
      new Bookmark({ id: "intro", children: [new TextRun({ text: "How to Use This Runbook", font: "Arial", size: 36, bold: true, color: C_TEXT })] })
    ],
    spacing: { before: 360, after: 240 }
  }),
  whatItDoes("This runbook covers every step of the Kre8\u03A9r pipeline from first idea to published community post. Follow it top to bottom for your first few videos. After that, jump to the If/Then Decision Guide when something doesn\u2019t behave as expected."),
  whatItDoes("Each tool section explains: what the tool does in plain English, the exact buttons to click in order, what data flows automatically to the next tool, and what to do when something goes wrong."),
  // Legend table
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1800, 7560],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 2,
            width: { size: 9360, type: WidthType.DXA },
            shading: { fill: C_DARK_BG, type: ShadingType.CLEAR, color: "auto" },
            borders: noBorder(),
            margins: { top: 120, bottom: 120, left: 200, right: 200 },
            children: [new Paragraph({ children: [new TextRun({ text: "LEGEND", font: "Arial", size: 22, bold: true, color: C_WHITE })] })]
          })
        ]
      }),
      ...([
        ["Bold button name", "A clickable button or UI action"],
        ["Numbered steps", "Follow these in exact order \u2014 sequence matters"],
        ["IF / THEN boxes", "Decision points to check when you get stuck"],
        ["[SCREENSHOT] boxes", "Capture these for your own reference copy"],
        ["DATA FLOW bars", "Data that passes automatically to the next tool"],
      ].map(([term, desc], i) => new TableRow({
        children: [
          new TableCell({
            width: { size: 1800, type: WidthType.DXA },
            shading: { fill: i % 2 === 0 ? "F9FAFB" : C_WHITE, type: ShadingType.CLEAR, color: "auto" },
            borders: singleBorder("E5E7EB"),
            margins: { top: 100, bottom: 100, left: 200, right: 200 },
            children: [new Paragraph({ children: [new TextRun({ text: term, font: "Arial", size: 20, bold: true, color: C_TEXT })] })]
          }),
          new TableCell({
            width: { size: 7560, type: WidthType.DXA },
            shading: { fill: i % 2 === 0 ? "F9FAFB" : C_WHITE, type: ShadingType.CLEAR, color: "auto" },
            borders: singleBorder("E5E7EB"),
            margins: { top: 100, bottom: 100, left: 200, right: 200 },
            children: [new Paragraph({ children: [new TextRun({ text: desc, font: "Arial", size: 20, color: C_TEXT })] })]
          })
        ]
      })))
    ]
  }),
  pageBreakPara()
);

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1 — PRE-PRODUCTION
// ═══════════════════════════════════════════════════════════════════════════════
mainChildren.push(phaseHeader(1, "PRE-PRODUCTION"), spacerPara(200));

// ─── TOOL 1: Id8Ωr ───────────────────────────────────────────────────────────
mainChildren.push(...toolSection("💡", "Id8\u03A9r", "tool-id8r", "Concept generation — where every video starts"));
mainChildren.push(whatItDoes("Id8\u03A9r is your creative partner. It takes a topic or gut feeling and turns it into a fully researched concept package: three title options, three thumbnail angles, three hooks, and a vision brief. Nothing moves to production until you\u2019ve approved a concept here."));
mainChildren.push(sectionLabel("STEPS"));
mainChildren.push(step("steps-id8r", [regular("Open "), bold("Id8\u03A9r"), regular(" from the main nav")]));
mainChildren.push(step("steps-id8r", [regular("Click "), bold("Shape It"), regular(" to have a conversation, "), bold("Fast Pass"), regular(" to skip straight to research, or "), bold("Deep Dive"), regular(" for exhaustive research on a known topic")]));
mainChildren.push(step("steps-id8r", [regular("Describe your topic or answer the prompts \u2014 Id8\u03A9r asks clarifying questions to narrow the angle")]));
mainChildren.push(step("steps-id8r", [regular("Review the 3 concept cards. Look for the "), bold("\u2728 NEW ANGLE"), regular(" badge \u2014 that\u2019s the system flagging an underserved idea")]));
mainChildren.push(step("steps-id8r", [regular("Click the concept you want. Deep Research runs automatically in 3 phases (allow 5\u201310 minutes)")]));
mainChildren.push(step("steps-id8r", [regular("Review the package: 3 title options, 3 thumbnail descriptions, 3 hook variations")]));
mainChildren.push(step("steps-id8r", [regular("Click "), bold("Generate Vision Brief"), regular(" \u2014 this locks in the creative direction")]));
mainChildren.push(step("steps-id8r", [regular("Click "), bold("Send to Pip\u03A9r"), regular(" \u2014 the Vision Brief travels with the project")]));
mainChildren.push(screenshotBox("Id8\u03A9r \u2014 concept card selection and Vision Brief"));
mainChildren.push(dataFlowBar("Id8\u03A9r", "Pip\u03A9r", "Vision Brief: title, angle, hook, thumbnail concept, emotional arc"));
mainChildren.push(ifThenBox([
  ["you want a different angle than the 3 cards shown", "click the concept closest to what you want, then edit the brief in the next step"],
  ["Deep Research seems stuck", "check the status bar \u2014 if it\u2019s past 10 minutes, refresh and re-run from the concept card"],
  ["you don\u2019t have a clear topic yet", "use Shape It mode and just describe what\u2019s happening on the homestead this week"],
]));
mainChildren.push(spacerPara(200));

// ─── TOOL 2: PipΩr ───────────────────────────────────────────────────────────
mainChildren.push(...toolSection("\uD83D\uDCCB", "Pip\u03A9r", "tool-pipr", "Story structure — turns your concept into a beatable map"));
mainChildren.push(whatItDoes("Pip\u03A9r is where your concept gets a spine. It takes the Vision Brief from Id8\u03A9r and helps you choose a story structure, then generates a beat map: a scene-by-scene breakdown that the rest of the pipeline reads from. Every tool downstream depends on this beat map."));
mainChildren.push(sectionLabel("STEPS"));
mainChildren.push(step("steps-pipr", [regular("If arriving from Id8\u03A9r: a "), bold("teal banner"), regular(" confirms the Vision Brief is loaded. Skip to step 3.")]));
mainChildren.push(step("steps-pipr", [regular("If opening fresh: select your project from the dropdown on Screen 1")]));
mainChildren.push(step("steps-pipr", [regular("Screen 2: your "), bold("entry point"), regular(" is pre-selected from the Vision Brief. Confirm or adjust.")]));
mainChildren.push(step("steps-pipr", [regular("Screen 3: pick a story structure. "), bold("Save the Cat"), regular(" is recommended for reality/homestead content. Story Circle works for more personal videos.")]));
mainChildren.push(step("steps-pipr", [regular("Screen 4: choose setup depth (Brief / Standard / Deep). Standard is the default.")]));
mainChildren.push(step("steps-pipr", [regular("Screen 5: review the full brief pre-filled from Id8\u03A9r. Edit any field that needs adjustment.")]));
mainChildren.push(step("steps-pipr", [regular("Click "), bold("Generate Beat Map"), regular(" \u2014 Claude builds your scene breakdown")]));
mainChildren.push(step("steps-pipr", [regular("Review each beat card. Check that the emotional arc makes sense.")]));
mainChildren.push(step("steps-pipr", [regular("Click "), bold("Complete"), regular(" then "), bold("Send to Writ\u03A9r")]));
mainChildren.push(screenshotBox("Pip\u03A9r \u2014 beat map with scene cards"));
mainChildren.push(dataFlowBar("Pip\u03A9r", "Writ\u03A9r", "Beat map: scene labels, emotional functions, structure type, duration estimates"));
mainChildren.push(ifThenBox([
  ["the Vision Brief didn\u2019t carry over", "check that you clicked Send to Pip\u03A9r in Id8\u03A9r \u2014 if not, copy the brief manually into Screen 5"],
  ["a beat feels wrong", "click the beat card to edit it before generating \u2014 the script will mirror whatever the beats say"],
  ["you want to change the story structure later", "go back to Screen 3 and regenerate \u2014 beats will reset"],
]));
mainChildren.push(spacerPara(200));

// ─── TOOL 3: WritΩr ──────────────────────────────────────────────────────────
mainChildren.push(...toolSection("\u270D\uFE0F", "Writ\u03A9r", "tool-writr", "Script generation \u2014 Jason\u2019s voice, on the page"));
mainChildren.push(whatItDoes("Writ\u03A9r generates the actual script using the beat map from Pip\u03A9r and Jason\u2019s analyzed voice profiles. It won\u2019t appear in your project dropdown until Pip\u03A9r is marked complete. The script drives Direct\u03A9r, Edit\u03A9r, and Caption\u03A9r \u2014 so approving the right version here matters."));
mainChildren.push(sectionLabel("STEPS"));
mainChildren.push(step("steps-writr", [regular("Select your project from the dropdown (only "), bold("pipr_complete"), regular(" projects appear)")]));
mainChildren.push(step("steps-writr", [regular("Confirm the Id8\u03A9r context is shown in the context panel \u2014 it injects automatically")]));
mainChildren.push(step("steps-writr", [regular("Adjust the "), bold("voice blend slider"), regular(" \u2014 left = more scripted, right = more off-the-cuff Jason")]));
mainChildren.push(step("steps-writr", [regular("Click "), bold("Generate Script")]));
mainChildren.push(step("steps-writr", [regular("Review all three tabs: "), bold("Full Script"), regular(", "), bold("Bullet Points"), regular(", "), bold("Hybrid")]));
mainChildren.push(step("steps-writr", [regular("Click "), bold("Approve"), regular(" on the version you\u2019re shooting with")]));
mainChildren.push(step("steps-writr", [regular("The approved script is now locked in for the downstream pipeline")]));
mainChildren.push(screenshotBox("Writ\u03A9r \u2014 script tabs and Approve button"));
mainChildren.push(dataFlowBar("Writ\u03A9r", "Direct\u03A9r / Edit\u03A9r / Caption\u03A9r", "Approved script text, beat alignment, voice profile used"));
mainChildren.push(ifThenBox([
  ["project doesn\u2019t appear in Writ\u03A9r dropdown", "go back to Pip\u03A9r and click Complete + Send to Writ\u03A9r first"],
  ["you get a network error on Generate", "click Retry \u2014 do NOT refresh the page or the generation context is lost"],
  ["the voice sounds too formal", "move the blend slider further right and regenerate"],
  ["you want a new script without losing the approved one", "approve first, then regenerate \u2014 the approved version is preserved"],
]));
mainChildren.push(spacerPara(200));

// ─── TOOL 4: DirectΩr ────────────────────────────────────────────────────────
mainChildren.push(...toolSection("\uD83C\uDFAC", "Direct\u03A9r", "tool-director", "Shot list and crew brief \u2014 production prep for Cari"));
mainChildren.push(whatItDoes("Direct\u03A9r reads your beat map and approved script and generates a shot list with reality-specific notes. It produces the offline package Cari uses on shoot day. Nothing here requires manual entry \u2014 it\u2019s all pulled from what\u2019s already in the system."));
mainChildren.push(sectionLabel("STEPS"));
mainChildren.push(step("steps-director", [regular("Select your project from the dropdown")]));
mainChildren.push(step("steps-director", [regular("The shot list generates automatically from the beat map \u2014 review each beat card")]));
mainChildren.push(step("steps-director", [regular("Check the "), bold("Shot Type"), regular(", "), bold("Reality Note"), regular(", and "), bold("Talking Head Prompt"), regular(" for each beat")]));
mainChildren.push(step("steps-director", [regular("Adjust any shot that doesn\u2019t match what\u2019s physically possible on location")]));
mainChildren.push(step("steps-director", [regular("Click "), bold("Download Crew Brief PDF"), regular(" \u2014 send this to Cari before shoot day")]));
mainChildren.push(step("steps-director", [regular("Click "), bold("\uD83D\uDCF1 Send to Cari\u2019s Phone"), regular(" \u2014 generates a QR code for the offline ShootDay package")]));
mainChildren.push(screenshotBox("Direct\u03A9r \u2014 shot list and crew brief"));
mainChildren.push(dataFlowBar("Direct\u03A9r", "ShootDay", "Offline package: shot list, script, QR code for mobile access"));
mainChildren.push(ifThenBox([
  ["a shot type is wrong for your location", "click the beat card and edit the shot type before downloading"],
  ["Cari doesn\u2019t have internet on location", "use the QR code \u2014 ShootDay works fully offline"],
]));
mainChildren.push(spacerPara(200));

// ─── TOOL 5: ShootDay ────────────────────────────────────────────────────────
mainChildren.push(...toolSection("\uD83D\uDCF1", "ShootDay", "tool-shootday", "Day-of shoot management \u2014 on your phone"));
mainChildren.push(whatItDoes("ShootDay is designed to be open on your phone while you shoot. It shows the shot list, the approved script, and lets you mark takes as you go. Access it by scanning the QR from Direct\u03A9r or opening it on the same network."));
mainChildren.push(sectionLabel("STEPS"));
mainChildren.push(step("steps-shootday", [regular("Open "), bold("ShootDay"), regular(" on your phone browser, or scan the QR code from Direct\u03A9r")]));
mainChildren.push(step("steps-shootday", [regular("Select your project (pre-selected if you used the QR deep-link)")]));
mainChildren.push(step("steps-shootday", [regular("Script tab: your approved Writ\u03A9r script, formatted for easy reading on mobile")]));
mainChildren.push(step("steps-shootday", [regular("Shots tab: swipe "), bold("right = Good take"), regular(", swipe "), bold("left = Skip"), regular(" \u2014 tracks coverage as you shoot")]));
mainChildren.push(step("steps-shootday", [regular("Review tab: shows coverage summary \u2014 which beats are covered, which are missing")]));
mainChildren.push(step("steps-shootday", [regular("Telepr\u03A9mpter tab: syncs with the main Telepr\u03A9mpter display if both are on the same network")]));
mainChildren.push(screenshotBox("ShootDay \u2014 mobile shot tracking interface"));
mainChildren.push(tipBox("ShootDay works offline after initial load. If you\u2019re shooting somewhere with no signal, load it before you leave the house."));
mainChildren.push(ifThenBox([
  ["project doesn\u2019t appear", "make sure you\u2019ve completed the Pip\u03A9r beat map for this project"],
  ["swipes aren\u2019t saving", "check wifi connection \u2014 ShootDay needs to reach the server to save take notes"],
]));
mainChildren.push(pageBreakPara());

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — PRODUCTION
// ═══════════════════════════════════════════════════════════════════════════════
mainChildren.push(phaseHeader(2, "PRODUCTION"), spacerPara(200));

// ─── TOOL 6: TeleprΩmpter ────────────────────────────────────────────────────
mainChildren.push(...toolSection("\uD83D\uDCFA", "Telepr\u03A9mpter", "tool-teleprompter", "On-set script display \u2014 three-device system"));
mainChildren.push(whatItDoes("The Telepr\u03A9mpter is a three-device system: the main display (camera-facing), the remote control (in your hand), and the voice device (mic drives scroll speed). All three connect automatically over your local network using a session code."));
mainChildren.push(sectionLabel("STEPS"));
mainChildren.push(step("steps-teleprompter", [regular("Open "), bold("Telepr\u03A9mpter"), regular(" on the main camera-facing display")]));
mainChildren.push(step("steps-teleprompter", [regular("Note the "), bold("session code"), regular(" shown on screen")]));
mainChildren.push(step("steps-teleprompter", [regular("Open the "), bold("Remote Control"), regular(" URL on your phone (QR code on setup screen) \u2014 enter the session code")]));
mainChildren.push(step("steps-teleprompter", [regular("Open the "), bold("Voice Device"), regular(" URL on a third device (tablet works well) \u2014 this mic drives scroll speed")]));
mainChildren.push(step("steps-teleprompter", [regular("Use the remote to adjust speed, pause, and restart")]));
mainChildren.push(step("steps-teleprompter", [regular("The "), bold("Mirror"), regular(" mode flips the display for a beam splitter setup")]));
mainChildren.push(screenshotBox("Telepr\u03A9mpter \u2014 three-device setup screen with QR codes"));
mainChildren.push(tipBox("The voice device uses the microphone to detect speech pace and auto-adjusts scroll speed. Faster talking = faster scroll. It\u2019s calibrated to Jason\u2019s natural pace \u2014 adjust sensitivity in settings if needed."));
mainChildren.push(ifThenBox([
  ["remote isn\u2019t connecting", "make sure all devices are on the same wifi network \u2014 the session code must match exactly"],
  ["scroll is too fast or slow", "adjust the speed dial on the remote, or reduce voice sensitivity on the voice device"],
  ["the script text is too small", "use the font size controls on the main display before rolling camera"],
]));
mainChildren.push(pageBreakPara());

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3 — POST-PRODUCTION
// ═══════════════════════════════════════════════════════════════════════════════
mainChildren.push(phaseHeader(3, "POST-PRODUCTION"), spacerPara(200));

// ─── TOOL 7: VaultΩr ─────────────────────────────────────────────────────────
mainChildren.push(...toolSection("\uD83D\uDDC4\uFE0F", "Vault\u03A9r", "tool-vaultr", "Footage intelligence \u2014 every clip, classified and searchable"));
mainChildren.push(whatItDoes("Vault\u03A9r watches the intake folder and classifies every footage file that lands there. It identifies talking head clips, b-roll, action shots, and more. BRAW files from the Blackmagic get a proxy generated via DaVinci before Vault\u03A9r can process them."));
mainChildren.push(sectionLabel("STEPS"));
mainChildren.push(step("steps-vaultr", [regular("Drop footage files into "), bold("D:\\kre8r\\intake"), regular(" \u2014 this is the only folder Vault\u03A9r watches")]));
mainChildren.push(step("steps-vaultr", [regular("Vault\u03A9r detects new files automatically \u2014 classification begins within 30 seconds")]));
mainChildren.push(step("steps-vaultr", [regular("For "), bold("BRAW files"), regular(": open DaVinci Resolve \u2192 export proxy as H.264 MP4 \u2192 save to D:\\kre8r\\intake")]));
mainChildren.push(step("steps-vaultr", [regular("Review classifications in the Vault\u03A9r grid \u2014 check shot type for each clip")]));
mainChildren.push(step("steps-vaultr", [regular("Reclassify any clip that\u2019s wrong: click the clip \u2192 change shot type \u2192 "), bold("Save")]));
mainChildren.push(step("steps-vaultr", [regular("Assign clips to your project using the "), bold("project dropdown"), regular(" on each clip card")]));
mainChildren.push(step("steps-vaultr", [regular("Use "), bold("Voice Analysis"), regular(" button on completed-video cards to feed scripts into the Writ\u03A9r voice library")]));
mainChildren.push(screenshotBox("Vault\u03A9r \u2014 footage grid with classification cards"));
mainChildren.push(dataFlowBar("Vault\u03A9r", "Edit\u03A9r", "Clip database: path, shot type, transcript, project assignment, duration"));
mainChildren.push(mistakesBox([
  [[regular("Dropping footage in the wrong folder. It "), bold("must"), regular(" be D:\\kre8r\\intake \u2014 no other folder is watched")]],
  [[regular("Forgetting to export the BRAW proxy before Vault\u03A9r can read it \u2014 BRAW files need a DaVinci proxy step first")]],
  [[regular("Assigning clips to the wrong project \u2014 double-check the project dropdown before leaving the Vault\u03A9r page")]],
]));
mainChildren.push(ifThenBox([
  ["Vault\u03A9r doesn\u2019t detect new footage", "check that the file landed in D:\\kre8r\\intake and the server is running (pm2 status)"],
  ["a clip shows wrong shot type", "click the clip card and manually set the correct type \u2014 Edit\u03A9r uses this for selection logic"],
  ["BRAW proxy isn\u2019t linking back", "the proxy must be named with _proxy.mp4 suffix and match the BRAW basename exactly"],
]));
mainChildren.push(spacerPara(200));

// ─── TOOL 8: EditΩr ──────────────────────────────────────────────────────────
mainChildren.push(...toolSection("\u2702\uFE0F", "Edit\u03A9r", "tool-editor", "Selects engine \u2014 builds your rough assembly"));
mainChildren.push(whatItDoes("Edit\u03A9r reads your approved script, beat map, and Vault\u03A9r footage and suggests which clips to use for each beat. It classifies clips by shot type first, then matches them to beats. You review, approve, or swap suggestions before the cut is sent to Review\u03A9r."));
mainChildren.push(sectionLabel("STEPS"));
mainChildren.push(step("steps-editor", [regular("Select your project \u2014 requires an approved Writ\u03A9r script "), bold("and"), regular(" Vault\u03A9r footage assigned to the project")]));
mainChildren.push(step("steps-editor", [regular("Confirm the shoot mode: "), bold("SCRIPTED"), regular(" (beat-for-beat), "), bold("HYBRID"), regular(" (scripted anchor with b-roll fill), or "), bold("FREEFORM"), regular(" (story from footage)")]));
mainChildren.push(step("steps-editor", [regular("Click "), bold("Generate Selects")]));
mainChildren.push(step("steps-editor", [regular("Review suggested clips per beat \u2014 each beat card shows the top clip pick with a confidence indicator")]));
mainChildren.push(step("steps-editor", [regular("Click "), bold("Approve"), regular(" to accept a clip, or click "), bold("Swap"), regular(" to see alternatives")]));
mainChildren.push(step("steps-editor", [regular("Once all beats have approved clips, click "), bold("Send to Review\u03A9r")]));
mainChildren.push(screenshotBox("Edit\u03A9r \u2014 beat cards with clip suggestions"));
mainChildren.push(dataFlowBar("Edit\u03A9r", "Review\u03A9r", "Clip selections: one clip per beat, order locked, proxy paths"));
mainChildren.push(ifThenBox([
  ["project doesn\u2019t have enough footage for a beat", "flag that beat and continue \u2014 you can shoot pickups and re-run selects"],
  ["a clip suggestion is wrong", "use Swap to cycle through alternatives \u2014 Edit\u03A9r shows up to 5 options per beat"],
  ["transcript isn\u2019t running on a talking head clip", "go back to Vault\u03A9r and run transcription on that clip first"],
]));
mainChildren.push(spacerPara(200));

// ─── TOOL 9: ReviewΩr ────────────────────────────────────────────────────────
mainChildren.push(...toolSection("\uD83D\uDC41\uFE0F", "Review\u03A9r", "tool-reviewr", "Rough cut approval \u2014 before anything goes further"));
mainChildren.push(whatItDoes("Review\u03A9r shows the rough cut assembly from Edit\u03A9r. You review it, approve it, or send notes back. Approved rough cuts unlock the downstream distribution tools. Notes feed back to Edit\u03A9r as revision requests."));
mainChildren.push(sectionLabel("STEPS"));
mainChildren.push(step("steps-reviewr", [regular("Open "), bold("Review\u03A9r"), regular(" and select your project")]));
mainChildren.push(step("steps-reviewr", [regular("Review the rough cut sequence \u2014 check timing, clip order, and coverage")]));
mainChildren.push(step("steps-reviewr", [regular("Add notes to any clip that needs to change \u2014 click the clip and type the note")]));
mainChildren.push(step("steps-reviewr", [regular("Click "), bold("Approve Rough Cut"), regular(" if it\u2019s ready \u2014 this unlocks Compos\u03A9r and distribution")]));
mainChildren.push(step("steps-reviewr", [regular("Click "), bold("Request Changes"), regular(" to send notes back to Edit\u03A9r")]));
mainChildren.push(screenshotBox("Review\u03A9r \u2014 rough cut review interface"));
mainChildren.push(ifThenBox([
  ["you want to adjust a clip without full revision", "approve the rough cut and make the edit directly in DaVinci after Compos\u03A9r"],
  ["rough cut is missing a beat entirely", "go back to Edit\u03A9r, swap in a clip for that beat, and resubmit"],
]));
mainChildren.push(spacerPara(200));

// ─── TOOL 10: ComposΩr ───────────────────────────────────────────────────────
mainChildren.push(...toolSection("\uD83C\uDFB5", "Compos\u03A9r", "tool-composor", "Music generation \u2014 scene-by-scene scoring"));
mainChildren.push(whatItDoes("Compos\u03A9r analyzes your rough cut scenes and generates Suno prompts for each one \u2014 matching tempo, tone, and energy to the emotional function of each beat. If Suno API credits are available it generates automatically. If not, it hands you prompts to paste manually."));
mainChildren.push(sectionLabel("STEPS"));
mainChildren.push(step("steps-composor", [regular("Select your project in Compos\u03A9r")]));
mainChildren.push(step("steps-composor", [regular("Click "), bold("Analyze Scenes"), regular(" \u2014 Claude reads your beat map and rough cut")]));
mainChildren.push(step("steps-composor", [regular("Click "), bold("Generate Music Prompts"), regular(" \u2014 one 200-char Suno prompt per scene")]));
mainChildren.push(step("steps-composor", [regular("Review prompts \u2014 the character counter shows "), bold("teal"), regular(" (ok), "), bold("amber"), regular(" (near limit), "), bold("red"), regular(" (over 200 \u2014 will be trimmed)")]));
mainChildren.push(step("steps-composor", [regular("If Suno API is configured: click "), bold("Generate All in Suno"), regular(" \u2014 tracks generate and download automatically")]));
mainChildren.push(step("steps-composor", [regular("If no API / out of credits: each track shows "), bold("\uD83D\uDCCB Copy Prompt"), regular(" + "), bold("Open Suno \u2192"), regular(" \u2014 paste manually at suno.com/create and upload the result")]));
mainChildren.push(step("steps-composor", [regular("In "), bold("Track Selection"), regular(": listen to all generated options, click "), bold("Select"), regular(" on one track per scene")]));
mainChildren.push(step("steps-composor", [regular("Click "), bold("Push to DaVinci"), regular(" \u2014 places selected tracks on the music timeline")]));
mainChildren.push(screenshotBox("Compos\u03A9r \u2014 scene prompts and track selection grid"));
mainChildren.push(dataFlowBar("Compos\u03A9r", "DaVinci Resolve", "Selected MP3 tracks placed on timeline at scene markers"));
mainChildren.push(mistakesBox([
  [[regular("Clicking Generate before Analyze Scenes completes \u2014 wait for the scene breakdown to finish first")]],
  [[regular("Ignoring the red character counter \u2014 prompts over 200 chars are trimmed and may lose key descriptors")]],
  [[regular("Forgetting to Select a track per scene before clicking Push to DaVinci")]],
]));
mainChildren.push(ifThenBox([
  ["Compos\u03A9r shows a spinning state that doesn\u2019t resolve", "the composor_state may be stalled \u2014 run POST /api/composor/reset/[project_id] to clear it"],
  ["Suno automation fails", "use the manual Copy Prompt workflow \u2014 every track shows the prompt and a direct link to suno.com/create"],
  ["a generated track doesn\u2019t fit the scene", "regenerate that scene only by clicking Regenerate on its card"],
]));
mainChildren.push(pageBreakPara());

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 4 — DISTRIBUTION
// ═══════════════════════════════════════════════════════════════════════════════
mainChildren.push(phaseHeader(4, "DISTRIBUTION"), spacerPara(200));

// ─── TOOL 11: GateΩr ─────────────────────────────────────────────────────────
mainChildren.push(...toolSection("\uD83D\uDD12", "Gate\u03A9r", "tool-gater", "Final approval gate \u2014 nothing ships without this"));
mainChildren.push(whatItDoes("Gate\u03A9r is the quality gate before anything gets packaged for distribution. It shows the complete content package \u2014 video, script, thumbnail, metadata \u2014 and asks for explicit approval. Approved content unlocks Package\u03A9r. Rejected content sends a note back."));
mainChildren.push(sectionLabel("STEPS"));
mainChildren.push(step("steps-gater", [regular("Open "), bold("Gate\u03A9r"), regular(" and select your project")]));
mainChildren.push(step("steps-gater", [regular("Review each element: approved script, rough cut, thumbnail concept, angle")]));
mainChildren.push(step("steps-gater", [regular("Click "), bold("Approve"), regular(" on each element that\u2019s ready")]));
mainChildren.push(step("steps-gater", [regular("If anything needs a change: click "), bold("Reject"), regular(" and add a note \u2014 the relevant tool is notified")]));
mainChildren.push(step("steps-gater", [regular("Once all elements are approved: "), bold("Package\u03A9r unlocks"), regular(" automatically")]));
mainChildren.push(screenshotBox("Gate\u03A9r \u2014 approval checklist with element status"));
mainChildren.push(ifThenBox([
  ["Package\u03A9r isn\u2019t unlocking", "check that all required elements in Gate\u03A9r are marked Approved \u2014 any single pending item blocks it"],
  ["you need to change something after approval", "go back to the relevant tool, make the change, and re-approve in Gate\u03A9r"],
]));
mainChildren.push(spacerPara(200));

// ─── TOOL 12: PackageΩr ──────────────────────────────────────────────────────
mainChildren.push(...toolSection("\uD83D\uDCE6", "Package\u03A9r", "tool-packageer", "Platform packaging \u2014 titles, descriptions, and tags per platform"));
mainChildren.push(whatItDoes("Package\u03A9r generates platform-specific titles, descriptions, and tags for TikTok, YouTube, Instagram, Lemon8, and Facebook. It reads your approved script automatically \u2014 you don\u2019t type anything in here. Review and approve the output."));
mainChildren.push(sectionLabel("STEPS"));
mainChildren.push(step("steps-packageer", [regular("Select your project \u2014 requires Gate\u03A9r approval to appear")]));
mainChildren.push(step("steps-packageer", [regular("Click "), bold("Generate Package"), regular(" \u2014 titles and descriptions generate for all platforms at once")]));
mainChildren.push(step("steps-packageer", [regular("Review each platform tab: TikTok, YouTube, Instagram, Lemon8, Facebook")]));
mainChildren.push(step("steps-packageer", [regular("Edit any title or description that needs tweaking")]));
mainChildren.push(step("steps-packageer", [regular("Click "), bold("Approve Package"), regular(" \u2014 this locks in the metadata and unlocks Caption\u03A9r and Mail\u03A9r")]));
mainChildren.push(screenshotBox("Package\u03A9r \u2014 platform tabs with generated metadata"));
mainChildren.push(dataFlowBar("Package\u03A9r", "Caption\u03A9r + Mail\u03A9r", "Approved titles, descriptions, tags per platform"));
mainChildren.push(spacerPara(200));

// ─── TOOL 13: CaptionΩr ──────────────────────────────────────────────────────
mainChildren.push(...toolSection("\uD83D\uDCAC", "Caption\u03A9r", "tool-captionr", "Platform captions \u2014 optimized for each feed"));
mainChildren.push(whatItDoes("Caption\u03A9r generates the actual post captions \u2014 not just descriptions, but copy-ready captions with hashtags, optimized length, and platform-specific formatting. TikTok gets snappy and punchy. YouTube gets searchable. Lemon8 gets lifestyle-forward."));
mainChildren.push(sectionLabel("STEPS"));
mainChildren.push(step("steps-captionr", [regular("Select your project")]));
mainChildren.push(step("steps-captionr", [regular("Click "), bold("Generate Captions"), regular(" \u2014 all platforms generate at once")]));
mainChildren.push(step("steps-captionr", [regular("Review each platform: TikTok, YouTube, Instagram, Lemon8, Facebook")]));
mainChildren.push(step("steps-captionr", [regular("Each platform shows optimized character count and hashtag count")]));
mainChildren.push(step("steps-captionr", [regular("Click "), bold("Copy"), regular(" next to each platform to copy to clipboard \u2014 paste directly into the platform")]));
mainChildren.push(screenshotBox("Caption\u03A9r \u2014 platform captions with copy buttons"));
mainChildren.push(spacerPara(200));

// ─── TOOL 14: MailΩr ─────────────────────────────────────────────────────────
mainChildren.push(...toolSection("\uD83D\uDCE7", "Mail\u03A9r", "tool-mailor", "Email and community posts \u2014 broadcast to ROCK RICH"));
mainChildren.push(whatItDoes("Mail\u03A9r generates broadcast emails and Kajabi community posts from your video. It reads the approved package and script automatically. You choose the content angle (financial, lifestyle, system, rockrich) and review before sending to Automat\u03A9r."));
mainChildren.push(sectionLabel("STEPS"));
mainChildren.push(step("steps-mailor", [regular("Select your project \u2014 context pulls automatically from approved package")]));
mainChildren.push(step("steps-mailor", [regular("Choose the "), bold("content angle"), regular(": financial, lifestyle, system, rockrich, howto, mistakes, or viral")]));
mainChildren.push(step("steps-mailor", [regular("Adjust the "), bold("voice blend slider"), regular(" \u2014 same as Writ\u03A9r, balances scripted vs conversational")]));
mainChildren.push(step("steps-mailor", [regular("Check "), bold("Broadcast Email"), regular(" and/or "), bold("Community Post"), regular(" checkboxes as needed")]));
mainChildren.push(step("steps-mailor", [regular("Click "), bold("Generate"), regular(" \u2014 email subject, body, and community post copy all generate at once")]));
mainChildren.push(step("steps-mailor", [regular("Review and edit the output")]));
mainChildren.push(step("steps-mailor", [regular("Click "), bold("Send via Kajabi"), regular(" \u2014 hands off to Automat\u03A9r")]));
mainChildren.push(screenshotBox("Mail\u03A9r \u2014 email generation with voice slider and angle picker"));
mainChildren.push(dataFlowBar("Mail\u03A9r", "Automat\u03A9r", "Email subject, body, community post copy, Kajabi broadcast settings"));
mainChildren.push(spacerPara(200));

// ─── TOOL 15: AutomatΩr ──────────────────────────────────────────────────────
mainChildren.push(...toolSection("\uD83E\uDD16", "Automat\u03A9r", "tool-automatr", "Send broadcast \u2014 Chrome automation for Kajabi"));
mainChildren.push(whatItDoes("Automat\u03A9r drives Chrome to log into Kajabi and send your broadcast email and community post. Chrome must be running in remote debugging mode before you use it. It shows you a preview screenshot before sending \u2014 you always confirm before anything goes out."));
mainChildren.push(sectionLabel("STEPS"));
mainChildren.push(step("steps-automatr", [regular("Launch Chrome with remote debugging: "), bold("chrome.exe --remote-debugging-port=9222")]));
mainChildren.push(step("steps-automatr", [regular("Click "), bold("Connect Chrome"), regular(" in Automat\u03A9r \u2014 status should show "), bold("Connected")]));
mainChildren.push(step("steps-automatr", [regular("Select "), bold("Broadcast"), regular(" type from the dropdown")]));
mainChildren.push(step("steps-automatr", [regular("Review the pre-filled subject and body from Mail\u03A9r")]));
mainChildren.push(step("steps-automatr", [regular("Click "), bold("Preview Broadcast"), regular(" \u2014 Automat\u03A9r screenshots Kajabi\u2019s preview before sending")]));
mainChildren.push(step("steps-automatr", [regular("Review the screenshot \u2014 check formatting and subject line")]));
mainChildren.push(step("steps-automatr", [regular("Click "), bold("Yes \u2014 Send It \u2192"), regular(" and monitor the progress log")]));
mainChildren.push(screenshotBox("Automat\u03A9r \u2014 Chrome connected status and preview screenshot"));
mainChildren.push(mistakesBox([
  [[regular("Running Automat\u03A9r without Chrome connected first \u2014 always click Connect Chrome and wait for the "), bold("Connected"), regular(" status")]],
  [[regular("Sending without reviewing the preview screenshot \u2014 always check the subject line and first paragraph")]],
  [[regular("Closing Chrome while Automat\u03A9r is mid-send \u2014 wait for the progress log to show "), bold("Complete")]],
]));
mainChildren.push(ifThenBox([
  ["Automat\u03A9r can\u2019t find Chrome", "relaunch Chrome with --remote-debugging-port=9222 flag and click Connect again"],
  ["preview screenshot looks wrong", "click Cancel and fix the email content in Mail\u03A9r before retrying"],
  ["send fails mid-way", "check the Kajabi dashboard directly to see if the broadcast was created \u2014 it may have partially sent"],
]));
mainChildren.push(pageBreakPara());

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 4b — ANALYTICS + IMPROVEMENT
// ═══════════════════════════════════════════════════════════════════════════════
mainChildren.push(phaseHeader(4, "ANALYTICS + IMPROVEMENT"), spacerPara(200));

// ─── TOOL 16: AnalΩzr ────────────────────────────────────────────────────────
mainChildren.push(...toolSection("\uD83D\uDCCA", "Anal\u03A9zr", "tool-analytr", "Performance review \u2014 what worked, what to fix, what\u2019s next"));
mainChildren.push(whatItDoes("Anal\u03A9zr pulls your YouTube channel data and shows performance across all videos: views, engagement, completion. Claude reads the data and gives coaching on what\u2019s working, what to improve, and what to make next. The Thumbnail A/B Tester gives you a data-driven winner before you commit."));
mainChildren.push(sectionLabel("STEPS"));
mainChildren.push(step("steps-analytr", [regular("Open "), bold("Anal\u03A9zr"), regular(" from the nav")]));
mainChildren.push(step("steps-analytr", [regular("Section 1 \u2014 Channel Health: view total views, avg views, best performing video, top content topic")]));
mainChildren.push(step("steps-analytr", [regular("Section 2 \u2014 Last 10 Videos: "), bold("green"), regular(" = above average, "), bold("amber"), regular(" = at average, "), bold("red"), regular(" = below average. Click any row to expand.")]));
mainChildren.push(step("steps-analytr", [regular("Click "), bold("Generate Coaching Report"), regular(" \u2014 Claude analyzes your data and generates recommendations")]));
mainChildren.push(step("steps-analytr", [regular("Review the "), bold("ON-CAMERA PERFORMANCE"), regular(" card (amber) first \u2014 this is director-level feedback on your delivery")]));
mainChildren.push(step("steps-analytr", [regular("Review the main coaching card: What\u2019s Working, Areas to Improve, #1 Focus This Week, Trending Topics")]));
mainChildren.push(step("steps-analytr", [regular("Section 5 \u2014 Thumbnail A/B Tester: drag and drop two thumbnails into the upload zones")]));
mainChildren.push(step("steps-analytr", [regular("Add optional context (e.g. \u201croot cellar build video\u201d) and click "), bold("Analyze Thumbnails \u2192")]));
mainChildren.push(step("steps-analytr", [regular("Review scores (0\u201310 across 5 dimensions) and the "), bold("USE THIS ONE \u2713"), regular(" winner badge")]));
mainChildren.push(step("steps-analytr", [regular("Take the coaching insights back to "), bold("Id8\u03A9r"), regular(" to inform your next concept")]));
mainChildren.push(screenshotBox("Anal\u03A9zr \u2014 coaching report and thumbnail A/B results"));
mainChildren.push(tipBox("Run Anal\u03A9zr after every video posts. One coaching session takes 2 minutes and the on-camera feedback alone is worth it \u2014 it surfaces patterns you won\u2019t notice yourself."));
mainChildren.push(ifThenBox([
  ["channel health shows no data", "click Import Entire YouTube Channel in the YouTube Sync section \u2014 this pulls all historical videos"],
  ["coaching report seems generic", "sync YouTube data first so Claude has real view/like/comment numbers to work with"],
  ["A/B test winner isn\u2019t obvious", "read the Weaknesses field on the losing card \u2014 that\u2019s your next iteration"],
]));
mainChildren.push(pageBreakPara());

// ═══════════════════════════════════════════════════════════════════════════════
// COMMON MISTAKES REFERENCE
// ═══════════════════════════════════════════════════════════════════════════════
mainChildren.push(
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [
      new Bookmark({ id: "common-mistakes", children: [new TextRun({ text: "Common Mistakes Reference", font: "Arial", size: 36, bold: true, color: C_TEXT })] })
    ],
    spacing: { before: 360, after: 240 }
  }),
  whatItDoes("These are the mistakes that stop the pipeline cold. Bookmark this page."),
  mistakesBox([
    [[regular("Starting Writ\u03A9r before Pip\u03A9r is marked complete \u2014 the project simply won\u2019t appear in the dropdown")]],
    [[regular("Running Automat\u03A9r without Chrome connected first \u2014 connect Chrome before doing anything else in Automat\u03A9r")]],
    [[regular("Dropping footage in the wrong folder \u2014 it must be D:\\kre8r\\intake or Vault\u03A9r will never see it")]],
    [[regular("Forgetting to Approve the script in Writ\u03A9r before moving to Direct\u03A9r or Gate\u03A9r \u2014 downstream tools read the approved version only")]],
    [[regular("Clicking Send to Pip\u03A9r before the Vision Brief is generated in Id8\u03A9r \u2014 generate the brief first or Pip\u03A9r arrives empty")]],
    [[regular("Refreshing the page during Writ\u03A9r or Mail\u03A9r generation \u2014 use Retry instead, refresh loses the generation context")]],
    [[regular("Closing Chrome mid-send in Automat\u03A9r \u2014 wait for the progress log to show Complete")]],
    [[regular("Editing the .db file directly with sqlite3 while the server is running \u2014 all writes go through the API only")]],
  ]),
  pageBreakPara()
);

// ═══════════════════════════════════════════════════════════════════════════════
// IF/THEN DECISION GUIDE
// ═══════════════════════════════════════════════════════════════════════════════
mainChildren.push(
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [
      new Bookmark({ id: "ifthen-guide", children: [new TextRun({ text: "If/Then Decision Guide", font: "Arial", size: 36, bold: true, color: C_TEXT })] })
    ],
    spacing: { before: 360, after: 240 }
  }),
  whatItDoes("Use this when something isn\u2019t working as expected. Find your situation in the IF column and follow the THEN instruction."),
  ifThenBox([
    ["project doesn\u2019t appear in Writ\u03A9r dropdown", "go to Pip\u03A9r, open the project, complete the beat map, and click Send to Writ\u03A9r"],
    ["Writ\u03A9r gives a network error on Generate", "click Retry \u2014 do not refresh the page, that loses the generation context"],
    ["Automat\u03A9r can\u2019t find Chrome", "relaunch Chrome with: chrome.exe --remote-debugging-port=9222 then click Connect Chrome"],
    ["Compos\u03A9r shows generating spinner that never resolves", "the composor_state is stalled \u2014 reset it via POST /api/composor/reset/[project_id]"],
    ["Vault\u03A9r doesn\u2019t detect footage", "confirm the file is in D:\\kre8r\\intake and check pm2 status in terminal"],
    ["Suno automation fails in Compos\u03A9r", "use the manual workflow: Copy Prompt button + Open Suno link for each scene"],
    ["a project shows wrong state / stuck", "check pm2 logs kre8r for errors \u2014 most state issues resolve with pm2 restart kre8r"],
    ["Telepr\u03A9mpter remote won\u2019t connect", "confirm all devices are on the same wifi \u2014 the session code must match exactly"],
    ["Anal\u03A9zr shows no channel data", "run YouTube channel import from the YouTube Sync section \u2014 first-time setup step"],
    ["BRAW footage isn\u2019t being classified", "export a proxy from DaVinci first (H.264 MP4, named with _proxy.mp4 suffix) into D:\\kre8r\\intake"],
    ["Caption\u03A9r or Package\u03A9r won\u2019t unlock", "check that Gate\u03A9r has all elements marked Approved for this project"],
    ["Script voice sounds wrong", "go back to Writ\u03A9r, adjust the voice blend slider, and regenerate \u2014 the approved version is preserved until you approve the new one"],
  ]),
  pageBreakPara()
);

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE QUICK REFERENCE
// ═══════════════════════════════════════════════════════════════════════════════
const quickRefRows = [
  ["Id8\u03A9r",         "Vision Brief",              "Pip\u03A9r (arrives pre-filled)"],
  ["Pip\u03A9r",         "Beat Map",                  "Writ\u03A9r, Direct\u03A9r, ShootDay, Edit\u03A9r"],
  ["Writ\u03A9r",        "Approved Script",           "Direct\u03A9r, Edit\u03A9r, Caption\u03A9r, Gate\u03A9r"],
  ["Direct\u03A9r",      "Crew Brief PDF + QR",       "ShootDay offline package"],
  ["ShootDay",           "Take notes + coverage",     "Production awareness on location"],
  ["Telepr\u03A9mpter",  "On-set script display",     "Clean takes with eye contact"],
  ["Vault\u03A9r",       "Classified footage DB",     "Edit\u03A9r clip selection"],
  ["Edit\u03A9r",        "Clip selections per beat",  "Review\u03A9r rough cut approval"],
  ["Review\u03A9r",      "Approved rough cut",        "Compos\u03A9r, distribution tools"],
  ["Compos\u03A9r",      "Scored timeline in DaVinci","Final edit with music locked"],
  ["Gate\u03A9r",        "Content approval",          "Package\u03A9r, Caption\u03A9r, Mail\u03A9r"],
  ["Package\u03A9r",     "Platform metadata",         "Caption\u03A9r, Mail\u03A9r"],
  ["Caption\u03A9r",     "Platform captions",         "Direct posting"],
  ["Mail\u03A9r",        "Email + community post",    "Automat\u03A9r broadcast"],
  ["Automat\u03A9r",     "Sent Kajabi broadcast",     "Community notified"],
  ["Anal\u03A9zr",       "Coaching report + A/B winner", "Next Id8\u03A9r session"],
];

mainChildren.push(
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [
      new Bookmark({ id: "quick-ref", children: [new TextRun({ text: "Pipeline Quick Reference", font: "Arial", size: 36, bold: true, color: C_TEXT })] })
    ],
    spacing: { before: 360, after: 240 }
  }),
  whatItDoes("One-line summary of each tool\u2019s job and its single most important output."),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1400, 2800, 5160],
    rows: [
      // Header
      new TableRow({
        children: [
          new TableCell({
            width: { size: 1400, type: WidthType.DXA },
            shading: { fill: C_DARK_BG, type: ShadingType.CLEAR, color: "auto" },
            borders: noBorder(),
            margins: { top: 120, bottom: 120, left: 200, right: 200 },
            children: [new Paragraph({ children: [new TextRun({ text: "TOOL", font: "Arial", size: 20, bold: true, color: C_TEAL })] })]
          }),
          new TableCell({
            width: { size: 2800, type: WidthType.DXA },
            shading: { fill: C_DARK_BG, type: ShadingType.CLEAR, color: "auto" },
            borders: noBorder(),
            margins: { top: 120, bottom: 120, left: 200, right: 200 },
            children: [new Paragraph({ children: [new TextRun({ text: "OUTPUT", font: "Arial", size: 20, bold: true, color: C_TEAL })] })]
          }),
          new TableCell({
            width: { size: 5160, type: WidthType.DXA },
            shading: { fill: C_DARK_BG, type: ShadingType.CLEAR, color: "auto" },
            borders: noBorder(),
            margins: { top: 120, bottom: 120, left: 200, right: 200 },
            children: [new Paragraph({ children: [new TextRun({ text: "WHAT IT UNLOCKS", font: "Arial", size: 20, bold: true, color: C_TEAL })] })]
          }),
        ]
      }),
      // Data rows
      ...quickRefRows.map(([tool, output, unlocks], i) => {
        const bg = i % 2 === 0 ? "F9FAFB" : C_WHITE;
        return new TableRow({
          children: [
            new TableCell({
              width: { size: 1400, type: WidthType.DXA },
              shading: { fill: bg, type: ShadingType.CLEAR, color: "auto" },
              borders: singleBorder("E5E7EB"),
              margins: { top: 100, bottom: 100, left: 200, right: 200 },
              children: [new Paragraph({ children: [new TextRun({ text: tool, font: "Arial", size: 20, bold: true, color: C_TEAL })] })]
            }),
            new TableCell({
              width: { size: 2800, type: WidthType.DXA },
              shading: { fill: bg, type: ShadingType.CLEAR, color: "auto" },
              borders: singleBorder("E5E7EB"),
              margins: { top: 100, bottom: 100, left: 200, right: 200 },
              children: [new Paragraph({ children: [new TextRun({ text: output, font: "Arial", size: 20, color: C_TEXT })] })]
            }),
            new TableCell({
              width: { size: 5160, type: WidthType.DXA },
              shading: { fill: bg, type: ShadingType.CLEAR, color: "auto" },
              borders: singleBorder("E5E7EB"),
              margins: { top: 100, bottom: 100, left: 200, right: 200 },
              children: [new Paragraph({ children: [new TextRun({ text: unlocks, font: "Arial", size: 20, color: C_GRAY })] })]
            }),
          ]
        });
      })
    ]
  })
);

// ─── BUILD DOCUMENT ───────────────────────────────────────────────────────────
const doc = new Document({
  numbering: {
    config: numberingConfig
  },
  styles: {
    default: {
      document: {
        run: { font: "Arial", size: 24, color: C_TEXT }
      }
    },
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: "Arial", size: 36, bold: true, color: C_TEXT },
        paragraph: {
          spacing: { before: 360, after: 240 },
          outlineLevel: 0
        }
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: "Arial", size: 28, bold: true, color: C_TEAL },
        paragraph: {
          spacing: { before: 320, after: 160 },
          outlineLevel: 1
        }
      },
      {
        id: "Heading3",
        name: "Heading 3",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: "Arial", size: 24, bold: true, color: C_TEXT },
        paragraph: {
          spacing: { before: 200, after: 120 },
          outlineLevel: 2
        }
      }
    ]
  },
  sections: [
    // Section 1: Cover (no header/footer)
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }
        }
      },
      children: coverChildren
    },
    // Section 2: Main content (with header and footer)
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }
        }
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: "KRE8\u03A9R PRODUCTION RUNBOOK", font: "Arial", size: 20, color: C_GRAY }),
                new TextRun({ text: "\t", font: "Arial", size: 20, color: C_GRAY }),
                new SimpleField("PAGE"),
              ],
              tabStops: [{ type: "right", position: 9360 }]
            })
          ]
        })
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: "7 Kin Homestead", font: "Arial", size: 18, color: C_GRAY }),
                new TextRun({ text: "\tPage ", font: "Arial", size: 18, color: C_GRAY }),
                new SimpleField("PAGE"),
              ],
              tabStops: [{ type: "right", position: 9360 }]
            })
          ]
        })
      },
      children: mainChildren
    }
  ]
});

// ─── POST-PROCESS: Fix duplicate bookmark IDs ─────────────────────────────────
// docx v9 assigns id=1 to every Bookmark; we fix them to be unique after packing
function fixBookmarkIds(buffer) {
  const JSZip = require('docx/node_modules/jszip') || (() => {
    try { return require('jszip'); } catch(e) { return null; }
  })();
  // If we can't get JSZip, try using adm-zip or just re-read the buffer
  // The simplest approach: parse the zip, fix document.xml, repack
  const { execSync } = require('child_process');
  const tmpDir = require('os').tmpdir();
  const tmpDocx = path.join(tmpDir, 'runbook_tmp.docx');
  const tmpExtract = path.join(tmpDir, 'runbook_extract');

  fs.writeFileSync(tmpDocx, buffer);

  // Use Python to fix the bookmark IDs
  const pythonScript = `
import zipfile, re, os, shutil
src = r'${tmpDocx.replace(/\\/g, '\\\\')}'
dst = r'${OUTPUT_PATH.replace(/\\/g, '\\\\')}'
extract_dir = r'${tmpExtract.replace(/\\/g, '\\\\')}'

if os.path.exists(extract_dir):
    shutil.rmtree(extract_dir)
os.makedirs(extract_dir)

with zipfile.ZipFile(src, 'r') as zf:
    zf.extractall(extract_dir)

doc_path = os.path.join(extract_dir, 'word', 'document.xml')
with open(doc_path, 'rb') as f:
    content = f.read().decode('utf-8')

# Fix w:id attributes in bookmarkStart and bookmarkEnd to be sequential
counter = [0]
def replace_id(m):
    counter[0] += 1
    return m.group(0).replace(m.group(1), str(counter[0]))

# Replace w:id="1" in bookmarkStart
content = re.sub(r'(<w:bookmarkStart[^>]*w:id=")([^"]*)"', lambda m: m.group(0).replace(m.group(2), str(counter.__setitem__(0, counter[0]+1) or counter[0])), content)

# Better approach: find all w:id= in bookmarks and renumber
import re as r2
# First pass: collect all unique bookmark tag positions
bm_id = [0]
def next_bm_id(m):
    bm_id[0] += 1
    tag = m.group(0)
    return re.sub(r'w:id="[^"]*"', f'w:id="{bm_id[0]}"', tag, count=1)

content = re.sub(r'<w:bookmarkStart[^/]*/>', next_bm_id, content)
content = re.sub(r'<w:bookmarkEnd[^/]*/>', next_bm_id, content)

with open(doc_path, 'w', encoding='utf-8') as f:
    f.write(content)

with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zf_out:
    for root, dirs, files in os.walk(extract_dir):
        for file in files:
            file_path = os.path.join(root, file)
            arcname = os.path.relpath(file_path, extract_dir)
            zf_out.write(file_path, arcname)

shutil.rmtree(extract_dir)
print('fixed')
`;

  const result = execSync(`python -c "${pythonScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    encoding: 'utf8',
    timeout: 30000
  });
  console.log('Bookmark fix:', result.trim());
}

// ─── WRITE FILE ───────────────────────────────────────────────────────────────
async function main() {
  const buffer = await Packer.toBuffer(doc);
  // Write temp file first, then fix bookmark IDs
  const tmpPath = OUTPUT_PATH + '.tmp';
  fs.writeFileSync(tmpPath, buffer);

  // Post-process to fix duplicate bookmark IDs using Python
  const { execSync } = require('child_process');
  const tmpDir = require('os').tmpdir();
  const tmpExtract = path.join(tmpDir, 'runbook_extract');

  const pythonCode = [
    "import zipfile, re, os, shutil",
    `src = r'${tmpPath.replace(/\\/g, '/')}'`,
    `dst = r'${OUTPUT_PATH.replace(/\\/g, '/')}'`,
    `extract_dir = r'${tmpExtract.replace(/\\/g, '/')}'`,
    "if os.path.exists(extract_dir): shutil.rmtree(extract_dir)",
    "os.makedirs(extract_dir)",
    "zf = zipfile.ZipFile(src, 'r'); zf.extractall(extract_dir); zf.close()",
    "doc_path = os.path.join(extract_dir, 'word', 'document.xml')",
    "content = open(doc_path, 'rb').read().decode('utf-8')",
    "bm_id = [0]",
    "def next_id(m):",
    "    bm_id[0] += 1",
    "    return re.sub(r'w:id=\"[^\"]*\"', 'w:id=\"' + str(bm_id[0]) + '\"', m.group(0), count=1)",
    "content = re.sub(r'<w:bookmarkStart[^/]*/>', next_id, content)",
    "content = re.sub(r'<w:bookmarkEnd[^/]*/>', next_id, content)",
    "open(doc_path, 'w', encoding='utf-8').write(content)",
    "zf_out = zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED)",
    "for root, dirs, files in os.walk(extract_dir):",
    "    for file in files:",
    "        fp = os.path.join(root, file)",
    "        zf_out.write(fp, os.path.relpath(fp, extract_dir))",
    "zf_out.close()",
    "shutil.rmtree(extract_dir)",
    "os.remove(src)",
    "print('bookmark ids fixed')",
  ].join('\n');

  const tmpPy = path.join(tmpDir, 'fix_bookmarks.py');
  fs.writeFileSync(tmpPy, pythonCode);

  try {
    const result = execSync(`python "${tmpPy}"`, { encoding: 'utf8', timeout: 30000 });
    console.log(result.trim());
  } catch(e) {
    // If fix fails, just use original buffer
    console.warn('Bookmark fix failed, using original:', e.message);
    fs.writeFileSync(OUTPUT_PATH, buffer);
  }

  const stats = fs.statSync(OUTPUT_PATH);
  console.log(`Written: ${OUTPUT_PATH}`);
  console.log(`Size: ${(stats.size / 1024).toFixed(1)} KB`);
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
