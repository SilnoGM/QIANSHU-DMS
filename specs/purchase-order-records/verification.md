# 验收记录

验证日期：2026-09-06。所有数据库迁移测试使用自动创建和清理的隔离 PostgreSQL，未应用当前业务数据库。

## 自动验证

| 验证 | 命令 / 范围 | 最终结果 |
| --- | --- | --- |
| 根规则 | `node --run test:root` | 687 项通过 |
| 后端单元测试 | `pnpm -C server test` | 256 套、2616 项通过 |
| 前端 API / 逻辑 / 组件源契约 | `pnpm -C web --filter qsmds-arco test:api` | 1117 项通过 |
| 后端类型及 lint | `pnpm -C server typecheck`、`pnpm -C server lint` | 通过 |
| 前端类型及构建 | `pnpm -C web --filter qsmds-arco typecheck`、`pnpm -C web --filter qsmds-arco build` | 通过，字体产物审计通过 |
| 前端变更文件检查 | ESLint（本次 TS / Vue / JSON）、Stylelint（本次 Vue） | 通过 |
| OpenAPI 同步及漂移检查 | `node --run contract:sync`、`node --run contract:check` | 通过 |
| 采购专项数据库集成 | `ci-postgres.mjs` 隔离运行 records / API / schema / service 四套测试 | 4 套、22 项通过 |
| 完整后端数据库集成 | `node --run ci:server-e2e` | 退出码 0；主批次 44 套、230 项通过，按脚本拆分的媒体独占批次 4 套、10 项通过 |
| 变更空白与暂存范围 | `git diff --check`、`git diff --cached --check` | 通过 |

## 首轮失败及处理

- TDD 阶段先补缺失模型、独立凭证归档、状态原因、金额时间线和前端调用的失败测试，再实现功能，最终通过。
- 首轮采购集成测试暴露旧夹具缺少已必填的采购产品类型，以及新媒体夹具过早触发有效引用检查。仅调整测试夹具与约束检查时机，最终采购专项及完整集成均通过。
- 首轮完整集成中的认证清理、地区登录各有一项失败；未改动这些业务模块，完整复跑均通过。单次复跑不能证明不存在时序不稳定性。
- 根规则首轮发现迁移文档数量未更新及供应商文本精确白名单未对应当前位置。补充本次迁移登记、新测试夹具和既有抽屉信息组件的精确路径，没有放宽匹配规则，最终 687 项通过。
- 开发中的 lint / 类型问题均已修正，最终对应检查通过。

## 验证边界

- 未应用业务数据库 migration；必须先应用 `20260906120000_purchase_order_records`，新版详情查询才能访问金额变更表。
- 未重启前后端，未推送远端，未进行业务库上的浏览器视觉及交互验收。前端已通过自动测试、类型、lint 和生产构建，但不声称完成真实页面验收。
- 金额变更记录提供不可变数据结构、约束、查询和展示；本次没有新增修改采购金额、产品或付款约定的业务入口，也没有伪造历史记录。
- 保持 `DEPOSIT / BALANCE / OTHER`，实际付款汇总排除作废项；归档采购签收单不推进履约状态；未恢复作废付款、下载或解除关联按钮。

## 后续授权：应用业务数据库（2026-09-06）

用户后续明确授权将既有 migration 应用到业务数据库。以下结果更新上文“未应用业务数据库”的实施阶段边界，不覆盖原始验收历史。

