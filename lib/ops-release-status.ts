export type FounderStatus = '开发中' | '待发布' | '已发布待验收' | '已完成' | '暂不发布'

export type ReleaseStatusItem = {
  taskId: string
  title: string
  summary: string
  status: FounderStatus
  implementedOnMain: boolean
  releasedToProduction: boolean
  visibleOnField: boolean | 'NOT_CHECKED_AFTER_RELEASE'
  visualAcceptance: string
  fieldVerified: boolean
  implementedSha?: string
  productionSha?: string
}

export type OpsReleaseStatusSnapshot = {
  updatedAt: string
  production: { sha: string; status: 'READY' | 'UNKNOWN' }
  main: { sha: string }
  pendingItems: ReleaseStatusItem[]
  releasedAwaitingAcceptance: ReleaseStatusItem[]
  recentlyCompleted: ReleaseStatusItem[]
}

// Curated repository-owned status source. These are recorded references, not a live release monitor.
export const OPS_RELEASE_STATUS: OpsReleaseStatusSnapshot = {
  updatedAt: '2026-10-02',
  production: {
    sha: '4b83e38ceeae74f41682f05f19721816ff685bd3',
    status: 'READY',
  },
  main: {
    sha: 'df529b227a57e7d6cd13dd8513514b051a49f604',
  },
  pendingItems: [
    {
      taskId: 'ES-PRINT-SOURCE-ROUTING-NORMALIZATION-01',
      title: '打印来源路由归一化',
      summary: 'Desktop 营业原单使用 LOCAL FIRST；配置过的 Browser 营业原单使用 CLOUD；Operator 补打继续使用 CLOUD。H5 / Mobile 原单保持不变并延后处理。',
      status: '待发布',
      implementedOnMain: true,
      releasedToProduction: false,
      visibleOnField: false,
      visualAcceptance: 'DEFERRED / 待发布后确认',
      fieldVerified: false,
      implementedSha: 'b41a19f58fa02ec626e26a55ccb641f6a01934a7',
    },
  ],
  releasedAwaitingAcceptance: [
    {
      taskId: 'ES-PRINT-V3-OPERATOR-RECOVERY-01',
      title: '打印异常提示 / 订单详情安全补打',
      summary: 'Operator Recovery 已进入 Production 和 Desktop 0.2.0-pilot.4；正常双角色出票与角色隔离已有现场证据，安全补打的完整物理闭环仍待最终确认。',
      status: '已发布待验收',
      implementedOnMain: true,
      releasedToProduction: true,
      visibleOnField: true,
      visualAcceptance: 'PARTIAL / 完整 FIELD 闭环待确认',
      fieldVerified: false,
      implementedSha: '37aa58c025c72e6d4547cf366d334ef3ea511e24',
      productionSha: '4b83e38ceeae74f41682f05f19721816ff685bd3',
    },
  ],
  recentlyCompleted: [
    {
      taskId: 'ES-DESKTOP-CASHIER-SIDEBAR-SIMPLIFICATION-01',
      title: 'Desktop 营业页面左栏简化',
      summary: '精简营业页面左侧信息，将低频营业工具折叠收纳，让 Desktop Cashier 更接近 Browser 的简洁营业布局。',
      status: '已完成',
      implementedOnMain: true,
      releasedToProduction: true,
      visibleOnField: true,
      visualAcceptance: 'PASS / 独立 FIELD 不要求',
      fieldVerified: false,
      implementedSha: '8fdf9b310a9b23e1e3c9e02cf88ec2790a9f879c',
      productionSha: '4b83e38ceeae74f41682f05f19721816ff685bd3',
    },
  ],
}
