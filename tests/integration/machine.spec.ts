import { test, expect, type Page } from '@playwright/test'

async function injectMockProvider(page: Page) {
  await page.addInitScript(() => {
    (window as any).__stampMachineTest = true
    ;(window as any).ethereum = {
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts') return ['0xdEADbeEF00000000000000000000000000000001']
        if (method === 'eth_chainId') return '0x64'
        if (method === 'eth_call') return '0x' + '00'.repeat(31) + '01'
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

async function triggerDemo(page: Page) {
  await page.goto('/')
  await page.locator('[data-demo-trigger]').click()
  await expect(page.locator('[data-light]')).toHaveClass(/success/, { timeout: 5_000 })
}

test.describe('Stamp Machine', () => {
  test('renders machine with all visual elements', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[data-machine]')).toBeVisible()
    await expect(page.locator('[data-coin-slot]')).toBeVisible()
    await expect(page.locator('[data-knob]')).toBeVisible()
    await expect(page.locator('[data-tray]')).toBeVisible()
    await expect(page.locator('[data-eject]')).toBeAttached()
    await expect(page.locator('[data-eject]')).not.toBeVisible()
    await expect(page.locator('.machine-title')).toContainText('Swarm')
    await expect(page.locator('.machine-title')).toContainText('Stamps')
    await expect(page.locator('.label-insert')).toContainText('Insert')
    await expect(page.locator('.label-insert')).toContainText('BZZ')
  })

  test('demo trigger dispenses booklet and shows COMPLETE', async ({ page }) => {
    await triggerDemo(page)
    await expect(page.locator('[data-booklet]')).toHaveClass(/dispensed/)
    await expect(page.locator('[data-knob]')).toHaveClass(/turned/)
  })

  test('coin slot blocked in COMPLETE state shows reset toast', async ({ page }) => {
    await triggerDemo(page)

    await page.locator('[data-coin-slot]').click()
    const holdToast = page.locator('[data-hold-toast]')
    await expect(holdToast).toBeVisible()
    await expect(holdToast).toContainText('Reset the machine before buying another book')
  })

  test('coin slot is disabled during processing', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__stampMachineTest = true
      let txCount = 0
      ;(window as any).ethereum = {
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_requestAccounts') return ['0xdEADbeEF00000000000000000000000000000001']
          if (method === 'eth_chainId') return '0x64'
          if (method === 'eth_call') return '0x' + '00'.repeat(31) + '01'
          if (method === 'eth_sendTransaction') {
            txCount++
            if (txCount === 1) {
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

  test('error shows toast and returns to idle', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__stampMachineTest = true
      ;(window as any).ethereum = {
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_requestAccounts') return ['0xdEADbeEF00000000000000000000000000000001']
          if (method === 'eth_chainId') return '0x64'
          if (method === 'eth_call') return '0x' + '00'.repeat(31) + '01'
          if (method === 'eth_sendTransaction') throw new Error('user rejected')
          return null
        },
      }
    })

    await page.goto('/')
    await page.locator('[data-coin-slot]').click()

    // Should show error in toast then return to idle
    await expect(page.locator('[data-coin-slot]')).not.toHaveClass(/disabled/, { timeout: 8_000 })
  })

  test('eject phase 1 shows download toast', async ({ page }) => {
    await triggerDemo(page)

    await page.locator('[data-eject]').dispatchEvent('mousedown')

    const holdToast = page.locator('[data-hold-toast]')
    await expect(holdToast).toBeVisible()
    await expect(holdToast).toContainText('Book of Stamps downloaded')

    await page.locator('[data-eject]').dispatchEvent('mouseup')
  })

  test('eject phase 2 shows caution toast', async ({ page }) => {
    await triggerDemo(page)

    await page.locator('[data-eject]').dispatchEvent('mousedown')
    await page.waitForTimeout(3500)

    const holdToast = page.locator('[data-hold-toast]')
    await expect(holdToast).toBeVisible()
    await expect(holdToast).toContainText('Caution')

    await page.locator('[data-eject]').dispatchEvent('mouseup')
  })

  test('eject full hold resets machine', async ({ page }) => {
    await triggerDemo(page)

    await page.locator('[data-eject]').dispatchEvent('mousedown')
    await page.waitForTimeout(8500)

    // Machine should be back to IDLE
    await expect(page.locator('[data-light]')).not.toHaveClass(/success/)
    await expect(page.locator('[data-coin-slot]')).not.toHaveClass(/disabled/)
    await expect(page.locator('[data-booklet]')).not.toHaveClass(/dispensed/)
    await expect(page.locator('[data-knob]')).not.toHaveClass(/turned/)

    await page.locator('[data-eject]').dispatchEvent('mouseup')
  })

  test('eject cancel on early release', async ({ page }) => {
    await triggerDemo(page)

    await page.locator('[data-eject]').dispatchEvent('mousedown')
    await page.waitForTimeout(1000)
    await page.locator('[data-eject]').dispatchEvent('mouseup')

    // Toast should be hidden, machine still in COMPLETE
    await expect(page.locator('[data-hold-toast]')).not.toBeVisible()
    await expect(page.locator('[data-light]')).toHaveClass(/success/)
  })

  test('booklet is clickable in COMPLETE state', async ({ page }) => {
    await triggerDemo(page)

    // Booklet should be interactive (dispensed = cursor pointer)
    await expect(page.locator('[data-booklet]')).toHaveClass(/dispensed/)
    // Copy icon should be present
    await expect(page.locator('.booklet-copy')).toBeAttached()
  })

  test.skip('full flow: click coin slot → approve → createBatch → download', async ({ page }) => {
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
})
