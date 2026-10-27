# Face-matching identity check: Italy / Garante checklist (DRAFT)

Not legal advice. This lists what to settle **before a real provider that matches faces is switched on**. Everything marked **[CONFIRM]** is a question for a lawyer who knows Italian data-protection practice.

## What the product does today
- Two kinds of identity check, chosen by the person: **document + selfie (face match)** and **document only**.
- Only the **outcome** reaches us (verified or not, a validity date, a reason code for refusals, the kind of check). We never receive, store or show documents, selfies or face data.
- The face-match option needs an explicit, recorded consent tick before anything starts; the consent time is stored and written to the audit log.
- With the document-only option no selfie is taken and nothing biometric is used.
- A rejected person can retry (5 a day); staff can reset or overturn a rejection. An "under 18" result can only be reopened by an admin.
- Verification is valid for 1 year, then asked again.
- A real provider, **Persona**, is connected (27 October 2026) and is being tried in its **sandbox**; a manual and a local simulated provider also exist. No real faces are processed anywhere yet.
- Once we hold the outcome, our code asks Persona to **redact the inquiry** (its ID images, selfie, name and birth date are deleted).
- A "verified" outcome counts as adult only when the provider's message shows a birth date of 18 or over (or the template itself refuses under-18s); an approval with no age information is refused and logged.
- The document-only route needs its own provider template with **no selfie step**; it is made separately from the face template.

## Questions to settle (with the reasons they matter)
1. **Is a face match for this purpose allowed at all?** Biometric data used to identify a person is special-category data (Art. 9). Italian law adds conditions (the Privacy Code and the Garante's guidance on biometric systems). Does "making sure people who meet in person are real adults" fit an Art. 9(2) condition? **[CONFIRM]**
2. **Is the consent valid?** It must be explicit, specific, informed and freely given. A free choice needs a real alternative that is not worse in a way that pressures people. The document-only path is that alternative; is it enough, including if it takes longer? **[CONFIRM]**
3. **Is the provider a processor (acting on our instructions) or an independent controller?** Many identity vendors say they are controllers for their own fraud checks. That changes who needs a contract, who answers requests, and what we may tell users. **[CONFIRM per provider]**
4. **Data-processing agreement** with the provider: purpose limits, sub-processors, EU hosting, deletion after the decision, breach notice times, audit rights.
5. **Retention at the provider.** We ask the provider to erase after each decision (the code does this). Confirm what they actually keep, and for how long, in writing.
6. **Transfers outside the EU** (provider, its sub-processors, push, email, SMS): which safeguards (adequacy decision, standard clauses) apply.
7. **DPIA** (see dpia-draft.md): completed and signed **before** launch. Is prior consultation with the Garante (Art. 36) needed? **[CONFIRM]**
8. **Appeal route.** An automated "under 18" or "not genuine" result affects access to the service. Is a stated human-review path (and a published response time) required under Art. 22 safeguards? **[CONFIRM]** The product has staff review but no in-app appeal.
9. **Information to give people** at the moment of choice: what is checked, by whom, where it is processed, how long, their rights. Draft text is in privacy-policy-draft.md and must appear on the verification screen too.
10. **Minors and the age check.** What level of assurance does the provider's age check reach, and is that enough for the platform's risk? **[CONFIRM]**
11. **Notification of the DPO / authority** if required for this processing in Italy. **[CONFIRM]**

## Italy notes, from research on 27 October 2026 **[CONFIRM every point with an Italian privacy lawyer]**
1. **Consent may not count as free.** In a 2026 decision about an online university's biometric presence check (Garante, 29 January 2026, no. 35), consent was held invalid because students could not use the course without giving it (an imbalance between the person and the organisation). Our service is similar: identity verification is needed to join, host or chat. So the face match must stay **optional with a genuinely equal non-biometric route**, and the lawyer should say which lawful basis supports each route.
2. **No central store of face templates.** The Garante, applying the EDPB's Opinion 11/2024 (airport decision of 12 March 2026), treats keeping biometric templates centrally to compare people against a database as unlawful. We keep none, and the provider must delete templates after the check and must not reuse them to train its systems. Put that in the data processing agreement.
3. **Privacy Code, Art. 2-septies:** biometric data may only be processed under the safeguards the Garante sets; breaking them can also be a criminal offence (Art. 167). Check which safeguards currently apply to this use.
4. **DPIA** is required before launch, and with thousands of users processing special-category data the question of appointing a **DPO** should be answered in writing.
5. **EU AI Act:** Italy's adapting decree was approved on 4 August 2026 and mostly concerns police use of biometrics. One-to-one identity verification is normally treated differently from identification, but ask the lawyer to confirm.
6. **SPID and CIE** (Italy's official digital identities) give a verified real identity and age with **no biometric data collected by us**. They are reached through an accredited intermediary (an "aggregator") and charged per user; the technical and contractual rules are AgID's and must be read from AgID. Only people with an Italian SPID or CIE can use them, so this can be a third route beside the document check and the optional face match, not the only one.

## Provider shortlist (27 October 2026)
- **Veriff** (Tallinn): tried first; its trial account check did not go through (it requires a registered company, website and company-domain email). Retry when those exist.
- **Persona** (US company with an EU data centre option; SOC 2 Type II and ISO 27001 stated by the vendor): sandbox in use. Live access needs Persona's own company check.
- **iDenfy** (EU data storage, an ISO 27001 certificate from a German auditor and a named DPO stated in its documentation): the backup. Sandbox terms to confirm.
- Also seen: Ondato (Europe, sandbox on request), IDnow (Germany, sandbox not confirmed), Sumsub (EU hosting not confirmed), Didit (free tier, but headquarters and data location unclear).
- Prices and trial terms change often; take them from the vendor.

**Questions to put to a provider in writing before signing:**
1. Where are personal and biometric data stored and processed, can we require EU-only storage, and which sub-processors are outside the EU/EEA?
2. How long are the document image, selfie and face template kept; can they be deleted right after the result; are they ever reused to train systems?
3. Is a check without a selfie (document only) a standard workflow?
4. Which Italian documents are supported (identity card, CIE, passport, driving licence, residence permit)?
5. Will you sign an Art. 28 data processing agreement, and share your current ISO 27001 certificate and SOC 2 report?
6. What are your uptime commitment, support hours for Italy, and signed-webhook and sandbox options?
7. What is the price per completed check at our expected volume, and is there a monthly minimum?
8. If you offer an age-validation product: does it use facial age estimation or the ID document, and is it biometric?

## Choosing a provider (practical checks)
- Supports a document-only flow (no selfie) as a separate configuration, so the document-only option is real and not a re-labelled face match.
- Returns a minimal result (we accept only: outcome, reason code, provider reference). Anything else is ignored by our code.
- Signs its webhooks (we verify the signature) and offers a data-erasure call.
- EU data residency; a published sub-processor list; a clear contract.
- A sandbox with test credentials, and the cost per check documented.

## Go-live gate
Do not switch a real face-matching provider on until: questions 1 to 3 are answered in writing, the DPA is signed, the DPIA is signed, the privacy notice and the verification-screen text are live, and the document-only option works with that provider **as an equal, non-biometric route** (see Italy note 1).
