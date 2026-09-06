BEGIN;

-- 用途字段、历史回填和不可变保护在同一事务生效，失败时整体回滚。
-- 用途仅为规则分类，不进入版本配置、计数周期或派发身份。
CREATE TYPE "numbering_rule_purpose" AS ENUM ('BUSINESS', 'SHIPPING_MARK');

-- 临时默认只用于历史回填，避免触发规则 updated_at/版本更新；后续创建必须明确用途。
ALTER TABLE "numbering_rules"
  ADD COLUMN "purpose" "numbering_rule_purpose" NOT NULL DEFAULT 'BUSINESS';
ALTER TABLE "numbering_rules" ALTER COLUMN "purpose" DROP DEFAULT;

CREATE INDEX "numbering_rules_purpose_status_updated_id_idx"
  ON "numbering_rules" ("purpose", "status", "updated_at" DESC, "id" DESC);

-- 独立守卫保留既有身份与删除保护，不替换旧迁移的生命周期函数。
CREATE FUNCTION "enforce_numbering_rule_purpose_immutable"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."purpose" IS DISTINCT FROM OLD."purpose" THEN
    RAISE EXCEPTION 'Numbering rule purpose is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'numbering_rules_purpose_immutable_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "numbering_rules_purpose_immutable_trigger"
  BEFORE UPDATE OF "purpose" ON "numbering_rules"
  FOR EACH ROW EXECUTE FUNCTION "enforce_numbering_rule_purpose_immutable"();

COMMIT;
