import { describe, it, expect } from 'vitest'
import { serializeStampBook, deserializeStampBook, type StampBook } from '../../src/stampbook'

function makeBook(overrides?: Partial<StampBook>): StampBook {
  return {
    version: 1,
    batchId: 'a'.repeat(64),
    owner: 'b'.repeat(40),
    depth: 20,
    bucketDepth: 16,
    amount: 1_000_000_000n,
    privateKey: new Uint8Array(32).fill(0x42),
    buckets: null,
    ...overrides,
  }
}

describe('serializeStampBook', () => {
  it('produces correct PEM delimiters', () => {
    const output = serializeStampBook(makeBook())
    expect(output).toContain('-----BEGIN BOOK OF STAMPS-----')
    expect(output).toContain('-----END BOOK OF STAMPS-----')
  })

  it('includes all headers', () => {
    const output = serializeStampBook(makeBook())
    expect(output).toContain('Version: 1')
    expect(output).toContain(`Batch-Id: ${'a'.repeat(64)}`)
    expect(output).toContain(`Owner: ${'b'.repeat(40)}`)
    expect(output).toContain('Depth: 20')
    expect(output).toContain('Bucket-Depth: 16')
    expect(output).toContain('Amount: 1000000000')
    expect(output).toContain('Usage: 0/1048576')
  })

  it('has a base64 body after blank line', () => {
    const output = serializeStampBook(makeBook())
    const lines = output.split('\n')
    const blankIdx = lines.indexOf('')
    expect(blankIdx).toBeGreaterThan(0)
    const bodyLine = lines[blankIdx + 1]
    expect(() => atob(bodyLine)).not.toThrow()
  })

  it('includes xxd dump for non-zero buckets', () => {
    const buckets = new Uint32Array(65536)
    buckets[0] = 3
    const output = serializeStampBook(makeBook({ buckets }))
    expect(output).toContain('Usage: 3/1048576')
    expect(output).toContain('00000000:')
  })
})

describe('deserializeStampBook', () => {
  it('round-trips fresh book', () => {
    const original = makeBook()
    const serialized = serializeStampBook(original)
    const parsed = deserializeStampBook(serialized)

    expect(parsed.version).toBe(1)
    expect(parsed.batchId).toBe(original.batchId)
    expect(parsed.owner).toBe(original.owner)
    expect(parsed.depth).toBe(20)
    expect(parsed.bucketDepth).toBe(16)
    expect(parsed.amount).toBe(1_000_000_000n)
    expect(parsed.privateKey).toEqual(original.privateKey)
    expect(parsed.buckets).toBeNull()
  })

  it('round-trips book with bucket state', () => {
    const buckets = new Uint32Array(65536)
    buckets[0] = 5
    buckets[1000] = 12
    const original = makeBook({ buckets })
    const serialized = serializeStampBook(original)
    const parsed = deserializeStampBook(serialized)
    expect(parsed.buckets).not.toBeNull()
    expect(parsed.buckets![0]).toBe(5)
    expect(parsed.buckets![1000]).toBe(12)
  })

  it('throws on missing delimiters', () => {
    expect(() => deserializeStampBook('just some text')).toThrow('missing delimiters')
  })

  it('throws on missing headers', () => {
    const broken = [
      '-----BEGIN BOOK OF STAMPS-----',
      'Version: 1',
      '',
      'QUJD',
      '-----END BOOK OF STAMPS-----',
    ].join('\n')
    expect(() => deserializeStampBook(broken)).toThrow('missing header')
  })
})
