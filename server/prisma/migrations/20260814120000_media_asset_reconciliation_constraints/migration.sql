BEGIN;

-- 超期上传可能在可信内容元数据写入前中断。此时 PURGED 必须保留真实生命周期事实，
-- 但不能为从未物化的内容伪造 objectKey、MIME、size、checksum 或类型元数据。
ALTER TABLE "media_assets"
  DROP CONSTRAINT "media_assets_state_metadata_check",
  DROP CONSTRAINT "media_assets_type_metadata_check";

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_state_metadata_check"
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
      AND "deleted_at" IS NOT NULL
      AND "upload_expires_at" IS NULL
      AND "retention_until" IS NULL
      AND (
        (
          "object_key" IS NOT NULL
          AND "mime_type" IS NOT NULL
          AND "size_bytes" IS NOT NULL
          AND "checksum_sha256" IS NOT NULL
        )
        OR (
          "failure_code" IS NOT NULL
          AND "object_key" IS NULL
          AND "mime_type" IS NULL
          AND "size_bytes" IS NULL
          AND "checksum_sha256" IS NULL
          AND "width" IS NULL
          AND "height" IS NULL
          AND "duration_ms" IS NULL
          AND "video_codec" IS NULL
          AND "audio_codec" IS NULL
        )
      )
    )
  ),
  ADD CONSTRAINT "media_assets_type_metadata_check"
  CHECK (
    (
      "media_type" = 'IMAGE'
      AND "duration_ms" IS NULL
      AND "video_codec" IS NULL
      AND "audio_codec" IS NULL
      AND (
        "status" NOT IN ('READY', 'TRASHED', 'PURGED')
        OR ("status" = 'PURGED' AND "object_key" IS NULL)
        OR ("width" IS NOT NULL AND "height" IS NOT NULL)
      )
    )
    OR (
      "media_type" = 'VIDEO'
      AND (
        "status" NOT IN ('READY', 'TRASHED', 'PURGED')
        OR ("status" = 'PURGED' AND "object_key" IS NULL)
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
  );

COMMIT;
