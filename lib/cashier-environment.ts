/**
 * The explicit Desktop POS route is the environment contract for Cashier UI
 * presentation. A normal Browser /cashier URL must remain Browser mode.
 */
export function isDesktopCashierPathname(pathname: string): boolean {
  return pathname === '/desktop/pos'
}
