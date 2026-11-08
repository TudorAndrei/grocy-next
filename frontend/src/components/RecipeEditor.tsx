import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { request, filePath } from "@/lib/api";
import { getRecipeFormContext, type RecipeFormContext } from "@/lib/recipe-form-context";
import {
  initialRecipeProduct,
  invalidateRecipeForms,
  recipePictureFilename,
  type RecipeSaveLocation,
} from "@/lib/recipe-form";
import { initialUserfields, type FieldEdit } from "@/lib/userfields";
import { saveNativeObjectFields } from "@/lib/native-object-fields";
import { useDocumentTasks } from "@/lib/document-tasks";
import { usePreferences } from "@/lib/preferences";
import { fetchApiDocument } from "@/lib/open-document";
import { userSettingsQuery } from "@/hooks/queries";
import { useNativeLabelPrint } from "@/hooks/useNativeLabelPrint";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import type { JsonObject } from "@/lib/json";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { NumberPicker } from "./NumberPicker";
import { ProductPicker } from "./ProductPicker";
import { UserfieldsEditor, type UserfieldsEditorHandle } from "./UserfieldsEditor";
import { NativeUserfieldsLoad } from "./NativeUserfieldsLoad";
import { DescriptionEditor } from "./DescriptionEditor";
import { EntityPicture } from "./EntityPicture";
import { RecipeIngredients } from "./RecipeIngredients";
import { RecipeNestings } from "./RecipeNestings";

