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
let pendingDeleteId = null;
let pendingMoveId = null;
let renderGeneration = 0;

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
  selectedPdf = presentations.find(p => p.id === id);
  if (!selectedPdf) return;

  // Track last opened
  selectedPdf.lastOpenedAt = new Date().toISOString();
  await saveMeta();

  renderPdfList();
  document.getElementById('welcome-panel').classList.add('hidden');
  document.getElementById('detail-panel').classList.remove('hidden');
  document.getElementById('detail-title').textContent = selectedPdf.name;

  // Load PDF for thumbnails
  const base64 = await window.api.getPdfData(id);
  if (!base64) return;

  const data = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  pdfDoc = await window.pdfjsLib.getDocument({ data }).promise;
  selectedPdf.totalPages = pdfDoc.numPages;

  // Update meta
  await saveMeta();

  // Render thumbnails
  renderThumbnails();
  updateDetailInfo();
}

async function renderThumbnails() {
  const generation = ++renderGeneration;
  const grid = document.getElementById('slides-grid');
  grid.innerHTML = '';

  const currentPdf = selectedPdf;
  const currentDoc = pdfDoc;

  for (let i = 1; i <= currentDoc.numPages; i++) {
    if (generation !== renderGeneration) return;

    const page = await currentDoc.getPage(i);
    if (generation !== renderGeneration) return;

    const viewport = page.getViewport({ scale: 0.5 });

    const div = document.createElement('div');
    div.className = 'slide-thumb';
    div.dataset.page = i;

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    if (generation !== renderGeneration) return;

    const info = document.createElement('div');
    info.className = 'slide-thumb-info';
    const hasNote = currentPdf.notes && currentPdf.notes[i];
    const hasVideo = currentPdf.videos && currentPdf.videos[i];
    info.innerHTML = `
      <span>${t('slide.slide')} ${i}</span>
      <div class="slide-thumb-badges">
        ${hasNote ? '<div class="slide-badge note" title="' + t('slide.hasNotes') + '"></div>' : ''}
        ${hasVideo ? '<div class="slide-badge video" title="' + t('slide.hasVideo') + '"></div>' : ''}
      </div>
    `;

    div.appendChild(canvas);
    div.appendChild(info);
    grid.appendChild(div);

    div.addEventListener('click', () => openVideoEditor(i));
  }
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
  renderEditGrid();
  document.getElementById('edit-modal').classList.remove('hidden');
}

async function renderEditGrid() {
  const grid = document.getElementById('edit-slides-grid');
  grid.innerHTML = '';

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: 0.4 });

    const div = document.createElement('div');
    div.className = `edit-slide-item ${selectedPdf.videos && selectedPdf.videos[i] ? 'has-video' : ''}`;
    div.dataset.page = i;

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    const label = document.createElement('div');
    label.className = 'edit-slide-label';
    const hasVideo = selectedPdf.videos && selectedPdf.videos[i];
    label.innerHTML = `
      <span>${i}</span>
      ${hasVideo ? '<span class="video-indicator">' + t('editModal.videoIndicator') + '</span>' : ''}
    `;

    div.appendChild(canvas);
    div.appendChild(label);
    grid.appendChild(div);

    div.addEventListener('click', () => {
      document.getElementById('edit-modal').classList.add('hidden');
      openVideoEditor(i);
    });
  }
}

// Start presentation
async function startPresentation() {
  if (!selectedPdf) return;
  await window.api.startPresentation(selectedPdf.id);
}

// Start presenter mode
async function startPresenterMode() {
  if (!selectedPdf) return;
  await window.api.startPresenterMode(selectedPdf.id);
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
    pdfDoc = null;
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
  document.getElementById('notes-viewer-modal').classList.remove('hidden');
  renderNotesViewerThumbs();
  renderNotesViewerSlide(1);
  setupNotesViewerResize();
}

async function renderNotesViewerThumbs() {
  const container = document.getElementById('notes-viewer-thumbs');
  container.innerHTML = '';
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: 0.3 });
    const div = document.createElement('div');
    div.className = `notes-thumb ${i === notesViewerSlide ? 'active' : ''} ${selectedPdf.notes && selectedPdf.notes[i] ? 'notes-thumb-has-note' : ''}`;
    div.dataset.page = i;

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    const label = document.createElement('div');
    label.className = 'notes-thumb-label';
    label.textContent = i;

    div.appendChild(canvas);
    div.appendChild(label);
    container.appendChild(div);

    div.addEventListener('click', () => {
      saveCurrentNote();
      renderNotesViewerSlide(i);
    });
  }
}

async function renderNotesViewerSlide(num) {
  notesViewerSlide = num;
  const canvas = document.getElementById('notes-viewer-canvas');
  const page = await pdfDoc.getPage(num);
  const maxW = canvas.parentElement.clientWidth - 24;
  const maxH = canvas.parentElement.clientHeight - 24;
  const defaultVp = page.getViewport({ scale: 1 });
  const scale = Math.min(maxW / defaultVp.width, maxH / defaultVp.height, 2);
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
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
  if (!selectedPdf.notes) selectedPdf.notes = {};
  if (text.trim()) {
    selectedPdf.notes[notesViewerSlide] = text;
  } else {
    delete selectedPdf.notes[notesViewerSlide];
  }
  await saveMeta();
  // Update thumb indicator
  const thumb = document.querySelector(`.notes-thumb[data-page="${notesViewerSlide}"]`);
  if (thumb) {
    thumb.classList.toggle('notes-thumb-has-note', !!text.trim());
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
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  handle.addEventListener('mousedown', onMouseDown);
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
  document.getElementById('btn-close-edit-modal').addEventListener('click', () => {
    document.getElementById('edit-modal').classList.add('hidden');
  });

  // Notes viewer modal
  document.getElementById('btn-close-notes-viewer').addEventListener('click', () => {
    saveCurrentNote();
    document.getElementById('notes-viewer-modal').classList.add('hidden');
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
        // Save notes if closing notes viewer
        if (overlay.id === 'notes-viewer-modal') saveCurrentNote();
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

// Video overlay resize handles (proportional corner drag)
function setupVideoResizeHandles() {
  const container = document.querySelector('.slide-preview-container');
  const overlay = document.getElementById('video-overlay-preview');
  let resizing = false;
  let startCorner = null;
  let startMouseX, startMouseY;
  let startOvX, startOvY, startOvW, startOvH;
  let aspectRatio;

  overlay.addEventListener('mousedown', (e) => {
    const corner = e.target.dataset.corner;
    if (!corner) return;
    e.preventDefault();
    e.stopPropagation();

    resizing = true;
    startCorner = corner;
    startMouseX = e.clientX;
    startMouseY = e.clientY;
    startOvX = parseFloat(document.getElementById('video-x').value);
    startOvY = parseFloat(document.getElementById('video-y').value);
    startOvW = parseFloat(document.getElementById('video-w').value);
    startOvH = parseFloat(document.getElementById('video-h').value);
    aspectRatio = startOvW / startOvH;

    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
  });

  function onResizeMove(e) {
    if (!resizing) return;
    const rect = container.getBoundingClientRect();
    const dx = ((e.clientX - startMouseX) / rect.width) * 100;
    const dy = ((e.clientY - startMouseY) / rect.height) * 100;

    let newX = startOvX, newY = startOvY, newW = startOvW, newH = startOvH;

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

  function onResizeEnd() {
    resizing = false;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
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
}

init();
