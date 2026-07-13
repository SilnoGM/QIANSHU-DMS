# 主题设置 (theme)

## 目录
- [主题同步 (sync)](#主题同步-sync)
- [亮色基础色 (baseColorLight)](#亮色基础色-basecolorlight)
- [暗色基础色 (baseColorDark)](#暗色基础色-basecolordark)
- [亮色主题 (light)](#亮色主题-light)
- [暗色主题 (dark)](#暗色主题-dark)
- [颜色方案 (colorScheme)](#颜色方案-colorscheme)
- [圆角系数 (radius)](#圆角系数-radius)
- [色弱模式 (colorAmblyopia)](#色弱模式-coloramblyopia)

## 主题同步 (sync)

- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 当开启时,切换颜色方案将共用同一套基础色和主题色

## 亮色基础色 (baseColorLight)

- **类型**: `keyof typeof BASE_COLORS`
- **默认值**: `'neutral'`
- **说明**: 指定亮色模式下的基础色
- **取值来源**: `packages/themes/index.ts` 中的 `BASE_COLORS`

## 暗色基础色 (baseColorDark)

- **类型**: `keyof typeof BASE_COLORS`
- **默认值**: `'neutral'`
- **说明**: 指定暗色模式下的基础色
- **取值来源**: `packages/themes/index.ts` 中的 `BASE_COLORS`

## 亮色主题 (light)

- **类型**: `keyof typeof THEMES`
- **默认值**: `'default'`
- **说明**: 指定亮色模式下的主题
- **取值来源**: `packages/themes/index.ts` 中的 `THEMES`

## 暗色主题 (dark)

- **类型**: `keyof typeof THEMES`
- **默认值**: `'default'`
- **说明**: 指定暗色模式下的主题
- **取值来源**: `packages/themes/index.ts` 中的 `THEMES`

## 颜色方案 (colorScheme)

- **类型**: `'light' | 'dark' | ''`
- **默认值**: `'light'`
- **说明**: 设置应用的颜色方案
  - `'light'` - 明亮模式
  - `'dark'` - 暗黑模式
  - `''` - 跟随系统

## 圆角系数 (radius)

- **类型**: `number`
- **默认值**: `0.5`
- **说明**: 设置界面元素的圆角大小,取值范围 0 到 1
  - `0` - 无圆角(方形)
  - `0.5` - 中等圆角
  - `1` - 最大圆角

## 色弱模式 (colorAmblyopia)

- **类型**: `boolean`
- **默认值**: `false`
- **说明**: 启用色弱友好的颜色方案

## 完整示例

```typescript
theme: {
  sync: true,
  baseColorLight: 'neutral',
  baseColorDark: 'neutral',
  light: 'default',
  dark: 'default',
  colorScheme: 'light',
  radius: 0.5,
  colorAmblyopia: false,
}
```

## 常见配置

**启用暗色模式:**
```typescript
theme: {
  colorScheme: 'dark',
}
```

**跟随系统颜色方案:**
```typescript
theme: {
  colorScheme: '',
}
```

**使用不同的亮色和暗色主题:**
```typescript
theme: {
  sync: false,
  baseColorLight: 'stone',
  baseColorDark: 'taupe',
  light: 'default',
  dark: 'blue',
}
```

**调整圆角:**
```typescript
theme: {
  radius: 0.8,  // 更圆润的界面
}
```
