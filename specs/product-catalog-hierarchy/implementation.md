# 产品分类与产品头改造：实施与验证记录

## 1. 已确认口径

| 项 | 决定 |
| --- | --- |
| 新产品的分类/产品头 | 必填 |
| 产品头隶属 | 产品头下拉按当前分类过滤；同名产品头允许跨分类存在，分组使用 `(分类, 产品头)` 复合键 |
| 存量处理 | 留空补录；迁移不回填，UI 显示「未分类 / 未填写产品头」 |
| 选品入口范围 | 销售创建、销售编辑、采购创建统一改造 |
| 分类数量 | 保留，由服务端 facet `groupBy` 返回 |
| 弹窗尺寸 | `QsGenericModal size="2xl"`，删除私有宽度覆盖 |
| 产品列表 | 新增分类/产品头列与筛选项 |
| 选项接口权限 | `products:read`；create-only 账号降级为自由输入 |

## 2. 提交

- `b179358e` `docs: 勘察产品分类与产品头改造方案并交付弹窗原型`
- `09276d9f` `feat: 新增产品分类与产品头及选品分类分组`

未 push、未创建 PR、未合并。

## 3. 实际改动

### 数据库

- 新迁移 `server/prisma/migrations/20261018100000_product_category_head/`：
  - `products.category_name varchar(64) NULL`
  - `products.product_head_name varchar(64) NULL`
  - 非空白 CHECK ×2
  - `products_taxonomy_pair_check`：两列同时为空或同时有值
  - `products_category_head_name_idx`
- 纯 additive；存量产品两列保持 `NULL`。
- 已登记到 `docs/后端文档/数据库迁移规范.md`（107 条）。

### 后端

- Product 创建/编辑/查询响应增加 `categoryName`、`productHeadName`。
- 新增 `GET /api/products/taxonomy-options`（`products:read`），返回分类及产品头去重列表。
- 产品列表支持 `categoryName` / `productHeadName` 精确筛选。
- 三条选品接口（销售创建、销售编辑、采购创建）：
  - item 增加分类/产品头；
  - 支持 `categoryName` / `unclassified`（互斥）；
  - 返回 `categories: [{ name, count }]` 与 `unclassifiedCount`；
  - 排序改为分类/产品头/名称/ID，保证分组连续。
- 创建指纹升级为 `product.create.v2`；创建服务防御性校验分类/产品头非空。
- 所有查询走 Prisma `where` / `groupBy`，没有拼接 SQL。

### 前端

- 新增 `ProductTaxonomySelect`：下拉 + 「新建」内联输入；新值只进入表单，随产品保存落库。
- 新增/编辑产品表单增加分类、产品头字段；产品头按分类级联；编辑历史产品允许两列都空。
- 产品列表增加分类/产品头列与筛选；详情抽屉增加「分类与产品头」区块。
- `QsProductSelector`：
  - `2xl` 三列布局（分类列 + 产品区 + 已选面板）；
  - 分类 facet 与计数；
  - `(分类, 产品头)` 分组；
  - 主图独立按钮，调用 `useFaImagePreview()` 打开原图，不触发选择；
  - 信息区按钮负责选择/加量，`FaPopover` 仍锚定信息区按钮；
  - 三个 loader 同步返回分类 facet。
- 组件库 fixture 增加分类/产品头与未分类样本。

## 4. 验证结果

已执行：

- `pnpm -C web run check`：通过（1803 个测试、typecheck、ESLint、Stylelint）。
- `pnpm -C server test --runInBand`：通过（3982 个测试）。
- `pnpm -C server typecheck`、`pnpm -C server lint`：通过。
- `SHADOW_DATABASE_URL=... pnpm -C server prisma:drift:check`：`No difference detected`。
- `node --run contract:check`：通过。
- 隔离 PostgreSQL 全量 e2e：产品相关 `product-create-api`、`product-list-api`、`product-view-update-api`、`product-media-*`、`product-schema` 全部通过。
- 开发库迁移：已应用 `20261018100000_product_category_head`，存量 `PROD/00001` 两列仍为 `NULL`。
- 数据库备份：`~/qianshu-db-backups/qianshu_dms_dev_pre_product_category_head_20261018T021055Z.dump`（`pg_restore -l` 906 条 TOC，可读）。
- 浏览器实测：
  - 产品列表显示分类/产品头列与四个筛选项；
  - 新增页可新建分类并级联新建产品头；
  - 编辑历史产品显示「请选择分类/产品头」，产品头在未选分类时禁用；
  - 选品弹窗三列、分类计数（全部/配件/收纳包/未分类）、产品头分组、图片放大、加量气泡均正常。

未执行/未覆盖：

- `pnpm -C server check` 全量运行时，4 个与本改动无关的套件（OpenAPI 生成、采购图片渲染、DOCX 校验）因 5 秒默认超时失败；单独重跑这四个套件全部通过。此前的全量 `pnpm -C server test` 也全部通过，判断为本地并发/资源抖动。
- 隔离库全量 e2e 仍有既有偶发失败（两次分别为 packaging-payment/regions、packaging-cost），产品相关套件均通过；单跑受媒体存储环境影响的 packaging 套件仍失败，属于既有环境问题。
- 浏览器自动化套件 `test:browser:auth` 未整体运行；手工浏览器验收已覆盖关键路径。
- 未推送到远端、未部署、未对生产库应用迁移。

