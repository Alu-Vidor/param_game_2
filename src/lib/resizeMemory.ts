/** Keep cells outside the current dimensions until the editor closes. */
export function rememberVector<T>(
  visible: readonly T[],
  saved: readonly T[] = [],
): T[] {
  return [...visible, ...saved.slice(visible.length)];
}

export function rememberMatrix<T>(
  visible: readonly T[][],
  saved: readonly T[][] = [],
): T[][] {
  return [
    ...visible.map((row, i) => rememberVector(row, saved[i])),
    ...saved.slice(visible.length),
  ];
}
