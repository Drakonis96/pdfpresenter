// Mobile Remote Control App
let ws;
let state = {
  presenting: false,
  pdfId: null,
  currentSlide: 1,
  totalSlides: 0,
  notes: {},
  videos: {},
  name: ''
};
let activeTool = null;
let fontSize = 16;
let pdfDoc = null;
let toolSizes = { pointer: 20, flashlight: 15, draw: 4, zoom: 200 };

// Load pdf.js
function loadPdfJs() {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve();
    };
    document.head.appendChild(script);
  });
}

// WebSocket connection
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log('Connected');
  };
  
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    
    switch (msg.type) {
      case 'state':
        handleStateUpdate(msg.data);
        break;
      case 'tool-data':
        renderToolOnPreview(msg.data);
        break;
      case 'tool-size':
        if (msg.data && msg.data.tool) {
          toolSizes[msg.data.tool] = msg.data.size;
        }
        break;
    }
  };
  
  ws.onclose = () => {
    console.log('Disconnected, retrying...');
    setTimeout(connect, 2000);
  };
  
  ws.onerror = () => {
    ws.close();
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// State handling
async function handleStateUpdate(newState) {
  const wasPresenting = state.presenting;
  const prevSlide = state.currentSlide;
  const prevPdfId = state.pdfId;
  
  Object.assign(state, newState);
  
  if (state.presenting) {
    showScreen('screen-remote');
    
    // Load PDF if needed
    if (state.pdfId && state.pdfId !== prevPdfId) {
      await loadPdf(state.pdfId);
    }
    
    updateUI();
    updateVideoToggleButton();
    
    if (state.currentSlide !== prevSlide || state.pdfId !== prevPdfId) {
      await renderPreview(state.currentSlide);
      clearPreviewDrawOverlay();
    }
  } else {
    showScreen('screen-waiting');
  }
}

async function loadPdf(pdfId) {
  try {
    const response = await fetch(`/api/pdf/${pdfId}`);
    const buffer = await response.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: buffer }).promise;
  } catch (err) {
    console.error('Error loading PDF:', err);
  }
}

async function renderPreview(slideNum) {
  if (!pdfDoc || slideNum < 1 || slideNum > pdfDoc.numPages) return;
  
  const canvas = document.getElementById('preview-canvas');
  const page = await pdfDoc.getPage(slideNum);
  
  const slideArea = document.querySelector('.slide-area');
  const maxWidth = slideArea.clientWidth - 24;
  const maxHeight = slideArea.clientHeight - 24;
  const defaultViewport = page.getViewport({ scale: 1 });
  const scaleW = maxWidth / defaultViewport.width;
  const scaleH = maxHeight / defaultViewport.height;
  const scale = Math.min(scaleW, scaleH, 2);
  const viewport = page.getViewport({ scale });
  
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
}

function updateUI() {
  // Title
  document.getElementById('presentation-title').textContent = state.name || 'Presentación';
  
  // Slide counter
  document.getElementById('slide-counter').textContent = `${state.currentSlide} / ${state.totalSlides}`;
  
  // Notes
  const noteKey = state.currentSlide;
  const note = state.notes && state.notes[noteKey];
  const notesContent = document.getElementById('notes-content');
  const notesSlideLabel = document.getElementById('notes-slide-label');
  
  notesSlideLabel.textContent = `Slide ${state.currentSlide}`;
  
  if (note && note.trim()) {
    notesContent.innerHTML = `<p>${escapeHtml(note).replace(/\n/g, '<br>')}</p>`;
  } else {
    notesContent.innerHTML = '<p class="notes-empty">Sin notas para esta diapositiva</p>';
  }
  notesContent.style.fontSize = fontSize + 'px';
  
  // Dots
  renderDots();
}

