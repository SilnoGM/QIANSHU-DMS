-- 货件列表/计数按状态与到仓、发货时间过滤，并支持目的地仓库筛选。
CREATE INDEX "purchase_order_parts_shipment_view_idx"
  ON "purchase_order_parts" ("status", "warehouse_received_at", "shipped_at");
CREATE INDEX "purchase_order_parts_destination_warehouse_idx"
  ON "purchase_order_parts" ("destination_warehouse_value");
