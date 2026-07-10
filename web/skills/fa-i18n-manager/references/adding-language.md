# 添加新语言指南

## 完整步骤

以添加日语（`ja`）为例：

### Step 1：创建语言文件

按实际使用范围补齐新语言文件：

- 公共框架文案：在 `packages/locales/lang/app/**` 下为每个模块复制对应的 `en.json` 为 `ja.json`，翻译所有 value
- 应用路由/业务文案：复制 `apps/qsmds-arco/src/locales/lang/route/en.json` 为 `apps/qsmds-arco/src/locales/lang/route/ja.json`，并按需补齐其它业务语言文件
- 应用覆盖公共文案：如需覆盖公共 `app.*` 文案，在 `apps/qsmds-arco/src/locales/lang/app/**` 下添加对应 `ja.json` 和同名 key

### Step 2：注册到 localesInfo

如果是全局新增语言，编辑 `packages/locales/src/index.ts`，在 `defaultLocalesInfo` 中添加默认语言信息。

如果是单应用新增语言，编辑 `apps/qsmds-arco/src/locales/index.ts`，在 `createLocalesInfo()` 第二个参数中扩展语言信息：

```typescript
const localesInfo = createLocalesInfo(messages, {
  ja: { label: '日本語', direction: 'ltr' },
})
```

`createLocalesInfo()` 的第二个参数会扩展语言清单；如果语言已存在则覆盖 `label` / `direction`，如果不存在则新增。未知语言默认 `label` 为语言代码、`direction` 为 `ltr`。

### Step 3：同步 UI 组件库 locale

如果应用使用 Element Plus、Ant Design Vue、Naive UI 等三方 UI 组件库，在 `apps/qsmds-arco/src/ui/provider/index.ts` 中补充对应语言映射。语言代码需与 `localesInfo` 保持一致。

### Step 4：同步 dayjs locale（可选）

如果项目使用了 dayjs 日期显示，在相关语言切换逻辑中确认 dayjs locale 映射：

```typescript
// dayjs locale 名称可能与 vue-i18n locale 不同
// 例如 vue-i18n 用 'zh-cn'，dayjs 用 'zh-cn'（一致）
// 但 'en' 在 dayjs 中是内置的，无需额外导入
import 'dayjs/locale/ja'  // 需要时手动导入
```

---

## RTL 语言（阿拉伯语、希伯来语等）

以添加阿拉伯语（`ar`）为例：

### Step 1：创建语言文件

按需创建 `packages/locales/lang/app/**/ar.json` 和 `apps/qsmds-arco/src/locales/lang/route/ar.json`，翻译所有内容。应用自己的业务语言文件也需要同步补齐 `ar.json`。

### Step 2：注册为 RTL

```typescript
const localesInfo = createLocalesInfo(messages, {
  ar: { label: 'العربية', direction: 'rtl' },
})
```

框架会自动处理：
- `document.documentElement.setAttribute('dir', 'rtl')`
- CSS 逻辑属性（`margin-inline-start` 等）自动翻转
- UnoCSS RTL 变体自动生效

### Step 3：验证 RTL 样式

框架布局组件已支持 RTL，但自定义组件需注意：
- 避免使用 `margin-left/right`，改用 `margin-inline-start/end`
- 避免使用 `text-align: left`，改用 `text-align: start`
- 图标方向性（箭头等）可用 CSS `[dir="rtl"] &` 选择器处理

---

## 常见语言代码参考

| 语言 | 代码 | direction | dayjs locale |
|------|------|-----------|--------------|
| 简体中文 | zh-cn | ltr | zh-cn |
| 繁体中文 | zh-tw | ltr | zh-tw |
| 英文 | en | ltr | en（内置）|
| 日语 | ja | ltr | ja |
| 韩语 | ko | ltr | ko |
| 法语 | fr | ltr | fr |
| 德语 | de | ltr | de |
| 阿拉伯语 | ar | rtl | ar |
| 希伯来语 | he | rtl | he |
