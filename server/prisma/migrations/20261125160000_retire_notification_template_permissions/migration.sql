BEGIN;

-- 通知模板已下线：内容由事件渠道配置独享，模板库/模板选择/模板预览不再存在。
-- 旧 notification_templates / notification_channel_policies 表保留一个发布周期供回滚核对；
-- 本次只回收已无任何接口、路由或页面使用的模板权限。
DELETE FROM "role_permissions"
WHERE "permission_id" IN (
  SELECT "id" FROM "permissions"
  WHERE "code" IN ('notification-template:read', 'notification-template:update')
);

DELETE FROM "permissions"
WHERE "code" IN ('notification-template:read', 'notification-template:update');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "permissions"
    WHERE "code" IN ('notification-template:read', 'notification-template:update')
  ) THEN
    RAISE EXCEPTION 'notification template permissions still exist after retirement'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

COMMIT;
