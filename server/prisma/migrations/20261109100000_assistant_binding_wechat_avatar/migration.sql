BEGIN;

-- 好友巡检按需刷新的微信头像快照；空值表示尚未成功同步，不是“无头像”的终态。
ALTER TABLE "assistant_bindings"
    ADD COLUMN "wechat_avatar_url" TEXT;

COMMIT;
