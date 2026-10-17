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

## 余额面板配色

- 正常余额：绿色（`primary`）。
- 可见负余额：黄色（项目 amber 语义色，深色文字）。
- 金额隐藏时即使余额为负也保持绿色：颜色不能反向暴露余额正负。
- 未开户：红色（`destructive`），金额位显示「联系财务开户」，右侧提示开通后可查看分成比例、账务更新与提款。

## 响应式形态

| 容器宽度 | 形态 |
|---|---|
| ≥ 1140px | 左侧余额面板 + 三指标横排；日期时间完整显示；按钮在指标下方并排 |
| 840–1139px | 余额面板 + 三指标横排；日期只保留 YYYY-MM-DD（隐藏 HH:mm:ss）；按钮在指标下方并排 |
| < 840px | 余额面板置顶；指标单列；日期只保留 YYYY-MM-DD；按钮纵向通宽 |

宽/窄两种形态的操作按钮都在指标下方，差异只在余额面板宽度与窄屏时间是否隐藏。

余额面板最小宽度 460px、金额字号上限 2.5rem，保证在宽屏下容纳「符号位 + 6 位整数 + 2 位小数 + CNY」的完整金额（如 `-¥999,999.99 CNY`）；窄屏金额字号随容器缩小，32% 面板宽度同样可容纳。

## 状态

- `loading`：与正式布局同构的骨架，避免数据到达时整卡跳动。
- `error`：`FaEmpty` + 重试事件。
- `empty`（`account === null`）：红色余额面板，金额位显示「联系财务开户」，右侧提示开通后可查看分成比例、账务更新与提款；不渲染指标与操作按钮。
- `ready`：正式卡片。

## 设计来源

- 设计图：需求方提供的三张截图（宽屏 / 窄屏 / 隐藏金额）。
- 颜色使用项目主题令牌（`primary` / amber 语义色 / `destructive` / `muted` / `border`），不硬编码设计图取色。

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
