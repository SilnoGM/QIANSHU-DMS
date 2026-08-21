# QsSalesOrderDesc 销售订单详情

`QsSalesOrderDesc` 是销售订单域的纯展示业务组件，按照“订单基础信息 → 客户信息 → 产品列表与小计 → 销售信息 → 附件缩略图”的稳定顺序呈现订单快照。销售总价为主强调，约定定金与约定尾款为次级强调。

组件使用独立、只读的 `QsSalesOrderDescViewModel`，不依赖新增订单表单模型、API DTO、Store、权限或路由。创建页与正式详情页应分别在自己的边界把数据映射成该 ViewModel。

## 导入

组件不做全局注册，由调用方显式导入：

```ts
import QsSalesOrderDesc from '@/components/business/QsSalesOrderDesc/index.vue'
```

类型可从同目录导入：

```ts
import type { QsSalesOrderDescViewModel } from '@/components/business/QsSalesOrderDesc/types'
```

## Props

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `model` | `Readonly<QsSalesOrderDescViewModel>` | 已由调用方整理好的只读订单详情 |
| `currencies` | `readonly CurrencyDescriptor[]` | `AmountDisplay` 用于解析币种符号与小数位的中立描述符 |

产品行的真实单价、数量和行小计均由调用方提供。组件不使用浮点数重新计算小计，也不判断总价等式是否成立。

## Slots

- `actions`：详情内容之后的操作区。新增订单页可在这里放置完成度提示和提交按钮；组件本身不负责校验、不负责提交，也不会触发二次确认。

## 附件

- 图片附件通过 `ImageGroup` 显示、预览并处理加载失败。
- 视频、文档、没有可读 URL 的图片都会降级为文件图标，同时保留凭证类型、标题和原始文件名。
- `thumbnailSrc` 与 `previewSrc` 由调用方提供。新增订单页如使用本地 `Object URL`，创建和回收都必须由持有原始 `File` 的页面负责；本组件不会管理 URL 生命周期。

## 金额与空态

- 所有金额统一使用 `AmountDisplay`，组件不接收单独的金额精度。
- 订单号为空时显示“正式保存后派发”；其他文本、产品和附件都保留稳定空态，不会因为尚未填写而移除整个区块。
- 销售总价、定金和尾款使用文字标签与层级共同强调，不只依赖颜色传达含义。

## 响应式边界

组件宽度始终由父容器决定。在桌面右侧栏和窄屏抽屉中使用同一份 DOM；标签列、产品金额网格和附件条目会在有限宽度内换行，并使用可断行文本防止长地址、产品名或文件名撑破容器。

组件自身不创建滚动区域，也不实现 `sticky`。页面应由外层布局统一管理右侧栏高度、滚动祖先和移动端抽屉。
