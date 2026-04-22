const pdfjsLib = window.pdfjsLib || null;
let pdfDoc = null;
let presentations = [];
let folders = [];
let selectedPdf = null;
let currentEditSlide = null;
let currentFolder = ''; // '' = root / all
let searchQuery = '';
let sortMode = 'recent-added';
let notesViewerSlide = 1;
let notesUndoStack = [];
let notesRedoStack = [];
let pendingDeleteId = null;
let pendingMoveId = null;
let pdfPageAspectRatio = 16 / 9;
let mainThumbSession = null;
let editThumbSession = null;
let notesThumbSession = null;
let canLoadPdfFromFileUrl = true;

const THUMB_PRELOAD_MARGIN_PX = 600;
const THUMB_RELEASE_MARGIN_PX = 1400;
const THUMB_RENDER_CONCURRENCY = 2;

// Load pdf.js from CDN (used in renderer for thumbnails)
function loadPdfJs() {
  return new Promise((resolve) => {
    if (window.pdfjsLib) return resolve(window.pdfjsLib);
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    document.head.appendChild(script);
  });
}

function stopThumbSession(session, container) {
  if (!session) {
    if (container) container.innerHTML = '';
    return null;
  }

  session.cancelled = true;
  if (session.observer) session.observer.disconnect();
  session.queue.length = 0;
  session.queued.clear();
  session.items.forEach(({ canvas }) => releaseThumbCanvas(canvas));
  session.items.clear();

  if (container) container.innerHTML = '';
  return null;
}

function releaseThumbCanvas(canvas, aspectRatio = pdfPageAspectRatio) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
  canvas.dataset.rendered = 'false';
  canvas.style.aspectRatio = String(aspectRatio);
}

function shouldReleaseThumb(entry) {
  if (!entry.rootBounds) return false;
  return entry.boundingClientRect.bottom < entry.rootBounds.top - THUMB_RELEASE_MARGIN_PX ||
    entry.boundingClientRect.top > entry.rootBounds.bottom + THUMB_RELEASE_MARGIN_PX;
}

function enqueueThumbRender(session, pageNum) {
  if (!session || session.cancelled || session.queued.has(pageNum)) return;

  const item = session.items.get(pageNum);
  if (!item || item.canvas.dataset.rendered === 'true') return;

  session.queue.push(pageNum);
  session.queued.add(pageNum);
  pumpThumbQueue(session);
}

function pumpThumbQueue(session) {
  if (!session || session.cancelled) return;

  while (session.rendering < THUMB_RENDER_CONCURRENCY && session.queue.length > 0) {
    const pageNum = session.queue.shift();
    session.queued.delete(pageNum);
    session.rendering++;

    renderThumbPage(session, pageNum).finally(() => {
      session.rendering--;
      pumpThumbQueue(session);
    });
  }
}

async function renderThumbPage(session, pageNum) {
  const item = session.items.get(pageNum);
  if (!item || session.cancelled || item.canvas.dataset.rendered === 'true') return;

  let page;
  try {
    page = await session.doc.getPage(pageNum);
    if (session.cancelled) return;

    const viewport = page.getViewport({ scale: session.scale });
    item.canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
    item.canvas.width = Math.ceil(viewport.width);
    item.canvas.height = Math.ceil(viewport.height);

    const ctx = item.canvas.getContext('2d', { alpha: false });
    await page.render({ canvasContext: ctx, viewport }).promise;

    if (!session.cancelled) {
      item.canvas.dataset.rendered = 'true';
    }
  } catch (err) {
    if (!session.cancelled) {
      console.error(`Error rendering thumbnail for slide ${pageNum}:`, err);
      releaseThumbCanvas(item.canvas);
    }
  } finally {
    if (page && typeof page.cleanup === 'function') {
      page.cleanup();
    }
  }
}

function createThumbSession({ container, scrollRoot, doc, pageCount, scale, buildItem }) {
  const session = {
    cancelled: false,
    observer: null,
    queue: [],
    queued: new Set(),
    items: new Map(),
    rendering: 0,
    doc,
    scale
  };

  if (typeof IntersectionObserver === 'function') {
    session.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const pageNum = parseInt(entry.target.dataset.page, 10);
        if (!pageNum) continue;

        if (entry.isIntersecting) {
          enqueueThumbRender(session, pageNum);
        } else if (shouldReleaseThumb(entry)) {
          const item = session.items.get(pageNum);
          if (item) releaseThumbCanvas(item.canvas);
        }
      }
    }, {
      root: scrollRoot || null,
      rootMargin: `${THUMB_PRELOAD_MARGIN_PX}px 0px`,
      threshold: 0.01
    });
  }

  container.innerHTML = '';

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const item = buildItem(pageNum);
    item.element.dataset.page = String(pageNum);
    item.canvas.dataset.rendered = 'false';
    item.canvas.style.aspectRatio = String(pdfPageAspectRatio);

    container.appendChild(item.element);
    session.items.set(pageNum, item);

    if (session.observer) {
      session.observer.observe(item.element);
    } else {
      enqueueThumbRender(session, pageNum);
    }
  }

  return session;
}

async function unloadCurrentPdf() {
  mainThumbSession = stopThumbSession(mainThumbSession, document.getElementById('slides-grid'));
  editThumbSession = stopThumbSession(editThumbSession, document.getElementById('edit-slides-grid'));
  notesThumbSession = stopThumbSession(notesThumbSession, document.getElementById('notes-viewer-thumbs'));

  if (!pdfDoc) return;

  const currentDoc = pdfDoc;
  pdfDoc = null;

  try {
    await currentDoc.destroy();
  } catch (err) {
    console.warn('Error releasing PDF document:', err);
  }
}

