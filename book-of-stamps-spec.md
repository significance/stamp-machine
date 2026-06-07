# Book of Stamps

A portable key file format for Swarm postage batch credentials.

## Authors

sig (@significance)

## Abstract

A Book of Stamps encapsulates the private key of an ephemeral wallet — the owner of a Swarm postage batch — alongside the batch metadata needed to resume uploading. The format draws on the conventions of PEM-encoded keys: ASCII delimiters, colon-separated headers, and a base64 body. It adds a compact representation of bucket utilisation state, encoded as a trie and rendered in xxd notation, so that a partially-used batch can be transferred between applications without loss of stamping position.

## Motivation

A Swarm postage batch is identified by its batch ID, but uploading against it requires the private key of the address that owns it. These two pieces of information — the credential and the context — are typically configured separately, which introduces friction when batches are purchased on behalf of others or moved between tools.

The word "book" is borrowed from philately. A book of stamps is a small folded card containing a sheet of adhesive postage stamps, sold at post offices and vending machines for convenience. The analogy holds: a Book of Stamps file is a compact, self-contained unit of postage, ready for use.

The format enables:

- One-step batch provisioning through web interfaces and vending machines
- Transfer of batch credentials between Swarm applications
- Backup and restoration of batch state, including partial utilisation
- Delegation of upload rights without sharing node-level keys

## Specification

### Envelope

The file is plain UTF-8 text. It opens with the delimiter `-----BEGIN BOOK OF STAMPS-----` and closes with `-----END BOOK OF STAMPS-----`. All content between the delimiters is divided into two sections — headers and body — separated by a single blank line.

```
-----BEGIN BOOK OF STAMPS-----
Version: 1
Batch-Id: <64 hex characters>
Owner: <40 hex characters>
Depth: <integer>
Bucket-Depth: <integer>
Amount: <integer>
Usage: <usage representation>

<base64-encoded private key>
-----END BOOK OF STAMPS-----
```

A trailing newline after the closing delimiter is permitted but not required.

### Headers

Headers follow RFC 822 conventions: a case-sensitive field name, a colon, a single space, and the value. Each header occupies one line. All headers listed below are required.

| Header | Format | Description |
|--------|--------|-------------|
| `Version` | decimal integer | Format version. Currently `1`. |
| `Batch-Id` | 64 hexadecimal characters | The 32-byte postage batch identifier, without `0x` prefix. |
| `Owner` | 40 hexadecimal characters | The Ethereum address of the batch owner wallet, without `0x` prefix. |
| `Depth` | decimal integer | Batch depth. The batch can accommodate 2^depth chunks. |
| `Bucket-Depth` | decimal integer | Bucket depth. The stamper distributes chunks across 2^bucketDepth buckets. |
| `Amount` | decimal integer | Balance per chunk, denominated in plurs (the smallest unit of BZZ: 1 BZZ = 10^16 plurs). |
| `Usage` | see below | A summary of batch utilisation, optionally followed by encoded bucket state. |

### Usage field

The Usage field describes how much of the batch has been consumed. It takes one of two forms.

**Fresh or summary form.** When no per-bucket state is present — either because the batch has not been used, or because the bucket counters are all zero — the field contains a fraction:

```
Usage: 0/1048576
```

The numerator is the total number of stamps consumed across all buckets. The denominator is the batch capacity, equal to 2^depth.

**Stateful form.** When one or more buckets have been used, the bucket counters are preserved so that a receiving application can resume stamping from the correct position. The field contains the fraction, a byte count, and the word `bytes`, followed on subsequent lines by the encoded state rendered in xxd notation:

```
Usage: 5/1048576 27 bytes
00000000: 0110 1400 0102 0305 0001 0200 0000 0000  ................
00000010: 0000 0000 0000 0000 0000 00              ...........
```

The binary data within the xxd block is a trie-encoded representation of the bucket array, described below.

### Trie encoding

The bucket array — a sequence of 2^bucketDepth unsigned 32-bit integers — is compressed into a binary trie. The encoding exploits the sparsity typical of partially-used batches: an empty batch compresses to four bytes; a batch with a handful of used buckets compresses to tens of bytes rather than hundreds of kilobytes.

**Header.** The first three bytes of the encoded form are:

| Offset | Field | Description |
|--------|-------|-------------|
| 0 | version | Trie encoding version. Currently `0x01`. |
| 1 | bucketDepth | The bucket depth parameter. |
| 2 | batchDepth | The batch depth parameter. |

**Node tags.** After the header, the trie is a recursive structure of tagged nodes. Each node begins with a single-byte tag:

