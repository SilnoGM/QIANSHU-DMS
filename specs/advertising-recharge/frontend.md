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

1. **填写信息**：账户类型、广告账户名称/编号、金额 + 币种、个人户二维码、备注。提交按钮在必填项缺失或个人户缺二维码时禁用。
2. **复制信息**：父组件创建成功后才切换（`created` 非空），展示复制文本与轻量摘要；点击「复制」写入剪贴板并关闭，复制失败保留弹窗并提示手动复制。

复制链接由 `router.resolve({ name: 'qsFinanceRealtimeAdvertisingRechargeDetail', params: { id } })` + `window.location.origin` 生成，hash / history 两种路由模式都正确。运营虽然无权限进入该页，但路由已注册，`resolve` 可用。

## 4. 金额与币种

- 充值金额使用 `MoneyInput`，币种在 USD / CNY 二选一，默认 USD。
- 货币目录的 `enabled` 表达的是汇率可用性，不能限制本业务币种；页面用本地描述符把 USD/CNY 显式置为可选（`resolveRechargeCurrencies`），缺目录时按两位小数兜底。
- 财务付款金额固定 CNY，`resolvePaymentCurrencies` 只保留 CNY 且不可切换。

## 5. 图片

- 两个上传入口共用 `recharge-image-upload.vue`：本地 object URL 预览、上传中/失败状态、替换与移除。
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
