# Book of Stamps — Portable Postage Batch Key File

## Authors
sig (@significance)

## Summary

A PEM-style file format for distributing Swarm postage batch credentials. A Book of Stamps bundles the private key of an ephemeral wallet (the batch owner) with batch metadata into a single portable file that can be imported by any Swarm application to use the batch for uploading data to Swarm.

## Motivation

Currently, using a Swarm postage batch requires both the batch ID and the private key of the batch owner to be configured separately. This creates friction when batches are purchased on behalf of others (e.g. via a stamp vending machine) or when batch credentials need to be transferred between applications. A standardised portable key file eliminates this friction and enables:

- One-click batch provisioning via web interfaces
- Transfer of batch ownership between applications
- Backup and restore of batch credentials
- Delegation of upload rights without sharing node keys

## Specification

### File Format

The Book of Stamps file uses PEM-style delimiters with RFC 822 headers, following the same conventions as SSH key files.

```
-----BEGIN BOOK OF STAMPS-----
Version: 1
Batch-Id: <64 hex characters>
Owner: <40 hex characters>
Depth: <uint8>
Bucket-Depth: <uint8>
Amount: <uint256 decimal string>
Usage: <compact usage representation>

<base64-encoded body>
-----END BOOK OF STAMPS-----
```

### Headers

| Header | Type | Description |
|--------|------|-------------|
| Version | uint | Format version, currently `1` |
| Batch-Id | hex(32) | The 32-byte postage batch ID, without `0x` prefix |
| Owner | hex(20) | The Ethereum address of the batch owner (the ephemeral wallet), without `0x` prefix |
| Depth | uint8 | Batch depth parameter (determines batch capacity: 2^depth chunks) |
| Bucket-Depth | uint8 | Bucket depth parameter (determines number of buckets: 2^bucketDepth) |
| Amount | uint256 | Initial balance per chunk in BZZ plurs (smallest unit) |
| Usage | string | Compact representation of batch utilisation (see below) |

### Body

The body section (after the blank line separator, before the END delimiter) contains the base64 encoding of the 32-byte secp256k1 private key of the batch owner wallet. Line wrapping at 64 characters per line follows PEM convention.

### Usage Field

The Usage field has two representations:

1. **Fraction format** (fresh or summary): `<used>/<total>` where total = 2^depth. Example: `0/1048576` for a fresh depth-20 batch.

2. **Bucket state format** (for resuming client-side stamping): `b64:<base64-encoded Uint32Array>` where the Uint32Array contains 2^bucketDepth entries, each representing the per-bucket stamp counter. This allows reconstruction of the full Stamper state.

### Filename Convention

Files SHOULD use the extension `.pem` and follow the naming pattern:

```
stamp-book-<first 8 hex chars of batch ID>.pem
```

### Parsing Algorithm

1. Locate `-----BEGIN BOOK OF STAMPS-----` and `-----END BOOK OF STAMPS-----` delimiters
2. Parse RFC 822 headers (key-colon-space-value) until the first blank line
3. Validate all required headers are present
4. Concatenate remaining non-empty lines as base64 body
5. Decode base64 to obtain the 32-byte private key
6. Derive the Ethereum address from the private key and verify it matches the Owner header

### Security Considerations

- The private key grants full control over the postage batch. Files MUST be treated with the same care as cryptocurrency private keys.
- Applications SHOULD warn users before importing a Book of Stamps from an untrusted source.
- The file SHOULD NOT be transmitted over unencrypted channels.
- Upon import, applications SHOULD verify the batch exists on-chain and that the Owner matches the derived address from the private key.

### On-Chain Verification

To verify a Book of Stamps against the blockchain:

1. Call `batches(bytes32)` on the PostageStamp contract (`0x45a1502382541Cd610CC9068e88727426b696293` on Gnosis chain) with the Batch-Id
2. Verify the returned owner matches the Owner header
3. Verify the returned depth matches the Depth header
4. Verify the normalised balance is greater than zero (batch is alive)

## Backwards Compatibility

This is a new format with no existing implementations to maintain compatibility with.

## Test Cases

### Minimal Valid File

```
-----BEGIN BOOK OF STAMPS-----
Version: 1
Batch-Id: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
Owner: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
Depth: 20
Bucket-Depth: 16
Amount: 1000000000
Usage: 0/1048576

QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVoxMjM0NTY=
-----END BOOK OF STAMPS-----
```

### Round-trip Property

For any valid Book of Stamps file F: `serialize(deserialize(F)) == F`

## Implementation

Reference implementation: `stamp-machine/src/stampbook.ts` in the swapchat2 repository.
