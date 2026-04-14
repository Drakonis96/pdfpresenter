/**
 * @jest-environment jsdom
 */

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: jest.fn((key) => store[key] || null),
    setItem: jest.fn((key, value) => { store[key] = value; }),
    clear: jest.fn(() => { store = {}; }),
    removeItem: jest.fn((key) => { delete store[key]; }),
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// Load the i18n module by evaluating the file content (it's a browser script, not a module)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const i18nCode = fs.readFileSync(path.join(__dirname, '../src/js/i18n.js'), 'utf-8');

// Create a sandbox with DOM globals
const sandbox = {
  localStorage: localStorageMock,
  document: document,
  console: console,
};
vm.createContext(sandbox);
// Wrap code to expose const/let declarations as sandbox properties
const wrappedCode = i18nCode + `\nthis.translations = translations; this.t = t; this.setLanguage = setLanguage; this.getLanguage = getLanguage; this.applyTranslations = applyTranslations;`;
vm.runInContext(wrappedCode, sandbox);

// Pull functions out of the sandbox
const { translations, t, setLanguage, getLanguage, applyTranslations } = sandbox;

describe('i18n', () => {
  beforeEach(() => {
    localStorageMock.clear();
    // Reset to Spanish
    setLanguage('es');
  });

  describe('t() - translation function', () => {
    test('returns Spanish string by default', () => {
      expect(t('app.title')).toBe('PDF Presenter');
      expect(t('sidebar.presentations')).toBe('Presentaciones');
    });

    test('returns English string when language is set to en', () => {
      setLanguage('en');
      expect(t('sidebar.presentations')).toBe('Presentations');
      expect(t('detail.startPresentation')).toBe('Start Presentation');
    });

    test('returns the key itself for unknown keys', () => {
      expect(t('nonexistent.key')).toBe('nonexistent.key');
    });

    test('interpolates parameters', () => {
      const result = t('misc.pptxMismatch', { pptx: 10, pdf: 8 });
      expect(result).toContain('10');
      expect(result).toContain('8');
    });

    test('keeps placeholder if param not provided', () => {
      const result = t('misc.pptxMismatch', {});
      expect(result).toContain('{pptx}');
      expect(result).toContain('{pdf}');
    });
  });

  describe('setLanguage / getLanguage', () => {
    test('changes language and persists to localStorage', () => {
      setLanguage('en');
      expect(getLanguage()).toBe('en');
      expect(localStorageMock.setItem).toHaveBeenCalledWith('pdfpresenter-lang', 'en');
    });

    test('switches back to Spanish', () => {
      setLanguage('en');
      setLanguage('es');
      expect(getLanguage()).toBe('es');
    });
  });

  describe('applyTranslations', () => {
    test('translates elements with data-i18n attribute', () => {
      document.body.innerHTML = `
        <span data-i18n="sidebar.presentations"></span>
        <span data-i18n="detail.startPresentation"></span>
      `;

      setLanguage('es');
      applyTranslations();

      const spans = document.querySelectorAll('[data-i18n]');
      expect(spans[0].textContent).toBe('Presentaciones');
      expect(spans[1].textContent).toBe('Iniciar Presentación');
    });

    test('translates placeholder attributes', () => {
      document.body.innerHTML = `
        <input data-i18n-placeholder="sidebar.searchPlaceholder">
      `;

      setLanguage('en');
      applyTranslations();

      const input = document.querySelector('input');
      expect(input.placeholder).toBe('Search presentations...');
    });

    test('translates title attributes', () => {
      document.body.innerHTML = `
        <button data-i18n-title="sidebar.importPdf"></button>
      `;

      setLanguage('en');
      applyTranslations();

      const btn = document.querySelector('button');
      expect(btn.title).toBe('Import PDF');
    });
  });

  describe('Translation completeness', () => {
    test('all Spanish keys exist in English', () => {
      // Access translations through eval scope
      const esKeys = Object.keys(translations.es);
      const enKeys = Object.keys(translations.en);

      for (const key of esKeys) {
        expect(enKeys).toContain(key);
      }
    });

    test('all English keys exist in Spanish', () => {
      const esKeys = Object.keys(translations.es);
      const enKeys = Object.keys(translations.en);

      for (const key of enKeys) {
        expect(esKeys).toContain(key);
      }
    });
  });
});
