# Desktop-Records-Entry-01A 测试说明

## 目标

验证电脑端收银台 `/desktop/pos` 左侧“销售记录”入口可稳定进入当前门店的 `/records`，并能返回电脑收银台。

本轮只收口入口链路，不新增退款能力，不改 records 核心统计口径。

## 测试入口

员工端电脑收银台：

```text
/desktop/pos?storeCode=ST169E7000&lang=zh
```

销售记录页预期 URL：

```text
/records?storeCode=ST169E7000&from=desktop&returnTo=%2Fdesktop%2Fpos%3FstoreCode%3DST169E7000%26lang%3Dzh&lang=zh
```

## 验证步骤

1. 打开 `/desktop/pos?storeCode=ST169E7000&lang=zh`。
2. 确认左侧存在“销售记录”入口。
3. 点击“销售记录”。
4. 确认进入 `/records`，且 URL 中带：
   - `storeCode=ST169E7000`
   - `from=desktop`
   - `returnTo=...`
   - `lang=zh`
5. 确认页面不跳 Telegram 绑定页。
6. 确认 records 页面显示当前门店销售记录。
7. 确认 CASH / KHQR 记录显示正常。
8. 如果有离线补同步订单，确认仍显示“离线补同步”标签和离线销售 / 同步时间。
9. 点击“返回收银台”。
10. 确认返回 `/desktop/pos?storeCode=ST169E7000&lang=zh`。

## 手机端回归

1. 从手机商户端正常进入 `/records`。
2. 确认原有登录态访问不受影响。
3. 确认筛选、记录列表、详情弹层仍正常。

## 退款边界

本轮不新增：

- 退款按钮
- 退款申请
- 老板审核
- 退款管理
- 退款 API

如 `/records` 已有退款记录展示，保持原样。

## 收银回归

1. `/cashier` 在线 CASH 收银不受影响。
2. `/cashier` 在线 KHQR 收银不受影响。
3. 离线 CASH 收银与手动同步不受影响。

## 不应发生

- 点击“销售记录”后丢失 `storeCode`
- 点击“销售记录”后进入 Telegram 绑定页
- `/records` 显示其他门店记录
- 手机端 `/records` 原有入口异常
- 出现新的退款能力
