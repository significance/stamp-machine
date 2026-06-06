import { connectWallet, getConnectedAccount, ensureGnosisChain } from './wallet'
import { approveBzz, createBatch, waitForReceipt, BATCH_DEPTH, BUCKET_DEPTH, calculateBatchCost, checkBzzSufficient, POSTAGE_CONTRACT, BZZ_TOKEN } from './batch'
import { generateBurnerWallet } from './keygen'
import { serializeStampBook } from './stampbook'
import { triggerDownload } from './download'
import { animateCoinInsert, animateKnobTurn, animateDispense, resetMachine } from './animation'
import { checkBatchAlive } from './chain'

type MachineState = 'IDLE' | 'CONNECTING' | 'GENERATING' | 'APPROVING' | 'CREATING' | 'DISPENSING' | 'COMPLETE'

const STATUS_TEXT: Record<MachineState, string> = {
  IDLE: '',
  CONNECTING: 'Connecting wallet\u2026',
  GENERATING: 'Generating stamp wallet\u2026',
  APPROVING: 'Approve BZZ spend\u2026',
  CREATING: 'Creating postage batch\u2026',
  DISPENSING: 'Dispensing book of stamps\u2026',
  COMPLETE: '',
}

const STORAGE_KEY = 'stamp-machine:current-book'

// ╔═══════════════════════════════════════════════════════════╗
// ║  5W4RM 5T4MP M4CH1N3  //  h4x0r c0ns0l3                 ║
// ╚═══════════════════════════════════════════════════════════╝

const l33t = (tag: string, msg: string, ...args: unknown[]) =>
  console.log(
    `%c[5T4MP-M4CH1N3]%c ${tag} %c${msg}`,
    'color:#fe7900;font-weight:bold',
    'color:#f5c518;font-weight:bold',
    'color:#aaa',
    ...args,
  )

const l33tErr = (tag: string, msg: string, ...args: unknown[]) =>
  console.error(
    `%c[5T4MP-M4CH1N3]%c ${tag} %c${msg}`,
    'color:#fe7900;font-weight:bold',
    'color:#ff4444;font-weight:bold',
    'color:#aaa',
    ...args,
  )

interface StoredBook {
  content: string
  batchId: string
  createdAt: string
}

function saveBook(book: StoredBook) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(book))
}

function loadBook(): StoredBook | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

