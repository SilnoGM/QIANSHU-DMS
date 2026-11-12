BEGIN;

-- E 批可选低优先级事件默认模板与策略。

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'sales.order.completed',
  'IN_APP',
  '销售订单完成',
  'SALES',
  '销售订单 {{orderNo}} 已完成',
  $body$客户：{{customerName}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "customerName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'sales.order.completed',
  'ASSISTANT',
  '销售订单完成',
  'SALES',
  NULL,
  $body$客户：{{customerName}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "customerName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'purchase.order.completed',
  'IN_APP',
  '采购订单完成',
  'PURCHASE',
  '采购单 {{orderNo}} 已完成',
  $body$供货方：{{vendorName}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "vendorName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'purchase.order.completed',
  'ASSISTANT',
  '采购订单完成',
  'PURCHASE',
  NULL,
  $body$供货方：{{vendorName}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "vendorName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'shipment.signed',
  'IN_APP',
  '货件签收',
  'SHIPMENT',
  '销售订单 {{orderNo}} 已签收',
  $body$客户：{{customerName}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "customerName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'shipment.signed',
  'ASSISTANT',
  '货件签收',
  'SHIPMENT',
  NULL,
  $body$客户：{{customerName}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "customerName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'sales.order.terminated',
  'IN_APP',
  '销售订单终止',
  'SALES',
  '销售订单 {{orderNo}} 已终止',
  $body$客户：{{customerName}}
原因：{{reason}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "customerName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'sales.order.terminated',
  'ASSISTANT',
  '销售订单终止',
  'SALES',
  NULL,
  $body$客户：{{customerName}}
原因：{{reason}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "customerName", "required": false, "maxLength": 200, "sensitive": true}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'fund.account.adjusted',
  'IN_APP',
  '资金账户调整',
  'FINANCE',
  '资金账户已调整',
  $body$金额：{{currencyCode}} {{amount}}
原因：{{reason}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "currencyCode", "required": false, "maxLength": 200, "sensitive": false}, {"name": "amount", "required": false, "maxLength": 200, "sensitive": true}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'fund.account.adjusted',
  'ASSISTANT',
  '资金账户调整',
  'FINANCE',
  NULL,
  $body$金额：{{currencyCode}} {{amount}}
原因：{{reason}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "currencyCode", "required": false, "maxLength": 200, "sensitive": false}, {"name": "amount", "required": false, "maxLength": 200, "sensitive": true}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'operations.proxy-node.expired',
  'IN_APP',
  '节点已过期',
  'OPERATIONS',
  '静态节点已过期',
  $body$节点：{{nodeLabel}}
地址：{{host}}
到期：{{expiresAt}}
绑定：{{assignedUserName}}$body$,
  $vars$[{"name": "nodeLabel", "required": false, "maxLength": 200, "sensitive": false}, {"name": "host", "required": false, "maxLength": 200, "sensitive": false}, {"name": "expiresAt", "required": false, "maxLength": 200, "sensitive": false}, {"name": "assignedUserName", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'operations.proxy-node.expired',
  'ASSISTANT',
  '节点已过期',
  'OPERATIONS',
  NULL,
  $body$节点：{{nodeLabel}}
地址：{{host}}
到期：{{expiresAt}}
绑定：{{assignedUserName}}$body$,
  $vars$[{"name": "nodeLabel", "required": false, "maxLength": 200, "sensitive": false}, {"name": "host", "required": false, "maxLength": 200, "sensitive": false}, {"name": "expiresAt", "required": false, "maxLength": 200, "sensitive": false}, {"name": "assignedUserName", "required": false, "maxLength": 200, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'system.assistant-account.offline',
  'IN_APP',
  '小助理离线',
  'SYSTEM',
  '千树小助理离线',
  $body$公司号：{{accountName}}
时间：{{occurredAt}}
原因：{{reason}}$body$,
  $vars$[{"name": "accountName", "required": false, "maxLength": 200, "sensitive": false}, {"name": "occurredAt", "required": false, "maxLength": 200, "sensitive": false}, {"name": "reason", "required": false, "maxLength": 200, "sensitive": true}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'SALES_ORDER_COMPLETED',
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
  'SALES_ORDER_COMPLETED',
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
  'PURCHASE_ORDER_COMPLETED',
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
  'PURCHASE_ORDER_COMPLETED',
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
  'SHIPMENT_SIGNED',
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
  'SHIPMENT_SIGNED',
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
  'SALES_ORDER_TERMINATED',
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
  'SALES_ORDER_TERMINATED',
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
  'FUND_ACCOUNT_ADJUSTED',
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
  'FUND_ACCOUNT_ADJUSTED',
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
  'PROXY_NODE_EXPIRED',
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
  'PROXY_NODE_EXPIRED',
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
  'ASSISTANT_ACCOUNT_OFFLINE',
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

COMMIT;
