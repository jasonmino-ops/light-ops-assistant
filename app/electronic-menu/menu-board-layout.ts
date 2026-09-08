import { menuProductName, type ElectronicMenuProduct, type MenuLang } from '@/lib/electronic-menu'

type MenuGroup = { id: string; title: string; items: ElectronicMenuProduct[] }
export type BoardRow = { product: ElectronicMenuProduct; lines: number; height: number }
export type BoardSection = { id: string; title: string; rows: BoardRow[] }
export type BoardPage = BoardSection[][]

// Presentation only: consume the existing groups in their supplied order.
// Fixed row/header budgets match the renderer, so category continuations never
// orphan a heading or manufacture an empty column/page at an exact boundary.
export function layoutMenuBoard(groups: MenuGroup[], width: number, height: number, lang: MenuLang) {
  const columns = width >= 1500 ? 3 : width >= 760 ? 2 : 1
  const fontSize = width >= 1100 ? 22 : 18
  const gap = 28
  const headingHeight = 32
  const columnWidth = (width - gap * (columns - 1)) / columns
  const nameWidth = Math.max(60, columnWidth - fontSize * 2 - 24 - 110)
  const pages: BoardPage[] = []
  let page: BoardPage = []
  let column: BoardSection[] = []
  let used = 0
  let section: BoardSection | undefined

  for (const group of groups) {
    for (const product of group.items) {
      // Reserve two lines for longer names. CSS uses this same line budget;
      // full text remains available via title, without changing catalog data.
      const units = Array.from(menuProductName(product, lang))
        .reduce((total, char) => total + (char.charCodeAt(0) > 0x2ff ? 1 : .6), 0)
      const lines = units * fontSize > nameWidth * .85 ? 2 : 1
      const rowHeight = Math.ceil(Math.max(fontSize * 2, lines * fontSize * 1.25 + (product.spec || product.isRecommended ? 18 : 0)) + 12)
      const needsHeading = section?.id !== group.id
      if (used > 0 && used + rowHeight + (needsHeading ? headingHeight : 0) > height) {
        column = []
        section = undefined
        used = 0
      }
      if (column.length === 0) {
        if (page.length === columns || pages.length === 0) {
          page = []
          pages.push(page)
        }
        page.push(column)
      }
      if (section?.id !== group.id) {
        section = { id: group.id, title: group.title, rows: [] }
        column.push(section)
        used += headingHeight
      }
      section.rows.push({ product, lines, height: rowHeight })
      used += rowHeight
    }
  }
  return { pages, columns, columnWidth, fontSize, headingHeight, gap }
}
