# 采购唛头规则绑定与自动派发技术设计

状态：绑定配置已完成。用户现已明确确认第 3.2 节采购关联、第 4 节内部事务入口、第 5.2/5.3 节解析及创建契约、第 6.3 节采购页接入。详情派发摘要为可选项，本轮不增加；通过持久化关联与创建审计追溯。执行范围和验证见 [派发任务](issuance-tasks.md)，原绑定阶段记录见 [任务](tasks.md)。

## 1. 当前真相源

| 来源 | 已核对事实 |
| --- | --- |
| [Prisma schema](../../server/prisma/schema.prisma) | 供应商来自字典；Product / PurchaseOrder 保存 `supplierValue`；自定义采购保存 `customSupplierName`；采购单现有 `shippingMarkText` 为可空文本 |
| [字典 Lookup](../../server/src/modules/dictionaries/dictionary-lookup.service.ts) | 写入有效值校验在调用方事务中对 Type / Item 加共享锁；历史读取允许解析停用、未知值 |
| [编号 Generator](../../server/src/modules/numbering/numbering-generator.service.ts) | `generate / generateScoped` 自行开启事务；`generateScopedInTransaction` 使用调用方事务并返回台账 ID；共用幂等、规则检查、计数和随机冲突状态机 |
| [编号持久化](../../server/src/modules/numbering/numbering-generator.persistence.ts) | Rule 使用 `FOR SHARE`；PeriodState 使用 `FOR UPDATE`；Issuance 按规则内文本、消费者加幂等键保持唯一 |
| [采购创建](../../server/src/modules/purchase-orders/purchase-order-command.service.ts) | 预检后独立派发采购单号，再以 Serializable 事务派发唛头并保存订单、明细、销售覆盖进度及审计 |
| [采购创建指纹](../../server/src/modules/purchase-orders/purchase-order-create-fingerprint.ts) | 当前指纹版本为 `purchase-order.create.v3`，包含 `expectedShippingMarkResolution`，拒绝手填 `shippingMarkText` |
| [采购创建页面](../../web/apps/qsmds-arco/src/views/operations/purchase-orders/create.vue) | 第三步为唛头与备注；最终二次确认后才冻结请求和幂等键；有未知结果恢复路径 |
| [编号路由](../../web/apps/qsmds-arco/src/router/modules/basic.data.ts) | 已有编号列表及隐藏的独立新增页，可沿用 activeMenu 组织配置页 |

不把过去已实施规格中的“尚未部署”等历史状态作为当前部署事实。接入前已只读核对规则及绑定，实际配置可能继续变化；本轮不更改业务库中的供应商、绑定及规则配置。

## 2. 架构与职责

本轮实际依赖：`PurchaseOrdersModule → PurchaseShippingMarksModule → Prisma / Dictionary / Auth`；采购命令同时调用 NumberingModule 的内部事务入口。Numbering 不依赖采购模块。审计沿用 AuthModule 导出的 AuditService。

- 采购专属 `PurchaseShippingMarksModule` 承载绑定配置与场景解析；唛头消费事务由采购命令编排。UI 入口属于编号管理，不意味着将采购语义写入编号引擎。
- `PurchaseOrdersModule` 依赖该模块及 NumberingModule；场景解析模块依赖 Dictionary、Auth、Prisma。Numbering 不反向依赖采购模块。
- 不恢复 Supplier API / Store / Prisma model，不给通用 DictionaryItem 添加唛头专用字段，不引入通用“任意实体绑定引擎”。
- 规则状态/用途/生效版本摘要由采购配置服务按现有 model 只读解析；不复制编号渲染、容量或计数算法。是否耗尽、配置能否生成由正式 Generator 最终判断，页面显示“提交时最终校验”，不承诺预留容量。

## 3. 数据结构（3.1 已完成，3.2 本轮已授权）

### 3.1 供应商规则绑定

新增 `SupplierShippingMarkRuleBinding`，映射表 `supplier_shipping_mark_rule_bindings`：

