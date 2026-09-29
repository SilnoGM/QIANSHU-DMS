-- 放宽「凭证不可改」：只给 slh_bill_lines 的收货人派生列开一个受控例外。
--
-- 背景：这三列（recipient_name / recipient_phones / recipient_address）是 recipient_info_raw 的
-- 派生视图，需要支持存量回填与规则迭代后的重算；其余任何列的变化、以及费用明细表的任何更新、
-- 两张表的删除，仍然一律拒绝（错误码与约束名保持不变，错误语义不变）。
CREATE OR REPLACE FUNCTION enforce_slh_bill_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'slh_bill_lines' THEN
    -- 用「去掉三列后的行快照」比较：将来给表加列时无需改动此处白名单。
    IF (to_jsonb(NEW) - 'recipient_name' - 'recipient_phones' - 'recipient_address')
       IS NOT DISTINCT FROM (to_jsonb(OLD) - 'recipient_name' - 'recipient_phones' - 'recipient_address') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'SLH bill evidence is immutable' USING ERRCODE = '23514', CONSTRAINT = 'slh_bill_evidence_immutable_check';
END $$;
