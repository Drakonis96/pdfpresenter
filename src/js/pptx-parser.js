const JSZip = require('jszip');
const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');

/**
 * Extract presenter notes from a .pptx file.
 * PPTX is a ZIP containing XML files. Notes are in ppt/notesSlides/notesSlideN.xml
 */
async function extractNotes(pptxPath) {
  const data = fs.readFileSync(pptxPath);
  const zip = await JSZip.loadAsync(data);
  
  const notes = {};
  
  // Find all notesSlide files
  const noteFiles = Object.keys(zip.files)
    .filter(name => name.match(/^ppt\/notesSlides\/notesSlide\d+\.xml$/))
    .sort((a, b) => {
      const numA = parseInt(a.match(/notesSlide(\d+)/)[1]);
      const numB = parseInt(b.match(/notesSlide(\d+)/)[1]);
      return numA - numB;
    });

  // We need to figure out which notesSlide corresponds to which slide
  // Check the relationships in ppt/notesSlides/_rels/
  // Or simply: notesSlideN.xml corresponds to slide N (this is the standard mapping)
  
  // However, the more reliable approach is through relationships:
  // ppt/slides/_rels/slideN.xml.rels contains a reference to the notesSlide
  
  // Let's first try the relationship approach
  const slideRelsDir = 'ppt/slides/_rels/';
  const slideFiles = Object.keys(zip.files)
    .filter(name => name.match(/^ppt\/slides\/slide\d+\.xml$/))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)[1]);
      const numB = parseInt(b.match(/slide(\d+)/)[1]);
      return numA - numB;
    });

  for (let i = 0; i < slideFiles.length; i++) {
    const slideFile = slideFiles[i];
    const slideNum = i + 1;
    const relsFile = slideRelsDir + path.basename(slideFile) + '.rels';
    
    if (!zip.files[relsFile]) continue;
    
    const relsXml = await zip.files[relsFile].async('string');
    const relsResult = await xml2js.parseStringPromise(relsXml);
    
    if (!relsResult.Relationships || !relsResult.Relationships.Relationship) continue;
    
    const noteRel = relsResult.Relationships.Relationship.find(r => 
      r.$.Type && r.$.Type.includes('notesSlide')
    );
    
    if (!noteRel) continue;
    
    // Resolve the target path
    const target = noteRel.$.Target;
    let notePath;
    if (target.startsWith('/')) {
      notePath = target.substring(1);
    } else {
      notePath = path.posix.join('ppt/slides', target).replace(/\\/g, '/');
      // Normalize: ppt/slides/../notesSlides/notesSlide1.xml -> ppt/notesSlides/notesSlide1.xml
      notePath = normalizePath(notePath);
    }
    
    if (!zip.files[notePath]) continue;
    
    const noteXml = await zip.files[notePath].async('string');
    const noteText = await extractTextFromNoteXml(noteXml);
    
    if (noteText.trim()) {
      notes[slideNum] = noteText.trim();
    }
  }
  
  return { notes, totalSlides: slideFiles.length };
}

function normalizePath(p) {
  const parts = p.split('/');
  const result = [];
  for (const part of parts) {
    if (part === '..') {
      result.pop();
    } else if (part !== '.') {
      result.push(part);
    }
  }
  return result.join('/');
}

async function extractTextFromNoteXml(xml) {
  // Pre-process: convert a:br (line break) elements to text runs with newline,
  // so that Shift+Enter line breaks from PowerPoint are preserved.
  const processedXml = xml.replace(/<a:br\b[^/>]*\/>/g, '<a:r><a:t>\n</a:t></a:r>')
    .replace(/<a:br\b[^>]*>[\s\S]*?<\/a:br>/g, '<a:r><a:t>\n</a:t></a:r>');

  const result = await xml2js.parseStringPromise(processedXml, { explicitArray: true });

  try {
    const cSld = result['p:notes']?.['p:cSld'];
    if (!cSld) return '';

    const spTree = cSld[0]?.['p:spTree'];
    if (!spTree) return '';

    const shapes = spTree[0]?.['p:sp'] || [];

    for (const sp of shapes) {
      const nvSpPr = sp['p:nvSpPr'];
      if (nvSpPr) {
        const nvPr = nvSpPr[0]?.['p:nvPr'];
        if (nvPr) {
          const ph = nvPr[0]?.['p:ph'];
          if (ph && (ph[0]?.$?.type === 'body' || (ph[0]?.$?.idx && !ph[0]?.$?.type))) {
            const text = extractParagraphsFromTxBody(sp['p:txBody']);
            if (text.trim()) return text;
          }
        }
      }
    }

    // Fallback: try all text bodies
    for (const sp of shapes) {
      if (sp['p:txBody']) {
        const text = extractParagraphsFromTxBody(sp['p:txBody']);
        if (text.trim() && !/^\d+$/.test(text.trim())) {
          return text;
        }
      }
    }
  } catch (err) {
    return '';
  }

  return '';
}

function extractParagraphsFromTxBody(txBody) {
  if (!txBody || !txBody[0]) return '';

  const paragraphs = txBody[0]['a:p'] || [];
  const lines = [];

  for (const p of paragraphs) {
    const runs = p['a:r'] || [];
    let paraText = '';

    for (const r of runs) {
      const tElements = r['a:t'] || [];
      for (const t of tElements) {
        if (typeof t === 'string') paraText += t;
        else if (t && t._) paraText += t._;
      }
    }

    lines.push(paraText);
  }

  return lines.join('\n');
}

module.exports = { extractNotes };