## 6. 2026-10-18 UI 反馈迭代

- 弹窗档位从 `2xl` 调整为 `3xl`（80rem），分类列从 `10rem` 加宽到 `12rem`。
- `QsGenericModal` 增加可选 `fillHeight`：内容区改为 flex 约束，三列高度固定在弹窗内；
  分类、产品、已选三个区块各自内部滚动，并通过 `qs-product-selector-scroll` 隐藏滚动条。
- 产品总数条从 `px-4 py-3` 收紧为 `px-3 py-1.5`。
- 已选产品按供应商分组；新增/会话内产品直接携带 `supplierValue`，已有明细可由候选页同
  productId 补齐；销售订单编辑上下文的行 DTO 增加 `supplierValue` 以覆盖改写场景；
  无法确定的归入「未设置供应商」。
- 首屏 `pageSize` 从 20 降为 12；图片继续使用 `thumb` 变体，并增加 `loading="lazy"`、
  `decoding="async"`、`fetchpriority="low"`。这仍会请求「全部供应商」的第一页，但不再
  一次加载 20 个产品与图片。若需要完全消除首屏目录请求，可改为先选供应商/关键词再加载。

验证：`pnpm -C web run check` 通过；Server 单元测试 3982 个通过；`contract:check` 通过；
浏览器实测 3xl 布局、分类列宽度、区块内滚动、隐藏滚动条、总数条高度、供应商分组正常。

## 7. 2026-10-18 分类手风琴与横向卡片

- 选品左栏改为「分类 → 产品头」两级手风琴：分类行可展开/收起，产品头行
  精确筛选 `categoryName + productHeadName`；分类行本身筛选整个分类。
- 产品区移除产品头分组和组头，产品按服务端顺序平铺展示。
- 产品卡片改为横向长条：左侧缩略图、右侧名称/编号/选择状态；图片点击仍独立放大。
- 选品接口 facet 从 `categories: [{ name, count }]` 扩展为
  `categories: [{ name, count, productHeads: [{ name, count }] }]`；三条接口
  增加 `productHeadName` 查询参数，`unclassified` 与分类/产品头互斥。
- 后端抽出 `readProductOptionCategoryFacets` 共享 facet 读取，销售创建、销售编辑、
  采购创建统一使用。
- 保留已选产品按供应商分组与「未设置供应商」回退。

验证：Server 单元测试 3982 个通过；`contract:check` 通过；`pnpm -C web run check`
通过；浏览器实测分类展开/收起、产品头筛选（肩带 7 项）、平铺横向卡片正常。

## 8. 分类行与卡片细节收口

- 分类行改为整行容器：展开箭头、名称和数量同属一块选中背景，箭头不再落在胶囊外。
- 只高亮叶子节点：选中产品头时，父分类仅保留主色文字与箭头，不铺底色；选中整个分类
  时才给分类行底色。
- 分类/产品头移除外描边，统一 `bg-primary/10 + text-primary`；数量统一右对齐，
  分类与产品头共用同一右边界。
- 产品头行左侧缩进、行高 `min-h-8`，分类行 `min-h-9`，统一 `rounded-md`。
- 放大入口改为固定 `size-8` 正方形（`inline-grid place-items-center`，去掉 padding）；
  实测 32×32。
- 卡片媒体区固定 `h-24 sm:h-28`、宽 `w-28 sm:w-32`，图片绝对定位覆盖媒体区；
  有图/无图卡片实测均为 114px 高。
- 图片与信息区按钮增加内嵌焦点环：`outline-2 + outline-offset-[-2px] +
  outline-primary/50`。此前图片预览用 Esc 关闭后焦点回到图片按钮，浏览器默认
  `outline: auto` 被卡片 `overflow-hidden` 裁切，只剩右侧一条竖线；改为内嵌焦点环后
  四边都在媒体区内可见，且保持主色语义。

验证：`pnpm -C web run check` 通过；浏览器实测仅产品头高亮、父分类无底色、数量
右边界均为 202px、所有卡片同高；Esc 关闭预览后焦点环为
`solid 2px primary/50 offset -2px`，不再出现右侧蓝色边线。

## 9. 统计信息与放大图标收口

- 产品总数从产品区内部条移到弹窗 footer 左侧，`取消 / 确认添加` 仍在右侧；
  产品区滚动区域因此占满整个中间列高度。
- 移除图片右上角的放大图标：主图区域任意位置点击仍打开预览，改用
  `cursor-zoom-in` 作为轻量提示，避免图标与整图点击重复表达。
- 图标清单重新生成，`i-lucide:zoom-in` 已无源码引用（384 条）。

验证：`pnpm -C web run check` 通过；浏览器实测 footer 左侧显示「产品总数 共 37 个产品」，
产品卡片无放大图标，点击图片仍正常打开预览。

## 10. 后续可选

- 批量补录工具（CSV → dry-run → apply），仅在业务提供映射表后实施。
- 存量补录完成后可另起迁移把两列改为 `NOT NULL`。
- 产品列表增加「未分类」筛选（当前只支持精确分类/产品头筛选）。
- 分类/产品头改名与合并的治理工具（文本字段无稳定 ID）。
