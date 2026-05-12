import { redirect } from 'next/navigation'

/**
 * /m/<storeCode> — 顾客扫码短链入口
 *
 * 服务端 302 转到 /menu?code=<storeCode>，保持顾客 H5 主页面唯一。
 * 不属于运营后台 (/ops) 与商户后台 (/dashboard /products /invite /system) 路由组，
 * middleware matcher 不拦截，顾客无需登录即可访问。
 */
export default async function CustomerMenuShortLink({
  params,
}: {
  params: Promise<{ storeCode: string }>
}) {
  const { storeCode } = await params
  redirect(`/menu?code=${encodeURIComponent(storeCode)}`)
}
