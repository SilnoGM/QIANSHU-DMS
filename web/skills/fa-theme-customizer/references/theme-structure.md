# 主题结构说明

## 当前文件结构

`packages/themes/index.ts` 现在分为 3 层：

1. `BASE_COLORS`
2. `THEMES`
3. `FRAMEWORK_COLORS`

UnoCSS 生成变量时的覆盖顺序也是这 3 层：

1. `[data-base-color="xxx"]`
2. `[data-theme="xxx"]`
3. `:root` / `:root.dark`

因此：

- `BASE_COLORS` 负责提供完整的基础 token
- `THEMES` 只覆盖主题色相关 token
- `FRAMEWORK_COLORS` 负责框架区域配色，且是全局的，不区分主题名

## 应该改哪一层

### 改 `BASE_COLORS`

适用于：

- 背景冷暖变化
- 卡片、边框、输入框、中性色体系变化
- 想做“暖灰底”“冷灰底”“米白底”“青灰底”这类基础底色

每个 base color 都必须同时有 `light` / `dark` 两套完整 token。

### 改 `THEMES`

适用于：

- 品牌主色
- 按钮高亮色
- 激活态配色
- 想把 tweakcn / 品牌色快速接入框架

`THEMES` 是覆盖层，不负责背景体系。通常只需要维护这 4 个 token：

- `--primary`
- `--primary-foreground`
- `--secondary`
- `--secondary-foreground`

### 改 `FRAMEWORK_COLORS`

适用于：

- 主内容区背景
- 顶部、侧边栏、标签栏、工具栏这些框架区域
- 用户明确要求“框架区域”要和默认规则不同

这一层是全局 light/dark 配置，不按主题名拆分。普通品牌主题定制通常不需要改它。

## `BASE_COLORS` 结构

格式：`'L C H'`，不带 `oklch()`

必填 token：

- `--background`
- `--foreground`
- `--card`
- `--card-foreground`
- `--popover`
- `--popover-foreground`
- `--primary`
- `--primary-foreground`
- `--secondary`
- `--secondary-foreground`
- `--muted`
- `--muted-foreground`
- `--accent`
- `--accent-foreground`
- `--destructive`
- `--border`
- `--input`
- `--ring`

说明：

- `--destructive` 通常沿用现有值
- `--ring` 通常与主色接近，但可以更偏中性
- `default` 主题为空时，会直接使用 base color 里的 `--primary` / `--secondary`

示例：

```typescript
customBase: {
  light: {
    '--background': '1 0 0',
    '--foreground': '0.145 0 0',
    '--card': '1 0 0',
    '--card-foreground': '0.145 0 0',
    '--popover': '1 0 0',
    '--popover-foreground': '0.145 0 0',
    '--primary': '0.205 0 0',
    '--primary-foreground': '0.985 0 0',
    '--secondary': '0.97 0 0',
    '--secondary-foreground': '0.205 0 0',
    '--muted': '0.97 0 0',
    '--muted-foreground': '0.556 0 0',
    '--accent': '0.97 0 0',
    '--accent-foreground': '0.205 0 0',
    '--destructive': '0.577 0.245 27.325',
    '--border': '0.922 0 0',
    '--input': '0.922 0 0',
    '--ring': '0.708 0 0',
  },
  dark: {
    // 同结构
  },
},
```

## `THEMES` 结构

格式：`'L C H'`，不带 `oklch()`

通常只维护：

- `--primary`
- `--primary-foreground`
- `--secondary`
- `--secondary-foreground`

示例：

```typescript
customTheme: {
  light: {
    '--primary': '0.488 0.243 264.376',
    '--primary-foreground': '0.97 0.014 254.604',
    '--secondary': '0.967 0.001 286.375',
    '--secondary-foreground': '0.21 0.006 285.885',
  },
  dark: {
    '--primary': '0.424 0.199 265.638',
    '--primary-foreground': '0.97 0.014 254.604',
    '--secondary': '0.274 0.006 286.033',
    '--secondary-foreground': '0.985 0 0',
  },
},
```

## `FRAMEWORK_COLORS` 结构

格式：`oklch(var(--xxx))` 或 `oklch(var(--xxx) / 50%)`

常见字段：

- `--g-main-area-bg`
- `--g-header-*`
- `--g-main-sidebar-*`
- `--g-sub-sidebar-*`
- `--g-tabbar-*`
- `--g-toolbar-bg`

示例：

```typescript
light: {
  '--g-main-area-bg': 'oklch(0.9612 0 0)',
  '--g-header-bg': 'oklch(var(--background))',
  '--g-header-color': 'oklch(var(--foreground))',
}
```

## 修改建议

- 做品牌主题：优先改 `THEMES`
- 做基础底色：优先改 `BASE_COLORS`
- 做布局层次：再考虑 `FRAMEWORK_COLORS`
- 除非用户明确要求，否则不要同时新增 3 层，避免把简单需求复杂化
