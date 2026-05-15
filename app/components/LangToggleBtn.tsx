'use client'

/**
 * 商户端语言切换器已收敛到 /home（国旗下拉）。
 * 其它商户页面（dashboard / sale / products / records / bind / refund 等）
 * 通过此组件占位，但默认不渲染任何 UI，让语言由 /home 统一选择并持久化。
 * 顾客端 /menu /me 自带独立切换器，不受此影响。
 */
export default function LangToggleBtn(_props?: { style?: React.CSSProperties }) {
  void _props
  return null
}
