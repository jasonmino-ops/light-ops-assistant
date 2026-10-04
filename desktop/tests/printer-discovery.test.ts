import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  LanPrinterDiscovery,
  listDirectPrivateNetworks,
  parseWindowsArp,
  type DiscoverySocket,
} from '../src/main/printing/printerDiscovery'

class SocketFixture extends EventEmitter implements DiscoverySocket {
  once(event: string, listener: (...args: any[]) => void): this { return super.once(event, listener) }
  setTimeout(): this { return this }
  connect(options: { host: string }): this {
    queueMicrotask(() => this.emit(options.host === '192.168.50.2' ? 'connect' : 'error'))
    return this
  }
  destroy(): this { return this }
}

const interfaces = () => ({
  Ethernet: [{
    address: '192.168.50.1',
    netmask: '255.255.255.252',
    family: 'IPv4' as const,
    mac: '00:11:22:33:44:55',
    internal: false,
    cidr: '192.168.50.1/30',
  }],
})

describe('LAN printer discovery', () => {
  it('reuses bounded zero-payload discovery and resolves a Windows ARP identity without PowerShell', async () => {
    const source = await readFile(join(__dirname, '../src/main/printing/printerDiscovery.ts'), 'utf8')
    expect(source).not.toContain('powershell.exe')
    expect(source).toContain("['-a', host, '-N', localAddress]")
    expect(listDirectPrivateNetworks(interfaces())).toHaveLength(1)
    expect(parseWindowsArp('  192.168.50.2   aa-bb-cc-dd-ee-f0   dynamic\r\n', '192.168.50.2')).toBe('aa-bb-cc-dd-ee-f0')

    const readHardwareAddress = vi.fn(async () => 'aa-bb-cc-dd-ee-f0')
    const discovery = new LanPrinterDiscovery({
      platform: () => 'win32',
      interfaces,
      createSocket: () => new SocketFixture(),
      readHardwareAddress,
    })
    const result = await discovery.discover()
    expect(result).toEqual({
      status: 'COMPLETE',
      candidates: [{
        id: '192.168.50.2:9100@aa-bb-cc-dd-ee-f0',
        ip: '192.168.50.2',
        port: 9100,
        hardwareAddress: 'aa-bb-cc-dd-ee-f0',
        interfaceName: 'Ethernet',
        localAddress: '192.168.50.1',
      }],
      attempted: 1,
      totalTargets: 1,
    })
    expect(await discovery.validate(result.candidates[0])).toBe(true)
    expect(readHardwareAddress).toHaveBeenCalledWith('192.168.50.2', '192.168.50.1')
  })

  it('rejects virtual adapters and fails closed when the bounded subnet is too large', async () => {
    expect(listDirectPrivateNetworks({
      'vEthernet (Default Switch)': [{
        address: '172.20.0.1', netmask: '255.255.0.0', family: 'IPv4', mac: '', internal: false,
        cidr: '172.20.0.1/16',
      }],
    })).toEqual([])
    const discovery = new LanPrinterDiscovery({
      platform: () => 'win32',
      interfaces: () => ({ Ethernet: [{
        address: '10.1.0.1', netmask: '255.255.0.0', family: 'IPv4', mac: '', internal: false,
        cidr: '10.1.0.1/16',
      }] }),
    })
    await expect(discovery.discover()).resolves.toMatchObject({
      status: 'MANUAL_REQUIRED', reason: 'PRINTER_DISCOVERY_SUBNET_TOO_LARGE', candidates: [],
    })
  })
})
