import { signal, Text, View } from "nsh";
import { Api, type Row } from "../api";
import { remote, operations, Feedback, LoadState } from "../data";
import {
  Action,
  DateField,
  Due,
  Field,
  Heading,
  Note,
  Panel,
  Toggle,
  addDays,
  dateISO,
  dueDays,
} from "../ui";
const group = (r: Row) =>
  Number(r.done)
    ? "Completed"
    : (dueDays(r.date) ?? 999) < 0
      ? "Overdue"
      : dueDays(r.date) === 0
        ? "Today"
        : (dueDays(r.date) ?? 999) <= 7
          ? "This week"
          : dueDays(r.date) == null
            ? "No date"
            : "Later";

export function Household(p: { api: Api }) {
  const completed = signal(false),
    adding = signal(false),
    name = signal(""),
    date = signal(""),
    undo = signal("");
  const state = remote(async (s) => {
    const [tasks, chores, batteries] = await Promise.all([
      p.api.request<Row>(
        `/api/v2/tasks/overview${completed() ? "?include_done=1" : ""}`,
        "GET",
        undefined,
        s,
      ),
      p.api.request<Row>("/api/v2/chores/overview", "GET", undefined, s),
      p.api.request<Row>("/api/v2/batteries/overview", "GET", undefined, s),
    ]);
    return [
      ...tasks.rows.map((r: Row) => ({
        ...r,
        kind: "tasks",
        label: "Task",
        date: r.due_date,
      })),
      ...chores.rows.map((r: Row) => ({
        ...r,
        id: r.chore_id,
        kind: "chores",
        label: "Chore",
        date: r.next_estimated_execution_time,
      })),
      ...batteries.rows.map((r: Row) => ({
        ...r,
        kind: "batteries",
        label: "Battery",
        date: Number(r.charge_interval_days) > 0 ? r.next_estimated_charge_time : null,
      })),
    ] as Row[];
  });
  const op = operations(state.refresh);

  const rows = (g: string) =>
    (state.data() ?? [])
      .filter((r) => group(r) === g)
      .toSorted(
        (a, b) =>
          (dueDays(a.date) ?? 999) - (dueDays(b.date) ?? 999) || a.name.localeCompare(b.name),
      );
  return (
    <View class="gap-4">
      <View class="flex-row justify-between items-center">
        <Heading title="Chores" />
        <Action
          label="Add task"
          primary
          onPress={() => {
            name.set("");
            date.set("");
            adding.set(true);
          }}
        />
      </View>
      <LoadState loading={state.loading()} error={state.error()} retry={state.refresh} />
      <Feedback error={op.error()} success={op.success()} />
      {undo() ? (
        <Action
          label="Undo last completion"
          quiet
          disabled={op.busy()}
          onPress={() =>
            void op.run(async () => {
              await p.api.post(undo());
              if (op.alive()) undo.set("");
            }, "Completion undone.")
          }
        />
      ) : null}
      <Each
        of={[
          "Overdue",
          "Today",
          "This week",
          "Later",
          "No date",
          ...(completed() ? ["Completed"] : []),
        ]}
      >
        {(g) => (
          <View>
            {rows(g()).length ? (
              <View class="gap-1">
                <Text class="text-sm font-semibold text-[#5e625f] mt-3">{g()}</Text>
                <Each of={rows(g())}>
                  {(r) => (
                    <View class="min-h-16 flex-row items-center justify-between gap-3 border-b border-[#e4e4e0] py-2">
                      <View class="flex-1 min-w-0 gap-1">
                        <Text class="text-base text-[#1b1d1c]">{r().name}</Text>
                        <View class="flex-row flex-wrap gap-2">
                          <Note>
                            {r().label}
                            {r().used_in ? ` · ${r().used_in}` : ""}
                          </Note>
                          <Due value={r().date} />
                        </View>
                      </View>
                      <Action
                        label={Number(r().done) ? "Reopen" : "Done"}
                        accessibilityLabel={`${Number(r().done) ? "Reopen" : "Complete"} ${r().name}`}
                        quiet
                        disabled={op.busy()}
                        onPress={() =>
                          void op.run(async () => {
                            const action =
                              r().kind === "tasks"
                                ? Number(r().done)
                                  ? "undo"
                                  : "complete"
                                : r().kind === "chores"
                                  ? "execute"
                                  : "charge";
                            const result = await p.api.post(`/api/${r().kind}/${r().id}/${action}`);
                            if (op.alive())
                              undo.set(
                                r().kind === "tasks"
                                  ? `/api/tasks/${r().id}/${action === "complete" ? "undo" : "complete"}`
                                  : result?.id
                                    ? `/api/${r().kind}/${r().kind === "batteries" ? "charge-cycles" : "executions"}/${result.id}/undo`
                                    : "",
                              );
                          }, "Recorded.")
                        }
                      />
                    </View>
                  )}
                </Each>
              </View>
            ) : null}
          </View>
        )}
      </Each>
      {!state.loading() && !state.error() && !state.data()?.length ? (
        <Note>No household work yet. Add a task to get started.</Note>
      ) : null}
      <Toggle
        label="Show completed tasks"
        checked={completed()}
        onChange={(v) => {
          completed.set(v);
          void state.refresh();
        }}
      />
      <Panel
        open={adding()}
        title="Add task"
        onClose={() => adding.set(false)}
        busy={op.busy()}
        footer={
          <View class="gap-2">
            <Feedback error={op.error()} success="" />
            <Action
              label="Save task"
              primary
              disabled={op.busy() || !name().trim()}
              onPress={() =>
                void op
                  .run(
                    () =>
                      p.api.save("tasks", {
                        name: name().trim(),
                        ...(date() ? { due_date: date() } : {}),
                      }),
                    "Task added.",
                  )
                  .then((ok) => {
                    if (ok) adding.set(false);
                  })
              }
            />
          </View>
        }
      >
        <Field label="Task name" value={name()} onChange={(v) => name.set(v)} autoFocus />
        <DateField label="Due date" optional value={date()} onChange={(v) => date.set(v)} />
        <View class="flex-row gap-2">
          <Action label="Today" quiet onPress={() => date.set(dateISO())} />
          <Action label="Tomorrow" quiet onPress={() => date.set(addDays(dateISO(), 1))} />
          <Action label="No date" quiet onPress={() => date.set("")} />
        </View>
      </Panel>
    </View>
  );
}
