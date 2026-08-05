# 供应商管理实施任务

## 1. 文档状态

- 状态：Phase 4 Task 6 已完成，Task 7 待执行
- 需求确认日期：2026-08-05
- 设计确认日期：2026-08-05
- 计划确认日期：2026-08-05
- Gate A/B 授权日期：2026-08-05
- 实施分支：`feat/supplier-management`
- 基线分支：`main`
- 基线 SHA：`0b7af7ada20ce0b2510776b2cfc0bc538079327d`
- Requirements：`specs/supplier-management/requirements.md`
- Design：`specs/supplier-management/design.md`

## 2. 执行纪律

每个功能任务遵循：

```text
写因能力缺失而失败的测试
-> 记录预期失败原因
-> 最小实现
-> 重构和异常路径
-> 运行任务级验证
-> 更新本文件状态
-> 检查 diff / secrets / generated 边界
-> 创建绿色小步提交
```

规则：

1. 不提交只有红测的中间状态。
2. 不手工编辑 Prisma generated client、OpenAPI snapshot 或 Web generated types。
3. PostgreSQL E2E 只使用严格校验的隔离数据库或 Schema。
4. 每次提交前执行 `git diff --cached --name-only`、`git diff --cached --check` 和 `git diff --cached --stat`。
5. Commit Message 类型使用英文、描述使用中文。
6. 命令失败必须如实记录并先处理根因。
7. 未授权 push、PR、merge、部署或分支删除。

## 3. 门禁

### Gate A - 实施与 Git

- [x] 用户明确授权进入 Phase 4。
- [x] 用户授权创建 `feat/supplier-management`。
- [x] 基线 `main == origin/main == 0b7af7ada20ce0b2510776b2cfc0bc538079327d`，工作区干净。
- [x] 未授权 push、PR、merge 或部署。

### Gate B - 数据库与公共边界

- [x] 用户明确授权 Supplier Prisma Schema、forward migration、约束、索引、Trigger 和 FK。
- [x] 用户明确授权六个公共 API、DTO、错误码、OpenAPI 和 `Idempotency-Key`。
- [x] 用户明确授权五项权限、四个 Audit event 和 system_admin 授权。
- [x] 用户明确授权内部 `NumberingGeneratorService.issuanceId` 和 `RegionLookupService` 导出。

### Gate C - 范围扩展

出现以下情况必须暂停：

- 修改公共 Qs/Fa 组件 API。
- 新增第三方依赖、Pinia、持久化缓存或环境密钥。
- 新增 Catalog、DELETE、多联系人、多地址或其他未确认能力。
- 修改真实 `SUPPLIER` 规则、生产数据库或外部部署状态。

## 4. 任务

- [x] 1. 固化规格、分支和绿色基线
  - 写入 requirements、design 和 tasks。
  - 运行根、Server、Web、Contract 基线检查。
  - 提交 `docs: 固化供应商管理实施规格`。
  - _Requirements: R1-R10_

  验证记录（2026-08-05）：

  - `node --run test:root`：非受限环境 `649/649` 通过；受限环境首次运行的进程树和 Unix socket 两项 `EPERM` 已复验排除。
  - `pnpm -C server check`：`137` 个测试套件、`1355` 个测试通过。
  - `node --run contract:check`：通过。
  - `pnpm -C web check`：非受限环境通过，包含 Node `164/164`、TS 脚本 `49/49`、API/页面 `707/707`、typecheck 和 lint；受限环境首次运行的 `tsx` IPC `EPERM` 已复验排除。
  - `pnpm -C server build`、`pnpm -C web build`：通过；Web 字体零残留校验通过。

- [x] 2. 建立 Schema、Migration、权限与 Audit
  - 先写 static schema 与隔离 PostgreSQL migration replay 红测。
  - 实现两个 Model、一个 enum、约束、索引、Trigger、权限和 Audit。
  - 明确零 Supplier 业务 seed、零 `SUPPLIER` 规则变更。
  - 提交 `feat: 建立供应商数据与权限契约`。
  - _Requirements: R2-R6, R8, R10_

  验证记录（2026-08-05）：

  - static schema 红测因缺少 Model、migration 和权限目录失败，最小实现后 `5/5` 通过。
  - 隔离 PostgreSQL 首次因测试夹具重复创建 `SUPPLIER` Rule 被唯一约束拒绝；修正为独立错误来源 Rule 后 migration replay `1/1` 通过。
  - `pnpm -C server check`：`138` 个测试套件、`1360` 个测试通过。
  - `pnpm -C server build`：通过。

