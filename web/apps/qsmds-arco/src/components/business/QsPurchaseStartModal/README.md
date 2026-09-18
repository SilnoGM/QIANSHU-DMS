# QsPurchaseStartModal

采购入口前置选择组件。组件基于 `QsGenericModal`，负责收集单一产品模式及与之互斥的供应商来源，不创建采购单或派发编号。自定义采购复用收款资料编辑器上传二维码，读取当前账号及登录会话以隔离本单收款草稿。

## 输出契约

- `CATALOG`：输出 `supplierValue`，`customSupplierName` 固定为 `null`。
- `CUSTOM`：填写至少一种完整的本单收款资料，输出 NFKC 与 trim 后的 `customSupplierName` 和随机 `paymentDraftKey`，`supplierValue` 固定为 `null`。
- 账户资料仅存储在与账号、登录会话绑定的 sessionStorage 草稿中，不进入 URL；创建成功后清理草稿。24 小时未完成的草稿读取失效。
- `MIXED`：仅用于历史读取，不在组件中提供入口。

销售订单快捷入口可通过 `validatePreset(selection, salesOrder, signal)` 注入服务端精确资格校验。组件会在关闭、上下文变化或卸载时中止旧请求，并通过 `validationError` 交给页面使用 Warning Toast 告知用户。