function renderDots() {
  const container = document.getElementById('slide-dots');
  const maxDots = 40;
  const total = Math.min(state.totalSlides, maxDots);
  
  let html = '';
  for (let i = 1; i <= state.totalSlides; i++) {
    if (state.totalSlides > maxDots) {
      // Show subset around current slide
      const half = Math.floor(maxDots / 2);
      let start = Math.max(1, state.currentSlide - half);
      let end = Math.min(state.totalSlides, start + maxDots - 1);
      if (end - start < maxDots - 1) start = Math.max(1, end - maxDots + 1);
      
      if (i < start || i > end) continue;
    }
    html += `<div class="slide-dot ${i === state.currentSlide ? 'active' : ''}" data-slide="${i}"></div>`;
  }
  container.innerHTML = html;
  
  // Scroll active dot into view
  const activeDot = container.querySelector('.slide-dot.active');
  if (activeDot) {
    activeDot.scrollIntoView({ inline: 'center', behavior: 'smooth' });
  }
  
  // Click handlers
  container.querySelectorAll('.slide-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      send({ type: 'navigate', slide: parseInt(dot.dataset.slide) });
    });
  });
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// Navigation
document.getElementById('btn-prev').addEventListener('click', () => {
  send({ type: 'prev' });
});

document.getElementById('btn-next').addEventListener('click', () => {
  send({ type: 'next' });
});

// Video toggle
function updateVideoToggleButton() {
  const hasVideo = state.videos && state.videos[state.currentSlide];
  const videoBtn = document.getElementById('btn-video-toggle');
  if (hasVideo) {
    videoBtn.classList.remove('hidden');
  } else {
    videoBtn.classList.add('hidden');
  }
  // Update play/pause icon
  const isPlaying = !!state.videoPlaying;
  document.getElementById('mobile-video-play-icon').classList.toggle('hidden', isPlaying);
  document.getElementById('mobile-video-pause-icon').classList.toggle('hidden', !isPlaying);
}

document.getElementById('btn-video-toggle').addEventListener('click', () => {
  send({ type: 'video-toggle' });
});

// Preview tool overlays
let previewDrawing = false;
let previewLastX = 0;
let previewLastY = 0;

