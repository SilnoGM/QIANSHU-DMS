-- 账单导入写入审计事件：外部凭证入库是需要留痕的资金相关动作。
ALTER TYPE "audit_event_type" ADD VALUE 'SLH_BILL_IMPORTED';
