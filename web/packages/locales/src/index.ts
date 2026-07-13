export type LocaleDirection = 'ltr' | 'rtl'

export interface LocaleInfo {
  label: string
  direction: LocaleDirection
}

export type LocalesInfo = Record<string, LocaleInfo>
export type LocalesInfoExtensions = Record<string, Partial<LocaleInfo>>
export type LocaleMessages = Record<string, unknown> | undefined

export const defaultLocalesInfo: LocalesInfo = {
  'zh-cn': { label: '中文(简体)', direction: 'ltr' },
  'zh-tw': { label: '中文(繁體)', direction: 'ltr' },
  'en': { label: 'English', direction: 'ltr' },
}

export function createLocalesInfo(messages: LocaleMessages, extensions: LocalesInfoExtensions = {}) {
  const localesInfo: LocalesInfo = {}
  const localeKeys = new Set([
    ...Object.keys(messages ?? {}),
    ...Object.keys(extensions),
  ])
  for (const key of localeKeys) {
    localesInfo[key] = {
      label: extensions[key]?.label ?? defaultLocalesInfo[key]?.label ?? key,
      direction: extensions[key]?.direction ?? defaultLocalesInfo[key]?.direction ?? 'ltr',
    }
  }
  return localesInfo
}