function formatBzz(plurs: bigint): string {
  const val = Number(plurs) / 1e16
  if (val === 0) return '0'
  if (val >= 1) return val.toFixed(2)
  if (val >= 0.01) return val.toFixed(4)
  return val.toExponential(3)
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log(`%c
  ╔══════════════════════════════════════════╗
  ║   5W4RM  P0ST4G3  5T4MP  M4CH1N3       ║
  ║   ────────────────────────────────       ║
  ║   1NS3RT C01N  >>  C0LL3CT ST4MPS       ║
  ║                                          ║
  ║   p0st4g3: ${POSTAGE_CONTRACT.slice(0, 10)}...  ║
  ║   bzz:     ${BZZ_TOKEN.slice(0, 10)}...  ║
  ║   d3pth:   ${BATCH_DEPTH} (2^${BATCH_DEPTH} = ${(1 << BATCH_DEPTH).toLocaleString()} chunks) ║
  ║   buck3ts: ${BUCKET_DEPTH} (2^${BUCKET_DEPTH} = ${(1 << BUCKET_DEPTH).toLocaleString()} buckets)║
  ╚══════════════════════════════════════════╝
`, 'color:#fe7900;font-family:monospace')

  const coinSlot = document.querySelector<HTMLElement>('[data-coin-slot]')!
  const knob = document.querySelector<HTMLElement>('[data-knob]')!
  const booklet = document.querySelector<HTMLElement>('[data-booklet]')!
  const light = document.querySelector<HTMLElement>('[data-light]')!
  const copiedToast = document.querySelector<HTMLElement>('[data-toast]')!
  const holdToast = document.querySelector<HTMLElement>('[data-hold-toast]')!
  const batchInfo = document.querySelector<HTMLElement>('[data-batch-info]')!
  const costEl = document.querySelector<HTMLElement>('[data-cost]')
  const ejectBtn = document.querySelector<HTMLElement>('[data-eject]')!

  let state: MachineState = 'IDLE'
  let lastContent: string | null = null

  function showToast(text: string) {
    holdToast.textContent = text
    holdToast.classList.remove('filling')
    holdToast.classList.add('show')
  }

  function hideToast() {
    holdToast.classList.remove('show', 'filling')
    void holdToast.offsetWidth
  }

  // Fetch dynamic cost on load
  if (costEl) {
    costEl.textContent = '... BZZ'
    l33t('PR1C3', 'f3tch1ng curr3nt st4mp pr1c3 fr0m gn0s1s...')
    calculateBatchCost().then(({ amountPerChunk, totalCost }) => {
      costEl.textContent = `${formatBzz(totalCost)} BZZ`
      l33t('PR1C3', `m1n p3r chunk: ${amountPerChunk} plurs`)
      l33t('PR1C3', `t0t4l c0st: ${totalCost} plurs (${formatBzz(totalCost)} BZZ)`)
    }).catch((err) => {
      costEl.textContent = '? BZZ'
      l33tErr('PR1C3', `f41l3d t0 f3tch: ${err}`)
    })
  }

  function setState(next: MachineState) {
    state = next
    const text = STATUS_TEXT[next]
    if (text) { showToast(text) } else { hideToast() }
    coinSlot.classList.toggle('disabled', next !== 'IDLE' && next !== 'COMPLETE')
    l33t('ST4T3', `${next}`)

    const processing = next !== 'IDLE' && next !== 'COMPLETE'
    light.classList.toggle('active', processing)
    light.classList.toggle('success', next === 'COMPLETE')
  }

  async function showBatchStatus(batchId: string, createdAt: string) {
    const date = new Date(createdAt)
    const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    batchInfo.textContent = `${batchId.slice(0, 8)}\u2026 \u00b7 ${dateStr}`

    l33t('CH3CK', `v3r1fy1ng b4tch ${batchId.slice(0, 16)}... 0n-ch41n`)
    try {
      const alive = await checkBatchAlive(batchId)
      if (alive) {
        l33t('CH3CK', `b4tch 1s 4L1V3`)
      } else {
        l33tErr('CH3CK', `b4tch 1s D34D (3xp1r3d)`)
        batchInfo.innerHTML = `${batchId.slice(0, 8)}\u2026 \u00b7 ${dateStr} <span class="expired">expired</span>`
      }
    } catch {
      l33t('CH3CK', `rpc unr34ch4bl3, sk1pp1ng v3r1f1c4t10n`)
    }
  }

  // Click booklet to copy to clipboard
  booklet.addEventListener('click', async (e) => {
    e.stopPropagation()
    if (!lastContent) return
    try {
      await navigator.clipboard.writeText(lastContent)
      copiedToast.classList.add('show')
      setTimeout(() => copiedToast.classList.remove('show'), 2000)
      l33t('CL1P', 'b00k 0f st4mps c0p13d t0 cl1pb04rd')
    } catch {
      // Clipboard API may fail in some contexts
    }
  })

  // Restore from localStorage on load
  const stored = loadBook()
  if (stored) {
    l33t('R3ST0R3', `f0und s4v3d b00k: ${stored.batchId.slice(0, 16)}...`)
    lastContent = stored.content
    await animateDispense(booklet)
    setState('COMPLETE')
    showBatchStatus(stored.batchId, stored.createdAt)
  } else {
    l33t('R3ST0R3', 'n0 s4v3d b00k, m4ch1n3 r34dy')
  }

  // Demo: click "Coin" label to preview the dispense animation
  const demoTrigger = document.querySelector<HTMLElement>('[data-demo-trigger]')
  if (demoTrigger) {
    demoTrigger.addEventListener('click', async () => {
      if (state !== 'IDLE') return
      l33t('D3M0', 'd3m0 m0d3 4ct1v4t3d')
      setState('DISPENSING')
      await animateCoinInsert(coinSlot)
      await animateKnobTurn(knob)
      await animateDispense(booklet)
      setState('COMPLETE')
    })
  }

  // Eject: hold-to-reset logic (3s phase1 + 5s phase2 = 8s total)
  let holdTimer: ReturnType<typeof setTimeout> | null = null
  let phaseTimer: ReturnType<typeof setTimeout> | null = null

  function startEjectHold() {
    // Trigger download of the book
    const book = loadBook()
    if (book) {
      triggerDownload(book.content, `book-of-stamps-${book.batchId.slice(0, 8)}.txt`)
      l33t('3J3CT', 'b00k 0f st4mps d0wnl04d3d')
    }

    showToast('Book of Stamps downloaded. Hold to reset')

    phaseTimer = setTimeout(() => {
      showToast('Caution: storage will be deleted. Hold to reset.')
      void holdToast.offsetWidth
      holdToast.classList.add('filling')
    }, 3000)

    holdTimer = setTimeout(() => {
      localStorage.removeItem(STORAGE_KEY)
      lastContent = null
      resetMachine(knob, booklet)
      batchInfo.textContent = ''
      hideToast()
      setState('IDLE')
      l33t('3J3CT', 'st0r4g3 cl34r3d, m4ch1n3 r3s3t')
    }, 8000)
  }

  function cancelEjectHold() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
    if (phaseTimer) { clearTimeout(phaseTimer); phaseTimer = null }
    hideToast()
  }

  ejectBtn.addEventListener('mousedown', startEjectHold)
  ejectBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startEjectHold() })
  ejectBtn.addEventListener('mouseup', cancelEjectHold)
  ejectBtn.addEventListener('mouseleave', cancelEjectHold)
  ejectBtn.addEventListener('touchend', cancelEjectHold)
  ejectBtn.addEventListener('touchcancel', cancelEjectHold)

  coinSlot.addEventListener('click', async () => {
    if (state === 'COMPLETE') {
      showToast('Reset the machine before buying another book')
      setTimeout(hideToast, 2500)
      return
    }
    if (state !== 'IDLE') return
    const t0 = performance.now()

    try {
      resetMachine(knob, booklet)
      batchInfo.textContent = ''

      l33t('C01N', '>> c01n 1ns3rt3d, 1n1t14t1ng s3qu3nc3...')

      setState('CONNECTING')
      await animateCoinInsert(coinSlot)

      l33t('W4LL3T', 'c0nn3ct1ng w4ll3t v14 31p-1193...')
      const provider = await connectWallet()

      l33t('CH41N', '3nsur1ng gn0s1s ch41n (0x64)...')
      await ensureGnosisChain(provider)

      const from = await getConnectedAccount(provider)
      l33t('W4LL3T', `c0nn3ct3d: ${from}`)

      setState('GENERATING')
      const burner = generateBurnerWallet()
      l33t('K3YG3N', `burn3r w4ll3t g3n3r4t3d: ${burner.address}`)
      l33t('K3YG3N', `k3y: ${burner.privateKeyHex.slice(0, 10)}...[r3d4ct3d]`)

      l33t('PR1C3', 'c4lcul4t1ng dyn4m1c b4tch c0st...')
      const { amountPerChunk, totalCost } = await calculateBatchCost()
      l33t('PR1C3', `4m0unt/chunk: ${amountPerChunk} | t0t4l: ${totalCost} (${formatBzz(totalCost)} BZZ)`)

      l33t('B4L4NC3', `ch3ck1ng BZZ b4l4nc3 f0r ${from.slice(0, 10)}...`)
      await checkBzzSufficient(from, totalCost)
      l33t('B4L4NC3', 'suff1c13nt BZZ c0nf1rm3d')

      if (costEl) costEl.textContent = `${formatBzz(totalCost)} BZZ`

      setState('APPROVING')
      l33t('4PPR0V3', `BZZ.4ppr0v3(${POSTAGE_CONTRACT.slice(0, 10)}..., ${totalCost})`)
      const approveTxHash = await approveBzz(provider, from, totalCost)
      l33t('4PPR0V3', `tx s3nt: ${approveTxHash}`)
      l33t('4PPR0V3', 'w41t1ng f0r r3c31pt...')
      await waitForReceipt(provider, approveTxHash)
      l33t('4PPR0V3', '4ppr0v4l c0nf1rm3d')

      setState('CREATING')
      l33t('B4TCH', `cr34t3B4tch(0wn3r=${burner.address.slice(0, 10)}..., 4mt=${amountPerChunk}, d=${BATCH_DEPTH}, bd=${BUCKET_DEPTH})`)
      const { batchId, txHash } = await createBatch(provider, from, burner.address, amountPerChunk)
      l33t('B4TCH', `b4tch cr34t3d! tx: ${txHash}`)
      l33t('B4TCH', `b4tch 1d: ${batchId}`)

      setState('DISPENSING')
      await animateKnobTurn(knob)
      await animateDispense(booklet)

      const content = serializeStampBook({
        version: 1,
        batchId,
        owner: burner.address.slice(2).toLowerCase(),
        depth: BATCH_DEPTH,
        bucketDepth: BUCKET_DEPTH,
        amount: amountPerChunk,
        privateKey: burner.privateKey,
        buckets: null,
      })

      lastContent = content
      const createdAt = new Date().toISOString()
      saveBook({ content, batchId, createdAt })
      triggerDownload(content, `book-of-stamps-${batchId.slice(0, 8)}.txt`)
      setState('COMPLETE')
      showBatchStatus(batchId, createdAt)

      const elapsed = ((performance.now() - t0) / 1000).toFixed(1)
      l33t('D0N3', `b00k 0f st4mps d1sp3ns3d 1n ${elapsed}s. gg wp.`)

    } catch (err) {
      l33tErr('F41L', `${err}`)
      showToast(err instanceof Error ? err.message : 'Transaction failed')
      resetMachine(knob, booklet)
      setTimeout(() => setState('IDLE'), 5000)
    }
  })
})
