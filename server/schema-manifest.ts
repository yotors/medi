// Immutable SQL inventory. Historical hashes validated against reviewed source before adoption.
export const schemaManifest = [
  {
    version: 1,
    file: '001_registration.sql',
    sha256: '1f3c01a96ca4eddca34e43206216ca9e56c2e99f02ddfd9973c8868b16484e44',
  },
  {
    version: 2,
    file: '002_outpatient.sql',
    sha256: 'fabeec3605556c4c7772b774ffaabf384e4af3814c796aac6b544fd6a3f2997b',
  },
  {
    version: 3,
    file: '003_outpatient_integrity.sql',
    sha256: '2ea0184218cd966f76e3c03d452c4b1d87432ff9ac95038d72d1de50cddabc7b',
  },
  {
    version: 4,
    file: '004_staff_administration.sql',
    sha256: '05d6e7f1b23b2606bcd99b629b2e8abf2dcc9a6cca54593e3d13f997a1601a50',
  },
  {
    version: 5,
    file: '005_hospital_configuration.sql',
    sha256: '7eecbdda849d643b78ec4ad197e2f377f2921e81c16b31c306a1f8f6a040117a',
  },
  {
    version: 6,
    file: '006_configuration_indexes.sql',
    sha256: '07b06a15a84dc226a78ae1ddc1492ed6cbf6f76e2e6758b8bed2bb186aa9f477',
  },
  {
    version: 7,
    file: '007_outpatient_billing.sql',
    sha256: '052e2cd146abc45371f75e2a784144d4a2cb97c281b6ea94507141a9c44624d6',
  },
  {
    version: 8,
    file: '008_clinical_corrections.sql',
    sha256: '91c3e8dddc6b781c98302dbadc65150b6871e47d6eb02972ca44734d13975d3e',
  },
  {
    version: 9,
    file: '009_pharmacy_inventory.sql',
    sha256: '27bbc2ea84900da213e5816db1f73ce9848573ae976f8898d1a63cd4d8b41a3b',
  },
  {
    version: 10,
    file: '010_inventory_dispense_integrity.sql',
    sha256: 'eff1afcf652460ea499a1ec40b1a7034548aac9aa9313eea62bfbb3ef7f5087d',
  },
  {
    version: 11,
    file: '011_operational_reports.sql',
    sha256: '1771eecb0cef8a0ef4dd86d35e4ccf664ac6dad16ab24f0ee6f9c91e0e59fa3a',
  },
  {
    version: 12,
    file: '012_staff_mfa.sql',
    sha256: '20d2e049d2a08e41a488e3e0c5c33f6964cd3b48c52183378d60200081f45e83',
  },
  {
    version: 13,
    file: '013_session_families.sql',
    sha256: '16b85d12181ddc17d65794fcfd8f7f1dc153fb0ba42f554ac04e586fb33d36c8',
  },
  {
    version: 14,
    file: '014_mfa_rejections.sql',
    sha256: 'df858d864bdd7cd77e6a32e20ad602a677ef96eb6442b229150b1b6386e57bce',
  },
  {
    version: 15,
    file: '015_operations.sql',
    sha256: '060d99da9a550e1156dfcc71d431720c21318296f85f9d2b6ce1c706e905c52e',
  },
  {
    version: 16,
    file: '016_care.sql',
    sha256: '17195d5eea1c1e37ab68b615ab72fa520faf8c60b1d9be661a69102fb74c2408',
  },
  {
    version: 17,
    file: '017_departments.sql',
    sha256: 'c774fef7cf0f077f503f12c7843cfe61aa32c74ca80dea66cdf890917e79fa89',
  },
  {
    version: 18,
    file: '018_hospital_governance.sql',
    sha256: '6cbece9087a6a2a1681e31d02f13b9007dfae44978533722c501046d88402697',
  },
  {
    version: 19,
    file: '019_current_identity.sql',
    sha256: '76ac531857ea0c0a53a9eb6ce3af1659f3b8a66d20266224268547e8e1ec75ed',
  },
] as const;
