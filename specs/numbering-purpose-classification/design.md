# 编号用途分类与新增页面设计

状态：用户已确认本设计（含第 2 节 schema/迁移结构、第 3 节公共 API 变化与页面交互）。当前仅进行任务拆解，尚未修改运行实现；业务库 migration 应用仍未授权。

## 1. 当前真相源

| 位置 | 已核对现状 |
| --- | --- |
| `server/prisma/schema.prisma` 的 `NumberingRule` | 无用途字段；`ruleCode` 全局唯一 |
| `NumberingPeriodState` / `NumberingIssuance` | 计数按规则与周期隔离；生成文本规则内唯一；幂等身份是 `consumerCode + idempotencyKeyHash` |
| `server/src/modules/numbering/numbering-query.service.ts` | 列表在 `RepeatableRead` 快照中读取；响应有 `items/page/pageSize/total`，无用途计数 |
| `server/src/modules/numbering/numbering-command.service.ts` | 创建和复制分别建立规则与草稿版本；编辑不允许改变规则编码；复制配置来自服务端 |
| `server/src/modules/numbering/dto/` | 新增、列表、详情均无用途字段；预览只接收规则配置与可选 `ruleId` |
| `web/apps/qsmds-arco/src/views/system/basic-data/numbering/` | 列表使用 `QsGenericTable`；新增/编辑/复制共用 `numbering-rule-editor-drawer.vue` 与维护 composable |
| `web/apps/qsmds-arco/src/components/business/QsStatusSwitchToolbar/` | 支持 `value/label/count`；页面负责查询，组件不绑定业务或 Router |
| `web/apps/qsmds-arco/src/components/business/QsPurchaseStartModal/index.vue` | 已有基于 `QsGenericModal` 的双卡片、原生 radio、键盘焦点与选中状态 |
| `web/apps/qsmds-arco/src/router/modules/basic.data.ts` | 编号列表路由为 `/system/basic-data/numbering`，无新增页路由 |

不调整 `rule-validation.ts`、`renderer.ts`、`capacity.ts`、`period.ts`、配置指纹、兼容性判断或 `NumberingGeneratorService`。目前单序列、输出字母表与长度、正式派发永久占号等约束继续成立。

## 2. 数据模型与迁移（结构已确认，业务库应用未授权）

### 2.1 用途属于规则，不属于规则配置

- 新增枚举 `NumberingRulePurpose`：`BUSINESS / SHIPPING_MARK`，数据库类型映射为 `numbering_rule_purpose`。
- `NumberingRule` 新增非空 `purpose` 字段。
- 用途不进入片段、规则版本配置或 `configFingerprint`；不增加用途版本，不创建新计数表或新派发表。
- 用途创建后固定，编辑请求不接受该字段。新的 migration 增加用途不可变的数据库保护，避免直接更新导致历史记录改类；不修改已提交迁移文件。
- 复制时服务端继承来源 `purpose`，不接受客户端覆盖。复制仍使用现有流程、权限与配置冻结策略；跨用途规则请通过新增入口创建。
- 派发记录通过父规则识别用途，详情头部展示分类，不重复存储用途，也不扩展每条派发记录 DTO。
- 继续保持 `ruleCode` 全局唯一，不改成“分类内唯一”；生成文本仍是规则内唯一，不借分类承诺跨规则文本全局唯一。

### 2.2 migration 的精确范围

1. 创建用途枚举并增加 `purpose`；迁移阶段以 `BUSINESS` 回填所有现有规则。
2. 最终列为 `NOT NULL`，不保留隐式默认用途；新建和复制服务必须显式写入，相关隔离测试夹具同步声明。
3. 为 `purpose` 增加不可变保护；规则名称、说明、状态、版本维护保持原有约束。
4. 增加组合索引 `(purpose, status, updatedAt DESC, id DESC)` 支撑分类和状态查询，保留原有索引支持全部编码视图。
5. 不更新现有规则的其他字段、不重建版本、不调整 `nextSequenceValue/usedCount`、不改写 issuance。

