function raf(): Promise<void> {
  return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))
}

export async function animateCoinInsert(slot: HTMLElement): Promise<void> {
  const coin = document.createElement('div')
  coin.className = 'coin'
  slot.style.position = 'relative'
  slot.appendChild(coin)
  await raf()
  coin.classList.add('dropping')
  await new Promise(r => setTimeout(r, 600))
  coin.remove()
}

export async function animateKnobTurn(knob: HTMLElement): Promise<void> {
  knob.classList.add('turned')
  await new Promise(r => setTimeout(r, 500))
}

export async function animateDispense(booklet: HTMLElement): Promise<void> {
  booklet.classList.add('dispensed')
  await new Promise(r => setTimeout(r, 800))
}

export async function animateReject(chute: HTMLElement): Promise<void> {
  const coin = document.createElement('div')
  coin.className = 'coin'
  chute.style.position = 'relative'
  chute.appendChild(coin)
  await raf()
  coin.classList.add('rejected')
  await new Promise(r => setTimeout(r, 800))
  coin.remove()
}

export function resetMachine(knob: HTMLElement, booklet: HTMLElement): void {
  knob.classList.remove('turned')
  booklet.classList.remove('dispensed')
}
