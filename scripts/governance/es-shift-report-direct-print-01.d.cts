interface DirectShiftSuccessor {
  cashierHash: string
  corePaths: Set<string> | null
  blocked?: never
  foundationSnapshot(label: string, groupPaths: string[]): string | undefined
}

export function readDirectShiftSuccessor(root: string): DirectShiftSuccessor | null
