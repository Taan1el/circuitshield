import React, { useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useDialog } from '../utils/useDialog.js';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Element that gets focus when the dialog opens. Defaults to the first control. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  wide?: boolean;
}

/**
 * The console's dialog: same markup and classes as the API key and invite
 * dialogs, with focus moved in, Tab kept inside, Escape to close and focus
 * returned to the opener (see useDialog).
 */
export const Dialog: React.FC<DialogProps> = ({ title, onClose, children, footer, initialFocusRef, wide }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialog(true, dialogRef, onClose, initialFocusRef);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className={`dialog-card${wide ? ' dialog-wide' : ''}`}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="dialog-body">
          {children}
          {footer && <div className="dialog-footer">{footer}</div>}
        </div>
      </div>
    </div>
  );
};

interface ConfirmDialogProps {
  title: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Hide the confirm button when the action is not possible, leaving only the explanation. */
  blocked?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: React.ReactNode;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  confirmLabel,
  cancelLabel = 'Cancel',
  blocked,
  busy,
  onConfirm,
  onClose,
  children,
}) => (
  <Dialog
    title={title}
    onClose={onClose}
    footer={
      <>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {blocked ? 'Close' : cancelLabel}
        </button>
        {!blocked && (
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        )}
      </>
    }
  >
    {children}
  </Dialog>
);
