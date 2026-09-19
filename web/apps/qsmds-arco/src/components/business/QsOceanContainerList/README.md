# QsOceanContainerList

面向运营、销售视角的柜次卡片列表。每柜一张卡片，概览展示整柜资料，展开后只展示调用方提供的本人装柜明细。对外只有列表入口，内部按单柜次卡片拆分。

## 边界

- 本阶段只有组件和组件库演示，没有接入海运柜次业务页面、真实 API、业务 Store、权限服务或数据库。
- 正式接入时，调用方必须通过服务端取得已授权的个人明细与计数。组件不负责根据销售人员身份筛选数据，也不能作为访问权限边界。
- 整柜 `itemCount`、重量、材积与个人 `myItemCount` 分别传入；组件不会用当前页明细推断整柜汇总。
- 每条 `OceanContainerLine` 对应一条装柜明细，范围唛头 `L-010831-01~10` 保持一行，不按包装件数拆分。
- `codAmountTwd` 使用精确金额字符串或 `null`。`null` 显示空值占位，`0.00` 仍是有效金额，币种描述符由调用方提供。

## 使用

```vue
<script setup lang="ts">
import QsOceanContainerList from '@/components/business/QsOceanContainerList/index.vue'
import type { OceanContainerDetailPage, OceanContainerSummary } from '@/components/business/QsOceanContainerList/types'

const expandedIds = ref<string[]>([])
const containers = ref<OceanContainerSummary[]>([])
const details = ref<Record<string, OceanContainerDetailPage>>({})
// currencies、total、page 以及事件处理函数由调用方提供。
</script>

<template>
  <QsOceanContainerList
    v-model:expanded-ids="expandedIds"
    :items="containers"
    :details="details"
    :currencies="currencies"
    :total="total"
    :page="page"
    @request-items="loadPersonalItems"
    @page-change="changeContainerPage"
    @retry="reloadContainers"
    @view-line="showLineDetail"
  />
</template>
```

## Props 与受控状态

| 名称 | 类型 | 默认 / 含义 |
| --- | --- | --- |
| `items` | `readonly OceanContainerSummary[]` | 必传，当前页柜次，调用方完成分页 |
| `details` | `Readonly<Record<string, OceanContainerDetailPage \| undefined>>` | 必传，以柜次 ID 为键的个人明细页 |
| `currencies` | `readonly CurrencyDescriptor[]` | 必传，包含 TWD 描述符 |
| `total` | `number` | 必传，符合当前列表查询的柜次数 |
| `page` | `number` | `1` |
| `pageSize` | `number` | `10` |
| `loading` | `boolean` | `false`，列表加载状态 |
| `error` | `string \| null` | 无，列表失败说明 |
| `v-model:expanded-ids` | `string[]` | 已展开柜次 ID；允许同时展开多柜 |

类型定义见 [types.ts](./types.ts)。`OceanContainerDetailPage.status` 支持 `idle / loading / ready / error`；每页包含 `items / total / page / pageSize` 及可选的 `error`。默认首次请求个人明细第 1 页、每页 20 条。

## Events

| 事件 | 参数 | 调用方职责 |
| --- | --- | --- |
| `request-items` | `{ containerId, page, pageSize }` | 获取个人明细，回写该柜的加载、成功或失败状态 |
| `page-change` | `{ page, pageSize }` | 获取外层柜次当前页并更新 Props |
| `retry` | 无 | 重试外层列表查询 |
| `view-line` | `{ containerId, line }` | 校验访问权限后打开完整明细容器 |

首次展开、个人明细翻页和失败重试通过 `request-items` 通知调用方。已就绪的明细收起后再展开不重复请求；多页缓存由调用方维护。`myItemCount = 0` 的柜次只展示个人空态，不发起明细请求。整柜尚无明细时展示装柜明细空态。

复制海运唛头是组件本身的展示操作；查看完整明细、打开货件或销售订单等业务行为由调用方处理。组件不内置路由跳转、写入操作或独立详情接口。

## 组件库验收

入口：`/component-library/business/ocean-container-list`。

演示使用独立静态 fixture，包含 12 个柜次、首柜 23 条个人明细、无本人明细、整柜暂无明细、长文本、范围唛头、空代收与零金额。支持正常、加载、空列表、列表失败和明细失败场景；失败重试恢复，展开触发模拟加载。抽屉展示当前 fixture 的完整资料，不请求业务接口。

展示页遵循现有组件库环境开关：开发环境自动注册，非开发构建需要 `VITE_ENABLE_COMPONENT_LIBRARY=true`。
