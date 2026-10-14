import auth from './auth.json';
import billing from './billing.json';
import care from './care.json';
import choices from './choices.json';
import common from './common.json';
import configuration from './configuration.json';
import departments from './departments.json';
import dynamic from './dynamic.json';
import errors from './errors.json';
import home from './home.json';
import inventory from './inventory.json';
import labels from './labels.json';
import language from './language.json';
import mfa from './mfa.json';
import navigation from './navigation.json';
import publicCatalog from './public.json';
import reports from './reports.json';
const catalogs = {
  auth,
  billing,
  care,
  choices,
  common,
  configuration,
  departments,
  dynamic,
  errors,
  home,
  inventory,
  labels,
  language,
  mfa,
  navigation,
  public: publicCatalog,
  reports,
};
export default catalogs;
