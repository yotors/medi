import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
export function PreferenceMenu({
  label,
  icon,
  children,
  disabled = false,
  triggerLabel,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  triggerLabel?: string;
}) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className="preference-trigger" aria-label={triggerLabel} disabled={disabled}>
        {icon}
        <span>{label}</span>
        <ChevronDown size={15} aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <section aria-label={label}>
          <Menu.Content
            aria-label={triggerLabel ?? label}
            className="preference-menu"
            sideOffset={6}
            align="end"
            collisionPadding={12}
          >
            {children}
          </Menu.Content>
        </section>
      </Menu.Portal>
    </Menu.Root>
  );
}
export function PreferenceOption({ value, children }: { value: string; children: ReactNode }) {
  return (
    <Menu.RadioItem className="preference-option" value={value}>
      <span className="preference-check">
        <Menu.ItemIndicator>
          <Check size={16} aria-hidden />
        </Menu.ItemIndicator>
      </span>
      {children}
    </Menu.RadioItem>
  );
}
export { Menu };
