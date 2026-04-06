import { execFile } from 'child_process'
import { access } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

export interface TailscaleStatus {
  installed: boolean
  running: boolean
  ip: string | null
  hostname: string | null
  tailnet: string | null
  peers: TailscalePeer[]
}

export interface TailscalePeer {
  hostname: string
  ip: string
  os: string
  online: boolean
}

export class TailscaleService {
  private cliPath: string | null = null

  async findCli(): Promise<string | null> {
    if (this.cliPath) return this.cliPath

    const isWin = process.platform === 'win32'
    const candidates = isWin
      ? [
          join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe'),
          join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Tailscale', 'tailscale.exe')
        ]
      : [
          '/usr/bin/tailscale',
          '/usr/sbin/tailscale',
          '/usr/local/bin/tailscale',
          '/snap/bin/tailscale',
          join(homedir(), '.local', 'bin', 'tailscale'),
          // macOS (Homebrew & App Store)
          '/opt/homebrew/bin/tailscale',
          '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
        ]

    for (const p of candidates) {
      try {
        await access(p)
        this.cliPath = p
        return p
      } catch { /* not here */ }
    }

    return null
  }

  async getStatus(): Promise<TailscaleStatus> {
    const result: TailscaleStatus = {
      installed: false,
      running: false,
      ip: null,
      hostname: null,
      tailnet: null,
      peers: []
    }

    const cli = await this.findCli()
    if (!cli) return result
    result.installed = true

    try {
      const json = await this.exec(cli, ['status', '--json'])
      const status = JSON.parse(json)

      if (status.BackendState !== 'Running') return result
      result.running = true

      // Self info
      const selfKey = status.Self?.PublicKey
      if (status.Self) {
        result.hostname = status.Self.HostName || null
        result.ip = status.Self.TailscaleIPs?.[0] || null
      }
      if (status.MagicDNSSuffix) {
        result.tailnet = status.MagicDNSSuffix
      }

      // Peers
      if (status.Peer) {
        for (const [key, peer] of Object.entries(status.Peer) as [string, Record<string, unknown>][]) {
          if (key === selfKey) continue
          result.peers.push({
            hostname: (peer.HostName as string) || 'unknown',
            ip: (peer.TailscaleIPs as string[])?.[0] || '',
            os: (peer.OS as string) || '',
            online: peer.Online === true
          })
        }
      }

      return result
    } catch {
      return result
    }
  }

  async getIp(): Promise<string | null> {
    const cli = await this.findCli()
    if (!cli) return null

    try {
      const out = await this.exec(cli, ['ip', '-4'])
      return out.trim() || null
    } catch {
      return null
    }
  }

  private exec(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 5000 }, (err, stdout) => {
        if (err) reject(err)
        else resolve(stdout)
      })
    })
  }
}
