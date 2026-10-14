// Addis Ababa uses UTC+03:00 throughout the year. Clinical controls use Gregorian dates.
export const careTimeZone = 'Africa/Addis_Ababa';
export const hasTimeOffset = (value: string) => /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
export function displayCareTime(value: string) {
  return new Date(value).toLocaleString('en-GB', {
    timeZone: careTimeZone,
    calendar: 'gregory',
    timeZoneName: 'short',
  });
}
export function careTimeInput(value: unknown) {
  if (!value) return '';
  const date = new Date(String(value));
  return new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
export function careTimePayload(value: string) {
  // An untouched persisted timestamp retains its offset, seconds and precision.
  if (hasTimeOffset(value)) return value;
  return new Date(`${value}${value.length === 16 ? ':00' : ''}+03:00`).toISOString();
}
