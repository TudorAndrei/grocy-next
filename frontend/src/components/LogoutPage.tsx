import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { signOut } from "@/lib/session";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

export function LogoutPage() {
  const { t } = useI18n();
  const client = useQueryClient();
  const navigate = useNavigate();
  const started = useRef(false);

  const { mutate, error, isPending } = useMutation({
    mutationFn: () => signOut(client),
    onSuccess: () => navigate({ to: "/signin", replace: true }),
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    mutate();
  }, [mutate]);

  return (
    <main id="main-content" className="setup-page">
      {error ? (
        <div>
          <ErrorBlock message={error.message} />
          <button type="button" className="btn" onClick={() => mutate()} disabled={isPending}>
            {t("Try again")}
          </button>
        </div>
      ) : (
        <LoadingBlock label={t("Signing out…")} />
      )}
    </main>
  );
}
