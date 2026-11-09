BEGIN;

-- 管理端测试消息的服务端冷却基准；记录最近一次发起发送的时间，上游失败也计入冷却。
ALTER TABLE "assistant_bindings"
    ADD COLUMN "last_test_sent_at" TIMESTAMPTZ(6);

COMMIT;
