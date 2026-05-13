import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@reown/appkit', () => ({
  createAppKit: vi.fn(() => ({
    open: vi.fn(),
    subscribeState: vi.fn(),
    getIsConnectedState: vi.fn(),
    getWalletProvider: vi.fn(),
  })),
}))
vi.mock('@reown/appkit-adapter-ethers', () => ({
  EthersAdapter: vi.fn(),
}))
vi.mock('@reown/appkit/networks', () => ({
  defineChain: vi.fn((cfg: unknown) => cfg),
}))

import { connectWallet, getConnectedAccount, ensureGnosisChain, type EIP1193Provider } from '../../src/wallet'

function mockProvider(methods: Record<string, unknown> = {}): EIP1193Provider {
  return {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method in methods) return methods[method]
      if (method === 'eth_requestAccounts') return ['0xDeadBeef00000000000000000000000000000001']
      if (method === 'eth_chainId') return '0x64'
      return null
    }),
  }
}

describe('connectWallet', () => {
  const originalWindow = {} as Record<string, unknown>

  beforeEach(() => {
    originalWindow.__stampMachineTest = (window as unknown as Record<string, unknown>).__stampMachineTest
    originalWindow.ethereum = (window as unknown as Record<string, unknown>).ethereum
  })

  afterEach(() => {
    (window as unknown as Record<string, unknown>).__stampMachineTest = originalWindow.__stampMachineTest
    ;(window as unknown as Record<string, unknown>).ethereum = originalWindow.ethereum
  })

  it('returns test provider when __stampMachineTest is set', async () => {
    const provider = mockProvider()
    ;(window as unknown as Record<string, unknown>).__stampMachineTest = true
    ;(window as unknown as Record<string, unknown>).ethereum = provider

    const result = await connectWallet()
    expect(result).toBe(provider)
  })

  it('throws when test mode set but no provider', async () => {
    (window as unknown as Record<string, unknown>).__stampMachineTest = true
    ;(window as unknown as Record<string, unknown>).ethereum = undefined

    await expect(connectWallet()).rejects.toThrow('no test provider')
  })

  it('uses injected wallet when available', async () => {
    (window as unknown as Record<string, unknown>).__stampMachineTest = undefined
    const provider = mockProvider()
    ;(window as unknown as Record<string, unknown>).ethereum = provider

    const result = await connectWallet()
    expect(result).toBe(provider)
    expect(provider.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' })
  })
})

describe('getConnectedAccount', () => {
  it('returns the first account', async () => {
    const provider = mockProvider()
    const account = await getConnectedAccount(provider)
    expect(account).toBe('0xDeadBeef00000000000000000000000000000001')
  })

  it('throws if no accounts', async () => {
    const provider = mockProvider({ eth_requestAccounts: [] })
    await expect(getConnectedAccount(provider)).rejects.toThrow('no connected account')
  })
})

describe('ensureGnosisChain', () => {
  it('does nothing if already on Gnosis', async () => {
    const provider = mockProvider()
    await ensureGnosisChain(provider)
    expect(provider.request).toHaveBeenCalledWith({ method: 'eth_chainId' })
    expect(provider.request).toHaveBeenCalledTimes(1)
  })

  it('switches chain if on wrong network', async () => {
    const provider = mockProvider({ eth_chainId: '0x1' })
    await ensureGnosisChain(provider)
    expect(provider.request).toHaveBeenCalledWith({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x64' }],
    })
  })
})
