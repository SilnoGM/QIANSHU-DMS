# 工具栏设置 (toolbar)

## 目录
- [收藏夹 (favorites)](#收藏夹-favorites)
- [面包屑导航 (breadcrumb)](#面包屑导航-breadcrumb)
- [导航搜索 (menuSearch)](#导航搜索-menusearch)
- [通知中心 (notification)](#通知中心-notification)
- [国际化 (i18n)](#国际化-i18n)
- [全屏功能 (fullscreen)](#全屏功能-fullscreen)
- [页面刷新 (pageReload)](#页面刷新-pagereload)
- [颜色主题切换 (colorScheme)](#颜色主题切换-colorscheme)
- [工具栏布局 (layout)](#工具栏布局-layout)

## 收藏夹 (favorites)

- **类型**: `boolean`
- **默认值**: `false`
- **说明**: 控制是否启用收藏夹功能

## 面包屑导航 (breadcrumb)

### enable
- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 控制是否显示面包屑导航

### style
- **类型**: `'' | 'modern'`
- **默认值**: `''`
- **说明**: 设置面包屑导航的视觉风格
  - `''` - 默认风格
  - `'modern'` - 现代风格

### mainMenu
- **类型**: `boolean`
- **默认值**: `false`
- **说明**: 控制是否在面包屑中显示主导航信息

**示例:**
```typescript
toolbar: {
  breadcrumb: {
    enable: true,
    style: 'modern',
    mainMenu: true,
  }
}
```

## 导航搜索 (menuSearch)

### enable
- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 控制是否启用菜单搜索功能

### hotkeys
- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 控制是否启用导航搜索的快捷键

**示例:**
```typescript
toolbar: {
  menuSearch: {
    enable: true,
    hotkeys: true,
  }
}
```

## 通知中心 (notification)

- **类型**: `boolean`
- **默认值**: `false`
- **说明**: 控制是否启用通知中心功能

## 国际化 (i18n)

### enable
- **类型**: `boolean`
- **默认值**: `false`
- **说明**: 控制是否启用多语言切换功能

### defaultLang
- **类型**: `string`
- **默认值**: `''`
- **说明**: 设置应用的默认语言，参考 `apps/<app>/src/locales/index.ts` 导出的 `localesInfo`
  - `''` - 跟随浏览器语言设置

**示例:**
```typescript
toolbar: {
  i18n: {
    enable: true,
    defaultLang: 'zh-cn',
  }
}
```

## 全屏功能 (fullscreen)

- **类型**: `boolean`
- **默认值**: `false`
- **说明**: 控制是否启用全屏切换功能

## 页面刷新 (pageReload)

- **类型**: `boolean`
- **默认值**: `false`
- **说明**: 控制是否启用页面刷新功能

## 颜色主题切换 (colorScheme)

- **类型**: `boolean`
- **默认值**: `false`
- **说明**: 控制是否启用颜色主题切换功能

## 工具栏布局 (layout)

- **类型**: `(Exclude<keyof toolbar, 'enable' | 'layout'> | '->')[]`
- **默认值**: `['favorites', 'breadcrumb', '->', 'menuSearch', 'notification', 'i18n', 'fullscreen', 'pageReload', 'colorScheme']`
- **说明**: 可自定义工具栏项目的位置和顺序。`'->'` 为左右分隔符，必须保留。已禁用的功能项（如 `notification: false`）可以从 layout 中移除。

**示例:**
```typescript
toolbar: {
  layout: [
    'breadcrumb',
    'favorites',
    '->',
    'menuSearch',
    'i18n',
    'colorScheme',
    'fullscreen',
    'pageReload',
    'notification',
  ]
}
```

## 完整示例

```typescript
toolbar: {
  favorites: true,
  breadcrumb: {
    enable: true,
    style: 'modern',
    mainMenu: true,
  },
  menuSearch: {
    enable: true,
    hotkeys: true,
  },
  notification: true,
  i18n: {
    enable: true,
    defaultLang: 'zh-cn',
  },
  fullscreen: true,
  pageReload: true,
  colorScheme: true,
  layout: [
    'favorites',
    'breadcrumb',
    '->',
    'menuSearch',
    'notification',
    'i18n',
    'fullscreen',
    'pageReload',
    'colorScheme',
  ],
}
```

## 常见配置

**启用所有工具栏功能:**
```typescript
toolbar: {
  favorites: true,
  breadcrumb: { enable: true },
  menuSearch: { enable: true },
  notification: true,
  i18n: { enable: true },
  fullscreen: true,
  pageReload: true,
  colorScheme: true,
}
```

**现代风格面包屑:**
```typescript
toolbar: {
  breadcrumb: {
    style: 'modern',
  }
}
```

**自定义工具栏布局:**
```typescript
toolbar: {
  layout: [
    'breadcrumb',
    '->',
    'menuSearch',
    'colorScheme',
    'fullscreen',
  ]
}
```
