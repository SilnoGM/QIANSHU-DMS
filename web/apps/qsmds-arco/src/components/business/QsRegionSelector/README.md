# QsRegionSelector 地区选择器

`QsRegionSelector` 是千树 DMS 的应用级业务组件，以三个并列的 `FaSelect`
选择严格的 `国家/地区 → 省/州 → 城市` 三级地区。组件内部通过 Provider
按级读取数据库数据，对业务调用方双向绑定三个稳定 UUID，不读取页面 Store、
不请求写接口，也不保存地区展示名称。

## 快速接入

正式应用已经在启动层注入默认 Provider，普通业务页面无需自行创建 Provider：

```vue
<script setup lang="ts">
import type {
  RegionSelectorChange,
  RegionSelectorValue,
} from '@/components/business/QsRegionSelector/types'
import QsRegionSelector from '@/components/business/QsRegionSelector/index.vue'

const region = ref<RegionSelectorValue>({
  countryRegionId: null,
  provinceStateId: null,
  cityId: null,
})

function handleRegionChange(change: RegionSelectorChange) {
  console.info(
    change.complete,
    change.path.map(node => node.name).join(' '),
  )
}
</script>

<template>
  <label for="shipping-region">收货地区</label>
  <QsRegionSelector
    id="shipping-region"
    v-model="region"
    name="shippingCityId"
    required
    @change="handleRegionChange"
  />
</template>
```

中国台湾的完整展示固定为 `中国台湾 台湾 高雄市`。三个 value 分别是对应的
国家/地区 UUID、省/州 UUID 与 CITY UUID，不是名称、路径文本或行政编码。

## Public API

### Value

```ts
interface RegionSelectorValue {
  countryRegionId: string | null
  provinceStateId: string | null
  cityId: string | null
}
```

合法状态只能按层级递进：

- 全空；
- 仅 `countryRegionId`；
- `countryRegionId + provinceStateId`；
- 三个字段全部非空。

切换国家/地区会清空省/州与城市；切换省/州会清空城市。

### Props

| Prop | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `modelValue` | `RegionSelectorValue` | 三级均为 `null` | 结构化三级 UUID |
| `provider` | `RegionSelectorProvider` | 应用注入值 | 仅供隔离测试、Showcase 或明确嵌入环境覆盖 |
| `clearable` | `boolean` | `true` | 有值时显示“清空地区”操作 |
| `readonly` | `boolean` | `false` | 显示可聚焦、可复制的完整路径，不打开下拉 |
| `disabled` | `boolean` | `false` | 禁止三个下拉与清空，仍解析历史值 |
| `error` | `boolean` | `false` | 调用方表单校验错误态 |

组件固定为单选、三级顺序选择。每级 placeholder 由组件根据未选择、加载、
失败状态生成，不开放底层 Reka 或 FaSelect 参数。

### Events

| Event | 参数 | 说明 |
| --- | --- | --- |
| `update:modelValue` | `RegionSelectorValue` | 每次用户选择一级或清空时发出完整对象 |
| `change` | `RegionSelectorChange` | 包含操作来源、部分或完整 path、结构化 value、`complete` |
| `focus` | `FocusEvent` | 焦点进入复合控件时触发 |
| `blur` | `FocusEvent` | 焦点离开复合控件时触发 |

`change.source` 为 `countryRegion`、`provinceState`、`city` 或 `clear`。
只有城市选择完成时 `complete=true`。外部设置 `modelValue` 只做回显和校验，
不会触发 `change`。

### Attrs 与公开方法

- `class`、`style`、`data-*` 和复合控件级 ARIA 保留在组件根节点。
- 调用方 `id` 对应第一个国家/地区 combobox；省/州和城市使用派生 ID。
- `name`、`required` 与 `form` 由组件私有原生表单代理承担。
- `name` 继续提交 CITY UUID；另外两级通过 Vue `v-model` 获取，不隐式创造表单字段名。
- 模板 ref 可调用 `focus()` 与 `blur()`；`focus()` 定位首个未完成层级。

`autocomplete` 不再公开：三个可见控件是 button-based combobox，把浏览器自动填充
写入不可见表单代理会产生错误状态。

## Provider

公共 Provider 保持只读契约：

