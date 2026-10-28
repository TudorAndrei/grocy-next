import { useI18n } from "@/lib/i18n";
import {
  useEffect,
  useCallback,
  useMemo,
  useId,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
  type ComponentType,
} from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JsonObject } from "@/lib/json";
import { api, filePath, request, queryKeys } from "@/lib/api";
import {
  entities,
  getEntitySpec,
  type EntityField,
  type EntityRow,
  type EntitySpec,
} from "@/lib/entities";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { DescriptionEditor } from "./DescriptionEditor";
import { NumberPicker } from "./NumberPicker";
import { RichText } from "./RichDescription";
import { useFeatures } from "@/lib/features";
import { userSettingsQuery } from "@/hooks/queries";
import { preferenceEnabled, usePreferences } from "@/lib/preferences";
import { unitLabel } from "@/lib/format";
import { compareSqliteNames } from "@/lib/collation";
import { CameraScanner } from "./CameraScanner";
import { UserfieldsEditor } from "./UserfieldsEditor";
import {
  initialUserfields,
  saveUserfields,
  userfieldsQuery,
  type FieldEdits,
  type UserfieldDefinition,
} from "@/lib/userfields";
import {
  EntityPictureDetails,
  EntityPictureField,
  type PictureSelection,
  type PictureUpload,
} from "./EntityPicture";

type Props = {
  entity: string;
  detail?: (row: EntityRow) => ReactNode;
  actions?: (row: EntityRow) => ReactNode;
  fixed?: JsonObject;
  title?: string;
  onPendingChange?: (pending: boolean) => void;
  related?: ComponentType<{
    row: EntityRow;
    pending: boolean;
    reload: () => Promise<void>;
    afterDelete: () => Promise<void>;
  }>;
  editor?: {
    recordId: number | null;
    copyOf?: number;
    initialValues?: Record<string, string>;
    onSaved: (id: number, body: JsonObject, returnToList: boolean) => Promise<void>;
    onCancel: () => void;
    continueLabel?: string;
    allowReturn?: boolean;
  };
};

