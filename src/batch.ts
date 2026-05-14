import { encodeFunctionData } from 'viem'
import type { EIP1193Provider } from './wallet'
import { toHex } from './keygen'

export const BZZ_TOKEN = '0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da'
export const POSTAGE_CONTRACT = '0x45a1502382541Cd610CC9068e88727426b696293'
export const RPC = 'https://rpc.gnosis.gateway.fm'
export const BATCH_DEPTH = 20
export const BUCKET_DEPTH = 16

const approveAbi = [{
  name: 'approve',
  type: 'function' as const,
  inputs: [
    { name: 'spender', type: 'address' as const },
    { name: 'amount', type: 'uint256' as const },
  ],
  outputs: [{ name: '', type: 'bool' as const }],
  stateMutability: 'nonpayable' as const,
}]

const createBatchAbi = [{
  name: 'createBatch',
  type: 'function' as const,
  inputs: [
    { name: '_owner', type: 'address' as const },
    { name: '_initialBalancePerChunk', type: 'uint256' as const },
    { name: '_depth', type: 'uint8' as const },
    { name: '_bucketDepth', type: 'uint8' as const },
    { name: '_nonce', type: 'bytes32' as const },
    { name: '_immutable', type: 'bool' as const },
  ],
  outputs: [{ name: '', type: 'bytes32' as const }],
  stateMutability: 'nonpayable' as const,
}]

async function rpcCall(method: string, params: unknown[]): Promise<string> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = await res.json() as { result?: string }
  return json.result ?? '0x0'
}

// Read minimumInitialBalancePerChunk from the PostageStamp contract
// selector: keccak256("minimumInitialBalancePerChunk()")[:4] = 0x90697842
export async function getMinAmountPerChunk(): Promise<bigint> {
  const result = await rpcCall('eth_call', [
    { to: POSTAGE_CONTRACT, data: '0x90697842' },
    'latest',
  ])
  return BigInt(result)
}

// Read BZZ balance for an address
// selector: keccak256("balanceOf(address)")[:4] = 0x70a08231
export async function getBzzBalance(address: string): Promise<bigint> {
  const paddedAddr = address.replace(/^0x/, '').padStart(64, '0')
  const result = await rpcCall('eth_call', [
    { to: BZZ_TOKEN, data: '0x70a08231' + paddedAddr },
    'latest',
  ])
  return BigInt(result)
}

export interface BatchParams {
  amountPerChunk: bigint
  totalCost: bigint
}

// Calculate the batch cost dynamically: use minimum + 20% buffer
export async function calculateBatchCost(): Promise<BatchParams> {
  const minAmount = await getMinAmountPerChunk()
  // Add 20% buffer above minimum to ensure the batch lasts a reasonable time
  const amountPerChunk = minAmount + (minAmount / 5n)
  const totalCost = amountPerChunk * (1n << BigInt(BATCH_DEPTH))
  return { amountPerChunk, totalCost }
}

export async function checkBzzSufficient(address: string, totalCost: bigint): Promise<void> {
  const balance = await getBzzBalance(address)
  if (balance < totalCost) {
    const BZZ_DECIMALS = 16n
    const needed = Number(totalCost * 10000n / (10n ** BZZ_DECIMALS)) / 10000
    const have = Number(balance * 10000n / (10n ** BZZ_DECIMALS)) / 10000
    throw new Error(`insufficient BZZ: need ${needed}, have ${have}`)
  }
}

export async function approveBzz(provider: EIP1193Provider, from: string, totalCost: bigint): Promise<string> {
  const data = encodeFunctionData({
    abi: approveAbi,
    functionName: 'approve',
    args: [POSTAGE_CONTRACT, totalCost],
  })
  return provider.request({
    method: 'eth_sendTransaction',
    params: [{ from, to: BZZ_TOKEN, data }],
  }) as Promise<string>
}

export async function createBatch(
  provider: EIP1193Provider,
  from: string,
  ownerAddress: string,
  amountPerChunk: bigint,
): Promise<{ batchId: string; txHash: string }> {
  const nonce = `0x${toHex(crypto.getRandomValues(new Uint8Array(32)))}` as `0x${string}`
  const data = encodeFunctionData({
    abi: createBatchAbi,
    functionName: 'createBatch',
    args: [ownerAddress as `0x${string}`, amountPerChunk, BATCH_DEPTH, BUCKET_DEPTH, nonce, false],
  })
  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{ from, to: POSTAGE_CONTRACT, data }],
  }) as string

  const receipt = await waitForReceipt(provider, txHash)
  const batchId = extractBatchId(receipt)
  return { batchId, txHash }
}

interface TxReceipt {
  status: string
  logs: Array<{
    address: string
    topics: string[]
    data: string
  }>
}

export async function waitForReceipt(
  provider: EIP1193Provider,
  txHash: string,
  timeoutMs = 120_000,
): Promise<TxReceipt> {
  const start = Date.now()
  let delay = 2_000

  while (Date.now() - start < timeoutMs) {
    const receipt = await provider.request({
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    }) as TxReceipt | null

    if (receipt) {
      if (receipt.status !== '0x1') {
        throw new Error(`transaction reverted: ${txHash}`)
      }
      return receipt
    }

    await new Promise(r => setTimeout(r, delay))
    delay = Math.min(delay * 1.5, 5_000)
  }

  throw new Error(`receipt timeout after ${timeoutMs}ms: ${txHash}`)
}

export function extractBatchId(receipt: TxReceipt): string {
  const postage = POSTAGE_CONTRACT.toLowerCase()
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === postage && log.topics.length >= 2) {
      return log.topics[1].slice(2)
    }
  }
  throw new Error('BatchCreated event not found in receipt logs')
}
