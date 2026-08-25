# 销售订单收款与凭证实施任务

## 1. 文档状态

- 状态：Phase 4 实施完成，等待用户手动验收
- 拆分日期：2026-08-25
- 需求基线：[requirements.md](./requirements.md)
- 技术基线：[design.md](./design.md)
- 当前分支：`feat/sales-order-domain`
- 任务基线提交：`9488f91`
- Phase 4 已授权，按本文任务顺序实施并逐项记录验证证据

## 2. 执行纪律

1. 按本文依赖顺序串行实施，同一时间只处理一个任务；复杂修改先建立聚焦失败测试，再做最小实现。
2. 不改变一单一币种、含税销售总价、金额三等式、正式保存才派号、客户快照和三套状态独立等既有不变量。
3. 收款与唯一凭证必须在同一数据库事务内提交；不得用前端连续调用两个写接口模拟原子性。
4. `referenceNo/reference_no` 必须从 Schema、迁移、DTO、服务、响应、OpenAPI 和 Web 类型中物理移除，不保留兼容字段。
5. OpenAPI 受管产物只通过 `node --run contract:sync` 更新，不手工修改生成文件。
6. 数据库迁移必须先在隔离 PostgreSQL 验证，再应用到目标开发库；迁移断言失败时停止，不自动删除或合并历史凭证。
7. 只运行与本变更直接相关的聚焦测试、两个依赖域 typecheck、契约检查和必要真实浏览器流程；不默认运行根全量检查或无关浏览器套件。
8. 若验证需要重启前后端，先检查端口和进程归属，只重启本仓库目标服务并直接执行，无需重复向用户确认；随后验证 Web 200、Server health 和数据库 `up`。
9. 命令、测试或迁移失败必须如实记录，不跳过、不隐藏，也不以源码检查替代真实交互。
10. 每个任务完成后精确暂存目标文件并创建独立提交；不得使用 `git add -A`，不得推送、合并或部署。
11. 每完成一个任务就更新本文复选框和验证证据；证据必须来自最新命令输出。

## 3. 实施门禁

- [x] Gate A：需求规格已确认。
- [x] Gate B：技术方案已确认。
- [x] Gate C：本文任务、顺序、公共 API、Schema/migration 和验证范围已确认。
- [x] Gate D：Phase 4 实施与目标开发库迁移完成。
- [x] Gate E：聚焦自动化与真实浏览器流程通过。
- [ ] Gate F：用户手动验收完成。

以下任一情况必须暂停并重新确认：

- 需要增加签收审批表、退款模型、签收人/签收时间等未确认字段。
- 需要改变出单凭证单份必传、每笔收款单份凭证或含税累计收款规则。
- 需要为历史缺失订单伪造或自动生成出单凭证。
- 需要保留 `referenceNo` 兼容字段或恢复被删除的历史流水号数据。
- 需要新增本文未列出的公共 API、权限码、第三方依赖或持久化 Store。
- 需要推送、合并、部署或运行无关全量测试。

## 4. 任务依赖

```mermaid
flowchart LR
  T1[T1 基线与 RED]
  T2[T2 Schema 与迁移]
  T3[T3 出单凭证]
  T4[T4 收款原子事务]
  T5[T5 货物签收]
  T6[T6 OpenAPI 与 Web API]
  T7[T7 创建页改造]
  T8[T8 两个操作弹窗与记录展示]
  T9[T9 迁移与聚焦验收]

  T1 --> T2 --> T3 --> T4 --> T5 --> T6 --> T7 --> T8 --> T9
```

## 5. 实施任务

需求覆盖矩阵：

| 需求 | 主要任务 |
| --- | --- |
| R1 | Task 1、3、6、7、9 |
| R2 | Task 1、3、4、5、7、8、9 |
| R3 | Task 1、2、4、6、8、9 |
| R4 | Task 1、2、4、6、8、9 |
| R5 | Task 1、2、4、8、9 |
| R6 | Task 1、5、6、8、9 |
| R7 | Task 1、2、3、4、5、6、8、9 |
| R8 | Task 1、2、3、4、5、6、9 |

### Task 1：冻结基线并建立聚焦失败测试

**目标**

把已确认业务口径转换为可失败的 Schema、Service、契约和 Web 测试，同时证明既有销售订单聚焦基线可运行。

**步骤**

