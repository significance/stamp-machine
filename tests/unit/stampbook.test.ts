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
    usage: '0/1048576',
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

  it('shows fresh usage for depth 20', () => {
    const output = serializeStampBook(makeBook({ usage: '' }))
    expect(output).toContain('Usage: 0/1048576')
  })
})

describe('deserializeStampBook', () => {
  it('round-trips correctly', () => {
    const original = makeBook()
    const serialized = serializeStampBook(original)
    const parsed = deserializeStampBook(serialized)

    expect(parsed.version).toBe(1)
    expect(parsed.batchId).toBe(original.batchId)
    expect(parsed.owner).toBe(original.owner)
    expect(parsed.depth).toBe(20)
    expect(parsed.bucketDepth).toBe(16)
    expect(parsed.amount).toBe(1_000_000_000n)
    expect(parsed.usage).toBe('0/1048576')
    expect(parsed.privateKey).toEqual(original.privateKey)
  })

  it('serialize → deserialize → serialize is stable', () => {
    const original = makeBook()
    const first = serializeStampBook(original)
    const parsed = deserializeStampBook(first)
    const second = serializeStampBook(parsed)
    expect(second).toBe(first)
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

  it('throws on missing body separator', () => {
    const broken = [
      '-----BEGIN BOOK OF STAMPS-----',
      'Version: 1',
      `Batch-Id: ${'a'.repeat(64)}`,
      `Owner: ${'b'.repeat(40)}`,
      'Depth: 20',
      'Bucket-Depth: 16',
      'Amount: 1000000000',
      'Usage: 0/1048576',
      'QUJD',
      '-----END BOOK OF STAMPS-----',
    ].join('\n')
    expect(() => deserializeStampBook(broken)).toThrow()
  })
})
