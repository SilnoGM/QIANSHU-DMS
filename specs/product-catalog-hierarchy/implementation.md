# 产品分类与产品头改造：实施与验证记录

> 本文件记录 **2026-10-18 最终实施口径**。本轮把此前“Product 文本列 + 自由文本去重”的方案升级为
> “供应商 → 分类目录 → 产品头目录 → 产品外键”，并同步改造产品状态启停、选品供应商必选、
> 产品分类管理页与权限/审计。更早的 `requirements.md` / `design.md` 中关于文本列、`2xl` 弹窗、
> 「全部供应商」的段落属于历史方案，以本文件与两份文档顶部“最终口径”说明为准。

## 1. 已确认口径

| 项 | 决定 |
| --- | --- |
| 层级 | 供应商 → 分类 → 产品头 → 产品 |
| 分类唯一性 | `product_categories UNIQUE (supplier_value, name)`；不同供应商允许同名分类 |
| 产品头唯一性 | `product_heads UNIQUE (category_id, name)`；不同分类允许同名产品头 |
| 产品供应商 | 所有产品必须有供应商，`products.supplier_value NOT NULL` |
| 产品分类/产品头 | 新建产品必填；产品保存时按供应商/分类 resolve-or-create，和产品同事务提交 |
| 存量产品 | 保留历史空分类/产品头；启用产品前必须补全分类与产品头 |
| 状态 | 只保留 `ACTIVE / INACTIVE`，默认 `ACTIVE`；历史 `DRAFT` 迁移为 `INACTIVE` |
| 新建产品 | 不再手选状态，固定启用 |
| 编辑产品 | 不再显示状态下拉，只读展示；状态只在产品列表操作列启停 |
| 产品分类管理 | 管理员工作台 → 产品管理 → 产品分类 |
| 删除规则 | 只删除空条目；有产品引用时 409；删除空分类可级联删除其空产品头 |
| 分类权限 | `product-categories:read/create/update/delete` 四项 |
| 分类审计 | 分类/产品头各三种事件：create / renamed / deleted，共 6 项 |
| 选品供应商 | 删除「全部供应商」；供应商下拉为空，必须先选供应商才能选产品 |
| 选品分类 | 左栏显示目录中的空分类/空产品头（0 项） |
| 合同约束 | 所有外部输入查询使用 Prisma 参数绑定，不拼接 SQL |

产品状态与权限补充：产品创建/编辑接口可能内联新建分类/产品头，因此服务端端点同时要求
`products:create|update` 与 `product-categories:create`；迁移会为已有产品维护角色补齐
`product-categories:read/create`。产品列表的启停操作复用 `PATCH /api/products/:productId`，
因此也走同一端点权限边界。

## 2. 提交

- `f969c881` `feat: 将产品分类与产品头改为目录实体并支持产品启停`

未 push、未创建 PR、未合并、未部署。

## 3. 实际改动

### 数据库

新增四条迁移：

- `20261018110000_product_taxonomy_catalog`
  - 新增 `product_categories`、`product_heads` 及作用域唯一键；
  - Product 新增 `category_id`、`product_head_id`，回填旧文本后删除 `category_name` / `product_head_name`；
  - `products.supplier_value` 收紧为 `NOT NULL`；
  - 成对 CHECK + `products_taxonomy_scope_guard` 触发器，保证分类属于产品供应商、产品头属于产品分类；
  - 新增产品分类/产品头查询索引。
- `20261018111000_product_status_remove_draft`
  - `product_status` 收敛为 `ACTIVE / INACTIVE`，历史 `DRAFT` 映射为 `INACTIVE`，默认 `ACTIVE`。
- `20261018112000_product_taxonomy_permissions`
  - 新增四项 `product-categories:*` 权限并授予 `system_admin`；
  - 为既有产品维护角色补齐 read/create。
- `20261018113000_product_taxonomy_audit_events`
  - 追加六项分类/产品头审计事件。

已登记到 `docs/后端文档/数据库迁移规范.md`（111 条迁移，67 个持久化 model）。
开发库已应用四条迁移；此前文本列迁移的备份
`~/qianshu-db-backups/qianshu_dms_dev_pre_product_category_head_20261018T021055Z.dump` 保留。

### 后端

- 新增 `ProductTaxonomyService` / `ProductTaxonomyController`：
  - `GET /api/product-categories?supplierValue=...`
  - `POST/PATCH/DELETE /api/product-categories`
  - `POST/PATCH/DELETE /api/product-heads`
  - 列表包含 0 项分类/产品头与产品引用计数；
  - 删除空分类时在同一事务内删除其空产品头；
  - 所有写操作记录独立审计。
