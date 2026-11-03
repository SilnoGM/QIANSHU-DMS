# 广告账户充值前端设计

## 1. 路由与菜单

### 运营工作台（`operations.workbench.ts`）

| 路径 | 名称 | 权限 | 菜单 |
|---|---|---|---|
| `/qs-operations/network-ads` | `qsOperationsNetworkAds` | `network-nodes:read` 或 `advertising-recharges:read-self` | 显示分组 |
| `/qs-operations/network-ads/static-nodes` | `qsOperationsNetworkAdsStaticNodes` | `network-nodes:read` | 显示（占位页） |
| `/qs-operations/network-ads/advertising-recharges` | `qsOperationsNetworkAdsAdvertisingRecharges` | `advertising-recharges:read-self` | 显示 |

分组默认重定向到广告充值；静态节点复用 `views/workbenches/placeholder.vue`。

### 财务工作台（`role.workbenches.ts` 实收实付组）

| 路径 | 名称 | 权限 | 菜单 |
|---|---|---|---|
| `/qs-finance/realtime-payments/advertising-recharges` | `qsFinanceRealtimeAdvertisingRecharges` | `advertising-recharges:read` | 显示 |
| `/qs-finance/realtime-payments/advertising-recharges/:id` | `qsFinanceRealtimeAdvertisingRechargeDetail` | `advertising-recharges:read` | 隐藏（`menu: false`，`activeMenu` 指回列表） |

「实收实付」分组的菜单过滤权限并集加入 `advertising-recharges:read`；详情页的付款/驳回/作废按钮由页面内 `auth('advertising-recharges:pay')` 控制。

## 2. 页面结构

```text
views/workbenches/network-ads/advertising-recharges/
  index.vue                 运营列表：状态页签 + 服务端搜索 + 分页 + 新增 + 详情抽屉
  create-modal.vue          两步弹窗：表单 → 复制信息
  detail-drawer.vue         运营只读详情 + 撤回
  recharge-image-upload.vue 二维码/付款截图共用的上传控件
  use-recharge-image-upload.ts 上传、预览与回收
  recharge-form.ts          币种选项与状态计数归一
  logic.ts                  状态元数据、复制文本、详情链接、私有图片地址

views/workbenches/advertising-recharges/
  index.vue                 财务列表：状态页签 + 搜索 + 详情跳转
  detail.vue                财务详情：申请信息 + 二维码 + 付款表单/结果
  reason-modal.vue          驳回/作废共用的原因弹窗
```

## 3. 两步弹窗

1. **粘贴识别（可选，置顶）**：两行文本框 + 「识别 / 清空」+ 状态行。粘贴即解析（`parseAdvertisingRechargePaste`），识别到的字段直接覆盖；未识别到的字段保留原值；识别成功显示「已识别：名称 … · 编号 …」，只识别一半时提示补填，完全失败时不改字段。清空只清文本框与状态，不回滚字段。
2. **填写信息**（第 1 步 / 共 2 步）：无小标题，一个 12 栅格：第一行账户类型 6 + 充值金额 6，第二行广告账户名称 6 + 广告账户编号 6，随后二维码 12（仅个人户）与备注 12。表单用 `FaForm` + `FaFormItem(required, :auto-bind="false")`，必填项带星号；输入框必须显式 `class="w-full"`（`FaInput` 默认 200px）。
3. **提交校验**：按钮不因缺项置灰，只在填空缺或上传中禁用。点击提交时计算缺失项（`resolveAdvertisingRechargeMissingFields`），聚焦第一个缺失字段，在每个字段下方显示行内错误，并在页脚左侧显示「还需填写：…」；服务端错误也显示在页脚，避免滚动后看不到。
4. **复制信息**（第 2 步 / 共 2 步）：父组件创建成功后才切换（`created` 非空），标题改为「申请已提交」，展示单号/金额摘要与带表头的复制卡片（块内复制按钮 + 成功态「已复制」）；页脚保留主「复制」（复制后关闭）。未复制直接关闭时按钮变为「确认关闭」并提示再次点击，防止丢失唯一一份文案。

