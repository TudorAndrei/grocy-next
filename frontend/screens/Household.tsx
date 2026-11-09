import { Image, signal, Text, token, View } from "nsh";
import { Button } from "nsh/base";
import { Api, type Row } from "../api";
import { remote, operations, Feedback, LoadState } from "../data";
import iconCheck from "../assets/icons/check.svg";
import {
  Action,
  DateField,
  Due,
  Empty,
  Field,
  Heading,
  Icon,
  type IconName,
  Panel,
  Subheading,
  Toggle,
  addDays,
  dateISO,
  dueDays,
} from "../ui";

const groups = ["Overdue", "Today", "This week", "Later", "No date"];
const kinds: Record<string, { label: string; icon: IconName }> = {
  tasks: { label: "Task", icon: "circle-check" },
  chores: { label: "Chore", icon: "calendar" },
  batteries: { label: "Battery", icon: "battery" },
};
const key = (r: Row) => `${r.kind}:${r.id}`;

/**
 * The leading completion mark: a quiet ring that previews its check on hover
 * and fills with a check the moment it is pressed (and while it is recorded).
 */
function Complete(p: {
  name: string;
  done: boolean;
  filled: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      accessibilityLabel={`${p.done ? "Reopen" : "Complete"} ${p.name}`}
      disabled={p.disabled}
      onPress={p.onPress}
      class="group w-11 h-11 md:w-9 md:h-9 -ml-[13px] -mr-[5px] md:-ml-[9px] shrink-0 rounded-lg items-center justify-center hover:bg-accent focus:outline-2 focus:outline-offset-2 focus:outline-ring disabled:opacity-60"
    >
      <View
        class={`w-[18px] h-[18px] rounded-full border items-center justify-center transition-colors ${p.filled ? "bg-foreground border-foreground" : "border-input group-hover:border-muted-foreground group-active:bg-foreground group-active:border-foreground"}`}
      >
        <View
          class={
            p.filled
              ? ""
              : "opacity-0 group-hover:opacity-100 group-active:opacity-0 transition-opacity"
          }
        >
          <Image
            src={iconCheck}
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={{
              width: 12,
              height: 12,
              tintColor: token(p.filled ? "background" : "muted-foreground"),
            }}
          />
        </View>
      </View>
    </Button>
  );
}