- [x] 1.1 复核当前分支、HEAD、工作区、需求与技术设计，记录用户已有改动并避免覆盖。
- [x] 1.2 运行现有销售订单 Server 和 Web 聚焦测试，保存基线结果，不运行根全量套件。
- [x] 1.3 增加 Schema RED：五种收款类型、三种凭证类型、删除 `reference_no`、凭证关系形状和两个部分唯一索引。
- [x] 1.4 增加创建 RED：缺少/多份出单凭证、类型固定、媒体失败时订单回滚、唯一凭证不可解除。
- [x] 1.5 增加收款 RED：五种类型、请求中不存在流水号、凭证必传唯一、事务任一步失败整体回滚、开票税金计入累计。
- [x] 1.6 增加货物签收 RED：请求只有媒体 UUID、创建订单级签收单、不改变 `fulfillmentStatus` 或状态历史。
- [x] 1.7 增加 Web RED：创建页单文件硬拦截、两个弹窗字段、自动标题、订单级/收款级凭证展示。

**基线验证命令**

```bash
pnpm -C server exec jest src/modules/sales-orders --runInBand
pnpm -C web exec tsx --test \
  apps/qsmds-arco/test/api/sales-orders.test.ts \
  apps/qsmds-arco/test/views/sales-order-create.logic.test.ts \
  apps/qsmds-arco/test/views/sales-order-create-view.logic.test.ts \
  apps/qsmds-arco/test/views/sales-order-pages.test.ts
```

**完成条件**

- 既有聚焦基线通过；新增测试只因目标能力未实现而按预期失败。
- 失败日志不包含 Cookie、客户完整地址、媒体内容或私有存储路径。

**提交建议**：与 Task 2–5 对应实现一起提交，不保留长期 RED 提交。

**覆盖需求**：R1-R8。

### Task 2：修改 Prisma Schema 并实现数据迁移

**目标**

建立目标枚举、字段和数据库不变量，并提供可在隔离 PostgreSQL 重复验证的 append-only migration。

**步骤**

- [x] 2.1 将 `SalesOrderPaymentType` 扩展为 `DEPOSIT | PROGRESS | INVOICE_TAX | BALANCE | OTHER`。
- [x] 2.2 将 `SalesOrderDocumentType` 收敛为 `ORDER_ISSUANCE_VOUCHER | PAYMENT_VOUCHER | DELIVERY_RECEIPT`。
- [x] 2.3 从 Prisma `SalesOrderPayment` 物理删除 `referenceNo`。
- [x] 2.4 编写 append-only migration：重建 Enum、确定性映射历史凭证、删除 `reference_no`、更新不可变触发器。
- [x] 2.5 增加凭证类型与 `payment_id` 形状约束、出单凭证和收款凭证部分唯一索引。
- [x] 2.6 在迁移中加入失败关闭断言；不得自动处理同订单多份出单凭证或同收款多份收款凭证。
- [x] 2.7 使用迁移前 Fixture 验证旧枚举组合映射、历史缺失出单凭证仍可读和流水号列确实不存在。
- [x] 2.8 运行 Prisma validate、drift gate 和聚焦 Schema 测试。

**完成条件**

- 隔离数据库可从当前迁移头完整 deploy 到目标 Schema。
- 约束拒绝错误 `documentType/paymentId` 组合和重复有效关联。
- `reference_no` 不存在，Prisma Client 不生成 `referenceNo`。

**提交建议**：`feat: 收紧销售订单收款与凭证数据模型`

**覆盖需求**：R3-R5、R7-R8。

### Task 3：收紧创建订单与出单凭证事务

**目标**

把创建订单的 `documents[]` 改为唯一 `issuanceVoucher`，在现有幂等发号后的最终事务内生成并保存出单凭证。

**步骤**

- [x] 3.1 修改创建 DTO、Normalizer 和内部命令，要求 `issuanceVoucher.mediaAssetId` 且拒绝旧 `documents` 字段。
- [x] 3.2 将媒体 UUID 纳入规范化请求指纹，保持同一幂等键内容绑定。
- [x] 3.3 新增服务端自动标题纯函数，覆盖 NFKC、七种凭证文案、`Asia/Shanghai` 时间戳和 Unicode code point 截断。
- [x] 3.4 在订单最终事务中验证并激活唯一临时媒体，生成标题并创建 `ORDER_ISSUANCE_VOUCHER`。
- [x] 3.5 让创建路由同时要求 `sales-orders:create` 和 `sales-orders:document`。
- [x] 3.6 禁止通用解除接口移除出单凭证，增加稳定领域错误和审计断言。
- [x] 3.7 运行创建 DTO、Normalizer、指纹和 Command Service 聚焦测试。

