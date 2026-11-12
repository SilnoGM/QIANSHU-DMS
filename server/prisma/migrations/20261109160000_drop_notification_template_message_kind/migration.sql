-- 合并文本与链接类型：模板正文始终按文本渲染，link_url_template 变为可选字段。
-- 只删除冗余的类型判别列，保留已配置的 link_url_template 数据。
ALTER TABLE "notification_templates" DROP CONSTRAINT "notification_templates_link_url_check";

ALTER TABLE "notification_templates" DROP COLUMN "message_kind";

DROP TYPE "notification_template_kind";
