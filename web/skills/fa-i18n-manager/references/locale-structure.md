# Locale Structure Reference

## 文件位置

```
packages/locales/
├── src/
│   └── index.ts      # 公共 localesInfo 工具、默认语言信息
└── lang/
    └── app/          # 公共框架文案
        ├── route/
        │   ├── zh-cn.json
        │   ├── zh-tw.json
        │   └── en.json
        ├── layouts/
        │   └── topbar/
        │       └── toolbar/
        │           ├── zh-cn.json
        │           ├── zh-tw.json
        │           └── en.json
        └── components/
            └── account-form/
                ├── zh-cn.json
                ├── zh-tw.json
                └── en.json

apps/qsmds-arco/src/locales/
├── index.ts          # 应用 i18n 适配层 + localesInfo 元数据 + $t
└── lang/
    ├── route/        # 应用路由标题
    │   ├── zh-cn.json
    │   ├── zh-tw.json
    │   └── en.json
    └── app/          # 可选：应用覆盖公共 app.* 文案
```

## Key 结构（按模块拆分）

路由标题放在 `apps/qsmds-arco/src/locales/lang/route/*.json`：

```json
{
  "route": {
    "component": {
      "button": "按钮",
      "icon": "图标"
    },
    "feature": {
      "i18n": "国际化",
      "permission": "权限"
    },
    "general": {
      "menu": {
        "root": "导航菜单",
        "list": "菜单列表"
      }
    }
  }
}
```

框架基础文案放在 `packages/locales/lang/app/**/*.json`，例如 `packages/locales/lang/app/route/zh-cn.json`：

```json
{
  "app": {
    "route": {
      "undefined": "未知页面",
      "reload": "重新加载",
      "home": "主页",
      "login": "登录"
    }
  }
}
```

如果某个应用需要覆盖公共 `app.*` 文案，可在 `apps/qsmds-arco/src/locales/lang/app/**/*.json` 下添加同名 key。

`flatJson: true` 表示也支持点号平铺写法，但项目实际使用嵌套结构。

## 用法模式

### Composition API（推荐）

```vue
<script setup>
const { t, te } = useI18n()
// te() 检查 key 是否存在，用于动态 key 场景
const title = te('route.feature.i18n') ? t('route.feature.i18n') : 'fallback'
</script>
```

### 路由 meta（静态引用）

```typescript
import { $t } from '@/locales'
// $t 用于路由 meta 配置，方便在 VSCode I18n Ally 插件进行显示
meta: { title: $t('route.general.menu.root') }
```

### i18n-t 组件（含插槽插值）

```vue
<i18n-t keypath="app.warning" tag="p">
  <template #path>
    <code>src/settings/index.ts</code>
  </template>
</i18n-t>
```

对应翻译：`"warning": "请修改 {path} 中的配置"`

## localesInfo 结构（apps/qsmds-arco/src/locales/index.ts）

```typescript
const localesInfo = createLocalesInfo(messages, {
  ja: { label: '日本語', direction: 'ltr' },
  ar: { label: 'العربية', direction: 'rtl' },
})
```

`createLocalesInfo()` 会根据 messages 中实际存在的语言和第二个参数扩展的语言生成语言清单；第二个参数中已存在的语言会覆盖 `label` / `direction`，不存在的语言会新增。默认内置 `zh-cn`、`zh-tw`、`en` 的 label，未知语言默认使用语言代码本身作为 label、`ltr` 作为 direction。RTL 语言设置 `direction: 'rtl'`，框架会自动在 `<html dir="rtl">` 上应用。

## 语言切换机制

- Vite 插件同时扫描 `packages/locales/lang/**/*` 和 `apps/qsmds-arco/src/locales/lang/**/*`
- 应用语言包后加载，可覆盖公共语言包的同名 key
- 用户切换语言 → `appSettingsStore.setDefaultLang(lang)`
- Store 监听变化 → 更新 `locale.value` + `dayjs.locale(lang)`
- `document.documentElement.setAttribute('dir', direction)` 自动处理 RTL
