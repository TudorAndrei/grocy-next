import { useI18n } from "@/lib/i18n";
import { useEffect, useId, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import type { IScannerControls } from "@zxing/browser";
import { useFeatures } from "@/lib/features";
import { Icon } from "./Icon";
import { ErrorBlock } from "./ErrorBlock";

async function applyTorch(track: MediaStreamTrack, enabled: boolean) {
  const constraint: MediaTrackConstraintSet & { torch: boolean } = { torch: enabled };
  await track.applyConstraints({ advanced: [constraint] });
}

export function CameraScanner({
  onScan,
  disabled = false,
  open: controlledOpen,
  onOpenChange,
}: {
  onScan: (code: string) => void;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t: tr } = useI18n();

  const features = useFeatures();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const close = useCallback(() => setOpen(false), [setOpen]);

  if (!features.query.data || features.enabled("DISABLE_BROWSER_BARCODE_CAMERA_SCANNING"))
    return null;

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Icon name="camera" /> {tr("Scan with camera")}
      </button>
      {open
        ? createPortal(
            <CameraDialog
              onScan={onScan}
              onClose={close}
              autoTorch={features.enabled("AUTO_TORCH_ON_WITH_CAMERA")}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function CameraDialog({
  onScan,
  onClose,
  autoTorch,
}: {
  onScan: (code: string) => void;
  onClose: () => void;
  autoTorch: boolean;
}) {
  const { t: tr } = useI18n();

  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef(document.activeElement);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const resultRef = useRef(onScan);
  const titleId = useId();
  const cameraSelectId = useId();
  const [cameraId, setCameraId] = useState(() => localStorage.getItem("cameraId") ?? "");
  const [activeCameraId, setActiveCameraId] = useState("");
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [torchError, setTorchError] = useState("");
  const [running, setRunning] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    resultRef.current = onScan;
  }, [onScan]);
  useEffect(() => {
    const dialog = dialogRef.current;
    const returnFocus = returnFocusRef.current;

    if (dialog && !dialog.open) dialog.showModal();

    return () => {
      if (returnFocus instanceof HTMLElement) returnFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    let cancelled = false;
    let stream: MediaStream | undefined;
    let controls: IScannerControls | undefined;

    function stop() {
      cancelled = true;
      controls?.stop();
      stream?.getTracks().forEach((track) => track.stop());

      if (video.srcObject === stream) video.srcObject = null;

      if (trackRef.current && stream?.getVideoTracks().includes(trackRef.current))
        trackRef.current = null;
    }

    async function start() {
      setError("");
      setTorchError("");
      setRunning(false);
      setHasTorch(false);
      setTorchOn(false);

      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);

      if (cancelled) return;

      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(tr("Use HTTPS or localhost and a browser with camera support."));
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: cameraId ? { deviceId: { exact: cameraId } } : { facingMode: "environment" },
      });

      if (cancelled) {
        stop();

        return;
      }

      video.srcObject = stream;

      const reader = new BrowserMultiFormatReader(
        new Map([
          [
            DecodeHintType.POSSIBLE_FORMATS,
            [
              BarcodeFormat.EAN_8,
              BarcodeFormat.EAN_13,
              BarcodeFormat.CODE_39,
              BarcodeFormat.CODE_128,
              BarcodeFormat.DATA_MATRIX,
              BarcodeFormat.QR_CODE,
            ],
          ],
        ]),
      );

      controls = await reader.decodeFromVideoElement(video, (result, _error, scanControls) => {
        if (!result || cancelled) return;
        scanControls.stop();
        stop();
        resultRef.current(result.getText());
        onClose();
      });

      if (cancelled) {
        controls.stop();

        return;
      }

      const devices = await navigator.mediaDevices.enumerateDevices();

      if (cancelled) return;
      setCameras(devices.filter((device) => device.kind === "videoinput"));
      const track = stream.getVideoTracks()[0];
      trackRef.current = track ?? null;
      setActiveCameraId(track?.getSettings().deviceId ?? cameraId);
      setRunning(true);
      const capabilities = track?.getCapabilities?.();

      const torchAvailable =
        capabilities != null && "torch" in capabilities && capabilities.torch === true;

      setHasTorch(torchAvailable);

      if (track && torchAvailable && autoTorch) {
        try {
          await applyTorch(track, true);

          if (!cancelled) setTorchOn(true);
        } catch {
          if (!cancelled) setTorchError(tr("The camera torch could not be turned on."));
        }
      }
    }

    start().catch((failure: Error) => {
      if (cancelled) return;
      stop();
      localStorage.removeItem("cameraId");
      setRunning(false);
      setError(
        tr(
          "Camera access failed: %s",
          String(failure.message || "Allow camera access and use HTTPS or localhost."),
        ),
      );
    });

    return stop;
  }, [cameraId, attempt, autoTorch, onClose, tr]);

  function toggleTorch() {
    const track = trackRef.current;

    if (!track) return;
    const next = !torchOn;
    setTorchError("");
    applyTorch(track, next)
      .then(() => {
        if (trackRef.current === track) setTorchOn(next);
      })
      .catch(() => {
        if (trackRef.current === track) setTorchError(tr("The camera torch could not be changed."));
      });
  }

  return (
    <dialog
      ref={dialogRef}
      className="camera-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="camera-head">
        <h2 id={titleId}>{tr("Scan a barcode")}</h2>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onClose}
          aria-label={tr("Close camera")}
        >
          <Icon name="close" />
        </button>
      </div>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        hidden={Boolean(error)}
        aria-label={tr("Camera preview")}
      />
      {error ? (
        <>
          <ErrorBlock message={error} />
          <p className="field-hint">{tr("Allow camera access and use HTTPS or localhost.")}</p>
        </>
      ) : (
        <p className="field-hint" role="status">
          {running
            ? tr("Point the camera at a barcode. Scanning stops after the first result.")
            : tr("Starting camera…")}
        </p>
      )}
      {torchError ? <ErrorBlock message={torchError} /> : null}
      {cameras.length > 1 && !error ? (
        <label className="field" htmlFor={cameraSelectId}>
          {tr("Camera")}
          <select
            id={cameraSelectId}
            value={cameraId || activeCameraId}
            onChange={(event) => {
              localStorage.setItem("cameraId", event.target.value);
              setCameraId(event.target.value);
            }}
          >
            {cameras.map((camera, index) => (
              <option key={camera.deviceId} value={camera.deviceId}>
                {camera.label || tr("Camera %s", String(index + 1))}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="actions">
        {hasTorch && running && !error ? (
          <button
            type="button"
            className="btn btn-ghost"
            aria-pressed={torchOn}
            onClick={toggleTorch}
          >
            {torchOn ? tr("Turn torch off") : tr("Turn torch on")}
          </button>
        ) : null}
        {error ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setCameraId("");
              setAttempt((value) => value + 1);
            }}
          >
            {tr("Try camera again")}
          </button>
        ) : null}
      </div>
    </dialog>
  );
}
