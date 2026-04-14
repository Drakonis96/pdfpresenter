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
    expect(result).toHaveProperty('1', 'Hello from slide 1');
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
    expect(Object.keys(result).length).toBe(3);
    expect(result['1']).toBe('Note for slide 1');
    expect(result['2']).toBe('Note for slide 2');
    expect(result['3']).toBe('Note for slide 3');
  });

  test('handles slides without notes', async () => {
    const zip = await createTestPptx({ 2: 'Only slide 2 has notes' });
    const pptxPath = path.join(tmpDir, 'partial.pptx');
    fs.writeFileSync(pptxPath, await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await extractNotes(pptxPath);
    expect(result).not.toHaveProperty('1');
    expect(result).toHaveProperty('2', 'Only slide 2 has notes');
  });

  test('returns empty object for pptx with no notes', async () => {
    const zip = await createTestPptx({});
    const pptxPath = path.join(tmpDir, 'nonotes.pptx');
    fs.writeFileSync(pptxPath, await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await extractNotes(pptxPath);
    expect(Object.keys(result).length).toBe(0);
  });
});