**完成条件**

- 无凭证、多凭证、不可用媒体或权限不足均无法创建订单。
- 订单、明细与出单凭证同时成功或同时回滚；上传动作仍不发号。
- 服务端标题是最终真相，原始文件名保留在 `MediaAsset`。

**提交建议**：`feat: 新增订单强制保存唯一出单凭证`

**覆盖需求**：R1-R2、R7-R8。

### Task 4：实现收款与唯一凭证原子事务

**目标**

扩展现有添加收款接口，在同一事务中创建实际收款、唯一凭证、付款状态和审计记录。

**步骤**

- [x] 4.1 修改 `SalesOrderPaymentRequestDto`：增加 `voucher.mediaAssetId`，删除 `referenceNo`，保留收款方式与备注。
- [x] 4.2 扩展收款类型校验和展示映射，确保 `INVOICE_TAX` 与其他类型共同参与有效收款汇总。
- [x] 4.3 事务内锁定订单，校验取消状态、未来时间、正数金额、超收和临时媒体归属/状态。
- [x] 4.4 创建收款后使用其 ID 创建唯一 `PAYMENT_VOUCHER`，并按收款类型生成标题。
- [x] 4.5 更新付款状态和订单版本，记录收款与凭证审计；任一步失败时整笔事务回滚。
- [x] 4.6 让添加收款路由同时要求 `sales-orders:payment` 和 `sales-orders:document`。
- [x] 4.7 修改查询响应，使每笔收款返回非空唯一 `voucher`，同时保持订单凭证总列表可查询。
- [x] 4.8 作废收款时保留关联凭证，重新计算付款状态并显示收款已作废语义。
- [x] 4.9 禁止通用解除接口移除收款凭证，补齐领域错误与测试。

**完成条件**

- 每笔新收款恰好一份凭证，不存在无凭证到账记录。
- 开票税金计入累计已收；任何类型收款均不得超过含税销售总价。
- 作废不删除凭证，付款状态按未作废收款重新派生。

**提交建议**：`feat: 实现收款与凭证原子保存`

**覆盖需求**：R2-R5、R7-R8。

### Task 5：实现货物签收专用接口

**目标**

提供只上传一份签收单的受控入口，保存订单级凭证且不改变订单进度。

**步骤**

- [x] 5.1 新增 `SalesOrderDeliveryReceiptRequestDto`，只接收一个 `mediaAssetId`。
- [x] 5.2 新增 `POST /sales-orders/:salesOrderId/delivery-receipts` 和唯一 operationId，使用 `sales-orders:document`。
- [x] 5.3 在事务内锁定订单、验证并激活媒体、生成签收单标题、创建 `DELIVERY_RECEIPT`。
- [x] 5.4 只递增订单版本并写凭证审计，不修改 `fulfillmentStatus`，不写状态历史。
- [x] 5.5 保留同订单多次提交能力，每次请求只创建一份签收单。
- [x] 5.6 移除通用 `POST /sales-orders/:salesOrderId/documents` 写接口；内容读取接口保持不变。
- [x] 5.7 运行 DTO、Controller、Document Service 和 Query Service 聚焦测试。

**完成条件**

- 弹窗请求不能提交签收人、签收时间、备注或履约状态。
- 上传成功后订单进度保持原值；既有进入 `SIGNED` 的签收单门禁仍有效。

**提交建议**：`feat: 新增销售订单货物签收入口`

**覆盖需求**：R2、R6-R8。

### Task 6：同步 OpenAPI 与 Web API 适配器

**目标**

以 Server DTO 和 Controller 为真相源更新公共契约，并为三个 Web 业务入口提供可取消、不可自动重试的 API 方法。

**步骤**

- [x] 6.1 补齐创建订单、添加收款、作废收款、货物签收和凭证详情的 OpenAPI decorators 与错误矩阵。
- [x] 6.2 运行 `node --run contract:sync` 更新 Server/Web OpenAPI 快照和 Web 生成类型，不手改生成文件。
- [x] 6.3 修改 `salesOrdersApi.create` 的单份出单凭证映射。
- [x] 6.4 新增 `recordPayment`、`voidPayment` 和 `submitDeliveryReceipt` Web API 适配方法，传递 `AbortSignal` 并设置 `retry: false`。
- [x] 6.5 确认生成类型和源码中不存在 `referenceNo`，旧通用凭证写 operationId 不再出现。
- [x] 6.6 增加 API 聚焦测试并运行 `node --run contract:check`。

**完成条件**

