export { default as settingsDefault } from './default'
export type * from './preferences'
export type {
  AppAccountSettings,
  AppCopyrightSettings,
  AppHomeSettings,
  AppLayoutSettings,
  AppSettings,
  BaseColorName,
  BreadcrumbSettings,
  MenuSettings,
  PageSettings,
  SettingsLegacyOptions,
  SettingsOptions,
  TabbarSettings,
  ThemeColorScheme,
  ThemeName,
  ThemeSettings,
  ToolbarI18nSettings,
  ToolbarMenuSearchSettings,
  ToolbarSettings,
} from './types'
export {
  diffTwoObj,
  merge,
  mergeWithoutUndefinedProps,
  setSettings,
  setSettingsLegacy,
} from './utils'
