import { redirect } from 'next/navigation'

/**
 * Root index — all roles land on /home as the default entry point.
 * Role-based navigation (e.g. /dashboard for OWNER) is handled
 * inside the app after auth, not at root redirect level.
 */
export default async function Root() {
  redirect('/home')
}
