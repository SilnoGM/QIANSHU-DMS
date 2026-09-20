-- 基于隔离开发库 migrate dev 生成；只保留本次明细变更与撤销的数据结构。
BEGIN;

CREATE TYPE "container_loading_item_change_kind" AS ENUM ('RECIPIENT', 'COD');
CREATE TABLE "container_loading_item_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "loading_item_id" UUID NOT NULL,
    "kind" "container_loading_item_change_kind" NOT NULL,
    "before_data" JSONB NOT NULL,
    "after_data" JSONB NOT NULL,
    "previous_version" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "reverses_change_id" UUID,
    "request_key" UUID NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "container_loading_item_changes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "container_loading_item_changes_reverses_key" ON "container_loading_item_changes"("reverses_change_id");
CREATE INDEX "container_loading_item_changes_item_created_idx" ON "container_loading_item_changes"("loading_item_id", "created_at");
CREATE UNIQUE INDEX "container_loading_item_changes_actor_request_key" ON "container_loading_item_changes"("actor_user_id", "request_key");
ALTER TABLE "container_loading_item_changes" ADD CONSTRAINT "container_loading_item_changes_loading_item_id_fkey" FOREIGN KEY ("loading_item_id") REFERENCES "container_loading_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "container_loading_item_changes" ADD CONSTRAINT "container_loading_item_changes_reverses_change_id_fkey" FOREIGN KEY ("reverses_change_id") REFERENCES "container_loading_item_changes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "container_loading_item_changes" ADD CONSTRAINT "container_loading_item_changes_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE container_loading_item_changes ADD CONSTRAINT container_loading_item_changes_versions_check
  CHECK (previous_version > 0 AND version = previous_version + 1);
ALTER TABLE container_loading_item_changes ADD CONSTRAINT container_loading_item_changes_payload_check
  CHECK (payload_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(before_data) = 'object' AND jsonb_typeof(after_data) = 'object' AND before_data <> after_data);

-- 修改和撤销都追加记录；历史内容不允许改写或物理删除。
CREATE FUNCTION prevent_container_loading_item_change_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Loading item change records are immutable' USING ERRCODE = '23514', CONSTRAINT = 'container_loading_item_changes_immutable_check';
END $$;
CREATE TRIGGER container_loading_item_changes_immutable_trigger BEFORE UPDATE OR DELETE ON container_loading_item_changes
FOR EACH ROW EXECUTE FUNCTION prevent_container_loading_item_change_mutation();

-- 首版仅支持原操作人撤销原修改，不支持撤销逆向记录或跨明细恢复快照。
CREATE FUNCTION enforce_container_loading_item_change_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reverses_change_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM container_loading_item_changes original
    WHERE original.id = NEW.reverses_change_id AND original.reverses_change_id IS NULL
      AND original.loading_item_id = NEW.loading_item_id AND original.actor_user_id = NEW.actor_user_id
      AND original.kind = NEW.kind AND original.version = NEW.previous_version
      AND original.after_data = NEW.before_data AND original.before_data = NEW.after_data
  ) THEN
    RAISE EXCEPTION 'Loading item change reversal is invalid' USING ERRCODE = '23514', CONSTRAINT = 'container_loading_item_changes_reversal_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER container_loading_item_changes_reversal_trigger BEFORE INSERT ON container_loading_item_changes
FOR EACH ROW EXECUTE FUNCTION enforce_container_loading_item_change_reversal();

COMMIT;
