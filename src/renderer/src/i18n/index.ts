import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import es from './locales/es.json'
import pt from './locales/pt.json'
import fr from './locales/fr.json'
import de from './locales/de.json'
import it from './locales/it.json'
import zh from './locales/zh.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import ru from './locales/ru.json'
import ar from './locales/ar.json'
import fa from './locales/fa.json'
import ur from './locales/ur.json'

export const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', countryCode: 'GB' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', countryCode: 'ES' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', countryCode: 'BR' },
  { code: 'fr', name: 'French', nativeName: 'Français', countryCode: 'FR' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', countryCode: 'DE' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', countryCode: 'IT' },
  { code: 'zh', name: 'Chinese', nativeName: '中文', countryCode: 'CN' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', countryCode: 'JP' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', countryCode: 'KR' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', countryCode: 'RU' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', countryCode: 'SA' },
  { code: 'fa', name: 'Farsi', nativeName: 'فارسی', countryCode: 'IR' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', countryCode: 'PK' }
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    pt: { translation: pt },
    fr: { translation: fr },
    de: { translation: de },
    it: { translation: it },
    zh: { translation: zh },
    ja: { translation: ja },
    ko: { translation: ko },
    ru: { translation: ru },
    ar: { translation: ar },
    fa: { translation: fa },
    ur: { translation: ur }
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false
  }
})

export default i18n
