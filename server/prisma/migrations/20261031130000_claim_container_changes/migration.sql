-- 对照装柜明细记录申请时的修改前后值、期望版本；历史申请保持 NULL 并要求重提。
ALTER TABLE "shipment_storage_claim_requests"
  ADD COLUMN "container_changes" JSONB;
