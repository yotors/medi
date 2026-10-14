export type HospitalAppearance = {
  locale: 'en-ET' | 'am-ET';
  calendar: 'gregory' | 'ethiopic';
  timezone: 'Africa/Addis_Ababa';
};
export function formatHospitalDate(value: string, settings: Partial<HospitalAppearance> = {}) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(settings.locale ?? 'en-ET', {
    calendar: settings.calendar ?? 'gregory',
    timeZone: 'Africa/Addis_Ababa',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