function toPdfUint8Array(pdfData) {
  if (!pdfData) return null;
  if (pdfData instanceof Uint8Array) return pdfData;
  if (pdfData instanceof ArrayBuffer) return new Uint8Array(pdfData);
  if (ArrayBuffer.isView(pdfData)) {
    return new Uint8Array(pdfData.buffer, pdfData.byteOffset, pdfData.byteLength);
  }
  if (typeof pdfData === 'string') {
    return Uint8Array.from(atob(pdfData), c => c.charCodeAt(0));
  }
  return new Uint8Array(pdfData);
}

function toFileUrl(filePath) {
  if (!filePath) return null;

  const normalized = filePath.replace(/\\/g, '/');
  const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return encodeURI(`file://${prefixed}`);
}

async function loadPdfDocument(pdfId, pdfPath) {
  const fileUrl = toFileUrl(pdfPath);
  if (canLoadPdfFromFileUrl && fileUrl) {
    try {
      return await window.pdfjsLib.getDocument({ url: fileUrl }).promise;
    } catch (err) {
      canLoadPdfFromFileUrl = false;
      console.warn('Fast PDF load failed, retrying through IPC buffer:', err);
    }
  }

  const pdfData = await window.api.getPdfData(pdfId);
  if (!pdfData) return null;

  const data = toPdfUint8Array(pdfData);
  return window.pdfjsLib.getDocument({ data }).promise;
}

function closeEditModal() {
  editThumbSession = stopThumbSession(editThumbSession, document.getElementById('edit-slides-grid'));
  document.getElementById('edit-modal').classList.add('hidden');
}

async function closeNotesViewer() {
  await saveCurrentNote();
  notesThumbSession = stopThumbSession(notesThumbSession, document.getElementById('notes-viewer-thumbs'));
  document.getElementById('notes-viewer-modal').classList.add('hidden');

  if (notesViewerKeyHandler) {
    document.removeEventListener('keydown', notesViewerKeyHandler);
    notesViewerKeyHandler = null;
  }
}

// Initialize
async function init() {
  await loadPdfJs();
  const stored = await window.api.getPresentations();
  // Migrate: stored may be array (presentations) or object { presentations, folders }
  if (Array.isArray(stored)) {
    presentations = stored;
    folders = [];
  } else {
    presentations = stored.presentations || [];
    folders = stored.folders || [];
  }
  renderFolderList();
  renderPdfList();
  loadQR();
  setupEventListeners();
  setupVideoResizeHandles();
  setupSettings();
  applyTranslations();
}

// QR Code
async function loadQR() {
  try {
    const info = await window.api.getServerInfo();
    if (!info) return;
    const resp = await fetch(`http://localhost:${info.port}/api/qr`);
    const data = await resp.json();
    const container = document.getElementById('qr-container');
    container.innerHTML = `<img src="${data.qr}" alt="QR Code">`;
    document.getElementById('qr-url').textContent = data.url;
  } catch (err) {
    console.error('Error loading QR:', err);
  }
}

// Render folder list in sidebar
function renderFolderList() {
  const list = document.getElementById('folder-list');
  if (folders.length === 0) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = folders.map(f => `
    <div class="folder-item ${currentFolder === f.id ? 'active' : ''}" data-folder="${f.id}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="folder-item-name">${escapeHtml(f.name)}</span>
      <span class="folder-item-count">${presentations.filter(p => p.folder === f.id).length}</span>
      <div class="folder-item-actions">
        <button class="pdf-item-action danger" data-delete-folder="${f.id}" title="Eliminar carpeta">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.folder-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('[data-delete-folder]')) {
        const fId = e.target.closest('[data-delete-folder]').dataset.deleteFolder;
        deleteFolder(fId);
        return;
      }
      const fId = item.dataset.folder;
      currentFolder = currentFolder === fId ? '' : fId;
      renderFolderList();
      renderPdfList();
      updateBreadcrumb();
    });
  });
}

function updateBreadcrumb() {
  const bc = document.getElementById('folder-breadcrumb');
  let html = `<span class="breadcrumb-item ${currentFolder === '' ? 'active' : ''}" data-folder="">${t('sidebar.all')}</span>`;
  if (currentFolder) {
    const folder = folders.find(f => f.id === currentFolder);
    if (folder) {
      html += `<span class="breadcrumb-separator">›</span>`;
      html += `<span class="breadcrumb-item active" data-folder="${folder.id}">${escapeHtml(folder.name)}</span>`;
    }
  }
  bc.innerHTML = html;
  bc.querySelectorAll('.breadcrumb-item').forEach(item => {
    item.addEventListener('click', () => {
      currentFolder = item.dataset.folder;
      renderFolderList();
      renderPdfList();
      updateBreadcrumb();
    });
  });
}

function getFilteredPresentations() {
  let list = [...presentations];

  // Filter by folder
  if (currentFolder) {
    list = list.filter(p => p.folder === currentFolder);
  }

  // Filter by search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(p => p.name.toLowerCase().includes(q));
  }

  // Sort
  switch (sortMode) {
    case 'recent-added':
      list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      break;
    case 'recent-opened':
      list.sort((a, b) => (b.lastOpenedAt || '').localeCompare(a.lastOpenedAt || ''));
      break;
    case 'name-asc':
      list.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'name-desc':
      list.sort((a, b) => b.name.localeCompare(a.name));
      break;
  }

  return list;
}

// Render PDF list in sidebar
function renderPdfList() {
  const list = document.getElementById('pdf-list');
  const filtered = getFilteredPresentations();

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
        <p>${searchQuery ? t('sidebar.noResults') : t('sidebar.noPresentation')}</p>
        <p class="text-muted">${searchQuery ? t('sidebar.tryAnother') : t('sidebar.importToStart')}</p>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(p => `
    <div class="pdf-item ${selectedPdf && selectedPdf.id === p.id ? 'active' : ''}" data-id="${p.id}">
      <div class="pdf-item-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      </div>
      <div class="pdf-item-info">
        <div class="pdf-item-name">${escapeHtml(p.name)}</div>
        <div class="pdf-item-meta">${p.totalPages ? p.totalPages + ' diapositivas' : 'Sin cargar'}${Object.keys(p.notes || {}).length ? ' • Notas' : ''}${Object.keys(p.videos || {}).length ? ' • Vídeos' : ''}</div>
      </div>
      <div class="pdf-item-actions">
        <button class="pdf-item-action" data-rename="${p.id}" title="${t('sidebar.rename')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="pdf-item-action" data-move="${p.id}" title="Mover a carpeta">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
        <button class="pdf-item-action danger" data-delete="${p.id}" title="Eliminar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');

  // Click handlers
  list.querySelectorAll('.pdf-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('[data-rename]')) {
        const id = e.target.closest('[data-rename]').dataset.rename;
        startInlineRename(id, item);
        return;
      }
      if (e.target.closest('[data-delete]')) {
        const id = e.target.closest('[data-delete]').dataset.delete;
        openDeleteConfirm(id);
        return;
      }
      if (e.target.closest('[data-move]')) {
        const id = e.target.closest('[data-move]').dataset.move;
        openMoveModal(id);
        return;
      }
      selectPdf(item.dataset.id);
    });
  });
}

