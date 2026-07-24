/**
 * The Browser POS controls create and manage devices, so they must only be
 * visible while the authenticated owner is operating in owner mode.  Server
 * routes remain the authority for every device-management operation.
 */
export function canShowBrowserPosHomeEntry(
  realRole: string | null | undefined,
  isOwnerInStaffMode: boolean,
): boolean {
  return realRole === 'OWNER' && !isOwnerInStaffMode
}
