---
name: fa-i18n-manager
description: 管理 Fantastic-admin 框架的国际化(i18n)配置。当用户提到以下任何需求时必须使用此技能：给页面/组件加多语言支持、新增翻译 key、检查哪些 key 没翻译、添加新语言（含阿拉伯语/希伯来语等 RTL 语言）、路由标题用 i18n、加语言切换按钮、翻译文件缺少某个 key、组件内联 i18n 块。即使用户只是说"加个中英文切换"或"这个页面要支持多语言"，也应触发此技能。
---

# i18n Manager

## 第一步：确定工作区边界（必须执行）

本项目只有一个正式业务应用。普通业务需求以及用户所说的“正式应用”“业务应用”，都默认作用于 `apps/qsmds-arco`，无需重复询问应用名称；应用侧 i18n 文件默认位于 `apps/qsmds-arco/src/locales/`。

- `examples/*` 可按需只读查阅。只有用户明确指定参考应用时，才把它作为处理目标；即便已点名，仍必须同时明确要求修改，才允许写入对应的 `examples/<name>`。仅要求参考或读取不构成写入授权。
- 下文所有 `apps/qsmds-arco/...` 都是正式业务需求的默认路径。获得上述参考应用写入授权后，先将目标根目录固定为用户点名的精确 `examples/<name>`，再把下文路径前缀 `apps/qsmds-arco` 替换为该目标根目录；除非用户另行明确要求，不得同时修改 `apps/qsmds-arco` 或其他 `examples/*`。
- `packages/*` 只承载跨应用稳定复用的框架能力。业务翻译优先留在正式应用，不能因“可能复用”而提前下沉。
- 如果用户给出的目标路径与上述边界冲突，先说明冲突并确认意图，不得把正式业务改动复制到参考应用。

## 项目 i18n 概览

- 公共框架文案：`packages/locales/lang/app/` 目录下的所有 `.json` 文件
- 应用路由/业务文案：`apps/qsmds-arco/src/locales/lang/` 目录下的所有 `.json` 文件
- 应用覆盖公共文案：可在 `apps/qsmds-arco/src/locales/lang/app/` 下添加同名 key，应用文案会覆盖公共默认值
- i18n 配置入口：`apps/qsmds-arco/src/locales/index.ts`（含 `localesInfo` 语言元数据）
- 公共 localesInfo 工具：`packages/locales/src/index.ts`
- vue-i18n v11，Composition API 模式（`legacy: false`，`flatJson: true`）
- 消息通过 `@intlify/unplugin-vue-i18n` 自动导入，无需手动 import JSON

详细结构和用法见 [references/locale-structure.md](references/locale-structure.md)

---

## 工作流

### 1. 添加新翻译 Key

所有目标语言文件必须同步更新。原因是 `flatJson: true` 模式下，缺少 key 的语言会直接显示 key 名本身，用户会看到原始字符串而不是翻译文本。

Key 命名规则：
- 路由/页面标题：`route.<module>.<page>` 或 `route.<module>.<page>.root`，写入 `apps/qsmds-arco/src/locales/lang/route/*.json`
- 公共框架 UI 文本：`app.<category>.<key>`，写入 `packages/locales/lang/app/**/*.json`
- 应用覆盖公共 UI 文本：`app.<category>.<key>`，写入 `apps/qsmds-arco/src/locales/lang/app/**/*.json`
- 应用业务模块文本：`<module>.<key>`，写入 `apps/qsmds-arco/src/locales/lang/**/*.json` 的业务模块目录

操作步骤：
1. 判断 key 归属：公共框架文案、应用路由/业务文案，还是应用覆盖公共文案
2. Glob 扫描对应目录的 `**/*.json`，获取当前所有语言文件列表
3. 读取这些文件，确认同级 key 的命名风格和所在层级
4. 在相同位置插入新 key，保持 JSON 结构一致
5. 所有目标语言文件都必须包含该 key（翻译暂缺时可先用中文占位）

### 2. 检查缺失翻译

根据检查范围扫描：

- 公共框架文案：`packages/locales/lang/**/*.json`
- 应用路由/业务文案：`apps/qsmds-arco/src/locales/lang/**/*.json`
- 完整应用生效文案：同时扫描以上两个目录，并注意应用同名 key 会覆盖公共默认值

输出差异报告：

```
缺失 key 报告：
- zh-tw.json 缺失：route.feature.newPage
- en.json 缺失：route.general.department.list
```

### 3. 添加新语言

见 [references/adding-language.md](references/adding-language.md)

### 4. 组件内联 i18n 块

适用于组件私有文本，不污染全局 key 空间：

```vue
<i18n lang="yaml">
zh-cn:
  title: 用户管理
  confirm: 确认删除？
en:
  title: User Management
  confirm: Confirm deletion?
</i18n>

<script setup>
const { t } = useI18n()  // 自动访问本地 + 全局翻译
</script>

<template>
  <h1>{{ t('title') }}</h1>
</template>
```

### 5. 路由 meta 中使用 i18n

```typescript
import { $t } from '@/locales'

meta: {
  title: $t('route.general.menu.root'),
}
```

### 6. 启用工具栏语言切换器

修改 `apps/qsmds-arco/src/settings.ts`：

```typescript
toolbar: {
  i18n: {
    enable: true,
    defaultLang: '',  // '' = 跟随浏览器语言；或指定 'zh-cn' | 'en' 等
  }
}
```