function hidePreviewOverlays() {
  ['preview-pointer-overlay', 'preview-flashlight-overlay', 'preview-draw-overlay', 'preview-zoom-overlay'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

function clearPreviewDrawOverlay() {
  const c = document.getElementById('preview-draw-overlay');
  if (c && c.getContext) {
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
  }
}

function updatePreviewToolSize(tool) {
  switch (tool) {
    case 'pointer': {
      const dot = document.getElementById('preview-pointer-dot');
      if (dot && !document.getElementById('preview-pointer-overlay').classList.contains('hidden')) {
        const dotSize = Math.max(6, toolSizes.pointer / 2);
        dot.style.width = dotSize + 'px';
        dot.style.height = dotSize + 'px';
      }
      break;
    }
    case 'flashlight': {
      const mask = document.getElementById('preview-flashlight-mask');
      if (mask && !document.getElementById('preview-flashlight-overlay').classList.contains('hidden')) {
        mask.style.setProperty('--r', toolSizes.flashlight + '%');
      }
      break;
    }
    case 'zoom': {
      const dot = document.getElementById('preview-zoom-dot');
      if (dot && !document.getElementById('preview-zoom-overlay').classList.contains('hidden')) {
        const zoomSize = Math.max(8, toolSizes.zoom / 15);
        dot.style.width = zoomSize + 'px';
        dot.style.height = zoomSize + 'px';
      }
      break;
    }
    // draw: line width applies on next stroke, no live preview needed
  }
}

function renderToolOnPreview(data) {
  if (!data || !data.tool) return;
  
  switch (data.tool) {
    case 'pointer': {
      const overlay = document.getElementById('preview-pointer-overlay');
      const dot = document.getElementById('preview-pointer-dot');
      if (!overlay || !dot) return;
      overlay.classList.remove('hidden');
      dot.style.left = data.x + '%';
      dot.style.top = data.y + '%';
      const dotSize = Math.max(6, (data.size || toolSizes.pointer) / 2);
      dot.style.width = dotSize + 'px';
      dot.style.height = dotSize + 'px';
      break;
    }
    case 'flashlight': {
      const overlay = document.getElementById('preview-flashlight-overlay');
      const mask = document.getElementById('preview-flashlight-mask');
      if (!overlay || !mask) return;
      overlay.classList.remove('hidden');
      mask.style.setProperty('--cx', data.x + '%');
      mask.style.setProperty('--cy', data.y + '%');
      mask.style.setProperty('--r', (data.r || toolSizes.flashlight) + '%');
      break;
    }
    case 'draw': {
      const canvas = document.getElementById('preview-draw-overlay');
      if (!canvas) return;
      canvas.classList.remove('hidden');
      const previewCanvas = document.getElementById('preview-canvas');
      const ctx = canvas.getContext('2d');
      
      if (data.action === 'start') {
        if (canvas.width !== previewCanvas.offsetWidth) {
          canvas.width = previewCanvas.offsetWidth;
          canvas.height = previewCanvas.offsetHeight;
        }
        previewDrawing = true;
        previewLastX = data.x * canvas.width / 100;
        previewLastY = data.y * canvas.height / 100;
      } else if (data.action === 'move' && previewDrawing) {
        const newX = data.x * canvas.width / 100;
        const newY = data.y * canvas.height / 100;
        ctx.beginPath();
        ctx.moveTo(previewLastX, previewLastY);
        ctx.lineTo(newX, newY);
        ctx.strokeStyle = data.color || '#6366f1';
        ctx.lineWidth = Math.max(1, (data.lineWidth || toolSizes.draw) / 2);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        previewLastX = newX;
        previewLastY = newY;
      } else if (data.action === 'end') {
        previewDrawing = false;
      } else if (data.action === 'clear') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      break;
    }
    case 'zoom': {
      const overlay = document.getElementById('preview-zoom-overlay');
      const dot = document.getElementById('preview-zoom-dot');
      if (!overlay || !dot) return;
      overlay.classList.remove('hidden');
      dot.style.left = data.x + '%';
      dot.style.top = data.y + '%';
      const zoomSize = Math.max(8, (data.size || toolSizes.zoom) / 15);
      dot.style.width = zoomSize + 'px';
      dot.style.height = zoomSize + 'px';
      break;
    }
  }
}

// Tools
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;
    
    if (activeTool === tool) {
      // Deactivate
      activeTool = null;
      btn.classList.remove('active');
      document.getElementById('btn-clear-draw').classList.add('hidden');
      hidePreviewOverlays();
      send({ type: 'tool', tool: null });
    } else {
      // Activate
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTool = tool;
      hidePreviewOverlays();
      
      // Show clear button only for draw tool
      const clearBtn = document.getElementById('btn-clear-draw');
      if (tool === 'draw') {
        clearBtn.classList.remove('hidden');
      } else {
        clearBtn.classList.add('hidden');
      }
      
      send({ type: 'tool', tool });
    }
  });
});

// Touch handling for tools
const touchArea = document.getElementById('touch-area');

// Clear drawing button
document.getElementById('btn-clear-draw').addEventListener('click', () => {
  send({ type: 'tool-data', data: { tool: 'draw', action: 'clear' } });
  renderToolOnPreview({ tool: 'draw', action: 'clear' });
});

function getRelativePos(touch) {
  const rect = touchArea.getBoundingClientRect();
  return {
    x: ((touch.clientX - rect.left) / rect.width) * 100,
    y: ((touch.clientY - rect.top) / rect.height) * 100
  };
}

touchArea.addEventListener('touchstart', (e) => {
  if (!activeTool) return;
  e.preventDefault();
  const pos = getRelativePos(e.touches[0]);
  let data;
  
  if (activeTool === 'draw') {
    data = { tool: 'draw', action: 'start', ...pos, lineWidth: toolSizes.draw };
  } else if (activeTool === 'flashlight') {
    data = { tool: 'flashlight', ...pos, r: toolSizes.flashlight };
  } else {
    data = { tool: activeTool, ...pos, size: toolSizes[activeTool] };
  }
  send({ type: 'tool-data', data });
  renderToolOnPreview(data);
}, { passive: false });

