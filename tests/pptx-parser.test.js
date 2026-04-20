const { extractNotes } = require('../src/js/pptx-parser');
const JSZip = require('jszip');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Helper: create a minimal PPTX (ZIP) with notes
async function createTestPptx(notes = {}) {
  const zip = new JSZip();

  // Content types
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="xml" ContentType="application/xml"/>
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    </Types>`);

  // Required rels
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
    </Relationships>`);

  // Presentation
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);

  const slideCount = Math.max(1, ...Object.keys(notes).map(Number));

  for (let i = 1; i <= slideCount; i++) {
    // Slide file
    zip.file(`ppt/slides/slide${i}.xml`, `<?xml version="1.0" encoding="UTF-8"?>
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);

    if (notes[i]) {
      // Slide rels pointing to notes
      zip.file(`ppt/slides/_rels/slide${i}.xml.rels`, `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${i}.xml"/>
        </Relationships>`);

      // Notes slide
      zip.file(`ppt/notesSlides/notesSlide${i}.xml`, `<?xml version="1.0" encoding="UTF-8"?>
        <p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:cSld>
            <p:spTree>
              <p:sp>
                <p:nvSpPr>
                  <p:cNvPr id="2" name="Notes"/>
                  <p:cNvSpPr/>
                  <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
                </p:nvSpPr>
                <p:txBody>
                  <a:p><a:r><a:t>${notes[i]}</a:t></a:r></a:p>
                </p:txBody>
              </p:sp>
            </p:spTree>
          </p:cSld>
        </p:notes>`);
    } else {
      // Slide rels without notes
      zip.file(`ppt/slides/_rels/slide${i}.xml.rels`, `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        </Relationships>`);
    }
  }

  return zip;
}

// Helper: create PPTX with raw txBody XML for testing paragraph/line break structures
async function createTestPptxWithRawNotes(rawTxBodyMap) {
  const zip = new JSZip();

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="xml" ContentType="application/xml"/>
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    </Types>`);

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
    </Relationships>`);

  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);

  const slideCount = Math.max(1, ...Object.keys(rawTxBodyMap).map(Number));

  for (let i = 1; i <= slideCount; i++) {
    zip.file(`ppt/slides/slide${i}.xml`, `<?xml version="1.0" encoding="UTF-8"?>
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);

    if (rawTxBodyMap[i]) {
      zip.file(`ppt/slides/_rels/slide${i}.xml.rels`, `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${i}.xml"/>
        </Relationships>`);

      zip.file(`ppt/notesSlides/notesSlide${i}.xml`, `<?xml version="1.0" encoding="UTF-8"?>
        <p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:cSld>
            <p:spTree>
              <p:sp>
                <p:nvSpPr>
                  <p:cNvPr id="2" name="Notes"/>
                  <p:cNvSpPr/>
                  <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
                </p:nvSpPr>
                <p:txBody>
                  ${rawTxBodyMap[i]}
                </p:txBody>
              </p:sp>
            </p:spTree>
          </p:cSld>
        </p:notes>`);
    } else {
      zip.file(`ppt/slides/_rels/slide${i}.xml.rels`, `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        </Relationships>`);
    }
  }

  return zip;
}