// Select a PDF
async function selectPdf(id) {
  const canReuseCurrentDoc = selectedPdf && selectedPdf.id === id && pdfDoc;
  selectedPdf = presentations.find(p => p.id === id);
  if (!selectedPdf) return;

  // Track last opened
  selectedPdf.lastOpenedAt = new Date().toISOString();
  await saveMeta();

  renderPdfList();
  document.getElementById('welcome-panel').classList.add('hidden');
  document.getElementById('detail-panel').classList.remove('hidden');
  document.getElementById('detail-title').textContent = selectedPdf.name;
  document.getElementById('detail-title').title = t('sidebar.rename');

  if (canReuseCurrentDoc) {
    renderThumbnails();
    updateDetailInfo();
    return;
  }

  await unloadCurrentPdf();

  pdfDoc = await loadPdfDocument(id, selectedPdf.pdfPath);
  if (!pdfDoc) return;
  selectedPdf.totalPages = pdfDoc.numPages;

  if (pdfDoc.numPages > 0) {
    const firstPage = await pdfDoc.getPage(1);
    const firstViewport = firstPage.getViewport({ scale: 1 });
    pdfPageAspectRatio = firstViewport.width / firstViewport.height;
    if (typeof firstPage.cleanup === 'function') firstPage.cleanup();
  }

  // Update meta
  await saveMeta();

  // Render thumbnails
  renderThumbnails();
  updateDetailInfo();
}

function renderThumbnails() {
  const grid = document.getElementById('slides-grid');
  const currentPdf = selectedPdf;
  const currentDoc = pdfDoc;

  if (!currentPdf || !currentDoc) {
    mainThumbSession = stopThumbSession(mainThumbSession, grid);
    return;
  }

  const detailBody = grid.closest('.detail-body');
  mainThumbSession = stopThumbSession(mainThumbSession, grid);
  mainThumbSession = createThumbSession({
    container: grid,
    scrollRoot: detailBody,
    doc: currentDoc,
    pageCount: currentDoc.numPages,
    scale: 0.5,
    buildItem: (pageNum) => {
      const div = document.createElement('div');
      div.className = 'slide-thumb';

      const canvas = document.createElement('canvas');

      const info = document.createElement('div');
      info.className = 'slide-thumb-info';
      const hasNote = currentPdf.notes && currentPdf.notes[pageNum];
      const hasVideo = currentPdf.videos && currentPdf.videos[pageNum];
      info.innerHTML = `
        <span>${t('slide.slide')} ${pageNum}</span>
        <div class="slide-thumb-badges">
          ${hasNote ? '<div class="slide-badge note" title="' + t('slide.hasNotes') + '"></div>' : ''}
          ${hasVideo ? '<div class="slide-badge video" title="' + t('slide.hasVideo') + '"></div>' : ''}
        </div>
      `;

      const actions = document.createElement('div');
      actions.className = 'slide-thumb-actions';
      actions.innerHTML = `
        <button class="btn btn-accent slide-quick-btn" data-action="present" data-slide="${pageNum}" title="${t('detail.startPresentation')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </button>
        <button class="btn btn-accent-secondary slide-quick-btn" data-action="presenter" data-slide="${pageNum}" title="${t('detail.presenterMode')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </button>
      `;

      div.appendChild(canvas);
      div.appendChild(actions);
      div.appendChild(info);

      actions.querySelectorAll('.slide-quick-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const slide = parseInt(btn.dataset.slide, 10);
          if (btn.dataset.action === 'present') {
            startPresentationFromSlide(slide);
          } else {
            startPresenterModeFromSlide(slide);
          }
        });
      });

      div.addEventListener('click', () => openVideoEditor(pageNum));
      return { element: div, canvas };
    }
  });
}

