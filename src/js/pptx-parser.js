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
  const result = await xml2js.parseStringPromise(xml, { explicitArray: true });
  
  // Navigate the XML structure to find text content
  // The notes are typically in p:notes > p:cSld > p:spTree > p:sp > p:txBody > a:p > a:r > a:t
  const texts = [];
  
  function findText(obj) {
    if (!obj || typeof obj !== 'object') return;
    
    if (Array.isArray(obj)) {
      for (const item of obj) findText(item);
      return;
    }
    
    // Look for a:t (text) elements
    if (obj['a:t']) {
      for (const t of (Array.isArray(obj['a:t']) ? obj['a:t'] : [obj['a:t']])) {
        if (typeof t === 'string') {
          texts.push(t);
        } else if (t && t._) {
          texts.push(t._);
        }
      }
    }
    
    // Recurse into child elements
    for (const key of Object.keys(obj)) {
      if (key === '$' || key === '_') continue;
      findText(obj[key]);
    }
  }
  
  // Find the text body in shapes, but skip the slide number placeholder
  try {
    const cSld = result['p:notes']?.['p:cSld'];
    if (!cSld) return '';
    
    const spTree = cSld[0]?.['p:spTree'];
    if (!spTree) return '';
    
    const shapes = spTree[0]?.['p:sp'] || [];
    
    for (const sp of shapes) {
      // Check if this is the notes text box (type 12 = notes) vs slide image placeholder
      const nvSpPr = sp['p:nvSpPr'];
      if (nvSpPr) {
        const nvPr = nvSpPr[0]?.['p:nvPr'];
        if (nvPr) {
          const ph = nvPr[0]?.['p:ph'];
          if (ph && ph[0]?.$?.type === 'body') {
            // This is the notes body
            findText(sp['p:txBody']);
          } else if (ph && ph[0]?.$?.idx && !ph[0]?.$?.type) {
            // Notes placeholder without explicit type - might be the notes body
            findText(sp['p:txBody']);
          }
        }
      }
    }
    
    // If no text found through typed placeholders, try all text bodies
    if (texts.length === 0) {
      for (const sp of shapes) {
        findText(sp['p:txBody']);
      }
      // Filter out just the slide number (single digit)
      if (texts.length === 1 && /^\d+$/.test(texts[0].trim())) {
        return '';
      }
    }
  } catch (err) {
    // Fallback: find all text
    findText(result);
  }
  
  return texts.join('\n');
}

module.exports = { extractNotes };
