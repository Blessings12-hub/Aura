import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

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

const resources = {
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  pt: { translation: pt },
  it: { translation: it },
  ru: { translation: ru },
  ar: { translation: ar },
  hi: { translation: hi },
  zh: { translation: zh }
};

i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem('aura_lang') || 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
});

export default i18n;