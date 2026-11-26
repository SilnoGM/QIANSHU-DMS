BEGIN;

-- 采购审核托管系统账号由 20261126130000 迁移插入，但当时未创建 user_profiles。
-- 用户管理列表要求每个用户都有 profile，缺失会在 /api/users 触发 500。
INSERT INTO "user_profiles" ("user_id", "created_at", "updated_at")
SELECT "id", "created_at", "updated_at"
FROM "users"
WHERE "id" = '00000000-0000-4000-8000-000000002449'
  AND "username_normalized" = 'purchase-review-automation'
  AND NOT EXISTS (
    SELECT 1
    FROM "user_profiles"
    WHERE "user_profiles"."user_id" = "users"."id"
  );

DO $$
DECLARE
  profile_count integer;
BEGIN
  SELECT count(*)::integer
  INTO profile_count
  FROM "user_profiles"
  WHERE "user_id" = '00000000-0000-4000-8000-000000002449';

  IF profile_count <> 1 THEN
    RAISE EXCEPTION 'purchase auto review migration invariant mismatch: automation profile';
  END IF;
END $$;

COMMIT;