function updateDetailInfo() {
  const notesCount = Object.keys(selectedPdf.notes || {}).length;
  const videosCount = Object.keys(selectedPdf.videos || {}).length;

  document.getElementById('detail-pages').textContent = `${selectedPdf.totalPages} ${t('sidebar.slides')}`;
  
  const notesEl = document.getElementById('detail-notes-status');
  notesEl.textContent = notesCount > 0 ? `${notesCount} ${t('detail.notesImported')}` : t('detail.noNotes');
  notesEl.className = `badge ${notesCount > 0 ? 'has-notes' : ''}`;

  const videosEl = document.getElementById('detail-videos-count');
  videosEl.textContent = videosCount > 0 ? `${videosCount} ${t('detail.videoCount')}` : t('detail.noVideos');
  videosEl.className = `badge ${videosCount > 0 ? 'has-videos' : ''}`;
}

// Import PPTX notes
async function importNotes() {
  if (!selectedPdf) return;
  const result = await window.api.importPptxNotes(selectedPdf.id);
  if (!result) return;

  const { notes, totalSlides } = result;
  if (totalSlides !== selectedPdf.totalPages) {
    alert(t('misc.pptxMismatch', { pptx: totalSlides, pdf: selectedPdf.totalPages }));
    return;
  }

  selectedPdf.notes = notes;
  await saveMeta();
  renderThumbnails();
  updateDetailInfo();
}

