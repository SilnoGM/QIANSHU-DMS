# 采购单复制文案与采购单图片格式实施步骤

需求见 [requirements.md](./requirements.md)。本文按三个可独立验证、独立提交的阶段推进：复制文案、采购单图片、采购审核通过通知（B 方案）。第三阶段依赖前两阶段的提示语常量与文案口径，应在它们合入后再动。

## 0. 前置检查

1. `git status` 确认工作区干净，或把用户已有改动与本任务分离；本任务不修改数据库、迁移和 OpenAPI。
2. 确认基线：`web` 与 `server` 依赖已安装，`pnpm -C web` 与 `pnpm -C server` 可用。
3. 确认当前图片模板版本为 `6`：`server/src/modules/purchase-orders/order-images/purchase-order-image-snapshot.ts`。
4. 记录基线测试结果，避免把既有失败误判为本次引入：
   - `pnpm_config_verify_deps_before_run=false pnpm -C web exec tsx --test apps/qsmds-arco/test/views/purchase-order-copy.test.ts apps/qsmds-arco/test/views/purchase-review-recovery.test.ts`
   - `pnpm_config_verify_deps_before_run=false pnpm -C server exec jest purchase-order-image`

## 1. 阶段一：复制文案

### 1.1 先写失败测试

`web/apps/qsmds-arco/test/views/purchase-order-copy.test.ts`

1. fixture 第 19-20 行的两条采购行：一条补 `description: '请附带说明书'`，另一条保持 `description: null`。
2. 第 46-66 行的整段期望文本改成需求 4.1 的格式：删除「出货请贴货物唛头：」，两处唛头行改为「唛头：【…】…」且不带提示语，第一条产品追加「备注：请附带说明书」，第二条不追加备注行，末尾恒定追加「采购备注：请将上述货件唛头贴到对应的包装箱 / 货物上」。
3. 新增用例覆盖：
   - 行备注为空时不产生任何备注行，且不出现「备注：-」。
   - 多行行备注按 `；` 压平。
   - 自定义采购备注存在时，采购备注段为「提示语；自定义备注」。
   - 已取消货件不出现（沿用现有用例）。
4. `web/apps/qsmds-arco/test/views/purchase-review-recovery.test.ts` 第 144 行的正则改为不含提示语的唛头行；该 fixture 无自定义备注，需断言末尾出现仅含提示语的采购备注段。

运行并确认失败原因是断言不符，而不是测试配置或环境错误。

### 1.2 语言包

`web/apps/qsmds-arco/src/locales/lang/purchase-review/zh-cn.json`

1. 删除 `copy.shippingTitle`。
2. `copy.part` 改为 `"{partLabel}：{products}\n唛头：{shippingMark}"`。
3. 新增 `copy.lineRemark`：`"备注：{remark}"`。
4. 新增 `copy.pasteHint`：`"请将上述货件唛头贴到对应的包装箱 / 货物上"`（不带括号）。
5. 新增 `copy.orderRemark`：`"采购备注：{remark}"`。
6. 保留抬头段现有的供货方占位符不动：根治理的供应商残留白名单要求该文件继续命中既有模式，删除占位符会让白名单条目失效并让根治理测试变红。

### 1.3 逻辑

`web/apps/qsmds-arco/src/views/operations/purchase-orders/purchase-order-copy.logic.ts`

1. 新增 `flattenRemark(value: string | null | undefined): string`：`split(/\r?\n/)` → 逐行 `trim` → 行内 `\s+` 折叠为半角空格 → 过滤空行 → `join('；')`。
2. 第 19-24 行 `lineText`：归一化行备注非空时，在该行「金额小计」后追加 `'\n' + t('purchaseReview.copy.lineRemark', { remark })`。
3. 第 34 行 `shippingMark`：去掉行内提示，恢复为 `mark ? `【${mark}】${part.shippingMarkSuffix ?? ''}` : t('purchaseReview.copy.pendingMark')`。
4. 第 39-52 行返回数组：
   - 删除 `${t('purchaseReview.copy.shippingTitle')}\n` 前缀，最后一段直接使用 `partsText`。
   - 恒定追加采购备注段：`t('purchaseReview.copy.orderRemark', { remark })`，其中 `remark` 为 `pasteHint`，存在归一化自定义备注时拼接 `；` 与其后。
