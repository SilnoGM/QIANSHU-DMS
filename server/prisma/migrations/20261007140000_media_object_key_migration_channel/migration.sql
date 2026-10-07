-- 存量对象键重命名的受控通道。
--
-- 背景：READY/TRASHED/PURGED 状态下 object_key 由 enforce_media_asset_invariants 保护为不可变，
-- 存量对象按新布局重命名时必须有一条受控通道。这里刻意不用「会话级自定义参数」当开关：会话参数
-- 不受对象权限体系保护，任何能连库的角色都能设置它，等于把守卫降级为约定。改用登记表后，
-- 「允许改键」变成事先登记、可复核、可审计的数据，并且对账与回滚读的是同一张表。
--
-- 生命周期：迁移与观察期结束后，必须由一条回收迁移同时「恢复严格不可变」并 DROP 本表；
-- 在那之前不要向它写入其它用途的映射。

-- CreateTable
CREATE TABLE "media_object_key_migrations" (
    "asset_id" UUID NOT NULL,
    "old_key" VARCHAR(512) NOT NULL,
    "new_key" VARCHAR(512) NOT NULL,
    "planned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMPTZ(6),

    CONSTRAINT "media_object_key_migrations_pkey" PRIMARY KEY ("asset_id")
);

-- AddForeignKey
ALTER TABLE "media_object_key_migrations" ADD CONSTRAINT "media_object_key_migrations_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- EnforceMediaAssetInvariants（受控键重写）
-- 文件系统与 PostgreSQL 不宣称原子；这里固定允许的状态边，并保护 READY 后的内容身份。
-- 与建表时版本的两处差异：
--   1. object_key 从不可变元组中移出，改由下面单独的分支裁决——它仍然不可自由改写，只能按
--      media_object_key_migrations 登记过的键对双向迁移（正向迁移、反向回滚）；
--   2. 其余 13 列保持原有不可变语义，约束名不变，便于既有断言与运维手册引用。
CREATE OR REPLACE FUNCTION "enforce_media_asset_invariants"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status"
    AND NOT (
      (OLD."status" = 'UPLOADING' AND NEW."status" IN ('READY', 'FAILED'))
      OR (OLD."status" = 'READY' AND NEW."status" = 'TRASHED')
      OR (OLD."status" = 'TRASHED' AND NEW."status" IN ('READY', 'PURGED'))
      OR (OLD."status" = 'FAILED' AND NEW."status" = 'PURGED')
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'media asset state transition is not allowed',
      CONSTRAINT = 'media_assets_state_transition_check';
  END IF;

  IF OLD."status" IN ('READY', 'TRASHED', 'PURGED')
    AND ROW(
      OLD."media_type",
      OLD."storage_driver",
      OLD."original_filename",
      OLD."mime_type",
      OLD."size_bytes",
      OLD."checksum_sha256",
      OLD."width",
      OLD."height",
      OLD."duration_ms",
      OLD."video_codec",
      OLD."audio_codec",
      OLD."created_by_user_id",
      OLD."created_at"
    ) IS DISTINCT FROM ROW(
      NEW."media_type",
      NEW."storage_driver",
      NEW."original_filename",
      NEW."mime_type",
      NEW."size_bytes",
      NEW."checksum_sha256",
      NEW."width",
      NEW."height",
      NEW."duration_ms",
      NEW."video_codec",
      NEW."audio_codec",
      NEW."created_by_user_id",
      NEW."created_at"
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'materialized media asset content identity is immutable',
      CONSTRAINT = 'media_assets_content_identity_immutable_check';
  END IF;

  IF OLD."status" IN ('READY', 'TRASHED', 'PURGED')
    AND NEW."object_key" IS DISTINCT FROM OLD."object_key"
    AND NOT EXISTS (
      SELECT 1
      FROM "media_object_key_migrations" AS migration
      WHERE migration."asset_id" = OLD."id"
        AND (
          (
            migration."old_key" = OLD."object_key"
            AND migration."new_key" = NEW."object_key"
          )
          OR (
            migration."old_key" = NEW."object_key"
            AND migration."new_key" = OLD."object_key"
          )
        )
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'media asset object key rewrite is not registered',
      CONSTRAINT = 'media_assets_object_key_rewrite_check';
  END IF;

  IF OLD."status" = 'READY'
    AND NEW."status" <> 'READY'
    AND EXISTS (
      SELECT 1
      FROM "product_media" AS reference
      WHERE reference."media_asset_id" = OLD."id"
        AND reference."detached_at" IS NULL
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'referenced media asset cannot leave READY',
      CONSTRAINT = 'media_assets_active_reference_check';
  END IF;

  RETURN NEW;
END;
$$;