- 目标：当前 Server 配置使用的本地业务库 `qianshu_dms_dev`，不是隔离 CI 库。
- 应用前：35 条成功迁移与仓库文件的 SHA-256 校验值一致；唯一待应用项为 `20260906120000_purchase_order_records`。4 条早期失败历史已标记回滚，本次没有修改历史记录。
- 使用既有 PostgreSQL 16 容器中的 `pg_dump` 创建迁移前完整备份，`pg_restore --list` 检查通过。本机备份为 `/tmp/qs-purchase-records-migration.wLD0DK/before.dump`，权限 `0600`，大小 350123 bytes；备份不进入 Git，且未声称完成恢复演练。
- `pnpm -C server exec prisma migrate status` 应用前因唯一待应用项返回退出码 1；`pnpm -C server db:migrate:deploy` 成功，完成时间为 `2026-09-06T04:22:59.382Z`（UTC）。
- 应用后 `pnpm -C server exec prisma migrate status` 返回 `Database schema is up to date!`；再次 deploy 返回 `No pending migrations to apply.`，两条命令退出码均为 0。
- 对比前后采购订单 5 条、明细 7 条、付款 2 条、凭证 1 条、状态历史 11 条：每张表全行 JSON 的有序聚合指纹一致，原有业务数据未改变。
- 验证三类凭证 enum、可空 `payment_id`、有效采购单凭证唯一索引、8 个 `Decimal(30,4)` 金额字段、约定等式及非空原因约束、金额记录不可变 trigger 均已存在。金额变更历史仍为 0 条，没有回填或伪造记录。
- `/api/health` 返回 HTTP 200，数据库状态 `up`。本次未重启服务，也未操作订单、付款或凭证业务。
- 表格新增三列需要扩展列表响应，尚未修改公开契约或前端代码；具体字段见待确认的 `list-extension-design.md`。

## 后续授权：采购列表记录列（2026-09-06）

用户确认公开响应扩展后实施。本节更新上节“列表尚未实施”的阶段边界，不覆盖原始验收历史。

### 实施结果

- 列表及继承列表的详情响应增加 `paymentRecordSummary / documentSummary / changeSummary`，同步两端 OpenAPI，不新增路由或 schema。
- 当前页批量读取有效付款、有效凭证、两类历史计数与各类最新一条；列表事务显式使用 `RepeatableRead`。付款分类与 `paidAmount` 来自同一批事实，使用 `bigint` 定点金额累加。
- 共用采购表格和移动卡片接入实际付款记录、订单凭证、变更记录。桌面最小列宽分别为 180 / 170 / 190 px；沿用 `AmountDisplay / DateTimeDisplay / QsTableStackedCell`，未更改既有操作按钮及筛选。

### 自动验证

| 验证 | 结果 |
| --- | --- |
| TDD 红绿循环 | 后端摘要测试先失败 4 项、前端列源契约先失败 2 项；实现后通过 |
| `pnpm -C server test` | 256 套、2619 项通过 |
| 最终 query / controller 定向复跑 | 2 套、25 项通过，含最新 OpenAPI 字段断言 |
| `pnpm -C web test:api` | 最终复跑 1119 项通过 |
| 采购 records / API / schema / service 隔离 PostgreSQL 集成 | 4 套、22 项通过，包含列表与详情口径一致、作废排除及空分页断言 |
| `node --run test:root` | 687 项通过 |
| 两端类型、后端全量 lint、前端变更文件 ESLint / Stylelint | 通过 |
| `node --run contract:sync`、`node --run contract:check` | 通过 |
| `pnpm -C web build` | 通过，108 个字体分片及零残留审计通过 |
| `git diff --check` | 通过 |

首轮后端 lint 报两处测试匹配器的 `any` 赋值，改为 `unknown`；前端 lint 报导入排序与模板换行，按现有规则格式化后复跑通过。隔离集成出现 `pg` 并发查询弃用警告，不影响本次 22 项通过，未为此改动公共数据库基础设施。

### 真实页面核对及限制

- 在当前 Chrome 登录会话只读检查全部采购与待办采购：三列正常显示，横向拖动可看到凭证与最近变更，固定采购订单及操作列保持现状。
- `PO/20260902-00003` 展示定金 `¥1,000.00 CNY`、付款凭证 1 份、3 次变更；打开详情核对实际付款记录为同一笔定金。没有记录的列为 `—`。
- 已完成筛选显示 0 条及“暂无采购订单”；待付款视图显示 3 条且三列仍在。最终关闭详情并恢复全部采购视图。
- 浏览器扩展连接曾返回 `Debugger unattached`，改用原生 Chrome 界面完成上述检查。构建检查期间后端 3000 端口曾不可用，现有开发监听重新编译后恢复；重新检查身份成功，最终 Web HTTP 200、Server HTTP 200、database `up`。未主动重启进程或操作业务数据。
- 暗色主题和移动端尚未进行真实设备视觉验收；移动渲染接入由源契约、类型及构建验证覆盖，不声称设备实测。
- 本轮不再次执行已应用业务迁移、不新增业务记录、不推送远端。
