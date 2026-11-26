BEGIN;

-- WECOM 试点内容只作为禁用起点：生产默认不内置通知模板，管理员必须在
-- 通知策略页面确认文案、选择试点员工/内部群后手动启用模板与策略。
-- 空目标配置保证误启用策略时也不会产生收件人。
INSERT INTO "notification_templates" (
  "key", "channel", "name", "domain", "title_template", "body_template",
  "variables", "media_policy", "max_length", "max_bytes", "enabled"
)
VALUES (
  'purchase.review.pending',
  'WECOM',
  '采购审核待处理（企微试点）',
  'PURCHASE',
  NULL,
  $body$【企微试点】采购单 {{orderNo}} 待审核
供货方：{{vendorName}}
金额：{{currencyCode}} {{totalAmount}}
请登录千树 DMS 处理。$body$,
  $vars$[
    {"name": "orderNo", "required": true, "maxLength": 64, "sensitive": false},
    {"name": "vendorName", "required": true, "maxLength": 200, "sensitive": false},
    {"name": "totalAmount", "required": true, "maxLength": 32, "sensitive": false},
    {"name": "currencyCode", "required": true, "maxLength": 8, "sensitive": false}
  ]$vars$::jsonb,
  '{}'::jsonb,
  2000,
  2048,
  false
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" (
  "key", "channel", "name", "domain", "title_template", "body_template",
  "variables", "media_policy", "max_length", "max_bytes", "enabled"
)
VALUES (
  'purchase.review.approved',
  'WECOM',
  '采购审核通过（企微试点）',
  'PURCHASE',
  NULL,
  $body$【企微试点】采购单 {{orderNo}} 已审核通过
供货方：{{vendorName}}
金额：{{currencyCode}} {{totalAmount}}
唛头：{{shippingMark}}
采购单图片见附件。$body$,
  $vars$[
    {"name": "orderNo", "required": true, "maxLength": 64, "sensitive": false},
    {"name": "vendorName", "required": true, "maxLength": 200, "sensitive": false},
    {"name": "totalAmount", "required": true, "maxLength": 32, "sensitive": false},
    {"name": "currencyCode", "required": true, "maxLength": 8, "sensitive": false},
    {"name": "shippingMark", "required": true, "maxLength": 500, "sensitive": false}
  ]$vars$::jsonb,
  $media${
    "enabled": true,
    "maxCount": 1,
    "kinds": ["IMAGE"],
    "sources": ["purchase.orderImage"]
  }$media$::jsonb,
  2000,
  2048,
  false
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" (
  "event_type", "channel", "target_mode", "target_config", "template_key",
  "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled"
)
VALUES (
  'PURCHASE_REVIEW_PENDING',
  'WECOM',
  'USERS',
  '{"userIds": []}'::jsonb,
  'purchase.review.pending',
  'HIGH',
  86400,
  NULL,
  false,
  false
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

INSERT INTO "notification_channel_policies" (
  "event_type", "channel", "target_mode", "target_config", "template_key",
  "priority", "ttl_seconds", "quiet_hours", "allow_sensitive", "enabled"
)
VALUES (
  'PURCHASE_REVIEW_APPROVED',
  'WECOM',
  'GROUP',
  '{"targetKeys": []}'::jsonb,
  'purchase.review.approved',
  'NORMAL',
  86400,
  NULL,
  true,
  false
)
ON CONFLICT ("event_type", "channel") DO NOTHING;

-- 只验证试点入口存在，不覆盖管理员已创建的模板/策略内容。
DO $$
DECLARE
  template_count integer;
  policy_count integer;
BEGIN
  SELECT count(*)::integer
  INTO template_count
  FROM "notification_templates"
  WHERE "channel" = 'WECOM'
    AND "key" IN ('purchase.review.pending', 'purchase.review.approved');

  IF template_count <> 2 THEN
    RAISE EXCEPTION 'wecom pilot template seed mismatch: %', template_count;
  END IF;

  SELECT count(*)::integer
  INTO policy_count
  FROM "notification_channel_policies"
  WHERE "channel" = 'WECOM'
    AND "event_type" IN ('PURCHASE_REVIEW_PENDING', 'PURCHASE_REVIEW_APPROVED')
    AND "template_key" IN ('purchase.review.pending', 'purchase.review.approved');

  IF policy_count <> 2 THEN
    RAISE EXCEPTION 'wecom pilot policy seed mismatch: %', policy_count;
  END IF;
END $$;

COMMIT;
