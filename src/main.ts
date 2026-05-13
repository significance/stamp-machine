import { connectWallet, getConnectedAccount, ensureGnosisChain } from './wallet'
import { approveBzz, createBatch, BATCH_DEPTH, BUCKET_DEPTH, AMOUNT_PER_CHUNK, TOTAL_COST } from './batch'
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
  COMPLETE: 'Book of stamps downloaded! Click booklet to copy.',
}

const STORAGE_KEY = 'stamp-machine:current-book'

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

document.addEventListener('DOMContentLoaded', async () => {
  const coinSlot = document.querySelector<HTMLElement>('[data-coin-slot]')!
  const knob = document.querySelector<HTMLElement>('[data-knob]')!
  const booklet = document.querySelector<HTMLElement>('[data-booklet]')!
  const status = document.querySelector<HTMLElement>('[data-status]')!
  const light = document.querySelector<HTMLElement>('[data-light]')!
  const toast = document.querySelector<HTMLElement>('[data-toast]')!
  const batchInfo = document.querySelector<HTMLElement>('[data-batch-info]')!

  let state: MachineState = 'IDLE'
  let lastContent: string | null = null

  // Display dynamic cost (BZZ has 16 decimals on Gnosis)
  const costEl = document.querySelector<HTMLElement>('[data-cost]')
  if (costEl) {
    const BZZ_DECIMALS = 16n
    const whole = TOTAL_COST / (10n ** BZZ_DECIMALS)
    const frac = TOTAL_COST % (10n ** BZZ_DECIMALS)
    const fracStr = frac.toString().padStart(Number(BZZ_DECIMALS), '0').slice(0, 4)
    const display = fracStr ? `${whole}.${fracStr}` : `${whole}`
    costEl.textContent = `${display} BZZ`
  }

  function setState(next: MachineState) {
    state = next
    status.textContent = STATUS_TEXT[next]
    coinSlot.classList.toggle('disabled', next !== 'IDLE' && next !== 'COMPLETE')

    const processing = next !== 'IDLE' && next !== 'COMPLETE'
    light.classList.toggle('active', processing)
    light.classList.toggle('success', next === 'COMPLETE')
  }

  async function showBatchStatus(batchId: string, createdAt: string) {
    const date = new Date(createdAt)
    const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    batchInfo.textContent = `${batchId.slice(0, 8)}\u2026 \u00b7 ${dateStr}`

    try {
      const alive = await checkBatchAlive(batchId)
      if (!alive) {
        batchInfo.innerHTML = `${batchId.slice(0, 8)}\u2026 \u00b7 ${dateStr} <span class="expired">expired</span>`
      }
    } catch {
      // RPC unavailable — just show the date
    }
  }

  // Click booklet to copy to clipboard
  booklet.addEventListener('click', async (e) => {
    e.stopPropagation()
    if (!lastContent) return
    try {
      await navigator.clipboard.writeText(lastContent)
      toast.classList.add('show')
      setTimeout(() => toast.classList.remove('show'), 2000)
    } catch {
      // Clipboard API may fail in some contexts
    }
  })

  // Restore from localStorage on load
  const stored = loadBook()
  if (stored) {
    lastContent = stored.content
    await animateDispense(booklet)
    setState('COMPLETE')
    showBatchStatus(stored.batchId, stored.createdAt)
  }

  // Demo: click "Coin" label to preview the dispense animation
  const demoTrigger = document.querySelector<HTMLElement>('[data-demo-trigger]')
  if (demoTrigger) {
    demoTrigger.addEventListener('click', async () => {
      if (state !== 'IDLE') return
      setState('DISPENSING')
      await animateCoinInsert(coinSlot)
      await animateKnobTurn(knob)
      await animateDispense(booklet)
      setState('COMPLETE')
    })
  }

  coinSlot.addEventListener('click', async () => {
    if (state !== 'IDLE') return

    try {
      // Reset any previous booklet
      resetMachine(knob, booklet)
      batchInfo.textContent = ''

      setState('CONNECTING')
      await animateCoinInsert(coinSlot)

      const provider = await connectWallet()
      await ensureGnosisChain(provider)
      const from = await getConnectedAccount(provider)

      setState('GENERATING')
      const burner = generateBurnerWallet()

      setState('APPROVING')
      await approveBzz(provider, from)

      setState('CREATING')
      const { batchId } = await createBatch(provider, from, burner.address)

      setState('DISPENSING')
      await animateKnobTurn(knob)
      await animateDispense(booklet)

      const content = serializeStampBook({
        version: 1,
        batchId,
        owner: burner.address.slice(2).toLowerCase(),
        depth: BATCH_DEPTH,
        bucketDepth: BUCKET_DEPTH,
        amount: AMOUNT_PER_CHUNK,
        privateKey: burner.privateKey,
        usage: `0/${1 << BATCH_DEPTH}`,
      })

      lastContent = content
      const createdAt = new Date().toISOString()
      saveBook({ content, batchId, createdAt })
      triggerDownload(content, `book-of-stamps-${batchId.slice(0, 8)}.txt`)
      setState('COMPLETE')
      showBatchStatus(batchId, createdAt)

    } catch (err) {
      console.error('[stamp-machine]', err)
      resetMachine(knob, booklet)
      setState('IDLE')
    }
  })
})
