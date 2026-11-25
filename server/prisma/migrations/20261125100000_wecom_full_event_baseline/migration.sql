BEGIN;

-- WECOM 全量事件基线：模板与策略先以停用状态落库，供清退 ASSISTANT 前逐项核对。
-- 模板正文为迁移基线，管理员应按事件补充业务文案后再启用。

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('purchase.review.pending','WECOM','采购审核（企微迁移）','PURCHASE',NULL,$wecom_body$【千树 DMS】采购审核
采购单号：{{orderNo}}
供货方：{{vendorName}}
金额：{{totalAmount}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"orderNo","required":true,"maxLength":64,"sensitive":false},{"name":"vendorName","required":true,"maxLength":128,"sensitive":false},{"name":"totalAmount","required":true,"maxLength":32,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('invoice.review.pending','WECOM','开票申请（企微迁移）','INVOICE',NULL,$wecom_body$【千树 DMS】开票申请
开票申请号：{{invoiceNo}}
购买方：{{buyerName}}
金额：{{totalAmount}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"invoiceNo","required":true,"maxLength":64,"sensitive":false},{"name":"buyerName","required":true,"maxLength":128,"sensitive":true},{"name":"totalAmount","required":true,"maxLength":32,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('slh.reconciliation.completed','WECOM','对账完成（企微迁移）','RECONCILIATION',NULL,$wecom_body$【千树 DMS】对账完成
对账批次号：{{batchNo}}
账单号：{{slhBillNo}}
明细行数：{{memberCount}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"batchNo","required":true,"maxLength":64,"sensitive":false},{"name":"slhBillNo","required":true,"maxLength":64,"sensitive":false},{"name":"memberCount","required":true,"maxLength":16,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('shipment.arrived','WECOM','货件到仓（企微迁移）','SHIPMENT',NULL,$wecom_body$【千树 DMS】货件到仓
采购单号：{{orderNo}}
到仓货件：{{partNumbers}}
到仓件数：{{receivedPartCount}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"orderNo","required":true,"maxLength":64,"sensitive":false},{"name":"partNumbers","required":true,"maxLength":128,"sensitive":false},{"name":"receivedPartCount","required":true,"maxLength":16,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('fund.withdrawal.pending','WECOM','提现审核（企微迁移）','FINANCE',NULL,$wecom_body$【千树 DMS】提现审核
提现单号：{{withdrawalNo}}
申请人：{{applicantName}}
金额：{{amount}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"withdrawalNo","required":true,"maxLength":64,"sensitive":false},{"name":"applicantName","required":true,"maxLength":128,"sensitive":true},{"name":"amount","required":true,"maxLength":32,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('packaging.payment.pending','WECOM','包装待付款（企微迁移）','FINANCE',NULL,$wecom_body$【千树 DMS】包装待付款
待付款笔数：{{requestCount}}
合计金额：{{totalAmountCny}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"requestCount","required":true,"maxLength":16,"sensitive":false},{"name":"totalAmountCny","required":true,"maxLength":32,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('purchase.payable.pending','WECOM','采购待付款（企微迁移）','FINANCE',NULL,$wecom_body$【千树 DMS】采购待付款
待付款单数：{{orderCount}}
待付金额：{{totalDueAmountCny}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"orderCount","required":true,"maxLength":16,"sensitive":false},{"name":"totalDueAmountCny","required":true,"maxLength":32,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('sales.receipt.pending','WECOM','收款审核（企微迁移）','SALES',NULL,$wecom_body$【千树 DMS】收款审核
收款申请号：{{collectionNo}}
销售单号：{{orderNo}}
金额：{{amount}}
请登录千树 DMS 查看详情。
相关附件见下方。$wecom_body$,$wecom_json$[{"name":"collectionNo","required":true,"maxLength":64,"sensitive":false},{"name":"orderNo","required":true,"maxLength":64,"sensitive":false},{"name":"amount","required":true,"maxLength":32,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${"enabled":true,"maxCount":1,"kinds":["IMAGE"],"sources":["salesReceipt.voucher"]}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('sales.receipt.voucher-sent','WECOM','表外水单发送（企微迁移）','SALES',NULL,$wecom_body$【千树 DMS】表外水单发送
收款申请号：{{collectionNo}}
销售单号：{{orderNo}}
金额：{{amount}}
请登录千树 DMS 查看详情。
相关附件见下方。$wecom_body$,$wecom_json$[{"name":"collectionNo","required":true,"maxLength":64,"sensitive":false},{"name":"orderNo","required":true,"maxLength":64,"sensitive":false},{"name":"amount","required":true,"maxLength":32,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${"enabled":true,"maxCount":1,"kinds":["IMAGE"],"sources":["salesReceipt.voucher"]}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('sales.receipt.approved','WECOM','收款通过（企微迁移）','SALES',NULL,$wecom_body$【千树 DMS】收款通过
收款申请号：{{collectionNo}}
销售单号：{{orderNo}}
金额：{{amount}}
请登录千树 DMS 查看详情。
相关附件见下方。$wecom_body$,$wecom_json$[{"name":"collectionNo","required":true,"maxLength":64,"sensitive":false},{"name":"orderNo","required":true,"maxLength":64,"sensitive":false},{"name":"amount","required":true,"maxLength":32,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${"enabled":true,"maxCount":1,"kinds":["IMAGE"],"sources":["salesReceipt.voucher"]}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('sales.receipt.rejected','WECOM','收款驳回（企微迁移）','SALES',NULL,$wecom_body$【千树 DMS】收款驳回
收款申请号：{{collectionNo}}
销售单号：{{orderNo}}
金额：{{amount}}
请登录千树 DMS 查看详情。
相关附件见下方。$wecom_body$,$wecom_json$[{"name":"collectionNo","required":true,"maxLength":64,"sensitive":false},{"name":"orderNo","required":true,"maxLength":64,"sensitive":false},{"name":"amount","required":true,"maxLength":32,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${"enabled":true,"maxCount":1,"kinds":["IMAGE"],"sources":["salesReceipt.voucher"]}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('purchase.review.approved','WECOM','采购审核通过（企微迁移）','PURCHASE',NULL,$wecom_body$【千树 DMS】采购审核通过
采购单号：{{orderNo}}
供货方：{{vendorName}}
金额：{{totalAmount}}
请登录千树 DMS 查看详情。
相关附件见下方。$wecom_body$,$wecom_json$[{"name":"orderNo","required":true,"maxLength":64,"sensitive":false},{"name":"vendorName","required":true,"maxLength":128,"sensitive":false},{"name":"totalAmount","required":true,"maxLength":32,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${"enabled":true,"maxCount":1,"kinds":["IMAGE"],"sources":["purchase.orderImage"]}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('purchase.review.rejected','WECOM','采购审核驳回（企微迁移）','PURCHASE',NULL,$wecom_body$【千树 DMS】采购审核驳回
采购单号：{{orderNo}}
供货方：{{vendorName}}
原因：{{reason}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"orderNo","required":true,"maxLength":64,"sensitive":false},{"name":"vendorName","required":true,"maxLength":128,"sensitive":false},{"name":"reason","required":true,"maxLength":500,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('purchase.order.cancelled','WECOM','采购取消（企微迁移）','PURCHASE',NULL,$wecom_body$【千树 DMS】采购取消
采购单号：{{orderNo}}
供货方：{{vendorName}}
原因：{{reason}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"orderNo","required":true,"maxLength":64,"sensitive":false},{"name":"vendorName","required":true,"maxLength":128,"sensitive":false},{"name":"reason","required":true,"maxLength":500,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('shipment.storage-claim.pending','WECOM','调货申请（企微迁移）','SHIPMENT',NULL,$wecom_body$【千树 DMS】调货申请
货件号：{{shipmentNo}}
销售单号：{{salesOrderNo}}
寄仓记录 ID：{{storageRecordId}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"shipmentNo","required":true,"maxLength":64,"sensitive":false},{"name":"salesOrderNo","required":true,"maxLength":64,"sensitive":false},{"name":"storageRecordId","required":true,"maxLength":64,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('shipment.storage-claim.approved','WECOM','调货通过（企微迁移）','SHIPMENT',NULL,$wecom_body$【千树 DMS】调货通过
货件号：{{shipmentNo}}
销售单号：{{salesOrderNo}}
寄仓记录 ID：{{storageRecordId}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"shipmentNo","required":true,"maxLength":64,"sensitive":false},{"name":"salesOrderNo","required":true,"maxLength":64,"sensitive":false},{"name":"storageRecordId","required":true,"maxLength":64,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('shipment.storage-claim.rejected','WECOM','调货驳回（企微迁移）','SHIPMENT',NULL,$wecom_body$【千树 DMS】调货驳回
货件号：{{shipmentNo}}
销售单号：{{salesOrderNo}}
寄仓记录 ID：{{storageRecordId}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"shipmentNo","required":true,"maxLength":64,"sensitive":false},{"name":"salesOrderNo","required":true,"maxLength":64,"sensitive":false},{"name":"storageRecordId","required":true,"maxLength":64,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('shipment.released-to-storage','WECOM','货件转寄仓（企微迁移）','SHIPMENT',NULL,$wecom_body$【千树 DMS】货件转寄仓
货件号列表：{{shipmentNos}}
释放件数：{{releaseCount}}
仓库范围：{{locationScope}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"shipmentNos","required":true,"maxLength":512,"sensitive":false},{"name":"releaseCount","required":true,"maxLength":16,"sensitive":false},{"name":"locationScope","required":true,"maxLength":32,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('fund.withdrawal.approved','WECOM','提现通过（企微迁移）','FINANCE',NULL,$wecom_body$【千树 DMS】提现通过
提现单号：{{withdrawalNo}}
申请人：{{applicantName}}
金额：{{amount}}
请登录千树 DMS 查看详情。
相关附件见下方。$wecom_body$,$wecom_json$[{"name":"withdrawalNo","required":true,"maxLength":64,"sensitive":false},{"name":"applicantName","required":true,"maxLength":128,"sensitive":true},{"name":"amount","required":true,"maxLength":32,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${"enabled":true,"maxCount":1,"kinds":["IMAGE"],"sources":["fundWithdrawal.paymentProof"]}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('fund.withdrawal.rejected','WECOM','提现驳回（企微迁移）','FINANCE',NULL,$wecom_body$【千树 DMS】提现驳回
提现单号：{{withdrawalNo}}
申请人：{{applicantName}}
金额：{{amount}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"withdrawalNo","required":true,"maxLength":64,"sensitive":false},{"name":"applicantName","required":true,"maxLength":128,"sensitive":true},{"name":"amount","required":true,"maxLength":32,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('packaging.payment.paid','WECOM','包装已付款（企微迁移）','FINANCE',NULL,$wecom_body$【千树 DMS】包装已付款
货件号：{{shipmentNo}}
金额：{{amount}}
币种：{{currencyCode}}
请登录千树 DMS 查看详情。
相关附件见下方。$wecom_body$,$wecom_json$[{"name":"shipmentNo","required":true,"maxLength":64,"sensitive":false},{"name":"amount","required":true,"maxLength":32,"sensitive":true},{"name":"currencyCode","required":true,"maxLength":16,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${"enabled":true,"maxCount":3,"kinds":["IMAGE"],"sources":["packaging.paymentVoucher","packaging.packagingImage","packaging.quotationImage"]}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('invoice.returned','WECOM','开票退回（企微迁移）','INVOICE',NULL,$wecom_body$【千树 DMS】开票退回
开票申请号：{{invoiceNo}}
购买方：{{buyerName}}
原因：{{reason}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"invoiceNo","required":true,"maxLength":64,"sensitive":false},{"name":"buyerName","required":true,"maxLength":128,"sensitive":true},{"name":"reason","required":true,"maxLength":500,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('invoice.notified','WECOM','已通知开票（企微迁移）','INVOICE',NULL,$wecom_body$【千树 DMS】已通知开票
开票申请号：{{invoiceNo}}
购买方：{{buyerName}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"invoiceNo","required":true,"maxLength":64,"sensitive":false},{"name":"buyerName","required":true,"maxLength":128,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('invoice.issued','WECOM','发票已开具（企微迁移）','INVOICE',NULL,$wecom_body$【千树 DMS】发票已开具
开票申请号：{{invoiceNo}}
购买方：{{buyerName}}
发生时间：{{occurredAt}}
请登录千树 DMS 查看详情。
相关附件见下方。$wecom_body$,$wecom_json$[{"name":"invoiceNo","required":true,"maxLength":64,"sensitive":false},{"name":"buyerName","required":true,"maxLength":128,"sensitive":true},{"name":"occurredAt","required":true,"maxLength":64,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${"enabled":true,"maxCount":1,"kinds":["IMAGE"],"sources":["invoice.document"]}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('invoice.settled','WECOM','开票已结算（企微迁移）','INVOICE',NULL,$wecom_body$【千树 DMS】开票已结算
开票申请号：{{invoiceNo}}
结算金额：{{settleAmountCny}}
发生时间：{{occurredAt}}
请登录千树 DMS 查看详情。
相关附件见下方。$wecom_body$,$wecom_json$[{"name":"invoiceNo","required":true,"maxLength":64,"sensitive":false},{"name":"settleAmountCny","required":true,"maxLength":32,"sensitive":true},{"name":"occurredAt","required":true,"maxLength":64,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${"enabled":true,"maxCount":1,"kinds":["IMAGE"],"sources":["invoice.document"]}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('invoice.cancelled','WECOM','开票取消（企微迁移）','INVOICE',NULL,$wecom_body$【千树 DMS】开票取消
开票申请号：{{invoiceNo}}
原因：{{reason}}
发生时间：{{occurredAt}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"invoiceNo","required":true,"maxLength":64,"sensitive":false},{"name":"reason","required":true,"maxLength":500,"sensitive":true},{"name":"occurredAt","required":true,"maxLength":64,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('operations.machine-viewing.created','WECOM','看机预约（企微迁移）','OPERATIONS',NULL,$wecom_body$【千树 DMS】看机预约
看机预约号：{{appointmentNo}}
预约日期：{{appointmentDate}}
预约时段：{{period}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"appointmentNo","required":true,"maxLength":64,"sensitive":false},{"name":"appointmentDate","required":true,"maxLength":32,"sensitive":false},{"name":"period","required":true,"maxLength":16,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('operations.machine-viewing.rescheduled','WECOM','看机预约改期（企微迁移）','OPERATIONS',NULL,$wecom_body$【千树 DMS】看机预约改期
看机预约号：{{appointmentNo}}
看机地点：{{site}}
看机机型：{{machineType}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"appointmentNo","required":true,"maxLength":64,"sensitive":false},{"name":"site","required":true,"maxLength":64,"sensitive":false},{"name":"machineType","required":true,"maxLength":64,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('operations.proxy-node.expiring','WECOM','节点即将到期（企微迁移）','OPERATIONS',NULL,$wecom_body$【千树 DMS】节点即将到期
节点名称：{{nodeLabel}}
节点地址：{{host}}
到期时间：{{expiresAt}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"nodeLabel","required":true,"maxLength":128,"sensitive":false},{"name":"host","required":true,"maxLength":255,"sensitive":false},{"name":"expiresAt","required":true,"maxLength":64,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('operations.advertising-recharge.pending','WECOM','广告户充值（企微迁移）','OPERATIONS',NULL,$wecom_body$【千树 DMS】广告户充值
充值申请号：{{rechargeNo}}
申请人：{{applicantName}}
账户类型：{{accountType}}
请登录千树 DMS 查看详情。
相关附件见下方。$wecom_body$,$wecom_json$[{"name":"rechargeNo","required":true,"maxLength":64,"sensitive":false},{"name":"applicantName","required":true,"maxLength":128,"sensitive":true},{"name":"accountType","required":true,"maxLength":32,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${"enabled":true,"maxCount":1,"kinds":["IMAGE"],"sources":["advertising.qr"]}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('operations.advertising-recharge.payment-code','WECOM','广告户充值补充付款码（企微迁移）','OPERATIONS',NULL,$wecom_body$【千树 DMS】广告户充值补充付款码
充值申请号：{{rechargeNo}}
申请人：{{applicantName}}
账户类型：{{accountType}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"rechargeNo","required":true,"maxLength":64,"sensitive":false},{"name":"applicantName","required":true,"maxLength":128,"sensitive":true},{"name":"accountType","required":true,"maxLength":32,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('operations.advertising-recharge.paid','WECOM','广告充值已付款（企微迁移）','OPERATIONS',NULL,$wecom_body$【千树 DMS】广告充值已付款
充值申请号：{{rechargeNo}}
实付金额：{{paymentAmountCny}}
发生时间：{{occurredAt}}
请登录千树 DMS 查看详情。
相关附件见下方。$wecom_body$,$wecom_json$[{"name":"rechargeNo","required":true,"maxLength":64,"sensitive":false},{"name":"paymentAmountCny","required":true,"maxLength":32,"sensitive":true},{"name":"occurredAt","required":true,"maxLength":64,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${"enabled":true,"maxCount":2,"kinds":["IMAGE"],"sources":["advertising.qr","advertising.proof"]}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('operations.advertising-recharge.rejected','WECOM','广告充值驳回（企微迁移）','OPERATIONS',NULL,$wecom_body$【千树 DMS】广告充值驳回
充值申请号：{{rechargeNo}}
原因：{{reason}}
发生时间：{{occurredAt}}
请登录千树 DMS 查看详情。
相关附件见下方。$wecom_body$,$wecom_json$[{"name":"rechargeNo","required":true,"maxLength":64,"sensitive":false},{"name":"reason","required":true,"maxLength":500,"sensitive":true},{"name":"occurredAt","required":true,"maxLength":64,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${"enabled":true,"maxCount":2,"kinds":["IMAGE"],"sources":["advertising.qr","advertising.proof"]}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('operations.advertising-recharge.voided','WECOM','广告充值作废（企微迁移）','OPERATIONS',NULL,$wecom_body$【千树 DMS】广告充值作废
充值申请号：{{rechargeNo}}
原因：{{reason}}
实付金额：{{paymentAmountCny}}
请登录千树 DMS 查看详情。
相关附件见下方。$wecom_body$,$wecom_json$[{"name":"rechargeNo","required":true,"maxLength":64,"sensitive":false},{"name":"reason","required":true,"maxLength":500,"sensitive":true},{"name":"paymentAmountCny","required":true,"maxLength":32,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${"enabled":true,"maxCount":2,"kinds":["IMAGE"],"sources":["advertising.qr","advertising.proof"]}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('sales.order.submitted','WECOM','销售订单提交（企微迁移）','SALES',NULL,$wecom_body$【千树 DMS】销售订单提交
销售单号：{{orderNo}}
币种：{{currencyCode}}
明细行数：{{lineCount}}
请登录千树 DMS 查看详情。
相关附件见下方。$wecom_body$,$wecom_json$[{"name":"orderNo","required":true,"maxLength":64,"sensitive":false},{"name":"currencyCode","required":true,"maxLength":16,"sensitive":false},{"name":"lineCount","required":true,"maxLength":16,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${"enabled":true,"maxCount":1,"kinds":["IMAGE"],"sources":["salesOrder.issuanceVoucher"]}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('sales.order.completed','WECOM','销售订单完成（企微迁移）','SALES',NULL,$wecom_body$【千树 DMS】销售订单完成
销售单号：{{orderNo}}
发生时间：{{occurredAt}}
币种：{{currencyCode}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"orderNo","required":true,"maxLength":64,"sensitive":false},{"name":"occurredAt","required":true,"maxLength":64,"sensitive":false},{"name":"currencyCode","required":true,"maxLength":16,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('purchase.order.completed','WECOM','采购订单完成（企微迁移）','PURCHASE',NULL,$wecom_body$【千树 DMS】采购订单完成
采购单号：{{orderNo}}
供货方：{{vendorName}}
发生时间：{{occurredAt}}
请登录千树 DMS 查看详情。
相关附件见下方。$wecom_body$,$wecom_json$[{"name":"orderNo","required":true,"maxLength":64,"sensitive":false},{"name":"vendorName","required":true,"maxLength":128,"sensitive":false},{"name":"occurredAt","required":true,"maxLength":64,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${"enabled":true,"maxCount":2,"kinds":["IMAGE"],"sources":["purchase.paymentVoucher","purchase.deliveryReceipt"]}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('shipment.signed','WECOM','货件签收（企微迁移）','SHIPMENT',NULL,$wecom_body$【千树 DMS】货件签收
采购单号：{{orderNo}}
发生时间：{{occurredAt}}
币种：{{currencyCode}}
请登录千树 DMS 查看详情。
相关附件见下方。$wecom_body$,$wecom_json$[{"name":"orderNo","required":true,"maxLength":64,"sensitive":false},{"name":"occurredAt","required":true,"maxLength":64,"sensitive":false},{"name":"currencyCode","required":true,"maxLength":16,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${"enabled":true,"maxCount":1,"kinds":["IMAGE"],"sources":["salesOrder.deliveryReceipt"]}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('sales.order.terminated','WECOM','销售订单终止（企微迁移）','SALES',NULL,$wecom_body$【千树 DMS】销售订单终止
销售单号：{{orderNo}}
原因：{{reason}}
发生时间：{{occurredAt}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"orderNo","required":true,"maxLength":64,"sensitive":false},{"name":"reason","required":true,"maxLength":500,"sensitive":true},{"name":"occurredAt","required":true,"maxLength":64,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('fund.account.adjusted','WECOM','资金账户调整（企微迁移）','FINANCE',NULL,$wecom_body$【千树 DMS】资金账户调整
金额：{{amount}}
币种：{{currencyCode}}
原因：{{reason}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"amount","required":true,"maxLength":32,"sensitive":true},{"name":"currencyCode","required":true,"maxLength":16,"sensitive":false},{"name":"reason","required":true,"maxLength":500,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('operations.proxy-node.expired','WECOM','节点已过期（企微迁移）','OPERATIONS',NULL,$wecom_body$【千树 DMS】节点已过期
节点名称：{{nodeLabel}}
节点地址：{{host}}
到期时间：{{expiresAt}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"nodeLabel","required":true,"maxLength":128,"sensitive":false},{"name":"host","required":true,"maxLength":255,"sensitive":false},{"name":"expiresAt","required":true,"maxLength":64,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('fund.account.reversed','WECOM','资金冲账（企微迁移）','FINANCE',NULL,$wecom_body$【千树 DMS】资金冲账
金额：{{amount}}
币种：{{currencyCode}}
原因：{{reason}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"amount","required":true,"maxLength":32,"sensitive":true},{"name":"currencyCode","required":true,"maxLength":16,"sensitive":false},{"name":"reason","required":true,"maxLength":500,"sensitive":true}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_templates" ("key","channel","name","domain","title_template","body_template","variables","media_policy","max_length","max_bytes","enabled")
VALUES ('operations.ad-account.balance-low','WECOM','广告户余额预警（企微迁移）','OPERATIONS',NULL,$wecom_body$【千树 DMS】广告户余额预警
广告账户名称：{{adAccountName}}
可用余额：{{availableBalance}}
预警阈值：{{balanceThreshold}}
请登录千树 DMS 查看详情。$wecom_body$,$wecom_json$[{"name":"adAccountName","required":true,"maxLength":128,"sensitive":true},{"name":"availableBalance","required":true,"maxLength":32,"sensitive":true},{"name":"balanceThreshold","required":true,"maxLength":32,"sensitive":false}]$wecom_json$::jsonb,$wecom_json${}$wecom_json$::jsonb,2000,2048,false)
ON CONFLICT ("key","channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type","channel","target_mode","target_config","template_key","priority","ttl_seconds","quiet_hours","allow_sensitive","enabled")
SELECT p."event_type", 'WECOM', CASE WHEN p."target_mode" = 'GROUP' THEN 'GROUP'::"notification_target_mode" ELSE p."target_mode" END, CASE WHEN p."target_mode" = 'GROUP' THEN '{"targetKeys": []}'::jsonb ELSE p."target_config" END, d."template_key", p."priority", 86400, NULL, p."allow_sensitive", false
FROM "notification_channel_policies" p JOIN (VALUES
('PURCHASE_REVIEW_PENDING','purchase.review.pending'),
('INVOICE_REQUEST_REVIEW_PENDING','invoice.review.pending'),
('SLH_RECONCILIATION_COMPLETED','slh.reconciliation.completed'),
('SHIPMENT_ARRIVED','shipment.arrived'),
('FUND_WITHDRAWAL_REVIEW_PENDING','fund.withdrawal.pending'),
('PACKAGING_COST_PAYMENT_PENDING','packaging.payment.pending'),
('PURCHASE_PAYABLE_PENDING','purchase.payable.pending'),
('SALES_RECEIPT_REVIEW_PENDING','sales.receipt.pending'),
('SALES_RECEIPT_VOUCHER_SENT','sales.receipt.voucher-sent'),
('SALES_RECEIPT_APPROVED','sales.receipt.approved'),
('SALES_RECEIPT_REJECTED','sales.receipt.rejected'),
('PURCHASE_REVIEW_APPROVED','purchase.review.approved'),
('PURCHASE_REVIEW_REJECTED','purchase.review.rejected'),
('PURCHASE_ORDER_CANCELLED','purchase.order.cancelled'),
('STORAGE_CLAIM_REQUEST_PENDING','shipment.storage-claim.pending'),
('STORAGE_CLAIM_REQUEST_APPROVED','shipment.storage-claim.approved'),
('STORAGE_CLAIM_REQUEST_REJECTED','shipment.storage-claim.rejected'),
('SHIPMENT_RELEASED_TO_STORAGE','shipment.released-to-storage'),
('FUND_WITHDRAWAL_APPROVED','fund.withdrawal.approved'),
('FUND_WITHDRAWAL_REJECTED','fund.withdrawal.rejected'),
('PACKAGING_COST_PAID','packaging.payment.paid'),
('INVOICE_REQUEST_RETURNED','invoice.returned'),
('INVOICE_REQUEST_NOTIFIED','invoice.notified'),
('INVOICE_REQUEST_ISSUED','invoice.issued'),
('INVOICE_REQUEST_SETTLED','invoice.settled'),
('INVOICE_REQUEST_CANCELLED','invoice.cancelled'),
('MACHINE_VIEWING_APPOINTMENT_CREATED','operations.machine-viewing.created'),
('MACHINE_VIEWING_APPOINTMENT_RESCHEDULED','operations.machine-viewing.rescheduled'),
('PROXY_NODE_EXPIRING','operations.proxy-node.expiring'),
('ADVERTISING_RECHARGE_PENDING','operations.advertising-recharge.pending'),
('ADVERTISING_RECHARGE_PAYMENT_CODE_REQUIRED','operations.advertising-recharge.payment-code'),
('ADVERTISING_RECHARGE_PAID','operations.advertising-recharge.paid'),
('ADVERTISING_RECHARGE_REJECTED','operations.advertising-recharge.rejected'),
('ADVERTISING_RECHARGE_VOIDED','operations.advertising-recharge.voided'),
('SALES_ORDER_SUBMITTED','sales.order.submitted'),
('SALES_ORDER_COMPLETED','sales.order.completed'),
('PURCHASE_ORDER_COMPLETED','purchase.order.completed'),
('SHIPMENT_SIGNED','shipment.signed'),
('SALES_ORDER_TERMINATED','sales.order.terminated'),
('FUND_ACCOUNT_ADJUSTED','fund.account.adjusted'),
('PROXY_NODE_EXPIRED','operations.proxy-node.expired'),
('FUND_ACCOUNT_REVERSED','fund.account.reversed'),
('AD_ACCOUNT_BALANCE_LOW','operations.ad-account.balance-low')
) AS d("event_type","template_key") ON d."event_type" = p."event_type"
WHERE p."channel" = 'ASSISTANT'
ON CONFLICT ("event_type","channel") DO NOTHING;

-- 没有 ASSISTANT 策略的新事件也必须有 WECOM 策略入口；群事件保留空 GROUP 目标等待人工映射。
INSERT INTO "notification_channel_policies" ("event_type","channel","target_mode","target_config","template_key","priority","ttl_seconds","quiet_hours","allow_sensitive","enabled")
SELECT d."event_type", 'WECOM', d."target_mode"::"notification_target_mode", d."target_config", d."template_key", 'NORMAL', 86400, NULL, true, false
FROM (VALUES
('PURCHASE_REVIEW_PENDING','purchase.review.pending','COMMAND_TARGET','{}'::jsonb),
('INVOICE_REQUEST_REVIEW_PENDING','invoice.review.pending','COMMAND_TARGET','{}'::jsonb),
('SLH_RECONCILIATION_COMPLETED','slh.reconciliation.completed','COMMAND_TARGET','{}'::jsonb),
('SHIPMENT_ARRIVED','shipment.arrived','GROUP','{"targetKeys": []}'::jsonb),
('FUND_WITHDRAWAL_REVIEW_PENDING','fund.withdrawal.pending','COMMAND_TARGET','{}'::jsonb),
('PACKAGING_COST_PAYMENT_PENDING','packaging.payment.pending','COMMAND_TARGET','{}'::jsonb),
('PURCHASE_PAYABLE_PENDING','purchase.payable.pending','COMMAND_TARGET','{}'::jsonb),
('SALES_RECEIPT_REVIEW_PENDING','sales.receipt.pending','COMMAND_TARGET','{}'::jsonb),
('SALES_RECEIPT_VOUCHER_SENT','sales.receipt.voucher-sent','GROUP','{"targetKeys": []}'::jsonb),
('SALES_RECEIPT_APPROVED','sales.receipt.approved','COMMAND_TARGET','{}'::jsonb),
('SALES_RECEIPT_REJECTED','sales.receipt.rejected','COMMAND_TARGET','{}'::jsonb),
('PURCHASE_REVIEW_APPROVED','purchase.review.approved','COMMAND_TARGET','{}'::jsonb),
('PURCHASE_REVIEW_REJECTED','purchase.review.rejected','COMMAND_TARGET','{}'::jsonb),
('PURCHASE_ORDER_CANCELLED','purchase.order.cancelled','COMMAND_TARGET','{}'::jsonb),
('STORAGE_CLAIM_REQUEST_PENDING','shipment.storage-claim.pending','COMMAND_TARGET','{}'::jsonb),
('STORAGE_CLAIM_REQUEST_APPROVED','shipment.storage-claim.approved','COMMAND_TARGET','{}'::jsonb),
('STORAGE_CLAIM_REQUEST_REJECTED','shipment.storage-claim.rejected','COMMAND_TARGET','{}'::jsonb),
('SHIPMENT_RELEASED_TO_STORAGE','shipment.released-to-storage','COMMAND_TARGET','{}'::jsonb),
('FUND_WITHDRAWAL_APPROVED','fund.withdrawal.approved','COMMAND_TARGET','{}'::jsonb),
('FUND_WITHDRAWAL_REJECTED','fund.withdrawal.rejected','COMMAND_TARGET','{}'::jsonb),
('PACKAGING_COST_PAID','packaging.payment.paid','COMMAND_TARGET','{}'::jsonb),
('INVOICE_REQUEST_RETURNED','invoice.returned','COMMAND_TARGET','{}'::jsonb),
('INVOICE_REQUEST_NOTIFIED','invoice.notified','COMMAND_TARGET','{}'::jsonb),
('INVOICE_REQUEST_ISSUED','invoice.issued','COMMAND_TARGET','{}'::jsonb),
('INVOICE_REQUEST_SETTLED','invoice.settled','COMMAND_TARGET','{}'::jsonb),
('INVOICE_REQUEST_CANCELLED','invoice.cancelled','COMMAND_TARGET','{}'::jsonb),
('MACHINE_VIEWING_APPOINTMENT_CREATED','operations.machine-viewing.created','COMMAND_TARGET','{}'::jsonb),
('MACHINE_VIEWING_APPOINTMENT_RESCHEDULED','operations.machine-viewing.rescheduled','COMMAND_TARGET','{}'::jsonb),
('PROXY_NODE_EXPIRING','operations.proxy-node.expiring','COMMAND_TARGET','{}'::jsonb),
('ADVERTISING_RECHARGE_PENDING','operations.advertising-recharge.pending','COMMAND_TARGET','{}'::jsonb),
('ADVERTISING_RECHARGE_PAYMENT_CODE_REQUIRED','operations.advertising-recharge.payment-code','COMMAND_TARGET','{}'::jsonb),
('ADVERTISING_RECHARGE_PAID','operations.advertising-recharge.paid','COMMAND_TARGET','{}'::jsonb),
('ADVERTISING_RECHARGE_REJECTED','operations.advertising-recharge.rejected','COMMAND_TARGET','{}'::jsonb),
('ADVERTISING_RECHARGE_VOIDED','operations.advertising-recharge.voided','COMMAND_TARGET','{}'::jsonb),
('SALES_ORDER_SUBMITTED','sales.order.submitted','COMMAND_TARGET','{}'::jsonb),
('SALES_ORDER_COMPLETED','sales.order.completed','COMMAND_TARGET','{}'::jsonb),
('PURCHASE_ORDER_COMPLETED','purchase.order.completed','COMMAND_TARGET','{}'::jsonb),
('SHIPMENT_SIGNED','shipment.signed','COMMAND_TARGET','{}'::jsonb),
('SALES_ORDER_TERMINATED','sales.order.terminated','COMMAND_TARGET','{}'::jsonb),
('FUND_ACCOUNT_ADJUSTED','fund.account.adjusted','COMMAND_TARGET','{}'::jsonb),
('PROXY_NODE_EXPIRED','operations.proxy-node.expired','COMMAND_TARGET','{}'::jsonb),
('FUND_ACCOUNT_REVERSED','fund.account.reversed','COMMAND_TARGET','{}'::jsonb),
('AD_ACCOUNT_BALANCE_LOW','operations.ad-account.balance-low','COMMAND_TARGET','{}'::jsonb)
) AS d("event_type","template_key","target_mode","target_config")
ON CONFLICT ("event_type","channel") DO NOTHING;

-- 自检：43 个业务事件都必须有 WECOM 模板和策略入口；模板/策略是否启用由管理员在切换窗口决定。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('PURCHASE_REVIEW_PENDING','purchase.review.pending'),
      ('INVOICE_REQUEST_REVIEW_PENDING','invoice.review.pending'),
      ('SLH_RECONCILIATION_COMPLETED','slh.reconciliation.completed'),
      ('SHIPMENT_ARRIVED','shipment.arrived'),
      ('FUND_WITHDRAWAL_REVIEW_PENDING','fund.withdrawal.pending'),
      ('PACKAGING_COST_PAYMENT_PENDING','packaging.payment.pending'),
      ('PURCHASE_PAYABLE_PENDING','purchase.payable.pending'),
      ('SALES_RECEIPT_REVIEW_PENDING','sales.receipt.pending'),
      ('SALES_RECEIPT_VOUCHER_SENT','sales.receipt.voucher-sent'),
      ('SALES_RECEIPT_APPROVED','sales.receipt.approved'),
      ('SALES_RECEIPT_REJECTED','sales.receipt.rejected'),
      ('PURCHASE_REVIEW_APPROVED','purchase.review.approved'),
      ('PURCHASE_REVIEW_REJECTED','purchase.review.rejected'),
      ('PURCHASE_ORDER_CANCELLED','purchase.order.cancelled'),
      ('STORAGE_CLAIM_REQUEST_PENDING','shipment.storage-claim.pending'),
      ('STORAGE_CLAIM_REQUEST_APPROVED','shipment.storage-claim.approved'),
      ('STORAGE_CLAIM_REQUEST_REJECTED','shipment.storage-claim.rejected'),
      ('SHIPMENT_RELEASED_TO_STORAGE','shipment.released-to-storage'),
      ('FUND_WITHDRAWAL_APPROVED','fund.withdrawal.approved'),
      ('FUND_WITHDRAWAL_REJECTED','fund.withdrawal.rejected'),
      ('PACKAGING_COST_PAID','packaging.payment.paid'),
      ('INVOICE_REQUEST_RETURNED','invoice.returned'),
      ('INVOICE_REQUEST_NOTIFIED','invoice.notified'),
      ('INVOICE_REQUEST_ISSUED','invoice.issued'),
      ('INVOICE_REQUEST_SETTLED','invoice.settled'),
      ('INVOICE_REQUEST_CANCELLED','invoice.cancelled'),
      ('MACHINE_VIEWING_APPOINTMENT_CREATED','operations.machine-viewing.created'),
      ('MACHINE_VIEWING_APPOINTMENT_RESCHEDULED','operations.machine-viewing.rescheduled'),
      ('PROXY_NODE_EXPIRING','operations.proxy-node.expiring'),
      ('ADVERTISING_RECHARGE_PENDING','operations.advertising-recharge.pending'),
      ('ADVERTISING_RECHARGE_PAYMENT_CODE_REQUIRED','operations.advertising-recharge.payment-code'),
      ('ADVERTISING_RECHARGE_PAID','operations.advertising-recharge.paid'),
      ('ADVERTISING_RECHARGE_REJECTED','operations.advertising-recharge.rejected'),
      ('ADVERTISING_RECHARGE_VOIDED','operations.advertising-recharge.voided'),
      ('SALES_ORDER_SUBMITTED','sales.order.submitted'),
      ('SALES_ORDER_COMPLETED','sales.order.completed'),
      ('PURCHASE_ORDER_COMPLETED','purchase.order.completed'),
      ('SHIPMENT_SIGNED','shipment.signed'),
      ('SALES_ORDER_TERMINATED','sales.order.terminated'),
      ('FUND_ACCOUNT_ADJUSTED','fund.account.adjusted'),
      ('PROXY_NODE_EXPIRED','operations.proxy-node.expired'),
      ('FUND_ACCOUNT_REVERSED','fund.account.reversed'),
      ('AD_ACCOUNT_BALANCE_LOW','operations.ad-account.balance-low')
    ) AS expected(event_type, template_key)
    WHERE NOT EXISTS (
      SELECT 1 FROM "notification_templates" t
      WHERE t."channel" = 'WECOM' AND t."key" = expected.template_key
    )
    OR NOT EXISTS (
      SELECT 1 FROM "notification_channel_policies" p
      WHERE p."channel" = 'WECOM' AND p."event_type" = expected.event_type
    )
  ) THEN
    RAISE EXCEPTION 'wecom full event baseline incomplete';
  END IF;
END $$;

COMMIT;