- Server OpenAPI、Web snapshot、生成类型和适配器一致。
- Mutation 失败保持局部错误展示，不被全局重试或静默吞掉。

**提交建议**：`feat: 同步销售订单收款与签收契约`

**覆盖需求**：R1-R8。

### Task 7：改造新增订单出单凭证步骤

**目标**

把创建页通用订单凭证步骤收敛为单份必传出单凭证，并复用自动标题和媒体预览能力。

**步骤**

- [x] 7.1 修改表单模型和 DTO builder：`documents[]` 改为可空单个 `issuanceVoucher` 编辑状态，提交 DTO 必须非空。
- [x] 7.2 将步骤和卡片文案改为“出单凭证”，移除类型选择器、标题输入、凭证备注和文件 `multiple`。
- [x] 7.3 上传成功后禁用继续添加，保留提交前移除并重新上传。
- [x] 7.4 显示原始文件名、媒体信息、`FaImagePreview` 和自动标题预览。
- [x] 7.5 在点击下一步、进入最终核对和正式提交三处硬拦截缺失凭证。
- [x] 7.6 无 `sales-orders:document` 权限时显示硬拦截，不再允许无凭证创建。
- [x] 7.7 更新 `QsSalesOrderDesc` 核对内容，出单凭证只显示一份缩略图与系统标题。
- [x] 7.8 运行 create logic、view 和 page 聚焦测试。

**完成条件**

- 页面不再出现定金凭证、签收单或其他凭证类型选择。
- 用户只能维持 0/1 份编辑态文件，只有 1 份时才能提交订单。
- 服务端返回的系统标题覆盖前端预览差异。

**提交建议**：`feat: 新增订单改为单份出单凭证`

**覆盖需求**：R1-R2、R7。

### Task 8：实现添加收款、货物签收与记录展示

**目标**

在现有订单记录弹窗中增加两个受权限控制的操作入口，并准确展示三类凭证归属。

**步骤**

- [x] 8.1 在“实际收款记录”弹窗标题区域增加“添加收款”按钮，组合校验 payment + document 权限。
- [x] 8.2 创建添加收款弹窗：五种类型、金额、收款时间、方式、备注、单文件凭证上传；不得出现流水号字段。
- [x] 8.3 实现上传预览、自动标题、提交锁、Abort、权限、未来时间、金额和局部错误状态。
- [x] 8.4 在“订单凭证”弹窗标题区域增加“货物签收”按钮，弹窗只显示单文件上传、预览、自动标题和错误。
- [x] 8.5 提交货物签收时不传递任何履约状态；成功提示不得宣称订单已经签收。
- [x] 8.6 更新凭证详情：出单凭证/签收单显示“订单级凭证”，收款凭证显示收款类型、金额、时间及有效/已作废状态。
- [x] 8.7 图片继续使用 `FaImagePreview`；文档继续使用受权内容 URL。
- [x] 8.8 成功后刷新详情和列表汇总，桌面与窄屏保持相同入口和结果。
- [x] 8.9 运行弹窗逻辑、页面契约、API 和可访问性聚焦测试。

**完成条件**

- 收款和货物签收均通过明确按钮进入，不复用通用凭证类型选择器。
- 所有正式凭证标题符合“客户名-凭证类型-时间戳”。
- 正常订单级凭证不再显示“未关联收款记录”。

**提交建议**：`feat: 增加订单收款与货物签收弹窗`

**覆盖需求**：R2-R7。

### Task 9：执行迁移并完成聚焦验收

**目标**

验证数据库、Server、契约和 Web 的完整闭环，将迁移安全应用到目标开发库并提供真实交互证据。

**步骤**

- [x] 9.1 在隔离 PostgreSQL 从空库完整 deploy，运行 Schema/迁移 E2E 和历史 Fixture 映射断言。
- [x] 9.2 在目标开发库迁移前只读记录：订单数、凭证类型/关联分布、实际收款类型和 `reference_no` 非空数量。
- [x] 9.3 确认只读结果满足设计断言后执行 `pnpm -C server db:migrate:deploy`，迁移失败立即停止。
- [x] 9.4 迁移后验证目标 Enum、列删除、凭证映射、约束、索引和数据库健康状态。
- [x] 9.5 运行销售订单 Server 聚焦测试、Server typecheck、契约同步/检查、Web 聚焦测试和 Web typecheck。
- [x] 9.6 按最小范围重启本仓库服务；浏览器核对单份出单凭证、五种收款类型入口、货物签收不自动更新订单进度和记录弹窗语义，事务语义由聚焦 E2E 覆盖。
- [ ] 9.7 已检查桌面与 390px 窄屏、单文件控件和 `FaImagePreview`；实际上传中/失败、键盘全流程与暗色主题留待用户手动验收。
- [x] 9.8 检查 Git diff、`.env`、日志、构建产物、OpenAPI 生成范围和提交历史。
- [x] 9.9 更新本文真实证据，提交最终任务状态，并等待用户手动验收。