```ts
interface RegionSelectorProvider {
  listChildren(input: {
    parentId: string | null
    signal: AbortSignal
  }): Promise<readonly RegionSelectorNode[]>

  resolvePath(input: {
    cityId: string
    signal: AbortSignal
  }): Promise<RegionSelectorPath>

  search(input: {
    query: string
    signal: AbortSignal
  }): Promise<RegionSelectorSearchResult>

  subscribeInvalidation?(listener: () => void): () => void
}
```

新组件只调用 `listChildren`、`resolvePath` 与 `subscribeInvalidation`。
`search()` 保留给其他业务和既有 Server API 使用，不在三个独立 `FaSelect` 中调用。

## 加载与回显

- 挂载时只读取国家/地区。
- 选择或回显国家/地区后，只读取其直属省/州。
- 选择或回显省/州后，只读取其直属城市。
- 完整外部 value 先按 CITY UUID 解析 path，并严格核对三个 UUID，再按级补齐 options。
- 组件不下载全球完整地区树。
- 某一级成功返回空列表时，对应下拉显示“暂无可选…”并保持禁用，不呈现空白弹层。
- 可见选中项、下级启用状态和 `required` 焦点只依据已经验证的 path；畸形外部
  UUID 仅保留给调用方处理，不会被 `FaSelect` 显示成第一条真实 option。
- 已停用历史路径会追加到对应 options 供回显，但保持不可选，并显示
  “当前历史地区已停用，仅供回显”。
- 请求使用独立的取消与版本控制；切换上级、缓存失效或卸载后，迟到响应不能覆盖新状态。

路径展示统一用一个 ASCII 空格连接，例如 `中国台湾 台湾 高雄市`；不得使用 `/`。

## 缓存与身份

以下规则属于应用默认 Provider：

- 成功响应以内存缓存 5 分钟；失败、取消和畸形响应不缓存。
- key 包含 `authEpoch`、`userId`、请求类型及规范化参数。
- 同身份、同 key 的进行中请求合并；单个消费者取消不会中断其他消费者。
- 登出、身份 epoch 变化或管理写成功会推进 generation、中止旧请求并清空缓存。
- 管理写成功后通过 `qianshu-regions-v1` 通知其他标签页失效，消息不携带地区数据。

调用方不得在 Pinia、localStorage 或页面常量中复制完整地区树。

## 错误与重试

组件分别维护 path、国家/地区、省/州和城市请求状态。取消和过期响应不显示错误；
其他失败只呈现固定中文信息与后端公开的可选 `requestId`，并提供局部“重试加载”。
回显失败时保留原结构化 value，不擅自清空业务记录。

## 原生表单与 FormData

三个 `FaSelect` 的真实控件是 button，不具备原生表单值。组件使用一个视觉隐藏的
`input[type=text]` 作为表单代理：

- `name` 对应 CITY UUID；
- optional 历史值在回显期间仍可进入 FormData；
- `required` 只有在严格三级 path 验证完成后才有效；
- 空值或部分值的校验消息为“请选择完整地区”；
- disabled 遵循原生语义，不提交表单代理；
- readonly 仍提交已有 CITY UUID，但退出约束校验。

Vue 表单应以结构化 `v-model` 为主状态；调用方仍需提供真实 label 或等价可访问名称。

## Showcase 边界与调用方职责

组件库路由 `/component-library/business/region-selector` 的标准选择、中国台湾路径、
readonly 和 disabled 使用应用默认 Provider。停用历史路径和一次失败后重试才使用
隔离 fixture。

调用方负责持有和保存三个 UUID、提供业务 label 与帮助文本、处理字段联动和提交错误。
组件负责按级选择、依赖重置、完整路径显示、请求取消、历史回显、局部重试和表单代理；
不负责地区写入、权限、Store 或页面级提交。

## 验证

```bash
pnpm -C web exec node --import tsx --test \
  apps/qsmds-arco/test/views/region-selector.logic.test.ts \
  apps/qsmds-arco/test/views/region-selector-control-attrs.test.ts \
  apps/qsmds-arco/test/views/region-selector-showcase.test.ts \
  apps/qsmds-arco/test/views/region-selector.test.ts

pnpm -C web check
node --run ci:browser-regions-e2e
```
