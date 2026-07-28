# QsRegionSelector 地区选择器

`QsRegionSelector` 是千树 DMS 的应用级业务组件，用于选择严格的
`国家/地区 → 省/州 → 城市` 三级地区。组件按需读取数据库地区数据，对业务调用方只
输出稳定的 `CITY UUID | null`，不请求写接口、不读取页面 Store，也不保存业务表单。

## 快速接入

正式应用已经在启动层注入默认 Provider，普通业务页面无需自行创建 Provider：

```vue
<script setup lang="ts">
import type { RegionSelectorChange } from '@/components/business/QsRegionSelector/types'
import QsRegionSelector from '@/components/business/QsRegionSelector/index.vue'

const cityId = ref<string | null>(null)

function handleRegionChange(change: RegionSelectorChange) {
  if (change.source === 'select') {
    console.info(change.path.map(node => node.name).join(' / '))
  }
}
</script>

<template>
  <label for="shipping-city">收货城市</label>
  <QsRegionSelector
    id="shipping-city"
    v-model="cityId"
    name="shippingCityId"
    required
    @change="handleRegionChange"
  />
</template>
```

`中国台湾 → 台湾 → 高雄市` 与其他地区使用同一契约，高雄市的 value 是对应
`CITY UUID`，不是名称、路径文本或行政编码。

## Public API

### Props

| Prop | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `modelValue` | `string \| null` | `null` | 已选 CITY UUID |
| `provider` | `RegionSelectorProvider` | 应用注入值 | 仅供隔离测试、Showcase 或明确嵌入环境覆盖 |
| `placeholder` | `string` | `请选择国家/地区、省/州和城市` | 空值提示 |
| `clearable` | `boolean` | `true` | 是否允许用户清空 |
| `readonly` | `boolean` | `false` | 保持可聚焦和可读，关闭弹层、搜索与清空 |
| `disabled` | `boolean` | `false` | 阻止交互，但仍解析非空历史 value |
| `error` | `boolean` | `false` | 调用方表单校验错误态 |

组件固定为单选、完整三级、仅 CITY 可提交。不会开放 Arco 的 `multiple`、
`pathMode`、`checkStrictly`、分隔符或搜索延时等内核参数。

### Events

| Event | 参数 | 说明 |
| --- | --- | --- |
| `update:modelValue` | `string \| null` | 只返回 CITY UUID 或 `null` |
| `change` | `RegionSelectorChange` | 只在用户选择或清空时触发，选择时包含严格三级 `path` |
| `focus` | `FocusEvent` | 来自内部真实 input |
| `blur` | `FocusEvent` | 来自内部真实 input |

外部设置 `modelValue` 只做路径回显，不触发 `change`。清空事件固定为
`{ source: 'clear', value: null, path: null }`，不会泄露 Arco 的空字符串或
`undefined`。

### Attrs 与公开方法

组件支持 `id`、`name`、`required`、`autocomplete`、`tabindex`、`aria-*`、
`class`、`style` 和 `data-*`。`id`、表单属性及 ARIA 属性会桥接到唯一真实
`<input>`；`class`、`style`、`data-*` 保留在组件根节点。

模板 ref 可调用 `focus()` 与 `blur()`，两者都操作真实 input。

## Provider

公共 Provider 只有只读能力：

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

正式页面通常不传 `provider`。应用启动层创建默认 Provider，负责访问只读选择 API、
运行时校验并冻结响应。Prop 的优先级高于注入值，只用于组件库 fixture、隔离测试或
明确不接入正式应用壳的环境。业务页面不得通过 Provider 写地区数据。

## CITY UUID 与 path

- `modelValue` 只保存 CITY UUID；国家/地区和省/州永远不能成为 value。
- 完整 path 固定为 `COUNTRY_REGION → PROVINCE_STATE → CITY`。
- 用户选择时从 `change.path` 读取当次显示路径；不得把 path 作为第二份可写状态。
- 非空 value 回显只解析对应的一条完整路径，不下载全量地区树。
- 已停用历史路径仍保留原 value 并显示“当前历史地区已停用，仅供回显”，但不会进入
  新选择 options 或搜索结果。