| 字段 | 约束 |
| --- | --- |
| `supplierValue` | 稳定字典 value，`varchar(64)`，主键；字典类型固定为 `service_provider.supplier`，不存标签或字典 UUID |
| `ruleId` | 必填 UUID，关联 NumberingRule，Restrict 更新/删除；非唯一，允许多供应商共用 |
| `version` | 正整数，从 1 开始；每次实际更换绑定递增 |
| `createdByUserId / updatedByUserId` | 必填，关联 User，用于配置追溯 |
| `createdAt / updatedAt` | 数据库时间 |

首版只支持首次设置和更换，不提供删除配置或独立启停开关。未配置就是无绑定行，停用由供应商/规则自身状态表达。

数据库保证主键、外键、版本合法及供应商 value 身份不可变；增加具名 Trigger 验证固定字典类型中存在该 value、绑定规则用途为 `SHIPPING_MARK`。保存时服务端在事务内校验供应商有效和规则已启用且有生效版本；之后停用供应商或规则不删除绑定，不用动态 CHECK 阻止其合法停用。

### 3.2 采购唛头派发关联

- PurchaseOrder 新增可空 `shippingMarkIssuanceId`，唯一关联 NumberingIssuance，Restrict 更新/删除。
- 继续使用 `shippingMarkText` 展示和搜索唛头，自动生成订单的文本必须等于关联 Issuance 的 `generatedNumber`。
- 规则 ID、规则版本和派发时间通过不可变 Issuance 读取，不在采购单重复保存一组可能不一致的版本字段。
- 历史行保留空关联及原有唛头文本；迁移不回填、不重算、不生成编号。
- 新 INSERT 必须携带唛头关联；数据库触发器验证规则用途、消费者编码、订单与派发幂等键摘要/请求摘要一致及文本相等。历史 UPDATE 不补填关联，唛头文本与派发关联均保持不可变。
- 不对 `shippingMarkText` 添加全局唯一约束。现有引擎只保证规则内文本唯一；不同规则可产生相同文本，配置时应使用可区分的前缀。

### 3.3 审计及迁移边界

- 新增绑定设置/更换的 AuditEvent 类型，记录 supplierValue、前后 ruleId、配置版本及操作者，不记录完整请求。
- 采购创建审计追加唛头规则/版本/派发 ID；不另造一套编号派发日志，不回填历史审计。
- 只追加新的 migration：绑定表、采购关联及约束、权限和审计枚举；不修改旧 migration，不创建真实绑定，不创建或启用 `CUSTOM_MARK`。
- 迁移需验证历史采购单及既有编号规则、版本、计数、issuance 的数量和内容摘要不变。

## 4. 事务、并发与重试

### 4.1 关键设计选择

不连续调用两次各自提交的 `generateScoped()` 来生成采购单号和唛头后再保存订单。新增唛头应与订单、明细、销售覆盖进度和创建审计在同一个采购事务中提交。

为此给 NumberingGeneratorService 增加一个**仅 Server 内部的受控事务入口** `generateScopedInTransaction(transaction, input)`：

- 复用同一套输入校验、生成状态机、渲染器、计数和随机冲突算法，不新增 HTTP 发号接口。
- 原 `generate / generateScoped` 签名、独立事务、永久派发及现有调用方行为不变。
- 调用方须在事务第一条 SQL 设置固定超时；调整内部封装以避免重复设置和嵌套事务，业务不自行修改锁超时。
- 新入口不在失败的 PostgreSQL 事务里尝试重放。错误退出后，由采购创建在新事务/连接中恢复原采购结果；找不到已提交订单时返回可识别失败，不盲目再次发号。
- 仅新内部入口的结果附带 `issuanceId`（生成和重放均返回），原入口返回契约保持不变；复用内部 ledger 查询，不从采购模块直接调用私有编号持久化函数。

这属于已明确批准的**编号服务事务接入能力的窄扩展**。规则算法、配置、计数维度及永久派发语义不改变，不新增跨事务待创建请求表或补偿状态机。

现有采购单号仍沿用原独立幂等派发，首版不改变其已占号但未成单的既有恢复语义，也不承诺采购单号无断号。

### 4.2 提交流程

