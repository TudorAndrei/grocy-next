import { useI18n } from "@/lib/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNotify } from "@/components/Toaster";
import { api, queryKeys } from "./api";

/** Chore, task and battery tracking, each with an undo toast. */
export function useChoreActions() {
  const { t: tr } = useI18n();

  const notify = useNotify();
  const queryClient = useQueryClient();
  const refresh = (key: readonly unknown[]) => queryClient.invalidateQueries({ queryKey: key });
  const onError = (err: Error) => notify({ message: err.message, tone: "error" });

  const execute = useMutation({
    mutationFn: (choreId: number) => api.executeChore(choreId),
    onSuccess: async (execution) => {
      await refresh(queryKeys.chores);
      notify({
        message: tr("Chore tracked"),
        undo: async () => {
          await api.undoChoreExecution(execution.id);
          await refresh(queryKeys.chores);
        },
      });
    },
    onError,
  });

  const complete = useMutation({
    mutationFn: (taskId: number) => api.completeTask(taskId),
    onSuccess: async (_data, taskId) => {
      await refresh(queryKeys.tasks);
      notify({
        message: tr("Task completed"),
        undo: async () => {
          await api.undoTask(taskId);
          await refresh(queryKeys.tasks);
        },
      });
    },
    onError,
  });

  const charge = useMutation({
    mutationFn: (batteryId: number) => api.chargeBattery(batteryId),
    onSuccess: async (cycle) => {
      await refresh(queryKeys.batteries);
      notify({
        message: tr("Battery charge tracked"),
        undo: async () => {
          await api.undoBatteryCharge(cycle.id);
          await refresh(queryKeys.batteries);
        },
      });
    },
    onError,
  });

  return { execute, complete, charge };
}