5. 保持金额两位小数格式化、`未记录` 占位和产品名空白折叠行为不变。

### 1.4 验证

```
pnpm_config_verify_deps_before_run=false pnpm -C web exec tsx --test apps/qsmds-arco/test/views/purchase-order-copy.test.ts apps/qsmds-arco/test/views/purchase-review-recovery.test.ts
pnpm_config_verify_deps_before_run=false pnpm -C web run typecheck
```

浏览器 E2E `purchase-orders.browser.test.mjs` 只断言复制内容以单号开头并包含供货方名，不受影响；如时间允许本地跑一次复制交互确认。

### 1.5 提交

`feat: 采购单复制文案增加行备注与采购备注并统一唛头口径`

## 2. 阶段二：采购单图片

### 2.1 先写失败测试

1. `server/src/modules/purchase-orders/order-images/purchase-order-image-snapshot.spec.ts` 第 37 行版本断言改为 `7`。
2. `server/src/modules/purchase-orders/order-images/purchase-order-image-draft.service.spec.ts` 第 22 行的版本常量 mock 改为 `'7'`。
3. `server/src/modules/purchase-orders/order-images/purchase-order-image-renderer.spec.ts` 第 39 行 fixture 的 `templateVersion` 改为 `'7'`。
4. 渲染器断言基于像素和尺寸，无法断言文字；本阶段的文本类改动以人工出图验收为准，单测只保证尺寸、确定性和超限语义不变。

### 2.2 渲染逻辑

`server/src/modules/purchase-orders/order-images/purchase-order-image-renderer.ts`

1. 第 154-158 行「采购备注」段改为恒定渲染：
   - 先渲染红色加粗采购提示语，颜色继续使用 `COLORS.destructive`，字号与现有备注一致（23）。
   - 再在 `snapshot.remark` 非空时渲染灰色（`COLORS.muted`）自定义备注，保留原始换行。
   - 移除原来的 `if (snapshot.remark)` 条件。
2. 第 185 行：删除产品明细块的信息项 `product.productNo ?? '临时产品'`。
3. 第 186 行：删除产品明细块的信息项 `product.attributes.join('；')`。
4. 第 188 行：改为恒定渲染 `备注：${product.description?.trim() || '-'}`，字号 21、`COLORS.muted`；`trim` 用于把仅含空白的备注按空值处理。
5. 第 231-234 行：删除 `hint` 文本构造，只保留 `mark` 一行。
6. 第 236-245 行：删除「同一行并排」与「另起一行」两个分支，改为 `this.advance(mark.height + 20)`。
7. 第 250 行：货件区产品行去掉产品编号前缀，并在归一化行备注非空时拼接全角括号：`${product.productName}（${remark}）`。归一化规则与前端 `flattenRemark` 相同，建议在前端测试中保留同一份样例，服务端单测照抄期望字符串。
8. 提示语字面量提取为 `server/src/modules/purchase-orders/shipping-mark-label.ts` 中的常量（例如 `SHIPPING_MARK_PASTE_HINT`），由渲染器引用，为第三阶段的文本构造复用做准备。

### 2.3 版本升级

`server/src/modules/purchase-orders/order-images/purchase-order-image-snapshot.ts` 第 6 行：`PURCHASE_ORDER_IMAGE_TEMPLATE_VERSION` 由 `'6'` 改为 `'7'`。快照字段（`productNo`、`attributes`）保留，不修改快照结构与哈希算法。

注意 `templateVersion` 参与快照哈希，且草稿有效性判断会显式比对版本，因此升级后所有未归档草稿失效，审核返回 `PURCHASE_ORDER_IMAGE_STALE` 属预期行为。

### 2.4 人工出图验收