export function EntityManager({
  entity,
  detail,
  actions,
  fixed,
  title,
  editor,
  related,
  onPendingChange,
}: Props) {
  const { t: tr, pluralIndex } = useI18n();

  const features = useFeatures();

  const copySource = useQuery({
    queryKey: ["product-copy", editor?.copyOf],
    queryFn: () => request<EntityRow>(`/api/objects/products/${editor?.copyOf}`),
    enabled: entity === "products" && editor?.recordId === null && editor.copyOf !== undefined,
    retry: false,
    gcTime: 0,
  });

  const richEntity =
    entity === "products" || entity === "recipes" || entity === "equipment" ? entity : null;

  const preferences = usePreferences();

  const amountStep =
    preferences.amountPrecision === 0 ? "1" : `0.${"0".repeat(preferences.amountPrecision - 1)}1`;

  const needsSettings = ["products", "product_barcodes", "quantity_unit_conversions"].includes(
    entity,
  );

  const productSettings = useQuery({ ...userSettingsQuery(), enabled: needsSettings });

  const barcodeConversions = useQuery({
    queryKey: ["objects", "quantity_unit_conversions_resolved"],
    queryFn: () => api.objects("quantity_unit_conversions_resolved"),
    enabled: entity === "product_barcodes",
  });

  const definition = getEntitySpec(entity);

  const baseSpec = {
    ...definition,
    label: tr(definition.label),
    singular: tr(definition.singular),
    fields: definition.fields.map((field) => ({
      ...field,
      label: tr(field.label),
      choiceLabels: Object.fromEntries(
        (field.choices ?? []).map((choice) => [choice, tr(field.choiceLabels?.[choice] ?? choice)]),
      ),
    })),
  };

  const energyUnit = String(features.query.data?.ENERGY_UNIT ?? "kcal");

  const labeledFields = baseSpec.fields.map((field) =>
    entity === "products" && field.key === "calories"
      ? { ...field, label: tr("Energy per stock unit (%s)", energyUnit) }
      : field,
  );

  const fieldEnabled = (field: EntityField) =>
    !field.features || field.features.every(features.enabled);

  const [values, setValues] = useState<Record<string, string>>({});
  const [descriptionReady, setDescriptionReady] = useState(!richEntity);
  const [editorRevision, setEditorRevision] = useState(0);
  const initializedReferences = useRef(-1);

  const changeDescription = useCallback(
    (description: string) => setValues((values) => ({ ...values, description })),
    [],
  );

  const [fieldEdits, setFieldEdits] = useState<Record<string, FieldEdits>>({});
  const [creating, setCreating] = useState(false);
  const [factorChanged, setFactorChanged] = useState(false);
  const [tareEditable, setTareEditable] = useState(false);
  const [minimumStockDisabled, setMinimumStockDisabled] = useState(false);
  const [parentReadError, setParentReadError] = useState<{ id: string; error: Error } | null>(null);
  const [parentReadRevision, setParentReadRevision] = useState(0);
  const [parentSelected, setParentSelected] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  const pictureGroup =
    entity === "products" ? "productpictures" : entity === "recipes" ? "recipepictures" : null;

  const [picture, setPicture] = useState<PictureSelection>({
    original: null,
    upload: null,
    remove: false,
  });

  const recordTypes = useQuery({
    queryKey: ["objects", "userentities"],
    queryFn: () => api.objects("userentities"),
    enabled: ["userfields", "userobjects"].includes(entity),
  });

  const custom = useQuery({
    ...userfieldsQuery,
    enabled: !["userfields", "userentities"].includes(entity),
  });

  const customGroups = (typeId: string | undefined) => {
    const namespace = `userentity-${recordTypes.data?.find((type) => type.id === Number(typeId))?.name}`;
    const groups: Record<string, UserfieldDefinition[]> = {};

    for (const field of custom.data ?? []) {
      if (field.entity === entity || (entity === "userobjects" && field.entity === namespace))
        (groups[field.entity] ??= []).push(field);
    }

    return groups;
  };

  const groups = customGroups(values.userentity_id);

  const spec: EntitySpec = {
    ...baseSpec,
    fields: labeledFields.filter(fieldEnabled).map((field) =>
      entity === "userfields" && field.key === "entity"
        ? {
            ...field,
            choiceLabels: Object.fromEntries([
              ...(field.choices ?? []).map((key) => [key, tr(entities.get(key)?.label ?? key)]),
              ...(recordTypes.data ?? []).map((type) => [
                `userentity-${type.name}`,
                String(type.caption ?? type.name),
              ]),
            ]),
            choices: [
              ...(field.choices ?? []),
              ...(recordTypes.data ?? []).map((type) => `userentity-${type.name}`),
            ],
          }
        : field,
    ),
  };

  const prefix = useId();

  const descriptionLoaded = useCallback(
    (loaded: boolean) => {
      setDescriptionReady(loaded);

      if (
        loaded &&
        creating &&
        editor?.copyOf !== undefined &&
        document.activeElement instanceof HTMLIFrameElement &&
        form.current?.contains(document.activeElement)
      )
        document.getElementById(`${prefix}-name`)?.focus();
    },
    [creating, editor?.copyOf, prefix],
  );

  const client = useQueryClient();
  const [editing, setEditing] = useState<number | null | undefined>(undefined);

  const productOptions = useQuery({
    queryKey: [
      "product-form-options",
      editor ? editor.recordId : creating ? null : (editing ?? null),
    ],
    queryFn: () =>
      api.getProductFormOptions(editor ? editor.recordId : creating ? null : (editing ?? null)),
    enabled: entity === "products",
    retry: false,
  });

  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const editorStarted = useRef(false);

  const query = useQuery({
    queryKey: ["entity-manager", entity],
    queryFn: async () => {
      const [rows, types, conversions] = await Promise.all([
        api.objects(entity),
        entity === "userobjects" ? api.objects("userentities") : [],
        entity === "products" ? api.objects("quantity_unit_conversions_resolved") : [],
      ]);

      return Promise.all(
        rows.map(async (row): Promise<EntityRow> => {
          const fields: Record<string, string | null> = Object.fromEntries(
            Object.entries(row.userfields ?? {}).map(([key, value]) => [
              `custom:${entity}:${key}`,
              value,
            ]),
          );

          const type = types.find((type) => type.id === row.userentity_id);

          if (type) {
            const namespace = `userentity-${type.name}`;

            const values = await request<Record<string, string | null>>(
              `/api/userfields/${encodeURIComponent(namespace)}/${row.id}`,
            );

            for (const [key, value] of Object.entries(values))
              fields[`custom:${namespace}:${key}`] = value;
          }

          const purchase = conversions.find(
            (conversion) =>
              conversion.product_id === row.id &&
              conversion.from_qu_id === row.qu_id_purchase &&
              conversion.to_qu_id === row.qu_id_stock,
          );

          const result: EntityRow = { ...row, custom_values: fields };

          if (entity === "products") {
            result.qu_factor_purchase_to_stock = Number(purchase?.factor ?? 1);
          }

          return result;
        }),
      );
    },
  });

  const descriptions = useQuery({
    queryKey: queryKeys.contentList(richEntity ?? "products"),
    queryFn: () => api.getContentList(richEntity ?? "products"),
    enabled:
      !editor &&
      richEntity !== null &&
      query.isSuccess &&
      query.data.some((row) => Boolean(row.description)),
  });

  const descriptionHtml = useMemo(
    () => new Map(descriptions.data?.map((row) => [row.id, row.html])),
    [descriptions.data],
  );

  const refs = [...new Set(spec.fields.flatMap((f) => (f.ref ? [f.ref] : [])))];

  const options = useQueries({
    queries: refs.map((ref) => ({
      queryKey: ["objects", ref],
      queryFn: () => (ref === "users" ? request<EntityRow[]>("/api/users") : api.objects(ref)),
    })),
  });

  const productOptionsReady =
    !productOptions.isEnabled ||
    (productOptions.isSuccess &&
      !productOptions.isFetching &&
      options.every((query) => query.isSuccess && !query.isFetching));

  const parentId =
    entity === "products" &&
    editing !== undefined &&
    productOptions.data?.references.parent_product_id?.includes(Number(values.parent_product_id))
      ? values.parent_product_id
      : "";

  const parentReadEnabled =
    productOptionsReady && !(creating && editor?.copyOf !== undefined && !parentSelected);

  useEffect(() => {
    if (!parentId || !parentReadEnabled) return;
    let current = true;

    void request<EntityRow>(`/api/objects/products/${parentId}`).then(
      (parent) => {
        if (!current) return;
        setMinimumStockDisabled(
          preferenceEnabled(String(parent.cumulate_min_stock_amount_of_sub_products ?? "")),
        );
        setParentReadError(null);
      },
      (error: Error) => {
        if (current) setParentReadError({ id: parentId, error });
      },
    );

    return () => {
      current = false;
    };
  }, [parentId, parentReadEnabled, editorRevision, parentReadRevision]);

  const parentError = parentReadError?.id === parentId ? parentReadError.error : null;

  const error =
    query.error ||
    productOptions.error ||
    parentError ||
    copySource.error ||
    custom.error ||
    descriptions.error ||
    (entity === "product_barcodes" ? barcodeConversions.error : null) ||
    options.find((q) => q.error)?.error ||
    (needsSettings ? productSettings.error : null);

  const ready =
    query.isSuccess &&
    productOptionsReady &&
    (!copySource.isEnabled || (copySource.isSuccess && !copySource.isFetching)) &&
    features.query.isSuccess &&
    (!custom.isEnabled || custom.isSuccess) &&
    (!recordTypes.isEnabled || recordTypes.isSuccess) &&
    (!needsSettings || productSettings.isSuccess) &&
    options.every((query) => query.isSuccess) &&
    (entity !== "product_barcodes" || barcodeConversions.isSuccess);

  const mutate = useMutation({
    mutationFn: async (operation: {
      kind: "save" | "delete";
      factorChanged?: boolean;
      body?: JsonObject;
      fields?: Record<string, FieldEdits>;
      id?: number;
      picture?: PictureUpload | null;
      removePicture?: string | null;
      intent?: "continue" | "return" | "refresh";
    }) => {
      if (operation.kind === "delete") return api.deleteObject(entity, operation.id!);

      const removal =
        pictureGroup && operation.removePicture
          ? request(filePath(pictureGroup, operation.removePicture), { method: "DELETE" }).catch(
              (error: Error) => error,
            )
          : undefined;

      const body = { ...operation.body };
      const purchaseFactor = body.qu_factor_purchase_to_stock;

      const saveFields = async (id: number) => {
        for (const [namespace, edits] of Object.entries(operation.fields ?? {}))
          await saveUserfields(namespace, id, groups[namespace] ?? [], edits, (name, edit) =>
            setFieldEdits((previous) => ({
              ...previous,
              [namespace]: { ...previous[namespace], [name]: edit },
            })),
          );
      };

      const fieldsBeforeRecord = entity === "shopping_lists" && editing !== null;
      const parallelBarcodeEdit = entity === "product_barcodes" && editing !== null;

      if (entity === "products") delete body.qu_factor_purchase_to_stock;
      let id = editing!;

      if (fieldsBeforeRecord) await saveFields(id);

      if (editing === null) {
        const created = await api.createObject(entity, body);
        id = Number(created.created_object_id);
        setEditing(id);
      } else if (parallelBarcodeEdit) {
        const results = await Promise.allSettled([
          saveFields(id),
          api.updateObject(entity, id, body),
        ]);

        for (const result of results) if (result.status === "rejected") throw result.reason;
      } else await api.updateObject(entity, id, body);

      if (
        entity === "products" &&
        operation.factorChanged &&
        !(creating && editor?.copyOf !== undefined) &&
        operation.intent !== "refresh" &&
        purchaseFactor != null &&
        body.qu_id_purchase !== body.qu_id_stock
      ) {
        const conversions = await api.objects("quantity_unit_conversions");

        const conversion = conversions.find(
          (row) =>
            row.product_id === id &&
            row.from_qu_id === body.qu_id_purchase &&
            row.to_qu_id === body.qu_id_stock,
        );

        if (conversion)
          await api.updateObject("quantity_unit_conversions", conversion.id, {
            factor: purchaseFactor,
          });
        else {
          const resolved = await api.objects("quantity_unit_conversions_resolved");

          const current = resolved.find(
            (row) =>
              row.product_id === id &&
              row.from_qu_id === body.qu_id_purchase &&
              row.to_qu_id === body.qu_id_stock,
          );

          if (Number(current?.factor) !== Number(purchaseFactor))
            await api.createObject("quantity_unit_conversions", {
              product_id: id,
              from_qu_id: body.qu_id_purchase,
              to_qu_id: body.qu_id_stock,
              factor: purchaseFactor,
            });
        }
      }

      if (!fieldsBeforeRecord && !parallelBarcodeEdit) await saveFields(id);

      if (pictureGroup && operation.picture) {
        await request(filePath(pictureGroup, operation.picture.name), {
          method: "PUT",
          body: operation.picture.file,
        });
      }

      const removalError = await removal;

      if (removalError) throw removalError;

      return { id, body, intent: operation.intent };
    },
    onSuccess: async (result) => {
      if (result?.intent === "refresh") {
        await client.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] !== "description-editor" && query.queryKey[0] !== "product-copy",
        });
        await reload(result.id);

        return;
      }

      if (!editor) setEditing(undefined);
      setDeleteId(null);
      await client.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] !== "description-editor" && query.queryKey[0] !== "product-copy",
      });

      if (editor && related && result?.intent === "continue") await reload(result.id);

      if (editor && result)
        await editor.onSaved(result.id, result.body, result.intent === "return");
    },
  });

  useEffect(() => onPendingChange?.(mutate.isPending), [mutate.isPending, onPendingChange]);

  const selectValue = (field: EntityField, value: string, fromInput = false) => {
    if (entity === "products" && field.key === "parent_product_id") setParentSelected(true);

    if (entity === "products" && field.key === "parent_product_id" && !value)
      setMinimumStockDisabled(false);

    if (entity === "products" && field.key === "qu_factor_purchase_to_stock")
      setFactorChanged(true);

    if (entity === "products" && ["qu_id_stock", "qu_id_purchase"].includes(field.key))
      setFactorChanged(false);

    if (field.key === "userentity_id") {
      const nextGroups = customGroups(value);
      setFieldEdits((previous) =>
        Object.fromEntries(
          Object.entries(nextGroups).map(([namespace, definitions]) => [
            namespace,
            namespace === entity && previous[namespace]
              ? previous[namespace]
              : initialUserfields(definitions, {}, true),
          ]),
        ),
      );
    }

    setValues((previous) => {
      const next = { ...previous };

      next[field.key] = value;

      if (entity === "product_barcodes" && field.key === "product_id") next.qu_id = "";

      if (entity === "products" && next.qu_id_stock && (field.key === "qu_id_stock" || fromInput)) {
        for (const key of ["qu_id_purchase", "qu_id_consume", "qu_id_price"]) {
          if (!referenceValue(key, next[key]) && referenceValue(key, next.qu_id_stock))
            next[key] = next.qu_id_stock;
        }
      }

      if (entity === "products" && ["qu_id_stock", "qu_id_purchase"].includes(field.key)) {
        const conversion = productOptions.data?.conversions.find(
          (row) =>
            row.from_qu_id === Number(next.qu_id_purchase) &&
            row.to_qu_id === Number(next.qu_id_stock),
        );

        next.qu_factor_purchase_to_stock = String(conversion?.factor ?? 1);
      }

      return next;
    });
  };

  const barcodeUnits = (product: EntityRow | undefined) => {
    const seen = new Set<number>();
    const units = options[refs.indexOf("quantity_units")]?.data ?? [];
    const rows: EntityRow[] = [];

    for (const conversion of barcodeConversions.data ?? []) {
      if (
        conversion.product_id !== product?.id ||
        (conversion.from_qu_id !== product?.qu_id_purchase &&
          conversion.to_qu_id !== product?.qu_id_purchase)
      )
        continue;
      const id = Number(conversion.to_qu_id);
      const unit = units.find((row) => row.id === id);

      if (unit && !seen.has(id)) {
        seen.add(id);
        rows.push(unit);
      }
    }

    return rows;
  };

  const barcodeUnit = (product: EntityRow | undefined, unitId: EntityRow["qu_id"]) =>
    barcodeUnits(product).some((row) => row.id === Number(unitId)) ? String(unitId) : "";

  const referenceRows = (field: EntityField) => {
    const rows = options[refs.indexOf(field.ref ?? "")]?.data ?? [];

    if (entity === "products")
      return (productOptions.data?.references[field.key] ?? []).flatMap((id) => {
        const row = rows.find((row) => row.id === id);

        return row ? [row] : [];
      });

    if (entity === "product_barcodes" && field.key === "qu_id") {
      const productId = Number(fixed?.product_id ?? values.product_id);
      const product = options[refs.indexOf("products")]?.data?.find((row) => row.id === productId);

      return barcodeUnits(product);
    }

    return ["product_barcodes", "quantity_unit_conversions"].includes(entity)
      ? rows
          .filter((row) => row.active !== 0)
          .sort((a, b) => compareSqliteNames(String(a.name), String(b.name)))
      : rows;
  };

  const referenceValue = (key: string, value = "") =>
    value && productOptions.data?.references[key]?.includes(Number(value)) ? value : "";

  useEffect(() => {
    if (
      entity !== "products" ||
      editing === undefined ||
      !productOptionsReady ||
      initializedReferences.current === editorRevision ||
      !productOptions.data
    )
      return;
    initializedReferences.current = editorRevision;
    const references = productOptions.data.references;
    setValues((previous) => {
      const next = { ...previous };

      for (const [key, ids] of Object.entries(references))
        next[key] = previous[key] && ids.includes(Number(previous[key])) ? previous[key] : "";

      if (!(creating && editor?.copyOf !== undefined))
        for (const key of ["qu_id_purchase", "qu_id_consume", "qu_id_price"])
          if (!next[key] && next.qu_id_stock && references[key]?.includes(Number(next.qu_id_stock)))
            next[key] = next.qu_id_stock;

      const conversion = productOptions.data?.conversions.find(
        (row) =>
          row.from_qu_id === Number(next.qu_id_purchase) &&
          row.to_qu_id === Number(next.qu_id_stock),
      );

      next.qu_factor_purchase_to_stock = String(conversion?.factor ?? 1);

      return next;
    });
  }, [
    entity,
    editing,
    editorRevision,
    productOptionsReady,
    productOptions.data,
    creating,
    editor?.copyOf,
  ]);

  const namedUnit = (id: EntityRow["qu_id"], count: number) => {
    const unit = options[refs.indexOf("quantity_units")]?.data?.find(
      (row) => row.id === Number(id),
    );

    return unit
      ? unitLabel(
          {
            name: String(unit.name),
            name_plural: unit.name_plural ?? null,
            plural_forms: unit.plural_forms ?? null,
          },
          count,
          pluralIndex,
          false,
        )
      : "";
  };

  const conversionHint = (from: string, to: string, factor: number) =>
    tr(
      "This means 1 %1$s is the same as %2$s %3$s",
      namedUnit(from, 1),
      preferences.formatAmount(factor),
      namedUnit(to, factor),
    );

  const barcodeHint = () => {
    if (!values.amount || !values.qu_id) return null;

    const product = options[refs.indexOf("products")]?.data?.find(
      (row) => row.id === Number(fixed?.product_id ?? values.product_id),
    );

    if (!product || Number(values.qu_id) === product.qu_id_purchase) return null;

    const conversion = barcodeConversions.data?.find(
      (row) =>
        row.product_id === product.id &&
        row.to_qu_id === Number(values.qu_id) &&
        (row.from_qu_id === product.qu_id_purchase || row.to_qu_id === product.qu_id_purchase),
    );

    if (!conversion || !(Number(conversion.factor) > 0)) return null;
    const amount = Number(values.amount) / Number(conversion.factor);

    return tr(
      "This equals %1$s %2$s",
      preferences.formatAmount(amount),
      namedUnit(product.qu_id_purchase, amount),
    );
  };

  const start = (row?: EntityRow) => {
    mutate.reset();
    setDescriptionReady(!richEntity);
    setEditorRevision((revision) => revision + 1);
    setEditing(row?.id ?? null);
    setCreating(!row);
    setFactorChanged(false);
    setTareEditable(Boolean(row && Number(row.enable_tare_weight_handling)));
    setMinimumStockDisabled(false);
    setParentReadError(null);
    setParentSelected(false);
    setPicture({
      original: row?.picture_file_name ?? null,
      upload: null,
      remove: false,
    });

    const initialValues = Object.fromEntries(
      baseSpec.fields.map((f) => [
        f.key,
        row
          ? f.type === "checkbox"
            ? Number(row[f.key])
              ? "1"
              : "0"
            : String(row[f.key] ?? "")
          : (f.value ?? ""),
      ]),
    );

    if (!row && entity === "products" && editor?.copyOf === undefined) {
      const settings = productSettings.data;

      const references = [
        ["location_id", "product_presets_location_id", "locations"],
        ["product_group_id", "product_presets_product_group_id", "product_groups"],
        ...["qu_id_stock", "qu_id_purchase", "qu_id_consume", "qu_id_price"].map((key) => [
          key,
          "product_presets_qu_id",
          "quantity_units",
        ]),
      ];

      for (const [field, setting, reference] of references) {
        const value = String(settings?.[setting] ?? -1);

        if (value === "-1") continue;
        const rows = options[refs.indexOf(reference)]?.data ?? [];
        initialValues[field] = rows.some((row) => String(row.id) === value) ? value : "";
      }

      initialValues.default_best_before_days = String(
        settings?.product_presets_default_due_days ?? 0,
      );
      const treatOpened = settings?.product_presets_treat_opened_as_out_of_stock;
      initialValues.treat_opened_as_out_of_stock = preferenceEnabled(
        treatOpened === undefined ? true : treatOpened,
      )
        ? "1"
        : "0";
      initialValues.default_stock_label_type = String(
        settings?.product_presets_default_stock_label_type ?? 0,
      );
    }

    if (!row && entity === "products" && editor?.copyOf !== undefined) {
      const source = copySource.data;

      if (source) {
        // The native copy form fills these controls only. Other controls keep
        // new-record defaults, and custom values and related rows stay separate.
        for (const key of [
          "parent_product_id",
          "description",
          "location_id",
          "shopping_location_id",
          "min_stock_amount",
          "cumulate_min_stock_amount_of_sub_products",
          "default_best_before_days",
          "default_best_before_days_after_open",
          "product_group_id",
          "qu_id_stock",
          "qu_id_purchase",
          "enable_tare_weight_handling",
          "tare_weight",
          "not_check_stock_fulfillment_for_recipes",
          "calories",
          "default_best_before_days_after_freezing",
          "default_best_before_days_after_thawing",
          "quick_consume_amount",
          "quick_open_amount",
          "default_consume_location_id",
          "no_own_stock",
          "hide_on_stock_overview",
          "auto_reprint_stock_label",
          "default_stock_label_type",
          "move_on_open",
          "treat_opened_as_out_of_stock",
        ]) {
          if (source[key] != null) initialValues[key] = String(source[key]);
          else if (
            source[key] === null &&
            key !== "calories" &&
            baseSpec.fields.some((field) => field.key === key && field.precision)
          )
            initialValues[key] = "";
        }
      }
    }

    if (entity === "products")
      for (const field of baseSpec.fields) {
        if (!field.precision) continue;
        let value = row && row[field.key] == null ? "1" : initialValues[field.key];

        if (
          value &&
          (!/^-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value)))
        )
          value = "";

        if (row && value && field.precision === "amount")
          value = Number(value).toLocaleString("en", {
            maximumFractionDigits: preferences.amountPrecision,
            useGrouping: false,
          });

        initialValues[field.key] = value;
      }

    if (["product_barcodes", "quantity_unit_conversions"].includes(entity)) {
      const productId = Number(fixed?.product_id ?? row?.product_id);
      const product = options[refs.indexOf("products")]?.data?.find((row) => row.id === productId);

      if (entity === "product_barcodes") initialValues.qu_id = barcodeUnit(product, row?.qu_id);
      else if (!row) {
        initialValues.from_qu_id = product ? String(product.qu_id_stock) : "";
        initialValues.factor = "1";
      }
    }

    setValues(!row ? { ...initialValues, ...editor?.initialValues } : initialValues);
    setFieldEdits(
      Object.fromEntries(
        Object.entries(customGroups(String(row?.userentity_id ?? initialValues.userentity_id))).map(
          ([namespace, definitions]) => [
            namespace,
            initialUserfields(
              definitions,
              Object.fromEntries(
                definitions.map((field) => [
                  field.name,
                  row?.custom_values?.[`custom:${namespace}:${field.name}`] ?? null,
                ]),
              ),
              !row,
            ),
          ],
        ),
      ),
    );
  };

  const editorRecord = query.data?.find((row) => row.id === editor?.recordId);
  const editorMissing = editor && editor.recordId !== null && query.isSuccess && !editorRecord;

  const reload = async (id = editing) => {
    const result = await query.refetch();

    if (result.error) throw result.error;
    const row = result.data?.find((row) => row.id === id);

    if (row) start(row);
  };

  useEffect(() => {
    if (!editor || editorStarted.current || editorMissing || !ready) return;

    editorStarted.current = true;
    start(editorRecord);
  });

  const recordBody = (): JsonObject => {
    const body: JsonObject = {};
    Object.assign(body, fixed);

    for (const field of baseSpec.fields) {
      if (!fieldEnabled(field) && field.disabledValue !== undefined) {
        body[field.key] = Number(field.disabledValue);
      }
    }

    if (
      entity === "products" &&
      features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING") &&
      !features.enabled("STOCK_PRODUCT_OPENED_TRACKING")
    ) {
      body.default_best_before_days_after_open = 1;
    }

    for (const field of spec.fields) {
      if (fixed && field.key in fixed) continue;

      if (field.when && !field.when.values.includes(values[field.when.key])) continue;

      if (entity === "products" && field.key === "tare_weight" && !tareEditable) continue;

      if (entity === "products" && field.key === "min_stock_amount" && minimumStockDisabled)
        continue;

      if (
        entity === "products" &&
        field.key === "parent_product_id" &&
        productOptions.data?.parent_disabled
      )
        continue;
      const stored = values[field.key] ?? field.value ?? "";
      const value = entity === "products" && field.ref ? referenceValue(field.key, stored) : stored;

      if (field.key === "description" && richEntity) body.description = value;
      else if (field.type === "checkbox") body[field.key] = value === "1" ? 1 : 0;
      else if (!value) {
        if (
          (entity === "product_barcodes" ||
            (entity === "products" && (field.ref || field.key === "calories"))) &&
          !field.required
        )
          body[field.key] = "";
        else if (editing !== null && !field.required) body[field.key] = null;
      } else
        body[field.key] =
          field.type === "multiple"
            ? value
            : field.type === "number" || field.ref
              ? Number(value)
              : value;
    }

    if (pictureGroup) {
      if (picture.upload) body.picture_file_name = picture.upload.name;
      else if (picture.remove) body.picture_file_name = null;
    }

    return body;
  };

  const saveOperation = (intent: "continue" | "return" | "refresh") => ({
    kind: "save" as const,
    factorChanged,
    body: recordBody(),
    fields: fieldEdits,
    picture: picture.upload,
    removePicture: picture.remove ? picture.original : null,
    intent,
  });

  const save = (event: FormEvent) => {
    event.preventDefault();

    if (!descriptionReady || !productOptionsReady) return;
    const submitter = event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null;
    mutate.mutate(
      saveOperation(
        submitter instanceof HTMLButtonElement && submitter.value === "return"
          ? "return"
          : "continue",
      ),
    );
  };

  const afterDelete = async () => {
    if (!descriptionReady || !productOptionsReady || !form.current?.reportValidity()) return;
    await mutate.mutateAsync(saveOperation("refresh"));
  };

  const rows = (query.data ?? []).filter(
    (row) =>
      (!fixed || Object.entries(fixed).every(([key, value]) => row[key] === value)) &&
      JSON.stringify(row).toLowerCase().includes(search.toLowerCase()),
  );

  const Related = related;
  const relatedRecord = query.data?.find((row) => row.id === editing);

  return (
    <section className="collection" aria-label={title ?? spec.label}>
      {!editor ? (
        <div className="section-heading">
          <h2>{title ?? spec.label}</h2>
          <button
            className="btn btn-primary"
            disabled={mutate.isPending || !ready}
            onClick={() => start()}
          >
            {tr("Add")} {spec.singular}
          </button>
        </div>
      ) : null}
      {editing !== undefined && (
        <form
          ref={form}
          onSubmit={save}
          onKeyDown={(event) => {
            if (
              editor?.continueLabel &&
              event.key === "Enter" &&
              !event.nativeEvent.isComposing &&
              event.target instanceof HTMLInputElement
            ) {
              event.preventDefault();

              if (
                descriptionReady &&
                productOptionsReady &&
                event.currentTarget.reportValidity() &&
                !mutate.isPending
              )
                mutate.mutate(
                  saveOperation(!creating && editor.allowReturn ? "return" : "continue"),
                );
            }
          }}
          className="panel panel-inner"
          aria-label={
            editing === null
              ? tr("Add %s", String(spec.singular))
              : tr("Edit %s", String(spec.singular))
          }
        >
          {!editor ? (
            <h3>
              {editing === null
                ? tr("New %s", String(spec.singular))
                : tr("Edit %s", String(spec.singular))}
            </h3>
          ) : null}
          <div className="form-grid">
            {pictureGroup ? (
              <EntityPictureField
                group={pictureGroup}
                value={picture}
                onChange={setPicture}
                disabled={mutate.isPending}
                label={tr("%s picture", entity === "products" ? tr("Product") : tr("Recipe"))}
              />
            ) : null}
            {spec.fields
              .filter(
                (f) =>
                  (!fixed || !(f.key in fixed)) &&
                  !(
                    f.key === "qu_factor_purchase_to_stock" &&
                    creating &&
                    editor?.copyOf !== undefined
                  ) &&
                  (!f.when || f.when.values.includes(values[f.when.key])),
              )
              .map((field) => {
                if (field.key === "description" && richEntity)
                  return (
                    <div key={field.key} className="field description-field">
                      <DescriptionEditor
                        key={editorRevision}
                        entity={richEntity}
                        value={values.description ?? ""}
                        pasteInitial={creating && editor?.copyOf !== undefined}
                        onChange={changeDescription}
                        onReady={descriptionLoaded}
                      />
                    </div>
                  );
                const id = `${prefix}-${field.key}`;

                const optionsQuery = field.ref ? options[refs.indexOf(field.ref)] : undefined;

                return (
                  <div className="field" key={field.key}>
                    <label htmlFor={id}>{field.label}</label>
                    {field.type === "multiple" ? (
                      <div role="group" aria-label={field.label} className="weekday-options">
                        {(
                          field.choices?.map((name) => ({ id: name, name })) ??
                          optionsQuery?.data ??
                          []
                        ).map((row) => {
                          const selected = (values[field.key] ?? "").split(",").filter(Boolean);

                          const value = String(row.id);

                          return (
                            <label key={row.id}>
                              <input
                                type="checkbox"
                                checked={selected.includes(value)}
                                onChange={(e) =>
                                  setValues({
                                    ...values,
                                    [field.key]: (e.target.checked
                                      ? [...selected, value]
                                      : selected.filter((item) => item !== value)
                                    ).join(","),
                                  })
                                }
                              />{" "}
                              {String(
                                "display_name" in row
                                  ? row.display_name
                                  : "username" in row
                                    ? row.username
                                    : (row.name ?? row.id),
                              )}
                            </label>
                          );
                        })}
                        {optionsQuery?.isSuccess && !optionsQuery.data.length && (
                          <span className="muted">
                            {tr("Create a user in Manage to assign this chore.")}
                          </span>
                        )}
                      </div>
                    ) : field.type === "weekdays" ? (
                      <div role="group" aria-label={field.label} className="weekday-options">
                        {[
                          "monday",
                          "tuesday",
                          "wednesday",
                          "thursday",
                          "friday",
                          "saturday",
                          "sunday",
                        ].map((day) => {
                          const days = (values[field.key] ?? "").split(",").filter(Boolean);

                          return (
                            <label key={day}>
                              <input
                                type="checkbox"
                                checked={days.includes(day)}
                                onChange={(e) =>
                                  setValues({
                                    ...values,
                                    [field.key]: (e.target.checked
                                      ? [...days, day]
                                      : days.filter((value) => value !== day)
                                    ).join(","),
                                  })
                                }
                              />{" "}
                              {tr(day[0].toUpperCase() + day.slice(1))}
                            </label>
                          );
                        })}
                      </div>
                    ) : field.ref || field.choices ? (
                      <select
                        ref={(select) => {
                          if (entity === "quantity_unit_conversions" && field.key === "to_qu_id")
                            select?.setCustomValidity(
                              values.from_qu_id && values.from_qu_id === values.to_qu_id
                                ? tr("The source and destination units must be different.")
                                : "",
                            );
                        }}
                        id={id}
                        value={
                          entity === "products" && field.ref
                            ? referenceValue(field.key, values[field.key])
                            : (values[field.key] ?? field.value ?? "")
                        }
                        required={field.required}
                        aria-describedby={
                          entity === "products" &&
                          field.key === "parent_product_id" &&
                          productOptions.data?.parent_disabled
                            ? `${id}-hint`
                            : undefined
                        }
                        disabled={
                          entity === "products" &&
                          (!productOptionsReady ||
                            (field.key === "parent_product_id" &&
                              productOptions.data?.parent_disabled))
                        }
                        onChange={(e) => selectValue(field, e.target.value)}
                      >
                        <option value="">
                          {field.required ? tr("Select an option") : tr("None")}
                        </option>
                        {field.choices?.map((choice) => (
                          <option key={choice} value={choice}>
                            {field.choiceLabels?.[choice] ?? choice}
                          </option>
                        ))}
                        {referenceRows(field).map((row) => (
                          <option key={row.id} value={row.id}>
                            {String(
                              row.display_name ??
                                row.caption ??
                                row.name ??
                                row.username ??
                                `#${row.id}`,
                            )}
                          </option>
                        ))}
                      </select>
                    ) : field.type === "textarea" ? (
                      <textarea
                        id={id}
                        value={values[field.key] ?? field.value ?? ""}
                        required={field.required}
                        onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                      />
                    ) : field.precision ? (
                      <NumberPicker
                        id={id}
                        label={field.label}
                        value={values[field.key] ?? field.value ?? ""}
                        required={field.required}
                        disabled={
                          (field.key === "tare_weight" && !tareEditable) ||
                          (field.key === "min_stock_amount" && minimumStockDisabled)
                        }
                        min={field.min === "step" ? amountStep : field.min}
                        step={field.precision === "amount" ? amountStep : "1"}
                        onChange={(value) => selectValue(field, value, true)}
                      />
                    ) : (
                      <input
                        id={id}
                        autoFocus={!!editor && field.key === "name"}
                        type={field.type ?? "text"}
                        value={
                          field.type === "checkbox"
                            ? undefined
                            : (values[field.key] ?? field.value ?? "")
                        }
                        checked={
                          field.type === "checkbox"
                            ? (values[field.key] ?? field.value) === "1"
                            : undefined
                        }
                        required={field.required}
                        min={
                          (entity === "quantity_unit_conversions" && field.key === "factor") ||
                          (entity === "product_barcodes" && field.key === "amount")
                            ? amountStep
                            : field.min === "step"
                              ? amountStep
                              : field.min
                        }
                        step={
                          field.type === "number"
                            ? (entity === "quantity_unit_conversions" && field.key === "factor") ||
                              (entity === "product_barcodes" && field.key === "amount")
                              ? amountStep
                              : "any"
                            : undefined
                        }
                        onChange={(e) => {
                          if (entity === "products" && field.key === "enable_tare_weight_handling")
                            setTareEditable(e.target.checked);
                          selectValue(
                            field,
                            field.type === "checkbox"
                              ? e.target.checked
                                ? "1"
                                : "0"
                              : e.target.value,
                            field.type !== "checkbox",
                          );
                        }}
                      />
                    )}
                    {entity === "products" &&
                    field.key === "parent_product_id" &&
                    productOptions.data?.parent_disabled ? (
                      <p className="field-hint" id={`${id}-hint`}>
                        {tr(
                          "Not possible because this product is already used as a parent product in another product",
                        )}
                      </p>
                    ) : null}
                    {entity === "product_barcodes" && field.key === "barcode" ? (
                      <CameraScanner onScan={(code) => setValues({ ...values, barcode: code })} />
                    ) : null}
                  </div>
                );
              })}
          </div>
          {entity === "product_barcodes" && barcodeHint() ? (
            <p className="muted">{barcodeHint()}</p>
          ) : null}
          {entity === "quantity_unit_conversions" &&
          values.from_qu_id &&
          values.to_qu_id &&
          Number(values.factor) > 0 ? (
            <div className="muted">
              <p>{conversionHint(values.from_qu_id, values.to_qu_id, Number(values.factor))}</p>
              <p>{conversionHint(values.to_qu_id, values.from_qu_id, 1 / Number(values.factor))}</p>
            </div>
          ) : null}
          {Object.entries(groups).map(([namespace, fields]) => (
            <UserfieldsEditor
              key={namespace}
              fields={fields}
              values={fieldEdits[namespace] ?? {}}
              creating={creating}
              disabled={mutate.isPending}
              onChange={(name, edit) =>
                setFieldEdits((previous) => ({
                  ...previous,
                  [namespace]: { ...previous[namespace], [name]: edit },
                }))
              }
            />
          ))}
          {editor?.continueLabel && entity === "products" && editing === null ? (
            <p className="muted">
              {tr("Save & continue to add quantity unit conversions & barcodes")}
            </p>
          ) : null}
          <div className="actions">
            <button
              className="btn btn-primary"
              name="intent"
              value="continue"
              disabled={
                mutate.isPending ||
                !descriptionReady ||
                !productOptionsReady ||
                options.some((q) => q.isPending)
              }
            >
              {editor?.continueLabel ? (
                tr(editor.continueLabel)
              ) : (
                <>
                  {tr("Save")} {spec.singular}
                </>
              )}
            </button>
            {editor?.allowReturn ? (
              <button
                className="btn"
                name="intent"
                value="return"
                disabled={
                  mutate.isPending ||
                  !descriptionReady ||
                  !productOptionsReady ||
                  options.some((q) => q.isPending)
                }
              >
                {tr("Save & return to products")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost"
              disabled={mutate.isPending}
              onClick={() => (editor ? editor.onCancel() : setEditing(undefined))}
            >
              {tr("Cancel")}
            </button>
          </div>
        </form>
      )}
      {Related && relatedRecord ? (
        <Related
          row={relatedRecord}
          pending={mutate.isPending || !descriptionReady || !productOptionsReady}
          reload={reload}
          afterDelete={afterDelete}
        />
      ) : null}
      {error && <ErrorBlock message={error.message} />}
      {parentError ? (
        <button type="button" className="btn" onClick={() => setParentReadRevision((n) => n + 1)}>
          {tr("Retry parent product")}
        </button>
      ) : null}
      {productOptions.error ? (
        <button
          type="button"
          className="btn"
          onClick={() => {
            void productOptions.refetch();
          }}
        >
          {tr("Retry product options")}
        </button>
      ) : null}
      {copySource.error ? (
        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              void copySource.refetch();
            }}
          >
            {tr("Retry")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={editor?.onCancel}>
            {tr("Cancel")}
          </button>
        </div>
      ) : null}
      {editorMissing ? <ErrorBlock message={tr("Item not found.")} /> : null}
      {mutate.error && <ErrorBlock message={mutate.error.message} />}
      {(query.isPending || (editor && editing === undefined && !error && !editorMissing)) && (
        <LoadingBlock label={tr("Loading %s...", String(spec.label.toLowerCase()))} />
      )}
      {!editor && (query.data?.length ?? 0) > 5 && (
        <div className="field">
          <label htmlFor={`${prefix}-search`}>
            {tr("Search")} {spec.label.toLowerCase()}
          </label>
          <input
            id={`${prefix}-search`}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
      {!editor && query.isSuccess && rows.length === 0 && (
        <p className="empty-state">
          {tr("No")} {spec.label.toLowerCase()} {tr("to show. Use Add")} {spec.singular}{" "}
          {tr("to create one.")}
        </p>
      )}
      {!editor ? (
        <ul className="product-list">
          {rows.map((row) => (
            <li key={row.id} className="product-row management-row">
              <div>
                {pictureGroup && row.picture_file_name ? (
                  <EntityPictureDetails
                    group={pictureGroup}
                    name={row.picture_file_name}
                    label={tr("%s picture", String(row.name ?? spec.singular))}
                  />
                ) : null}
                {detail ? (
                  detail(row)
                ) : (
                  <>
                    <h3>{row.name ?? row.note ?? row.barcode ?? `#${row.id}`}</h3>
                    {row.description ? (
                      richEntity ? (
                        descriptionHtml.get(row.id) ? (
                          <RichText html={descriptionHtml.get(row.id)!} />
                        ) : null
                      ) : (
                        <p>{row.description}</p>
                      )
                    ) : null}
                    <p className="muted">
                      {spec.fields
                        .filter(
                          (f) =>
                            f.ref ||
                            f.type === "number" ||
                            f.type === "date" ||
                            f.type === "datetime-local",
                        )
                        .flatMap((f) =>
                          row[f.key] == null
                            ? []
                            : [
                                `${f.label}: ${f.ref ? (options[refs.indexOf(f.ref)]?.data?.find((r) => r.id === row[f.key])?.name ?? row[f.key]) : row[f.key]}`,
                              ],
                        )
                        .join("; ")}
                    </p>
                  </>
                )}
              </div>
              <div className="actions">
                {actions?.(row)}
                <button
                  className="btn btn-ghost"
                  disabled={mutate.isPending || !ready}
                  onClick={() => start(row)}
                >
                  {tr("Edit")}
                  <span className="sr-only"> {row.name ?? row.id}</span>
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={mutate.isPending}
                  onClick={() =>
                    deleteId === row.id
                      ? mutate.mutate({ kind: "delete", id: row.id })
                      : setDeleteId(row.id)
                  }
                >
                  {deleteId === row.id ? tr("Confirm delete") : tr("Delete")}
                  <span className="sr-only"> {row.name ?? row.id}</span>
                </button>
                {deleteId === row.id && (
                  <button className="btn btn-ghost" onClick={() => setDeleteId(null)}>
                    {tr("Cancel delete")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
