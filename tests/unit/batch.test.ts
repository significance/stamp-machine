import { describe, it, expect, vi } from 'vitest'
import { approveBzz, createBatch, extractBatchId, waitForReceipt, TOTAL_COST, BATCH_DEPTH, AMOUNT_PER_CHUNK, BZZ_TOKEN, POSTAGE_CONTRACT } from '../../src/batch'
import type { EIP1193Provider } from '../../src/wallet'

function mockProvider(overrides: Record<string, unknown> = {}): EIP1193Provider {
  const batchId = '0x' + 'ab'.repeat(32)
  return {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_sendTransaction') return overrides.txHash ?? '0x' + 'cc'.repeat(32)
      if (method === 'eth_getTransactionReceipt') return overrides.receipt ?? {
        status: '0x1',
        logs: [{
          address: POSTAGE_CONTRACT,
          topics: ['0x' + '00'.repeat(32), batchId],
          data: '0x',
        }],
      }
      return null
    }),
  }
}

describe('constants', () => {
  it('TOTAL_COST = AMOUNT × 2^DEPTH', () => {
    expect(TOTAL_COST).toBe(AMOUNT_PER_CHUNK * (1n << BigInt(BATCH_DEPTH)))
    expect(TOTAL_COST).toBe(1_048_576_000_000_000n)
  })
})

describe('approveBzz', () => {
  it('sends approve transaction to BZZ token', async () => {
    const provider = mockProvider()
    const txHash = await approveBzz(provider, '0x1234567890abcdef1234567890abcdef12345678')

    expect(txHash).toBe('0x' + 'cc'.repeat(32))
    expect(provider.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'eth_sendTransaction',
    }))

    const call = (provider.request as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const params = call.params[0]
    expect(params.to).toBe(BZZ_TOKEN)
    expect(params.from).toBe('0x1234567890abcdef1234567890abcdef12345678')
    expect(params.data).toMatch(/^0x/)
  })
})

describe('extractBatchId', () => {
  it('extracts batch ID from PostageStamp log topics[1]', () => {
    const batchId = extractBatchId({
      status: '0x1',
      logs: [{
        address: POSTAGE_CONTRACT,
        topics: ['0x' + '00'.repeat(32), '0x' + 'ff'.repeat(32)],
        data: '0x',
      }],
    })
    expect(batchId).toBe('ff'.repeat(32))
  })

  it('is case-insensitive on contract address', () => {
    const batchId = extractBatchId({
      status: '0x1',
      logs: [{
        address: POSTAGE_CONTRACT.toUpperCase(),
        topics: ['0xsig', '0x' + 'ab'.repeat(32)],
        data: '0x',
      }],
    })
    expect(batchId).toBe('ab'.repeat(32))
  })

  it('throws when no matching log found', () => {
    expect(() => extractBatchId({
      status: '0x1',
      logs: [],
    })).toThrow('BatchCreated event not found')
  })
})

describe('waitForReceipt', () => {
  it('resolves when receipt available immediately', async () => {
    const provider = mockProvider()
    const receipt = await waitForReceipt(provider, '0xtx', 5_000)
    expect(receipt.status).toBe('0x1')
  })

  it('throws on reverted transaction', async () => {
    const provider = mockProvider({
      receipt: { status: '0x0', logs: [] },
    })
    await expect(waitForReceipt(provider, '0xtx', 5_000)).rejects.toThrow('reverted')
  })

  it('polls until receipt appears', async () => {
    vi.useFakeTimers()
    let calls = 0
    const provider: EIP1193Provider = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === 'eth_getTransactionReceipt') {
          calls++
          if (calls < 3) return null
          return {
            status: '0x1',
            logs: [{ address: POSTAGE_CONTRACT, topics: ['0x0', '0xbatch'], data: '0x' }],
          }
        }
        return null
      }),
    }
    const promise = waitForReceipt(provider, '0xtx', 30_000)
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.advanceTimersByTimeAsync(3_000)
    const receipt = await promise
    expect(receipt.status).toBe('0x1')
    expect(calls).toBe(3)
    vi.useRealTimers()
  })
})

describe('createBatch', () => {
  it('sends createBatch transaction to PostageStamp contract', async () => {
    const provider = mockProvider()
    const result = await createBatch(provider, '0x1234567890abcdef1234567890abcdef12345678', '0xdEADbeEF00000000000000000000000000000001')

    expect(result.batchId).toBe('ab'.repeat(32))
    expect(result.txHash).toBe('0x' + 'cc'.repeat(32))

    const calls = (provider.request as ReturnType<typeof vi.fn>).mock.calls
    const txCall = calls.find((c: unknown[]) => {
      const arg = c[0] as { method: string; params?: unknown[] }
      return arg.method === 'eth_sendTransaction' && arg.params?.[0] &&
        (arg.params[0] as Record<string, string>).to === POSTAGE_CONTRACT
    })
    expect(txCall).toBeDefined()
  })
})
