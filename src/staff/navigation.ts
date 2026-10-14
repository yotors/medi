import type { StaffRole } from '../../shared/registration';
import { careKinds, canReadCare } from '../../shared/care';
import { reportSections } from '../../shared/reports';
export type Surface =
  | 'home'
  | 'patients'
  | 'visits'
  | 'staff'
  | 'password'
  | 'configuration'
  | 'inventory'
  | 'reports'
  | 'mfa'
  | 'care'
  | 'departments'
  | 'hospital';
export type Destination = { id: Surface; group: 'work' | 'management' | 'account'; label: string };
export function destinations(role: StaffRole): Destination[] {
  return [
    { id: 'home', group: 'work', label: 'navigation:home' },
    { id: 'patients', group: 'work', label: 'navigation:patients' },
    { id: 'visits', group: 'work', label: 'navigation:visits' },
    ...(careKinds.some((kind) => canReadCare(role, kind))
      ? [{ id: 'care' as const, group: 'work' as const, label: 'navigation:care' }]
      : []),
    ...(['admin', 'lab', 'clinician', 'pharmacist', 'cashier', 'auditor'].includes(role)
      ? [{ id: 'departments' as const, group: 'work' as const, label: 'navigation:departments' }]
      : []),
    {
      id: 'configuration',
      group: 'management',
      label: role === 'admin' ? 'navigation:configuration' : 'navigation:catalog',
    },
    ...(['admin', 'pharmacist', 'auditor'].includes(role)
      ? [{ id: 'inventory' as const, group: 'management' as const, label: 'navigation:inventory' }]
      : []),
    ...(reportSections[role].length
      ? [{ id: 'reports' as const, group: 'management' as const, label: 'navigation:reports' }]
      : []),
    ...(['admin', 'auditor'].includes(role)
      ? [{ id: 'hospital' as const, group: 'management' as const, label: 'navigation:hospital' }]
      : []),
    ...(role === 'admin'
      ? [{ id: 'staff' as const, group: 'management' as const, label: 'navigation:staff' }]
      : []),
    { id: 'mfa', group: 'account', label: 'navigation:mfa' },
    { id: 'password', group: 'account', label: 'navigation:password' },
  ];
}
export function routeSurface(path: string): Surface | null {
  if (path === '/staff' || path === '/staff/') return 'home';
  const id = path.replace(/^\/staff\//, '');
  return [
    'home',
    'patients',
    'visits',
    'staff',
    'password',
    'configuration',
    'inventory',
    'reports',
    'mfa',
    'care',
    'departments',
    'hospital',
  ].includes(id)
    ? (id as Surface)
    : null;
}
export function surfacePath(id: Surface) {
  return id === 'home' ? '/staff' : `/staff/${id}`;
}

/** Leave browser-native new-tab/window gestures intact; they do not discard this page. */
export function isPlainLinkClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.defaultPrevented
  );
}
