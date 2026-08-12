export interface NextOmniboxHighlightArgs {
  count: number;
  /** The current row, or -1 for "the typed text". */
  current: number;
  step: 1 | -1;
}

/**
 * The next highlighted row for an arrow key.
 *
 * The typed text is a real position in the cycle, not the absence of one:
 * arrowing past the last row lands back on what the user typed, so the default
 * action is always reachable without deleting and retyping. -1 stands for it,
 * matching the `aria-activedescendant` convention of no active option.
 */
export function nextOmniboxHighlight(args: NextOmniboxHighlightArgs): number {
  if (args.count <= 0) {
    return -1;
  }
  // Rows plus the typed text.
  const positions = args.count + 1;
  const from = args.current < 0 ? 0 : args.current + 1;
  return ((from + args.step + positions) % positions) - 1;
}
