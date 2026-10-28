/**
 * Cross-lane stubs (M8 plan, "Dependency edges"): until its owner lands, a stub
 * function throws `NotBuiltYet`, and its caller shows "Not available yet" (our
 * string). The plan gives this file to Task 3; Task 25 added it first because
 * its own stubs (`editor/turnInto.ts`, `editor/media/recordAudio.ts`) need it.
 */
export class NotBuiltYet extends Error {
  constructor(what?: string) {
    super(what ? `${what} is not built yet` : 'Not built yet')
    this.name = 'NotBuiltYet'
  }
}

/** Our string. */
export const NOT_AVAILABLE = 'Not available yet'
