# 采购订单自动完成状态实施任务

## 1. 实施约束

- 严格遵循失败测试 → 最小实现 → 重构 → 回归。
- 已获授权修改 Prisma schema、创建并应用 migration、回填当前开发数据库和扩展公共 API 状态枚举。
- `COMPLETED` 只能由服务端派生，人工订单状态接口继续只允许 `CANCELLED`。
- 不修改销售订单状态机、采购履约/付款枚举或公共 UI 组件 API。
- 每次提交只暂存本任务文件；不 push、不创建 PR、不部署。

## 2. 任务清单

### T1：固化状态派生失败测试

- [x] 扩展 `purchase-order-state-machine.spec.ts`，覆盖：
  - `CONFIRMED + SIGNED + PAID -> COMPLETED`；
  - 任一条件未满足时保持 `CONFIRMED`；
  - `COMPLETED` 在条件失效时回到 `CONFIRMED`；
  - `CANCELLED` 始终保持取消；
  - `COMPLETED` 不允许人工迁移或取消；
  - 只有 `CONFIRMED` 且未闭环的订单属于待办。
- [x] 运行定向测试并记录缺少 `derivePurchaseOrderStatus()` 的预期失败。

```bash
pnpm -C server test -- purchase-order-state-machine.spec.ts --runInBand
```

### T2：扩展数据库状态与纯状态机

- [x] 在 Prisma `PurchaseOrderStatus` 中新增 `COMPLETED`。
- [x] 新增 `20260831130000_purchase_order_auto_completion/migration.sql`。
- [x] migration 完成 Enum 替换、既有数据回填、数据库 CHECK 约束和末尾不变量校验。
- [x] 生成 Prisma Client。
- [x] 实现 `derivePurchaseOrderStatus()` 并补全状态迁移 Record。
- [x] 重新运行 T1，确认状态机测试通过。
- [x] 运行 Prisma validate 与服务端类型检查。

```bash
pnpm -C server prisma:generate
pnpm -C server prisma:validate
pnpm -C server test -- purchase-order-state-machine.spec.ts --runInBand
pnpm -C server typecheck
```

### T3：固化事务自动完成与回退失败测试

- [x] 扩展 `purchase-order-mutation.service.spec.ts`，覆盖：
  - 已付清订单签收时原子进入 `COMPLETED`；
  - 已签收订单付清时原子进入 `COMPLETED`；
  - 双条件未满足时保持 `CONFIRMED`；
  - 完成订单付款作废后原子回退为 `CONFIRMED`；
  - 状态机覆盖仍为 `PAID` 时保持 `COMPLETED`；
  - 同一业务操作只递增一次 version；
  - 自动订单状态变化写历史和带 `automatic/trigger` 的审计；
  - 状态未变化时不重复写订单维度历史和审计。
- [x] 运行定向测试并记录当前事务只更新单一维度的预期失败。

```bash
pnpm -C server test -- purchase-order-mutation.service.spec.ts --runInBand
```

### T4：实现原子状态协同写入

- [x] 履约推进使用目标履约状态派生目标订单状态。
- [x] 将付款状态私有写入方法收敛为“付款状态 + 派生订单状态”原子更新。
- [x] 记录付款与付款作废复用同一状态协同方法。
- [x] 仅在订单状态实际变化时写订单历史和自动审计。
- [x] 保留取消、付款金额、字典、媒体和行锁现有规则。
- [x] 重新运行 T3 并联合运行采购 mutation/state-machine 回归。

```bash
pnpm -C server test -- purchase-order-state-machine.spec.ts purchase-order-mutation.service.spec.ts --runInBand
pnpm -C server typecheck
pnpm -C server lint
```

### T5：固化查询与 Web 展示失败测试

- [x] 扩展 `purchase-order-query.service.spec.ts`，断言待办基础条件为 `orderStatus = CONFIRMED`。
- [x] 扩展 `purchase-order-list.logic.test.ts`，断言：
  - `COMPLETED` 可作为全部采购筛选值；
  - 文案为“已完成”；
  - 使用主色完成标签；
  - 完成订单没有下一履约状态。