1. 校验身份和请求，计算新版创建指纹，按原幂等键查询已创建采购单。命中且身份/指纹一致时直接返回既有结果，优先于当前绑定和规则检查。
2. 只读预检采购资料及匹配规则，核对前端提交的匹配快照标识；明显缺配置或不可用时在采购单号派发前失败。
3. 按原 `PURCHASE_ORDER.CREATE` 消费者派发或恢复采购单号。
4. 开启采购 Serializable 事务并先设置超时。重读现有结果和全部采购依赖，再锁定/解析供应商绑定及规则；验证匹配快照。
5. 调用新增内部事务入口，使用独立消费者 `PURCHASE_ORDER.SHIPPING_MARK`、原创建幂等键及新版完整请求指纹派发唛头。
6. 保存采购单的唛头文本与派发 ID，写入明细、销售覆盖状态和审计，然后统一提交。
7. 返回原创建响应；列表和抽屉继续通过 `shippingMarkText` 展示。成功后跳转采购列表。

锁顺序先沿用采购依赖锁序；在进入唛头部分后固定为 Dictionary Type / Item → Binding → NumberingRule（共享锁）→ NumberingPeriodState（更新锁）。Binding 保存使用 Dictionary → Binding → NumberingRule，不先锁规则再反向获取绑定。编号生效版本在 Rule 锁下读取；不得先做快照校验再释放锁生成。

并发首绑由 supplierValue 唯一键裁决；并发采购沿用序列锁和幂等唯一约束。Serializable 失败、锁超时、幂等竞态均通过安全错误映射退出；采购事务回滚后再查既有订单恢复响应，禁止在 aborted transaction 中继续查询。

### 4.3 失败语义

- 未提交的采购事务失败：本次唛头 ledger、计数、订单、明细和关联销售状态全部回滚；未提交候选不是正式派发，也不向前端显示。
- 已提交但响应丢失：前端保留原请求及幂等键，重试返回原订单和唛头；绑定改变、规则停用不导致补发。
- 已完成派发不会因取消采购或业务重试回收。这里回滚的是未提交事务，不是删除已发布 issuance。
- 不同身份或不同请求复用同一幂等键：冲突。只读规则匹配失败不得被视为未知提交；真正的提交结果未知禁止编辑请求或生成新幂等键自动重试。

## 5. API 与权限（5.1 已完成，5.2 / 5.3 本轮已授权）

所有接口沿用 Controller → Service → Prisma、统一 ApiError、Request ID、CSRF 与 OpenAPI 生成契约，不手写 generated types。

### 5.1 绑定管理

新增权限 `purchase-shipping-marks:read / purchase-shipping-marks:update`，只默认授予 system_admin，其他角色不自动升权；更新接口同时要求读取与修改权限。

| 接口 | 请求及行为 |
| --- | --- |
| `GET /api/purchase-shipping-mark-bindings` | 分页、关键词和绑定状态过滤；以供应商字典全集为基底左关联配置，包含未绑定及已停用项；返回 items/total 和固定 `customRule` 状态摘要 |
| `GET /api/purchase-shipping-mark-bindings/rule-options` | 分页搜索可绑定规则，只返回 `SHIPPING_MARK + ENABLED + ACTIVE version`，不排除已被其他供应商绑定的规则 |
| `PUT /api/purchase-shipping-mark-bindings/{supplierValue}` | `{ ruleId, expectedVersion }`；首次 expectedVersion=0，更换带当前版本；冲突 409，未知字段 422；不能修改供应商身份 |

PUT 提交失败或响应未知时保留输入，通过重新读取确认最终配置，不擅自重试覆盖其他管理员的修改。配置保存不发号。查看完整规则详情另校验 `numbering-rules:read`，不借配置读取权限开放全部编号管理操作。

### 5.2 采购场景解析

新增只读 `GET /api/purchase-orders/shipping-mark-resolution`：

