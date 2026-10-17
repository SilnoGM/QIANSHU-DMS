# QsPersonalFundAccountCard

运营「个人资金账户」概览卡片：展示本人余额、分成比例、最近账务更新与开户时间，并提供申请提款 / 提款记录两个入口。

## 组件契约

- 纯展示组件：不读 API、Store 或路由；账户数据、加载/错误状态与操作后的轻提示由页面负责。
- `account`：本人账户展示模型；未开户传 `null`。
- `currencies`：提供 `AmountDisplay` 的币种描述符；金额格式与币种符号由基础组件统一处理。
- `loading` / `error`：首屏加载与失败态；加载中优先，失败时不显示 0 余额。
- `v-model:amountVisible`：金额显隐，默认 `true`，组件不持久化。
- 事件：`applyWithdrawal`、`viewWithdrawals`、`retry`（模板监听用 kebab-case：`@apply-withdrawal` / `@view-withdrawals` / `@retry`）；组件不跳转、不调接口。
- 卡片自身是容器（`container-type: inline-size`），宽/窄形态按卡片宽度切换，不依赖视口宽度。

## 展示口径

- 可用余额：`account.balance` + `account.currency`，使用 `AmountDisplay`；按项目统一格式显示 `¥1,170.00 CNY`。
- 用户分成比例：`account.userShareRate` 原样追加 `%`；异常值回落 `—`。
- 生效于：`account.shareRateUpdatedAt`。
- 最近账务更新：`account.updatedAt`，辅助文字「系统自动同步」。
- 账户开通时间：`account.createdAt`，辅助文字「首次激活日期」。
- 金额隐藏：只保留币种符号与固定掩码，真实余额不进入 DOM、aria-label 或 title。

## 响应式形态

| 容器宽度 | 形态 |
|---|---|
| ≥ 1140px | 左侧余额面板 + 三指标横排 + 右侧操作列（按钮纵向） |
| 840–1139px | 余额面板 + 三指标横排；操作区移到横线下方（按钮并排） |
| < 840px | 余额面板置顶；指标单列；按钮纵向通宽 |

## 状态

- `loading`：与正式布局同构的骨架，避免数据到达时整卡跳动。
- `error`：`FaEmpty` + 重试事件。
- `empty`（`account === null`）：红色空态（`destructive` 语义色）「尚未开通个人资金账户 / 请联系财务开通后再查看余额与提款」，不渲染绿色余额面板与操作按钮。
- `ready`：正式卡片。

## 设计来源

- 设计图：需求方提供的三张截图（宽屏 / 窄屏 / 隐藏金额）。
- 颜色使用项目主题令牌（`primary` / `destructive` / `muted` / `border`），不硬编码设计图取色。

## 示例

```vue
<QsPersonalFundAccountCard
  v-model:amount-visible="amountVisible"
  :account="account"
  :currencies="currencyCatalog.currencies.value"
  :loading="loading"
  :error="error"
  @apply-withdrawal="showWithdrawalComingSoon"
  @view-withdrawals="showWithdrawalRecordsComingSoon"
  @retry="load"
/>
```

组件库入口：`/#/component-library/business/personal-fund-account-card`。
