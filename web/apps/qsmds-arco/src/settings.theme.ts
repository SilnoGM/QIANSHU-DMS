/**
 * 首屏 Loading 早于应用脚本执行，由 Vite 在构建期生成；这里保持为无运行时依赖的共享常量，
 * 让正式应用设置与首屏主题始终读取同一组基础色名称。
 */
export const APP_THEME_BASE_COLORS = {
  light: 'zinc',
  dark: 'zinc',
} as const
