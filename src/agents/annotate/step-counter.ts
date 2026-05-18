/**
 * StepCounter — compteur auto-incrémenté pour les annotations numérotées.
 *
 * Usage typique :
 *   const counter = new StepCounter()
 *   counter.nextStep() // 1
 *   counter.nextStep() // 2
 *   counter.reset()
 *   counter.nextStep() // 1
 */
export class StepCounter {
  private current = 0

  /**
   * Incrémente et retourne la nouvelle valeur (commence à 1).
   */
  nextStep(): number {
    this.current++
    return this.current
  }

  /**
   * Remet le compteur à 0 (le prochain `nextStep()` rendra 1).
   */
  reset(): void {
    this.current = 0
  }
}
