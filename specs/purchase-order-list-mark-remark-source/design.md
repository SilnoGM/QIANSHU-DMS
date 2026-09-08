# 采购订单列表唛头、备注与销售来源技术设计

## 1. 当前真相源

- PurchaseOrderListItemDto 已返回 salesOrderNo、customerName 和 remark。
- PurchaseOrderDetailDto 已返回 shippingMarkText，数据库与创建流程已经持久化该字段。
- PURCHASE_ORDER_LIST_SELECT 当前未选择 shippingMarkText；列表映射也未返回该字段。
- Web 已存在“备注”列，但配置为 defaultVisible: false，空值文案为“未填写备注”。
- 采购订单编号已使用 QsTableStackedCell、QsTableStackedLine 和 CopyCellButton，可直接作为销售订单号和采购唛头的交互参考。

## 2. 服务端与 OpenAPI

### 2.1 列表响应

在 PurchaseOrderListItemDto 增加必返可空字符串 shippingMarkText。

该字段加入 PurchaseOrderListItem 内部类型、PURCHASE_ORDER_LIST_SELECT 和 mapListItem()。列表查询仍为一次分页查询，不增加数据库往返或 Web 详情请求。

### 2.2 非变更项

- 不修改 Prisma schema 或 migration。
- 不修改详情 DTO 中现有 shippingMarkText。
- 不修改创建、校验、编号、状态或权限逻辑。

## 3. Web 列表

### 3.1 列定义

在“订单状态”之后、“审计信息”之前连续放置：

- shippingMarkSummary：标题“采购唛头”，minWidth: 200。
- remarkSummary：标题“备注”，保留 minWidth: 240，移除 defaultVisible: false。

两列默认可见；现有列宽和顺序保持不变。

### 3.2 采购唛头

- 使用 FaTooltip 展示完整值。
- 单元格正文使用单行截断。
- 非空值通过 CopyCellButton 复制完整 shippingMarkText。
- 空值显示 -，不渲染复制按钮。
- 桌面复制按钮随单元格悬停或键盘聚焦显示；移动端使用 always-visible。

### 3.3 备注

- 将现有空值文案统一为 -。
- 保持 FaTooltip 与 truncate 结构。
- 备注只读展示，不提供复制能力。

### 3.4 销售来源

桌面端：

- QsTableStackedCell 增加 group，支持复制按钮显隐。
- 第一行在有订单号时使用 qs-type-data-emphasis font-mono，并在 suffix 中放置 CopyCellButton。
- 独立备货仍显示“独立备货”，不渲染复制按钮。
- 第二行移除 tone="muted" 和 qs-type-meta，使用正常正文展示客户名。

移动端：

- 销售来源由当前单行拼接改为上下两行。
- 销售订单号使用数据强调与等宽字体，并使用常显复制按钮。
- 客户名使用正常正文；独立备货不提供复制。

### 3.5 移动端唛头与备注

在状态信息之后增加两个跨列项目：

- “采购唛头”：正文与常显复制按钮。
- “备注”：正文展示。

空值统一显示 -，长文本允许换行，避免截断后不可读取。

## 4. 测试策略

按 TDD 实施：

1. 服务端查询测试先断言列表返回 shippingMarkText，并确认 list select 包含该字段。
2. Controller/OpenAPI 测试先断言 PurchaseOrderListItemDto.shippingMarkText 为必返可空字符串。
3. Web 页面测试先固定：
   - 两列标题、顺序、宽度和默认可见性；
   - 唛头空值、Tooltip 与复制按钮；
   - 备注空值与 Tooltip；
   - 销售订单号编号样式与复制；
   - 客户名正常正文；
   - 移动端同语义展示。
4. 生成并检查 Server/Web OpenAPI snapshot 与 Web 类型。
5. 运行定向测试、类型检查、lint、根完整检查和真实浏览器验收。

## 5. 风险控制

- shippingMarkText 可能包含换行；复制必须保留原始文本，桌面仅压缩视觉展示。
- 销售来源列当前宽度较紧，复制按钮只在交互时显现，避免常驻占用编号空间。
- 备注已存在但默认隐藏；本次将其默认显示属于用户明确要求，不改变列设置能力。
