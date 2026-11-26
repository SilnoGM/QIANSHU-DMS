BEGIN;

ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'WECOM_CHANNEL_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'WECOM_APP_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'WECOM_APP_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'WECOM_APP_DISABLED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'WECOM_APP_SECRET_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'WECOM_EVENT_ROUTE_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'WECOM_MEMBERSHIP_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'WECOM_MEMBERSHIP_VERIFIED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'WECOM_TARGET_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'WECOM_TARGET_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'WECOM_TARGET_TESTED';

INSERT INTO "permissions" ("id", "code", "name", "description", "system_only")
VALUES
  ('00000000-0000-4000-8000-000000002438', 'wecom-channel:read', '查看企业微信通知渠道', '查看企业微信渠道设置与运行状态', true),
  ('00000000-0000-4000-8000-000000002439', 'wecom-channel:update', '维护企业微信通知渠道', '修改企业微信渠道设置、启停与测试发送', true),
  ('00000000-0000-4000-8000-000000002440', 'wecom-app:read', '查看企业微信应用', '查看 WECOM 应用配置、事件路由与成员', true),
  ('00000000-0000-4000-8000-000000002441', 'wecom-app:manage', '维护企业微信应用', '新增、修改、停用 WECOM 应用与事件路由', true),
  ('00000000-0000-4000-8000-000000002442', 'wecom-app-secret:update', '维护企业微信应用 Secret', '设置或重置 WECOM 应用 Secret', true),
  ('00000000-0000-4000-8000-000000002443', 'wecom-membership:read', '查看企业微信应用成员', '查看 WECOM 应用级可见成员与验证状态', true),
  ('00000000-0000-4000-8000-000000002444', 'wecom-membership:manage', '维护企业微信应用成员', '添加、移除、验证 WECOM 应用成员', true),
  ('00000000-0000-4000-8000-000000002445', 'wecom-target:read', '查看企业微信群目标', '查看已登记的 WECOM 内部群机器人目标', true),
  ('00000000-0000-4000-8000-000000002446', 'wecom-target:manage', '维护企业微信群目标', '新增、修改、测试与停用 WECOM 群目标', true),
  ('00000000-0000-4000-8000-000000002447', 'wecom-delivery:resend', '重试企业微信投递', '重试失败的 WECOM 投递', true)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission
  ON permission."code" IN (
    'wecom-channel:read',
    'wecom-channel:update',
    'wecom-app:read',
    'wecom-app:manage',
    'wecom-app-secret:update',
    'wecom-membership:read',
    'wecom-membership:manage',
    'wecom-target:read',
    'wecom-target:manage',
    'wecom-delivery:resend'
  )
WHERE role."code" = 'system_admin'
ON CONFLICT DO NOTHING;

-- MigrationSelfCheck
DO $$
DECLARE
  actual_count integer;
BEGIN
  SELECT count(*)::integer
  INTO actual_count
  FROM "permissions"
  WHERE "id" IN (
      '00000000-0000-4000-8000-000000002438',
      '00000000-0000-4000-8000-000000002439',
      '00000000-0000-4000-8000-000000002440',
      '00000000-0000-4000-8000-000000002441',
      '00000000-0000-4000-8000-000000002442',
      '00000000-0000-4000-8000-000000002443',
      '00000000-0000-4000-8000-000000002444',
      '00000000-0000-4000-8000-000000002445',
      '00000000-0000-4000-8000-000000002446',
      '00000000-0000-4000-8000-000000002447'
    )
    AND "code" IN (
      'wecom-channel:read',
      'wecom-channel:update',
      'wecom-app:read',
      'wecom-app:manage',
      'wecom-app-secret:update',
      'wecom-membership:read',
      'wecom-membership:manage',
      'wecom-target:read',
      'wecom-target:manage',
      'wecom-delivery:resend'
    )
    AND "system_only" = true;

  IF actual_count <> 10 THEN
    RAISE EXCEPTION 'wecom permission migration invariant mismatch: permission catalog';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "role_permissions" AS grant_entry
  JOIN "roles" AS role ON role."id" = grant_entry."role_id"
  JOIN "permissions" AS permission ON permission."id" = grant_entry."permission_id"
  WHERE role."code" = 'system_admin'
    AND permission."code" LIKE 'wecom-%';

  IF actual_count <> (
    SELECT count(*)::integer FROM "roles" WHERE "code" = 'system_admin'
  ) * 10 THEN
    RAISE EXCEPTION 'wecom permission migration invariant mismatch: system admin grant';
  END IF;
END $$;

COMMIT;
