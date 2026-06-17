# Browser / Playwright 验收 Prompt｜店小二项目

任务名称：<填写任务名>

这是线上 Browser smoke 验收任务，不是开发任务。

当前 Production：

- commit：<填写>
- Deployment State：READY

请使用项目内 Playwright smoke 能力验证：

```bash
npm run test:smoke:prod
```

默认覆盖页面：

- /home
- /members
- /cashier?storeCode=ST169E7000
- /records

本轮额外验收页面：

- <填写，如 /products /dashboard /invite>

检查规则：

1. 页面能打开。
2. 主响应不是 404 / 500。
3. 页面不白屏。
4. body 有可见内容。
5. 核心按钮存在。
6. 不出现常见错误文案。
7. 捕获 console error。
8. 捕获 pageerror。
9. 保存截图。

常见失败文案：

- 首页数据加载失败
- 会员加载失败
- 请稍后重试
- Application error
- Prisma P2021
- Prisma P2022
- 500
- 404

禁止：

- 不改代码
- 不改数据库
- 不创建订单
- 不创建会员
- 不触发真实 KHQR
- 不调整真实余额

最终回报：

1. Browser 验收结论
2. Production commit
3. Deployment State
4. 覆盖页面
5. 失败/通过结果
6. console error / pageerror 结果
7. 截图路径
8. 是否发现主链路异常
9. 是否创建/修改数据：否
10. 是否建议进入真机验收
