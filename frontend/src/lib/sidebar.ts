const masterDataPaths = new Set([
  "/products",
  "/locations",
  "/shoppinglocations",
  "/quantityunits",
  "/productgroups",
  "/chores",
  "/batteries",
  "/taskcategories",
  "/userfields",
  "/userentities",
]);

/** These collection views open Manage master data in the native document template. */
export function isMasterDataPath(pathname: string): boolean {
  return masterDataPaths.has(pathname);
}

export function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem("sidebar_state") === "collapsed";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem("sidebar_state", collapsed ? "collapsed" : "expanded");
  } catch {
    // The mounted shell keeps the choice usable when browser storage is unavailable.
  }
}