**必要验证命令**

```bash
pnpm -C server prisma:validate
pnpm -C server exec jest src/modules/sales-orders --runInBand
pnpm -C server typecheck
node --run contract:sync
node --run contract:check
pnpm -C web exec tsx --test \
  apps/qsmds-arco/test/api/sales-orders.test.ts \
  apps/qsmds-arco/test/views/sales-order-create.logic.test.ts \
  apps/qsmds-arco/test/views/sales-order-create-view.logic.test.ts \
  apps/qsmds-arco/test/views/sales-order-pages.test.ts
pnpm -C web typecheck
git diff --check
```

**完成条件**

- 数据迁移、聚焦自动化、契约检查和真实关键流程全部通过。
- 目标开发库 `reference_no` 已删除，两份当前历史未关联 `DEPOSIT_VOUCHER` 映射为出单凭证，不伪造三张历史缺失凭证。
- Git 只包含已确认范围，不包含敏感文件、运行日志或无关用户改动。
- 用户可开始手动验收；未获授权前不推送、不合并、不部署。

**提交建议**：按前述任务拆分提交；最终只补充任务证据和必要收口，不压成单一大提交。

**覆盖需求**：R1-R8。

## 6. 最新验证证据（2026-08-25）

### 6.1 数据库与迁移

- `pnpm -C server prisma:validate`：通过。
- 隔离 PostgreSQL 从 25 份 migration 完整 deploy：通过。
- 销售订单迁移 E2E：`1/1` 通过；首次执行因测试清理遗漏已激活媒体而在 deferred constraint 阶段失败，补齐测试清理后重新执行通过。
- 目标开发库 migration deploy：通过。
- 迁移后只读审计：共 `5` 张订单、`0` 笔收款、`2` 份 `ORDER_ISSUANCE_VOUCHER`、`3` 张历史订单仍无出单凭证、`reference_no` 列数量为 `0`；未伪造历史缺失凭证。

### 6.2 Server、契约与 Web

- Server 销售订单聚焦 Jest：`10` 个 suite、`70` 个 test 全部通过。
- Server typecheck 与目标文件 ESLint：通过。
- `node --run contract:sync`、`node --run contract:check`：通过。
- Web 销售订单聚焦测试：`39/39` 通过。
- Web typecheck 与目标文件 ESLint：通过。
- `git diff --check`：通过。

### 6.3 运行态与浏览器

- Web `http://127.0.0.1:9000`：HTTP `200`。
- Server `http://127.0.0.1:3000/api/health`：HTTP `200`，database `up`。
- 真实登录态浏览器核对：实际收款弹窗包含五种收款类型、金额、时间、方式、备注与单份凭证，不含流水号；货物签收弹窗只上传一份签收单，并明确暂不自动更新订单进度。
- 新增订单通过 TWD 币种卡片进入，四步中包含“出单凭证”；DOM 中唯一文件控件 `multiple=false`。
- 390×844 窄屏下文档宽度未溢出视口，单文件约束保持不变；核对结束后已恢复默认 viewport。
- 浏览器 console error：`0`。
- 浏览器验收只进行了导航与只读检查，未上传文件、未新增收款、未新增签收单、未提交订单。

### 6.4 已知非阻塞记录

- 重启早期 Web 代理曾在 Server 尚未 ready 时出现一次 `ECONNREFUSED`；轮询后 Web、Server 与数据库健康检查均通过。
- 两次只读数据库审计命令分别因 `.env` 路径和临时运行器不可用而在查询前失败；改用项目现有 PostgreSQL 驱动后成功取得上述审计结果，未修改数据。
- Gate F 保持未完成；实际文件上传中/失败、键盘全流程、暗色主题及最终业务提交由用户手动验收。

### 6.5 实施提交

- `eaf8559 feat: 收紧销售订单收款与凭证事务`
- `e685fa6 feat: 同步销售订单收款与签收契约`
- `5ce7483 feat: 新增订单改为单份出单凭证`
- `3af7c71 feat: 增加订单收款与货物签收弹窗`
