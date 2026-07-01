import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/strings';
import { LANGUAGES } from './constants/languages';

const STORAGE_KEY = 'aura_translations_cache_v1';
const BACKEND = import.meta.env.VITE_BACKEND_URL || import.meta.env.REACT_APP_BACKEND_URL || '';

// load cached translations
const loadCache = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
};
const saveCache = (c) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch {}
};

const cache = loadCache();

// Build base resources: every language starts with English keys; cached translations override per-key.
const buildResources = () => {
  const out = { en: { translation: { ...en } } };
  for (const lang of LANGUAGES) {
    if (lang.code === 'en') continue;
    const langCache = cache[lang.code] || {};
    const merged = { ...en, ...langCache };
    out[lang.code] = { translation: merged };
  }
  return out;
};

i18n.use(initReactI18next).init({
  resources: buildResources(),
  lng: localStorage.getItem('aura_lang') || 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

// HTML dir attribute (RTL for Arabic)
const applyDir = (lng) => {
  document.documentElement.lang = lng;
  document.documentElement.dir = lng === 'ar' ? 'rtl' : 'ltr';
};
applyDir(i18n.language);
i18n.on('languageChanged', applyDir);

// Fetch missing translations from backend Gemini proxy and store in cache.
async function fetchTranslation(text, target) {
  if (!BACKEND || target === 'en') return text;
  try {
    const res = await fetch(`${BACKEND}/api/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, target }),
    });
    if (!res.ok) return text;
    const data = await res.json();
    return data.translatedText || text;
  } catch {
    return text;
  }
}

// On language change, translate any missing strings in the background and trigger re-render.
async function ensureLanguageTranslated(lng) {
  if (lng === 'en') return;
  const langCache = cache[lng] || {};
  const keys = Object.keys(en);
  const missing = keys.filter((k) => !langCache[k]);
  if (missing.length === 0) return;

  // Translate sequentially to keep things calm; backend caches in Mongo so it's fast on next switch.
  for (const k of missing) {
    // eslint-disable-next-line no-await-in-loop
    const translated = await fetchTranslation(en[k], lng);
    langCache[k] = translated;
    i18n.addResource(lng, 'translation', k, translated);
  }
  cache[lng] = langCache;
  saveCache(cache);
  // Force a refresh
  i18n.changeLanguage(lng);
}

i18n.on('languageChanged', (lng) => {
  ensureLanguageTranslated(lng);
});

// Trigger first run for stored lang
ensureLanguageTranslated(i18n.language);

// Helper: translate arbitrary dynamic text (e.g., chat messages) lazily.
const dynamicCache = {};
export async function translateDynamic(text, target) {
  if (!text || target === 'en') return text;
  const k = `${target}::${text}`;
  if (dynamicCache[k]) return dynamicCache[k];
  const out = await fetchTranslation(text, target);
  dynamicCache[k] = out;
  return out;
}

export default i18n;