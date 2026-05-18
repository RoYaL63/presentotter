import { describe, it, expect } from 'vitest'
import { StepCounter } from '../step-counter'

describe('StepCounter', () => {
  it('increments starting from 1', () => {
    const c = new StepCounter()
    expect(c.nextStep()).toBe(1)
    expect(c.nextStep()).toBe(2)
    expect(c.nextStep()).toBe(3)
  })

  it('reset() brings the counter back to 0 so the next step is 1 again', () => {
    const c = new StepCounter()
    c.nextStep()
    c.nextStep()
    c.reset()
    expect(c.nextStep()).toBe(1)
  })
})
