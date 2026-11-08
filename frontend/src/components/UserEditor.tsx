import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request, filePath } from "@/lib/api";
import {
  getUserForm,
  userPictureFilename,
  writeUser,
  invalidateUsers,
  type UserFormContext,
} from "@/lib/user-form";
import type { JsonObject } from "@/lib/json";
import { nativeQueryParameter } from "@/lib/native-query-flag";
import { initialUserfields } from "@/lib/userfields";
import { saveNativeObjectFields } from "@/lib/native-object-fields";
import { useDocumentTasks } from "@/lib/document-tasks";
import { useI18n } from "@/lib/i18n";
import { PageHeader } from "./PageHeader";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";
import { UserfieldsEditor, type UserfieldsEditorHandle } from "./UserfieldsEditor";
import { NativeUserfieldsLoad } from "./NativeUserfieldsLoad";
import { EntityPicture } from "./EntityPicture";

export function UserEditor({
  recordId,
  search,
  onSaved,
}: {
  recordId: string | null;
  search: string;
  onSaved: (signal: AbortSignal) => Promise<void>;
}) {
  const { t } = useI18n();

  const context = useQuery({
    queryKey: ["user-editor", recordId],
    queryFn: ({ signal }) => getUserForm(recordId, signal),
    gcTime: 0,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const [initial, setInitial] = useState<UserFormContext>();

  if (!initial && context.isSuccess && !context.isFetching) setInitial(context.data);
  const title = recordId === null ? "Create user" : "Edit user";
  const missing = recordId !== null && initial?.user === null;

  return (
    <>
      <PageHeader title={t(title)} />
      {missing ? <ErrorBlock message={t("Object not found")} /> : null}
      {context.error ? (
        <>
          <ErrorBlock message={context.error.message} />
          <button type="button" className="btn" onClick={() => void context.refetch()}>
            {t("Retry")}
          </button>
        </>
      ) : null}
      {!initial && !context.error ? <LoadingBlock /> : null}
      {!missing && initial ? (
        <UserFields
          recordId={recordId}
          data={initial}
          search={search}
          title={title}
          onSaved={onSaved}
        />
      ) : null}
    </>
  );
}

function UserFields({
  recordId,
  data,
  search,
  title,
  onSaved,
}: {
  recordId: string | null;
  data: UserFormContext;
  search: string;
  title: string;
  onSaved: (signal: AbortSignal) => Promise<void>;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const targetId = data.user?.id ?? null;
  const nativeDocument = useDocumentTasks();
  const [initialSearch] = useState(search);
  const [username, setUsername] = useState(data.user?.username ?? "");
  const [firstName, setFirstName] = useState(data.user?.first_name ?? "");
  const [lastName, setLastName] = useState(data.user?.last_name ?? "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const [changePassword, setChangePassword] = useState(
    recordId !== null &&
      data.password_controls &&
      nativeQueryParameter(initialSearch, "changepw") === "true",
  );

  const [edits, setEdits] = useState(() => initialUserfields(data.fields, {}, false));

  const currentEdits = useRef(edits);
  const userfields = useRef<UserfieldsEditorHandle>(null);
  const primaryFields = useRef<HTMLFieldSetElement>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [passwordsRestored, setPasswordsRestored] = useState(false);
  const [pictureName, setPictureName] = useState<string>();
  const [pictureChanged, setPictureChanged] = useState(false);
  const [showDeleteHint, setShowDeleteHint] = useState(false);
  const [deletedLabel, setDeletedLabel] = useState(false);
  const deleting = useRef(false);
  const picture = useRef<HTMLInputElement>(null);
  const usernameInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const confirmInput = useRef<HTMLInputElement>(null);
  const scope = useRef<AbortController>(undefined);
  const focus = useRef<number>(undefined);

  const stored =
    data.user?.picture_file_name && data.user.picture_file_name !== "0"
      ? data.user.picture_file_name
      : undefined;

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    focus.current = window.setTimeout(() => {
      if (nativeQueryParameter(initialSearch, "changepw") === "true") {
        if (recordId !== null && data.password_controls) passwordInput.current?.focus();
      } else usernameInput.current?.focus();
    }, 500);

    return () => {
      controller.abort();
      window.clearTimeout(focus.current);
      document.body.classList.remove("cursor-busy");
    };
  }, [initialSearch, recordId, data.password_controls]);
  useEffect(() => {
    document.body.classList.toggle("cursor-busy", busy);

    return () => document.body.classList.remove("cursor-busy");
  }, [busy]);

  const endBusy = () => {
    saving.current = false;
    setBusy(false);
    setPasswordsRestored(true);
    document.body.classList.remove("cursor-busy");
  };

  const save = async () => {
    const owner = scope.current;

    if (!owner || saving.current) return;
    const task = nativeDocument.capture();
    const signal = AbortSignal.any([task.signal, owner.signal]);
    signal.throwIfAborted();
    const body: JsonObject = {};

    // serializeJSON reads actual successful main controls before BeginUiBusy.
    for (const control of primaryFields.current?.querySelectorAll<HTMLInputElement>(
      "input[name]",
    ) ?? []) {
      if (control.matches(":disabled")) continue;
      body[control.name] =
        control.type === "checkbox" ? (control.checked ? "1" : "0") : control.value;
    }

    const file = picture.current?.files?.[0];

    const pictureFilename = file ? userPictureFilename(file) : undefined;

    if (pictureFilename !== undefined) body.picture_file_name = pictureFilename;

    saving.current = true;
    setBusy(true);
    document.body.classList.add("cursor-busy");

    if (recordId !== null && deleting.current) {
      body.picture_file_name = null;
      void request(filePath("userpictures", stored || "undefined"), {
        method: "DELETE",
        signal,
      })
        .catch((error) => {
          if (!signal.aborted) {
            endBusy();
            task.genericError("Error while saving, probably this item already exists", error);
          }
        })
        .finally(() => invalidateUsers(client));
    }

    try {
      await writeUser(
        client,
        recordId === null ? "/api/users" : `/api/users/${targetId}`,
        recordId === null ? "POST" : "PUT",
        body,
        signal,
      );
    } catch (error) {
      if (!signal.aborted) {
        endBusy();
        console.error(error);
      }

      return;
    }

    if (signal.aborted) return;

    // POST /users responds 204. Native SaveUserPicture's local ID is never assigned to EditObjectId.
    try {
      await saveNativeObjectFields({
        namespace: "users",
        id: targetId ?? undefined,
        fields: data.fields,
        readEdits: () => userfields.current?.snapshot() ?? currentEdits.current,
        fileError: (error) =>
          task.genericError("Error while saving, probably this item already exists", error),
        signal,
        settled: () => invalidateUsers(client),
      });
    } catch {
      // Common field failures do not run native EndUiBusy.
      return;
    }

    if (signal.aborted) return;

    if (pictureFilename !== undefined && !deleting.current) {
      try {
        await request(filePath("userpictures", pictureFilename), {
          method: "PUT",
          body: picture.current?.files?.[0],
          signal,
        });
      } catch (error) {
        if (!signal.aborted) {
          endBusy();
          task.genericError(
            "Error while saving, probably this item already exists",
            error instanceof Error ? error : undefined,
          );
        }

        return;
      } finally {
        invalidateUsers(client);
      }
    }

    if (!signal.aborted) await onSaved(signal);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      !busy &&
      !document.querySelector(".combobox-menu-visible") &&
      event.currentTarget.reportValidity()
    )
      void save();
  };

  const passwordsEnabled =
    data.password_controls && (recordId === null || changePassword || passwordsRestored);

  return (
    <div className="recipe-form-layout">
      <form
        className="move-form household-editor"
        aria-label={t(title)}
        onSubmit={submit}
        onKeyUp={(event) => {
          if (event.target instanceof HTMLInputElement)
            confirmInput.current?.setCustomValidity(
              passwordInput.current?.value === confirmInput.current.value ? "" : "error",
            );
        }}
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            event.key !== "Enter" ||
            !(event.target instanceof HTMLInputElement)
          )
            return;
          event.preventDefault();

          if (event.currentTarget.checkValidity()) event.currentTarget.requestSubmit();
        }}
      >
        <fieldset ref={primaryFields} disabled={busy}>
          <label className="field">
            {t("Username")}
            <input
              ref={usernameInput}
              name="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="field">
            {t("First name")}
            <input
              name="first_name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
          </label>
          <label className="field">
            {t("Last name")}
            <input
              name="last_name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
            />
          </label>
          {data.password_controls ? (
            <>
              {recordId !== null ? (
                <label className="check-field">
                  <input
                    type="checkbox"
                    name="change_password"
                    checked={changePassword}
                    onChange={(event) => {
                      setPasswordsRestored(false);
                      setChangePassword(event.target.checked);
                      window.clearTimeout(focus.current);
                      focus.current = window.setTimeout(() => passwordInput.current?.focus(), 500);
                    }}
                  />
                  {t("Change password")}
                </label>
              ) : null}
              <label className="field">
                {t("Password")}
                <input
                  ref={passwordInput}
                  name="password"
                  type="password"
                  required
                  disabled={!passwordsEnabled}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label className="field">
                {t("Confirm password")}
                <input
                  ref={confirmInput}
                  name="password_confirm"
                  type="password"
                  required
                  disabled={!passwordsEnabled}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
            </>
          ) : data.hidden_password ? (
            <>
              <input type="hidden" name="password" value="x" />
              <input type="hidden" name="password_confirm" value="x" />
            </>
          ) : null}
        </fieldset>
        <UserfieldsEditor
          ref={userfields}
          nativeFiles
          nativeDirty
          nativeLoadPending
          fields={data.fields}
          values={edits}
          creating={recordId === null}
          disabled={busy}
          onChange={(key, edit) => {
            currentEdits.current = { ...currentEdits.current, [key]: edit };
            setEdits(currentEdits.current);
          }}
        />
        <NativeUserfieldsLoad
          namespace="users"
          objectId={recordId === null ? null : targetId}
          fieldCount={data.fields.length}
          editor={userfields}
        />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {t("Save")}
        </button>
      </form>
      <aside>
        <section aria-label={t("Picture")}>
          <h2>{t("Picture")}</h2>
          <label className="field">
            {t("User picture")}
            <input
              ref={picture}
              type="file"
              accept="image/*"
              onChange={(event) => {
                setPictureChanged(true);
                setDeletedLabel(false);
                setPictureName(event.target.files?.[0]?.name);
                setShowDeleteHint(false);
                // Native changes DeleteUserePictureOnSave (a typo), preserving the real removal flag.
              }}
            />
          </label>
          <span>
            {deletedLabel
              ? t("No file selected")
              : (pictureName ?? stored ?? t("No file selected"))}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              deleting.current = true;
              setPictureChanged(true);
              setDeletedLabel(true);
              setShowDeleteHint(true);
            }}
          >
            {t("Delete picture")}
          </button>
          {stored && !pictureChanged ? (
            <EntityPicture
              group="userpictures"
              source={stored}
              label={t("User picture")}
              width={400}
            />
          ) : null}
          {stored && showDeleteHint ? (
            <p>{t("The current picture will be deleted on save")}</p>
          ) : null}
          {!stored ? <p>{t("No picture available")}</p> : null}
        </section>
      </aside>
    </div>
  );
}
