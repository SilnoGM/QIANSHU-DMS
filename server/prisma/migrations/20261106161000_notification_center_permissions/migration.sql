BEGIN;

INSERT INTO "permissions" ("id", "code", "name", "description", "system_only")
VALUES
  ('00000000-0000-4000-8000-000000000200', 'notification-template:read', '查看通知模板', '查看通知中心模板与预览', true),
  ('00000000-0000-4000-8000-000000000201', 'notification-template:update', '维护通知模板', '新建、修改与测试发送通知模板', true),
  ('00000000-0000-4000-8000-000000000202', 'notification-policy:read', '查看通知策略', '查看全局设置与事件 × 渠道策略', true),
  ('00000000-0000-4000-8000-000000000203', 'notification-policy:update', '维护通知策略', '修改全局设置与事件 × 渠道策略', true),
  ('00000000-0000-4000-8000-000000000204', 'notification-record:read', '查看通知记录', '查看逻辑通知、渠道汇总与投递详情', true),
  ('00000000-0000-4000-8000-000000000205', 'notification-record:manage', '管理通知记录', '取消未发送的站外交付', true),
  ('00000000-0000-4000-8000-000000000206', 'assistant-channel:read', '查看千树小助理渠道', '查看渠道配置与运行概览', true),
  ('00000000-0000-4000-8000-000000000207', 'assistant-channel:update', '维护千树小助理渠道', '修改渠道配置、启停与测试发送', true),
  ('00000000-0000-4000-8000-000000000208', 'assistant-account:read', '查看小助理账号', '查看公司号状态与好友列表', true),
  ('00000000-0000-4000-8000-000000000209', 'assistant-account:operate', '操作小助理账号', '新增账号、扫码登录、重连与退出', true),
  ('00000000-0000-4000-8000-000000000210', 'assistant-binding:read', '查看员工绑定', '查看员工与公司号绑定状态', true),
  ('00000000-0000-4000-8000-000000000211', 'assistant-binding:manage', '维护员工绑定', '创建绑定、测试消息验证、解绑与好友巡检', true),
  ('00000000-0000-4000-8000-000000000212', 'assistant-target:read', '查看群目标', '查看已登记的微信群目标', true),
  ('00000000-0000-4000-8000-000000000213', 'assistant-target:manage', '维护群目标', '同步群、命名、标记内部群与启停', true),
  ('00000000-0000-4000-8000-000000000214', 'assistant-delivery:resend', '重试小助理投递', '重试失败的站外交付', true)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
JOIN "permissions" AS permission
  ON permission."code" IN (
    'notification-template:read',
    'notification-template:update',
    'notification-policy:read',
    'notification-policy:update',
    'notification-record:read',
    'notification-record:manage',
    'assistant-channel:read',
    'assistant-channel:update',
    'assistant-account:read',
    'assistant-account:operate',
    'assistant-binding:read',
    'assistant-binding:manage',
    'assistant-target:read',
    'assistant-target:manage',
    'assistant-delivery:resend'
  )
WHERE role."code" = 'system_admin'
ON CONFLICT DO NOTHING;

COMMIT;
