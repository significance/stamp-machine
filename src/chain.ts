import { POSTAGE_CONTRACT } from './batch'

const RPC = 'https://rpc.gnosis.gateway.fm'

// batches(bytes32) returns (address owner, uint8 depth, bool immutable, uint256 normalisedBalance)
// selector: 0xb810e411 (first 4 bytes of keccak256("batches(bytes32)"))
const BATCHES_SELECTOR = '0xb810e411'

export async function checkBatchAlive(batchId: string): Promise<boolean> {
  const paddedId = batchId.padStart(64, '0')
  const data = BATCHES_SELECTOR + paddedId

  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: POSTAGE_CONTRACT, data }, 'latest'],
    }),
  })

  const json = await response.json() as { result?: string }
  if (!json.result || json.result === '0x') return false

  // Result is 4 ABI-encoded values (each 32 bytes = 64 hex chars)
  // [0] owner (address), [1] depth (uint8), [2] immutable (bool), [3] normalisedBalance (uint256)
  // normalisedBalance starts at offset 2 + 3*64 = 194 (after 0x prefix)
  const balanceHex = json.result.slice(2 + 3 * 64, 2 + 4 * 64)
  const balance = BigInt('0x' + balanceHex)
  return balance > 0n
}