export function RecipeEditor({
  recordId,
  search,
  onSaved,
}: {
  recordId: number | null;
  search: string;
  onSaved: (id: number, location: RecipeSaveLocation) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const settings = useQuery({ ...userSettingsQuery(), refetchOnMount: "always" });
  const valid = recordId === null || (Number.isInteger(recordId) && recordId > 0);

  const context = useQuery({
    queryKey: ["recipe-form", recordId],
    queryFn: ({ signal }) => getRecipeFormContext(recordId, signal),
    enabled: valid,
    retry: false,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const [initial, setInitial] = useState<RecipeFormContext>();

  if (
    !initial &&
    context.isSuccess &&
    !context.isFetching &&
    settings.isSuccess &&
    !settings.isFetching
  )
    setInitial(context.data);
  const error = context.error || settings.error;

  return (
    <>
      <PageHeader title={t(recordId === null ? "Create recipe" : "Edit recipe")} />
      {!valid ? <ErrorBlock message={t("Object not found")} /> : null}
      {error ? (
        <>
          <ErrorBlock message={error.message} />
          <button
            className="btn"
            type="button"
            onClick={() => {
              if (valid) void context.refetch();
              void settings.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {valid && !initial && !error ? <LoadingBlock /> : null}
      {valid && initial ? (
        <RecipeFields data={initial} recordId={recordId} search={search} onSaved={onSaved} />
      ) : null}
    </>
  );
}

function RecipeFields({
  data,
  recordId,
  search,
  onSaved,
}: {
  data: RecipeFormContext;
  recordId: number | null;
  search: string;
  onSaved: (id: number, location: RecipeSaveLocation) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const preferences = usePreferences();
  const client = useQueryClient();
  const nativeDocument = useDocumentTasks();
  const id = useId();
  const [name, setName] = useState(data.recipe?.name ?? "");

  const [servings, setServings] = useState(() =>
    Number(data.recipe?.base_servings ?? 1).toLocaleString("en", {
      maximumFractionDigits: preferences.amountPrecision,
      useGrouping: false,
    }),
  );

  const [shopping, setShopping] = useState(data.recipe?.not_check_shoppinglist === 1);
  const [product, setProduct] = useState(() => initialRecipeProduct(data, search));
  const [description, setDescription] = useState(data.recipe?.description ?? "");
  const [descriptionReady, setDescriptionReady] = useState(false);

  const [edits, setEdits] = useState(() => initialUserfields(data.fields, {}, false));

  const currentEdits = useRef(edits);
  const [busy, setBusy] = useState(false);
  const [pictureChanged, setPictureChanged] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [pictureName, setPictureName] = useState<string>();
  const picture = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const primaryFields = useRef<HTMLFieldSetElement>(null);
  const userfields = useRef<UserfieldsEditorHandle>(null);
  const deletePicture = useRef(false);
  const savedId = useRef(recordId);
  const scope = useRef<AbortController>(undefined);

  const storedPicture =
    data.recipe?.picture_file_name && data.recipe.picture_file_name !== "0"
      ? data.recipe.picture_file_name
      : undefined;

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    const timer = window.setTimeout(() => nameInput.current?.focus(), 500);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.body.classList.remove("cursor-busy");
    };
  }, []);
  useEffect(() => {
    document.body.classList.toggle("cursor-busy", busy);

    return () => document.body.classList.remove("cursor-busy");
  }, [busy]);

  const serialize = useCallback((): JsonObject => {
    if (busy) return {};

    const body: JsonObject = {
      name,
      base_servings: servings,
      not_check_shoppinglist: shopping ? "1" : "0",
      product_id: product,
      description,
    };

    for (const control of primaryFields.current?.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("input[name], textarea[name], select[name]") ?? []) {
      if (control.matches(":disabled")) continue;
      body[control.name] =
        control instanceof HTMLTextAreaElement
          ? control.value.replace(/\r?\n/g, "\r\n")
          : control instanceof HTMLInputElement && control.type === "checkbox"
            ? control.checked
              ? "1"
              : "0"
            : control.value;
    }

    return body;
  }, [busy, name, servings, shopping, product, description]);

  const partial = useCallback(async () => {
    const owner = scope.current;

    if (recordId === null || !owner || owner.signal.aborted) return false;
    const task = nativeDocument.capture();
    const signal = AbortSignal.any([task.signal, owner.signal]);

    try {
      await request(`/api/objects/recipes/${recordId}`, {
        method: "PUT",
        body: JSON.stringify(serialize()),
        signal,
      });
      signal?.throwIfAborted();

      return true;
    } catch (error) {
      if (!signal?.aborted) console.error(error);

      return false;
    } finally {
      void invalidateRecipeForms(client);
    }
  }, [recordId, serialize, client, nativeDocument]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        !z.object({ Message: z.literal("IngredientsChanged") }).safeParse(event.data).success ||
        recordId === null
      )
        return;
      void partial().then(async (success) => {
        if (success && !scope.current?.signal.aborted) await onSaved(recordId, "continue");
      });
    };

    window.addEventListener("message", receive);

    return () => window.removeEventListener("message", receive);
  }, [partial, recordId, onSaved]);

  const changeField = (key: string, edit: FieldEdit) => {
    currentEdits.current = { ...currentEdits.current, [key]: edit };
    setEdits(currentEdits.current);
  };

  const save = useMutation({
    mutationFn: async (input: { body: JsonObject; location: RecipeSaveLocation }) => {
      const owner = scope.current;

      if (!owner) throw new Error("Recipe form scope is not active");
      const task = nativeDocument.capture();
      const signal = AbortSignal.any([task.signal, owner.signal]);
      signal.throwIfAborted();

      const settled = () => {
        void invalidateRecipeForms(client);
      };

      if (recordId !== null && deletePicture.current) {
        input.body.picture_file_name = null;
        void request(filePath("recipepictures", storedPicture ?? "undefined"), {
          method: "DELETE",
          signal,
        })
          .catch((error) => {
            if (!signal.aborted) {
              setBusy(false);
              task.genericError(
                "Error while saving, probably this item already exists",
                error instanceof Error ? error : undefined,
              );
            }
          })
          .finally(settled);
      }

      let response;

      try {
        response = await request(
          recordId === null ? "/api/objects/recipes" : `/api/objects/recipes/${recordId}`,
          { method: recordId === null ? "POST" : "PUT", body: JSON.stringify(input.body), signal },
        );
        signal.throwIfAborted();
      } catch (error) {
        if (!signal.aborted && recordId !== null) {
          setBusy(false);
          console.error(error);
        }

        throw error;
      } finally {
        settled();
      }

      // Source create retries retain the first successful identity, while issuing fresh POSTs.
      if (!savedId.current)
        savedId.current = z
          .object({ created_object_id: z.coerce.number().int() })
          .parse(response).created_object_id;

      await saveNativeObjectFields({
        namespace: "recipes",
        id: savedId.current,
        fields: data.fields,
        readEdits: () => userfields.current?.snapshot() ?? currentEdits.current,
        fileError: (error) =>
          task.genericError("Error while saving, probably this item already exists", error),
        signal,
        settled,
      });
      signal.throwIfAborted();

      if (Object.hasOwn(input.body, "picture_file_name") && !deletePicture.current) {
        try {
          await request(filePath("recipepictures", String(input.body.picture_file_name)), {
            method: "PUT",
            body: picture.current?.files?.[0],
            signal,
          });
          signal.throwIfAborted();
        } catch (error) {
          if (!signal.aborted) {
            setBusy(false);
            task.genericError(
              "Error while saving, probably this item already exists",
              error instanceof Error ? error : undefined,
            );
          }

          throw error;
        } finally {
          settled();
        }
      }

      return { id: savedId.current, location: input.location, signal };
    },
    onMutate: () => setBusy(true),
    onSuccess: async (receipt) => {
      if (!receipt.signal.aborted) await onSaved(receipt.id, receipt.location);
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (busy || !descriptionReady || !event.currentTarget.reportValidity()) return;
    const button = event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null;
    const body = serialize();
    const file = picture.current?.files?.[0];

    if (file) body.picture_file_name = recipePictureFilename(file);
    save.mutate({
      body,
      location:
        button instanceof HTMLButtonElement && button.value === "return" ? "return" : "continue",
    });
  };

  const reload = () => {
    if (recordId !== null && !scope.current?.signal.aborted) void onSaved(recordId, "continue");
  };

  return (
    <div className="form-grid recipe-editor">
      <form
        className="move-form household-editor"
        aria-label={t(recordId === null ? "Create recipe" : "Edit recipe")}
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLInputElement)
            event.preventDefault();
        }}
      >
        <fieldset ref={primaryFields} disabled={busy}>
          <label className="field">
            {t("Name")}
            <input
              ref={nameInput}
              name="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field" htmlFor={`${id}-servings`}>
            {t("Servings")}
          </label>
          <NumberPicker
            id={`${id}-servings`}
            name="base_servings"
            label="Servings"
            value={servings}
            required
            min={10 ** -preferences.amountPrecision}
            step={String(10 ** -preferences.amountPrecision)}
            onChange={setServings}
          />
          <p className="field-hint">
            {t("The ingredients listed here result in this amount of servings")}
          </p>
          <label className="check-field">
            <input
              type="checkbox"
              name="not_check_shoppinglist"
              checked={shopping}
              onChange={(event) => setShopping(event.target.checked)}
            />
            {t("Do not check against the shopping list when adding missing items to it")}
          </label>
          <ProductPicker
            label="Produces product"
            products={data.products.map((product) => ({
              id: product.id,
              name: product.name ?? "",
            }))}
            barcodes={[]}
            plugin=""
            value={product}
            required={false}
            disabled={busy}
            lookupDisabled={false}
            autoFocus={false}
            allowCreate={false}
            disallowAllProductWorkflows
            onChange={setProduct}
            onResolved={() => {}}
            onAssignBarcode={() => {}}
            onBusyChange={() => {}}
            onFormBusyChange={() => {}}
          />
          <input type="hidden" name="product_id" value={product} />
          <textarea hidden readOnly name="description" value={description} />
          <p className="field-hint">
            {t(
              "When a product is selected, one unit (per serving in stock quantity unit) will be added to stock on consuming this recipe",
            )}
          </p>
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
          onChange={changeField}
        />
        <NativeUserfieldsLoad
          namespace="recipes"
          objectId={recordId}
          fieldCount={data.fields.length}
          editor={userfields}
        />
        <DescriptionEditor
          entity="recipes"
          label="Preparation"
          value={description}
          onChange={setDescription}
          onReady={setDescriptionReady}
        />
        {recordId === null ? (
          <p className="field-hint">
            {t("Save & continue to add ingredients and included recipes")}
          </p>
        ) : null}
        <div className="actions">
          <button
            className="btn btn-primary"
            type="submit"
            value="continue"
            disabled={busy || !descriptionReady}
          >
            {t("Save & continue")}
          </button>
          <button className="btn" type="submit" value="return" disabled={busy || !descriptionReady}>
            {t("Save & return to recipes")}
          </button>
        </div>
      </form>
      <aside hidden={recordId === null}>
        {recordId !== null ? (
          <>
            <RecipeIngredients
              recipeId={recordId}
              data={data}
              getSignal={() => scope.current?.signal}
              onReload={reload}
            />
            <RecipeNestings
              recipeId={recordId}
              data={data}
              prepare={partial}
              getSignal={() => scope.current?.signal}
              onReload={reload}
            />
          </>
        ) : null}
        <section aria-label={t("Picture")}>
          <h2>{t("Picture")}</h2>
          <label className="field" htmlFor={`${id}-picture`}>
            {t("Picture")}
            <input
              ref={picture}
              id={`${id}-picture`}
              type="file"
              accept="image/*"
              onChange={(event) => {
                deletePicture.current = false;
                setDeleted(false);
                setPictureChanged(true);
                setPictureName(event.target.files?.[0]?.name);
              }}
            />
          </label>
          <span>
            {deleted
              ? t("No file selected")
              : (pictureName ?? storedPicture ?? t("No file selected"))}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              deletePicture.current = true;
              setDeleted(true);
              setPictureChanged(true);
            }}
          >
            {t("Delete picture")}
          </button>
          {storedPicture && !pictureChanged ? (
            <EntityPicture
              group="recipepictures"
              source={storedPicture}
              label={t("Recipe picture")}
              width={400}
            />
          ) : null}
          {deleted && storedPicture ? (
            <p>{t("The current picture will be deleted on save")}</p>
          ) : null}
          {!storedPicture ? <p>{t("No picture available")}</p> : null}
        </section>
        {recordId !== null ? <RecipeCode id={recordId} /> : null}
      </aside>
    </div>
  );
}

