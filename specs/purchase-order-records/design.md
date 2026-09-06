# 设计

## 数据与事务

扩展 `PurchaseOrderDocumentType`，`paymentId` 可空，数据库 shape CHECK、既有付款归属触发器和媒体引用约束共同保护数据。新建 `PurchaseOrderAmountRevision`，8 个金额字段均为 `Decimal(30,4)`，API 使用十进制字符串；前后均校验采购约定等式，原因必填。

`POST /api/purchase-orders/:purchaseOrderId/documents` 接收 `documentType`（仅采购单/签收单）、`mediaAssetId`、可选 `remark`。沿用 `purchase-orders:document` 权限与 CSRF，锁定订单后校验上传归属和有效采购单唯一性，激活附件、建立关联、版本递增及审计在同一事务。归档不变更订单、履约或付款状态。付款凭证仍由记录付款事务创建。

详情查询新增 `amountRevisions`，不增加修改采购产品/金额/付款约定接口。实际付款与作废分别生成基于本次事件及重算结果的状态原因；自动完成说明 `SIGNED + PAID`，重新打开说明付款不再满足条件。保留用户填写的状态原因。

## UI 规格

面向内部业务工作台，保持现有字号、主题色、绿色竖线小节标题、左侧圆角与紧凑页头/页尾。实际付款和订单凭证使用同样的手风琴，折叠展示缩略图、展开隐藏缩略图并展示可预览大图；尊重 reduced-motion。采购单/签收单用不同颜色类型标签。记录变更使用紧凑时间线与前后金额对照，空原因明确标注。新增凭证入口受 document 权限约束，不恢复被删除的操作按钮。

## 发布边界

只新增迁移文件，不变更旧迁移或历史数据。验证可使用隔离 PostgreSQL；当前业务库需另行应用迁移后才能使用新版详情查询。无推送、发布或服务重启。
