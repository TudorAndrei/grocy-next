export function compareSqliteNames(first: string, second: string) {
  // SQLite NOCASE folds ASCII letters only, then compares Unicode code points.
  const fold = (name: string) => name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

  return compareSqliteBinary(fold(first), fold(second));
}

export function compareSqliteBinary(first: string, second: string) {
  const a = [...first];
  const b = [...second];

  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index].codePointAt(0)! - b[index].codePointAt(0)!;

    if (difference) return difference;
  }

  return a.length - b.length;
}
