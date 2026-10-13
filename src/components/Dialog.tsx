import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
export function Modal({ open, onClose, title, description, children, wide = false }: { open: boolean; onClose: () => void; title: string; description: string; children: ReactNode; wide?: boolean }) {
  return <Dialog.Root open={open} onOpenChange={v => { if (!v) onClose(); }}><Dialog.Portal><Dialog.Overlay className="overlay" /><Dialog.Content className={`dialog ${wide ? 'drawer' : ''}`} onCloseAutoFocus={e => { const target = document.querySelector<HTMLElement>('[data-return-focus="true"]') ?? document.getElementById('main'); if (target) { e.preventDefault(); target.focus(); } }}><div className="dialog-heading"><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="Close dialog"><X size={20} /></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
