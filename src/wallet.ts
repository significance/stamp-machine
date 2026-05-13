import { createAppKit, type AppKit } from '@reown/appkit'
import { EthersAdapter } from '@reown/appkit-adapter-ethers'
import { defineChain } from '@reown/appkit/networks'

const REOWN_PROJECT_ID = 'b56e18d47c72ab683b10814fe9495694'

export const gnosis = defineChain({
  id: 100,
  caipNetworkId: 'eip155:100',
  chainNamespace: 'eip155',
  name: 'Gnosis',
  nativeCurrency: { decimals: 18, name: 'xDAI', symbol: 'xDAI' },
  rpcUrls: { default: { http: ['https://rpc.gnosis.gateway.fm'] } },
  blockExplorers: { default: { name: 'Gnosisscan', url: 'https://gnosisscan.io' } },
})

export type EIP1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

let appKit: AppKit | null = null

export function initAppKit(): AppKit {
  if (appKit) return appKit
  const ethersAdapter = new EthersAdapter()
  appKit = createAppKit({
    adapters: [ethersAdapter],
    networks: [gnosis],
    projectId: REOWN_PROJECT_ID,
    features: { analytics: false },
  })
  return appKit
}

export async function connectWallet(): Promise<EIP1193Provider> {
  if ((window as unknown as Record<string, unknown>).__stampMachineTest) {
    const provider = (window as unknown as Record<string, unknown>).ethereum
    if (!provider) throw new Error('no test provider on window.ethereum')
    return provider as EIP1193Provider
  }

  const injected = (window as unknown as Record<string, unknown>).ethereum as EIP1193Provider | undefined
  if (injected) {
    await injected.request({ method: 'eth_requestAccounts' })
    return injected
  }

  const kit = initAppKit()
  kit.open()

  return new Promise<EIP1193Provider>((resolve, reject) => {
    let modalOpened = false
    const unsub = kit.subscribeState(state => {
      if (state.open) {
        modalOpened = true
        return
      }
      if (!state.open && modalOpened) {
        unsub()
        if (kit.getIsConnectedState()) {
          const provider = kit.getWalletProvider() as EIP1193Provider | undefined
          if (provider) {
            resolve(provider)
          } else {
            reject(new Error('no provider after wallet connection'))
          }
        } else {
          reject(new Error('wallet connection cancelled'))
        }
      }
    })
  })
}

export async function getConnectedAccount(provider: EIP1193Provider): Promise<string> {
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[]
  const from = accounts[0]
  if (!from) throw new Error('no connected account')
  return from
}

export async function ensureGnosisChain(provider: EIP1193Provider): Promise<void> {
  const chainId = await provider.request({ method: 'eth_chainId' }) as string
  if (chainId === '0x64') return

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x64' }],
    })
  } catch {
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: '0x64',
        chainName: 'Gnosis',
        nativeCurrency: { name: 'xDAI', symbol: 'xDAI', decimals: 18 },
        rpcUrls: ['https://rpc.gnosis.gateway.fm'],
        blockExplorerUrls: ['https://gnosisscan.io'],
      }],
    })
  }
}
