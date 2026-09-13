BEGIN;

-- 历史申请保留空编号；此迁移不补号，也不创建或启用编号规则。
ALTER TABLE "sales_receipt_requests"
  ADD COLUMN "collection_no" VARCHAR(64),
  ADD COLUMN "numbering_issuance_id" UUID;
CREATE UNIQUE INDEX "sales_receipt_requests_collection_no_key" ON "sales_receipt_requests" ("collection_no");
CREATE UNIQUE INDEX "sales_receipt_requests_numbering_issuance_key" ON "sales_receipt_requests" ("numbering_issuance_id");
ALTER TABLE "sales_receipt_requests"
  ADD CONSTRAINT "sales_receipt_requests_numbering_issuance_id_fkey"
    FOREIGN KEY ("numbering_issuance_id") REFERENCES "numbering_issuances" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "sales_receipt_requests_numbering_pair_check"
    CHECK (("collection_no" IS NULL) = ("numbering_issuance_id" IS NULL));

CREATE FUNCTION "enforce_sales_receipt_collection_number"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- 只限制新建。历史双空记录仍可审核；既有 JSON 不可变守卫禁止改号或后补号。
  IF NEW.collection_no IS NULL OR NEW.numbering_issuance_id IS NULL THEN
    RAISE EXCEPTION 'New receipt requests require a collection number' USING ERRCODE = '23514', CONSTRAINT = 'sales_receipt_requests_numbering_required_check';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM numbering_issuances issuance JOIN numbering_rules rule ON rule.id = issuance.rule_id
    WHERE issuance.id = NEW.numbering_issuance_id AND issuance.generated_number = NEW.collection_no
      AND rule.rule_code = 'SALES_COLLECTION' AND issuance.consumer_code = 'SALES_COLLECTION.CREATE'
      AND issuance.request_fingerprint_hash = NEW.request_fingerprint_hash
  ) THEN
    RAISE EXCEPTION 'Receipt collection number must match its scoped issuance' USING ERRCODE = '23514', CONSTRAINT = 'sales_receipt_requests_numbering_identity_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "sales_receipt_requests_collection_number_trigger" BEFORE INSERT ON "sales_receipt_requests"
FOR EACH ROW EXECUTE FUNCTION "enforce_sales_receipt_collection_number"();

COMMIT;