隔离数据库需分别验证历史回填、已用序列与已有编号原样保留、用途非法/为空/被修改的拒绝行为。业务数据库应用另行授权，本轮不执行。

## 3. 公共 API 变化（已确认）

沿用原路径和 `operationId`，不新增公开发号接口或用途专属权限。

| 接口/DTO | 已确认变化 |
| --- | --- |
| `POST /api/numbering-rules` | 请求新增必填 `purpose`，仅允许 `BUSINESS / SHIPPING_MARK`；缺失、`null`、`ALL` 或其他值返回既有 `422 VALIDATION_FAILED` |
| `GET /api/numbering-rules` | 查询新增可选 `purpose`；省略为全部，传入值只允许两类用途；`ALL` 仅是前端视图标识 |
| `NumberingRuleListItemDto` / `NumberingRuleDetailDto` | 新增必填 `purpose`；创建、编辑、复制、发布和启停返回详情时同样包含 |
| `NumberingRulePageDto` | 新增必填 `purposeCounts`，固定返回三项 `{ value, count }`，顺序为 `ALL/BUSINESS/SHIPPING_MARK`，零值项不省略 |
| 编辑与复制请求 | 不新增可写用途；非法携带用途继续按未知字段拒绝，复制用途从源规则取得 |
| 预览、版本列表、派发记录、内部生成服务 | 请求与响应结构不变 |

`purposeCounts` 示例仅用于契约说明，不是真实业务数据：

```json
[
  { "value": "ALL", "count": 12 },
  { "value": "BUSINESS", "count": 9 },
  { "value": "SHIPPING_MARK", "count": 3 }
]
```

### 3.1 统计口径

- 基础过滤条件：当前 `keyword + status`，复用现有规范化与搜索行为。
- `purposeCounts` 在基础条件下按用途聚合；不加入当前用途、分页和排序条件。
- 列表 `items/total` 在基础条件上叠加所选用途。
- `ALL = BUSINESS + SHIPPING_MARK`；选中用途的 `count = total`。计的是规则数，不是已派发编号数或容量。
- 三项计数与列表在已有 `RepeatableRead` 事务内读取，避免一份响应内计数与行数据来自不同快照。
- 只加一次分组聚合，不逐条规则查询，不重复计算容量；复用既有批量用量读取。不新建计数 HTTP 接口。
- API 输入、生成类型与运行时解码同步维护；未知用途或非法计数不能静默降级为业务编码/零。
- 创建/复制的现有审计事件记录用途；不新增审计事件类型，不把用途纳入编号配置指纹或派发请求指纹。

## 4. UI 设计规格

### 4.1 视觉基线

- **目的：**让编号管理员先明确用途，再在足够宽的空间完成规则配置；用途区别不应暗示不同的引擎能力。
- **风格：**`Industrial/utilitarian`，沿用现有内部业务工作台。双卡片按用户截图左右对称排列，不为视觉变化打破熟悉的选择模式；新增页使用非等宽的配置/预览分栏。
- **色板：**业务用途用现有 emerald 色系（深色字参考 `#047857`），唛头用途用 amber 色系（深色字参考 `#B45309`）；浅色背景参考 `#FFFFFF`、正文 `#18181B`、辅助字 `#71717A`。实现使用当前主题语义类及已存在的配对 tone，不硬编码全局颜色、不增加新主题；选中边框/主操作跟随 `primary`，暗色使用配对色。
- **字体：**沿用全局 `Noto Sans SC`；规则编码、用途技术标识、编号预览用既有等宽语义类对应 `Noto Sans Mono`，不在组件重复声明字体。
- **图标与动画：**统一 Lucide；颜色/边框过渡约 200ms，尊重 `prefers-reduced-motion`。用途不能只靠颜色区分，始终保留文字、radio 选中状态及勾选标记。

### 4.2 列表