复制链接由 `router.resolve({ name: 'qsFinanceRealtimeAdvertisingRechargeDetail', params: { id } })` + `window.location.origin` 生成，hash / history 两种路由模式都正确。运营虽然无权限进入该页，但路由已注册，`resolve` 可用。

**粘贴解析规则**：

- 规范化：`NFKC`（全角冒号/字母/数字转半角）、统一换行、逐行 trim、丢弃空行。
- 编号：优先取「广告/廣告 + 账户/帳戶/帐号/帳號 + 编号/編號」标签后的 6–32 位数字；其次取 `编号/編號` 行后的数字；最后取纯数字行；数字内的空格与连字符会被去掉。
- 名称：第一条非空、非编号行、且不含 广告/廣告/账户/帳戶/帐号/帳號/编号/編號 的行（标题类文字会被跳过）。首行即使是纯数字也按约定作为名称；没有编号时只接受形如账户编码的单行，避免普通文字被误填。
- 首行数字与标签编号不同时：名称取首行、编号取标签行，并提示人工核对。

**二维码与账户类型**：切换账户类型只 `v-show` 隐藏二维码区块，不清空已上传的媒体 id，切回个人户自动恢复；提交时按当前类型决定是否必填。

**行内错误的放置约束**：字段错误节点必须放在 `FaFormItem` 外侧。`FaFormItem` 通过 `FormControl` 的 Slot 克隆首个子节点，插槽子节点数量变化会重建控件；上传组件在重建时的 `onScopeDispose` 会清空已上传的媒体 id，表现为「上传成功后又回到未上传」。

## 4. 金额与币种

- 充值金额使用 `MoneyInput`，币种在 USD / CNY 二选一；默认跟随账户类型：个人户 CNY、非个人户 USD，切换类型时强制重置（不保留手选）。
- 货币目录的 `enabled` 表达的是汇率可用性，不能限制本业务币种；页面用本地描述符把 USD/CNY 显式置为可选（`resolveRechargeCurrencies`），缺目录时按两位小数兜底。
- 财务付款金额固定 CNY，`resolvePaymentCurrencies` 只保留 CNY 且不可切换。

## 5. 图片

- 两个上传入口共用 `recharge-image-upload.vue`：本地 object URL 预览、上传中/失败状态；已上传态为「72px 缩略图 + 文件名 + 重新选择」的单行布局，不再重复字段标签。
- 列表与详情用 `ImageGroup` 指向私有内容路由：运营 `/api/advertising-recharges/me/:id/...`，财务 `/api/advertising-recharges/:id/...`。
- 上传失败使用 `getApiClientFailureMessage`，保留服务端原因与 requestId。

## 6. 状态与交互

| 状态 | 运营 | 财务 |
|---|---|---|
| 待付款 | 详情、撤回 | 详情、登记付款、驳回 |
| 已付款 | 详情（含付款金额/截图/流水批次） | 详情、作废并冲正 |
| 已驳回 | 详情 + 驳回原因 | 详情 |
| 已撤回 | 详情 | 详情 |
| 已作废 | 详情 + 作废原因 | 详情 |

写操作全部用服务端返回的 `version` 作为 `expectedVersion`；冲突时提示刷新，不自动重试。

## 7. 图标与文案

- 品牌图标：`qs-network-ads`（分组）、`qs-static-node`（占位页）、`qs-advertising-recharge`（两个广告充值页）。
- 文案命名空间 `advertisingRecharge`，三语（zh-cn / en / zh-tw），菜单标题沿用路由里的中文静态文本。
- 图标清单由 `node scripts/generate-icon-inventory.mjs` 重新生成；`person-display-governance` 校验要求表格中独立人员列使用 `size="md"`。
