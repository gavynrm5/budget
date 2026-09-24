import { useUI } from "../store/ui";
import { Sheet } from "./ui";

export function ConfirmDialog() {
  const { confirmState } = useUI();
  if (!confirmState) return null;
  const { title, message, confirmLabel, resolve } = confirmState;
  return (
    <Sheet
      title={title}
      onClose={() => resolve(false)}
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-outline" onClick={() => resolve(false)} data-autofocus>
            Cancel
          </button>
          <button className="btn-danger" onClick={() => resolve(true)}>
            {confirmLabel}
          </button>
        </div>
      }
    >
      <p className="text-muted">{message}</p>
    </Sheet>
  );
}
