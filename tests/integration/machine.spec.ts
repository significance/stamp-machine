import { test, expect, type Page } from '@playwright/test'

async function injectMockProvider(page: Page) {
  await page.addInitScript(() => {
    (window as any).__stampMachineTest = true
    ;(window as any).ethereum = {
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts') return ['0xdEADbeEF00000000000000000000000000000001']
        if (method === 'eth_chainId') return '0x64'
        if (method === 'eth_sendTransaction') return '0x' + 'cc'.repeat(32)
        if (method === 'eth_getTransactionReceipt') return {
          status: '0x1',
          logs: [{
            address: '0x45a1502382541Cd610CC9068e88727426b696293',
            topics: ['0x' + '00'.repeat(32), '0x' + 'ab'.repeat(32)],
            data: '0x',
          }],
        }
        return null
      },
    }
  })
}

test.describe('Stamp Machine', () => {
  test('renders machine with all visual elements', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[data-machine]')).toBeVisible()
    await expect(page.locator('[data-coin-slot]')).toBeVisible()
    await expect(page.locator('[data-knob]')).toBeVisible()
    await expect(page.locator('[data-tray]')).toBeVisible()
    await expect(page.locator('.machine-title')).toContainText('Swarm')
    await expect(page.locator('.machine-title')).toContainText('Stamps')
    await expect(page.locator('.label-insert')).toContainText('Insert')
    await expect(page.locator('.label-insert')).toContainText('BZZ')
    await expect(page.locator('.label-collect')).toContainText('Collect')
  })

  test('full flow: click coin slot → approve → createBatch → download', async ({ page }) => {
    await injectMockProvider(page)

    const downloadPromise = page.waitForEvent('download')

    await page.goto('/')
    await page.locator('[data-coin-slot]').click()

    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^book-of-stamps-.*\.txt$/)

    const content = await download.createReadStream().then(stream => {
      return new Promise<string>((resolve) => {
        let data = ''
        stream.on('data', (chunk: Buffer) => data += chunk.toString())
        stream.on('end', () => resolve(data))
      })
    })

    expect(content).toContain('-----BEGIN BOOK OF STAMPS-----')
    expect(content).toContain('-----END BOOK OF STAMPS-----')
    expect(content).toContain('Version: 1')
    expect(content).toContain('Depth: 20')
    expect(content).toContain('Bucket-Depth: 16')
    expect(content).toContain('Usage: 0/1048576')
  })

  test('shows status text during flow', async ({ page }) => {
    await injectMockProvider(page)

    await page.goto('/')

    const status = page.locator('[data-status]')
    await expect(status).toHaveText('')

    await page.locator('[data-coin-slot]').click()

    // Should eventually show completion message
    await expect(status).toHaveText('Book of stamps downloaded! Click booklet to copy.', { timeout: 10_000 })
  })

  test('coin slot is disabled during processing', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__stampMachineTest = true
      let txCount = 0
      ;(window as any).ethereum = {
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_requestAccounts') return ['0xdEADbeEF00000000000000000000000000000001']
          if (method === 'eth_chainId') return '0x64'
          if (method === 'eth_sendTransaction') {
            txCount++
            if (txCount === 1) {
              // Delay approve to give us time to check disabled state
              await new Promise(r => setTimeout(r, 500))
            }
            return '0x' + 'cc'.repeat(32)
          }
          if (method === 'eth_getTransactionReceipt') return {
            status: '0x1',
            logs: [{
              address: '0x45a1502382541Cd610CC9068e88727426b696293',
              topics: ['0x' + '00'.repeat(32), '0x' + 'ab'.repeat(32)],
              data: '0x',
            }],
          }
          return null
        },
      }
    })

    await page.goto('/')
    await page.locator('[data-coin-slot]').click()

    // Coin slot should have disabled class while processing
    await expect(page.locator('[data-coin-slot]')).toHaveClass(/disabled/, { timeout: 2_000 })
  })

  test('error shows rejected animation and returns to idle', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__stampMachineTest = true
      ;(window as any).ethereum = {
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_requestAccounts') return ['0xdEADbeEF00000000000000000000000000000001']
          if (method === 'eth_chainId') return '0x64'
          if (method === 'eth_sendTransaction') throw new Error('user rejected')
          return null
        },
      }
    })

    await page.goto('/')
    await page.locator('[data-coin-slot]').click()

    // Should return to idle (no disabled class)
    await expect(page.locator('[data-coin-slot]')).not.toHaveClass(/disabled/, { timeout: 5_000 })
    await expect(page.locator('[data-status]')).toHaveText('')
  })
})
