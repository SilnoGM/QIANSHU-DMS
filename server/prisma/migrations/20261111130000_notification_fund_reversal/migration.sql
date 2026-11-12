BEGIN;

-- 所有资金冲账统一通知原批次归属的个人账户本人。

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'fund.account.reversed',
  'IN_APP',
  '资金冲账',
  'FINANCE',
  '资金账户已冲账',
  $body$资金账户已冲账
金额：{{currencyCode}} {{amount}}
原因：{{reason}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "amount", "required": true, "maxLength": 32, "sensitive": true}, {"name": "currencyCode", "required": true, "maxLength": 16, "sensitive": false}, {"name": "reason", "required": true, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": true, "maxLength": 64, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" ("key", "channel", "name", "domain", "title_template", "body_template", "variables", "max_length", "enabled")
VALUES (
  'fund.account.reversed',
  'ASSISTANT',
  '资金冲账',
  'FINANCE',
  NULL,
  $body$资金账户已冲账
金额：{{currencyCode}} {{amount}}
原因：{{reason}}
时间：{{occurredAt}}$body$,
  $vars$[{"name": "amount", "required": true, "maxLength": 32, "sensitive": true}, {"name": "currencyCode", "required": true, "maxLength": 16, "sensitive": false}, {"name": "reason", "required": true, "maxLength": 200, "sensitive": true}, {"name": "occurredAt", "required": true, "maxLength": 64, "sensitive": false}]$vars$::jsonb,
  2000,
  true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" ("event_type", "channel", "target_mode", "target_config", "template_key", "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled")
VALUES (
  'FUND_ACCOUNT_REVERSED',
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
  'FUND_ACCOUNT_REVERSED',
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

COMMIT;
