import { formatHospitalDate, type HospitalAppearance } from '../../shared/hospital-format';
export const defaultAppearance: HospitalAppearance = {
  locale: 'en-ET',
  calendar: 'gregory',
  timezone: 'Africa/Addis_Ababa',
};
let appearance = defaultAppearance;
export function configureHospitalDates(settings: HospitalAppearance) {
  appearance = settings;
}
export function hospitalDate(value: string | Date) {
  return formatHospitalDate(value instanceof Date ? value.toISOString() : value, appearance);
}
