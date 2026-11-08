import { NativeDateTimeInput, type NativeDateInputProps } from "./NativeDateTimeInput";

export type { NativeDateTimeHandle as NativeMainDateHandle } from "@/lib/native-userfield-dates";

/** The main picker has independent source state alongside the custom/purchased-date collection. */
export function NativeMainDateInput(props: Omit<NativeDateInputProps, "family">) {
  return <NativeDateTimeInput {...props} datetime={props.datetime ?? true} family={1} />;
}
