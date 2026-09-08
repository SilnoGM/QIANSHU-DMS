# QsPurchaseStartModal

采购入口前置选择组件。组件基于 `QsGenericModal`，负责收集单一产品模式及与之互斥的供应商来源，不直接调用 API、读取 Store、创建采购单或派发编号。

## 输出契约

- `CATALOG`：输出 `supplierValue`，`customSupplierName` 固定为 `null`。
- `CUSTOM`：输出 NFKC 与 trim 后的 `customSupplierName`，`supplierValue` 固定为 `null`。
- `MIXED`：仅用于历史读取，不在组件中提供入口。

销售订单快捷入口可通过 `validatePreset(selection, salesOrder, signal)` 注入服务端精确资格校验。组件会在关闭、上下文变化或卸载时中止旧请求，并通过 `validationError` 交给页面使用 Warning Toast 告知用户。
