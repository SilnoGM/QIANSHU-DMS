BEGIN;

-- 千树小助理全局发送闸门：所有 sendText 入口共用一行，串行发送并持久化最小间隔。
CREATE TABLE "assistant_send_gates" (
  "id" VARCHAR(64) NOT NULL,
  "next_allowed_at" TIMESTAMPTZ(6),
  "lock_owner" UUID,
  "lock_expires_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assistant_send_gates_pkey" PRIMARY KEY ("id")
);

INSERT INTO "assistant_send_gates" ("id")
VALUES ('assistant-send')
ON CONFLICT ("id") DO NOTHING;

COMMIT;
