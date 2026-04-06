import type { ServerInfo, AuthResult } from '../../shared/types'

export class BackendApiService {
  private baseUrl: string

  constructor(baseUrl: string = 'https://backend.beammp.com') {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, '')
  }

  async getServerList(): Promise<ServerInfo[]> {
    const response = await fetch(`${this.baseUrl}/servers-info`)
    if (!response.ok) {
      throw new Error(`Failed to fetch server list: ${response.status}`)
    }
    return response.json()
  }

  async login(username: string, password: string): Promise<AuthResult> {
    const response = await fetch(`${this.baseUrl}/userlogin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    if (!response.ok) {
      return { success: false, error: `Login failed: ${response.status}` }
    }
    return response.json()
  }

  async loginWithKey(privateKey: string): Promise<AuthResult> {
    const response = await fetch(`${this.baseUrl}/userlogin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pk: privateKey })
    })
    if (!response.ok) {
      return { success: false, error: `Auto-login failed: ${response.status}` }
    }
    return response.json()
  }

  async getModHash(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/sha/mod`)
    if (!response.ok) {
      throw new Error(`Failed to get mod hash: ${response.status}`)
    }
    return response.text()
  }

  async getLauncherVersion(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/version/launcher`)
    if (!response.ok) {
      throw new Error(`Failed to get launcher version: ${response.status}`)
    }
    return response.text()
  }

  async downloadMod(): Promise<ArrayBuffer> {
    const response = await fetch(`${this.baseUrl}/builds/client`)
    if (!response.ok) {
      throw new Error(`Failed to download mod: ${response.status}`)
    }
    return response.arrayBuffer()
  }

  async checkBackendHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/servers-info`, {
        signal: AbortSignal.timeout(5000)
      })
      return response.ok
    } catch {
      return false
    }
  }
}
