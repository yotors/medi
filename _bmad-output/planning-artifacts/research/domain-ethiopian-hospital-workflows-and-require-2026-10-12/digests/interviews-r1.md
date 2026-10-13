# Ethiopian hospital workflows: original-study digest

Accessed: **2026-10-12** throughout. Decision: candidate requirements for reusable software for small private Ethiopian hospitals/medical centers. Six original studies reviewed through eight web calls; no outreach, patient-level data collection, or project-file evidence. Confidence describes the bounded finding, not nationwide prevalence. Requirements below are **inferences requiring facility validation**.

## 1. Private-facility interviews reveal external-service loops

**Claim:** Interviewees recruited after childbirth at three private hospitals described earlier public antenatal visits in which ordered tests or prescribed medicines were unavailable, prompting outside purchases and later self-referral. They also described delays at finance and pharmacy and insufficient medication explanations. These are reported experiences of public care, not observations of the private hospitals’ internal workflows.

**Source:** [Exploring Factors for Self-Referral to Private Hospitals for Childbirth, Dire Dawa, Ethiopia: A Qualitative Study](https://www.sciencepublishinggroup.com/article/10.11648/j.jfmhc.20251101.11). Publisher: Science Publishing Group, *Journal of Family Medicine and Health Care*. Published 2025-03-13; study August–September 2023; accessed 2026-10-12. Setting: Bilal, Delt, and ART private general hospitals; 13 purposively selected interviewees. **Class:** primary qualitative interviews. **Confidence:** moderate for reported experience; low transferability beyond this selected maternity sample.

**Requirement inference:** Preserve orders that cannot be fulfilled internally; record external referral/purchase status separately from completed service. Provide understandable next-step instructions and dispensing counseling records. Do not assume a patient arriving privately has no previous public-facility history.

## 2. Payment confirmation can be a separate laboratory handoff

**Claim:** Direct observation documented this sequence: clinician examination/test order → laboratory result-distribution office for price quotation → cashier → return to distribution office for payment confirmation → specimen queue. Staff sorted patients by specimen type; hospital identifiers were transcribed into logs. This establishes a concrete historical workflow, not an Ethiopian standard.

**Source:** [Evaluation of Hospital Laboratory Workflow Design in Ethiopia: Blood Specimen Collection and Chemistry Laboratory Testing](https://medwinpublishers.com/article/EOIJ/10.23880/eoij-16000179/full). Publisher: Medwin Publishers, *Ergonomics International Journal*. Published 2018-09-17; collection dates not specified; accessed 2026-10-12. Setting: one unnamed Addis Ababa hospital, **ownership unspecified**. **Class:** original observation and staff interviews. **Confidence:** moderate-low: clear process description, old single-site evidence, inconsistent observation-duration wording.

**Requirement inference:** Link order, itemized charge, payment confirmation, specimen collection, and result to the same encounter. Make payment rules configurable; do not hard-code this loop or claim all private facilities require prepayment. Capture specimen status independently of invoice status.

## 3. Outpatient journeys branch across several queues

**Claim:** Researchers followed patients across registration, triage, clinical examination, diagnostics, and pharmacy in three public hospitals. Patients did not all traverse every unit. Delays concentrated in examination, laboratory, and other diagnostic services; the discussion includes waiting for investigations and clinicians to review results. Repeat medication/investigation-only visits were excluded, so that pathway remains unmeasured.

**Source:** [Overall time spent by clients from entry to exit and associated factors in out-patient departments in public hospitals of Jimma Zone southwest, Ethiopia](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0296630). Publisher: PLOS ONE. Published 2024-03-07; study 2018-03-15–2018-05-17; accessed 2026-10-12. Setting: public JUMC, Agaro General, Seka Primary hospitals. **Class:** original time-and-motion observation plus interviews. **Confidence:** moderate for pathway structure; historical, not current wait-time benchmarks.

**Requirement inference:** Use encounter-linked service queues with arrival/start/completion timestamps, optional branches, and a result-review return state. Measure waiting separately from service duration. Avoid one linear “registered → seen → discharged” status.

## 4. Partial digitization leaves cross-department gaps

**Claim:** Interviews and observation at two teaching hospitals describe limited departmental EMR use: central triage could be paperless while pharmacy/laboratory coverage remained incomplete. Respondents reported typing/training difficulties, network/power interruptions, delayed generator startup, and unavailable onsite IT support. Claimed efficiency benefits were perceptions, not demonstrated causal outcomes.

**Source:** [Evaluating the impact of electronic medical records on healthcare digitalization efforts in Oromia, Ethiopia: A qualitative study](https://journals.sagepub.com/doi/10.1177/20552076251379734). Publisher: SAGE, *DIGITAL HEALTH*. Published 2025-09-15; study February 2023–November 2024; accessed 2026-10-12. Setting: public Adama Hospital Medical College and Ambo University Referral Hospital; 29 participants including supporting organizations. **Class:** primary qualitative case study. **Confidence:** moderate; two early-adopter cases, no small-private-hospital validation.

**Requirement inference:** Design explicit paper/digital handoffs, interruption recovery and reconciliation, minimal-entry role screens, practical training, and named support ownership. Test a complete clinical-order-result-pharmacy journey before extending departments.

## 5. Record completeness needs operational ownership

**Claim:** Review of 406 records in three public hospitals found clinical documentation less complete than administrative documentation; interviewees connected quality problems with insufficient regular monitoring.

**Source:** [Quality of medical records in public hospitals of Wolaita Zone, south Ethiopia, 2023: mixed study](https://journals.hu.edu.et/hu-journals/index.php/ejmhs/article/view/1949). Publisher: Hawassa University, *Ethiopian Journal of Medical and Health Sciences*. Published 2025-12-30; study March 1–15, 2023; accessed 2026-10-12. **Class:** primary mixed study; publisher abstract inspected. **Confidence:** moderate-low because full methods were not inspected.

**Requirement inference:** Separate demographic registration completeness from clinical encounter completeness; assign review responsibility and show unfinished records without treating registration as a completed consultation.

## 6. Recent private-hospital evidence supports measuring waiting

**Claim:** In a 2025 comparative survey, shorter initial waiting was associated with satisfaction in the private-hospital sample. Association does not establish software impact.

**Source:** [Client satisfaction and associated factors with the health care services in Central Ethiopia, 2025: facility-based comparative cross-sectional study](https://link.springer.com/article/10.1186/s12889-026-27390-5). Publisher: Springer Nature, *BMC Public Health*. Published 2026-04-14; study April–July 2025; accessed 2026-10-12. Setting: public Butajira General and private Alem General hospitals, Butajira. **Class:** primary patient survey. **Confidence:** moderate-low: one private site; conclusion inconsistently names Addis Ababa although methods specify Butajira.

**Requirement inference:** Baseline initial waiting and follow-up visits at each pilot rather than promising a universal reduction.

## Remaining gaps

Evidence does not settle private-facility registration identifiers, duplicate matching, exact pharmacy payment/dispensing order, deposits/refunds, emergency billing overrides, credit/insurance contracts, stock deductions, shift cash reconciliation, or results acknowledgement. No direct observation of a small private medical center was found. Treat these as discovery questions; public hospitals and public-hospital private wings are not substitutes for private-facility validation.
