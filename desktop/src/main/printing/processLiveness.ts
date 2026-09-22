export async function proveProcessDead(processId: number): Promise<true | false | 'UNKNOWN'> {
  if (!Number.isInteger(processId) || processId < 1) return 'UNKNOWN'
  try {
    process.kill(processId, 0)
    return false
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return true
    if (code === 'EPERM') return false
    return 'UNKNOWN'
  }
}
