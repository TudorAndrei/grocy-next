import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { request } from "./api";

const permissions = z.record(z.string(), z.boolean());

export function usePermissions() {
  const query = useQuery({
    queryKey: ["user-permissions"],
    queryFn: async ({ signal }) =>
      permissions.parse(await request("/api/v2/user/permissions", { signal })),
  });

  return (name: string) => query.isSuccess && query.data[name] === true;
}
