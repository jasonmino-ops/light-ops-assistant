import assert from 'node:assert/strict'
import { test } from 'node:test'
import { layoutMenuBoard, type BoardPage } from '../app/electronic-menu/menu-board-layout'
import {
  groupElectronicMenu,
  type ElectronicMenuData,
  type ElectronicMenuProduct,
  type MenuLang,
} from '../lib/electronic-menu'

type MenuGroup = ReturnType<typeof groupElectronicMenu>[number]

function product(index: number, overrides: Partial<ElectronicMenuProduct> = {}): ElectronicMenuProduct {
  return {
    id: `p-${index}`,
    name: `Item ${String(index).padStart(3, '0')}`,
    nameZh: null, nameEn: null, nameKm: null,
    descZh: null, descEn: null, descKm: null,
    spec: null,
    price: 3, originalPrice: 3, discountEnabled: false, isRecommended: false,
    categoryId: 'drinks', imageUrl: null, imageUrls: [],
    ...overrides,
  }
}

function catalog(count: number): ElectronicMenuData {
  const categoryIds = ['snacks', 'juice', 'drinks', 'iced', 'orphan', 'missing-category', null]
  return {
    store: { code: 'TEST-MENU', name: 'Test menu', currencyCode: 'USD', announcement: null, promoText: null, bannerUrl: null },
    categories: [
      { id: 'drinks', name: '饮料', parentId: null, sortOrder: 0 },
      { id: 'juice', name: '果汁', parentId: 'drinks', sortOrder: 1 },
      { id: 'empty', name: 'Empty', parentId: null, sortOrder: 2 },
      { id: 'iced', name: 'Iced Coffee', parentId: null, sortOrder: 3 },
      { id: 'snacks', name: '小吃', parentId: null, sortOrder: 4 },
      { id: 'orphan', name: 'Orphan', parentId: 'missing-parent', sortOrder: 5 },
    ],
    products: Array.from({ length: count }, (_, index) => product(index, { categoryId: categoryIds[index % categoryIds.length] })),
  }
}

function oneGroup(count: number): MenuGroup[] {
  return [{ id: 'drinks', title: 'Drinks', items: Array.from({ length: count }, (_, index) => product(index)) }]
}

function rows(pages: BoardPage[]) {
  return pages.flatMap((page) => page.flatMap((column) => column.flatMap((section) => section.rows)))
}

function assertFits(layout: ReturnType<typeof layoutMenuBoard>, height: number) {
  for (const [pageIndex, page] of layout.pages.entries()) {
    assert.ok(page.length > 0 && page.length <= layout.columns, `Page ${pageIndex} has only occupied columns`)
    for (const [columnIndex, column] of page.entries()) {
      assert.ok(column.length > 0, `Page ${pageIndex}, column ${columnIndex} is not empty`)
      let used = 0
      for (const section of column) {
        assert.ok(section.rows.length > 0, `Heading ${section.id} is always followed by a product in its column`)
        used += layout.headingHeight
        for (const row of section.rows) {
          assert.ok(row.height > 0)
          assert.ok(row.lines === 1 || row.lines === 2)
          used += row.height
        }
      }
      assert.ok(used <= height, `Page ${pageIndex}, column ${columnIndex}: ${used}px exceeds ${height}px`)
    }
  }
}

test('pagination preserves existing group and product order exactly once across columns and pages', () => {
  const data = catalog(109)
  const before = structuredClone(data)
  const groups = groupElectronicMenu(data, 'en')
  assert.deepEqual(groups.map((group) => group.id), ['iced', 'drinks', 'snacks', '__other'])
  const layout = layoutMenuBoard(groups, 1268, 260, 'en')
  const actualIds = rows(layout.pages).map((row) => row.product.id)
  const expectedIds = groups.flatMap((group) => group.items.map((item) => item.id))

  assert.ok(layout.pages.length > 1)
  assert.ok(layout.pages.some((page) => page.length === 2))
  assert.deepEqual(actualIds, expectedIds, 'Read left to right, then page to page in the supplied catalog order')
  assert.equal(new Set(actualIds).size, data.products.length)
  assert.deepEqual([...actualIds].sort(), data.products.map((item) => item.id).sort())
  for (const section of layout.pages.flat(2)) {
    const source = groups.find((group) => group.id === section.id)
    assert.ok(source)
    assert.equal(section.title, source.title)
    assert.ok(section.rows.every((row) => source.items.includes(row.product)))
  }
  assertFits(layout, 260)
  assert.deepEqual(data, before, 'Layout leaves the supplied catalog values unchanged')
})

