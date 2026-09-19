# 阶段 1：数据结构与基础能力实施记录

日期：2026-09-19。用户明确要求按计划实施阶段 1；沿用 `柜次管理开发分支`。

## 1. 已实现范围

- 五张 Prisma 业务表、相关枚举、外键、索引及两条追加迁移；没有新增 `OceanFreightLineSettlement`。
- 柜次和账单内部编号、创建幂等、基础行创建与查询、专属权限、创建审计、来源文件引用。
- 主表及行均保存版本。新增装柜行提交父柜次 `expectedVersion`，成功后递增父版本；新增账单行在父行锁下追加并递增父版本。
- 创建柜次时按数据库当前时间对应的上海年份，从名称解析日期与序号；无后缀与 `-01` 都归一为序号 1。同仓同日同序号唯一，跨年重试返回原对象，不重新推断。
- 装柜记录关联现有 `PurchaseOrderPart`。同货件可有同柜多条包装明细，`L-010831-01~10` 可按一行、10 件保存；记录资料不修改货件实物状态。
- 一个装柜明细只能有一条 NORMAL 账单行；ADJUSTMENT 可独立追加，若填写原始账单行，则必须指向同一装柜明细的正常行，不继承历史代收。
- 关联装柜明细且该明细已有真实货件时，基础账单行派生为 `PENDING`；否则为 `UNMATCHED`。调用方不能直接填写核对状态。

## 2. 本阶段公开接口

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| GET | `/api/container-batches` | `container-batches:read` |
| POST | `/api/container-batches` | `container-batches:create` |
| GET | `/api/container-batches/:id` | `container-batches:read` |
| GET | `/api/container-batches/:id/items` | `container-batches:read` |
| POST | `/api/container-batches/:id/items` | `container-batches:update` |
| GET | `/api/ocean-freight-bills` | `ocean-freight-bills:read` |
| POST | `/api/ocean-freight-bills` | `ocean-freight-bills:create` |
| GET | `/api/ocean-freight-bills/:id` | `ocean-freight-bills:read` |
| GET | `/api/ocean-freight-bills/:id/lines` | `ocean-freight-bills:read` |
| POST | `/api/ocean-freight-bills/:id/lines` | `ocean-freight-bills:read` 和 `ocean-freight-bills:update` |

所有接口要求有效登录和对应权限；写接口要求既有 CSRF 校验与 UUID v4 `Idempotency-Key`。主表请求键按操作者隔离，明细请求键按父单隔离，指纹包含操作者；同键同内容返回原记录，同键不同内容返回 409。柜次明细重试先识别原记录，再检查父版本，因此提交成功后网络重试不会被自己刚增加的版本误拒绝。

基础 DTO 只开放当前可可靠保存的字段。装柜行开放货件关联、品名、包装件数、海运唛头、入仓参考、单位和备注；账单行还允许来源尺寸、毛重、代收和收货快照。数据库为后续阶段保存完整字段，但当前接口不接受调用方计算的材积、合计、返款、来源 JSON 或核对结果。尚未计算的金额字段为 `null`，不伪造零金额。

## 3. 一致性与编号

- 主表先取得操作者与请求键的事务锁，再检查重放；编号派发、业务写入、来源激活和审计必须在同一事务提交。
- 编号使用 `generateScopedInTransaction`，消费域分别为 `CONTAINER_BATCH.CREATE`、`OCEAN_FREIGHT_BILL.CREATE`。数据库同时核对编号规则、BUSINESS 用途、消费域、派发编号与主表编号。
- 迁移不代替管理员创建、发布或启用编号规则。运行创建接口前，现有 `CONTAINER_BATCH_NO`、`CTN_BILL_NO` 必须有效；不可用时返回明确业务错误。
- 主柜次锁保护行号、版本与行幂等；实际货件锁及数据库触发器共同约束跨柜分配。读分页使用一致快照。装柜写入支持 READ COMMITTED 与 SERIALIZABLE；REPEATABLE READ 写入拒绝，避免等待锁后继续使用旧快照。
- 关联外键采用 RESTRICT；调整关联拒绝自引用、环和不一致货物；数量、尺寸、汇率等设置有效范围并拒绝 PostgreSQL Numeric NaN。净返款保留可为负数的结构。

