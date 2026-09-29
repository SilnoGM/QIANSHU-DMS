-- 放宽「凭证不可改」：给 slh_bill_lines 的对账时刻再开一个受控例外。
--
-- 背景：reconciled_at 是「对账状态」的来源列，账单对账功能需要按行写入对账时刻。
-- 与收货人三列同一做法：只有这一列（连同原有的三列）可以变化，其余任何列的变化、
-- 费用明细表的任何更新、两张表的删除仍然一律拒绝，错误码与约束名保持不变。
CREATE OR REPLACE FUNCTION enforce_slh_bill_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'slh_bill_lines' THEN
    -- 用「去掉白名单列后的行快照」比较：将来给表加列时无需改动此处白名单。
    IF (to_jsonb(NEW) - 'recipient_name' - 'recipient_phones' - 'recipient_address' - 'reconciled_at')
       IS NOT DISTINCT FROM (to_jsonb(OLD) - 'recipient_name' - 'recipient_phones' - 'recipient_address' - 'reconciled_at') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'SLH bill evidence is immutable' USING ERRCODE = '23514', CONSTRAINT = 'slh_bill_evidence_immutable_check';
END $$;
