BEGIN;

-- ExtendAuditEventType
-- 新值只供 migration 提交后的运行时代码使用，避免在同一 PostgreSQL 事务内提前引用。
ALTER TYPE "audit_event_type" ADD VALUE 'CURRENCY_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE 'CURRENCY_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE 'CURRENCY_ENABLED';
ALTER TYPE "audit_event_type" ADD VALUE 'CURRENCY_DISABLED';
ALTER TYPE "audit_event_type" ADD VALUE 'EXCHANGE_RATE_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE 'EXCHANGE_RATE_UPDATED';

-- CreateTable
CREATE TABLE "currencies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(3) NOT NULL,
  "name" VARCHAR(128) NOT NULL,
  "english_name" VARCHAR(128),
  "symbol" VARCHAR(16),
  "minor_unit" SMALLINT NOT NULL DEFAULT 2,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "currencies_code_format_check"
    CHECK ("code" ~ '^[A-Z]{3}$'),
  CONSTRAINT "currencies_name_nonblank_check"
    CHECK ("name" !~ '^[[:space:]]*$'),
  CONSTRAINT "currencies_english_name_nonblank_check"
    CHECK (
      "english_name" IS NULL
      OR "english_name" !~ '^[[:space:]]*$'
    ),
  CONSTRAINT "currencies_symbol_nonblank_check"
    CHECK (
      "symbol" IS NULL
      OR "symbol" !~ '^[[:space:]]*$'
    ),
  CONSTRAINT "currencies_minor_unit_range_check"
    CHECK ("minor_unit" BETWEEN 0 AND 4),
  CONSTRAINT "currencies_sort_order_nonnegative_check"
    CHECK ("sort_order" >= 0),
  CONSTRAINT "currencies_version_positive_check"
    CHECK ("version" >= 1),
  CONSTRAINT "currencies_cny_shape_check"
    CHECK (
      "code" <> 'CNY'
      OR (
        "enabled" = true
        AND "minor_unit" = 2
      )
    ),
  CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "currencies_code_key"
  ON "currencies" ("code");

CREATE INDEX "currencies_enabled_sort_order_code_id_idx"
  ON "currencies" (
    "enabled",
    "sort_order",
    "code",
    "id"
  );

-- CreateTable
CREATE TABLE "exchange_rates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "currency_id" UUID NOT NULL,
  "foreign_units_per_cny" NUMERIC(30, 12) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "exchange_rates_positive_check"
    CHECK ("foreign_units_per_cny" > 0),
  CONSTRAINT "exchange_rates_version_positive_check"
    CHECK ("version" >= 1),
  CONSTRAINT "exchange_rates_currency_not_cny_check"
    CHECK (
      "currency_id"
      <> '00000000-0000-4000-8000-000000001001'::uuid
    ),
  CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_currency_id_key"
  ON "exchange_rates" ("currency_id");

CREATE INDEX "exchange_rates_updated_at_id_idx"
  ON "exchange_rates" (
    "updated_at" DESC,
    "id" DESC
  );

-- AddForeignKey
ALTER TABLE "exchange_rates"
  ADD CONSTRAINT "exchange_rates_currency_id_fkey"
  FOREIGN KEY ("currency_id") REFERENCES "currencies" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

/**
 * Currency identity、固定 CNY 与“启用必须有当前汇率”由数据库作最终保护。
 *
 * Service 仍会先做同一规则的业务校验并返回可读错误；trigger 负责阻断并发写、
 * 直接 SQL 或未来实现遗漏造成的非法状态。汇率行使用 FOR KEY SHARE，防止启用
 * 检查与该行的并发删除交错。
 */
CREATE FUNCTION "enforce_currency_invariants"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  requires_exchange_rate BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."code" = 'CNY' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'CNY currency cannot be deleted',
        CONSTRAINT = 'currencies_cny_delete_check';
    END IF;

    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (
      NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."code" IS DISTINCT FROM OLD."code"
      OR NEW."minor_unit" IS DISTINCT FROM OLD."minor_unit"
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'currency identity is immutable',
        CONSTRAINT = 'currencies_identity_immutable_check';
    END IF;

    requires_exchange_rate :=
      NEW."enabled"
      AND NEW."code" <> 'CNY'
      AND NEW."enabled" IS DISTINCT FROM OLD."enabled";
  ELSE
    requires_exchange_rate :=
      NEW."enabled"
      AND NEW."code" <> 'CNY';
  END IF;

  IF requires_exchange_rate THEN
    PERFORM "id"
    FROM "exchange_rates"
    WHERE "currency_id" = NEW."id"
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'enabled foreign currency requires an exchange rate',
        CONSTRAINT = 'currencies_exchange_rate_required_check';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "currencies_invariants_trigger"
BEFORE INSERT OR UPDATE OF "id", "code", "minor_unit", "enabled" OR DELETE
ON "currencies"
FOR EACH ROW
EXECUTE FUNCTION "enforce_currency_invariants"();

/**
 * ExchangeRate 的货币归属创建后不可迁移；启用货币的当前汇率也不能被直接 SQL
 * 删除。正式 V1 不提供删除 API，该边界仍用于防止运维或后续代码破坏领域不变量。
 */
CREATE FUNCTION "enforce_exchange_rate_invariants"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (
      NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."currency_id" IS DISTINCT FROM OLD."currency_id"
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'exchange rate identity is immutable',
        CONSTRAINT = 'exchange_rates_identity_immutable_check';
    END IF;

    RETURN NEW;
  END IF;

  PERFORM "id"
  FROM "currencies"
  WHERE "id" = OLD."currency_id"
    AND "enabled" = true
  FOR KEY SHARE;

  IF FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'enabled currency exchange rate cannot be deleted',
      CONSTRAINT = 'exchange_rates_enabled_currency_guard_check';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER "exchange_rates_invariants_trigger"
BEFORE UPDATE OF "id", "currency_id" OR DELETE
ON "exchange_rates"
FOR EACH ROW
EXECUTE FUNCTION "enforce_exchange_rate_invariants"();

-- Seed the assignable Currency and ExchangeRate permission catalog with stable identifiers.
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES
  (
    '00000000-0000-4000-8000-000000000118',
    'currencies:read',
    '查询货币',
    '查询货币目录与货币管理列表',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000119',
    'currencies:create',
    '创建货币',
    '创建默认停用的货币主数据',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000120',
    'currencies:update',
    '编辑货币',
    '编辑货币展示信息与排序',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000121',
    'currencies:enable',
    '启用货币',
    '启用已有当前汇率的非人民币货币',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000122',
    'currencies:disable',
    '停用货币',
    '停用非人民币货币并保留当前汇率',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000123',
    'exchange-rates:read',
    '查询当前汇率',
    '查询非人民币货币及当前汇率',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000124',
    'exchange-rates:create',
    '创建当前汇率',
    '为非人民币货币配置当前汇率',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000125',
    'exchange-rates:update',
    '编辑当前汇率',
    '更新非人民币货币的唯一当前汇率',
    false
  );

-- 普通业务权限不会被历史 system_only grant 自动覆盖，因此必须显式授予内置管理员。
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT
  '00000000-0000-4000-8000-000000000001',
  "id"
FROM "permissions"
WHERE "code" IN (
  'currencies:read',
  'currencies:create',
  'currencies:update',
  'currencies:enable',
  'currencies:disable',
  'exchange-rates:read',
  'exchange-rates:create',
  'exchange-rates:update'
);

COMMIT;