// Video editor
async function openVideoEditor(slideNum) {
  currentEditSlide = slideNum;
  document.getElementById('video-modal-slide').textContent = slideNum;

  // Render slide preview in modal
  const page = await pdfDoc.getPage(slideNum);
  const viewport = page.getViewport({ scale: 1.0 });
  const canvas = document.getElementById('modal-slide-canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Load existing video data
  const video = selectedPdf.videos && selectedPdf.videos[slideNum];
  if (video) {
    document.getElementById('video-url').value = video.url || '';
    document.getElementById('video-x').value = video.x || 10;
    document.getElementById('video-y').value = video.y || 10;
    document.getElementById('video-w').value = video.w || 80;
    document.getElementById('video-h').value = video.h || 60;
    updateVideoOverlayPreview();
  } else {
    document.getElementById('video-url').value = '';
    document.getElementById('video-x').value = 10;
    document.getElementById('video-y').value = 10;
    document.getElementById('video-w').value = 80;
    document.getElementById('video-h').value = 60;
    document.getElementById('video-overlay-preview').style.display = 'none';
  }

  document.getElementById('video-modal').classList.remove('hidden');
}

function extractYouTubeIdLocal(url) {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube(?:-nocookie)?\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function updateVideoOverlayPreview() {
  const overlay = document.getElementById('video-overlay-preview');
  const x = parseFloat(document.getElementById('video-x').value);
  const y = parseFloat(document.getElementById('video-y').value);
  const w = parseFloat(document.getElementById('video-w').value);
  const h = parseFloat(document.getElementById('video-h').value);

  overlay.style.display = 'block';
  overlay.style.left = x + '%';
  overlay.style.top = y + '%';
  overlay.style.width = w + '%';
  overlay.style.height = h + '%';

  // Show YouTube thumbnail preview
  const url = document.getElementById('video-url').value.trim();
  const videoId = extractYouTubeIdLocal(url);
  const thumb = document.getElementById('video-thumb-preview');
  if (videoId && thumb) {
    thumb.src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    thumb.style.display = 'block';
  } else if (thumb) {
    thumb.style.display = 'none';
  }
}

async function saveVideo() {
  if (!selectedPdf || !currentEditSlide) return;

  const url = document.getElementById('video-url').value.trim();
  if (!url) {
    removeVideo();
    return;
  }

  if (!selectedPdf.videos) selectedPdf.videos = {};
  selectedPdf.videos[currentEditSlide] = {
    url,
    x: parseFloat(document.getElementById('video-x').value),
    y: parseFloat(document.getElementById('video-y').value),
    w: parseFloat(document.getElementById('video-w').value),
    h: parseFloat(document.getElementById('video-h').value)
  };

  await saveMeta();
  document.getElementById('video-modal').classList.add('hidden');
  renderThumbnails();
  updateDetailInfo();
}

async function removeVideo() {
  if (!selectedPdf || !currentEditSlide) return;
  if (selectedPdf.videos) {
    delete selectedPdf.videos[currentEditSlide];
  }
  await saveMeta();
  document.getElementById('video-modal').classList.add('hidden');
  renderThumbnails();
  updateDetailInfo();
}

// Edit slides modal
function openEditModal() {
  if (!pdfDoc || !selectedPdf) return;
  document.getElementById('edit-modal').classList.remove('hidden');
  renderEditGrid();
}

function renderEditGrid() {
  const grid = document.getElementById('edit-slides-grid');

  if (!pdfDoc || !selectedPdf) {
    editThumbSession = stopThumbSession(editThumbSession, grid);
    return;
  }

  editThumbSession = stopThumbSession(editThumbSession, grid);
  editThumbSession = createThumbSession({
    container: grid,
    scrollRoot: grid.closest('.modal-body'),
    doc: pdfDoc,
    pageCount: pdfDoc.numPages,
    scale: 0.4,
    buildItem: (pageNum) => {
      const div = document.createElement('div');
      div.className = `edit-slide-item ${selectedPdf.videos && selectedPdf.videos[pageNum] ? 'has-video' : ''}`;

      const canvas = document.createElement('canvas');

      const label = document.createElement('div');
      label.className = 'edit-slide-label';
      const hasVideo = selectedPdf.videos && selectedPdf.videos[pageNum];
      label.innerHTML = `
        <span>${pageNum}</span>
        ${hasVideo ? '<span class="video-indicator">' + t('editModal.videoIndicator') + '</span>' : ''}
      `;

      div.appendChild(canvas);
      div.appendChild(label);
      div.addEventListener('click', () => {
        closeEditModal();
        openVideoEditor(pageNum);
      });

      return { element: div, canvas };
    }
  });
}

// Start presentation
async function startPresentation() {
  if (!selectedPdf) return;
  await window.api.startPresentation(selectedPdf.id);
}

async function startPresentationFromSlide(slide) {
  if (!selectedPdf) return;
  await window.api.startPresentation(selectedPdf.id, slide);
}

// Start presenter mode
async function startPresenterMode() {
  if (!selectedPdf) return;
  await window.api.startPresenterMode(selectedPdf.id);
}

async function startPresenterModeFromSlide(slide) {
  if (!selectedPdf) return;
  await window.api.startPresenterMode(selectedPdf.id, slide);
}

// Delete presentation (modal-based)
function openDeleteConfirm(id) {
  pendingDeleteId = id;
  const p = presentations.find(x => x.id === id);
  document.getElementById('delete-confirm-name').textContent = p ? p.name : '';
  document.getElementById('delete-confirm-modal').classList.remove('hidden');
}

async function confirmDelete() {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId;
  pendingDeleteId = null;

  await window.api.deletePresentation(id);
  presentations = presentations.filter(p => p.id !== id);
  if (selectedPdf && selectedPdf.id === id) {
    selectedPdf = null;
    await unloadCurrentPdf();
    document.getElementById('detail-panel').classList.add('hidden');
    document.getElementById('welcome-panel').classList.remove('hidden');
  }
  await saveMeta();
  renderPdfList();
  renderFolderList();
  document.getElementById('delete-confirm-modal').classList.add('hidden');
}

// Move to folder
function openMoveModal(id) {
  pendingMoveId = id;
  const p = presentations.find(x => x.id === id);
  const list = document.getElementById('move-folder-list');

  let html = `<div class="move-folder-option ${!p.folder ? 'current' : ''}" data-target-folder="">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
    ${t('moveModal.noFolder')}
  </div>`;
  html += folders.map(f => `
    <div class="move-folder-option ${p.folder === f.id ? 'current' : ''}" data-target-folder="${f.id}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      ${escapeHtml(f.name)}
    </div>
  `).join('');
  list.innerHTML = html;

  list.querySelectorAll('.move-folder-option').forEach(opt => {
    opt.addEventListener('click', async () => {
      const targetFolder = opt.dataset.targetFolder;
      const pp = presentations.find(x => x.id === pendingMoveId);
      if (pp) {
        pp.folder = targetFolder || '';
        await saveMeta();
        renderPdfList();
        renderFolderList();
      }
      document.getElementById('move-folder-modal').classList.add('hidden');
      pendingMoveId = null;
    });
  });

  document.getElementById('move-folder-modal').classList.remove('hidden');
}

// Folder management
function openNewFolderModal() {
  document.getElementById('new-folder-name').value = '';
  document.getElementById('new-folder-modal').classList.remove('hidden');
  document.getElementById('new-folder-name').focus();
}

async function createFolder() {
  const name = document.getElementById('new-folder-name').value.trim();
  if (!name) return;
  const id = 'f_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  folders.push({ id, name, createdAt: new Date().toISOString() });
  await saveMeta();
  renderFolderList();
  document.getElementById('new-folder-modal').classList.add('hidden');
}

async function deleteFolder(folderId) {
  if (!confirm('¿Eliminar esta carpeta? Los documentos se moverán a la raíz.')) return;
  // Move all presentations in this folder to root
  presentations.forEach(p => {
    if (p.folder === folderId) p.folder = '';
  });
  folders = folders.filter(f => f.id !== folderId);
  if (currentFolder === folderId) currentFolder = '';
  await saveMeta();
  renderFolderList();
  renderPdfList();
  updateBreadcrumb();
}

// Fullscreen notes viewer
function openNotesViewer() {
  if (!pdfDoc || !selectedPdf) return;
  notesViewerSlide = 1;
  notesUndoStack = [];
  notesRedoStack = [];
  document.getElementById('notes-viewer-modal').classList.remove('hidden');
  renderNotesViewerThumbs();
  renderNotesViewerSlide(1);
  setupNotesViewerResize();
  setupNotesViewerKeyboard();
}

function renderNotesViewerThumbs() {
  const container = document.getElementById('notes-viewer-thumbs');

  if (!pdfDoc || !selectedPdf) {
    notesThumbSession = stopThumbSession(notesThumbSession, container);
    return;
  }

  notesThumbSession = stopThumbSession(notesThumbSession, container);
  notesThumbSession = createThumbSession({
    container,
    scrollRoot: document.querySelector('.notes-viewer-sidebar'),
    doc: pdfDoc,
    pageCount: pdfDoc.numPages,
    scale: 0.3,
    buildItem: (pageNum) => {
      const div = document.createElement('div');
      div.className = `notes-thumb ${pageNum === notesViewerSlide ? 'active' : ''} ${selectedPdf.notes && selectedPdf.notes[pageNum] ? 'notes-thumb-has-note' : ''}`;

      const canvas = document.createElement('canvas');

      const label = document.createElement('div');
      label.className = 'notes-thumb-label';
      label.textContent = pageNum;

      div.appendChild(canvas);
      div.appendChild(label);
      div.addEventListener('click', () => {
        saveCurrentNote();
        renderNotesViewerSlide(pageNum);
      });

      return { element: div, canvas };
    }
  });
}

async function renderNotesViewerSlide(num) {
  notesViewerSlide = num;
  const canvas = document.getElementById('notes-viewer-canvas');
  const page = await pdfDoc.getPage(num);
  const maxW = canvas.parentElement.clientWidth - 24;
  const maxH = canvas.parentElement.clientHeight - 24;
  const defaultVp = page.getViewport({ scale: 1 });
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.min(maxW / defaultVp.width, maxH / defaultVp.height, 2);
  const viewport = page.getViewport({ scale: scale * dpr });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = (viewport.width / dpr) + 'px';
  canvas.style.height = (viewport.height / dpr) + 'px';
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  document.getElementById('notes-viewer-slide-label').textContent = `${t('notesViewer.slideLabel')} ${num}`;
  const note = selectedPdf.notes && selectedPdf.notes[num];
  document.getElementById('notes-viewer-textarea').value = note || '';

  // Update thumb highlight
  document.querySelectorAll('.notes-thumb').forEach(t => {
    t.classList.toggle('active', parseInt(t.dataset.page) === num);
  });

  // Scroll active thumb into view
  const activeThumb = document.querySelector('.notes-thumb.active');
  if (activeThumb) activeThumb.scrollIntoView({ block: 'nearest' });
}

async function saveCurrentNote() {
  if (!selectedPdf) return;
  const text = document.getElementById('notes-viewer-textarea').value;
  const currentNote = selectedPdf.notes && selectedPdf.notes[notesViewerSlide] || '';
  if (text !== currentNote) {
    notesUndoStack.push({ slide: notesViewerSlide, note: currentNote });
    notesRedoStack = [];
  }
  if (!selectedPdf.notes) selectedPdf.notes = {};
  if (text.trim()) {
    selectedPdf.notes[notesViewerSlide] = text;
  } else {
    delete selectedPdf.notes[notesViewerSlide];
  }
  await saveMeta();
  const thumb = document.querySelector(`.notes-thumb[data-page="${notesViewerSlide}"]`);
  if (thumb) {
    thumb.classList.toggle('notes-thumb-has-note', !!text.trim());
  }
  updateDetailInfo();
  renderThumbnails();
  showSaveFeedback();
}

function showSaveFeedback() {
  const btn = document.getElementById('btn-save-note');
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3fb950" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
  btn.style.color = '#3fb950';
  setTimeout(() => {
    btn.innerHTML = originalHtml;
    btn.style.color = '';
  }, 1500);
}

function undoNote() {
  if (notesUndoStack.length === 0) return;
  const state = notesUndoStack.pop();
  notesRedoStack.push({ slide: state.slide, note: selectedPdf.notes && selectedPdf.notes[state.slide] || '' });
  if (!selectedPdf.notes) selectedPdf.notes = {};
  if (state.note) {
    selectedPdf.notes[state.slide] = state.note;
  } else {
    delete selectedPdf.notes[state.slide];
  }
  saveMeta();
  if (state.slide !== notesViewerSlide) {
    renderNotesViewerSlide(state.slide);
  } else {
    document.getElementById('notes-viewer-textarea').value = state.note || '';
    const thumb = document.querySelector(`.notes-thumb[data-page="${state.slide}"]`);
    if (thumb) thumb.classList.toggle('notes-thumb-has-note', !!state.note);
  }
  updateDetailInfo();
  renderThumbnails();
}

function redoNote() {
  if (notesRedoStack.length === 0) return;
  const state = notesRedoStack.pop();
  notesUndoStack.push({ slide: state.slide, note: selectedPdf.notes && selectedPdf.notes[state.slide] || '' });
  if (!selectedPdf.notes) selectedPdf.notes = {};
  if (state.note) {
    selectedPdf.notes[state.slide] = state.note;
  } else {
    delete selectedPdf.notes[state.slide];
  }
  saveMeta();
  if (state.slide !== notesViewerSlide) {
    renderNotesViewerSlide(state.slide);
  } else {
    document.getElementById('notes-viewer-textarea').value = state.note || '';
    const thumb = document.querySelector(`.notes-thumb[data-page="${state.slide}"]`);
    if (thumb) thumb.classList.toggle('notes-thumb-has-note', !!state.note);
  }
  updateDetailInfo();
  renderThumbnails();
}

function setupNotesViewerResize() {
  const handle = document.getElementById('notes-viewer-resize');
  const notesPanel = document.querySelector('.notes-viewer-notes');
  let startY, startH;

  const onMouseDown = (e) => {
    startY = e.clientY;
    startH = notesPanel.offsetHeight;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.preventDefault();
  };

  const onMouseMove = (e) => {
    const dy = startY - e.clientY;
    const newH = Math.max(80, Math.min(window.innerHeight * 0.6, startH + dy));
    notesPanel.style.height = newH + 'px';
    renderNotesViewerSlide(notesViewerSlide);
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    renderNotesViewerSlide(notesViewerSlide);
  };

  handle.addEventListener('mousedown', onMouseDown);
}

let notesViewerKeyHandler = null;

function setupNotesViewerKeyboard() {
  if (notesViewerKeyHandler) {
    document.removeEventListener('keydown', notesViewerKeyHandler);
  }
  notesViewerKeyHandler = (e) => {
    const modal = document.getElementById('notes-viewer-modal');
    if (modal.classList.contains('hidden')) return;
    const textarea = document.getElementById('notes-viewer-textarea');
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const cmdKey = isMac ? e.metaKey : e.ctrlKey;

    if (cmdKey && e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      redoNote();
      return;
    }
    if (cmdKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undoNote();
      return;
    }

    if (document.activeElement === textarea) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeNotesViewer();
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (notesViewerSlide < pdfDoc.numPages) {
        saveCurrentNote();
        renderNotesViewerSlide(notesViewerSlide + 1);
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (notesViewerSlide > 1) {
        saveCurrentNote();
        renderNotesViewerSlide(notesViewerSlide - 1);
      }
    }
  };
  document.addEventListener('keydown', notesViewerKeyHandler);
}

// Save meta
async function saveMeta() {
  const idx = presentations.findIndex(p => p.id === selectedPdf?.id);
  if (selectedPdf && idx !== -1) presentations[idx] = selectedPdf;
  await window.api.savePresentationsMeta({ presentations, folders });
}

// Event listeners
function setupEventListeners() {
  document.getElementById('btn-import').addEventListener('click', async () => {
    const pdf = await window.api.importPdf();
    if (pdf) {
      // Assign to current folder
      pdf.folder = currentFolder || '';
      presentations.push(pdf);
      await saveMeta();
      renderPdfList();
      renderFolderList();
      selectPdf(pdf.id);
    }
  });

  document.getElementById('btn-import-notes').addEventListener('click', importNotes);
  document.getElementById('btn-edit-slides').addEventListener('click', openEditModal);
  document.getElementById('btn-view-notes').addEventListener('click', openNotesViewer);
  document.getElementById('btn-start-presentation').addEventListener('click', startPresentation);
  document.getElementById('btn-presenter-mode').addEventListener('click', startPresenterMode);
  document.getElementById('btn-delete-pdf').addEventListener('click', () => {
    if (selectedPdf) openDeleteConfirm(selectedPdf.id);
  });

  // Rename from detail title
  document.getElementById('detail-title').addEventListener('click', startDetailTitleRename);

  // Video modal
  document.getElementById('btn-close-video-modal').addEventListener('click', () => {
    document.getElementById('video-modal').classList.add('hidden');
  });
  document.getElementById('btn-save-video').addEventListener('click', saveVideo);
  document.getElementById('btn-remove-video').addEventListener('click', removeVideo);

  // Live preview of video overlay
  ['video-x', 'video-y', 'video-w', 'video-h'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateVideoOverlayPreview);
  });
  document.getElementById('video-url').addEventListener('input', () => {
    if (document.getElementById('video-url').value.trim()) {
      updateVideoOverlayPreview();
    } else {
      document.getElementById('video-overlay-preview').style.display = 'none';
    }
  });

  // Edit modal
  document.getElementById('btn-close-edit-modal').addEventListener('click', closeEditModal);

  // Notes viewer modal
  document.getElementById('btn-close-notes-viewer').addEventListener('click', () => {
    closeNotesViewer();
  });
  document.getElementById('btn-save-note').addEventListener('click', saveCurrentNote);

  // Delete confirmation modal
  document.getElementById('btn-close-delete-modal').addEventListener('click', () => {
    document.getElementById('delete-confirm-modal').classList.add('hidden');
    pendingDeleteId = null;
  });
  document.getElementById('btn-cancel-delete').addEventListener('click', () => {
    document.getElementById('delete-confirm-modal').classList.add('hidden');
    pendingDeleteId = null;
  });
  document.getElementById('btn-confirm-delete').addEventListener('click', confirmDelete);

  // Move modal
  document.getElementById('btn-close-move-modal').addEventListener('click', () => {
    document.getElementById('move-folder-modal').classList.add('hidden');
    pendingMoveId = null;
  });
  document.getElementById('btn-cancel-move').addEventListener('click', () => {
    document.getElementById('move-folder-modal').classList.add('hidden');
    pendingMoveId = null;
  });

  // New folder
  document.getElementById('btn-new-folder').addEventListener('click', openNewFolderModal);
  document.getElementById('btn-close-new-folder-modal').addEventListener('click', () => {
    document.getElementById('new-folder-modal').classList.add('hidden');
  });
  document.getElementById('btn-cancel-new-folder').addEventListener('click', () => {
    document.getElementById('new-folder-modal').classList.add('hidden');
  });
  document.getElementById('btn-create-folder').addEventListener('click', createFolder);
  document.getElementById('new-folder-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createFolder();
  });

  // Search
  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderPdfList();
  });

  // Sort
  document.getElementById('sort-select').addEventListener('change', (e) => {
    sortMode = e.target.value;
    renderPdfList();
  });

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        if (overlay.id === 'notes-viewer-modal') {
          closeNotesViewer();
          return;
        }
        if (overlay.id === 'edit-modal') {
          closeEditModal();
          return;
        }
        overlay.classList.add('hidden');
      }
    });
  });

  // Listen for presentation ended
  window.api.onPresentationEnded(() => {
    // Could update UI if needed
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Inline rename in sidebar
function startInlineRename(id, itemEl) {
  const p = presentations.find(pr => pr.id === id);
  if (!p) return;
  const nameEl = itemEl.querySelector('.pdf-item-name');
  if (!nameEl || nameEl.querySelector('input')) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'pdf-item-rename-input';
  input.value = p.name;
  nameEl.textContent = '';
  nameEl.appendChild(input);
  input.focus();
  input.select();

  const commit = async () => {
    const newName = input.value.trim();
    if (newName && newName !== p.name) {
      p.name = newName;
      if (selectedPdf && selectedPdf.id === id) {
        document.getElementById('detail-title').textContent = newName;
      }
      await saveMeta();
    }
    renderPdfList();
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = p.name; input.blur(); }
  });
  input.addEventListener('click', (e) => e.stopPropagation());
}

