BEGIN;

-- SeedProductTaxonomyPermissions
-- 分类/产品头是独立的目录资源：页面读取、内联新建、重命名与删除分别有权限点。
-- 产品维护角色会获得 read + create（内联新建需要 create），update/delete 首期只授予
-- 系统管理员，后续可按角色权限管理单独放开。
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES
  (
    '00000000-0000-4000-8000-000000000183',
    'product-categories:read',
    '查看产品分类',
    '查看产品分类管理页与产品表单的分类、产品头选项',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000184',
    'product-categories:create',
    '新建产品分类',
    '新建分类或产品头，包括保存产品时的内联新建',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000185',
    'product-categories:update',
    '编辑产品分类',
    '重命名分类或产品头；不允许移动所属供应商或分类',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000186',
    'product-categories:delete',
    '删除产品分类',
    '删除没有产品引用的分类或产品头；分类删除会级联删除其空产品头',
    false
  );

-- GrantSystemAdministratorPermissions
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."id" IN (
    '00000000-0000-4000-8000-000000000183',
    '00000000-0000-4000-8000-000000000184',
    '00000000-0000-4000-8000-000000000185',
    '00000000-0000-4000-8000-000000000186'
  )
  AND permission."code" IN (
    'product-categories:read',
    'product-categories:create',
    'product-categories:update',
    'product-categories:delete'
  );

-- GrantProductMaintainersReadPermission
-- 产品页面需要读取分类选项；按既有产品读/写能力补齐，不扩散到无关角色。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE permission."id" = '00000000-0000-4000-8000-000000000183'
  AND permission."code" = 'product-categories:read'
  AND EXISTS (
    SELECT 1
    FROM "role_permissions" AS product_grant
    JOIN "permissions" AS product_permission
      ON product_permission."id" = product_grant."permission_id"
    WHERE product_grant."role_id" = role."id"
      AND product_permission."code" IN ('products:read', 'products:create', 'products:update')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "role_permissions" AS existing_grant
    WHERE existing_grant."role_id" = role."id"
      AND existing_grant."permission_id" = permission."id"
  );

-- GrantProductMaintainersInlineCreatePermission
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE permission."id" = '00000000-0000-4000-8000-000000000184'
  AND permission."code" = 'product-categories:create'
  AND role."id" <> '00000000-0000-4000-8000-000000000001'
  AND EXISTS (
    SELECT 1
    FROM "role_permissions" AS product_grant
    JOIN "permissions" AS product_permission
      ON product_permission."id" = product_grant."permission_id"
    WHERE product_grant."role_id" = role."id"
      AND product_permission."code" IN ('products:create', 'products:update')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "role_permissions" AS existing_grant
    WHERE existing_grant."role_id" = role."id"
      AND existing_grant."permission_id" = permission."id"
  );

-- MigrationSelfCheck
DO $$
DECLARE
  actual_count INTEGER;
  expected_count INTEGER;
BEGIN
  WITH expected_permission("id", "code", "name", "description") AS (
    VALUES
      (
        '00000000-0000-4000-8000-000000000183'::uuid,
        'product-categories:read',
        '查看产品分类',
        '查看产品分类管理页与产品表单的分类、产品头选项'
      ),
      (
        '00000000-0000-4000-8000-000000000184'::uuid,
        'product-categories:create',
        '新建产品分类',
        '新建分类或产品头，包括保存产品时的内联新建'
      ),
      (
        '00000000-0000-4000-8000-000000000185'::uuid,
        'product-categories:update',
        '编辑产品分类',
        '重命名分类或产品头；不允许移动所属供应商或分类'
      ),
      (
        '00000000-0000-4000-8000-000000000186'::uuid,
        'product-categories:delete',
        '删除产品分类',
        '删除没有产品引用的分类或产品头；分类删除会级联删除其空产品头'
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

  IF actual_count <> 4 THEN
    RAISE EXCEPTION 'product taxonomy permission migration invariant mismatch: permission catalog';
  END IF;

  WITH expected_permission("id", "code") AS (
    VALUES
      ('00000000-0000-4000-8000-000000000183'::uuid, 'product-categories:read'),
      ('00000000-0000-4000-8000-000000000184'::uuid, 'product-categories:create'),
      ('00000000-0000-4000-8000-000000000185'::uuid, 'product-categories:update'),
      ('00000000-0000-4000-8000-000000000186'::uuid, 'product-categories:delete')
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

  IF actual_count <> 4 THEN
    RAISE EXCEPTION 'product taxonomy permission migration invariant mismatch: system admin grants';
  END IF;

  WITH expected_role AS (
    SELECT role."id"
    FROM "roles" AS role
    WHERE EXISTS (
      SELECT 1
      FROM "role_permissions" AS product_grant
      JOIN "permissions" AS product_permission
        ON product_permission."id" = product_grant."permission_id"
      WHERE product_grant."role_id" = role."id"
        AND product_permission."code" IN ('products:read', 'products:create', 'products:update')
    )
  )
  SELECT count(*)::integer
  INTO expected_count
  FROM expected_role;

  WITH expected_role AS (
    SELECT role."id"
    FROM "roles" AS role
    WHERE EXISTS (
      SELECT 1
      FROM "role_permissions" AS product_grant
      JOIN "permissions" AS product_permission
        ON product_permission."id" = product_grant."permission_id"
      WHERE product_grant."role_id" = role."id"
        AND product_permission."code" IN ('products:read', 'products:create', 'products:update')
    )
  )
  SELECT count(*)::integer
  INTO actual_count
  FROM expected_role AS expected
  JOIN "role_permissions" AS grant_entry
    ON grant_entry."role_id" = expected."id"
  JOIN "permissions" AS permission
    ON permission."id" = grant_entry."permission_id"
    AND permission."code" = 'product-categories:read';

  IF actual_count <> expected_count THEN
    RAISE EXCEPTION 'product taxonomy permission migration invariant mismatch: read grants';
  END IF;

  WITH expected_role AS (
    SELECT role."id"
    FROM "roles" AS role
    WHERE role."id" <> '00000000-0000-4000-8000-000000000001'
      AND EXISTS (
        SELECT 1
        FROM "role_permissions" AS product_grant
        JOIN "permissions" AS product_permission
          ON product_permission."id" = product_grant."permission_id"
        WHERE product_grant."role_id" = role."id"
          AND product_permission."code" IN ('products:create', 'products:update')
      )
  )
  SELECT count(*)::integer
  INTO expected_count
  FROM expected_role;

  WITH expected_role AS (
    SELECT role."id"
    FROM "roles" AS role
    WHERE role."id" <> '00000000-0000-4000-8000-000000000001'
      AND EXISTS (
        SELECT 1
        FROM "role_permissions" AS product_grant
        JOIN "permissions" AS product_permission
          ON product_permission."id" = product_grant."permission_id"
        WHERE product_grant."role_id" = role."id"
          AND product_permission."code" IN ('products:create', 'products:update')
      )
  )
  SELECT count(*)::integer
  INTO actual_count
  FROM expected_role AS expected
  JOIN "role_permissions" AS grant_entry
    ON grant_entry."role_id" = expected."id"
  JOIN "permissions" AS permission
    ON permission."id" = grant_entry."permission_id"
    AND permission."code" = 'product-categories:create';

  IF actual_count <> expected_count THEN
    RAISE EXCEPTION 'product taxonomy permission migration invariant mismatch: create grants';
  END IF;
END;
$$;

COMMIT;
