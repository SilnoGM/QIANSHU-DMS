# QsPurchaseOrderDesc 采购订单详情

`QsPurchaseOrderDesc` 是采购订单域的纯展示业务组件，按“订单基础信息 → 采购来源 → 产品列表与小计 → 采购金额 → 唛头与备注”的稳定顺序呈现订单快照。它仿照 `QsSalesOrderDesc` 的只读 ViewModel、金额层级、圆角和响应式边界，但字段全部使用采购语义。

组件不直接接收创建表单或 API DTO。创建页与正式详情页必须在各自页面边界映射成 `QsPurchaseOrderDescViewModel`，组件不负责计算、校验、提交、权限判断或业务状态推进。

## 导入

```ts
import QsPurchaseOrderDesc from '@/components/business/QsPurchaseOrderDesc/index.vue'
import type { QsPurchaseOrderDescViewModel } from '@/components/business/QsPurchaseOrderDesc/types'
```

## Props

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `model` | `Readonly<QsPurchaseOrderDescViewModel>` | 调用方准备好的只读采购订单快照 |
| `currencies` | `readonly CurrencyDescriptor[]` | `AmountDisplay` 用于解析 CNY 符号与小数位的描述符 |

产品行的采购定价、本单采购价、数量和行小计均由调用方提供。组件不会使用浮点数重新计算金额，也不会判断采购总价与付款约定是否相等。

## 产品主图

产品主图通过 `ImageGroup` 显示和预览。调用方负责提供已授权的图片地址；创建页可传入产品选择接口返回的采购图片地址，正式详情 DTO 未提供主图时传 `null`，组件会显示稳定占位图标。

## Slots

- `actions`：订单快照后的操作区。页面可放置提交提示或只读操作，但组件本身不负责提交。

## 响应式边界

组件宽度由父容器决定，并保持 `min-width: 0`。产品价格在窄屏按单列排列，在较宽容器内展开为采购定价、本单采购价和小计三段；长订单号、产品名、唛头及备注可以断行，金额仅在自身内容区横向滚动，不把页面撑宽。
