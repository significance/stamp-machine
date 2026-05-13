import { privateKeyToAddress } from 'viem/accounts'
import type { Hex } from 'viem'

export interface BurnerWallet {
  privateKey: Uint8Array
  privateKeyHex: Hex
  address: Hex
}

const SECP256K1_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte)
  }
  return result
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function generateBurnerWallet(): BurnerWallet {
  let privateKeyBytes: Uint8Array
  let keyBigInt: bigint

  do {
    privateKeyBytes = new Uint8Array(32)
    crypto.getRandomValues(privateKeyBytes)
    keyBigInt = bytesToBigInt(privateKeyBytes)
  } while (keyBigInt === 0n || keyBigInt >= SECP256K1_ORDER)

  const privateKeyHex = `0x${toHex(privateKeyBytes)}` as Hex
  const address = privateKeyToAddress(privateKeyHex)

  return { privateKey: privateKeyBytes, privateKeyHex, address }
}
