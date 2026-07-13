---
name: fa-theme-customizer
description: 为 Fantastic-admin 框架创建和定制基础色（`BASE_COLORS`）与主题色（`THEMES`），必要时调整全局框架配色（`FRAMEWORK_COLORS`），并始终同时生成 light 和 dark 两套配置。当用户提到以下任何需求时必须使用此技能：换主题颜色、换基础底色、换配色、做一个 XX 风格的主题、主题太单调了、品牌色是 XXX 帮我生成主题、把 tweakcn 配色转成框架主题、想要暗色/冷色/暖色调、根据设计稿颜色生成主题、希望亮暗模式使用不同的基础色或主题色。即使用户只是描述一种感觉（"清新"、"沉稳"、"科技感"）或提供一个颜色值（"#2563EB"），也应触发此技能。支持"吉卜力"、"赛博朋克"、"莫兰迪"、"北欧极简"等专业设计风格关键词。
---

# 主题定制器

为 Fantastic-admin 框架生成符合当前结构的主题配色。`packages/themes/index.ts` 已拆分为 3 层：`BASE_COLORS`、`THEMES`、`FRAMEWORK_COLORS`。在动手前，先判断用户要改的是哪一层，不要再把所有 token 都塞进同一个 theme entry。

## 主题文件位置

- 主题定义：`packages/themes/index.ts`（在此添加或修改主题，跨所有应用共享）
- 类型推断：自动从 `packages/themes/index.ts` 的 key 推断，无需手动更新类型

## 工作流程

### 第一步：确认设计风格

如果用户没有明确指定颜色，先提供风格参考。读取 `references/design-styles.md` 获取完整的风格目录和配色建议。

### 第二步：判断应该修改哪一层

- 用户主要在描述品牌色、强调色、按钮高亮、激活色、主色倾向：优先修改 `THEMES`
- 用户主要在描述背景基调、页面冷暖、卡片/边框/输入框/焦点环的中性色体系：优先修改 `BASE_COLORS`
- 用户明确要求顶部、侧边栏、标签栏、主内容区这些框架区域有独立配色：才修改 `FRAMEWORK_COLORS`

默认优先级：

1. 能只改 `THEMES` 就不要新建 `BASE_COLORS`
2. 只有现有 7 套基础色都不适合时，才新增 `BASE_COLORS`
3. 只有用户明确要求框架区域视觉层次变化时，才动 `FRAMEWORK_COLORS`

### 第三步：生成 OKLCH 色值

框架使用 **OKLCH 色彩空间**，格式为 `L C H`（不含 `oklch()` 包裹，直接写三个数值）。

通用规则：

- `BASE_COLORS`：输出完整的 shadcn 基础 token 集合
- `THEMES`：只输出主题色覆盖层，通常只包含 `--primary`、`--primary-foreground`、`--secondary`、`--secondary-foreground`
- `FRAMEWORK_COLORS`：使用 `oklch(var(--xxx))` 组合已有 token，尽量引用前两层，不直接写死过多色值
- `default` 主题可以保持空对象，因为它使用当前基础色里的主色定义

读取 `references/theme-structure.md` 了解各层的职责、选择器作用域和完整 token 说明。

### 第四步：输出主题代码

在 `packages/themes/index.ts` 中按现有结构追加或修改：

```typescript
const BASE_COLORS = {
  customBase: {
    light: {
      '--background': 'L C H',
      '--foreground': 'L C H',
      '--card': 'L C H',
      '--card-foreground': 'L C H',
      '--popover': 'L C H',
      '--popover-foreground': 'L C H',
      '--primary': 'L C H',
      '--primary-foreground': 'L C H',
      '--secondary': 'L C H',
      '--secondary-foreground': 'L C H',
      '--muted': 'L C H',
      '--muted-foreground': 'L C H',
      '--accent': 'L C H',
      '--accent-foreground': 'L C H',
      '--destructive': '0.577 0.245 27.325',
      '--border': 'L C H',
      '--input': 'L C H',
      '--ring': 'L C H',
    },
    dark: {
      // 同结构
    },
  },
}

const THEMES = {
  customTheme: {
    light: {
      '--primary': 'L C H',
      '--primary-foreground': 'L C H',
      '--secondary': 'L C H',
      '--secondary-foreground': 'L C H',
    },
    dark: {
      '--primary': 'L C H',
      '--primary-foreground': 'L C H',
      '--secondary': 'L C H',
      '--secondary-foreground': 'L C H',
    },
  },
}
```

只有当用户明确要求“框架区域”配色时，才修改：

```typescript
const FRAMEWORK_COLORS = {
  light: {
    '--g-main-area-bg': 'oklch(var(--background))',
    // ...
  },
  dark: {
    '--g-main-area-bg': 'oklch(var(--background))',
    // ...
  },
}
```

### 第五步：在应用设置中启用

主题定义完成后，如果用户还要求直接启用，先执行 `ls apps/` 确认有哪些应用；如果用户没明确目标应用，必须先询问要在哪个应用启用。然后修改 `apps/<app>/src/settings.ts`：

```typescript
theme: {
  sync: true,
  baseColorLight: 'customBase',
  baseColorDark: 'customBase',
  light: 'themeName',
  dark: 'themeName',
}
```

如果用户明确要求亮暗模式使用不同的基础色或主题色，写成：

```typescript
theme: {
  sync: false,
  baseColorLight: 'stone',
  baseColorDark: 'taupe',
  light: 'blue',
  dark: 'violet',
}
```

## 参考资源

- **设计风格目录**：`references/design-styles.md` — 包含 20+ 种专业设计风格的配色方案和灵感来源
- **结构说明**：`references/theme-structure.md` — `BASE_COLORS`、`THEMES`、`FRAMEWORK_COLORS` 的职责、字段和修改边界
- **社区配色**：https://tweakcn.com/community — 可直接参考社区主题的 shadcn CSS 变量
