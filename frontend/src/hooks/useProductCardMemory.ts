import { useLayoutEffect, useState } from "react";
import { ProductCardMemory } from "@/lib/product-card-memory";

/** Dialog owners retain memory while hidden; inline cards own their own lifetime. */
export function useProductCardMemory({
  external,
  resetVersion = 0,
}: {
  external?: ProductCardMemory;
  resetVersion?: number;
} = {}) {
  const [owned, setOwned] = useState(() => ({
    version: resetVersion,
    memory: new ProductCardMemory(),
  }));

  if (owned.version !== resetVersion)
    setOwned({ version: resetVersion, memory: new ProductCardMemory() });

  const memory = external ?? owned.memory;

  useLayoutEffect(() => {
    if (external) return;
    memory.mount();

    return () => memory.dispose();
  }, [external, memory]);

  return memory;
}