describe('PPTX Parser', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-test-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('extracts notes from a single slide', async () => {
    const zip = await createTestPptx({ 1: 'Hello from slide 1' });
    const pptxPath = path.join(tmpDir, 'single.pptx');
    fs.writeFileSync(pptxPath, await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await extractNotes(pptxPath);
    expect(result.notes).toHaveProperty('1', 'Hello from slide 1');
    expect(result.totalSlides).toBe(1);
  });

  test('extracts notes from multiple slides', async () => {
    const zip = await createTestPptx({
      1: 'Note for slide 1',
      2: 'Note for slide 2',
      3: 'Note for slide 3',
    });
    const pptxPath = path.join(tmpDir, 'multi.pptx');
    fs.writeFileSync(pptxPath, await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await extractNotes(pptxPath);
    expect(Object.keys(result.notes).length).toBe(3);
    expect(result.notes['1']).toBe('Note for slide 1');
    expect(result.notes['2']).toBe('Note for slide 2');
    expect(result.notes['3']).toBe('Note for slide 3');
    expect(result.totalSlides).toBe(3);
  });

  test('handles slides without notes', async () => {
    const zip = await createTestPptx({ 2: 'Only slide 2 has notes' });
    const pptxPath = path.join(tmpDir, 'partial.pptx');
    fs.writeFileSync(pptxPath, await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await extractNotes(pptxPath);
    expect(result.notes).not.toHaveProperty('1');
    expect(result.notes).toHaveProperty('2', 'Only slide 2 has notes');
    expect(result.totalSlides).toBe(2);
  });

  test('returns empty object for pptx with no notes', async () => {
    const zip = await createTestPptx({});
    const pptxPath = path.join(tmpDir, 'nonotes.pptx');
    fs.writeFileSync(pptxPath, await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await extractNotes(pptxPath);
    expect(Object.keys(result.notes).length).toBe(0);
    expect(result.totalSlides).toBe(1);
  });

  test('preserves paragraph breaks (multiple a:p elements)', async () => {
    const zip = await createTestPptxWithRawNotes({
      1: `<a:p><a:r><a:t>First paragraph</a:t></a:r></a:p>
          <a:p><a:r><a:t>Second paragraph</a:t></a:r></a:p>
          <a:p><a:r><a:t>Third paragraph</a:t></a:r></a:p>`
    });
    const pptxPath = path.join(tmpDir, 'paragraphs.pptx');
    fs.writeFileSync(pptxPath, await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await extractNotes(pptxPath);
    expect(result.notes['1']).toBe('First paragraph\nSecond paragraph\nThird paragraph');
  });

  test('preserves empty paragraphs as blank lines', async () => {
    const zip = await createTestPptxWithRawNotes({
      1: `<a:p><a:r><a:t>Before gap</a:t></a:r></a:p>
          <a:p></a:p>
          <a:p><a:r><a:t>After gap</a:t></a:r></a:p>`
    });
    const pptxPath = path.join(tmpDir, 'blanklines.pptx');
    fs.writeFileSync(pptxPath, await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await extractNotes(pptxPath);
    expect(result.notes['1']).toBe('Before gap\n\nAfter gap');
  });

  test('preserves line breaks (a:br elements) within a paragraph', async () => {
    const zip = await createTestPptxWithRawNotes({
      1: `<a:p><a:r><a:t>Line one</a:t></a:r><a:br/><a:r><a:t>Line two</a:t></a:r></a:p>`
    });
    const pptxPath = path.join(tmpDir, 'linebreaks.pptx');
    fs.writeFileSync(pptxPath, await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await extractNotes(pptxPath);
    expect(result.notes['1']).toBe('Line one\nLine two');
  });

  test('handles a:br with child elements', async () => {
    const zip = await createTestPptxWithRawNotes({
      1: `<a:p><a:r><a:t>Before</a:t></a:r><a:br><a:rPr lang="en-US"/></a:br><a:r><a:t>After</a:t></a:r></a:p>`
    });
    const pptxPath = path.join(tmpDir, 'br-with-attrs.pptx');
    fs.writeFileSync(pptxPath, await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await extractNotes(pptxPath);
    expect(result.notes['1']).toBe('Before\nAfter');
  });

  test('concatenates multiple text runs within same paragraph', async () => {
    const zip = await createTestPptxWithRawNotes({
      1: `<a:p><a:r><a:t>Hello </a:t></a:r><a:r><a:t>World</a:t></a:r></a:p>`
    });
    const pptxPath = path.join(tmpDir, 'runs.pptx');
    fs.writeFileSync(pptxPath, await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await extractNotes(pptxPath);
    expect(result.notes['1']).toBe('Hello World');
  });
});
