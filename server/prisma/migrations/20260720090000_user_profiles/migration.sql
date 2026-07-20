-- CreateTable
CREATE TABLE "user_profiles" (
  "user_id" UUID NOT NULL,
  "email" VARCHAR(254),
  "email_normalized" VARCHAR(254),
  "mobile_e164" VARCHAR(16),
  "avatar_url" VARCHAR(2048),
  "remark" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_profiles_email_pair_check"
    CHECK (
      ("email" IS NULL AND "email_normalized" IS NULL)
      OR
      ("email" IS NOT NULL AND "email_normalized" IS NOT NULL)
    ),
  CONSTRAINT "user_profiles_mobile_e164_check"
    CHECK (
      "mobile_e164" IS NULL
      OR "mobile_e164" ~ E'^\\+[1-9][0-9]{7,14}$'
    ),
  CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- 在应用开始依赖一对一关系前，为全部历史 User 回填空 Profile。
INSERT INTO "user_profiles" (
  "user_id",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "users";

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_email_normalized_key"
  ON "user_profiles" ("email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_mobile_e164_key"
  ON "user_profiles" ("mobile_e164");

-- AddForeignKey
ALTER TABLE "user_profiles"
  ADD CONSTRAINT "user_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
