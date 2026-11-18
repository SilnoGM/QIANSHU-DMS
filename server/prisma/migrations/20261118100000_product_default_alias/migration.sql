-- 产品级默认别名：个人别名缺失时用于 SALES_LINKED 与 STOCK 货件唛头。
-- 只回填与产品名不同的 103 条；其余产品保持 NULL，运行时回退采购行产品名快照。
ALTER TABLE "products" ADD COLUMN "default_alias" VARCHAR(36);

ALTER TABLE "products"
  ADD CONSTRAINT "products_default_alias_check"
  CHECK (
    "default_alias" IS NULL
    OR (
      char_length("default_alias") BETWEEN 1 AND 36
      AND "default_alias" !~ '[[:cntrl:]]'
      AND position('×' in "default_alias") = 0
    )
  );

ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'PRODUCT_DEFAULT_ALIAS_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'PRODUCT_DEFAULT_ALIAS_CLEARED';

DO $$
DECLARE
  updated_rows integer;
BEGIN
  UPDATE "products" AS product
  SET "default_alias" = source.alias
  FROM (VALUES
    ('PROD/00086', '100旋耕机'),
    ('PROD/00087', '110旋耕机'),
    ('PROD/00088', '120旋耕机'),
    ('PROD/00089', '130旋耕机'),
    ('PROD/00090', '140旋耕机'),
    ('PROD/00091', '150旋耕机'),
    ('PROD/00092', '160旋耕机'),
    ('PROD/00093', '170旋耕机'),
    ('PROD/00094', '80旋耕机'),
    ('PROD/00095', '90旋耕机'),
    ('PROD/00100', '195加厚旋耕刀'),
    ('PROD/00108', '草莓开沟起垄机'),
    ('PROD/00109', '草莓开沟起垄机'),
    ('PROD/00106', '暴力开沟机'),
    ('PROD/00107', '暴力开沟机'),
    ('PROD/00111', '四轮25马力微耕机'),
    ('PROD/00112', '四轮35马力微耕机'),
    ('PROD/00113', '四轮40马力微耕机'),
    ('PROD/00114', '四轮50马力微耕机'),
    ('PROD/00115', '四轮常柴单缸50马力微耕机'),
    ('PROD/00116', '四轮常柴双缸50马力微耕机'),
    ('PROD/00117', '四轮洋马双缸50马力微耕机'),
    ('PROD/00118', '旱地25马力微耕机'),
    ('PROD/00119', '旱地35马力微耕机'),
    ('PROD/00120', '旱地40马力微耕机'),
    ('PROD/00121', '旱地50马力微耕机'),
    ('PROD/00122', '旱地常柴单缸50马力微耕机'),
    ('PROD/00123', '旱地常柴双缸50马力微耕机'),
    ('PROD/00124', '旱地洋马双缸50马力微耕机'),
    ('PROD/00125', '水旱25马力微耕机'),
    ('PROD/00126', '水旱35马力微耕机'),
    ('PROD/00127', '水旱40马力微耕机'),
    ('PROD/00128', '水旱50马力微耕机'),
    ('PROD/00129', '水旱常柴单缸50马力微耕机'),
    ('PROD/00130', '水旱常柴双缸50马力微耕机'),
    ('PROD/00131', '水旱洋马双缸50马力微耕机'),
    ('PROD/00133', '15钻头'),
    ('PROD/00134', '25钻头'),
    ('PROD/00135', '30钻头'),
    ('PROD/00136', '35钻头'),
    ('PROD/00137', '40钻头'),
    ('PROD/00138', '50钻头'),
    ('PROD/00139', '伸缩杆打药机（不带桶）'),
    ('PROD/00140', '伸缩杆打药机（带桶）'),
    ('PROD/00141', '风送式打药机（不带桶）'),
    ('PROD/00142', '风送式打药机（带桶）'),
    ('PROD/00005', '0号炉-三相220v60Hz'),
    ('PROD/00013', '0号炉-单相110v60Hz'),
    ('PROD/00021', '0号炉-单相220v60Hz'),
    ('PROD/00006', '1号炉-三相220v60Hz'),
    ('PROD/00014', '1号炉-单相110v60Hz'),
    ('PROD/00022', '1号炉-单相220v60Hz'),
    ('PROD/00007', '2号炉-三相220v60Hz'),
    ('PROD/00015', '2号炉-单相110v60Hz'),
    ('PROD/00023', '2号炉-单相220v60Hz'),
    ('PROD/00008', '3.5号炉单风机-三相220v60Hz'),
    ('PROD/00009', '3.5号炉双风机-三相220v60Hz'),
    ('PROD/00016', '3.5号炉单风机-单相110v60Hz'),
    ('PROD/00017', '3.5号炉双风机-单相110v60Hz'),
    ('PROD/00024', '3.5号炉单风机-单相220v60Hz'),
    ('PROD/00025', '3.5号炉双风机-单相220v60Hz'),
    ('PROD/00010', '3号炉-三相220v60Hz'),
    ('PROD/00018', '3号炉-单相110v60Hz'),
    ('PROD/00026', '3号炉-单相220v60Hz'),
    ('PROD/00011', '4号炉-三相220v60Hz'),
    ('PROD/00019', '4号炉-单相110v60Hz'),
    ('PROD/00027', '4号炉-单相220v60Hz'),
    ('PROD/00012', '5号炉-三相220v60Hz'),
    ('PROD/00020', '5号炉-单相110v60Hz'),
    ('PROD/00028', '5号炉-单相220v60Hz'),
    ('PROD/00160', '三圆盘犁'),
    ('PROD/00164', '加重款单铧犁'),
    ('PROD/00162', '双沟犁'),
    ('PROD/00163', '双铧犁'),
    ('PROD/00165', '标准款单铧犁'),
    ('PROD/00166', '简易款单铧犁'),
    ('PROD/00167', '普通覆膜机（不带药桶）'),
    ('PROD/00169', '滴灌带覆膜机（不带药桶）'),
    ('PROD/00168', '普通覆膜机（带药桶）'),
    ('PROD/00170', '滴灌带覆膜机（带药桶）'),
    ('PROD/00171', '起垄覆膜一体机（带药桶）'),
    ('PROD/00172', '高陇覆膜机（带药桶）'),
    ('PROD/00173', '100起垄器'),
    ('PROD/00174', '100起垄器（带挂钩）'),
    ('PROD/00185', '100起垄犁'),
    ('PROD/00175', '110起垄器'),
    ('PROD/00176', '110起垄器（带挂钩）'),
    ('PROD/00186', '110起垄犁'),
    ('PROD/00177', '120起垄器'),
    ('PROD/00178', '120起垄器（带挂钩）'),
    ('PROD/00187', '120起垄犁'),
    ('PROD/00179', '130起垄器'),
    ('PROD/00180', '130起垄器（带挂钩）'),
    ('PROD/00188', '130起垄犁'),
    ('PROD/00181', '140起垄器'),
    ('PROD/00182', '140起垄器（带挂钩）'),
    ('PROD/00189', '140起垄犁'),
    ('PROD/00183', '150起垄器'),
    ('PROD/00184', '150起垄器（带挂钩）'),
    ('PROD/00190', '150起垄犁'),
    ('PROD/00191', '100秸秆还田机'),
    ('PROD/00192', '120秸秆还田机'),
    ('PROD/00193', '80秸秆还田机')
  ) AS source(product_no, alias)
  WHERE product."product_no" = source.product_no;

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows <> 103 THEN
    RAISE EXCEPTION 'product default alias backfill expected 103 rows, updated %', updated_rows;
  END IF;
END
$$;
