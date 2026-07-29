# 系统货币与当前汇率管理实施计划

## 1. 文档状态

- 状态：已完成
- 开始日期：2026-07-29
- 分支：`feat/currency-system`
- 需求文档：`specs/system-currency-management/requirements.md`
- 技术设计：`specs/system-currency-management/design.md`

## 2. 执行规则

- 新功能采用 TDD：先建立失败测试，再实现最小代码，最后重构。
- 每项任务完成后更新本文件状态。
- 每个提交必须通过对应范围测试，不提交仅包含失败测试的中间状态。
- 公共 decimal 值使用 string，不暴露 Decimal 实例。
- Server 与 Web 通过 OpenAPI 契约协作，不跨目录引用源码。
- 代码中的非直观工程约束使用必要的中文注释说明。

## 3. 实施任务

- [x] 1. 建立规格文档与绿色基线
  - 写入已确认 requirements、design 和 tasks。
  - 复核分支、工作区和现有相关测试。
  - _Requirement: 1-9_

- [x] 2. 以 TDD 建立数据库模型与迁移
  - 先补 schema、migration、permission、Audit 和 seed 失败测试。
  - 新增 Currency、ExchangeRate、数据库约束及跨表 trigger。
  - 导入四币种且保持零汇率。
  - _Requirement: 1, 2, 3, 4, 7, 8_

- [x] 3. 以 TDD 实现严格 DTO 与 Decimal 边界
  - 校验 code、minorUnit、文本和 expectedVersion。
  - 校验、规范化 `foreignUnitsPerCny` decimal string。
  - 建立稳定错误码与持久化错误映射。
  - _Requirement: 2, 3, 8_

- [x] 4. 以 TDD 实现货币查询与 Catalog
  - 实现管理查询与正常 Session 可用的全量 Catalog。
  - 注册 Module、Controller、operationId 和 OpenAPI 错误矩阵。
  - _Requirement: 2, 5, 8_

- [x] 5. 以 TDD 实现货币写操作
  - 创建默认停用、受控编辑、启停、version、锁序和 Audit。
  - 无汇率启用与 CNY 停用必须失败。
  - _Requirement: 1, 2, 4, 8_

- [x] 6. 以 TDD 实现当前汇率管理
  - 实现 LEFT JOIN 列表、创建、更新、version 和 Audit。
  - 允许停用外币配置汇率，禁止 CNY 与重复当前行。
  - _Requirement: 3, 4, 8_

- [x] 7. 完成 Server E2E 与 OpenAPI
  - 验证 migration replay、seed、约束、并发和 Audit 回滚。
  - 生成 OpenAPI 并同步 Web 契约。
  - _Requirement: 1-8_

- [x] 8. 以 TDD 实现 Web API 与 Currency Catalog
  - 实现 generated DTO adapter、runtime validation、缓存和失效。
  - 覆盖身份隔离、Abort、慢响应及失败不缓存。
  - _Requirement: 5, 8_

- [x] 9. 以 TDD 动态化 MoneyInput
  - 删除静态货币和隐式默认值。
  - 支持动态 options、minorUnit、停用当前值和异常状态。
  - _Requirement: 5, 6_

- [x] 10. 以 TDD 动态化 AmountDisplay
  - 动态 symbol、minorUnit、code 和未解析回退。
  - 验证 0、2、4 位及大整数 half-up。
  - _Requirement: 5, 6_

- [x] 11. 以 TDD 实现货币管理页面
  - 实现路由权限、查询、表格、创建/编辑和启停确认。
  - 无汇率时禁止启用，无删除入口。
  - _Requirement: 2, 4, 8, 9_

- [x] 12. 以 TDD 实现汇率管理页面
  - 实现未配置状态、严格输入、公式预览和并发恢复。
  - 不增加历史、有效期或删除能力。
  - _Requirement: 3, 4, 8, 9_

- [x] 13. 完成审计、浏览器与总体验收
  - 同步 Web Audit 事件和中文文案。
  - 验证 1440px、390px、亮暗主题、键盘、权限撤销和完整状态流。
  - 运行全部检查、构建、数据库 E2E、contract 和 diff 门禁。
  - _Requirement: 1-9_

