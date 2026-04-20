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
let localTimerSeconds = 0;
let localTimerRunning = false;
let localTimerInterval = null;

// Slide zoom state
let slideZoomScale = 1;
let slideZoomOriginX = 50;
let slideZoomOriginY = 50;
let pinchStartDist = 0;
let pinchStartScale = 1;
let pinchZoomEnabled = false;

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
let hasConnectedOnce = false;

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const pin = new URLSearchParams(location.search).get('pin') || '';
  const wsUrl = `${protocol}//${location.host}?pin=${encodeURIComponent(pin)}`;
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log('Connected');
    hasConnectedOnce = true;
    const toast = document.getElementById('reconnect-toast');
    if (toast) toast.classList.add('hidden');
    // Request current volume level
    send({ type: 'volume-get' });
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
      case 'zoom-factor':
        if (msg.factor) {
          document.querySelectorAll('#zoom-factor-buttons .zoom-factor-btn').forEach(b => {
            b.classList.toggle('active', parseFloat(b.dataset.factor) === parseFloat(msg.factor));
          });
        }
        break;
      case 'timer-sync':
        handleTimerSync(msg.data);
        break;
      case 'volume':
        if (msg.data) {
          updateVolumeUI(msg.data.volume);
        }
        break;
      case 'slide-zoom':
        if (msg.data) {
          slideZoomScale = msg.data.scale;
          slideZoomOriginX = msg.data.originX;
          slideZoomOriginY = msg.data.originY;
          applySlideZoomPreview();
        }
        break;
    }
  };
  
  ws.onclose = () => {
    console.log('Disconnected, retrying...');
    if (hasConnectedOnce) {
      const toast = document.getElementById('reconnect-toast');
      if (toast) toast.classList.remove('hidden');
    }
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
    
    // Sync timer only on initial connection (not on every slide change)
    if (!wasPresenting && newState.timerSeconds !== undefined) {
      handleTimerSync({ timerSeconds: newState.timerSeconds, timerRunning: newState.timerRunning });
    }

    // Sync slide zoom from state
    if (newState.slideZoom) {
      slideZoomScale = newState.slideZoom.scale;
      slideZoomOriginX = newState.slideZoom.originX;
      slideZoomOriginY = newState.slideZoom.originY;
      applySlideZoomPreview();
    }
    
    // Load PDF if needed
    if (state.pdfId && state.pdfId !== prevPdfId) {
      await loadPdf(state.pdfId);
    }
    
    updateUI();
    updateVideoToggleButton();
    updateBlackScreenButton();
    
    if (state.currentSlide !== prevSlide || state.pdfId !== prevPdfId) {
      const notesContent = document.getElementById('notes-content');
      if (notesContent) notesContent.scrollTop = 0;
      await renderPreview(state.currentSlide);
      clearPreviewDrawOverlay();
      // Reset zoom on slide change
      slideZoomScale = 1;
      slideZoomOriginX = 50;
      slideZoomOriginY = 50;
      applySlideZoomPreview();
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
  
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(viewport.width * dpr);
  canvas.height = Math.round(viewport.height * dpr);
  canvas.style.width = viewport.width + 'px';
  canvas.style.height = viewport.height + 'px';
  
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  await page.render({ canvasContext: ctx, viewport }).promise;
}

function handleTimerSync(data) {
  localTimerSeconds = data.timerSeconds;
  localTimerRunning = data.timerRunning;
  updateMobileTimerDisplay();

  // Start/stop local tick using timestamp to avoid drift between syncs
  clearInterval(localTimerInterval);
  if (localTimerRunning) {
    const syncedAt = Date.now();
    const baseSeconds = localTimerSeconds;
    localTimerInterval = setInterval(() => {
      localTimerSeconds = baseSeconds + Math.floor((Date.now() - syncedAt) / 1000);
      updateMobileTimerDisplay();
    }, 1000);
  }
}

function updateMobileTimerDisplay() {
  const h = Math.floor(localTimerSeconds / 3600);
  const m = Math.floor((localTimerSeconds % 3600) / 60);
  const s = localTimerSeconds % 60;
  const el = document.getElementById('mobile-timer');
  if (el) {
    el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    el.classList.toggle('paused', !localTimerRunning);
  }
}

function updateUI() {
  // Slide counter
  document.getElementById('slide-counter').textContent = `${state.currentSlide} / ${state.totalSlides}`;
  updateFullscreenSlideCounter();
  
  // Notes
  const noteKey = state.currentSlide;
  const note = state.notes && state.notes[noteKey];
  const notesContent = document.getElementById('notes-content');
  const notesSlideLabel = document.getElementById('notes-slide-label');
  
  notesSlideLabel.textContent = `Slide ${state.currentSlide}`;
  
  if (note && note.trim()) {
    const paragraphs = note.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    notesContent.innerHTML = paragraphs.map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
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
  // Sync fullscreen bar
  updateFullscreenVideoToggle();
}

document.getElementById('btn-video-toggle').addEventListener('click', () => {
  send({ type: 'video-toggle' });
});

// Timer toggle (click on timer to pause/resume)
document.getElementById('mobile-timer').addEventListener('click', () => {
  send({ type: 'timer-toggle', data: { timerSeconds: localTimerSeconds } });
});

// Timer reset
document.getElementById('btn-timer-reset').addEventListener('click', () => {
  send({ type: 'timer-reset' });
});

// Black screen toggle
document.getElementById('btn-black-screen').addEventListener('click', () => {
  send({ type: 'black-screen' });
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
        ctx.strokeStyle = data.color || '#ef4444';
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
document.querySelectorAll('.tools-bar .tool-btn').forEach(btn => {
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
      document.querySelectorAll('.tools-bar .tool-btn').forEach(b => b.classList.remove('active'));
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
    // Sync fullscreen toolbar
    syncFullscreenToolState();
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
  // Detect pinch-to-zoom (2 fingers) — only if pinch zoom is enabled
  if (e.touches.length === 2 && pinchZoomEnabled) {
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    pinchStartDist = Math.hypot(dx, dy);
    pinchStartScale = slideZoomScale;
    if (slideZoomScale <= 1) {
      slideZoomOriginX = 50;
      slideZoomOriginY = 50;
    }
    return;
  }
  if (!activeTool) return;
  e.preventDefault();
  const pos = getRelativePos(e.touches[0]);
  let data;
  
  if (activeTool === 'draw') {
    data = { tool: 'draw', action: 'start', ...pos, lineWidth: toolSizes.draw, color: '#ef4444' };
  } else if (activeTool === 'flashlight') {
    data = { tool: 'flashlight', ...pos, r: toolSizes.flashlight };
  } else {
    data = { tool: activeTool, ...pos, size: toolSizes[activeTool] };
  }
  send({ type: 'tool-data', data });
  renderToolOnPreview(data);
}, { passive: false });

touchArea.addEventListener('touchmove', (e) => {
  // Handle pinch-to-zoom (2 fingers) — only if pinch zoom is enabled
  if (e.touches.length === 2 && pinchStartDist > 0 && pinchZoomEnabled) {
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    slideZoomScale = Math.max(1, Math.min(5, pinchStartScale * (dist / pinchStartDist)));
    applySlideZoomPreview();
    send({ type: 'slide-zoom', data: { scale: slideZoomScale, originX: slideZoomOriginX, originY: slideZoomOriginY } });
    return;
  }
  if (!activeTool) return;
  e.preventDefault();
  const pos = getRelativePos(e.touches[0]);
  let data;
  
  if (activeTool === 'draw') {
    data = { tool: 'draw', action: 'move', ...pos, lineWidth: toolSizes.draw, color: '#ef4444' };
  } else if (activeTool === 'flashlight') {
    data = { tool: 'flashlight', ...pos, r: toolSizes.flashlight };
  } else {
    data = { tool: activeTool, ...pos, size: toolSizes[activeTool] };
  }
  send({ type: 'tool-data', data });
  renderToolOnPreview(data);
}, { passive: false });

touchArea.addEventListener('touchend', (e) => {
  if (e.touches.length < 2) {
    pinchStartDist = 0;
  }
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

  // Zoom factor buttons
  document.querySelectorAll('#zoom-factor-buttons .zoom-factor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#zoom-factor-buttons .zoom-factor-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      send({ type: 'zoom-factor', factor: parseFloat(btn.dataset.factor) });
    });
  });

  // Volume slider
  const volumeSlider = document.getElementById('volume-slider');
  const volumeVal = document.getElementById('volume-val');
  let volumeTimeout = null;
  volumeSlider.addEventListener('input', () => {
    const vol = parseInt(volumeSlider.value);
    volumeVal.textContent = vol;
    clearTimeout(volumeTimeout);
    volumeTimeout = setTimeout(() => {
      send({ type: 'volume-set', data: { volume: vol } });
    }, 100);
  });

  // Mute button
  let lastVolume = 50;
  document.getElementById('btn-volume-mute').addEventListener('click', () => {
    const current = parseInt(volumeSlider.value);
    if (current > 0) {
      lastVolume = current;
      volumeSlider.value = 0;
      volumeVal.textContent = '0';
      send({ type: 'volume-set', data: { volume: 0 } });
    } else {
      volumeSlider.value = lastVolume;
      volumeVal.textContent = lastVolume;
      send({ type: 'volume-set', data: { volume: lastVolume } });
    }
  });
})();

// Utility
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Black screen button state
function updateBlackScreenButton() {
  const btn = document.getElementById('btn-black-screen');
  if (btn) btn.classList.toggle('active', !!state.blackScreen);
  updateFullscreenBlackScreen();
}

// Volume UI
function updateVolumeUI(vol) {
  const slider = document.getElementById('volume-slider');
  const valEl = document.getElementById('volume-val');
  if (slider) slider.value = vol;
  if (valEl) valEl.textContent = vol;
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

// Apply slide zoom visually on mobile preview
function applySlideZoomPreview() {
  const preview = document.getElementById('slide-preview');
  if (slideZoomScale <= 1) {
    slideZoomScale = 1;
    slideZoomOriginX = 50;
    slideZoomOriginY = 50;
    preview.style.transform = '';
    preview.style.transformOrigin = '';
  } else {
    preview.style.transformOrigin = slideZoomOriginX + '% ' + slideZoomOriginY + '%';
    preview.style.transform = 'scale(' + slideZoomScale + ')';
  }
}

// Carousel
let carouselRendered = false;
let carouselRenderedPdfId = null;

function openCarousel() {
  const overlay = document.getElementById('carousel-overlay');
  const track = document.getElementById('carousel-track');
  overlay.classList.remove('hidden');

  // Only re-render thumbnails if PDF changed
  if (carouselRendered && carouselRenderedPdfId === state.pdfId) {
    updateCarouselActive(track);
    scrollCarouselToActive(track);
  } else {
    renderCarouselThumbnails(track);
  }
}

function closeCarousel() {
  document.getElementById('carousel-overlay').classList.add('hidden');
}

function updateCarouselActive(track) {
  track.querySelectorAll('.carousel-item').forEach(el => {
    const s = parseInt(el.dataset.slide);
    el.classList.toggle('active', s === state.currentSlide);
  });
}

function scrollCarouselToActive(track) {
  const activeItem = track.querySelector('.carousel-item.active');
  if (activeItem) {
    const trackRect = track.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();
    const scrollLeft = track.scrollLeft + (itemRect.left - trackRect.left) - (trackRect.width / 2) + (itemRect.width / 2);
    track.scrollLeft = scrollLeft;
  }
}

async function renderCarouselThumbnails(track) {
  if (!pdfDoc) return;
  track.innerHTML = '';

  const thumbWidth = 200;
  const dpr = window.devicePixelRatio || 1;

  // Pre-create all items with placeholder canvases (fixed size) to avoid layout shifts
  const items = [];
  // Get first page to determine aspect ratio
  const firstPage = await pdfDoc.getPage(1);
  const firstVp = firstPage.getViewport({ scale: 1 });
  const placeholderScale = thumbWidth / firstVp.width;
  const placeholderH = Math.round(firstVp.height * placeholderScale);

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const item = document.createElement('div');
    item.className = 'carousel-item' + (i === state.currentSlide ? ' active' : '');
    item.dataset.slide = i;

    const canvas = document.createElement('canvas');
    // Set fixed display size immediately to prevent layout shifts
    canvas.style.width = thumbWidth + 'px';
    canvas.style.height = placeholderH + 'px';
    canvas.width = Math.round(thumbWidth * dpr);
    canvas.height = Math.round(placeholderH * dpr);

    const label = document.createElement('span');
    label.className = 'carousel-label';
    label.textContent = i;

    item.appendChild(canvas);
    item.appendChild(label);
    track.appendChild(item);
    items.push({ item, canvas, slideNum: i });

    item.addEventListener('click', () => {
      send({ type: 'navigate', slide: i });
      closeCarousel();
    });
  }

  // Scroll to active slide immediately (before rendering)
  scrollCarouselToActive(track);

  // Now render thumbnails without causing layout shifts
  for (const { canvas, slideNum } of items) {
    const page = await pdfDoc.getPage(slideNum);
    const vp = page.getViewport({ scale: 1 });
    const scale = thumbWidth / vp.width;
    const viewport = page.getViewport({ scale });

    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    await page.render({ canvasContext: ctx, viewport }).promise;
  }

  carouselRendered = true;
  carouselRenderedPdfId = state.pdfId;
}

document.getElementById('btn-carousel').addEventListener('click', openCarousel);
document.getElementById('carousel-close').addEventListener('click', closeCarousel);
document.getElementById('carousel-backdrop').addEventListener('click', closeCarousel);

// ===== Pinch-Zoom Toggle (mobile only) =====

function togglePinchZoom() {
  pinchZoomEnabled = !pinchZoomEnabled;
  document.getElementById('btn-pinch-zoom').classList.toggle('active', pinchZoomEnabled);
  document.getElementById('fs-btn-pinch-zoom').classList.toggle('active', pinchZoomEnabled);
}

document.getElementById('btn-pinch-zoom').addEventListener('click', togglePinchZoom);
document.getElementById('fs-btn-pinch-zoom').addEventListener('click', togglePinchZoom);

// ===== Fullscreen / Landscape Mode =====

function isFullscreenActive() {
  const remote = document.getElementById('screen-remote');
  if (remote.classList.contains('fullscreen-mode')) return true;
  // Also check landscape auto-fullscreen
  if (window.matchMedia('(orientation: landscape)').matches && !remote.classList.contains('no-auto-fullscreen')) return true;
  return false;
}

function updateFullscreenSlideCounter() {
  const el = document.getElementById('fs-slide-counter');
  if (el) el.textContent = `${state.currentSlide} / ${state.totalSlides}`;
}

function syncFullscreenToolState() {
  // Mirror active tool state to fullscreen-bar buttons
  document.querySelectorAll('#fullscreen-bar .tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === activeTool);
  });
}

