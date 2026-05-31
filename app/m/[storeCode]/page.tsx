import { redirect } from 'next/navigation'

/**
 * /m/<storeCode> — 顾客扫码短链入口
 *
 * 服务端 302 转到 /menu?code=<storeCode>，同时透传 ref 和 intent 用于推广归因。
 */
export default async function CustomerMenuShortLink({
  params,
  searchParams,
}: {
  params: Promise<{ storeCode: string }>
  searchParams: Promise<{ ref?: string; intent?: string }>
}) {
  const { storeCode } = await params
  const { ref, intent } = await searchParams

  const qs = new URLSearchParams({ code: storeCode })
  if (ref)    qs.set('ref',    ref)
  if (intent) qs.set('intent', intent)

  redirect(`/menu?${qs.toString()}`)
}