- [x] 扩展采购页面测试，断言订单状态筛选包含“已完成”。
- [x] 运行定向测试并记录当前缺少状态值和待办谓词过宽的预期失败。

```bash
pnpm -C server test -- purchase-order-query.service.spec.ts --runInBand
pnpm -C web exec tsx --test apps/qsmds-arco/test/views/purchase-order-list.logic.test.ts apps/qsmds-arco/test/views/purchase-order-pages.test.ts apps/qsmds-arco/test/views/purchase-order-desc.logic.test.ts
```

### T6：接入查询、公共契约与前端状态

- [x] 待办查询只接受 `CONFIRMED`，并同步更新 `isPendingPurchaseOrder()`。
- [x] 确认 `PurchaseOrderStatusRequestDto` 仍只允许 `CANCELLED`。
- [x] 全部采购订单状态筛选增加 `COMPLETED`。
- [x] 增加“已完成”文案和与销售完成态一致的主色标签。
- [x] 完成订单不提供履约推进动作。
- [x] 重新运行 T5 并运行 Server/Web 类型检查。

```bash
pnpm -C server test -- purchase-order-query.service.spec.ts --runInBand
pnpm -C web exec tsx --test apps/qsmds-arco/test/views/purchase-order-list.logic.test.ts apps/qsmds-arco/test/views/purchase-order-pages.test.ts apps/qsmds-arco/test/views/purchase-order-desc.logic.test.ts
pnpm -C server typecheck
pnpm -C web typecheck
```

### T7：同步契约并应用 migration

- [x] 执行根契约同步。
- [x] 检查 OpenAPI 响应/查询枚举包含 `COMPLETED`，人工状态请求仍只有 `CANCELLED`。
- [x] 运行契约一致性检查。
- [x] 应用 migration 到当前开发数据库。
- [x] 检查 migration 状态为最新。
- [x] 验证数据库 Enum、回填结果和 CHECK 约束。

```bash
node --run contract:sync
node --run contract:check
pnpm -C server db:migrate:deploy
pnpm -C server exec prisma migrate status
```

### T8：完整回归与真实页面验收

- [x] 运行采购状态、mutation、query 和前端状态定向测试。
- [x] 运行 `node --run check`。
- [x] 确认 Server `3000`、Web `9000` 正常运行。
- [x] 验证 `/api/health` 数据库为 `up`，Web 返回 HTTP 200。
- [x] 浏览器验收全部采购筛选项包含“已完成”。
- [x] 若开发数据库存在回填订单，验收列表及详情均显示“已完成”；若无匹配数据，则以 migration 不变量和自动化测试为准，不制造业务数据。
- [x] 验证待办采购不展示完成订单。

```bash
node --run check
curl --fail --silent http://127.0.0.1:3000/api/health
curl --fail --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:9000/
```

### T9：Git 收口

- [x] 检查 `git status --short`、完整 diff 和 `git diff --check`。
- [x] 提交 schema、migration、状态机与服务端事务：

```text
feat: 添加采购订单自动完成状态
```

- [x] 提交 OpenAPI、Web 状态接入及测试：

```text
feat: 展示采购订单已完成状态
```

- [x] 确认工作树干净并报告提交 SHA。
- [x] 不 push、不创建 PR、不部署。

## 3. 完成定义

只有同时满足以下条件才能声明完成：

1. 两种操作顺序均能自动完成，付款作废能按规则回退；
2. 状态更新、历史和审计处于同一事务，且数据库 CHECK 约束成立；
3. migration 已应用并通过不变量校验；
4. OpenAPI、Server、Web 类型与页面文案一致；
5. 定向测试、根完整检查和运行时健康检查全部通过；
6. 两个本地提交创建成功，且未推送远端。