function updateFullscreenVideoToggle() {
  const hasVideo = state.videos && state.videos[state.currentSlide];
  const fsBtn = document.getElementById('fs-btn-video-toggle');
  if (fsBtn) {
    if (hasVideo) {
      fsBtn.classList.remove('hidden');
    } else {
      fsBtn.classList.add('hidden');
    }
    const isPlaying = !!state.videoPlaying;
    const playIcon = document.getElementById('fs-video-play-icon');
    const pauseIcon = document.getElementById('fs-video-pause-icon');
    if (playIcon) playIcon.classList.toggle('hidden', isPlaying);
    if (pauseIcon) pauseIcon.classList.toggle('hidden', !isPlaying);
  }
}

function enterFullscreen() {
  document.getElementById('screen-remote').classList.add('fullscreen-mode');
  syncFullscreenToolState();
  updateFullscreenSlideCounter();
  updateFullscreenVideoToggle();
  updateFullscreenBlackScreen();
  // Re-render preview after layout change
  setTimeout(() => {
    if (state.currentSlide && pdfDoc) renderPreview(state.currentSlide);
  }, 50);
}

function exitFullscreen() {
  document.getElementById('screen-remote').classList.remove('fullscreen-mode');
  // Re-render preview after layout change
  setTimeout(() => {
    if (state.currentSlide && pdfDoc) renderPreview(state.currentSlide);
  }, 50);
}