- [x] 14. 合并货币汇率单页
  - 将两个可见菜单合并为单一“货币汇率”入口。
  - 使用 `FaTabs` 组合“货币管理”和“当前汇率”，保留独立权限与请求边界。
  - 保留旧汇率地址兼容跳转，验证首次活动 Tab 加载、移动端和完整门禁。
  - _Requirement: 8, 9_

## 4. Git 提交边界

建议提交顺序：

1. `docs: 完善系统货币体系规格`
2. `feat: 建立货币与汇率数据模型`
3. `feat: 实现货币与汇率服务端接口`
4. `feat: 动态化金额货币组件`
5. `feat: 实现货币与汇率管理页面`
6. `test: 完善系统货币体系验收`

未经用户要求不 push、不 merge、不删除分支。

## 5. 最新验证证据

### Task 1

- `pnpm -C server check`：通过，83 suites / 721 tests。
- 相关 Web API/页面测试通过，441 tests。
- MoneyInput、AmountDisplay 与 Basic Data 路由定向测试通过，24 tests。
- Web ESLint 与 Stylelint 通过。
- Web `vue-tsc -b` 通过。
- `pnpm -C web check` 在受限环境中因 `tsx` CLI 创建 IPC pipe 失败：
  `listen EPERM .../tsx-501/*.pipe`。相同 TypeScript 测试通过
  `node --import tsx --test` 执行；仍会在三个测试内部再次启动 `tsx` CLI 时复现
  同一环境错误，未发现业务断言失败。

### Task 2

- 数据库结构与权限定向测试通过，14 tests。
- `pnpm -C server prisma:validate`：通过。
- `git diff --check`：通过。
- 本阶段只验证 migration 静态契约；live migration replay 与数据库 E2E 保留到
  Task 7 执行。

### Task 3

- DTO、文本与 decimal string 规范化、持久化错误映射定向测试通过，
  6 suites / 29 tests。
- Task 3 文件定向 ESLint：通过。
- 汇率规范化不经过 JavaScript `number`；未知数据库错误固定收口为安全
  `INTERNAL_ERROR`。

### Task 4-6

- Currency / ExchangeRate 全部模块定向测试通过，15 suites / 81 tests。
- `pnpm -C server check`：通过，99 suites / 808 tests。
- 服务端完整 TypeScript、ESLint、Prisma validate 与 `git diff --check`：通过。
- Catalog 返回全量货币；管理读取和八项写权限分离；写事务固定
  Currency → ExchangeRate 锁序，并以 `expectedVersion` 与同事务 Audit 收口。

### Task 7

- `currency-schema.e2e-spec.ts`：通过，临时 PostgreSQL schema 完整重放，
  1 test。
- `currency-management-api.e2e-spec.ts`：通过，Catalog 权限、完整生命周期、
  并发版本冲突与 Audit 失败回滚共 2 tests。
- 本地开发库 migration deploy：两段货币 migration 成功应用。
- `node --run contract:sync` 与 `node --run contract:check`：通过；
  Server/Web OpenAPI 快照字节一致，Web generated DTO 成功生成。
- `management-api.e2e-spec.ts` 中新增权限目录断言所在场景通过；整套 8 tests
  有 2 个既有 system_admin 单例场景因本地库已有活动管理员而失败
  （预期 409 实际 200、预期单一成功实际两个成功），与本期货币写入无关，
  未隐藏或改写该环境前置条件。

### Task 9-10

- MoneyInput、AmountDisplay 与 Currency Catalog 内核联合定向测试通过，
  41 tests；其中组件相关用例覆盖 `minorUnit` 0..4、half-up、大整数、
  停用当前值与未知币种回退。
- `pnpm --filter qsmds-arco exec vue-tsc -b`：通过。
- 金额组件、Showcase 与相关测试定向 ESLint：通过。
- 基础组件只消费中立 `CurrencyDescriptor`，未引入 API、Store、权限或
  Catalog provider 依赖。

### Task 8

