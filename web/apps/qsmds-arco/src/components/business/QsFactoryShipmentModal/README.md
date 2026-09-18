# QsFactoryShipmentModal

`QsFactoryShipmentModal` 是销售订单与采购订单共用的工厂发货确认组件。基于 `QsGenericModal`，只管理货件选择、目的地仓库、数量预告和可选说明，不读取 API、Store 或服务端状态机。

- `PURCHASE_ORDER`：选择当前采购单中的未发货货件。
- `SALES_ORDER`：选择关联采购单中的未发货货件。

上下文仅有一个可发货件时默认选中，多货件默认不选；支持全选未发货。每个货件必须整体发出，已发货或未生效的货件不可选择。货件卡片点击展开，复选框与图片预览、复制按钮独立操作。折叠时最多展示 3 个图片位置，展开时淡出隐藏；尊重减少动画设置。

每个选中的待发货件可选填物流单号，输入区在产品折叠时仍然可见，输入、清空和复制不触发卡片展开或勾选。取消勾选保留当前弹窗中的草稿；关闭、重新打开或上下文更新时清空草稿；提交期间禁止修改。已发货件显示留存的物流单号并支持复制，无记录显示「未填写」。

每个选中货件必须选择目的地仓库。`QsDictionarySelect dictionaryCode="mainland.warehouse"` 提供真实字典选项和加载、空候选、失败重试状态；桌面与物流单号同一行且位于其后，窄屏上下排列。弹窗内部通过局部 Provider 让下拉加载、重试与父级校验复用同一次目录重载；其他字典读取与失效订阅保持原 Provider 契约。弹窗核对当前有效项，仓库缺失、停用或 Catalog 失效期间禁止提交，不默认预选仓库。宿主需要提供已安装的 DictionaryCatalogProvider；组件库使用应用的 Catalog，仅记录提交事件。

`submit` 返回包含 `partIds`、采购单 ID、最新版本和说明的 `FactoryShipmentIntent`。每个目标必含 `destinationWarehouses: { partId, warehouseValue }[]`，完整覆盖本次 `partIds`，提交精确稳定 value。目标中的可选 `trackingNumbers: { partId, trackingNo }[]` 仅包含本次选中且已填写的货件，去除首尾空格，保留大小写和全半角；最多 100 个字符，拒绝控制字符。调用方负责权限、接口请求、错误映射和列表刷新；服务端响应是订单履约状态的真相源。数量预告以货件为单位，不代替服务端校验。

内容区滚动，Header、数量摘要、说明及 Footer 固定。`purchase-content` 插槽提供基于最新详情的订单摘要与基础唛头；插槽之后统一展示 `ShipmentParts`。未提供插槽时仍展示完整货件选择。上下文加载或失败期间禁止提交。