- CATALOG 输入 `productMode=CATALOG&supplierValue=...`；CUSTOM 仅输入 `productMode=CUSTOM`，不需要供应商姓名，不接收 ruleId/ruleCode。
- 使用现有合法采购创建权限（销售关联/备货权限按原有规则），不要求绑定管理权限；返回仅该场景的规则摘要，不泄漏完整配置列表。
- 响应包含 `productMode`、匹配来源、ruleId/ruleCode/name/activeRevision、`availability`、安全提示文本及 `resolutionToken`。`activeConfig` 为可空的当前生效配置，复用编号域配置契约；只返回该采购场景命中的唛头规则，不返回草稿或其他用途的配置。
- availability 区分 AVAILABLE、SUPPLIER_UNAVAILABLE、UNBOUND、RULE_MISSING、WRONG_PURPOSE、RULE_DISABLED、NO_ACTIVE_VERSION；这些是只读配置状态，不伪装成 HTTP 系统故障。
- 返回 AVAILABLE 只证明当前用途、启用和生效版本符合要求，不预留容量，不发号；耗尽与规则生成错误由提交时的 Generator 最终拒绝。
- resolutionToken 为服务端规范化的“产品类型、供应商稳定值、绑定版本、ruleId、activeRevision”摘要，CUSTOM 使用固定解析身份；不是客户端指定规则的权限凭据。

### 5.3 采购创建与读取

- `POST /api/purchase-orders` 移除客户端 `shippingMarkText`，新增必填 `expectedShippingMarkResolution`（64 位小写十六进制摘要）。移除后的旧字段即使为空也按未知字段拒绝，不静默接受旧手填流程。
- 服务端从真实产品类型/供应商重新解析规则，只将客户端摘要用于乐观并发比较；不接受客户端指定规则或最终编号。
- 请求指纹升级为 `purchase-order.create.v3`，去掉手填唛头，加入 expectedShippingMarkResolution，继续包含 actor、来源、产品、金额及其他业务输入。不得把派发时间或生成编号加入客户端请求指纹。
- 匹配摘要不一致返回 `409 PURCHASE_ORDER_SHIPPING_MARK_CONTEXT_CHANGED`，用户刷新规则、核对后重新确认；未知结果重试不能重算摘要。
- 配置无法满足提交时返回 `409 PURCHASE_ORDER_SHIPPING_MARK_UNAVAILABLE`，安全原因区分供应商、绑定、规则、容量等；临时并发冲突沿用或扩展原状态变化错误，不错误归因为缺配置。
- 列表 `shippingMarkText` 保持原契约；详情可新增可空 `shippingMarkIssuance` 摘要，提供 ID、ruleCode、revision、issuedAt。历史 null 明确表示无自动派发关联，不虚构历史记录。
- 新旧创建契约不同，发布时同步 Server/Web，并在维护窗口处理未完成提交、要求刷新旧页面；不擅自添加双写或旧请求兼容分支。历史订单读取不受此影响。

## 6. 页面与交互

### 6.1 视觉规格

- Purpose：内部管理员维护绑定，采购员确认可信的自动唛头来源，优先密度、状态辨识与可恢复性。
- Aesthetic：Industrial / utilitarian，沿用既有后台布局，不增加装饰性大卡片、额外动画或全局样式。
- Palette：沿用当前主题 primary / background / foreground / muted-foreground / destructive；绿色主色、浅色与暗色背景均由既有 token 解析，不新增硬编码色值。
- Typography：复用现有 `Noto Sans SC` 与 `Noto Sans Mono` 字体 token；规则编号、版本使用现有数据等宽类。
- Layout：左对齐页面标题，右侧操作；固定自定义规则摘要在上，供应商表格在下；沿用 `QsGenericTable` 的搜索、分页及窄屏能力。

### 6.2 配置页

- 新路由建议 `/system/basic-data/numbering/shipping-mark-bindings`，隐藏侧栏独立项，activeMenu 保持编号管理。
- 页头“唛头规则绑定”次要按钮按权限显示，不改变三个用途视图；页面只读权限独立校验，不因为父菜单不可见就绕过路由鉴权。
- 上部展示固定 `CUSTOM_MARK` 规则状态；缺失时提示管理员前往编号管理手工新建/发布/启用，不自动代为操作。
- 下部表格显示供应商、绑定规则、可用状态、设置/更换操作；供应商不可编辑，名称变化按字典最新 label 解析。
- 点击设置/更换采用表格内展开编辑区，规则下拉、共用流水说明、保存/取消；同一时刻编辑一行，切换行时确认放弃未保存选择，不新增大弹窗。
- 默认列出未绑定和已绑定供应商；停用项明确标识并禁用设置。失败、冲突时保留选中规则并支持刷新核对。

### 6.3 采购页