从上到下：页面头及新增按钮 → `QsStatusSwitchToolbar` → 原有搜索/状态筛选与表格 → 分页。

- 默认 `ALL`；视图值通过白名单与列表路由查询同步，非法列表用途回到全部，不影响新增页严格校验。
- “用途分类”列位于编号规则与编号结构之间，建议 `minWidth: 120px`，展示普通中文文本，三种视图均保留。
- 用途筛选不再同时出现在表格筛选器里，避免两个控件维护同一条件。
- 切换用途保留其他过滤条件，只重置页码；快速切换沿用取消请求、请求版本与身份纪元保护。
- 响应未就绪或失败时不伪造零计数；成功后再把完整 `purposeCounts` 传给 `withStatusSwitchCounts`。
- 新建成功返回对应用途视图第一页，清空可能隐藏新草稿的搜索和状态条件；取消返回进入前的列表上下文。

### 4.3 用途选择弹窗

建议页面内组件 `numbering-purpose-select-modal.vue`，不新增到共享 packages，也不把采购供应商逻辑搬入编号域。

- 基于 `QsGenericModal`，`size="xl"`；标题“选择编码用途”，说明“先确定编码用途，再配置编号规则。两类编码使用相同的规则引擎与派发机制。”
- 左卡“业务编码”，图标 `i-lucide:binary`，技术标识 `BUSINESS`，说明“用于销售订单、采购订单、产品等业务编号”。
- 右卡“唛头编码”，图标 `i-lucide:tags`，技术标识 `SHIPPING_MARK`，说明“用于唛头编码规则；本期不自动填写采购唛头”。
- 参考采购产品类型弹窗：顶部图标+名称+用途辅助标签，中间虚线，下方用途字样/说明，右下低对比装饰图标，底部“点击选择 / 已选中”。
- 每次打开均无选中项，不因当前列表用途静默替用户确认；选中仅改变草稿选择，不立即跳转。
- 下方短提示“进入新增页后用途不可切换，请确认后继续”；底部“取消 / 进入新增规则”，未选择禁用继续。
- 原生 radio 与 `fieldset`，支持键盘操作、可见焦点；关闭恢复触发按钮焦点；路由切换期间禁止重复点击。
- 桌面两列，窄屏一列；不带供应商选择、第二步骤或采购校验。

### 4.4 新增页面

- 路由：`/system/basic-data/numbering/create?purpose=BUSINESS`（或 `SHIPPING_MARK`），名称拟为 `systemBasicDataNumberingCreate`。
- 路由隐藏菜单，`activeMenu` 指向编号管理；页面标题“新增编号规则”，面包屑体现编号管理上下文。不改变现有列表路径。
- 页面入口显式同时校验现有 `numbering-rules:read` 与 `numbering-rules:create`，与当前 `openCreateEditor` 一致；不假设路由权限数组一定是 AND。Server 原操作权限不变。
- 用途参数仅接受单个合法枚举；缺失、数组或非法值时，页面不渲染可提交表单，打开同一选择弹窗，取消返回列表。合法 URL 本身可作为明确的用途选择，不引入必须先弹过窗的临时令牌。
- 用途在页面顶部只读展示。URL 的用途不是权限凭据；同一路由更新用途时须经过未保存保护，并重新初始化表单，不能把旧输入带到另一用途。
- 从上到下：页头 → 用途/时区只读摘要 → 规则配置与预览 → 操作区。
- 桌面有效容器足够宽时按约 `2:1` 展示配置与预览，预览保持可见；空间不足改为上配置、下预览。容器使用 `min-width: 0`，片段区域必要时内部滚动，禁止撑宽整页。
- 配置保留现有规则编码、规则名称、重置周期、说明和片段编辑；预览继续使用 Server 结果，保持现有防抖、请求取消、字段错误及失效快照清理。
- 底部“取消 / 创建规则”。创建只保存 `DRAFT`，不顺便发布、启用或派发；成功轻提示后返回相应用途列表。
- 双击只产生一个在途请求；本地/服务端校验失败保留输入并定位字段。未知提交结果不自动重试、不误判成功、不直接跳走，提示核对规则记录，沿用现有恢复方式。
- 页面离开、关闭页签、用途变更和浏览器刷新均保留合适的未保存保护；成功返回仅放行本次离开，不永久关闭保护。未保存内容不写 localStorage，不新增自动草稿存储。

