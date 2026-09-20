# QsOceanContainerList

面向运营、销售视角的柜次卡片列表。每柜一张卡片，概览展示整柜资料，展开后只展示调用方提供的本人装柜明细。对外只有列表入口，内部按单柜次卡片拆分。

## 边界

- 已接入运营海运柜次页面 `/qs-operations/warehouse-transport/ocean-containers`；组件库仍使用独立演示数据。
- 正式页面通过 `operations/ocean-containers` 只读接口取得整柜概览与服务端已授权的个人明细。组件不负责根据销售人员身份筛选数据，也不能作为访问权限边界。
- 整柜 `itemCount`、重量、材积与个人 `myItemCount` 分别传入；组件不会用当前页明细推断整柜汇总。
- 每条 `OceanContainerLine` 对应一条装柜明细，范围唛头 `L-010831-01~10` 保持一行，不按包装件数拆分。
- `codAmountTwd` 使用精确金额字符串或 `null`。`null` 显示空值占位，`0.00` 仍是有效金额，币种描述符由调用方提供。
- 来源列分两行展示销售订单编号、采购订单编号；`shippingMark` 单独展示在货件唛头列。海运唛头与代收金额使用全局粗体字重。
- 桌面品名列按约 12 个汉字加单元格内边距设置宽度，超长内容省略并保留悬停全文；货件唛头列承接剩余宽度。
- 可修改时操作列宽 224px，“改信息 / 改代收 / 查看明细”使用普通前景色横排。容器不足 1280px 切换卡片布局，三个操作同样放在底部一行。

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
    :can-view-sales="canReadSales"
    :can-view-purchase="canReadPurchase"
    @request-items="loadPersonalItems"
    @page-change="changeContainerPage"
    @retry="reloadContainers"
    @view-line="showLineDetail"
    @view-source="showSourceOrder"
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
| `canViewSales` | `boolean` | `false`，具有对应权限且销售订单 ID、编号齐全时显示来源按钮 |
| `canViewPurchase` | `boolean` | `false`，具有对应权限且采购订单 ID、编号齐全时显示来源按钮 |
| `canModify` | `boolean` | `false`，允许显示“改信息 / 改代收”；业务权限与归属由调用方及服务端校验 |
| `v-model:expanded-ids` | `string[]` | 已展开柜次 ID；允许同时展开多柜 |

类型定义见 [types.ts](./types.ts)。`OceanContainerDetailPage.status` 支持 `idle / loading / ready / error`；每页包含 `items / total / page / pageSize` 及可选的 `error`。默认首次请求个人明细第 1 页、每页 20 条。

来源引用使用 `salesOrderId / salesOrderNo`、`purchaseOrderId / purchaseOrderNo`，均为 `string | null`。无对应权限或缺少 ID 时保留编号文本，缺少编号展示占位。

## Events

| 事件 | 参数 | 调用方职责 |
| --- | --- | --- |
| `request-items` | `{ containerId, page, pageSize }` | 获取个人明细，回写该柜的加载、成功或失败状态 |
| `page-change` | `{ page, pageSize }` | 获取外层柜次当前页并更新 Props |
| `retry` | 无 | 重试外层列表查询 |
| `view-line` | `{ containerId, line }` | 校验访问权限后打开完整明细容器 |
| `view-source` | `{ containerId, lineId, kind: 'sales' \| 'purchase' }` | 重新核对本人明细归属，用最新来源 ID 打开订单抽屉 |
| `change-line` | `{ containerId, lineId, kind: 'RECIPIENT' \| 'COD' }` | 读取最新明细，完成修改、对比复制与发送确认后提交 |

首次展开、个人明细翻页和失败重试通过 `request-items` 通知调用方。已就绪的明细收起后再展开不重复请求；多页缓存由调用方维护。`myItemCount = 0` 的柜次只展示个人空态，不发起明细请求。整柜尚无明细时展示装柜明细空态。

复制海运唛头是组件本身的展示操作；查看完整明细、打开货件或销售订单等业务行为由调用方处理。组件不内置路由跳转、写入操作或独立详情接口。

## 正式页面接入

页面要求登录且具有 `sales-orders:read`。整柜概览与个人计数分别由服务端提供；个人明细仅返回关联销售订单出单人为当前用户的记录，管理员也不自动放宽此范围。查看完整详情时重新请求接口，重新校验归属。

销售、采购来源分别复用 `QsSalesOrderDrawer`、`QsPurchaseOrderDrawer`；采购读取仍要求 `purchase-orders:read`。每次点击或重试先读取运营个人明细，确认归属后才使用返回的最新订单 ID 请求详情。两个阶段共享取消信号，关闭、撤权或身份切换后不能继续加载或回填旧内容。

页面默认每页 10 柜，明细每页 20 条，支持柜次名称/编号搜索和多柜独立展开。已加载的个人明细分页在同一页面查询内缓存；搜索、外层翻页、离开页面、登录身份或权限变化立即取消请求并清空缓存，迟到响应不回写。页面详情使用独立的 `QsGenericDrawer`，不引用组件库 fixture 或演示抽屉。

正式页面的装柜明细抽屉顶部突出海运唛头与代收货款，货件唛头和品名单独标注。收件人区可一键复制当前明细的客户姓名、客户电话、收件地址及备注；缺失字段保留空值，多行内容保持换行，复制成功后保留抽屉。

具有 `sales-orders:update` 的用户可在本人明细操作列选择“改信息”或“改代收”，桌面和手机入口一致。页面使用四步弹窗完成编辑、对比并复制、确认已发送到群、成功提示；取消发送确认不会修改数据库。成功页倒数 5 秒关闭，期间可撤销本次更改，恢复修改前的字段；撤销带版本保护，不能覆盖他人后续修改。写请求使用原始版本和幂等键，未知结果可原样重试。弹窗最终关闭后刷新该柜当前页并失效其所有旧分页缓存，保持柜次展开状态。

## 组件库验收

入口：`/component-library/business/ocean-container-list`。

演示使用独立静态 fixture，包含 12 个柜次、首柜 23 条个人明细、无本人明细、整柜暂无明细、长文本、范围唛头、空代收与零金额。支持正常、加载、空列表、列表失败和明细失败场景；失败重试恢复，展开触发模拟加载。明细抽屉展示当前 fixture 的完整资料，来源抽屉演示对应订单编号和关联产品，不请求业务接口。

展示页遵循现有组件库环境开关：开发环境自动注册，非开发构建需要 `VITE_ENABLE_COMPONENT_LIBRARY=true`。
