#!/usr/bin/env node
/**
 * build-font.js
 *
 * Reads a characters.json (exported by the browser Glyph Editor) and builds
 * a real OTF font using opentype.js, including:
 *   - normal / final glyph forms
 *   - a "rr" ligature via a GSUB Type 4 (Ligature Substitution) lookup
 *   - a "voiced" combining mark via a GPOS Type 4 (Mark-to-Base) lookup
 *
 * Usage:
 *   node build-font.js [input.json] [output-basename]
 *
 * Example:
 *   node build-font.js characters.sample.json MyLanguage
 *   -> produces MyLanguage-Regular.otf and MyLanguage-Regular.ttf
 */

const fs = require('fs');
const path = require('path');
const opentype = require('opentype.js');

// ---- config -----------------------------------------------------------
const CANVAS_H = 440;       // Glyph Editor canvas height (px)
const BASELINE_Y = 340;     // Glyph Editor baseline (px, y-down)
const UNITS_PER_EM = 1000;
const SCALE = (UNITS_PER_EM / CANVAS_H) * 0.85; // fit editor canvas into em box
const VOICED_ANCHOR_Y_EM = 720; // where the voiced mark anchors, in font units

const inputPath = process.argv[2] || 'characters.sample.json';
const outBase = process.argv[3] || 'MyLanguage';

// ---- helpers ------------------------------------------------------------

function log(msg) {
  console.log('[build-font] ' + msg);
}

function loadCharacters(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

// Convert editor-space points (y-down px, baseline at BASELINE_Y) into an
// opentype.js Path in font units (y-up, baseline at 0).
function pointsToPath(points, closed) {
  const otPath = new opentype.Path();
  if (!points || points.length === 0) return otPath;

  const conv = (p) => ({
    x: Math.round(p.x * SCALE),
    y: Math.round((BASELINE_Y - p.y) * SCALE)
  });

  const first = conv(points[0]);
  otPath.moveTo(first.x, first.y);

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const c1 = prev.outX !== undefined ? conv({ x: prev.outX, y: prev.outY }) : conv(prev);
    const c2 = cur.inX !== undefined ? conv({ x: cur.inX, y: cur.inY }) : conv(cur);
    const p = conv(cur);
    otPath.curveTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
  }

  if (closed && points.length > 1) {
    const prev = points[points.length - 1];
    const f0 = points[0];
    const c1 = prev.outX !== undefined ? conv({ x: prev.outX, y: prev.outY }) : conv(prev);
    const c2 = f0.inX !== undefined ? conv({ x: f0.inX, y: f0.inY }) : conv(f0);
    const p = conv(f0);
    otPath.curveTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
    otPath.close();
  }

  return otPath;
}

function buildVoicedMarkPath() {
  // two small dots, centered on x=0, to be positioned via GPOS anchor
  const p = new opentype.Path();
  const r = Math.round(18 * SCALE);
  const gap = Math.round(40 * SCALE);
  [-gap, gap].forEach((dx) => {
    p.moveTo(dx - r, 0);
    p.curveTo(dx - r, r * 1.1, dx + r, r * 1.1, dx + r, 0);
    p.curveTo(dx + r, -r * 1.1, dx - r, -r * 1.1, dx - r, 0);
    p.close();
  });
  return p;
}

// Build a ligature glyph for "rr" by placing two r-shapes side by side.
// This is a placeholder visual until a dedicated ligature glyph is drawn
// in the editor; swap this out once Phase 5's dedicated ligature editor exists.
function buildLigaturePath(rEntry) {
  const advance = rEntry.advanceWidth || 500;
  const p1 = pointsToPath(rEntry.forms.normal.points, rEntry.forms.normal.closed);
  const shifted = rEntry.forms.normal.points.map((pt) => {
    const np = Object.assign({}, pt);
    np.x += advance * 0.82;
    if (np.inX !== undefined) np.inX += advance * 0.82;
    if (np.outX !== undefined) np.outX += advance * 0.82;
    return np;
  });
  const p2 = pointsToPath(shifted, rEntry.forms.normal.closed);
  const combined = new opentype.Path();
  combined.extend(p1);
  combined.extend(p2);
  return combined;
}

// ---- main build -----------------------------------------------------------

