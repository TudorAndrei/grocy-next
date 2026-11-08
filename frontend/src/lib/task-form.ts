import { z } from "zod";
import { request } from "./api";

const taskFormContext = z.object({
  users: z.array(
    z.object({ id: z.number(), username: z.string(), display_name: z.string().nullable() }),
  ),
  categories: z.array(z.object({ id: z.number(), name: z.string().nullable() })),
  current_user_id: z.number(),
});

export const taskFormContextQuery = {
  queryKey: ["task-form-context"],
  queryFn: async () => taskFormContext.parse(await request("/api/v2/tasks/form-context")),
};