// Rename from detail title
function startDetailTitleRename() {
  if (!selectedPdf) return;
  const titleEl = document.getElementById('detail-title');
  if (titleEl.querySelector('input')) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'detail-title-rename-input';
  input.value = selectedPdf.name;
  titleEl.textContent = '';
  titleEl.appendChild(input);
  input.focus();
  input.select();

  const commit = async () => {
    const newName = input.value.trim();
    if (newName && newName !== selectedPdf.name) {
      selectedPdf.name = newName;
      await saveMeta();
      renderPdfList();
    }
    titleEl.textContent = selectedPdf.name;
    titleEl.title = t('sidebar.rename');
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = selectedPdf.name; input.blur(); }
  });
}

// Video overlay resize handles (proportional corner drag) and drag to move
function setupVideoResizeHandles() {
  const container = document.querySelector('.slide-preview-container');
  const overlay = document.getElementById('video-overlay-preview');
  let resizing = false;
  let dragging = false;
  let startCorner = null;
  let startMouseX, startMouseY;
  let startOvX, startOvY, startOvW, startOvH;
  let aspectRatio;

  overlay.addEventListener('mousedown', (e) => {
    const corner = e.target.dataset.corner || e.target.dataset.edge;
    e.preventDefault();
    e.stopPropagation();

    startMouseX = e.clientX;
    startMouseY = e.clientY;
    startOvX = parseFloat(document.getElementById('video-x').value);
    startOvY = parseFloat(document.getElementById('video-y').value);
    startOvW = parseFloat(document.getElementById('video-w').value);
    startOvH = parseFloat(document.getElementById('video-h').value);
    aspectRatio = startOvW / startOvH;

    if (corner) {
      resizing = true;
      startCorner = corner;
    } else {
      dragging = true;
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
  });

  function onMove(e) {
    if (!resizing && !dragging) return;
    const rect = container.getBoundingClientRect();
    const dx = ((e.clientX - startMouseX) / rect.width) * 100;
    const dy = ((e.clientY - startMouseY) / rect.height) * 100;

    let newX = startOvX, newY = startOvY, newW = startOvW, newH = startOvH;

    if (dragging) {
      newX = Math.max(0, Math.min(100 - startOvW, startOvX + dx));
      newY = Math.max(0, Math.min(100 - startOvH, startOvY + dy));
    } else {
      switch (startCorner) {
      case 'br':
        newW = Math.max(10, startOvW + dx);
        newH = newW / aspectRatio;
        break;
      case 'bl':
        newW = Math.max(10, startOvW - dx);
        newH = newW / aspectRatio;
        newX = startOvX + startOvW - newW;
        break;
      case 'tr':
        newW = Math.max(10, startOvW + dx);
        newH = newW / aspectRatio;
        newY = startOvY + startOvH - newH;
        break;
      case 'tl':
        newW = Math.max(10, startOvW - dx);
        newH = newW / aspectRatio;
        newX = startOvX + startOvW - newW;
        newY = startOvY + startOvH - newH;
        break;
      case 'tc':
        newH = Math.max(10, startOvH - dy);
        newY = startOvY + startOvH - newH;
        break;
      case 'bc':
        newH = Math.max(10, startOvH + dy);
        break;
      }
    }

    // Clamp values
    newX = Math.max(0, Math.min(90, newX));
    newY = Math.max(0, Math.min(90, newY));
    newW = Math.max(10, Math.min(100 - newX, newW));
    newH = Math.max(10, Math.min(100 - newY, newH));

    document.getElementById('video-x').value = Math.round(newX);
    document.getElementById('video-y').value = Math.round(newY);
    document.getElementById('video-w').value = Math.round(newW);
    document.getElementById('video-h').value = Math.round(newH);
    updateVideoOverlayPreview();
  }

  function onEnd() {
    resizing = false;
    dragging = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
  }
}

// Settings
function setupSettings() {
  const langSelect = document.getElementById('settings-language');
  langSelect.value = getLanguage();

  document.getElementById('btn-settings').addEventListener('click', () => {
    langSelect.value = getLanguage();
    document.getElementById('settings-modal').classList.remove('hidden');
  });

  document.getElementById('btn-close-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
  });

  document.getElementById('settings-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      document.getElementById('settings-modal').classList.add('hidden');
    }
  });

  langSelect.addEventListener('change', () => {
    setLanguage(langSelect.value);
    // Re-render dynamic content with new language
    renderPdfList();
    renderFolderList();
    updateBreadcrumb();
    if (selectedPdf) {
      renderThumbnails();
      updateDetailInfo();
    }
  });

  // Save unsaved notes when closing/reloading the window
  window.addEventListener('beforeunload', () => {
    const modal = document.getElementById('notes-viewer-modal');
    if (modal && !modal.classList.contains('hidden')) {
      saveCurrentNote();
    }
  });
}

init();