function RecipeCode({ id }: { id: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const features = useFeatures();
  const print = useNativeLabelPrint();
  const root = router.buildLocation({ to: "/", search: {} }).publicHref.replace(/\/+$/, "");
  const [preview, setPreview] = useState<{ url?: string; error?: string }>();

  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    void fetchApiDocument(`/recipe/${id}/grocycode?size=60`, controller.signal)
      .then((image) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(image);
        setPreview({ url });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setPreview({ error: error.message });
      });

    return () => {
      controller.abort();

      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  return (
    <section aria-label={t("Grocycode")}>
      <h2>{t("Grocycode")}</h2>
      {preview?.url ? (
        <img src={preview.url} alt={t("Recipe Grocycode")} />
      ) : !preview?.error ? (
        <LoadingBlock />
      ) : null}
      {preview?.error ? <ErrorBlock message={preview.error} /> : null}
      <div className="actions">
        <a className="btn btn-ghost btn-sm" href={`${root}/recipe/${id}/grocycode?download=true`}>
          {t("Download")}
        </a>
        {features.enabled("LABEL_PRINTER") ? (
          <a
            className="btn btn-ghost btn-sm recipe-grocycode-label-print"
            data-recipe-id={id}
            href="#"
            onClick={(event) => {
              event.preventDefault();
              print(`/api/recipes/${id}/printlabel`);
            }}
          >
            {t("Print on label printer")}
          </a>
        ) : null}
      </div>
    </section>
  );
}
