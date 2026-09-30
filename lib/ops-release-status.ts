export type FounderStatus = '开发中' | '待发布' | '已发布待验收' | '已完成' | '暂不发布'

export type ReleaseStatusItem = {
  taskId: string
  title: string
  summary: string
  status: FounderStatus
  implementedOnMain: boolean
  releasedToProduction: boolean
  visibleOnField: boolean
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
  updatedAt: '2026-09-30',
  production: {
    sha: '23bd6bc55142bfb523f5b9beea53f35e306a4740',
    status: 'READY',
  },
  main: {
    sha: '8b140d7922a68f9337a674a0e2fbf972b6fa6d76',
  },
  pendingItems: [],
  releasedAwaitingAcceptance: [
    {
      taskId: 'ES-DESKTOP-CASHIER-SIDEBAR-SIMPLIFICATION-01',
      title: 'Desktop 营业页面左栏简化',
      summary: '精简营业页面左侧信息，将低频营业工具折叠收纳，让 Desktop Cashier 更接近 Browser 的简洁营业布局。',
      status: '已发布待验收',
      implementedOnMain: true,
      releasedToProduction: true,
      visibleOnField: false,
      visualAcceptance: 'DEFERRED TO DESKTOP MILESTONE',
      fieldVerified: false,
      implementedSha: '8fdf9b310a9b23e1e3c9e02cf88ec2790a9f879c',
      productionSha: '23bd6bc55142bfb523f5b9beea53f35e306a4740',
    },
  ],
  recentlyCompleted: [],
}
