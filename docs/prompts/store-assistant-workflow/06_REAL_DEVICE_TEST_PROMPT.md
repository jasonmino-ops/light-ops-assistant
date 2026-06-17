# 真机测试 Prompt｜店小二项目

任务名称：<填写任务名>

这是 Telegram Mini App / 手机浏览器真机验收任务，不是开发任务。

前置确认：

- 本地 HEAD = origin/main
- Vercel Production commit = 目标 commit
- Deployment State = READY
- production migration 已完成（如有）
- Browser smoke 已通过（如适用）

测试设备：

- iPhone Telegram WebView
- Android Telegram WebView（如可用）
- 手机浏览器（如适用）
- 电脑 Chrome / PWA（如涉及 /cashier）

角色：

- OWNER
- STAFF
- 顾客 H5

核心链路：

- /home 打开与入口
- /sale 搜索 / 扫码 / AI / 加入购物车 / CASH / KHQR
- /cashier 商品 / CASH / KHQR / 会员余额 / 离线提示
- /members 列表 / 详情 / 导入 / 充值 / 调整
- /records 记录展示
- /menu 顾客下单
- Telegram 绑定 / 支付 / 通知（如本轮涉及）

禁止：

- 不做真实大额订单
- 不删除真实数据
- 不随意调整真实会员余额
- 不触发不可逆操作

记录要求：

- 通过/失败页面
- 设备
- 角色
- 操作路径
- 截图现象
- 是否影响主链路

最终回报：

1. 真机验收结论
2. Production commit
3. 设备 / 角色
4. 通过项
5. 失败项
6. 是否创建/修改数据
7. 是否允许冻结
8. 需要补修的问题
