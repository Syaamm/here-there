# Face-matching identity check: Italy / Garante checklist (DRAFT)

Not legal advice. This lists what to settle **before a real provider that matches faces is switched on**. Everything marked **[CONFIRM]** is a question for a lawyer who knows Italian data-protection practice.

## What the product does today
- Two kinds of identity check, chosen by the person: **document + selfie (face match)** and **document only**.
- Only the **outcome** reaches us (verified or not, a validity date, a reason code for refusals, the kind of check). We never receive, store or show documents, selfies or face data.
- The face-match option needs an explicit, recorded consent tick before anything starts; the consent time is stored and written to the audit log.
- With the document-only option no selfie is taken and nothing biometric is used.
- A rejected person can retry (5 a day); staff can reset or overturn a rejection. An "under 18" result can only be reopened by an admin.
- Verification is valid for 1 year, then asked again.
- Right now only a **sandbox and a manual provider** exist. No real faces are processed anywhere.

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

## Choosing a provider (practical checks)
- Supports a document-only flow (no selfie) as a separate configuration, so the document-only option is real and not a re-labelled face match.
- Returns a minimal result (we accept only: outcome, reason code, provider reference). Anything else is ignored by our code.
- Signs its webhooks (we verify the signature) and offers a data-erasure call.
- EU data residency; a published sub-processor list; a clear contract.
- A sandbox with test credentials, and the cost per check documented.

## Go-live gate
Do not switch a real face-matching provider on until: questions 1 to 3 are answered in writing, the DPA is signed, the DPIA is signed, the privacy notice and the verification-screen text are live, and the document-only option works with that provider.
