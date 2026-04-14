// Internationalization system
const translations = {
  es: {
    'app.title': 'PDF Presenter',
    'sidebar.presentations': 'Presentaciones',
    'sidebar.importPdf': 'Importar PDF',
    'sidebar.searchPlaceholder': 'Buscar presentaciones...',
    'sidebar.sortRecentAdded': 'Recién añadidos',
    'sidebar.sortRecentOpened': 'Recién abiertos',
    'sidebar.sortNameAsc': 'Nombre A-Z',
    'sidebar.sortNameDesc': 'Nombre Z-A',
    'sidebar.all': 'Todos',
    'sidebar.noPresentation': 'No hay presentaciones',
    'sidebar.importToStart': 'Importa un PDF para empezar',
    'sidebar.noResults': 'Sin resultados',
    'sidebar.tryAnother': 'Prueba con otro término',
    'sidebar.slides': 'diapositivas',
    'sidebar.notLoaded': 'Sin cargar',
    'sidebar.notes': 'Notas',
    'sidebar.videos': 'Vídeos',
    'welcome.remoteControl': 'Control Remoto',
    'welcome.generatingQr': 'Generando QR...',
    'welcome.scanQr': 'Escanea con tu móvil para controlar la presentación',
    'detail.importNotes': 'Importar Notas (.pptx)',
    'detail.edit': 'Editar',
    'detail.notes': 'Notas',
    'detail.startPresentation': 'Iniciar Presentación',
    'detail.presenterMode': 'Modo Presentador',
    'detail.notesImported': 'notas importadas',
    'detail.noNotes': 'Sin notas',
    'detail.videoCount': 'vídeos',
    'detail.noVideos': 'Sin vídeos',
    'videoModal.title': 'Editar Diapositiva',
    'videoModal.youtubeVideo': 'Vídeo de YouTube',
    'videoModal.videoUrl': 'URL del vídeo',
    'videoModal.posX': 'Posición X (%)',
    'videoModal.posY': 'Posición Y (%)',
    'videoModal.width': 'Ancho (%)',
    'videoModal.height': 'Alto (%)',
    'videoModal.save': 'Guardar Vídeo',
    'videoModal.remove': 'Eliminar Vídeo',
    'editModal.title': 'Editar Diapositivas',
    'editModal.clickToEdit': 'Haz clic en una diapositiva para añadir o editar un vídeo de YouTube.',
    'editModal.videoIndicator': '▶ Vídeo',
    'notesViewer.title': 'Diapositivas y Notas',
    'notesViewer.save': 'Guardar',
    'notesViewer.placeholder': 'Escribe las notas del presentador aquí...',
    'notesViewer.slideLabel': 'Notas - Diapositiva',
    'deleteModal.title': 'Eliminar presentación',
    'deleteModal.confirm': '¿Estás seguro de que deseas eliminar',
    'deleteModal.irreversible': 'Esta acción no se puede deshacer.',
    'deleteModal.cancel': 'Cancelar',
    'deleteModal.delete': 'Eliminar',
    'moveModal.title': 'Mover a carpeta',
    'moveModal.selectFolder': 'Selecciona la carpeta de destino:',
    'moveModal.noFolder': 'Sin carpeta',
    'moveModal.cancel': 'Cancelar',
    'newFolderModal.title': 'Nueva carpeta',
    'newFolderModal.name': 'Nombre de la carpeta',
    'newFolderModal.placeholder': 'Mi carpeta',
    'newFolderModal.cancel': 'Cancelar',
    'newFolderModal.create': 'Crear',
    'settings.title': 'Ajustes',
    'settings.general': 'General',
    'settings.language': 'Idioma',
    'settings.languageDesc': 'Selecciona el idioma de la interfaz',
    'settings.spanish': 'Español',
    'settings.english': 'Inglés',
    'slide.slide': 'Diapositiva',
    'slide.hasNotes': 'Tiene notas',
    'slide.hasVideo': 'Tiene vídeo',
    'misc.close': 'Cerrar',
    'misc.deleteFolderConfirm': '¿Eliminar esta carpeta? Los documentos se moverán a la raíz.',
    'misc.pptxMismatch': 'El PowerPoint tiene {pptx} diapositivas pero el PDF tiene {pdf}. Deben tener el mismo número de páginas.',
    'video.play': 'Reproducir vídeo',
    'video.pause': 'Pausar vídeo',
  },
  en: {
    'app.title': 'PDF Presenter',
    'sidebar.presentations': 'Presentations',
    'sidebar.importPdf': 'Import PDF',
    'sidebar.searchPlaceholder': 'Search presentations...',
    'sidebar.sortRecentAdded': 'Recently Added',
    'sidebar.sortRecentOpened': 'Recently Opened',
    'sidebar.sortNameAsc': 'Name A-Z',
    'sidebar.sortNameDesc': 'Name Z-A',
    'sidebar.all': 'All',
    'sidebar.noPresentation': 'No presentations',
    'sidebar.importToStart': 'Import a PDF to get started',
    'sidebar.noResults': 'No results',
    'sidebar.tryAnother': 'Try another search term',
    'sidebar.slides': 'slides',
    'sidebar.notLoaded': 'Not loaded',
    'sidebar.notes': 'Notes',
    'sidebar.videos': 'Videos',
    'welcome.remoteControl': 'Remote Control',
    'welcome.generatingQr': 'Generating QR...',
    'welcome.scanQr': 'Scan with your phone to control the presentation',
    'detail.importNotes': 'Import Notes (.pptx)',
    'detail.edit': 'Edit',
    'detail.notes': 'Notes',
    'detail.startPresentation': 'Start Presentation',
    'detail.presenterMode': 'Presenter Mode',
    'detail.notesImported': 'notes imported',
    'detail.noNotes': 'No notes',
    'detail.videoCount': 'videos',
    'detail.noVideos': 'No videos',
    'videoModal.title': 'Edit Slide',
    'videoModal.youtubeVideo': 'YouTube Video',
    'videoModal.videoUrl': 'Video URL',
    'videoModal.posX': 'Position X (%)',
    'videoModal.posY': 'Position Y (%)',
    'videoModal.width': 'Width (%)',
    'videoModal.height': 'Height (%)',
    'videoModal.save': 'Save Video',
    'videoModal.remove': 'Remove Video',
    'editModal.title': 'Edit Slides',
    'editModal.clickToEdit': 'Click on a slide to add or edit a YouTube video.',
    'editModal.videoIndicator': '▶ Video',
    'notesViewer.title': 'Slides and Notes',
    'notesViewer.save': 'Save',
    'notesViewer.placeholder': 'Write presenter notes here...',
    'notesViewer.slideLabel': 'Notes - Slide',
    'deleteModal.title': 'Delete presentation',
    'deleteModal.confirm': 'Are you sure you want to delete',
    'deleteModal.irreversible': 'This action cannot be undone.',
    'deleteModal.cancel': 'Cancel',
    'deleteModal.delete': 'Delete',
    'moveModal.title': 'Move to folder',
    'moveModal.selectFolder': 'Select the destination folder:',
    'moveModal.noFolder': 'No folder',
    'moveModal.cancel': 'Cancel',
    'newFolderModal.title': 'New folder',
    'newFolderModal.name': 'Folder name',
    'newFolderModal.placeholder': 'My folder',
    'newFolderModal.cancel': 'Cancel',
    'newFolderModal.create': 'Create',
    'settings.title': 'Settings',
    'settings.general': 'General',
    'settings.language': 'Language',
    'settings.languageDesc': 'Select the interface language',
    'settings.spanish': 'Spanish',
    'settings.english': 'English',
    'slide.slide': 'Slide',
    'slide.hasNotes': 'Has notes',
    'slide.hasVideo': 'Has video',
    'misc.close': 'Close',
    'misc.deleteFolderConfirm': 'Delete this folder? Documents will be moved to root.',
    'misc.pptxMismatch': 'The PowerPoint has {pptx} slides but the PDF has {pdf}. They must have the same number of pages.',
    'video.play': 'Play video',
    'video.pause': 'Pause video',
  }
};

let currentLang = localStorage.getItem('pdfpresenter-lang') || 'es';

function t(key, params) {
  const str = (translations[currentLang] && translations[currentLang][key]) ||
              (translations['es'] && translations['es'][key]) || key;
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => params[k] !== undefined ? params[k] : `{${k}}`);
}

function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('pdfpresenter-lang', lang);
  applyTranslations();
}

function getLanguage() {
  return currentLang;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
}
