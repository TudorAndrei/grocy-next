import type { QueryClient } from "@tanstack/react-query";

export function nativeProductPictureFilename(file: File) {
  return (
    Math.random().toString(36).substring(2, 100) +
    Math.random().toString(36).substring(2, 100) +
    file.name
      .toLowerCase()
      .replaceAll("ä", "ae")
      .replaceAll("ö", "oe")
      .replaceAll("ü", "ue")
      .replaceAll("ß", "ss")
      .replace(/\s+/g, "")
      .replace(/[^\p{ASCII}]/gu, "")
  );
}

export function invalidateNativeProduct(client: QueryClient) {
  void client.invalidateQueries({
    predicate: (query) =>
      !["description-editor", "product-copy"].includes(String(query.queryKey[0])),
    refetchType: "none",
  });
}
