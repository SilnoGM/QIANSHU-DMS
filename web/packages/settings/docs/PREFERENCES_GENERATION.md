# Settings Preferences 生成方案说明

## 背景

`app.preferences` 的设计目标是：

- 保持配置项的结构与 `SettingsOptions` 对齐
- 但把原本的字段类型改成 `boolean`
- 并且在 IDE hover / 提示中，仍然能看到合适的说明文案

最开始如果直接使用 TypeScript mapped type：

```ts
type PreferencesBoolean<T> = {
  [K in keyof T]?: boolean
}
```

虽然类型能变成 `boolean`，但 IDE 往往会继承原字段的 JSDoc。
这样会出现：

- 实际类型已经是 `boolean`
- 但 hover 里仍提示原始字段的说明
- 容易让人误以为这里还是原来的配置值类型

---

## 当前最终方案

当前采用的是 **“独立生成文件 + 递归生成 Preferences 类型”** 的方案。

### 文件结构

```txt
packages/settings/
├── index.ts
├── package.json
├── preferences.ts                # 自动生成
├── types.ts                      # 原始 settings 类型定义
└── scripts/
    └── generate-preferences.ts   # 生成脚本
```

---

## 核心思路

### 1. 原始类型仍然放在 `types.ts`

`types.ts` 继续维护：

- `SettingsOptions`
- `ThemeSettings`
- `ToolbarSettings`
- `BreadcrumbSettings`
- 以及它们原本的 JSDoc

这些仍然是唯一的“源定义”。

### 2. `preferences.ts` 完全自动生成

脚本会读取 `types.ts`，解析出：

- 接口名
- 字段名
- 字段第一行 JSDoc 简介
- `@description`
- 字段是否引用了另一个 settings 接口

然后生成：

- `ThemePreferences`
- `ToolbarPreferences`
- `BreadcrumbPreferences`
- `ToolbarI18nPreferences`
- `ToolbarMenuSearchPreferences`
- `SettingsPreferences`

### 3. 嵌套结构递归生成

当前不是只支持两级，而是会递归处理接口引用字段。

例如：

```ts
toolbar: {
  breadcrumb: {
    mainMenu: true,
  },
}
```

对应生成：

```ts
export interface ToolbarPreferences {
  breadcrumb?: boolean | BreadcrumbPreferences
}

export interface BreadcrumbPreferences {
  mainMenu?: boolean
}
```

因此可以对嵌套分组继续细化控制。

### 4. `types.ts` 只做引用，不内嵌生成内容

`types.ts` 中的 `AppSettings` 现在通过：

```ts
import type { SettingsPreferences } from './preferences'
```

再定义：

```ts
preferences?: SettingsPreferences
```

这样避免：

- 在 `types.ts` 中插入大块自动生成代码
- 依赖区块标记做替换
- 生成脚本需要维护“区块前后格式”

---

## JSDoc 生成规则

每个 preferences 字段的说明来自原始字段：

1. **第一行 JSDoc 注释** → 作为标题/简介
2. **`@description`** → 作为补充说明

生成后的文案格式大致为：

```ts
/**
 * 颜色方案
 * @description 偏好设置中控制该项是否显示。原配置说明：设置应用的颜色方案
 */
colorScheme?: boolean
```

对于分组字段，则会生成：

```ts
/**
 * 工具栏设置
 * @description 偏好设置中控制整个分组是否显示，或继续细分到具体字段。原配置说明：工具栏功能相关的配置
 */
toolbar?: boolean | ToolbarPreferences
```

---

## 命令设计

### 子包内命令

在 `packages/settings/package.json` 中定义：

```json
"scripts": {
  "generate:preferences": "tsx scripts/generate-preferences.ts"
}
```

### 根命令

根目录不再直接执行具体文件，而是通过 `pnpm --filter` 调用子包命令：

```json
"generate:settings-preferences": "pnpm --filter @fantastic-admin/settings generate:preferences"
```