function updateFullscreenBlackScreen() {
  const btn = document.getElementById('fs-btn-black-screen');
  if (btn) btn.classList.toggle('active', !!state.blackScreen);
}

// Fullscreen enter/exit buttons
document.getElementById('btn-fullscreen-mode').addEventListener('click', enterFullscreen);
document.getElementById('btn-exit-fullscreen').addEventListener('click', exitFullscreen);

// Fullscreen-bar navigation buttons
document.getElementById('fs-btn-prev').addEventListener('click', () => send({ type: 'prev' }));
document.getElementById('fs-btn-next').addEventListener('click', () => send({ type: 'next' }));

// Fullscreen-bar tool buttons (mirror main toolbar)
document.querySelectorAll('#fullscreen-bar .tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;
    if (activeTool === tool) {
      activeTool = null;
      hidePreviewOverlays();
      send({ type: 'tool', tool: null });
    } else {
      activeTool = tool;
      hidePreviewOverlays();
      send({ type: 'tool', tool });
    }
    // Sync both toolbars
    document.querySelectorAll('.tool-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === activeTool);
    });
    // Show/hide clear draw button
    const clearBtn = document.getElementById('btn-clear-draw');
    if (activeTool === 'draw') {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
  });
});

// Fullscreen-bar video toggle
document.getElementById('fs-btn-video-toggle').addEventListener('click', () => {
  send({ type: 'video-toggle' });
});

// Fullscreen-bar black screen
document.getElementById('fs-btn-black-screen').addEventListener('click', () => {
  send({ type: 'black-screen' });
});

// Re-render on orientation change (landscape triggers auto-fullscreen via CSS)
window.matchMedia('(orientation: landscape)').addEventListener('change', () => {
  syncFullscreenToolState();
  updateFullscreenSlideCounter();
  updateFullscreenVideoToggle();
  updateFullscreenBlackScreen();
  setTimeout(() => {
    if (state.currentSlide && pdfDoc) renderPreview(state.currentSlide);
  }, 100);
});

// Init
async function init() {
  await loadPdfJs();
  connect();

  // Initialize timer from state if available
  if (state.timerSeconds !== undefined) {
    handleTimerSync({ timerSeconds: state.timerSeconds, timerRunning: state.timerRunning });
  }
}

init();
