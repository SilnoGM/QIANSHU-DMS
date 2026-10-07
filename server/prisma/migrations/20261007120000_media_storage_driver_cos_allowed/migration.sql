-- 媒体存储驱动不再局限于首期唯一值 local：接入 COS 后，数据库侧的枚举必须与代码允许的驱动
-- 保持一致，否则 cos 模式的上传会在此处被拒绝（运行期 23514 / 500）。
-- 只放松枚举范围，不改变列类型、默认值或任何既有数据；不可变触发器保持原样。
ALTER TABLE "media_assets"
  DROP CONSTRAINT "media_assets_storage_driver_check";

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_storage_driver_check"
  CHECK ("storage_driver" IN ('local', 'cos'));
