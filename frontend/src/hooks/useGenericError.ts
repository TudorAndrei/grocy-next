import { useEffect, useRef } from "react";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useNotify } from "@/components/Toaster";
import type { JsonValue } from "@/lib/json";

export type GenericException = Error | JsonValue | undefined;

function technicalDetails(error: GenericException): string {
  const value =
    error instanceof ApiError
      ? (error.responseText ?? error.body)
      : error instanceof Error
        ? error.message
        : error;

  const object = z.record(z.string(), z.json()).safeParse(value);

  if (object.success && Object.hasOwn(object.data, "error_message"))
    return String(object.data.error_message);

  return JSON.stringify(value, null, 4) ?? "undefined";
}

/** Match ShowGenericError while keeping technical content inert and page-owned. */
export function useGenericError() {
  const notify = useNotify();
  const { t } = useI18n();
  const active = useRef(true);

  useEffect(() => {
    active.current = true;

    return () => {
      active.current = false;
    };
  }, []);

  return (message: string, error?: GenericException) => {
    if (!active.current) return;
    notify({ message: t(message), tone: "error", details: technicalDetails(error) });
  };
}