- [x] 3. 扩展内部发号结果身份
  - 先让首次生成、随机生成、历史 replay 和竞态恢复要求 `issuanceId`。
  - 最小扩展 persistence 和 `GenerateNumberResult`。
  - 提交 `feat: 扩展内部发号结果标识`。
  - _Requirements: R2, R5, R8_

  验证记录（2026-08-05）：

  - 首次生成、历史 replay、纯随机和唯一竞态恢复红测因缺少 `issuanceId` 失败，最小实现后 generator/persistence `43/43` 通过。
  - 隔离 PostgreSQL `numbering-generator.e2e-spec.ts`：`9/9` 通过，并核对返回 `issuanceId` 与真实 ledger 行一致。
  - `pnpm -C server check`：`138` 个测试套件、`1360` 个测试通过。
  - `pnpm -C server build`：通过。

- [x] 4. 添加事务内 RegionLookupService
  - 先覆盖稳定 UUID 锁序、`FOR KEY SHARE`、层级、父子关系和有效状态。
  - 实现业务无关服务并由 `RegionsModule` 导出。
  - 提交 `feat: 添加事务内地区引用校验服务`。
  - _Requirements: R3, R6_

  验证记录（2026-08-05）：

  - 定向红测因缺少 `RegionLookupService` 与模块导出失败；最小实现后稳定 UUID 锁序、单条递归 SQL、`FOR KEY SHARE`、祖先有效状态和异常结果校验共 `8/8` 通过。
  - 首次完整检查发现一处 `@typescript-eslint/no-unnecessary-type-assertion`；移除不改变类型的断言后复验通过。
  - `pnpm -C server check`：`139` 个测试套件、`1366` 个测试通过。
  - `pnpm -C server build`：通过。

- [x] 5. 定义 DTO、规范化、错误与幂等摘要
  - 覆盖嵌套分组、Unicode、长度、PATCH 三态、canonical key 和 HMAC 指纹。
  - 不新增环境密钥或平行公共 DTO。
  - 提交 `feat: 定义供应商输入与幂等契约`。
  - _Requirements: R2-R8_

  验证记录（2026-08-05）：

  - 四个定向红测套件先因 Supplier DTO、Normalizer、错误与幂等实现缺失而失败；最小实现及 Unicode 派生值二次限长后 `36/36` 通过。
  - DTO 覆盖完整嵌套替换、创建可空草稿、PATCH 省略/null/对象三态、空 PATCH 和 `expectedVersion`；Normalizer 覆盖 NFC/NFKC、Unicode 空白、固定 locale 大小写与列长边界。
  - 幂等测试核对 canonical lowercase UUID v4、固定键序序列化、SHA-256 scope、HMAC-SHA-256 fingerprint、语义等价 replay 和 actor 隔离。
  - `pnpm -C server check`：`143` 个测试套件、`1402` 个测试通过。
  - `pnpm -C server build`：通过。

- [x] 6. 实现列表与详情查询
  - 覆盖搜索、筛选、分页、稳定排序、列表最小化和详情 readiness。
  - 使用显式 list/detail select，无 Catalog。
  - 提交 `feat: 添加供应商查询服务`。
  - _Requirements: R2-R4, R6-R8_

  验证记录（2026-08-05）：

  - DTO 与 Query Service 红测先因管理查询/响应 DTO 和服务缺失而失败；最小实现后 Supplier 定向测试 `46/46` 通过。
  - 列表在单个带 timeout 的事务中串行执行 count/rows，覆盖五类搜索索引、状态/主体筛选、分页和白名单稳定排序；显式 select 不读取或返回登记号、详细地址、邮编、备注及内部字段。
  - 详情使用独立显式 select 返回完整业务字段，并仅以联系人姓名和电话/微信渠道计算 `enableReadiness`，登记和地址不参与 readiness。
  - `pnpm -C server check`：`144` 个测试套件、`1412` 个测试通过。
  - `pnpm -C server build`：通过。

