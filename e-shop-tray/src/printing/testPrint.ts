export function createTrayTestPrintCommand(): Uint8Array {
  const text = [
    'E-Shop Tray V0.1',
    'Local printing is online.',
    'Queue: FRONT DESK',
    '',
    '',
    '',
  ].join('\n')
  return Uint8Array.from([
    0x1b, 0x40,
    ...Buffer.from(text, 'ascii'),
    0x1d, 0x56, 0x00,
  ])
}
