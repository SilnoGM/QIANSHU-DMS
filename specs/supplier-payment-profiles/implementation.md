# 供应商收款资料与采购付款

## 已批准范围

- 管理员工作台新增供应商收款配置，供应商仍来自 `service_provider.supplier`。
- 每个供应商每种方式一套资料：`ALIPAY`、`WECHAT`、`BANK_TRANSFER`。
- 自定义产品采购在 `QsPurchaseStartModal` 填写供应商名称及至少一种本单收款方式，正式保存前可修改，审核时可核对。
- 付款页全宽三列：订单、收款资料、付款截图及确认；窄屏顺序折叠。
- 每笔定金或尾款付款必须上传一张截图，确认后归档为采购订单 `PAYMENT_VOUCHER`，与付款记录绑定。
- 付款仍执行 `PURCHASE_PAYMENT`，销售关联按销售出单人、备货按公司；保存收款资料快照与凭证，保留版本和幂等保护。

## 集成契约

### 收款资料

`PaymentRecipientAccountInputDto`：

```ts
{
  paymentMethod: 'ALIPAY' | 'WECHAT' | 'BANK_TRANSFER'
  recipientName: string
  qrMediaAssetId?: string | null
  bankName?: string | null
  bankAccount?: string | null
  bankBranch?: string | null
}
```

二维码方式要求收款人及图片，银行要求开户名称、银行名称、账号，支行可选。每种方式最多一项；所提交项目均必须完整。管理员可保存空数组以停用全部方式，自定义采购创建必须有 1 至 3 项。

`PaymentRecipientAccountDto` 在输入上增加 `id: string`、`qrContentUrl: string | null`；统一响应字段均有值或 `null`。

`PaymentRecipientProfileDto`：`{ id: string, version: number, accounts: PaymentRecipientAccountDto[] }`。

`SupplierPaymentProfileDto`：`{ supplierValue, supplierName, supplierEnabled, version, accounts, updatedAt: string|null, updatedBy: {id,name}|null }`；未配置 version 为 0。

- `GET /supplier-payment-profiles?page&pageSize&keyword` → `{items,total,page,pageSize}`，权限 `supplier-payment-profiles:read`。
- `PUT /supplier-payment-profiles/:supplierValue`，body `{expectedVersion,accounts}` → `SupplierPaymentProfileDto`，权限 read + update。
- `POST /payment-recipient-images`，multipart `{file,mediaType:'IMAGE'}` → `{mediaAssetId,mediaType,mimeType,sizeBytes,originalFilename}`；正常会话加服务端权限检查，允许配置 update 或采购 create。
- `GET /payment-recipient-images/:id/content`：临时图片仅上传者可读；正式图片校验配置/采购/付款权限及真实关联，响应不缓存。

持久结构：`PaymentRecipientProfile` 按 `supplierValue` 或 `purchaseOrderId` 二选一归属，组版本；`PaymentRecipientAccount` 按 profile + paymentMethod 唯一，保留禁用行。更新时仅当前启用项返回，省略的项停用。付款记录保存 JSON 快照并独立保留二维码外键，避免换码后历史图片被回收。

### 采购创建和详情

- 创建 body 增加 `paymentAccounts?: PaymentRecipientAccountInputDto[]`；CUSTOM 必填，CATALOG 不接收。
- 正式创建在同一事务中创建本单 profile 并激活图片；临时图片不可串用户或串用途。
- 订单详情增加 `paymentRecipientProfile: PaymentRecipientProfileDto|null`，用于查看/审核；自定义资料绑定订单。
- 前端起始弹窗到创建页通过与登录身份绑定的 session 草稿传递，以随机草稿键路由，不将账户资料放入 URL。关闭/切换模式清理本轮临时草稿，未完成媒体按现有过期机制回收。

### 付款详情和确认

- `PurchasePayableOrderDto` 增加 `paymentRecipientProfile: PaymentRecipientProfileDto|null`。
- `PurchasePayableDto` 增加 `paymentReceipt: {recipient: PaymentRecipientAccountDto|null, voucher: {id,mediaAssetId,contentUrl,title}|null}|null`；用于终态查看，历史无资料为 null。
- 付款 body 保留 `expectedVersion,paymentMethod,remark`，增加必填 `recipientAccountId,recipientProfileVersion,voucher:{mediaAssetId}`。
- 原请求指纹包含收款账户、资料版本和截图 ID；未知结果原样重试。幂等重放必须先于媒体当前状态校验。
- 专用上传 `POST /purchase-order-payables/:id/voucher-uploads` 仅需采购付款权限；归档内容通过 `GET /purchase-order-payables/:id/vouchers/:documentId/content` 读取，校验凭证属于该款项。
- 新付款必须校验付款截图是当前上传者、绑定当前款项的临时 IMAGE、所选账户属于本单实际供应商/本单资料且资料版本一致。
- 付款、收款资料快照、凭证激活归档、资金分录同一事务。所有付款写入口遵守相同必填规则。
- 已关联付款记录的凭证不能通过普通附件解除入口移除；旧历史记录不补填或伪造图片。

## 验收

- 三种收款资料字段校验、每种唯一、至少一种本单方式、图片权限与保留。
- 配置变更冲突；创建与付款幂等；重复提交不重复记账；上传失败不付款；事务失败不归档半成品。
- 定金尾款截图隔离；采购凭证和付款页读取同一份图片；历史快照不随配置改动。
- 登录/权限与深链保留；管理员菜单不误放到采购工作台。
- 实际检查三列、移动端、明暗主题。财务写入测试仅在隔离测试库执行。

## 实施验证（2026-09-17）

- 后端全量单元测试：296 个套件、3,291 项通过；前端变更关联的 15 个测试文件、80 项通过。
- 隔离 PostgreSQL：采购应付款 18 项、收款配置 6 项通过，覆盖版本冲突、重复请求、定金尾款截图隔离、凭证不可解除及失败回滚；相关采购创建、审核、货件回归套件通过。
- Server TypeScript、Web TypeScript、改动文件 ESLint / Stylelint 及 `git diff --check` 通过；OpenAPI 已同步。
- 浏览器实际检查管理员入口、配置弹窗、自定义采购弹窗、付款页三列及窄屏布局、明暗主题。未在业务库执行付款。
- 本地数据库迁移已在备份后应用；采购单、付款记录和资金流水数量保持不变。Web 返回 200，Server 健康检查及数据库状态正常。
- 现有供应商须填写真实收款资料后才能继续付款；历史付款未保存的收款快照和截图保持为空，不自动补造。