## 5. 前端复用与改动边界

1. 将抽屉中稳定的受控表单内容抽为本业务目录内的 `numbering-rule-form.vue`：管理字段、克隆表单、字段错误、片段编辑、dirty 与提交校验。当前新增页与编辑/复制抽屉已构成两个真实使用方，避免复制整份模板。
2. 抽屉壳继续管理 `QsGenericDrawer` 关闭确认；新增页壳管理页面路由离开。不能把 Drawer 关闭事件或 Router 行为塞进通用表单。
3. 复用 `numbering-segment-editor.vue`、`numbering-rule-preview.vue`、现有请求 builder、校验与维护 composable 的编辑/预览窄能力；不让新增页初始化无关的列表、详情、版本、派发请求。
4. 新增 `purpose` 的状态位于页面创建上下文；表单可只读展示它，但预览、编辑、复制 payload builder 不得因此多传字段。新增请求 builder 显式接收并校验用途。
5. 保留原编辑/复制抽屉文件，不删除文件；列表的新增点击改为弹窗，编辑/复制行为不变。详情头部补用途展示即可。
6. 继续使用正式 Web 应用的 HTTP/OpenAPI 客户端、权限、身份纪元和 i18n。用途选择不引入新的全局 Store、独立权限或通用流程引擎。

## 6. 验证与验收设计

以下为后续实施计划中的验证范围，本轮未执行这些功能测试：

- **TDD / Server：**用途必填/合法性；历史规则回填；编辑/复制覆盖用途的拒绝；复制继承；两种用途共享生命周期；用途不影响指纹、序列、预览与幂等；关键词/状态组合下的跨页计数和零值分组；列表/详情返回真实用途。
- **隔离 PostgreSQL：**先有历史规则和已发号记录再应用新迁移，验证除新增用途外的字段、版本配置、计数与 issuance 不变；新用途可配置、发布、启用并通过原内部生成服务派发；不同规则独立计数。不得用业务库派号做测试。
- **Web：**三视图与用途列；计数不取当前页；坏响应不伪造零；弹窗先选后继续、取消无写入；新增路由用途缺失/非法；新增 payload 携带用途，其他 payload 不携带；dirty/双击/未知结果/旧响应防护；编辑复制抽屉回归。
- **浏览器：**全部/业务/唛头视图及组合筛选；两种用途从弹窗到页面再到草稿列表；刷新、后退、直接访问与权限变化；键盘、亮暗主题、桌面及窄屏；预览不消耗编号；已有规则编辑与复制不回归。
- **命令：**`pnpm -C server check`、`pnpm -C web check`、`node --run contract:sync` 后 `node --run contract:check`、`node --run ci:browser-numbering-e2e`（根入口使用隔离数据库）、针对编号 schema/管理/派发的隔离 E2E、`git diff --check`。有共享生成目录的命令串行运行，避免 Prisma/API 生成竞态。

## 7. 审批与发布边界

- 需求基线及本技术设计已确认；实施任务见 `tasks.md`，当前尚未开始运行代码实施。
- 第 2 节 schema/迁移结构及第 3 节公共 API 变化已获确认。必填创建字段需要 Server 与 Web 契约同步交付，不提供静默缺省用途的兼容分支；超出已确认范围的变更需另行确认。
- 当前完成任务拆解，待用户确认任务计划后进入实施；不得将任务拆解或设计确认记为功能已交付。
- 不改旧 migration，不删除旧抽屉文件，不应用业务库 migration；应用业务库、重启、推送、发布不包含在本次设计工作内。
