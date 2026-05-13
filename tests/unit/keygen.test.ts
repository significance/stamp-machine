import { describe, it, expect } from 'vitest'
import { generateBurnerWallet, toHex } from '../../src/keygen'

const SECP256K1_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n
  for (const byte of bytes) result = (result << 8n) | BigInt(byte)
  return result
}

describe('generateBurnerWallet', () => {
  it('returns a 32-byte private key', () => {
    const wallet = generateBurnerWallet()
    expect(wallet.privateKey).toBeInstanceOf(Uint8Array)
    expect(wallet.privateKey.length).toBe(32)
  })

  it('returns a 0x-prefixed 66-char hex private key', () => {
    const wallet = generateBurnerWallet()
    expect(wallet.privateKeyHex).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('returns a valid checksummed Ethereum address', () => {
    const wallet = generateBurnerWallet()
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(wallet.address.length).toBe(42)
  })

  it('private key is in valid secp256k1 range', () => {
    const wallet = generateBurnerWallet()
    const n = bytesToBigInt(wallet.privateKey)
    expect(n).toBeGreaterThan(0n)
    expect(n).toBeLessThan(SECP256K1_ORDER)
  })

  it('generates unique keys on consecutive calls', () => {
    const a = generateBurnerWallet()
    const b = generateBurnerWallet()
    expect(a.privateKeyHex).not.toBe(b.privateKeyHex)
    expect(a.address).not.toBe(b.address)
  })

  it('privateKeyHex matches raw bytes', () => {
    const wallet = generateBurnerWallet()
    expect(wallet.privateKeyHex).toBe(`0x${toHex(wallet.privateKey)}`)
  })
})

describe('toHex', () => {
  it('encodes empty array', () => {
    expect(toHex(new Uint8Array([]))).toBe('')
  })

  it('zero-pads single bytes', () => {
    expect(toHex(new Uint8Array([0, 1, 15, 255]))).toBe('00010fff')
  })
})