function Kind(p: { kind: string }) {
  return (
    <View class="flex-row items-center gap-1.5 shrink-0">
      <Icon name={kinds[p.kind].icon} size={15} />
      <Text class="text-[13px] text-muted-foreground">{kinds[p.kind].label}</Text>
    </View>
  );
}

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
    undo = signal(""),
    pending = signal("");
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
    const users: Row[] = chores.users ?? [];
    return [
      ...tasks.rows.map((r: Row) => ({
        ...r,
        kind: "tasks",
        date: r.due_date,
        place: r.assigned_name ?? "",
      })),
      ...chores.rows.map((r: Row) => ({
        ...r,
        id: r.chore_id,
        kind: "chores",
        date: r.next_estimated_execution_time,
        place: users.find((u) => u.id === r.next_execution_assigned_to_user_id)?.display_name ?? "",
      })),
      ...batteries.rows.map((r: Row) => ({
        ...r,
        kind: "batteries",
        date: Number(r.charge_interval_days) > 0 ? r.next_estimated_charge_time : null,
        place: r.used_in ?? "",
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
  const visible = () =>
    [...groups, ...(completed() ? ["Completed"] : [])].filter((g) => rows(g).length);
  const detail = () => {
    if (!state.data()) return "";
    const overdue = rows("Overdue").length,
      today = rows("Today").length;
    const parts = [overdue ? `${overdue} overdue` : "", today ? `${today} due today` : ""].filter(
      Boolean,
    );
    return parts.length ? parts.join(" · ") : "Nothing due today";
  };
  const complete = (r: Row) => {
    pending.set(key(r));
    void op
      .run(async () => {
        const action =
          r.kind === "tasks"
            ? Number(r.done)
              ? "undo"
              : "complete"
            : r.kind === "chores"
              ? "execute"
              : "charge";
        const result = await p.api.post(`/api/${r.kind}/${r.id}/${action}`);
        if (op.alive())
          undo.set(
            r.kind === "tasks"
              ? `/api/tasks/${r.id}/${action === "complete" ? "undo" : "complete"}`
              : result?.id
                ? `/api/${r.kind}/${r.kind === "batteries" ? "charge-cycles" : "executions"}/${result.id}/undo`
                : "",
          );
      }, "Recorded.")
      .finally(() => {
        if (op.alive()) pending.set("");
      });
  };
  return (
    <View class="gap-5">
      <View class="flex-row justify-between items-center gap-3 min-h-11">
        <Heading title="Chores" detail={detail()} />
        <Action
          label="Add task"
          icon="plus"
          primary
          onPress={() => {
            name.set("");
            date.set("");
            adding.set(true);
          }}
        />
      </View>
      <LoadState
        loading={state.loading() && !state.data()}
        error={state.error()}
        retry={state.refresh}
      />
      <Feedback error={op.error()} success={undo() ? "" : op.success()} />
      {undo() ? (
        <View class="flex-row items-center gap-2 rounded-lg bg-secondary pl-3 pr-1 py-1 min-h-11">
          <Icon name="check" size={15} tint="foreground" />
          <Text class="flex-1 min-w-0 text-sm text-foreground">{op.success() || "Recorded."}</Text>
          <Action
            label="Undo last completion"
            icon="undo"
            quiet
            disabled={op.busy()}
            onPress={() =>
              void op.run(async () => {
                await p.api.post(undo());
                if (op.alive()) undo.set("");
              }, "Completion undone.")
            }
          />
        </View>
      ) : null}
      {state.data()?.length ? (
        <View>
          <View class="hidden md:flex flex-row items-center gap-4 h-9 border-b border-border">
            <View class="w-9 -ml-[9px] -mr-[5px] shrink-0" />
            <Text class="flex-1 min-w-0 text-[13px] font-medium text-muted-foreground">Name</Text>
            <Text class="w-28 text-[13px] font-medium text-muted-foreground">Type</Text>
            <Text class="w-40 text-[13px] font-medium text-muted-foreground">Due</Text>
            <Text class="w-44 text-[13px] font-medium text-muted-foreground">
              Assignee or place
            </Text>
          </View>
          <Each of={visible()}>
            {(g) => (
              <View class="pt-6 md:pt-7">
                <View class="pb-2">
                  <Subheading title={g()} detail={String(rows(g()).length)} />
                </View>
                <View class="border-t border-border">
                  <Each of={rows(g())}>
                    {(r) => (
                      <View class="min-h-[60px] md:min-h-[52px] flex-row items-center gap-3 md:gap-4 border-b border-border py-2 md:py-1">
                        <Complete
                          name={r().name}
                          done={!!Number(r().done)}
                          filled={!!Number(r().done) || pending() === key(r())}
                          disabled={op.busy()}
                          onPress={() => complete(r())}
                        />
                        <View class="flex-1 min-w-0 gap-1 md:gap-0">
                          <Text
                            class={`text-[15px] font-medium ${Number(r().done) ? "text-muted-foreground line-through" : "text-foreground"}`}
                          >
                            {r().name}
                          </Text>
                          <View class="md:hidden flex-row flex-wrap items-center gap-x-2 gap-y-0.5">
                            <Kind kind={r().kind} />
                            {r().date && !Number(r().done) ? <Due value={r().date} /> : null}
                            {r().place ? (
                              <Text class="text-[13px] text-muted-foreground">{r().place}</Text>
                            ) : null}
                          </View>
                        </View>
                        <View class="hidden md:flex w-28">
                          <Kind kind={r().kind} />
                        </View>
                        <View class="hidden md:flex w-40">
                          {Number(r().done) ? (
                            <Text class="text-[13px] text-muted-foreground">Completed</Text>
                          ) : r().date ? (
                            <Due value={r().date} />
                          ) : (
                            <Text class="text-[13px] text-muted-foreground">No date</Text>
                          )}
                        </View>
                        <View class="hidden md:flex w-44">
                          <Text class="text-[13px] text-muted-foreground truncate">
                            {r().place}
                          </Text>
                        </View>
                      </View>
                    )}
                  </Each>
                </View>
              </View>
            )}
          </Each>
        </View>
      ) : null}
      {!state.loading() && !state.error() && !state.data()?.length ? (
        <Empty
          title="No household work yet"
          detail="Tasks, chores and batteries appear here in due order. Add a task to get started."
        />
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
        <View class="gap-2">
          <DateField label="Due date" optional value={date()} onChange={(v) => date.set(v)} />
          <View class="flex-row flex-wrap gap-1.5">
            <Action label="Today" onPress={() => date.set(dateISO())} />
            <Action label="Tomorrow" onPress={() => date.set(addDays(dateISO(), 1))} />
            <Action label="No date" onPress={() => date.set("")} />
          </View>
        </View>
      </Panel>
    </View>
  );
}