- 产品创建/编辑按名称 resolve-or-create 分类/产品头，产品、目录与审计同一事务提交。
- Product 查询响应增加 `categoryId` / `productHeadId`，名称从目录关系读取；产品列表按 ID 筛选。
- 产品状态默认 `ACTIVE`；启用非 ACTIVE 产品时校验供应商、分类与产品头。
- 产品创建指纹升级为 `product.create.v3`（供应商必填、目录字段、状态域变化）。
- 销售创建/销售编辑/采购创建三条产品选项接口：
  - 供应商必填；
  - 分类/产品头筛选仍使用名称（供应商作用域内唯一）；
  - facet 改为从目录表读取，包含 0 项分类/产品头；
  - 排序改为目录名称关系排序。
- `GET /api/products/taxonomy-options` 返回带 ID、供应商 value 与产品头对象的目录，供表单和列表筛选使用。

### 前端

- 产品表单：
  - 供应商移到基础资料并始终必填；
  - 分类/产品头按供应商/分类级联，选项来自目录；
  - 分类/产品头“新建”受 `product-categories:create` 控制；
  - 状态改为只读卡片，新建显示“默认启用”；
  - 编辑请求不再提交 status。
- 产品列表：
  - 分类/产品头筛选改为目录 ID，并按供应商作用域展示；
  - 操作列新增“启用/停用”，带确认弹窗、版本冲突刷新和审计响应更新；
  - 状态筛选与标签移除 `DRAFT`。
- 新增产品分类管理页：
  - 路由 `/admin/products/categories`，权限 `product-categories:read`；
  - 供应商选择后维护分类/产品头；
  - 空分类/空产品头显示 0 项；
  - 新建、重命名、删除；有产品引用时禁止删除；
  - 分类删除会明确提示级联删除其空产品头。
- `QsProductSelector`：
  - 删除“全部供应商”，供应商必须显式选择；
  - 未选供应商时不发产品请求，分类区与产品区显示引导空态；
  - 无图/有图卡片等高、分类手风琴、已选按供应商分组等既有视觉保留；
  - fixture 增加空分类/空产品头样本。
- 审计页面补充六项分类/产品头事件标签。
- 新增产品分类 API 客户端与页面/API 结构测试。

## 4. 验证结果

### 通过

- `pnpm -C server typecheck`：通过。
- `pnpm -C server lint`：通过。
- `pnpm -C server exec jest --runInBand`：**352 suites / 3988 tests 全通过**。
- `pnpm -C web lint`：通过。
- `pnpm -C web typecheck`：通过。
- `pnpm -C web test:api`：**1806 tests 全通过**。
- `pnpm -C web build`：通过（现有 rolldown/@vueuse 注释与 chunk 提示不阻塞）。
- `node --run contract:check`：通过。
- `prisma:drift:check`（临时 shadow DB）：`No difference detected`。
- 隔离 PostgreSQL 定向 e2e：
  - `product-list-api` 5/5；
  - 产品/认证/媒体相关 8 个 suite、67 tests 通过（2 suites 按环境跳过）；
  - `management-api` 单独重跑 8/8 通过。
- 全量隔离 e2e：91/92 suites、659/661 tests 通过；唯一失败为 `management-api` 在高负载下的
  两个 `/api/users` 500 偶发，单独重跑全绿，未归因到本次改动。
- 开发库：四条迁移已应用；浏览器验收产生的空“测试分类/测试产品头”已清理，未留下产品测试数据。

### 浏览器实测

- 产品分类页：按供应商加载、空目录、空分类/空产品头、新建分类、新建产品头均实测成功。
- 新增产品页：供应商必填、分类/产品头在供应商/分类未选时禁用、状态为只读“启用”均实测可见。
- 受限项：当前 in-app browser 的 Reka 动画在关闭下拉/弹窗时偶发停在 `data-state=closed` 但
  `display:flex`，会残留透明遮罩并阻塞后续点击；分类/产品头弹窗已通过 `v-if` 规避关闭残留。
  产品选择器的完整浏览器点击链路未在该环境走完，已由组件测试、API 测试和契约测试覆盖。

## 5. 未完成 / 风险

- 全量 e2e 的 `management-api` 偶发 500 属既有环境/负载问题，需后续单独观察；本次未修改该模块。
- 产品编辑 PATCH 同时承担内联新建目录，端点要求 `product-categories:create`；未来若拆分状态专用
  端点，可把启停权限收窄为仅 `products:update`。
- 菜单/权限分配页是否把四项分类权限加入默认角色，仍由角色权限管理按实际角色决定；迁移只补齐
  产品维护角色 read/create，update/delete 首期仅 `system_admin`。