touchArea.addEventListener('touchmove', (e) => {
  if (!activeTool) return;
  e.preventDefault();
  const pos = getRelativePos(e.touches[0]);
  let data;
  
  if (activeTool === 'draw') {
    data = { tool: 'draw', action: 'move', ...pos, lineWidth: toolSizes.draw };
  } else if (activeTool === 'flashlight') {
    data = { tool: 'flashlight', ...pos, r: toolSizes.flashlight };
  } else {
    data = { tool: activeTool, ...pos, size: toolSizes[activeTool] };
  }
  send({ type: 'tool-data', data });
  renderToolOnPreview(data);
}, { passive: false });

touchArea.addEventListener('touchend', (e) => {
  if (!activeTool) return;
  if (activeTool === 'draw') {
    const data = { tool: 'draw', action: 'end' };
    send({ type: 'tool-data', data });
    renderToolOnPreview(data);
  }
});

// Font size controls
document.getElementById('btn-font-decrease').addEventListener('click', () => {
  if (fontSize > 10) {
    fontSize -= 2;
    document.getElementById('font-size-value').textContent = fontSize;
    document.getElementById('notes-content').style.fontSize = fontSize + 'px';
  }
});

document.getElementById('btn-font-increase').addEventListener('click', () => {
  if (fontSize < 32) {
    fontSize += 2;
    document.getElementById('font-size-value').textContent = fontSize;
    document.getElementById('notes-content').style.fontSize = fontSize + 'px';
  }
});

// Resizable divider between slide preview and notes
(function setupResizeHandle() {
  const handle = document.getElementById('resize-handle');
  const notesSection = document.getElementById('notes-section');
  let startY = 0;
  let startHeight = 0;

  handle.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startY = e.touches[0].clientY;
    startHeight = notesSection.offsetHeight;
  }, { passive: false });

  handle.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const dy = startY - e.touches[0].clientY;
    const newHeight = Math.max(60, Math.min(window.innerHeight * 0.7, startHeight + dy));
    notesSection.style.maxHeight = newHeight + 'px';
    notesSection.style.height = newHeight + 'px';
  }, { passive: false });

  handle.addEventListener('touchend', () => {
    if (state.currentSlide && pdfDoc) {
      renderPreview(state.currentSlide);
    }
  });
})();

// Tool size settings popup
(function setupToolSizeSettings() {
  const popup = document.getElementById('tool-size-popup');
  const btn = document.getElementById('btn-tool-settings');

  btn.addEventListener('click', () => {
    popup.classList.toggle('hidden');
  });

  popup.addEventListener('click', (e) => {
    if (e.target === popup) popup.classList.add('hidden');
  });

  const toolSizesCfg = { pointer: 20, flashlight: 15, draw: 4, zoom: 200 };

  ['pointer', 'flashlight', 'draw', 'zoom'].forEach(tool => {
    const slider = document.getElementById('size-' + tool);
    const valEl = document.getElementById('size-' + tool + '-val');
    slider.addEventListener('input', () => {
      toolSizes[tool] = parseInt(slider.value);
      valEl.textContent = slider.value;
      send({ type: 'tool-size', data: { tool, size: toolSizes[tool] } });
      // Update preview overlay live
      updatePreviewToolSize(tool);
    });
  });
})();

// Utility
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Swipe gestures for navigation
let touchStartX = 0;
let touchStartY = 0;
const slideArea = document.querySelector('.slide-area');

slideArea.addEventListener('touchstart', (e) => {
  if (activeTool) return; // Don't interfere with tool mode
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

slideArea.addEventListener('touchend', (e) => {
  if (activeTool) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
    if (dx < 0) {
      send({ type: 'next' });
    } else {
      send({ type: 'prev' });
    }
  }
}, { passive: true });

// Init
async function init() {
  await loadPdfJs();
  connect();
}

init();
