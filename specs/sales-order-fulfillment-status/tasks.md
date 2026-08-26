# 销售订单履约状态扩展实施计划

## 1. 文档状态

- 状态：已完成
- 计划日期：2026-08-26
- 需求规格：[requirements.md](./requirements.md)
- 技术设计：[design.md](./design.md)

## 2. 实施任务

- [x] 1. 建立失败测试基线
  - 扩展 Prisma schema/迁移结构测试，断言六个目标枚举值和 `SHIPPED` 历史迁移规则。
  - 扩展履约状态机测试，覆盖五条合法相邻流转、跳级、倒退、重复状态和终态拒绝。
  - 把签收约束测试调整为 `SEA_TRANSIT -> SIGNED`，并保留缺少有效签收单的失败场景。
  - 扩展 Mutation、OpenAPI 和 Web 页面测试，先确认旧实现无法满足目标状态集合。
  - _Requirements: R1, R2, R3, R4, R5_

- [x] 2. 扩展 Prisma 履约状态枚举
  - 将 `SalesOrderFulfillmentStatus` 调整为 `PENDING`、`PREPARING`、`LAND_TRANSIT`、`WAREHOUSE_ARRIVED`、`SEA_TRANSIT`、`SIGNED`。
  - 保持 `PENDING` 为 `SalesOrder.fulfillmentStatus` 默认值。
  - 运行 Prisma format、validate 和 client generation，确认类型生成正确。
  - _Requirements: R1, R4_

- [x] 3. 追加历史数据 migration
  - 新增 `expand_sales_order_fulfillment_status` migration，不修改既有 migration。
  - 原子替换 PostgreSQL Enum，并将订单当前状态 `SHIPPED` 映射为 `LAND_TRANSIT`。
  - 将履约状态历史中的 `SHIPPED` 映射为 `LAND_TRANSIT`。
  - 将销售订单履约状态审计元数据中的 `SHIPPED` 映射为 `LAND_TRANSIT`。
  - 增加迁移内零残留断言，不增加订单版本、不更新时间、不制造历史或审计事件。
  - _Requirements: R1, R4_

- [x] 4. 更新 Server 状态机与运行时校验
  - 将状态机更新为六级严格相邻流转。
  - 将 Mutation 运行时状态集合更新为六个目标编码。
  - 保持 `SEA_TRANSIT -> SIGNED` 的有效签收单约束、订单行锁和既有错误码不变。
  - 更新相关测试夹具和断言，确保失败测试转为通过。
  - _Requirements: R1, R2, R3_

- [x] 5. 同步公共 API 契约
  - 确认查询 DTO、Mutation DTO 和响应 DTO 统一引用新的 Prisma Enum。
  - 通过根级 `contract:sync` 更新 Server/Web OpenAPI 快照和 Web 生成类型。
  - 运行 `contract:check`，确认所有公开位置只包含六个目标编码且没有 `SHIPPED`。
  - _Requirements: R1, R2, R5_

- [x] 6. 更新 Web 筛选与状态展示
  - 将订单列表履约筛选调整为六个状态，并保持业务顺序。
  - 更新列表查询允许值、桌面/窄屏状态文案和语义颜色。
  - 更新变更记录状态文案，确保新编码不回显技术值。
  - 保持现有双行订单状态列、主题 Token、Noto 字体和窄屏能力不变。
  - _Requirements: R1, R5_

- [x] 7. 执行聚焦验证
  - 运行 Prisma schema、migration drift、状态机、Mutation、查询、Controller/OpenAPI 聚焦测试。
  - 运行 Web API/页面聚焦测试、类型检查、ESLint 和 Stylelint。
  - 运行根级 `contract:check` 和 `git diff --check`。
  - 如任何命令失败，明确记录失败原因并修复后重跑，不掩盖结果。
  - _Requirements: R1, R2, R3, R4, R5_

- [x] 8. 在隔离数据库验证 migration
  - 创建或复用明确隔离的 PostgreSQL 测试数据库，不连接生产数据库。
  - 从完整 migration 链执行 `db:migrate:deploy`。
  - 在随机临时 schema 中回放旧四状态结构、历史数据与审计元数据，再执行新 migration。
  - 构造或核对旧 `SHIPPED` 订单、状态历史和审计元数据，验证全部迁移为 `LAND_TRANSIT`。
  - 验证六个枚举值、`SHIPPED` 零残留、订单版本与业务更新时间不因编码转换而变化。
  - _Requirements: R4_

- [x] 9. 最终复核与原子提交
  - 检查 Git 暂存范围，不提交 `.env`、生成目录、构建产物、日志或无关改动。
  - 将 requirements、design、tasks、Schema、migration、Server、Web、测试和 OpenAPI 快照作为一个不可拆分的发布单元提交。
  - 创建提交 `feat: 扩展销售订单履约状态`，不自动推送、合并或部署。
  - _Requirements: R1, R2, R3, R4, R5_

## 3. 完成定义

- 六级履约状态在数据库、Server、OpenAPI 和 Web 中保持完全一致。
- 旧 `SHIPPED` 在订单当前状态、履约历史、对应审计元数据和公共契约中零残留。
- 所有履约状态只能按确认顺序相邻流转，签收仍依赖有效签收单。
- 桌面端、窄屏端、筛选和变更记录使用一致中文文案与语义颜色。
- 必要验证全部通过，隔离数据库 migration 结果有可复核证据。
- Git 工作区在提交后干净，仅保留已确认的原子提交。