| Tag | Name | Meaning |
|-----|------|---------|
| `0x00` | ZERO | The entire subtree is zero. No further data follows. |
| `0x01` | BRANCH | The subtree is split in two. The left child follows immediately, then the right. |
| `0x02` | DATA | A leaf node. The bucket counter follows, encoded as a LEB128 unsigned varint. |

The root node spans the full bucket array. At each BRANCH, the range is halved: the left child covers the lower indices, the right child the upper. Recursion terminates when a subtree is entirely zero (ZERO) or when the range contains a single bucket (DATA).

**LEB128 varints.** Counter values are encoded using unsigned LEB128. Each byte contributes seven bits of data; the high bit indicates whether another byte follows. The value 5 encodes as `0x05`; the value 300 encodes as `0xAC 0x02`.

### Xxd notation

The trie-encoded bytes are rendered in xxd format for human readability and safe embedding within the text envelope. Each line contains:

- An eight-character hexadecimal offset, followed by a colon and a space.
- Up to eight groups of two bytes each (four hex digits per group), space-separated.
- Two spaces, then the ASCII interpretation of the same bytes. Printable characters (0x20 through 0x7E) appear as themselves; all others appear as a period.

Lines are 16 bytes wide. The final line may be shorter.

```
00000000: 0110 1400 0102 0305 0001 0200 0000 0000  ................
00000010: 0000 0000 0000 00                        .......
```

Parsers locate the hex portion by splitting on the colon and then on the double-space separator. Hex groups are read left to right, two characters at a time.

### Body

The body section — everything between the blank line and the closing delimiter — contains the base64 encoding of the 32-byte secp256k1 private key belonging to the batch owner wallet. Lines are wrapped at 64 characters, following PEM convention.

### Filename convention

Files use the `.txt` extension and follow the naming pattern:

```
book-of-stamps-<first 8 hex characters of batch ID>.txt
```

### Parsing algorithm

1. Locate the opening and closing delimiters. Reject the input if either is absent or if the closing delimiter precedes the opening one.
2. Between the delimiters, read lines as headers until the first blank line. Each header is split on the first occurrence of `: ` (colon-space). Lines matching the pattern `^[0-9a-f]{8}:` are xxd data belonging to the preceding Usage header.
3. Verify that all required headers are present.
4. If xxd lines were collected, decode them from xxd notation and then from the trie encoding to reconstruct the bucket array.
5. Concatenate the remaining non-empty lines after the blank separator and decode the result as base64 to obtain the 32-byte private key.

### Security considerations

The private key within a Book of Stamps grants full control over the associated postage batch. The file warrants the same care as any cryptocurrency private key.

- Applications should warn before importing a Book of Stamps from an untrusted source.
- The file should not be transmitted over unencrypted channels.
- Upon import, applications should verify the batch on-chain: confirm that it exists, that the owner matches the derived address, and that the normalised balance is greater than zero.

### On-chain verification

To verify a Book of Stamps against the Gnosis chain:

1. Call `batches(bytes32)` on the PostageStamp contract at `0x45a1502382541Cd610CC9068e88727426b696293` with the Batch-Id.
2. Confirm that the returned owner matches the Owner header.
3. Confirm that the returned depth matches the Depth header.
4. Confirm that the normalised balance is greater than zero — indicating the batch has not expired.

## Test vectors

### Fresh batch

A depth-20 batch with no stamps consumed and a private key of 32 `0x42` bytes:

```
-----BEGIN BOOK OF STAMPS-----
Version: 1
Batch-Id: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
Owner: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
Depth: 20
Bucket-Depth: 16
Amount: 1000000000
Usage: 0/1048576

QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=
-----END BOOK OF STAMPS-----
```

### Partially-used batch

The same batch after consuming 5 stamps in bucket 0, 12 in bucket 1000, and 1 in bucket 65535:

```
-----BEGIN BOOK OF STAMPS-----
Version: 1
Batch-Id: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
Owner: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
Depth: 20
Bucket-Depth: 16
Amount: 1000000000
Usage: 18/1048576 87 bytes
00000000: 0110 1401 0101 0101 0101 0101 0101 0101  ................
00000010: 0101 0102 0500 0000 0000 0000 0000 0100  ................
00000020: 0100 0100 0100 0101 0001 0101 020c 0000  ................
00000030: 0000 0000 0000 0001 0001 0001 0001 0001  ................
00000040: 0001 0001 0001 0001 0001 0001 0001 0001  ................
00000050: 0001 0001 0002 01                        .......

QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=
-----END BOOK OF STAMPS-----
```

### Round-trip property

For any valid Book of Stamps text F: `serialize(deserialize(F))` produces output identical to F.

## Reference implementation

The `book-of-stamps` package in the swapchat2 repository provides `serialize` and `deserialize` functions, along with the trie codec and xxd formatter.

## Backwards compatibility

This is a new format. No prior implementations exist.
