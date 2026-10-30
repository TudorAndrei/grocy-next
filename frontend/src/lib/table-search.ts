/** DataTables smart search: words in any order, with straight or curly quoted phrases. */
export function matchesTableSearch(value: string, search: string): boolean {
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const terms = (escaped.match(/["\u201C][^"\u201D]+["\u201D]|[^ ]+/g) ?? [""]).map((word) => {
    const phrase = /^(?:"(.*)"|\u201C(.*)\u201D)$/.exec(word);

    return (phrase ? (phrase[1] ?? phrase[2] ?? "") : word).replace('"', "");
  });

  return new RegExp(`^(?=.*?${terms.join(")(?=.*?")}).*$`, "i").test(
    value.replace(/[\r\n\u2028]/g, ""),
  );
}
