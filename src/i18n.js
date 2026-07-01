// src/i18n.js
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANGUAGES } from './constants/languages';

import en from './locales/en/translation.json';
import es from './locales/es/translation.json';
import fr from './locales/fr/translation.json';
import de from './locales/de/translation.json';
import pt from './locales/pt/translation.json';
import it from './locales/it/translation.json';
import ru from './locales/ru/translation.json';
import ar from './locales/ar/translation.json';
import hi from './locales/hi/translation.json';
import zh from './locales/zh/translation.json';

const RESOURCES = {
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  pt: { translation: pt },
  it: { translation: it },
  ru: { translation: ru },
  ar: { translation: ar },
  hi: { translation: hi },
  zh: { translation: zh },
};

const RTL_LANGS = new Set(['ar']);

const storedLang = localStorage.getItem('aura_lang');
const initialLang = storedLang && RESOURCES[storedLang] ? storedLang : 'en';

i18n.use(initReactI18next).init({
  resources: RESOURCES,
  lng: initialLang,
  fallbackLng: 'en',
  supportedLngs: LANGUAGES.map((l) => l.code),
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

// Keep <html lang>/dir in sync so RTL languages (Arabic) render correctly,
// and persist the choice. i18next fires 'languageChanged' globally, so every
// component using useTranslation() re-renders automatically — no reload needed.
function applyDocumentDirection(lng) {
  document.documentElement.lang = lng;
  document.documentElement.dir = RTL_LANGS.has(lng) ? 'rtl' : 'ltr';
}
applyDocumentDirection(i18n.language);
i18n.on('languageChanged', (lng) => {
  applyDocumentDirection(lng);
  localStorage.setItem('aura_lang', lng);
});

export default i18n;