test('an exact full page adds no empty trailing column or page, and one extra product starts the next page', () => {
  const sample = layoutMenuBoard(oneGroup(1), 1268, 880, 'en')
  const rowHeight = rows(sample.pages)[0].height
  const height = sample.headingHeight + rowHeight * 3
  const count = sample.columns * 3
  const full = layoutMenuBoard(oneGroup(count), 1268, height, 'en')

  assert.equal(full.pages.length, 1)
  assert.equal(full.pages[0].length, sample.columns)
  for (const column of full.pages[0]) assert.equal(column.flatMap((section) => section.rows).length, 3)
  assertFits(full, height)

  const overflow = layoutMenuBoard(oneGroup(count + 1), 1268, height, 'en')
  assert.equal(overflow.pages.length, 2)
  assert.equal(overflow.pages[1].length, 1)
  assert.deepEqual(rows([overflow.pages[1]]).map((row) => row.product.id), [`p-${count}`])
  assertFits(overflow, height)
})

test('a new category moves with its first product when only the heading would fit', () => {
  const first = product(1)
  const second = product(2, { categoryId: 'snacks' })
  const groups = [
    { id: 'drinks', title: 'Drinks', items: [first] },
    { id: 'empty', title: 'Empty', items: [] },
    { id: 'snacks', title: 'Snacks', items: [second] },
  ]
  const sample = layoutMenuBoard(groups.slice(0, 1), 1268, 880, 'en')
  const height = sample.headingHeight * 2 + rows(sample.pages)[0].height
  const layout = layoutMenuBoard(groups, 1268, height, 'en')

  assert.equal(layout.pages.length, 1)
  assert.deepEqual(layout.pages[0].map((column) => column.map((section) => section.id)), [['drinks'], ['snacks']])
  assert.deepEqual(rows(layout.pages).map((row) => row.product.id), [first.id, second.id])
  assertFits(layout, height)
})

test('empty catalogs have no page and a small catalog has no second page', () => {
  assert.deepEqual(layoutMenuBoard([], 1268, 880, 'en').pages, [])
  assert.deepEqual(layoutMenuBoard([{ id: 'empty', title: 'Empty', items: [] }], 1268, 880, 'en').pages, [])
  const layout = layoutMenuBoard(groupElectronicMenu(catalog(6), 'en'), 1268, 880, 'en')
  assert.equal(layout.pages.length, 1)
  assert.equal(rows(layout.pages).length, 6)
  assertFits(layout, 880)
})

test('multiple categories and long multilingual names remain within each container height budget', () => {
  const data = catalog(200)
  data.products = data.products.map((item, index) => ({
    ...item,
    nameEn: index % 3 === 0 ? 'Freshly brewed iced coffee with caramel and extra milk, large serving' : 'Coffee',
    nameZh: index % 3 === 0 ? '新鲜现磨冰咖啡搭配焦糖和额外牛奶大杯装' : '咖啡',
    nameKm: index % 3 === 0 ? 'កាហ្វេទឹកដោះគោទឹកកកជាមួយទឹកដោះគោបន្ថែមសម្រាប់ពេលព្រឹក' : 'កាហ្វេ',
    spec: index % 2 === 0 ? 'Large' : null,
    isRecommended: index % 5 === 0,
  }))
  const sizes = [
    { width: 360, height: 190, columns: 1 },
    { width: 760, height: 300, columns: 2 },
    { width: 1080, height: 420, columns: 2 },
    { width: 1268, height: 880, columns: 2 },
    { width: 1700, height: 900, columns: 3 },
  ]

  for (const lang of ['zh', 'en', 'km'] as MenuLang[]) {
    const groups = groupElectronicMenu(data, lang)
    const expectedIds = groups.flatMap((group) => group.items.map((item) => item.id))
    for (const size of sizes) {
      const layout = layoutMenuBoard(groups, size.width, size.height, lang)
      assert.equal(layout.columns, size.columns)
      assert.deepEqual(rows(layout.pages).map((row) => row.product.id), expectedIds)
      assert.ok(rows(layout.pages).some((row) => row.lines === 2), 'Long names receive two display lines')
      assertFits(layout, size.height)
    }
  }
})

test('the menu area of a 1920x1080 screen displays about 20–40 regular products per full page', () => {
  // Use the right-hand list container dimensions at the target viewport size.
  const layout = layoutMenuBoard(oneGroup(100), 1268, 880, 'en')
  const firstPageCount = rows([layout.pages[0]]).length
  assert.ok(layout.pages.length > 1)
  assert.ok(firstPageCount >= 20 && firstPageCount <= 40, `First page displays ${firstPageCount} products`)
  assert.equal(rows(layout.pages).length, 100)
  assertFits(layout, 880)
})

test('an equivalent refreshed data object produces the same page boundaries and display budgets', () => {
  const data = catalog(80)
  const refreshed = structuredClone(data)
  assert.notEqual(refreshed, data)
  assert.notEqual(refreshed.products[0], data.products[0])
  const first = layoutMenuBoard(groupElectronicMenu(data, 'en'), 1268, 420, 'en')
  const second = layoutMenuBoard(groupElectronicMenu(refreshed, 'en'), 1268, 420, 'en')
  assert.deepEqual(second, first)
})
