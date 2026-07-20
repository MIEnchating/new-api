/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import i18n, {
  type BackendModule,
  type ReadCallback,
  type ResourceKey,
} from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import {
  convertDetectedLanguage,
  type InterfaceLanguageCode,
  normalizeInterfaceLanguage,
} from './languages'
import {
  evaluateLocaleLoader,
  type LocaleLoadResult,
} from './locale-load-result'

type LocaleResource = {
  translation: ResourceKey
}

const LOCALE_LOADERS: Record<
  InterfaceLanguageCode,
  () => Promise<LocaleResource>
> = {
  en: () => import('./locales/en.json').then((module) => module.default),
  fr: () => import('./locales/fr.json').then((module) => module.default),
  ja: () => import('./locales/ja.json').then((module) => module.default),
  ru: () => import('./locales/ru.json').then((module) => module.default),
  vi: () => import('./locales/vi.json').then((module) => module.default),
  zhCN: () => import('./locales/zh.json').then((module) => module.default),
  zhTW: () => import('./locales/zh-TW.json').then((module) => module.default),
}

const loadedLocaleResources = new Map<InterfaceLanguageCode, LocaleResource>()
const localeLoadRequests = new Map<
  InterfaceLanguageCode,
  Promise<LocaleLoadResult<LocaleResource>>
>()
const latestLocaleLoadResults = new Map<
  InterfaceLanguageCode,
  LocaleLoadResult<LocaleResource>
>()

function isInterfaceLanguageCode(
  value: string
): value is InterfaceLanguageCode {
  return Object.hasOwn(LOCALE_LOADERS, value)
}

function resolveInterfaceLanguage(language: string): InterfaceLanguageCode {
  const normalized = normalizeInterfaceLanguage(language)
  return isInterfaceLanguageCode(normalized) ? normalized : 'en'
}

export function loadInterfaceLocale(
  language: string
): Promise<LocaleLoadResult<LocaleResource>> {
  const normalized = resolveInterfaceLanguage(language)
  const loaded = loadedLocaleResources.get(normalized)
  if (loaded) {
    return Promise.resolve({ ok: true, language: normalized, value: loaded })
  }

  const pending = localeLoadRequests.get(normalized)
  if (pending) return pending

  const request = evaluateLocaleLoader(
    normalized,
    LOCALE_LOADERS[normalized]
  ).then((result) => {
    localeLoadRequests.delete(normalized)
    latestLocaleLoadResults.set(normalized, result)
    if (result.ok) loadedLocaleResources.set(normalized, result.value)
    return result
  })
  localeLoadRequests.set(normalized, request)
  return request
}

function reportLocaleLoad(
  callback: ReadCallback,
  result: LocaleLoadResult<LocaleResource>
) {
  if (result.ok) {
    callback(null, result.value.translation)
  } else {
    callback(result.error, false)
  }
}

const localeBackend = {
  type: 'backend',
  init() {},
  read(language: string, _namespace: string, callback: ReadCallback) {
    void loadInterfaceLocale(language).then(
      reportLocaleLoad.bind(null, callback)
    )
  },
} satisfies BackendModule

let initializationPromise: Promise<LocaleLoadResult<void>> | undefined

export function initializeI18n(): Promise<LocaleLoadResult<void>> {
  if (initializationPromise) return initializationPromise

  initializationPromise = (async () => {
    const initialized = await evaluateLocaleLoader('en', async () => {
      await i18n
        .use(localeBackend)
        .use(LanguageDetector)
        .use(initReactI18next)
        .init({
          fallbackLng: 'en',
          supportedLngs: ['en', 'zhCN', 'fr', 'ru', 'ja', 'vi', 'zhTW'],
          load: 'currentOnly',
          nsSeparator: false, // Allow literal colons in keys (e.g., URLs, labels)
          debug: import.meta.env.DEV,
          interpolation: {
            escapeValue: false, // not needed for react as it escapes by default
          },
          detection: {
            order: ['localStorage', 'navigator'],
            caches: ['localStorage'],
            // Browsers report `zh-CN`/`zh-TW`/`zh`; map them onto our `zhCN`/`zhTW`
            // codes (non-Chinese codes pass through for normal supportedLngs matching).
            convertDetectedLanguage,
          },
        })
    })
    if (!initialized.ok) return initialized

    const activeLanguage = resolveInterfaceLanguage(i18n.language)
    const localeResult = latestLocaleLoadResults.get(activeLanguage)
    if (localeResult && !localeResult.ok) return localeResult

    return { ok: true, language: activeLanguage, value: undefined }
  })()

  return initializationPromise
}

export async function changeInterfaceLanguage(
  language: string
): Promise<LocaleLoadResult<void>> {
  const loaded = await loadInterfaceLocale(language)
  if (!loaded.ok) return loaded

  return evaluateLocaleLoader(loaded.language, async () => {
    if (!i18n.hasResourceBundle(loaded.language, 'translation')) {
      i18n.addResourceBundle(
        loaded.language,
        'translation',
        loaded.value.translation,
        true,
        true
      )
    }
    await i18n.changeLanguage(loaded.language)
  })
}

export default i18n
