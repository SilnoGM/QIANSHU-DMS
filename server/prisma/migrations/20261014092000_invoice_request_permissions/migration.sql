BEGIN;

-- SeedInvoiceRequestPermissions
-- 开票申请与审批的八个权限码：提交、查看、跨提交人查看、审核并通知、退回、上传照片、结算入账、取消。
-- 全部可委派给普通角色（system_only = false）：运营侧持有提交/查看/取消，财务侧持有全量查看与四个处理动作，
-- 由角色权限管理决定具体分配；「运营仅可见本人」是行级归属校验，不是权限点能表达的东西。
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES
  (
    '00000000-0000-4000-8000-000000000171',
    'invoice-requests:cancel',
    '取消开票申请',
    '取消未终态的开票申请；运营仅限本人提交的单据，财务不限，原因必填',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000172',
    'invoice-requests:create',
    '提交开票申请',
    '填写并提交开票申请，以及对已退回的申请重新提交',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000173',
    'invoice-requests:document',
    '上传发票照片',
    '为已通知开票的申请上传一张发票照片，上传即定稿不可替换',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000174',
    'invoice-requests:read',
    '查看开票申请',
    '查看开票申请与开票记录；运营侧仅限本人提交的单据',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000175',
    'invoice-requests:read-all',
    '查看全部开票申请',
    '跨提交人查看开票申请与开票记录（财务侧全量视图）',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000176',
    'invoice-requests:return',
    '退回开票申请',
    '把开票审核中的申请退回给运营重填，退回原因必填',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000177',
    'invoice-requests:review',
    '审核并通知开票',
    '审核开票申请并记录已通知；开票信息复制到剪贴板后由线下通知代开票方',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000178',
    'invoice-requests:settle',
    '结算开票成本',
    '发票照片上传满 120 小时后按公式结算入账，成本按分成比例归属申请人',
    false
  );

-- GrantSystemAdministratorPermissions
-- 通过稳定 ID 与 code 双重约束目标，避免角色或权限目录发生漂移时静默授权错误对象。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."id" IN (
    '00000000-0000-4000-8000-000000000171',
    '00000000-0000-4000-8000-000000000172',
    '00000000-0000-4000-8000-000000000173',
    '00000000-0000-4000-8000-000000000174',
    '00000000-0000-4000-8000-000000000175',
    '00000000-0000-4000-8000-000000000176',
    '00000000-0000-4000-8000-000000000177',
    '00000000-0000-4000-8000-000000000178'
  )
  AND permission."code" IN (
    'invoice-requests:cancel',
    'invoice-requests:create',
    'invoice-requests:document',
    'invoice-requests:read',
    'invoice-requests:read-all',
    'invoice-requests:return',
    'invoice-requests:review',
    'invoice-requests:settle'
  );

-- MigrationSelfCheck
-- 迁移必须在同一事务内证明权限目录与管理员授权都完整，否则整体回滚。
DO $$
DECLARE
  actual_count INTEGER;
BEGIN
  WITH expected_permission("id", "code", "name", "description") AS (
    VALUES
      (
        '00000000-0000-4000-8000-000000000171'::uuid,
        'invoice-requests:cancel',
        '取消开票申请',
        '取消未终态的开票申请；运营仅限本人提交的单据，财务不限，原因必填'
      ),
      (
        '00000000-0000-4000-8000-000000000172'::uuid,
        'invoice-requests:create',
        '提交开票申请',
        '填写并提交开票申请，以及对已退回的申请重新提交'
      ),
      (
        '00000000-0000-4000-8000-000000000173'::uuid,
        'invoice-requests:document',
        '上传发票照片',
        '为已通知开票的申请上传一张发票照片，上传即定稿不可替换'
      ),
      (
        '00000000-0000-4000-8000-000000000174'::uuid,
        'invoice-requests:read',
        '查看开票申请',
        '查看开票申请与开票记录；运营侧仅限本人提交的单据'
      ),
      (
        '00000000-0000-4000-8000-000000000175'::uuid,
        'invoice-requests:read-all',
        '查看全部开票申请',
        '跨提交人查看开票申请与开票记录（财务侧全量视图）'
      ),
      (
        '00000000-0000-4000-8000-000000000176'::uuid,
        'invoice-requests:return',
        '退回开票申请',
        '把开票审核中的申请退回给运营重填，退回原因必填'
      ),
      (
        '00000000-0000-4000-8000-000000000177'::uuid,
        'invoice-requests:review',
        '审核并通知开票',
        '审核开票申请并记录已通知；开票信息复制到剪贴板后由线下通知代开票方'
      ),
      (
        '00000000-0000-4000-8000-000000000178'::uuid,
        'invoice-requests:settle',
        '结算开票成本',
        '发票照片上传满 120 小时后按公式结算入账，成本按分成比例归属申请人'
      )
  )
  SELECT count(*)::integer
  INTO actual_count
  FROM expected_permission AS expected
  JOIN "permissions" AS permission
    ON permission."id" = expected."id"
    AND permission."code" = expected."code"
    AND permission."name" = expected."name"
    AND permission."description" = expected."description"
    AND permission."system_only" = false;

  IF actual_count <> 8 THEN
    RAISE EXCEPTION 'invoice request permission migration invariant mismatch: permission catalog';
  END IF;

  WITH expected_permission("id", "code") AS (
    VALUES
      ('00000000-0000-4000-8000-000000000171'::uuid, 'invoice-requests:cancel'),
      ('00000000-0000-4000-8000-000000000172'::uuid, 'invoice-requests:create'),
      ('00000000-0000-4000-8000-000000000173'::uuid, 'invoice-requests:document'),
      ('00000000-0000-4000-8000-000000000174'::uuid, 'invoice-requests:read'),
      ('00000000-0000-4000-8000-000000000175'::uuid, 'invoice-requests:read-all'),
      ('00000000-0000-4000-8000-000000000176'::uuid, 'invoice-requests:return'),
      ('00000000-0000-4000-8000-000000000177'::uuid, 'invoice-requests:review'),
      ('00000000-0000-4000-8000-000000000178'::uuid, 'invoice-requests:settle')
  )
  SELECT count(*)::integer
  INTO actual_count
  FROM expected_permission AS expected
  JOIN "permissions" AS permission
    ON permission."id" = expected."id"
    AND permission."code" = expected."code"
  JOIN "role_permissions" AS grant_entry
    ON grant_entry."permission_id" = permission."id"
  JOIN "roles" AS role
    ON role."id" = grant_entry."role_id"
  WHERE role."id" = '00000000-0000-4000-8000-000000000001'
    AND role."code" = 'system_admin';

  IF actual_count <> 8 THEN
    RAISE EXCEPTION 'invoice request permission migration invariant mismatch: system admin grants';
  END IF;
END;
$$;

COMMIT;