1. 用一条有行备注、一条无行备注的采购单生成图片，逐项核对：
   - 产品明细块首行为产品名，无编号、无属性。
   - 无备注行显示「备注：-」，有备注行显示「备注：xxx」。
   - 货件块唛头行后无红色提示。
   - 货件区产品行为「产品名（备注）」或纯产品名，无编号前缀。
   - 采购备注段恒定存在，提示语红色、自定义备注灰色。
2. 长备注换行后核对「数量」仍与首行对齐。
3. 容量：86 行排版通过，87 行返回 `PURCHASE_ORDER_IMAGE_TOO_LARGE`。

### 2.5 验证

```
pnpm_config_verify_deps_before_run=false pnpm -C server exec jest purchase-order-image
pnpm_config_verify_deps_before_run=false pnpm -C server run typecheck
node --run test:root
```

如改动波及审核链路，追加：
```
node --run ci:server-e2e
```

### 2.6 提交

`feat: 采购单图片去编号与属性并统一唛头提示口径`

## 3. 阶段三：通知模板

按 requirements.md 第 8 节执行。该阶段改动通知变量契约与四个发布点的取值口径，需要独立验证和独立提交。

### 3.1 先写失败测试

1. 新增 `server/src/modules/purchase-orders/purchase-order-notification-text.spec.ts`：用例照抄前端 `purchase-order-copy.test.ts` 的期望字符串，覆盖完整顺序、多货件空行、STOCK 后缀、行备注有值/空值、多行备注压平。
2. 同文件补充防御用例：详情只有订单 ID、字段全部缺失时返回空串且不抛错。
3. `purchase-order-mutation.service.spec.ts` 增加断言：审核通过时通知发布收到 13 个变量，且 `vendorName` 为字典显示名。

### 3.2 变量契约

`server/src/modules/notifications/notification.types.ts`

1. 第 350 行事件变量追加 `productLines`、`partMarks`、`depositAmount`、`balanceAmount`、`orderRemark`。
2. 第 534 行起为 5 个变量补定义：文本类 `maxLength: 1500`、`required: false`；`depositAmount`、`balanceAmount` 标记 `sensitive: true`；`orderRemark` 标记 `sensitive: false`。
3. 总数 13 个，未触及 `MAX_NOTIFICATION_VARIABLES = 20`。

### 3.3 四处长度上限

1. `notification.types.ts` 的 `MAX_NOTIFICATION_VARIABLE_LENGTH`：200 → 1500。
2. `system-notification.service.ts` 的发布前变量截断跟随常量，无需单独改。
3. `notification-admin.dto.ts` 模板变量 `maxLength` 的 `@Max(200)` → `@Max(1500)`。
4. `web/apps/qsmds-arco/src/views/system/notifications/rules-panel.vue`：变量长度校验上限 200 → 1500，提示文案同步改为 1–1500。前端不改这一处，管理端仍然存不进大值。

### 3.4 文本构造

新增 `server/src/modules/purchase-orders/purchase-order-notification-text.ts`：

1. 导出 `buildPurchaseOrderNotificationBlocks(detail)`，返回 `{ productLines, partMarks, orderRemark }`。
2. 入参使用采购详情而不是图片快照：详情金额已是两位小数，快照金额是四位，从快照构造要多一次精度转换。
3. 复用 `formatShippingMark`、`normalizeShippingMarkLabel` 和阶段二新增的提示语常量；备注归一化与前端同一规则（拆行、trim、折叠空白、去空行、`；` 连接）。
4. `partMarks` 每块两行、块间空行；`productLines` 每块 2-3 行、块间空行；`orderRemark` 为「前置两个换行 + 采购备注：提示语[；自定义]」。
5. 所有字段缺失时降级为空串或 `—`，**不得抛异常**：该构造在采购审核事务内执行，抛错会回滚审核。

### 3.5 数据获取

`server/src/modules/purchase-orders/order-images/purchase-order-image-draft.service.ts` 的 `attachForReview`：把内部已加载的详情作为返回值（`Promise<PurchaseOrderDetail>`），审核事务内不再重复查询。

