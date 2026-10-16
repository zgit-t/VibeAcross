import type { ReactNode } from "react";
import { t } from "../../i18n/translate";
import { Button } from "./Button";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}

/** 通用确认弹窗，用于删除等需要二次确认的操作。 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = t("common.confirm"),
  cancelLabel = t("common.cancel"),
  tone = "primary",
  busy = false,
  onConfirm,
  onClose,
  children,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      size="sm"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? t("common.processing") : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
