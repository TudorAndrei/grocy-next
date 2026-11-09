import { Text, View } from "nsh";
import { Button, Checkbox } from "nsh/base";
import { Icon } from "../ui";

/**
 * One item on the list. The whole row is the checkbox, so a thumb anywhere on
 * it ticks the item off; checked items are struck through like a pen mark.
 * `large` is the in-store layout: taller rows, a bigger box and the amount
 * always on the right, so the list reads at arm's length in an aisle.
 */
export function Item(p: {
  title: string;
  amount: string;
  note: string;
  done: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  large?: boolean;
  onEdit?: () => void;
  editDisabled?: boolean;
}) {
  const name = `${p.large ? "text-[17px]" : "text-[15px]"} font-medium ${p.done ? "text-muted-foreground line-through decoration-faint" : "text-foreground"}`;
  return (
    <View class="flex-row items-center gap-1 border-b border-border">
      <Checkbox
        accessibilityLabel={p.title}
        checked={p.done}
        disabled={p.disabled}
        onChange={(e) => p.onChange(e.checked)}
        class={`flex-1 min-w-0 flex-row items-center ${p.large ? "gap-4 min-h-24 py-3 md:px-3" : "gap-3.5 min-h-[60px] md:min-h-[52px] py-2 md:py-1.5 md:px-3"} rounded-md md:hover:bg-card focus:outline-2 focus:outline-ring disabled:opacity-40`}
        indicatorClass={`${p.large ? "w-7 h-7 rounded-lg" : "w-[22px] h-[22px] md:w-[18px] md:h-[18px] rounded-md md:rounded-[5px]"} items-center justify-center border-[1.5px] border-input bg-card checked:bg-secondary checked:border-input`}
        indicator={p.done ? <Icon name="check" size={p.large ? 17 : 14} tint="foreground" /> : null}
      >
        <View class="flex-1 min-w-0 gap-0.5">
          <Text style={{ numberOfLines: 2 }} class={name}>
            {p.title}
          </Text>
          {p.large ? (
            p.note ? (
              <Text style={{ numberOfLines: 1 }} class="text-[13px] text-muted-foreground">
                {p.note}
              </Text>
            ) : null
          ) : p.amount || p.note ? (
            <View class="md:hidden flex-row items-baseline gap-1.5 min-w-0">
              {p.amount ? (
                <Text class="text-[13px] tabular-nums text-muted-foreground">{p.amount}</Text>
              ) : null}
              {p.amount && p.note ? (
                <Text accessibilityElementsHidden class="text-[13px] text-faint">
                  ·
                </Text>
              ) : null}
              {p.note ? (
                <Text
                  style={{ numberOfLines: 1 }}
                  class="flex-1 min-w-0 text-[13px] text-muted-foreground"
                >
                  {p.note}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
        {p.large ? null : (
          <Text
            style={{ numberOfLines: 1 }}
            class="hidden md:flex w-64 text-[13px] text-muted-foreground"
          >
            {p.note}
          </Text>
        )}
        <Text
          class={`${p.large ? "text-[15px] font-medium" : "hidden md:flex w-32 text-sm"} text-right tabular-nums ${p.done ? "text-muted-foreground" : "text-foreground"}`}
        >
          {p.amount}
        </Text>
      </Checkbox>
      {p.onEdit ? (
        <Button
          accessibilityLabel={`Edit ${p.title}`}
          disabled={p.editDisabled}
          onPress={p.onEdit}
          class="w-11 h-11 md:w-9 md:h-9 -mr-2 md:mr-1 rounded-lg items-center justify-center hover:bg-accent focus:outline-2 focus:outline-offset-2 focus:outline-ring disabled:opacity-40"
        >
          <Icon name="pencil" size={15} />
        </Button>
      ) : null}
    </View>
  );
}

/** The in-store tally: one calm line and a thin ink bar beneath it. */
export function Progress(p: { done: number; total: number }) {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <View class="gap-2.5">
      <Text class="text-sm text-muted-foreground tabular-nums">
        {`${p.done} of ${p.total} collected. Tap a product to check it off.`}
      </Text>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        class="h-1 rounded-full bg-secondary overflow-hidden"
      >
        <View class="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
      </View>
    </View>
  );
}