连带改动：`purchase-order-mutation.service.spec.ts` 第 171 行的 mock 改为返回该文件的 `detail` fixture；该 fixture 目前只有订单 ID，正好用来验证 3.4 的兜底要求。

### 3.6 供应商显示名

1. 采购查询服务内的采购供应商字典 code 常量改为导出，mutation service 复用，不新增第二份字面量。
2. 在 mutation service 增加一个私有方法，输入订单的供应商原始值，返回显示名：自定义名称直接返回；字典值在事务内解析后取 `label`；解析不到时回退原始值。
3. 在四个发布点（审核通过、审核驳回、采购取消、采购完成）统一替换 `vendorName` 取值。

### 3.7 发布变量

`server/src/modules/purchase-orders/purchase-order-mutation.service.ts` 审核通过发布处：接收 `attachForReview` 返回的详情，调 `buildPurchaseOrderNotificationBlocks`，把 5 个新变量并入 `variables`，并将 `vendorName` 换成显示名。

### 3.8 管理端配置（非代码）

1. 小助理模板：正文为 requirements.md 8.3 的内容；开启附件策略 `maxCount: 1`、`kinds: ['IMAGE']`、来源 `purchase.orderImage`。
2. 小助理渠道策略：必须允许敏感内容，否则金额变量被脱敏且图片被整张拦截。
3. 站内模板：同一份正文，附件策略必须关闭，否则保存返回 422。
4. 模板变量建议把 `productLines`、`partMarks`、`orderRemark` 勾成可选，避免异常数据导致整条通知失败。

### 3.9 验证

```
pnpm_config_verify_deps_before_run=false pnpm -C server exec jest purchase-order-notification-text purchase-order-mutation
pnpm_config_verify_deps_before_run=false pnpm -C server run typecheck
pnpm_config_verify_deps_before_run=false pnpm -C web run typecheck
node --run ci:server-e2e
```

e2e 追加断言：审核通过后 `notification.variables` 落库完整未截断，`notification_media` 有一条 `blockedReason = null`。真机再确认文本与图片两条消息。

### 3.10 提交

`feat: 采购审核通过通知发送完整采购信息文案与采购单图片`

## 4. 验证矩阵

| 改动 | 定向验证 | 补充验证 |
| --- | --- | --- |
| 复制文案 | 前端两个测试文件 + typecheck | 浏览器 E2E 复制交互 |
| 采购单图片 | jest `purchase-order-image` + typecheck | 人工出图、容量边界、旧草稿失效 |
| 语言包 | 前端 typecheck + 根治理 | 目录契约与残留白名单均未变 |
| 通知模板 | 文本构造单测 + mutation spec + 两端 typecheck | `ci:server-e2e`、变量落库完整性、真机两条消息 |

命令统一注意：Web 与根脚本需要 `pnpm_config_verify_deps_before_run=false`，根脚本用 `node --run` 执行，避免在根目录生成 lockfile 或依赖目录。

## 5. 提交计划

1. `feat: 采购单复制文案增加行备注与采购备注并统一唛头口径`
2. `feat: 采购单图片去编号与属性并统一唛头提示口径`
3. `feat: 采购审核通过通知发送完整采购信息文案与采购单图片`

三个阶段都修改同一批口径契约。如果实施中发现必须同步上线，可以合并提交，但需在提交说明里写明三个出口一起切换，并说明图片版本升级导致在途草稿失效。

## 6. 回滚

1. 回滚提交即可恢复旧文案、旧图片渲染和旧通知变量。
2. 若已发布到环境，图片模板版本回退到 `6` 会让升级后新生成的草稿失效，需要采购人员重新生成；已归档的凭证图片不参与版本比对，回滚不影响历史单据展示。
3. 语言包回滚后需重新执行根治理测试，确认残留白名单没有因占位符增删而失配。
4. 回滚通知变量时注意：`vendorName` 回退为存储值会让字典供应商的通知文本变化，需同步告知运营，避免误判为消息异常。
