# 销售订单快捷新增采购实施计划

## 1. 文档状态

- 状态：已确认
- 编写日期：2026-09-01
- 需求规格：[requirements.md](./requirements.md)
- 技术设计：[design.md](./design.md)

## 2. 执行原则

- 严格采用 TDD：先增加失败测试并确认失败原因，再实现最小修复。
- 每完成一个任务立即更新本文件的勾选状态。
- 只修改 Web 前端、Web 测试和本需求规格文档。
- 不修改公共 API、DTO、OpenAPI、Server、Prisma Schema 或 migration。
- 不改变采购创建、产品同步、备货采购、编号派发和销售采购覆盖规则。
- 命令失败必须停止并如实报告，不跳过失败检查。
- 使用小步本地 Git 提交，不推送远端，不创建 PR。

## 3. 实施任务

- [x] 1. 固化已确认规格并建立干净实施起点
  - 将 `requirements.md`、`design.md`、`tasks.md` 状态更新为“已确认”。
  - 运行 `git diff --check`，确认规格文件没有格式问题。
  - 检查 `git status --short` 和暂存范围，不包含用户已有或无关变更。
  - 创建本地提交：`docs: 定义销售订单快捷新增采购规则`。
  - _Requirements: R1, R2, R3, R4, R5_

- [ ] 2. 为动作语义和快捷参数建立失败逻辑测试
  - 更新 `sales-order-list-view.logic.test.ts`，断言 `SUBMIT_PURCHASE` 的标签为“新增采购”。
  - 更新 `purchase-order-create.logic.test.ts`，覆盖合法销售关联参数的 `trim()` / `NFKC` 规范化。
  - 覆盖缺失值、空值、数组、超长字符串和 `STOCK` 类型全部返回 `null`。
  - 运行定向逻辑测试并确认因行为尚未实现而失败，不接受导入错误、语法错误或测试装配错误作为有效 RED。
  - _Requirements: R1.1, R2.2, R3.1, R4.1_

- [ ] 3. 为销售跳转和采购自动绑定建立失败页面契约测试
  - 更新 `sales-order-pages.test.ts`，断言 `purchase-orders:create` 权限、命名路由和三个查询参数。
  - 断言 `SUBMIT_PURCHASE` 不再进入建设中 Toast，其他占位动作仍保持轻提示。
  - 更新 `purchase-order-pages.test.ts`，断言页面解析快捷参数并只在 `onMounted()` 发起一次绑定。
  - 断言使用采购域来源接口、`pageSize = 100`、ID 与订单号精确匹配并复用 `selectSourceSalesOrder()`。
  - 断言身份变化和页面卸载会取消快捷定位请求，用户已有选择不会被异步结果覆盖。
  - 运行定向页面测试并确认因页面行为尚未实现而失败。
  - _Requirements: R1, R2, R3, R4_

- [ ] 4. 实现销售待采购“新增采购”入口
  - 在 `sales-order-list-view.logic.ts` 将动作标签改为“新增采购”，保留动作键与图标。
  - 在 `sales-orders/index.vue` 增加 `purchase-orders:create` 权限判断。
  - 对 `SUBMIT_PURCHASE` 使用 `operationsPurchaseOrderCreate` 命名路由跳转。
  - 传递 `type=SALES_LINKED`、`salesOrderId` 和 `salesOrderNo`。
  - 保持付款、签收等已落地操作及其他建设中动作行为不变。
  - 运行销售逻辑和页面测试，确认相关 RED 转绿。
  - _Requirements: R1, R2_

- [ ] 5. 实现采购创建页可信单次自动绑定
  - 在 `purchase-order-create.logic.ts` 实现 `parsePurchaseOrderSourceShortcut()` 纯函数。
  - 在 `purchase-orders/create.vue` 增加独立快捷定位 AbortController 与单次执行状态。
  - 使用 `salesOrderNo` 调用现有采购来源接口，使用 `salesOrderId + salesOrderNo` 精确确认结果。
  - 仅在页面仍无用户选择、身份纪元未变化且请求未取消时调用 `selectSourceSalesOrder()`。
  - 无匹配或请求失败时显示 Warning Toast 并保留手工选择入口。
  - 在身份变化和组件卸载时取消快捷定位请求。
  - 保持页面停留在第一步，不自动同步产品、不创建幂等键、不提交采购订单。
  - 运行采购逻辑和页面测试，确认相关 RED 转绿。
  - _Requirements: R3, R4, R5_

- [ ] 6. 增加真实浏览器回归并完成视觉验收
  - 扩展 `purchase-orders.browser.test.mjs`，使用已有真实 HTTP 测试数据定位销售待采购订单。
  - 验证操作文字为“新增采购”，点击后进入包含三个查询参数的销售关联采购页。
  - 验证第一步自动展示目标订单及现有绿色内边框选中态。
  - 验证“选择销售订单”仍可打开选择弹窗，自动绑定没有跳步或同步产品。
  - 浏览器测试不得提交采购订单，避免额外业务写入。
  - 使用 Browser Skill 在桌面宽度检查运行态；同时确认 Console 无新增 error、相关 API 无异常响应。
  - _Requirements: R1.1, R2, R3.2-R3.6, R4.3, R5.1_

- [ ] 7. 完成 Web 与仓库级验证
  - 运行定向测试：
    `pnpm -C web exec tsx --test apps/qsmds-arco/test/views/sales-order-list-view.logic.test.ts apps/qsmds-arco/test/views/purchase-order-create.logic.test.ts apps/qsmds-arco/test/views/sales-order-pages.test.ts apps/qsmds-arco/test/views/purchase-order-pages.test.ts`。
  - 运行 Web 类型检查：`pnpm -C web typecheck`。
  - 运行 Web Lint：`pnpm -C web lint`。
  - 在前后端测试运行态可用时运行目标浏览器测试：
    `pnpm -C web exec node --test --test-concurrency=1 apps/qsmds-arco/test/browser/purchase-orders.browser.test.mjs`。
  - 运行仓库总检查：`node --run check`。
  - 运行 `git diff --check`，并确认没有 API、Schema、migration、OpenAPI、Server 或公共组件变更。
  - _Requirements: R1, R2, R3, R4, R5_

- [ ] 8. 更新任务状态并创建业务实现提交
  - 将全部已完成任务逐项勾选，并把本文件状态更新为“已完成”。
  - 检查 Git 暂存范围，不包含 `.env`、日志、生成目录、构建产物或无关用户改动。
  - 创建本地提交：`feat: 支持销售订单快捷新增采购`。
  - 记录提交 SHA、定向测试、类型检查、Lint、浏览器测试、仓库总检查和工作区状态。
  - 不推送远端，不创建 PR。
  - _Requirements: R1, R2, R3, R4, R5_

## 4. 完成定义

只有同时满足以下条件才可声明实施完成：

1. 所有任务均已勾选且规格状态准确；
2. 逻辑测试和页面契约测试均先观察到有效 RED，再在实现后转绿；
3. 销售待采购操作、权限、命名路由和三个查询参数符合设计；
4. 自动绑定经过采购域接口确认且不会覆盖用户选择；
5. 非法、失效和失败来源均可安全回退到手工选择；
6. 不自动同步产品、不自动提交、不改变备货采购或销售采购覆盖规则；
7. 定向测试、类型检查、Lint、目标浏览器测试和 `node --run check` 全部通过；
8. 两个本地提交完成，工作区干净且未推送远端。