- 业务数据只持久化 CITY UUID，**不保存地区展示名称**。名称、英文名和路径都可能由
  地区管理员更新，展示时应按 ID 重新解析。

## 缓存与身份

以下规则属于应用默认 Provider，不属于组件本体，也不适用于本地 fixture：

- 成功响应以内存缓存 5 分钟；失败、取消和畸形响应不缓存。
- key 同时包含 `authEpoch`、`userId`、请求类型及规范化参数。
- 同身份、同 key 的进行中请求合并；单个消费者取消不会中断其他消费者。
- 登出、身份 epoch 变化或管理写成功会推进 generation、中止旧请求并清空缓存。
- 管理写确认成功后通过 `qianshu-regions-v1` 的失效消息通知其他标签页；消息不携带
  地区数据。
- 迟到响应只有在 identity 与 generation 仍一致时才能写入缓存。

调用方不应自行在 Pinia、localStorage 或页面常量中复制地区树；这会绕过身份与失效
边界。

## 错误与重试

组件分别维护 path、root、lazy 和 search 的加载、取消、错误与重试状态。取消和过期
响应不显示错误；其他失败只展示固定中文信息和后端已公开的可选 `requestId`，不会
渲染底层异常或原始响应。

- 历史 value 回显失败时保留原 CITY UUID，不擅自清空业务记录。
- root、lazy、search 失败时在组件内提供对应重试入口。
- lazy 失败不会把父节点误标记为空，重试后仍可继续展开。
- `error` 只表达调用方校验态；业务保存失败、权限失败和领域错误仍由调用页面呈现。

## 原生表单与 FormData

Arco 内部 input 的可见 value 是搜索草稿，不是 CITY UUID。组件通过局部输入桥接保证
复合控件的原生表单语义：

- `required` 在尚未确认完整三级 CITY 时保持无效；输入搜索词但未选择城市仍无效。
- 选中有效 CITY 后清除自定义 validity，避免空搜索草稿误伤已有选择。
- 有 `name` 且位于原生 `<form>` 内时，`formdata` 事件会以
  `formData.set(name, modelValue ?? '')` 写入 CITY UUID。
- 历史 UUID 在回显请求期间仍可进入 FormData，但 `required` 只有在完整三级路径确认
  后才视为有效。

Vue 表单仍应以 `v-model` 作为主状态。调用方必须提供真实 `<label for="...">` 或
等价可访问名称，不要依赖 placeholder 代替 label。

## Showcase 边界

组件库路由 `/component-library/business/region-selector` 的标准选择、
`中国台湾 / 台湾 / 高雄市`、`readonly` 和 `disabled` 状态不传 `provider`，统一使用
应用启动层注入的默认 Provider，从正式 selection API 按需读取数据库数据。

停用历史路径和一次失败后重试属于数据库无法稳定制造的边界状态，因此只在对应示例
显式传入隔离 fixture Provider。fixture 不得用于标准选择，也不能替代真实浏览器端
API 验收。

## 调用方职责

业务调用方负责：

- 持有和保存 CITY UUID，并决定字段是否必填；
- 提供 label、帮助文本和领域级校验错误；
- 处理用户 `change` 后的业务联动；
- 处理表单提交、权限、保存失败、未知写结果和页面级 loading；
- 需要显示路径时按 ID 解析，不保存或拼接展示名称；
- 地区管理写成功后调用受控缓存失效入口；普通选择表单不得主动清缓存。

组件负责选择、完整路径显示、按需加载、搜索、请求取消、历史回显、局部重试与真实
input 语义；它不负责业务 API 写入、权限判断、Store、表单提交或领域映射。

## 验证

```bash
pnpm -C web exec node --import tsx --test \
  apps/qsmds-arco/test/api/component-library-routes.test.ts \
  apps/qsmds-arco/test/views/region-selector-showcase.test.ts \
  apps/qsmds-arco/test/views/region-selector.logic.test.ts \
  apps/qsmds-arco/test/views/region-selector.test.ts \
  apps/qsmds-arco/test/views/region-selector-control-attrs.test.ts \
  apps/qsmds-arco/test/views/region-selector-provider.test.ts

pnpm -C web typecheck
pnpm -C web lint
pnpm -C web build
```