这样更符合 monorepo 的职责划分：

- 根目录只负责调度
- 子包自己维护自己的生成逻辑

---

## 提交流程

`pre-commit` 已做按需优化：

```json
"pre-commit": "if git diff --cached --name-only -- packages/settings/src/types.ts | grep -q .; then pnpm generate:settings-preferences && git add packages/settings/src/preferences.ts; fi && pnpm lint-staged"
```

行为如下：

- 如果没有暂存 `packages/settings/src/types.ts`
  - 不执行生成
- 如果暂存了 `packages/settings/src/types.ts`
  - 自动生成 `packages/settings/src/preferences.ts`
  - 自动把生成文件加入暂存区
  - 然后继续执行 `lint-staged`

这样避免每次提交都无意义地跑生成脚本。

---

## 与最开始方案的区别

## 方案 A0：最初的直接 mapped type 方案

典型形式：

```ts
type PreferencesBoolean<T> = {
  [K in keyof T]?: boolean
}
```

然后：

```ts
preferences?: {
  [K in Exclude<keyof SettingsOptions, 'app'>]?: boolean | PreferencesBoolean<NonNullable<SettingsOptions[K]>>
}
```

### 优点

- 写法最短
- 不需要生成脚本
- 结构天然跟随 `SettingsOptions`

### 缺点

- IDE 容易继承原字段的 JSDoc，提示错误
- hover 文案和真实类型不一致
- 无法为 preferences 场景提供专门说明
- 对嵌套对象的提示不可控

---

## 方案 A1：第一版无脚本修正版

这是后面做过的一版“无生成脚本”的修正思路，核心是：

```ts
type PreferencesBoolean<T> = Partial<Record<keyof T, boolean>>
```

目标是利用 `Partial<Record<...>>` 打断 IDE 对原字段 JSDoc 的继承。

### 优点

- 仍然不需要生成脚本
- 改动小，侵入性低
- 可以解决“boolean 类型却显示原字段 JSDoc”的问题
- 比最初的 mapped type 方案更适合快速止血

### 缺点

- 只能做到“不继承错误 JSDoc”
- 不能为 preferences 生成新的专属说明文案
- 字段 hover 往往只剩类型信息，文档能力有限
- 对嵌套对象仍然没有细粒度、可控的专属文档输出
- 最终 IDE 体验仍不如生成方案

### 适用场景

- 只想快速修复 IDE 提示错误
- 不想引入任何代码生成流程
- 对 hover 文档质量要求不高

---

## 方案 B：当前最终方案（推荐）

即：

- 手写源定义保留在 `types.ts`
- 自动生成内容单独放在 `preferences.ts`
- 通过脚本递归生成嵌套 Preferences 类型

### 优点

- JSDoc 与真实 boolean 类型一致
- 支持嵌套分组递归细化
- `types.ts` 保持干净
- 生成脚本不需要区块替换
- 更适合 monorepo 子包维护
- 更容易扩展与调试

### 相比前两种无脚本方案，本质变化

从：

- “靠类型体操推导结构”

变成：

- “以 `types.ts` 为源，生成一份专门给 preferences 使用的类型文件”

也就是说，当前方案更偏向：

- **文档驱动**
- **代码生成**
- **IDE 体验优先**

而不是只追求“类型上能推出来”。

---

## 维护建议

后续如果修改了 `packages/settings/src/types.ts` 中的：

- 字段名称
- 接口层级
- JSDoc 第一行
- `@description`

请执行：

```bash
pnpm generate:settings-preferences
```

或者直接走正常提交流程，由 `pre-commit` 自动处理。

---

## 当前已知边界

当前脚本主要识别“字段类型直接引用某个 interface”的场景。
对于未来如果出现更复杂的类型包裹，例如：

- 多层类型别名包裹
- 条件类型再包一层
- 特殊联合类型包装接口

可能需要继续增强解析逻辑。

但对于当前 settings 结构，已经足够覆盖。
