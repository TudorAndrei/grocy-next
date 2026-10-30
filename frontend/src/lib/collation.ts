export function compareSqliteNames(first: string, second: string) {
  // SQLite NOCASE folds ASCII letters only, then compares Unicode code points.
  const fold = (name: string) => [...name.replace(/[A-Z]/g, (letter) => letter.toLowerCase())];
  const a = fold(first);
  const b = fold(second);

  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index].codePointAt(0)! - b[index].codePointAt(0)!;

    if (difference) return difference;
  }

  return a.length - b.length;
}
