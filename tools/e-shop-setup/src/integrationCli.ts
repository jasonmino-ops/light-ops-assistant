import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { FileSetupCheckpointStore } from './checkpoint'
import type { MerchantBindingStatus } from './contracts'
import { EShopSetupOrchestrator } from './orchestrator'
import { JsonLinesSetupLogger } from './setupLog'
import { createIntegratedSetupAdapters } from './setupIntegration'
import { WindowsHardwareProvisioningSystem } from './windowsHardwareProvisioning'
import { WindowsQueueProvisioningSystem } from './windowsQueueProvisioning'
import { WindowsSoftwareProvisioningSystem } from './windowsSoftwareProvisioning'

function argument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null
}

function bindingStatus(): MerchantBindingStatus {
  const value = argument('--binding-status') ?? 'NOT_BOUND'
  if (value === 'NOT_BOUND' || value === 'WAITING' || value === 'VALID' || value === 'INVALID') return value
  throw new Error(`invalid --binding-status: ${value}`)
}

function defaultStateDir(): string {
  const programData = process.env.PROGRAMDATA ?? process.env.ProgramData
  if (process.platform === 'win32' && programData) return join(programData, 'E-Shop', 'Setup')
  return join(tmpdir(), 'eshop-v1-setup')
}

async function main(): Promise<void> {
  const stateDir = resolve(argument('--state-dir') ?? defaultStateDir())
  const payloadDir = resolve(argument('--payload-dir') ?? join(process.cwd(), 'setup-payload'))
  const legacyRongtaInstaller = argument('--external-driver-installer')
  const rongtaInstaller = argument('--rongta-driver-installer') ?? legacyRongtaInstaller
  const xprinterInstaller = argument('--xprinter-driver-installer')
  const softwareSystem = new WindowsSoftwareProvisioningSystem({
    desktopInstallerPath: resolve(
      argument('--desktop-installer') ?? join(payloadDir, 'E-Shop-DianXiaoEr-Setup-0.4.7-x64.exe'),
    ),
    desktopExpectedVersion: '0.4.7',
    desktopDisplayName: 'E-Shop 店小二',
    desktopExecutableName: 'E-Shop 店小二.exe',
    qzInstallerPath: resolve(argument('--qz-installer') ?? join(payloadDir, 'qz-tray-2.2.6.exe')),
    qzExpectedVersion: '2.2.6',
    certificatePackageDir: resolve(argument('--certificate-package') ?? join(payloadDir, 'certificate-package')),
    cloudHealthUrl: 'https://elifekh.com/api/health',
  })
  const hardwareSystem = new WindowsHardwareProvisioningSystem({
    externalDriverPayloads: {
      ...(rongtaInstaller ? { RONGTA_80MM: resolve(rongtaInstaller) } : {}),
      ...(xprinterInstaller ? { XPRINTER_80MM: resolve(xprinterInstaller) } : {}),
    },
  })
  const queueSystem = new WindowsQueueProvisioningSystem()
  const orchestrator = new EShopSetupOrchestrator(
    createIntegratedSetupAdapters(softwareSystem, hardwareSystem, queueSystem),
    new FileSetupCheckpointStore(join(stateDir, 'setup-checkpoint-v1.json')),
    new JsonLinesSetupLogger(join(stateDir, 'setup.log.jsonl')),
  )
  const result = await orchestrator.run(bindingStatus())
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.state === 'BLOCKED') process.exitCode = 2
}

void main().catch((error) => {
  process.stderr.write(`E-Shop V1 Setup failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
  process.exitCode = 1
})
