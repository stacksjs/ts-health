/** A batch can contain real readings and failed days; consumers retain both facts. */
export class PartialHealthReadError<T = unknown> extends Error {
  constructor(readonly readings: T[], readonly errors: unknown[]) {
    super(errors.map(error => error instanceof Error ? error.message : String(error)).join('; '))
    this.name = 'PartialHealthReadError'
  }
}