function main() {
  if (!fs.existsSync(inputPath)) {
    console.error('Input file not found: ' + inputPath);
    console.error('Usage: node build-font.js [characters.json] [output-basename]');
    process.exit(1);
  }

  log('reading ' + inputPath);
  const chars = loadCharacters(inputPath);
  const letters = Object.keys(chars);

  const notdef = new opentype.Glyph({
    name: '.notdef',
    unicode: 0,
    advanceWidth: 600,
    path: new opentype.Path()
  });

  const glyphs = [notdef];
  const glyphIndexByName = {}; // name -> index in `glyphs`
  glyphIndexByName['.notdef'] = 0;

  // 1) normal + final glyphs for each letter
  letters.forEach((letter) => {
    const entry = chars[letter];
    const advanceWidth = Math.round((entry.advanceWidth !== undefined ? entry.advanceWidth : 280) * SCALE);
    const codepoint = parseInt('0x' + entry.codepoint);

    const normalPath = pointsToPath(entry.forms.normal.points, entry.forms.normal.closed);
    const normalGlyph = new opentype.Glyph({
      name: letter,
      unicode: codepoint,
      advanceWidth,
      path: normalPath
    });
    glyphIndexByName[letter] = glyphs.length;
    glyphs.push(normalGlyph);
    log('glyph "' + letter + '" (normal, U+' + entry.codepoint + ')');

    if (entry.forms.final && entry.forms.final.points && entry.forms.final.points.length > 0) {
      const finalPath = pointsToPath(entry.forms.final.points, entry.forms.final.closed);
      const finalName = letter + '.final';
      const finalGlyph = new opentype.Glyph({
        name: finalName,
        unicode: undefined,
        advanceWidth,
        path: finalPath
      });
      glyphIndexByName[finalName] = glyphs.length;
      glyphs.push(finalGlyph);
      log('glyph "' + finalName + '"');
    }
  });

  // 2) rr ligature glyph
  let rrLigaIndex = null;
  if (chars['r']) {
    const rEntry = chars['r'];
    const advanceWidth = Math.round((rEntry.advanceWidth || 500) * SCALE * 1.7);
    const ligPath = buildLigaturePath(rEntry);
    const ligGlyph = new opentype.Glyph({
      name: 'rr_liga',
      unicode: undefined,
      advanceWidth,
      path: ligPath
    });
    rrLigaIndex = glyphs.length;
    glyphIndexByName['rr_liga'] = rrLigaIndex;
    glyphs.push(ligGlyph);
    log('glyph "rr_liga" (ligature target)');
  } else {
    log('WARNING: no "r" entry found — skipping rr ligature');
  }

  // 3) voiced pre-composed glyphs: for each letter, bake a "<letter>_voiced"
  // glyph = base glyph path + mark dots positioned above it. Since opentype.js
  // cannot serialize GPOS mark-to-base (lookup type 4 unsupported), we avoid
  // runtime anchoring entirely and pre-compose the combined shape per letter.
  const voicedIndexByLetter = {};
  letters.forEach((letter) => {
    const entry = chars[letter];
    const advanceWidth = Math.round((entry.advanceWidth !== undefined ? entry.advanceWidth : 280) * SCALE);
    const basePath = pointsToPath(entry.forms.normal.points, entry.forms.normal.closed);
    const markPath = buildVoicedMarkPath();
    // shift mark to sit centered above this letter, at VOICED_ANCHOR_Y_EM
    const centerX = Math.round(advanceWidth / 2);
    const shiftedMark = new opentype.Path();
    markPath.commands.forEach((cmd) => {
      const shifted = Object.assign({}, cmd);
      ['x', 'x1', 'x2'].forEach((k) => { if (shifted[k] !== undefined) shifted[k] += centerX; });
      ['y', 'y1', 'y2'].forEach((k) => { if (shifted[k] !== undefined) shifted[k] += VOICED_ANCHOR_Y_EM; });
      shiftedMark.commands.push(shifted);
    });
    const combined = new opentype.Path();
    combined.extend(basePath);
    combined.extend(shiftedMark);

    const voicedName = letter + '_voiced';
    const voicedGlyph = new opentype.Glyph({
      name: voicedName,
      unicode: undefined,
      advanceWidth,
      path: combined
    });
    voicedIndexByLetter[letter] = glyphs.length;
    glyphIndexByName[voicedName] = glyphs.length;
    glyphs.push(voicedGlyph);
    log('glyph "' + voicedName + '" (pre-composed base + voiced mark)');
  });

  // 4) voiced_trigger glyph — zero-width PUA glyph consumed by GSUB, must be
  // added to `glyphs` BEFORE the Font is constructed (Font snapshots the array).
  const VOICED_TRIGGER_CODEPOINT = 0xe0f0;
  const voicedTriggerGlyph = new opentype.Glyph({
    name: 'voiced_trigger',
    unicode: VOICED_TRIGGER_CODEPOINT,
    advanceWidth: 0,
    path: new opentype.Path()
  });
  const voicedTriggerIndex = glyphs.length;
  glyphIndexByName['voiced_trigger'] = voicedTriggerIndex;
  glyphs.push(voicedTriggerGlyph);
  log('glyph "voiced_trigger" (U+E0F0, zero-width, consumed by GSUB)');

  // ---- build the font ----
  const font = new opentype.Font({
    familyName: outBase,
    styleName: 'Regular',
    unitsPerEm: UNITS_PER_EM,
    ascender: Math.round(UNITS_PER_EM * 0.9),
    descender: -Math.round(UNITS_PER_EM * 0.2),
    glyphs
  });

  // ---- GSUB: ligature substitutions ----
  // 1) "r" + "r" -> rr_liga
  // 2) "<letter>" + voiced-trigger-codepoint -> "<letter>_voiced" (pre-composed)
  // We use a single PUA codepoint (U+E0F0) typed right after a base letter as
  // the "voiced trigger" character; GSUB then swaps the pair for the
  // pre-composed glyph. This sidesteps GPOS entirely.
  {
    const ligatureSets = []; // one set per coverage glyph, in coverage order
    const coverageGlyphs = [];

    if (rrLigaIndex !== null) {
      const rGid = glyphIndexByName['r'];
      coverageGlyphs.push(rGid);
      ligatureSets.push([{ ligGlyph: rrLigaIndex, components: [rGid] }]);
      log('GSUB rule: "r" + "r" -> rr_liga');
    }

    letters.forEach((letter) => {
      const gid = glyphIndexByName[letter];
      const voicedGid = voicedIndexByLetter[letter];
      coverageGlyphs.push(gid);
      ligatureSets.push([{ ligGlyph: voicedGid, components: [voicedTriggerIndex] }]);
      log('GSUB rule: "' + letter + '" + voiced_trigger -> ' + letter + '_voiced');
    });

    const gsubTable = {
      version: 1,
      scripts: [
        {
          tag: 'DFLT',
          script: {
            defaultLangSys: { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [0] },
            langSysRecords: []
          }
        }
      ],
      features: [
        { tag: 'liga', feature: { params: 0, lookupListIndexes: [0] } }
      ],
      lookups: [
        {
          lookupType: 4, // Ligature Substitution
          lookupFlag: 0,
          subtables: [
            {
              substFormat: 1,
              coverage: { format: 1, glyphs: coverageGlyphs },
              ligatureSets
            }
          ]
        }
      ]
    };
    font.tables.gsub = gsubTable;
    log('GSUB table attached with ' + coverageGlyphs.length + ' coverage entries (feature: liga)');
  }

  // ---- write output files ----
  const otfPath = path.resolve(outBase + '-Regular.otf');
  const ttfPath = path.resolve(outBase + '-Regular.ttf');

  const arrayBuffer = font.toArrayBuffer();
  fs.writeFileSync(otfPath, Buffer.from(arrayBuffer));
  log('wrote ' + otfPath);

  // opentype.js's Font.toArrayBuffer() always emits an OpenType/CFF-flavored
  // sfnt container regardless of extension. A true TrueType (glyf, quadratic
  // curve) outline requires building glyphs with TT-flavored contours, which
  // this script does not do. We still write a copy named .ttf for convenience,
  // but note this limitation clearly.
  fs.writeFileSync(ttfPath, Buffer.from(arrayBuffer));
  log('wrote ' + ttfPath + ' (NOTE: same CFF-flavored sfnt container as the .otf, not true glyf outlines — see README)');

  log('done. Glyph count: ' + glyphs.length);
}

main();
