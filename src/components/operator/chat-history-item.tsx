import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";

export function ChatHistoryItem({
  title,
  active,
  disabled,
  onSelect,
  onRename,
  pinned = false,
  onTogglePin,
  onDelete,
}: {
  title: string;
  pinned?: boolean;
  onTogglePin?: () => void;
  onDelete?: () => void | Promise<void>;
  detail?: string;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
  onRename?: (title: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const row = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setMenu(false);
    setEditing(false);
    setConfirmDelete(false);
    setDeleteError("");
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!menu && !editing && !confirmDelete) return;
    row.current
      ?.querySelector<HTMLInputElement | HTMLButtonElement>(confirmDelete ? ".ar-history-delete-cancel" : editing ? "input" : '[role="menuitem"]')
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (!row.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menu, editing, confirmDelete]);
  const requestDelete = () => {
    setMenu(false);
    setEditing(false);
    setDeleteError("");
    setConfirmDelete(true);
  };
  const rename = () => {
    setDraft(title);
    setMenu(false);
    setEditing(true);
  };
  return (
    <div
      ref={row}
      className={`ar-history-row${active ? " active" : ""}${pinned ? " is-pinned" : ""}`}
      onContextMenu={(event) => {
        if (!disabled && !deleting) {
          event.preventDefault();
          setMenu(true);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          if (!deleting) close();
        }
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          if (!disabled && !deleting) {
            event.preventDefault();
            setMenu(true);
          }
        }
      }}
    >
      <button
        className="ar-history-select"
        disabled={disabled || deleting}
        onClick={onSelect}
        title={pinned ? `Pinned: ${title}` : title}
        aria-current={active ? "page" : undefined}
      >
        {pinned && <Pin size={12} className="ar-history-pin" aria-hidden="true" />}
        <span>
          <strong>{title}</strong>
        </span>
      </button>
      {onDelete && <button type="button" className="ar-history-delete-trigger" disabled={disabled || deleting}
        aria-label={`Delete ${title}`} title="Delete chat" onClick={requestDelete}><Trash2 size={15} /></button>}
      <button
        ref={trigger}
        className="ar-history-menu-trigger"
        disabled={disabled || deleting}
        aria-label={`Options for ${title}`}
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu(!menu)}
      >
        <MoreHorizontal size={16} />
      </button>
      {menu && (
        <div role="menu" aria-label={`Actions for ${title}`} className="ar-history-menu">
          {onTogglePin && <button type="button" role="menuitem" onClick={() => { onTogglePin(); close(); }}>
            {pinned ? <PinOff size={13} /> : <Pin size={13} />} {pinned ? "Unpin chat" : "Pin chat"}
          </button>}
          {onRename && <button type="button" role="menuitem" onClick={rename}>
            <Pencil size={13} /> Rename chat
          </button>}
          {onDelete && <button type="button" role="menuitem" className="ar-history-delete-option" onClick={requestDelete}>
            <Trash2 size={13} /> Delete chat
          </button>}
        </div>
      )}
      {editing && (
        <form
          className="ar-history-rename"
          onSubmit={(event) => {
            event.preventDefault();
            const next = draft.trim();
            if (next) {
              onRename?.(next);
              close();
            }
          }}
        >
          <label>
            Chat title
            <input
              aria-label="Chat title"
              value={draft}
              maxLength={120}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <div>
            <button type="button" onClick={close}>
              Cancel
            </button>
            <button type="submit" disabled={!draft.trim()}>
              Save title
            </button>
          </div>
        </form>
      )}
      {confirmDelete && <div className="ar-history-delete-confirm" role="group" aria-label={`Delete ${title}?`}>
        <p>Delete this chat?</p><small>This removes its messages and draft.</small>
        {deleteError && <p role="alert">{deleteError}</p>}
        <div><button type="button" className="ar-history-delete-cancel" disabled={deleting} onClick={close}>Cancel</button>
          <button type="button" className="ar-history-delete-option" disabled={deleting || disabled} onClick={async () => {
            setDeleting(true);
            try { await onDelete?.(); close(); } catch (error) { setDeleteError((error as Error).message || "Could not delete this chat. Try again."); }
            finally { setDeleting(false); }
          }}>{deleting ? "Deleting…" : "Delete chat"}</button></div>
      </div>}
    </div>
  );
}