- Currency API、Catalog adapter、默认 Provider 与应用注入定向测试通过，
  25 tests。
- Catalog 对 generated DTO 响应执行白名单 clone 与运行时验证，按
  `authEpoch + userId` 隔离 5 分钟缓存，覆盖 Abort、请求合并、迟到响应、
  失败不缓存与 BroadcastChannel 精确消息。
- MoneyInput 与 AmountDisplay 通过 `useCurrencyCatalog` 消费同一
  `CurrencyDescriptor` 真相源；Catalog 保留停用货币以解析历史业务金额。
- 目标文件 ESLint 通过；`vue-tsc --noEmit --ignoreDeprecations 6.0` 通过。
  未带兼容参数的 `vue-tsc --noEmit` 会被当前 TypeScript 6 以既有
  `baseUrl` 弃用诊断 `TS5101` 阻断，未掩盖该配置门禁。

### Task 11-12

- 货币/汇率页面、查询逻辑、路由权限与 API adapter 联合定向测试通过；
  页面使用 Server 分页、搜索与筛选，并覆盖加载、空、错误和无权限状态。
- 货币页支持创建、展示字段编辑和启停；CNY 可维护名称/符号/排序，但 code、
  minorUnit 和启用状态固定。非 CNY 缺少汇率时启用入口就地说明依赖。
- 汇率页只列非 CNY，明确展示 `1 CNY = X CODE` 与
  `外币金额 ÷ 比例 = 人民币`；比例始终按 decimal string 处理，未配置不使用
  `0`/`1` 占位，也未把说明示例 `4.8` 写入默认表单。
- 两页 mutation 均禁用自动重试；网络未知结果或 version 冲突会重新查询并替换
  弹窗上下文，不复用过期 `expectedVersion`。
- 页面目标 ESLint、`pnpm run typecheck` 与 `git diff --check`：通过。

### Task 13

- `node --run check`：最终独立全量运行通过，覆盖根目录 627 tests、
  Server 99 suites / 808 tests、Web 689 tests、OpenAPI contract、生产构建、
  隔离 PostgreSQL migration replay 与 Server E2E。
- `node --run ci:server-e2e`：全新隔离数据库 7 migrations 全部应用，
  17 suites / 91 tests 通过；货币种子保持零汇率。
- `node --run ci:browser-auth-e2e`：真实 Chrome 2 tests 通过，覆盖身份边界与
  系统管理权限目录；新增八项货币/汇率权限已纳入精确期望。
- 人工浏览器验收覆盖 1440px 与 390px、亮色与暗色主题、桌面表格与移动卡片；
  390px 页面无横向溢出，控制台无错误。
- 启用 TWD 时能就地说明缺少当前汇率并禁用确认；汇率表单初始为空，
  未写入示例 `4.8`。输入 `0` 显示严格校验，输入 `0.65` 正确预览
  `100 TWD ÷ 0.65 = 153.846154 CNY`，验收过程未提交数据库写操作。
- `pnpm -C server build`、`pnpm -C web build`、`node --run contract:sync`、
  `node --run contract:check` 与 `git diff --check`：通过。

### Task 14

- 基础数据只保留一个可见“货币汇率”菜单；页面使用现有 `FaTabs` 组合
  “货币管理”和“当前汇率”，两类读取与操作权限仍独立生效。
- 旧 `/system/basic-data/exchange-rates` 地址隐藏并兼容跳转到
  `/system/basic-data/currencies?tab=exchange-rates`，Server API 与数据库
  schema 均未修改。
- 活动面板按需挂载；浏览器验证首次切换每类列表只发一个 GET，并覆盖
  KeepAlive 返回、键盘切换、390px 无横向溢出和亮暗主题。
- `node --run check`：通过，覆盖根目录、Server、Web、OpenAPI、生产构建、
  隔离 PostgreSQL migration replay 与真实 Chrome 身份/管理 E2E。
- `node --run ci:browser-regions-e2e`：最终独立运行 2 tests 通过；权限清空时
  跳过受保护的地区与货币汇率页面，回落到“编号管理”。
