import { useI18n } from "@/lib/i18n";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EntityManager } from "@/components/EntityManager";
import { ErrorBlock } from "@/components/ErrorBlock";
import { EquipmentManual } from "@/components/EquipmentManual";
import { FullscreenCard, FullscreenToggle } from "@/components/FullscreenCard";
import { RichDescription } from "@/components/RichDescription";
import { PageHeader } from "@/components/PageHeader";
import { api, downloadFile, filePath, request } from "@/lib/api";

export const Route = createFileRoute("/equipment")({
  component: EquipmentPage,
});

function EquipmentPage() {
  const { t: tr } = useI18n();

  const client = useQueryClient();
  const [equipmentId, setEquipmentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selectedView = useRef<HTMLElement>(null);

  useEffect(() => {
    if (selectedId === null) return;
    selectedView.current?.scrollIntoView({ block: "start" });
    selectedView.current?.focus({ preventScroll: true });
  }, [selectedId]);

  const query = useQuery({
    queryKey: ["objects", "equipment"],
    queryFn: () => api.objects("equipment"),
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!file || !equipmentId) throw new Error(tr("Select equipment and a file."));
      const filename = `${equipmentId}-${file.name}`;
      await request(filePath("equipmentmanuals", filename), {
        method: "PUT",
        body: file,
      });
      await api.updateObject("equipment", Number(equipmentId), {
        instruction_manual_file_name: filename,
      });
    },
    onSuccess: async () => {
      await client.invalidateQueries();
    },
  });

  const download = useMutation({
    mutationFn: (name: string) => downloadFile("equipmentmanuals", name, "equipment"),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    upload.mutate();
  };

  const selected = query.data?.find((row) => row.id === selectedId);

  return (
    <>
      <h1 className="page-title">{tr("Equipment")}</h1>
      <p className="page-lead">{tr("Keep equipment records and instruction manuals together.")}</p>
      {selected ? (
        <section
          ref={selectedView}
          key={selected.id}
          className="equipment-detail"
          aria-label={selected.name}
          tabIndex={-1}
        >
          <FullscreenCard label={selected.name ?? tr("Equipment")}>
            <PageHeader title={selected.name ?? tr("Equipment")} actions={<FullscreenToggle />} />
            <RichDescription entity="equipment" objectId={selected.id} />
          </FullscreenCard>
          {selected.instruction_manual_file_name ? (
            <FullscreenCard label={tr("Instruction manual")}>
              <PageHeader
                title={tr("Instruction manual")}
                actions={
                  <>
                    <FullscreenToggle />
                    <button
                      className="btn btn-ghost"
                      disabled={download.isPending}
                      onClick={() => download.mutate(selected.instruction_manual_file_name!)}
                    >
                      {tr("Download manual")}
                    </button>
                  </>
                }
              />
              <EquipmentManual
                name={selected.instruction_manual_file_name}
                label={tr("Instruction manual")}
              />
            </FullscreenCard>
          ) : null}
        </section>
      ) : null}
      <EntityManager
        entity="equipment"
        detail={(row) => <h3>{row.name}</h3>}
        actions={(row) => (
          <>
            <button className="btn btn-ghost" onClick={() => setSelectedId(row.id)}>
              {tr("View")} {row.name}
            </button>
            {row.instruction_manual_file_name ? (
              <button
                className="btn btn-ghost"
                disabled={download.isPending}
                onClick={() => download.mutate(row.instruction_manual_file_name ?? "")}
              >
                {tr("Download manual")}
              </button>
            ) : null}
          </>
        )}
      />
      <form className="panel panel-inner" onSubmit={submit}>
        <h2>{tr("Attach a manual")}</h2>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="manual-equipment">{tr("Equipment")}</label>
            <select
              id="manual-equipment"
              required
              value={equipmentId}
              onChange={(e) => setEquipmentId(e.target.value)}
            >
              <option value="">{tr("Select equipment")}</option>
              {query.data?.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="manual-file">{tr("Manual file")}</label>
            <input
              id="manual-file"
              type="file"
              accept=".pdf,application/pdf"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        <button className="btn btn-primary" disabled={upload.isPending}>
          {tr("Upload manual")}
        </button>
        {upload.isSuccess && <p role="status">{tr("Manual saved.")}</p>}
        {(upload.error || download.error) && (
          <ErrorBlock message={(upload.error || download.error)!.message} />
        )}
      </form>
    </>
  );
}
