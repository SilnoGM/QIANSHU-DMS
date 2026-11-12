BEGIN;

-- 运营域与其余业务域补齐默认模板；已有键按渠道跳过。

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'purchase.review.pending',
  'IN_APP',
  '采购待审核',
  'PURCHASE',
  '采购单 {{orderNo}} 待审核',
  $body$采购单：{{orderNo}}
客户：{{customerName}}
金额：{{currencyCode}} {{totalAmount}}
明细：{{lineCount}} 行 / {{partCount}} 个货件$body$,
  $vars$[{"name": "orderNo", "required": false, "maxLength": 200, "sensitive": false}, {"name": "customerName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "currencyCode", "required": false, "maxLength": 200, "sensitive": false}, {"name": "totalAmount", "required": false, "maxLength": 200, "sensitive": true}, {"name": "lineCount", "required": false, "maxLength": 200, "sensitive": false}, {"name": "partCount", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'purchase.review.pending',
  'ASSISTANT',
  '采购待审核',
  'PURCHASE',
  NULL,
  $body$采购单：{{orderNo}}
客户：{{customerName}}
金额：{{currencyCode}} {{totalAmount}}
明细：{{lineCount}} 行 / {{partCount}} 个货件$body$,
  $vars$[{"name": "orderNo", "required": false, "maxLength": 200, "sensitive": false}, {"name": "customerName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "currencyCode", "required": false, "maxLength": 200, "sensitive": false}, {"name": "totalAmount", "required": false, "maxLength": 200, "sensitive": true}, {"name": "lineCount", "required": false, "maxLength": 200, "sensitive": false}, {"name": "partCount", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'invoice.review.pending',
  'IN_APP',
  '开票待审核',
  'INVOICE',
  '开票申请 {{invoiceNo}} 待审核',
  $body$购买方：{{buyerName}}
金额：{{totalAmount}}
明细：{{lineCount}} 行$body$,
  $vars$[{"name": "buyerName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "totalAmount", "required": false, "maxLength": 200, "sensitive": true}, {"name": "lineCount", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'invoice.review.pending',
  'ASSISTANT',
  '开票待审核',
  'INVOICE',
  NULL,
  $body$购买方：{{buyerName}}
金额：{{totalAmount}}
明细：{{lineCount}} 行$body$,
  $vars$[{"name": "buyerName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "totalAmount", "required": false, "maxLength": 200, "sensitive": true}, {"name": "lineCount", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'shipment.arrived',
  'IN_APP',
  '货件到仓',
  'SHIPMENT',
  '采购单 {{orderNo}} 货件到仓',
  $body$货件：{{partNumbers}}
到仓时间：{{receivedAt}}
客户：{{customerName}}$body$,
  $vars$[{"name": "partNumbers", "required": false, "maxLength": 200, "sensitive": false}, {"name": "receivedAt", "required": false, "maxLength": 200, "sensitive": false}, {"name": "customerName", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'shipment.arrived',
  'ASSISTANT',
  '货件到仓',
  'SHIPMENT',
  NULL,
  $body$货件：{{partNumbers}}
到仓时间：{{receivedAt}}
客户：{{customerName}}$body$,
  $vars$[{"name": "partNumbers", "required": false, "maxLength": 200, "sensitive": false}, {"name": "receivedAt", "required": false, "maxLength": 200, "sensitive": false}, {"name": "customerName", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'slh.reconciliation.completed',
  'IN_APP',
  '对账完成',
  'RECONCILIATION',
  '对账批次 {{batchNo}} 已完成',
  $body$账单：{{slhBillNo}}
明细：{{reconciledMemberCount}}/{{memberCount}} 行
结算金额：¥{{settlementTotalCny}}
资金批次：{{fundPostingCount}} 笔$body$,
  $vars$[{"name": "slhBillNo", "required": false, "maxLength": 200, "sensitive": false}, {"name": "reconciledMemberCount", "required": false, "maxLength": 200, "sensitive": false}, {"name": "memberCount", "required": false, "maxLength": 200, "sensitive": false}, {"name": "settlementTotalCny", "required": false, "maxLength": 200, "sensitive": true}, {"name": "fundPostingCount", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'slh.reconciliation.completed',
  'ASSISTANT',
  '对账完成',
  'RECONCILIATION',
  NULL,
  $body$账单：{{slhBillNo}}
明细：{{reconciledMemberCount}}/{{memberCount}} 行
结算金额：¥{{settlementTotalCny}}
资金批次：{{fundPostingCount}} 笔$body$,
  $vars$[{"name": "slhBillNo", "required": false, "maxLength": 200, "sensitive": false}, {"name": "reconciledMemberCount", "required": false, "maxLength": 200, "sensitive": false}, {"name": "memberCount", "required": false, "maxLength": 200, "sensitive": false}, {"name": "settlementTotalCny", "required": false, "maxLength": 200, "sensitive": true}, {"name": "fundPostingCount", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'fund.withdrawal.pending',
  'IN_APP',
  '提现待审核',
  'FINANCE',
  '提现申请 {{withdrawalNo}} 待审核',
  $body$申请人：{{applicantName}}
金额：CNY {{amount}}$body$,
  $vars$[{"name": "applicantName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "amount", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'fund.withdrawal.pending',
  'ASSISTANT',
  '提现待审核',
  'FINANCE',
  NULL,
  $body$申请人：{{applicantName}}
金额：CNY {{amount}}$body$,
  $vars$[{"name": "applicantName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "amount", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'packaging.payment.pending',
  'IN_APP',
  '包装待付款',
  'FINANCE',
  '包装待付款汇总',
  $body$待付款：{{requestCount}} 笔
合计：CNY {{totalAmountCny}}$body$,
  $vars$[{"name": "requestCount", "required": false, "maxLength": 200, "sensitive": false}, {"name": "totalAmountCny", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'packaging.payment.pending',
  'ASSISTANT',
  '包装待付款',
  'FINANCE',
  NULL,
  $body$待付款：{{requestCount}} 笔
合计：CNY {{totalAmountCny}}$body$,
  $vars$[{"name": "requestCount", "required": false, "maxLength": 200, "sensitive": false}, {"name": "totalAmountCny", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'purchase.payable.pending',
  'IN_APP',
  '采购待付款',
  'FINANCE',
  '采购待付款汇总',
  $body$待付款采购单：{{orderCount}} 张
未付金额：CNY {{totalDueAmountCny}}$body$,
  $vars$[{"name": "orderCount", "required": false, "maxLength": 200, "sensitive": false}, {"name": "totalDueAmountCny", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'purchase.payable.pending',
  'ASSISTANT',
  '采购待付款',
  'FINANCE',
  NULL,
  $body$待付款采购单：{{orderCount}} 张
未付金额：CNY {{totalDueAmountCny}}$body$,
  $vars$[{"name": "orderCount", "required": false, "maxLength": 200, "sensitive": false}, {"name": "totalDueAmountCny", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'sales.receipt.pending',
  'IN_APP',
  '收款待审核',
  'SALES',
  '收款申请 {{collectionNo}} 待审核',
  $body$销售单：{{orderNo}}
客户：{{customerName}}
金额：{{currencyCode}} {{amount}}
类型：{{paymentType}}$body$,
  $vars$[{"name": "orderNo", "required": false, "maxLength": 200, "sensitive": false}, {"name": "customerName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "currencyCode", "required": false, "maxLength": 200, "sensitive": false}, {"name": "amount", "required": false, "maxLength": 200, "sensitive": true}, {"name": "paymentType", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'sales.receipt.pending',
  'ASSISTANT',
  '收款待审核',
  'SALES',
  NULL,
  $body$销售单：{{orderNo}}
客户：{{customerName}}
金额：{{currencyCode}} {{amount}}
类型：{{paymentType}}$body$,
  $vars$[{"name": "orderNo", "required": false, "maxLength": 200, "sensitive": false}, {"name": "customerName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "currencyCode", "required": false, "maxLength": 200, "sensitive": false}, {"name": "amount", "required": false, "maxLength": 200, "sensitive": true}, {"name": "paymentType", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'sales.receipt.approved',
  'IN_APP',
  '收款通过',
  'SALES',
  '收款申请 {{collectionNo}} 已通过',
  $body$销售单：{{orderNo}}
金额：{{currencyCode}} {{amount}}
类型：{{paymentType}}$body$,
  $vars$[{"name": "orderNo", "required": false, "maxLength": 200, "sensitive": false}, {"name": "currencyCode", "required": false, "maxLength": 200, "sensitive": false}, {"name": "amount", "required": false, "maxLength": 200, "sensitive": true}, {"name": "paymentType", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'sales.receipt.approved',
  'ASSISTANT',
  '收款通过',
  'SALES',
  NULL,
  $body$销售单：{{orderNo}}
金额：{{currencyCode}} {{amount}}
类型：{{paymentType}}$body$,
  $vars$[{"name": "orderNo", "required": false, "maxLength": 200, "sensitive": false}, {"name": "currencyCode", "required": false, "maxLength": 200, "sensitive": false}, {"name": "amount", "required": false, "maxLength": 200, "sensitive": true}, {"name": "paymentType", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'sales.receipt.rejected',
  'IN_APP',
  '收款驳回',
  'SALES',
  '收款申请 {{collectionNo}} 已驳回',
  $body$销售单：{{orderNo}}
金额：{{currencyCode}} {{amount}}
原因：{{reason}}$body$,
  $vars$[{"name": "orderNo", "required": false, "maxLength": 200, "sensitive": false}, {"name": "currencyCode", "required": false, "maxLength": 200, "sensitive": false}, {"name": "amount", "required": false, "maxLength": 200, "sensitive": true}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'sales.receipt.rejected',
  'ASSISTANT',
  '收款驳回',
  'SALES',
  NULL,
  $body$销售单：{{orderNo}}
金额：{{currencyCode}} {{amount}}
原因：{{reason}}$body$,
  $vars$[{"name": "orderNo", "required": false, "maxLength": 200, "sensitive": false}, {"name": "currencyCode", "required": false, "maxLength": 200, "sensitive": false}, {"name": "amount", "required": false, "maxLength": 200, "sensitive": true}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'purchase.review.approved',
  'IN_APP',
  '采购审核通过',
  'PURCHASE',
  '采购单 {{orderNo}} 已审核通过',
  $body$供货方：{{vendorName}}
金额：{{currencyCode}} {{totalAmount}}$body$,
  $vars$[{"name": "vendorName", "required": false, "maxLength": 200, "sensitive": false}, {"name": "currencyCode", "required": false, "maxLength": 200, "sensitive": false}, {"name": "totalAmount", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'purchase.review.approved',
  'ASSISTANT',
  '采购审核通过',
  'PURCHASE',
  NULL,
  $body$供货方：{{vendorName}}
金额：{{currencyCode}} {{totalAmount}}$body$,
  $vars$[{"name": "vendorName", "required": false, "maxLength": 200, "sensitive": false}, {"name": "currencyCode", "required": false, "maxLength": 200, "sensitive": false}, {"name": "totalAmount", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'purchase.review.rejected',
  'IN_APP',
  '采购审核驳回',
  'PURCHASE',
  '采购单 {{orderNo}} 已驳回',
  $body$供货方：{{vendorName}}
原因：{{reason}}$body$,
  $vars$[{"name": "vendorName", "required": false, "maxLength": 200, "sensitive": false}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'purchase.review.rejected',
  'ASSISTANT',
  '采购审核驳回',
  'PURCHASE',
  NULL,
  $body$供货方：{{vendorName}}
原因：{{reason}}$body$,
  $vars$[{"name": "vendorName", "required": false, "maxLength": 200, "sensitive": false}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'purchase.order.cancelled',
  'IN_APP',
  '采购取消',
  'PURCHASE',
  '采购单 {{orderNo}} 已取消',
  $body$供货方：{{vendorName}}
原因：{{reason}}$body$,
  $vars$[{"name": "vendorName", "required": false, "maxLength": 200, "sensitive": false}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'purchase.order.cancelled',
  'ASSISTANT',
  '采购取消',
  'PURCHASE',
  NULL,
  $body$供货方：{{vendorName}}
原因：{{reason}}$body$,
  $vars$[{"name": "vendorName", "required": false, "maxLength": 200, "sensitive": false}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'shipment.storage-claim.pending',
  'IN_APP',
  '调货申请',
  'SHIPMENT',
  '货件 {{shipmentNo}} 调货申请待审核',
  $body$目标销售单：{{salesOrderNo}}$body$,
  $vars$[{"name": "salesOrderNo", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'shipment.storage-claim.pending',
  'ASSISTANT',
  '调货申请',
  'SHIPMENT',
  NULL,
  $body$目标销售单：{{salesOrderNo}}$body$,
  $vars$[{"name": "salesOrderNo", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'shipment.storage-claim.approved',
  'IN_APP',
  '调货通过',
  'SHIPMENT',
  '货件 {{shipmentNo}} 调货申请已通过',
  $body$目标销售单：{{salesOrderNo}}$body$,
  $vars$[{"name": "salesOrderNo", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'shipment.storage-claim.approved',
  'ASSISTANT',
  '调货通过',
  'SHIPMENT',
  NULL,
  $body$目标销售单：{{salesOrderNo}}$body$,
  $vars$[{"name": "salesOrderNo", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'shipment.storage-claim.rejected',
  'IN_APP',
  '调货驳回',
  'SHIPMENT',
  '货件 {{shipmentNo}} 调货申请已驳回',
  $body$目标销售单：{{salesOrderNo}}
原因：{{reason}}$body$,
  $vars$[{"name": "salesOrderNo", "required": false, "maxLength": 200, "sensitive": false}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'shipment.storage-claim.rejected',
  'ASSISTANT',
  '调货驳回',
  'SHIPMENT',
  NULL,
  $body$目标销售单：{{salesOrderNo}}
原因：{{reason}}$body$,
  $vars$[{"name": "salesOrderNo", "required": false, "maxLength": 200, "sensitive": false}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'shipment.released-to-storage',
  'IN_APP',
  '货件转寄仓',
  'SHIPMENT',
  '货件已转入寄仓池',
  $body$货件：{{shipmentNos}}
数量：{{releaseCount}}
范围：{{locationScope}}
原销售单：{{originSalesOrderNo}}
原因：{{reason}}$body$,
  $vars$[{"name": "shipmentNos", "required": false, "maxLength": 200, "sensitive": false}, {"name": "releaseCount", "required": false, "maxLength": 200, "sensitive": false}, {"name": "locationScope", "required": false, "maxLength": 200, "sensitive": false}, {"name": "originSalesOrderNo", "required": false, "maxLength": 200, "sensitive": false}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'shipment.released-to-storage',
  'ASSISTANT',
  '货件转寄仓',
  'SHIPMENT',
  NULL,
  $body$货件：{{shipmentNos}}
数量：{{releaseCount}}
范围：{{locationScope}}
原销售单：{{originSalesOrderNo}}
原因：{{reason}}$body$,
  $vars$[{"name": "shipmentNos", "required": false, "maxLength": 200, "sensitive": false}, {"name": "releaseCount", "required": false, "maxLength": 200, "sensitive": false}, {"name": "locationScope", "required": false, "maxLength": 200, "sensitive": false}, {"name": "originSalesOrderNo", "required": false, "maxLength": 200, "sensitive": false}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'fund.withdrawal.approved',
  'IN_APP',
  '提现通过',
  'FINANCE',
  '提现申请 {{withdrawalNo}} 已通过',
  $body$申请人：{{applicantName}}
金额：CNY {{amount}}$body$,
  $vars$[{"name": "applicantName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "amount", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'fund.withdrawal.approved',
  'ASSISTANT',
  '提现通过',
  'FINANCE',
  NULL,
  $body$申请人：{{applicantName}}
金额：CNY {{amount}}$body$,
  $vars$[{"name": "applicantName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "amount", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'fund.withdrawal.rejected',
  'IN_APP',
  '提现驳回',
  'FINANCE',
  '提现申请 {{withdrawalNo}} 已驳回',
  $body$申请人：{{applicantName}}
金额：CNY {{amount}}
原因：{{reason}}$body$,
  $vars$[{"name": "applicantName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "amount", "required": false, "maxLength": 200, "sensitive": true}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'fund.withdrawal.rejected',
  'ASSISTANT',
  '提现驳回',
  'FINANCE',
  NULL,
  $body$申请人：{{applicantName}}
金额：CNY {{amount}}
原因：{{reason}}$body$,
  $vars$[{"name": "applicantName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "amount", "required": false, "maxLength": 200, "sensitive": true}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'packaging.payment.paid',
  'IN_APP',
  '包装已付款',
  'FINANCE',
  '打木架费用已付款',
  $body$货件：{{shipmentNo}}
金额：{{currencyCode}} {{amount}}$body$,
  $vars$[{"name": "shipmentNo", "required": false, "maxLength": 200, "sensitive": false}, {"name": "currencyCode", "required": false, "maxLength": 200, "sensitive": false}, {"name": "amount", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'packaging.payment.paid',
  'ASSISTANT',
  '包装已付款',
  'FINANCE',
  NULL,
  $body$货件：{{shipmentNo}}
金额：{{currencyCode}} {{amount}}$body$,
  $vars$[{"name": "shipmentNo", "required": false, "maxLength": 200, "sensitive": false}, {"name": "currencyCode", "required": false, "maxLength": 200, "sensitive": false}, {"name": "amount", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'invoice.returned',
  'IN_APP',
  '开票退回',
  'INVOICE',
  '开票申请 {{invoiceNo}} 已退回',
  $body$购买方：{{buyerName}}
原因：{{reason}}$body$,
  $vars$[{"name": "buyerName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'invoice.returned',
  'ASSISTANT',
  '开票退回',
  'INVOICE',
  NULL,
  $body$购买方：{{buyerName}}
原因：{{reason}}$body$,
  $vars$[{"name": "buyerName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'invoice.notified',
  'IN_APP',
  '已通知开票',
  'INVOICE',
  '开票申请 {{invoiceNo}} 已通知开票',
  $body$购买方：{{buyerName}}$body$,
  $vars$[{"name": "buyerName", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'invoice.notified',
  'ASSISTANT',
  '已通知开票',
  'INVOICE',
  NULL,
  $body$购买方：{{buyerName}}$body$,
  $vars$[{"name": "buyerName", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'invoice.issued',
  'IN_APP',
  '发票已开具',
  'INVOICE',
  '开票申请 {{invoiceNo}} 已开具',
  $body$购买方：{{buyerName}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "buyerName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'invoice.issued',
  'ASSISTANT',
  '发票已开具',
  'INVOICE',
  NULL,
  $body$购买方：{{buyerName}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "buyerName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'invoice.settled',
  'IN_APP',
  '开票已结算',
  'INVOICE',
  '开票申请 {{invoiceNo}} 已结算',
  $body$结算金额：CNY {{settleAmountCny}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "settleAmountCny", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'invoice.settled',
  'ASSISTANT',
  '开票已结算',
  'INVOICE',
  NULL,
  $body$结算金额：CNY {{settleAmountCny}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "settleAmountCny", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'invoice.cancelled',
  'IN_APP',
  '开票取消',
  'INVOICE',
  '开票申请 {{invoiceNo}} 已取消',
  $body$原因：{{reason}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "reason", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'invoice.cancelled',
  'ASSISTANT',
  '开票取消',
  'INVOICE',
  NULL,
  $body$原因：{{reason}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "reason", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'operations.machine-viewing.created',
  'IN_APP',
  '看机预约',
  'OPERATIONS',
  '看机预约 {{appointmentNo}}',
  $body$时间：{{appointmentDate}} {{period}} {{hour}}
地点：{{site}}
机型：{{machineType}}
客户：{{customerName}}
对接人：{{contactPerson}}$body$,
  $vars$[{"name": "appointmentDate", "required": false, "maxLength": 200, "sensitive": false}, {"name": "period", "required": false, "maxLength": 200, "sensitive": false}, {"name": "hour", "required": false, "maxLength": 200, "sensitive": false}, {"name": "site", "required": false, "maxLength": 200, "sensitive": false}, {"name": "machineType", "required": false, "maxLength": 200, "sensitive": false}, {"name": "customerName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "contactPerson", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'operations.machine-viewing.created',
  'ASSISTANT',
  '看机预约',
  'OPERATIONS',
  NULL,
  $body$时间：{{appointmentDate}} {{period}} {{hour}}
地点：{{site}}
机型：{{machineType}}
客户：{{customerName}}
对接人：{{contactPerson}}$body$,
  $vars$[{"name": "appointmentDate", "required": false, "maxLength": 200, "sensitive": false}, {"name": "period", "required": false, "maxLength": 200, "sensitive": false}, {"name": "hour", "required": false, "maxLength": 200, "sensitive": false}, {"name": "site", "required": false, "maxLength": 200, "sensitive": false}, {"name": "machineType", "required": false, "maxLength": 200, "sensitive": false}, {"name": "customerName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "contactPerson", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'operations.proxy-node.expiring',
  'IN_APP',
  '节点即将到期',
  'OPERATIONS',
  '静态节点即将到期',
  $body$节点：{{nodeLabel}}
地址：{{host}}
到期：{{expiresAt}}
剩余：{{daysRemaining}} 天
绑定：{{assignedUserName}}$body$,
  $vars$[{"name": "nodeLabel", "required": false, "maxLength": 200, "sensitive": false}, {"name": "host", "required": false, "maxLength": 200, "sensitive": false}, {"name": "expiresAt", "required": false, "maxLength": 200, "sensitive": false}, {"name": "daysRemaining", "required": false, "maxLength": 200, "sensitive": false}, {"name": "assignedUserName", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'operations.proxy-node.expiring',
  'ASSISTANT',
  '节点即将到期',
  'OPERATIONS',
  NULL,
  $body$节点：{{nodeLabel}}
地址：{{host}}
到期：{{expiresAt}}
剩余：{{daysRemaining}} 天
绑定：{{assignedUserName}}$body$,
  $vars$[{"name": "nodeLabel", "required": false, "maxLength": 200, "sensitive": false}, {"name": "host", "required": false, "maxLength": 200, "sensitive": false}, {"name": "expiresAt", "required": false, "maxLength": 200, "sensitive": false}, {"name": "daysRemaining", "required": false, "maxLength": 200, "sensitive": false}, {"name": "assignedUserName", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'operations.advertising-recharge.pending',
  'IN_APP',
  '广告充值待付款',
  'OPERATIONS',
  '广告充值 {{rechargeNo}} 待付款',
  $body$申请人：{{applicantName}}
账户：{{adAccountName}}（{{accountType}}）
金额：{{rechargeCurrency}} {{rechargeAmount}}$body$,
  $vars$[{"name": "applicantName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "adAccountName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "accountType", "required": false, "maxLength": 200, "sensitive": false}, {"name": "rechargeCurrency", "required": false, "maxLength": 200, "sensitive": false}, {"name": "rechargeAmount", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'operations.advertising-recharge.pending',
  'ASSISTANT',
  '广告充值待付款',
  'OPERATIONS',
  NULL,
  $body$申请人：{{applicantName}}
账户：{{adAccountName}}（{{accountType}}）
金额：{{rechargeCurrency}} {{rechargeAmount}}$body$,
  $vars$[{"name": "applicantName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "adAccountName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "accountType", "required": false, "maxLength": 200, "sensitive": false}, {"name": "rechargeCurrency", "required": false, "maxLength": 200, "sensitive": false}, {"name": "rechargeAmount", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'operations.advertising-recharge.paid',
  'IN_APP',
  '广告充值已付款',
  'OPERATIONS',
  '广告充值 {{rechargeNo}} 已付款',
  $body$实付：CNY {{paymentAmountCny}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "paymentAmountCny", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'operations.advertising-recharge.paid',
  'ASSISTANT',
  '广告充值已付款',
  'OPERATIONS',
  NULL,
  $body$实付：CNY {{paymentAmountCny}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "paymentAmountCny", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'operations.advertising-recharge.rejected',
  'IN_APP',
  '广告充值驳回',
  'OPERATIONS',
  '广告充值 {{rechargeNo}} 已驳回',
  $body$原因：{{reason}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "reason", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'operations.advertising-recharge.rejected',
  'ASSISTANT',
  '广告充值驳回',
  'OPERATIONS',
  NULL,
  $body$原因：{{reason}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "reason", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'operations.advertising-recharge.voided',
  'IN_APP',
  '广告充值作废',
  'OPERATIONS',
  '广告充值 {{rechargeNo}} 已作废',
  $body$实付：CNY {{paymentAmountCny}}
原因：{{reason}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "paymentAmountCny", "required": false, "maxLength": 200, "sensitive": true}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'operations.advertising-recharge.voided',
  'ASSISTANT',
  '广告充值作废',
  'OPERATIONS',
  NULL,
  $body$实付：CNY {{paymentAmountCny}}
原因：{{reason}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "paymentAmountCny", "required": false, "maxLength": 200, "sensitive": true}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

-- 新事件与已登记未接入事件的默认策略；已实现事件保留管理员现有策略。

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'SLH_RECONCILIATION_COMPLETED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'SLH_RECONCILIATION_COMPLETED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'FUND_WITHDRAWAL_REVIEW_PENDING',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'FUND_WITHDRAWAL_REVIEW_PENDING',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'PACKAGING_COST_PAYMENT_PENDING',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'PACKAGING_COST_PAYMENT_PENDING',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'PURCHASE_PAYABLE_PENDING',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'PURCHASE_PAYABLE_PENDING',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'SALES_RECEIPT_REVIEW_PENDING',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'SALES_RECEIPT_REVIEW_PENDING',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'SALES_RECEIPT_APPROVED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'SALES_RECEIPT_APPROVED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'SALES_RECEIPT_REJECTED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'SALES_RECEIPT_REJECTED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'PURCHASE_REVIEW_APPROVED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'PURCHASE_REVIEW_APPROVED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'PURCHASE_REVIEW_REJECTED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'PURCHASE_REVIEW_REJECTED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'PURCHASE_ORDER_CANCELLED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'PURCHASE_ORDER_CANCELLED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'STORAGE_CLAIM_REQUEST_PENDING',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'STORAGE_CLAIM_REQUEST_PENDING',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'STORAGE_CLAIM_REQUEST_APPROVED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'STORAGE_CLAIM_REQUEST_APPROVED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'STORAGE_CLAIM_REQUEST_REJECTED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'STORAGE_CLAIM_REQUEST_REJECTED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'SHIPMENT_RELEASED_TO_STORAGE',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'SHIPMENT_RELEASED_TO_STORAGE',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'FUND_WITHDRAWAL_APPROVED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'FUND_WITHDRAWAL_APPROVED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'FUND_WITHDRAWAL_REJECTED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'FUND_WITHDRAWAL_REJECTED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'PACKAGING_COST_PAID',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'PACKAGING_COST_PAID',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'INVOICE_REQUEST_RETURNED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'INVOICE_REQUEST_RETURNED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'INVOICE_REQUEST_NOTIFIED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'INVOICE_REQUEST_NOTIFIED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'INVOICE_REQUEST_ISSUED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'INVOICE_REQUEST_ISSUED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'INVOICE_REQUEST_SETTLED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'INVOICE_REQUEST_SETTLED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'INVOICE_REQUEST_CANCELLED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'INVOICE_REQUEST_CANCELLED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'MACHINE_VIEWING_APPOINTMENT_CREATED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'MACHINE_VIEWING_APPOINTMENT_CREATED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'PROXY_NODE_EXPIRING',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'PROXY_NODE_EXPIRING',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'ADVERTISING_RECHARGE_PAYMENT_PENDING',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'ADVERTISING_RECHARGE_PAYMENT_PENDING',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'ADVERTISING_RECHARGE_PAID',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'ADVERTISING_RECHARGE_PAID',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'NORMAL',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'ADVERTISING_RECHARGE_REJECTED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'ADVERTISING_RECHARGE_REJECTED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'ADVERTISING_RECHARGE_VOIDED',
  'IN_APP',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  NULL,
  NULL,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'ADVERTISING_RECHARGE_VOIDED',
  'ASSISTANT',
  'COMMAND_TARGET',
  '{}'::jsonb,
  NULL,
  'HIGH',
  86400,
  '{"start":"22:00","end":"09:00","timezone":"Asia/Shanghai"}'::jsonb,
  true,
  true
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

COMMIT;
