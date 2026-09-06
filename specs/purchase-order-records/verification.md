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