## 4. 权限、审计与媒体

七项专属权限为 `container-batches:read/create/update`、`ocean-freight-bills:read/create/update/reconcile`。权限迁移默认仅授予 `system_admin`，未改动其他角色授权。当前 `reconcile` 仅登记，尚无核对写入口。

新增四个创建事件：`CONTAINER_BATCH_CREATED`、`CONTAINER_LOADING_ITEM_CREATED`、`OCEAN_FREIGHT_BILL_CREATED`、`OCEAN_FREIGHT_BILL_LINE_CREATED`。审计保存必要主键及非敏感摘要，不记录完整收货资料或源文件内容；现有审计页增加中文名称、筛选，角色配置增加两个资源组中文名称。

`OceanFreightSourceFileService.attach(tx, mediaAssetId, actorUserId)` 接入现有媒体体系，要求 `OCEAN_FREIGHT_SOURCE_XLSX` 用途、上传人一致、DOCUMENT 类型、xlsx MIME、有效状态和未过期；核对实体文件大小与 SHA256 后，在同一业务事务激活。已引用来源文件不能被回收或删除。

本阶段只提供来源文件挂载基础能力，尚无上传、下载或 Excel 解析 HTTP；后续导入阶段接入上传验证和访问权限，不通过开放原始存储路径提供文件。

## 5. 未进入的后续范围

- 费用编辑、材积计算、币种费用汇总、汇率换算和返款计算。
- Excel 解析、预览、批量导入、匹配维护。
- 对账确认、重新打开及确认后冻结规则。
- 柜次和账单的业务维护 UI；三个页面仍为先前骨架。
- 资金引擎、账户余额、资金流水、销售收款、正式对账单与结算表。

## 6. 验证与数据库边界

迁移为 `20260919090000_ocean_freight_foundation` 和 `20260919091000_ocean_freight_access_media`。临时 Docker PostgreSQL 完整应用 65 条迁移，第二次 deploy 无待执行项，`migrate status` 最新；结构约束 9 项、媒体/权限 5 项真实数据库测试通过，包括双连接并发跨柜竞争。

验证结果：

- 三个 ocean PostgreSQL/HTTP 套件共 23 项通过：结构 9 项、媒体/权限 5 项、真实 AppModule HTTP 9 项。包括两个主表并发幂等、正常计费防重、四类审计失败回滚，以及真实 XLSX 激活后故障回滚并以原键恢复。
- `prisma:validate`、漂移门测试、Server TypeScript 与全量 ESLint 通过。后端全量单测覆盖 305 个套件、3420 项：一次全量运行中 304 个套件/3400 项通过，产品命令套件受同时重建 Prisma 目录影响出现 `ENOENT`；等待生成结束后单独重跑该套件，20 项全部通过。更早发现的旧审计枚举数量基线已按新增四项事件更新并验证。
- OpenAPI 通过根入口同步，并完成 `contract:check`；原有接口的语义差异仅为审计查询枚举扩展，新增 6 条路径、10 个 operation。Server 与 Web 快照一致，生成类型不提交。
- Web 审计/权限展示定向 53 项测试、修改文件 ESLint、正式应用类型检查通过；本阶段没有新增业务 UI，未将先前页面骨架冒充已接入功能。
- `prisma:drift:check` 在隔离 shadow database 重放后返回 `No difference detected`。额外比较数据库与 Prisma datamodel 仅见既有编号索引 operator class 和三处销售地区外键名称差异，本次五张表无差异，未越界调整旧模型。
- 组合 HTTP 测试中来源故障注入曾一次得到 404，单独运行未复现；测试改为显式启动一个临时 HTTP Server、统一请求生命周期，最终三个套件 23 项完整复验通过。故障注入的预期 500 日志和 pg 依赖弃用警告不作为实际业务成功响应。
- 文档本地链接与 `git diff --check` 通过。

本次未应用个人业务数据库迁移、未创建真实业务柜次或账单、未推送或发布。后续实际使用新接口前须按迁移规范应用两条迁移，并确认两个业务编号规则有效。
