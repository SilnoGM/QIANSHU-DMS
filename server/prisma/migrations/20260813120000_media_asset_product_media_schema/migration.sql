BEGIN;

-- CreateMediaEnums
-- ProductMediaKind 故意不包含 DOCUMENT；数据库 Trigger 会把该枚举与 MediaAsset.media_type 再次比对。
CREATE TYPE "media_type" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');
CREATE TYPE "media_asset_status" AS ENUM ('UPLOADING', 'READY', 'FAILED', 'TRASHED', 'PURGED');
CREATE TYPE "product_media_kind" AS ENUM ('IMAGE', 'VIDEO');

-- CreateMediaAssets
-- UPLOADING/FAILED 允许尚未生成的可信内容字段为 NULL；可读或已归档状态必须完整保留内容身份。
CREATE TABLE "media_assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "media_type" "media_type" NOT NULL,
  "status" "media_asset_status" NOT NULL DEFAULT 'UPLOADING',
  "storage_driver" VARCHAR(32) NOT NULL DEFAULT 'local',
  "object_key" VARCHAR(512),
  "original_filename" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(127),
  "size_bytes" BIGINT,
  "checksum_sha256" CHAR(64),
  "width" INTEGER,
  "height" INTEGER,
  "duration_ms" INTEGER,
  "video_codec" VARCHAR(32),
  "audio_codec" VARCHAR(32),
  "upload_expires_at" TIMESTAMPTZ(6),
  "retention_until" TIMESTAMPTZ(6),
  "failure_code" VARCHAR(64),
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_assets_object_key_key" UNIQUE ("object_key"),
  CONSTRAINT "media_assets_storage_driver_check"
    CHECK ("storage_driver" = 'local'),
  CONSTRAINT "media_assets_size_bytes_nonnegative_check"
    CHECK ("size_bytes" IS NULL OR "size_bytes" >= 0),
  CONSTRAINT "media_assets_dimensions_positive_check"
    CHECK (
      ("width" IS NULL OR "width" > 0)
      AND ("height" IS NULL OR "height" > 0)
    ),
  CONSTRAINT "media_assets_duration_positive_check"
    CHECK ("duration_ms" IS NULL OR "duration_ms" > 0),
  CONSTRAINT "media_assets_checksum_sha256_check"
    CHECK (
      "checksum_sha256" IS NULL
      OR "checksum_sha256" ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT "media_assets_object_key_check"
    CHECK (
      "object_key" IS NULL
      OR (
        "object_key" <> ''
        AND "object_key" ~ '^[A-Za-z0-9._/-]+$'
        AND "object_key" !~ E'(^/|\\\\|//|(^|/)\\.\\.?(/|$))'
      )
    ),
  CONSTRAINT "media_assets_state_metadata_check"
    CHECK (
      (
        "status" = 'UPLOADING'
        AND "upload_expires_at" IS NOT NULL
        AND "deleted_at" IS NULL
        AND "retention_until" IS NULL
      )
      OR (
        "status" = 'FAILED'
        AND "failure_code" IS NOT NULL
        AND "deleted_at" IS NULL
        AND "retention_until" IS NULL
      )
      OR (
        "status" = 'READY'
        AND "object_key" IS NOT NULL
        AND "mime_type" IS NOT NULL
        AND "size_bytes" IS NOT NULL
        AND "checksum_sha256" IS NOT NULL
        AND "deleted_at" IS NULL
        AND "retention_until" IS NULL
      )
      OR (
        "status" = 'TRASHED'
        AND "object_key" IS NOT NULL
        AND "mime_type" IS NOT NULL
        AND "size_bytes" IS NOT NULL
        AND "checksum_sha256" IS NOT NULL
        AND "deleted_at" IS NOT NULL
        AND "retention_until" IS NOT NULL
      )
      OR (
        "status" = 'PURGED'
        AND "object_key" IS NOT NULL
        AND "mime_type" IS NOT NULL
        AND "size_bytes" IS NOT NULL
        AND "checksum_sha256" IS NOT NULL
        AND "deleted_at" IS NOT NULL
      )
    ),
  CONSTRAINT "media_assets_type_metadata_check"
    CHECK (
      (
        "media_type" = 'IMAGE'
        AND "duration_ms" IS NULL
        AND "video_codec" IS NULL
        AND "audio_codec" IS NULL
        AND (
          "status" NOT IN ('READY', 'TRASHED', 'PURGED')
          OR ("width" IS NOT NULL AND "height" IS NOT NULL)
        )
      )
      OR (
        "media_type" = 'VIDEO'
        AND (
          "status" NOT IN ('READY', 'TRASHED', 'PURGED')
          OR (
            "width" IS NOT NULL
            AND "height" IS NOT NULL
            AND "duration_ms" IS NOT NULL
            AND "video_codec" IS NOT NULL
          )
        )
      )
      OR (
        "media_type" = 'DOCUMENT'
        AND "width" IS NULL
        AND "height" IS NULL
        AND "duration_ms" IS NULL
        AND "video_codec" IS NULL
        AND "audio_codec" IS NULL
      )
    ),
  CONSTRAINT "media_assets_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

-- CreateProductMedia
-- 解除关联只更新 detached actor/time，不删除历史行；三个 partial unique 只约束有效关联。
CREATE TABLE "product_media" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product_id" UUID NOT NULL,
  "media_asset_id" UUID NOT NULL,
  "kind" "product_media_kind" NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_by_user_id" UUID NOT NULL,
  "detached_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "detached_at" TIMESTAMPTZ(6),

  CONSTRAINT "product_media_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_media_sort_order_nonnegative_check"
    CHECK ("sort_order" >= 0),
  CONSTRAINT "product_media_primary_image_check"
    CHECK (NOT "is_primary" OR "kind" = 'IMAGE'),
  CONSTRAINT "product_media_detachment_pair_check"
    CHECK (
      ("detached_at" IS NULL AND "detached_by_user_id" IS NULL)
      OR ("detached_at" IS NOT NULL AND "detached_by_user_id" IS NOT NULL)
    ),
  CONSTRAINT "product_media_product_id_fkey"
    FOREIGN KEY ("product_id")
    REFERENCES "products"("id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  CONSTRAINT "product_media_media_asset_id_fkey"
    FOREIGN KEY ("media_asset_id")
    REFERENCES "media_assets"("id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  CONSTRAINT "product_media_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  CONSTRAINT "product_media_detached_by_user_id_fkey"
    FOREIGN KEY ("detached_by_user_id")
    REFERENCES "users"("id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

-- CreateMediaIndexes
CREATE INDEX "media_assets_status_upload_expires_at_id_idx"
  ON "media_assets" ("status", "upload_expires_at", "id");
CREATE INDEX "media_assets_status_retention_until_id_idx"
  ON "media_assets" ("status", "retention_until", "id");

CREATE UNIQUE INDEX "product_media_active_product_asset_key"
  ON "product_media" ("product_id", "media_asset_id")
  WHERE "detached_at" IS NULL;
CREATE UNIQUE INDEX "product_media_active_product_kind_sort_order_key"
  ON "product_media" ("product_id", "kind", "sort_order")
  WHERE "detached_at" IS NULL;
CREATE UNIQUE INDEX "product_media_active_product_primary_key"
  ON "product_media" ("product_id")
  WHERE "is_primary" = true AND "detached_at" IS NULL;
CREATE INDEX "product_media_active_product_kind_sort_order_id_idx"
  ON "product_media" ("product_id", "kind", "sort_order", "id")
  WHERE "detached_at" IS NULL;
CREATE INDEX "product_media_active_media_asset_id_idx"
  ON "product_media" ("media_asset_id")
  WHERE "detached_at" IS NULL;

-- EnforceMediaAssetInvariants
-- 文件系统与 PostgreSQL 不宣称原子；这里固定允许的状态边，并保护 READY 后的内容身份。
CREATE FUNCTION "enforce_media_asset_invariants"()
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
      OLD."object_key",
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
      NEW."object_key",
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

CREATE TRIGGER "media_assets_invariants_trigger"
BEFORE UPDATE ON "media_assets"
FOR EACH ROW
EXECUTE FUNCTION "enforce_media_asset_invariants"();

-- EnforceProductMediaInvariants
-- 关联身份不可改写；排序、主图和软解除字段由后续领域服务在锁定 Product 后更新。
CREATE FUNCTION "enforce_product_media_invariants"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'product media rows must be detached instead of deleted',
      CONSTRAINT = 'product_media_soft_detach_check';
  END IF;

  IF ROW(
    OLD."id",
    OLD."product_id",
    OLD."media_asset_id",
    OLD."kind",
    OLD."created_by_user_id",
    OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id",
    NEW."product_id",
    NEW."media_asset_id",
    NEW."kind",
    NEW."created_by_user_id",
    NEW."created_at"
  )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'product media association identity is immutable',
      CONSTRAINT = 'product_media_identity_immutable_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "product_media_invariants_trigger"
BEFORE UPDATE OR DELETE ON "product_media"
FOR EACH ROW
EXECUTE FUNCTION "enforce_product_media_invariants"();

-- EnforceProductMediaAssetReference
-- 对有效关联锁定资产行，使并发的关联创建与 READY 转出无法互相穿透。
CREATE FUNCTION "enforce_product_media_asset_reference"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  asset_status "media_asset_status";
  asset_media_type "media_type";
BEGIN
  IF NEW."detached_at" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT asset."status", asset."media_type"
  INTO asset_status, asset_media_type
  FROM "media_assets" AS asset
  WHERE asset."id" = NEW."media_asset_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'product media asset does not exist',
      CONSTRAINT = 'product_media_media_asset_id_fkey';
  END IF;

  IF asset_status <> 'READY' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'product media asset is not READY',
      CONSTRAINT = 'product_media_asset_ready_check';
  END IF;

  IF NEW."kind"::text <> asset_media_type::text THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'product media kind does not match media asset type',
      CONSTRAINT = 'product_media_asset_type_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "product_media_asset_reference_trigger"
AFTER INSERT OR UPDATE ON "product_media"
NOT DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION "enforce_product_media_asset_reference"();

-- EnforceReadyMediaAssetReference
-- 约束在事务提交时读取当前状态；未来新增领域关联表时，必须在此处显式追加 EXISTS 分支。
CREATE FUNCTION "enforce_ready_media_asset_reference"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  reference_asset_id UUID;
  current_status "media_asset_status";
BEGIN
  IF TG_TABLE_NAME = 'media_assets' THEN
    reference_asset_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    reference_asset_id := OLD."media_asset_id";
  ELSE
    reference_asset_id := NEW."media_asset_id";
  END IF;

  SELECT asset."status"
  INTO current_status
  FROM "media_assets" AS asset
  WHERE asset."id" = reference_asset_id;

  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF current_status = 'READY'
    AND NOT EXISTS (
      SELECT 1
      FROM "product_media" AS reference
      WHERE reference."media_asset_id" = reference_asset_id
        AND reference."detached_at" IS NULL
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'READY media asset requires an active domain reference',
      CONSTRAINT = 'media_assets_ready_reference_check';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER "media_assets_ready_reference_trigger"
AFTER INSERT OR UPDATE ON "media_assets"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_ready_media_asset_reference"();

CREATE CONSTRAINT TRIGGER "product_media_ready_reference_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "product_media"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_ready_media_asset_reference"();

-- SeedProductMediaReadPermission
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES (
  '00000000-0000-4000-8000-000000000146',
  'product-media:read',
  '读取产品媒体',
  '读取产品图片和视频内容',
  false
);

-- GrantSystemAdministratorProductMediaReadPermission
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."id" = '00000000-0000-4000-8000-000000000146'
  AND permission."code" = 'product-media:read';

-- MigrationSelfCheck
-- 权限目录和管理员授权必须在同一事务内精确成立，避免 seed 漂移时静默提交半完成 Schema。
DO $$
DECLARE
  actual_count INTEGER;
BEGIN
  SELECT count(*)::integer
  INTO actual_count
  FROM "permissions"
  WHERE "id" = '00000000-0000-4000-8000-000000000146'
    AND "code" = 'product-media:read'
    AND "name" = '读取产品媒体'
    AND "description" = '读取产品图片和视频内容'
    AND "system_only" = false;

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'media schema migration invariant mismatch: permission catalog';
  END IF;

  SELECT count(*)::integer
  INTO actual_count
  FROM "role_permissions" AS grant_entry
  JOIN "roles" AS role
    ON role."id" = grant_entry."role_id"
  JOIN "permissions" AS permission
    ON permission."id" = grant_entry."permission_id"
  WHERE role."id" = '00000000-0000-4000-8000-000000000001'
    AND role."code" = 'system_admin'
    AND permission."id" = '00000000-0000-4000-8000-000000000146'
    AND permission."code" = 'product-media:read';

  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'media schema migration invariant mismatch: system admin grant';
  END IF;
END;
$$;

COMMIT;