- [ ] 7. 实现三事务幂等创建
  - 覆盖 Tx-A/Tx-B/Tx-C、两个崩溃窗口、响应丢失、同键并发和异 payload。
  - Supplier、Audit、账本完成在 Tx-C 原子提交。
  - 提交 `feat: 实现供应商幂等创建流程`。
  - _Requirements: R2-R8_

- [ ] 8. 实现编辑与启停生命周期
  - 覆盖 expectedVersion、no-op、Region 历史值、登记唯一和最小启用条件。
  - 已启用记录不得编辑成不满足联系人条件。
  - 提交 `feat: 实现供应商编辑与状态管理`。
  - _Requirements: R3, R4, R6, R8_

- [ ] 9. 发布六个 API 与 OpenAPI
  - Controller tests 先锁定 operationId、权限、CSRF、状态码、错误矩阵和 Header。
  - 注册 `SupplierModule`，只通过 `contract:sync` 同步生成资产。
  - 提交 `feat: 发布供应商管理接口`。
  - _Requirements: R1, R4, R5, R7, R8, R10_

- [ ] 10. 补齐 Server PostgreSQL 与 API E2E
  - 隔离库创建 `SUPPLIER` fixture。
  - 覆盖权限、CSRF、生命周期、并发、幂等、Region、Audit 和最小化响应。
  - 提交 `test: 补齐供应商服务端端到端覆盖`。
  - _Requirements: R1-R8, R10_

- [ ] 11. 接入 Web API、路由与权限
  - 先写 API Recorder 和 route 红测。
  - 路由固定 `/system/service-provider/suppliers`，只消费 generated types。
  - 提交 `feat: 接入供应商接口与权限路由`。
  - _Requirements: R1, R5, R7, R9_

- [ ] 12. 实现 Web 纯逻辑与创建意图
  - 覆盖表单、查询、readiness、权限、错误和 unknown result 手动重放。
  - 明确登记和地址为空仍可启用。
  - 提交 `feat: 实现供应商表单与创建幂等逻辑`。
  - _Requirements: R3-R5, R7-R9_

- [ ] 13. 添加表单、详情与状态领域组件
  - 使用现有 QsGenericDrawer/QsGenericModal/QsRegionSelector。
  - 子组件不拥有 API、Store 或权限。
  - 提交 `feat: 添加供应商维护与状态组件`。
  - _Requirements: R3, R4, R8, R9_

- [ ] 14. 实现页面编排、响应式与无障碍
  - 页面拥有 API、权限、Abort、authEpoch 和 mutation 对账。
  - 覆盖桌面、390px、键盘、焦点、深色和 reduced motion。
  - 提交 `feat: 实现响应式供应商管理页面`。
  - _Requirements: R1, R7-R9_

- [ ] 15. 添加真实 Browser E2E 与隔离编排
  - 使用真实 Chrome、Server、Cookie/CSRF 和隔离 PostgreSQL。
  - 覆盖 unknown create、权限、生命周期、响应式和数据库终态。
  - 提交 `test: 添加供应商浏览器端到端验证`。
  - _Requirements: R1-R10_

- [ ] 16. 接入 CI Gate 并完成交付收口
  - 新增 `browser-suppliers-e2e`，CI gate 从 7 精确变为 8。
  - 运行全量检查并审计契约、migration、权限、Audit、敏感信息和 Git。
  - 提交 `ci: 接入供应商浏览器端到端门禁`。
  - _Requirements: R1-R10_

## 5. 验证矩阵

```bash
pnpm -C server prisma:validate
pnpm -C server exec jest --runInBand modules/suppliers
pnpm -C server check
pnpm -C server build
node --run ci:server-e2e

node --run contract:sync
node --run contract:check

pnpm -C web check
pnpm -C web build

node --run test:root
node --run ci:browser-suppliers-e2e
node --run check

git diff --check
git status --short --branch
```

真实环境 `SUPPLIER` 规则只允许只读核验，不在本计划中自动执行任何变更。
