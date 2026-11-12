BEGIN;

CREATE TYPE "notification_template_domain" AS ENUM (
  'SALES',
  'PURCHASE',
  'SHIPMENT',
  'FINANCE',
  'INVOICE',
  'RECONCILIATION',
  'SYSTEM'
);

ALTER TABLE "notification_templates"
    ADD COLUMN "domain" "notification_template_domain" NOT NULL DEFAULT 'SYSTEM';

-- 按既有模板键前缀回填；付款类模板统一归财务域，其余无法识别的模板保留系统域。
UPDATE "notification_templates"
SET "domain" = CASE
  WHEN "key" LIKE 'sales.%' THEN 'SALES'::"notification_template_domain"
  WHEN "key" LIKE 'purchase.%' AND ("key" LIKE '%payable%' OR "key" LIKE '%payment%') THEN 'FINANCE'::"notification_template_domain"
  WHEN "key" LIKE 'purchase.%' THEN 'PURCHASE'::"notification_template_domain"
  WHEN "key" LIKE 'invoice.%' THEN 'INVOICE'::"notification_template_domain"
  WHEN "key" LIKE 'shipment.%' THEN 'SHIPMENT'::"notification_template_domain"
  WHEN "key" LIKE 'reconciliation.%' OR "key" LIKE 'slh.%' THEN 'RECONCILIATION'::"notification_template_domain"
  WHEN "key" LIKE 'fund.%' OR "key" LIKE 'withdrawal.%' OR "key" LIKE 'payment.%' OR "key" LIKE 'packaging.%' THEN 'FINANCE'::"notification_template_domain"
  ELSE 'SYSTEM'::"notification_template_domain"
END;

CREATE INDEX "notification_templates_domain_enabled_idx"
    ON "notification_templates"("domain", "enabled");

COMMIT;
