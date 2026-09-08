-- PostgreSQL 新枚举值必须先提交，默认值和权限在下一份 migration 设置。
ALTER TYPE "purchase_order_status" ADD VALUE 'PENDING_REVIEW';
