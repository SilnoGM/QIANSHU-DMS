BEGIN;

-- 三个首批站内事件补业务详情标识：仅追加变量，保留已有模板正文与自定义链接。
UPDATE notification_templates
SET variables = CASE
        WHEN variables @> '[{"name":"orderId"}]'::jsonb THEN variables
        ELSE variables || $json$[{"name":"orderId","required":false,"maxLength":64,"sensitive":false}]$json$::jsonb
    END,
    link_url_template = COALESCE(
        NULLIF(link_url_template, ''),
        '/qs-operations/purchase/purchase-orders?id={{orderId}}'
    ),
    version = version + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'purchase.review.pending' AND channel = 'IN_APP';

UPDATE notification_templates
SET variables = CASE
        WHEN variables @> '[{"name":"invoiceRequestId"}]'::jsonb THEN variables
        ELSE variables || $json$[{"name":"invoiceRequestId","required":false,"maxLength":64,"sensitive":false}]$json$::jsonb
    END,
    link_url_template = COALESCE(
        NULLIF(link_url_template, ''),
        '/qs-operations/invoices/records?id={{invoiceRequestId}}'
    ),
    version = version + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'invoice.review.pending' AND channel = 'IN_APP';

UPDATE notification_templates
SET variables = CASE
        WHEN variables @> '[{"name":"orderId"}]'::jsonb THEN variables
        ELSE variables || $json$[{"name":"orderId","required":false,"maxLength":64,"sensitive":false}]$json$::jsonb
    END,
    link_url_template = COALESCE(
        NULLIF(link_url_template, ''),
        '/qs-operations/warehouse-transport/warehouse-arrivals?orderId={{orderId}}'
    ),
    version = version + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'shipment.arrived' AND channel = 'IN_APP';

COMMIT;