- 保留四步结构，将第三步手填唛头替换为只读规则摘要和“正式提交后自动派发”，采购备注继续编辑。
- 唛头区域采用三行紧凑摘要：“规则名称与可用状态 + 信息图标 → 真实编号结构 → 简短匹配来源与自动派发说明”，不使用内部分隔线；桌面正常状态目标高度 100–120px，长结构和窄屏自然换行。复用编号列表结构格式，不生成候选编号，无配置时不伪造结构。
- 信息图标支持悬停、点击和键盘焦点打开配置浮层，展示规则编码、匹配来源、生效版本、重置周期、时区、最大长度及完整提交校验说明；支持 Escape 和点击外部关闭，离开步骤或配置变化时关闭旧浮层。异常原因始终直接展示，不收入浮层。
- 第四步、右侧 QsPurchaseOrderDesc 和二次确认弹窗展示同一规则摘要，不能把预览编号当已派发编号。
- 选择/更换供应商或产品类型时取消旧匹配请求、清除旧摘要；保留 authEpoch/requestVersion 防止旧响应覆盖新选择，不重置无关产品金额。
- 未绑定/不可用时显示具体原因并阻止最终提交，提示联系管理员；不展示“刷新规则”或“查看唛头配置”按钮。网络失败后返回此步骤自动重新匹配，保留已填写内容；提交中或结果未知时仍禁止刷新。
- 绑定/版本变化返回冲突时回到第三步刷新核对；可纠正问题用轻提示，服务端异常/未知结果保留原恢复机制。
- 仅最终确认创建幂等键；返回修改、取消确认、只读解析不发号。新订单不提供手改/重生成唛头，历史详情沿用原文本显示。

## 7. 验证策略

绑定验证见 [实施任务](tasks.md)，以下采购自动派发验证本轮执行，结果见 [派发任务](issuance-tasks.md)：

1. TDD：先覆盖映射唯一性、稳定 value、更换版本冲突、CUSTOM 固定规则、用途/状态/版本校验、越权及公共 DTO 禁止手填，再实现最小业务能力。
2. 隔离 PostgreSQL：迁移历史文本不变、非法绑定被拒、自动订单缺关联/关联错误被拒、Issuance 不得重复关联、历史关联/文本不可变。
3. 原子性故障注入：在唛头生成后、订单创建后、明细保存后、销售进度更新后、审计前后制造失败，校验本次唛头与采购写入全部回滚；既有采购单号独立派发行为不被误判为唛头泄漏。
4. 并发与恢复：同键双击/不同键共用规则、响应丢失后重试、绑定更换、规则发布/停用、容量耗尽、锁超时、Serializable 冲突、随机文本碰撞；所有正式成功订单一单一个唛头，无重复消费。
5. 原编号回归：原 generate/generateScoped 的独立派发、重放、永久 ledger、随机重试、规则内唯一和容量统计保持原语义；新事务入口与旧入口复用相同算法。
6. Web：三步只读匹配不发号、最终确认才提交、旧响应隔离、错误定位、未知请求冻结、历史文本显示、配置权限与更新冲突；实际浏览器验证桌面/窄屏、键盘、亮暗主题。
7. 验证命令按实施文件确定：`pnpm -C server check`、`pnpm -C web check`、`node --run contract:sync` 后 `node --run contract:check`、`node --run ci:server-e2e`、`node --run ci:browser-numbering-e2e`、`node --run ci:browser-auth-e2e`、`git diff --check`。数据库 E2E 只用根隔离入口；共享 Prisma/API 生成命令串行执行。

## 8. 上线与审批

- 本轮交付采购自动派发；不创建或改写真实规则和绑定。只读核对时唯一供应商已绑定 TEST_MARK，且 CUSTOM_MARK 已启用并有生效版本；该检查不预留容量。
- 采购关联、场景解析、提交契约、内部事务入口已获得具体实施授权。
- 新增迁移不等于授权应用业务库。本轮仅隔离验证，启用功能前仍须明确授权应用 migration，并同步启用匹配的 Web/Server。
- 新契约要求刷新旧创建页；未完成的旧请求应在切换前处理，不能将 v2 未知结果改成 v3 新请求。未绑定或不可用配置会阻止新单创建，不退回手填。
- 不覆盖历史唛头、不修改旧迁移、不在业务库测试派号；不重启、不推送、不发布。
