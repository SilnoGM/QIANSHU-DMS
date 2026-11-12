BEGIN;

-- 群目标头像快照；同步时来自 GeWe 群详情，空值表示尚未同步。
ALTER TABLE "assistant_targets"
    ADD COLUMN "avatar_url" TEXT;

COMMIT;
