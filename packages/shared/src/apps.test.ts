import { describe, expect, it } from 'vitest'
import { appCellCode, appIdFromCode } from './apps'
import { toIpynb, fromIpynb } from './ipynb'
import { newPromptCell } from './notebook'

describe('app cell references', () => {
  it('survives an ordinary notebook round trip as valid Python comments', () => {
    const cell = newPromptCell('Create a sales app', appCellCode('sales-1234'))
    const restored = fromIpynb(toIpynb({ cells: [cell] })).cells[0]
    expect(restored.kind).toBe('prompt')
    if (restored.kind === 'prompt') expect(appIdFromCode(restored.code)).toBe('sales-1234')
    expect(cell.code.trim().split('\n').every((line) => line.startsWith('#'))).toBe(true)
  })

  it('only bypasses execution for an exact reference, preserving manually added Python', () => {
    const reference = appCellCode('sales')
    expect(appIdFromCode(`${reference}print('still run this')`)).toBeNull()
    expect(appIdFromCode(appCellCode('../outside'))).toBeNull()
    expect(appIdFromCode("print('# dalliance-app: sales')")).toBeNull()
  })
})
