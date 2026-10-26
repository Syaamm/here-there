# Moderation policy (DRAFT for approval)

How reports, warnings and appeals are handled. The numbers below are the ones the software uses today (one place in code: `services/api/src/moderation/moderation.controller.ts`). **The owner should approve or change them [CONFIRM].** The same text is served to the app at `GET /v1/reports/policy`.

## Emergencies
- Reports are **not** an emergency service. Every report screen shows "In immediate danger? Call 112" with a call button, and the confirmation after a report repeats it.
- The report reason "Someone is in danger right now" is **urgent**: every active moderator, trust lead and administrator is alerted at once, in or out of coverage hours.

## Coverage and answer times
| | |
|---|---|
| Coverage hours | Every day, 08:00 to 22:00, Milan time **[CONFIRM]** |
| Urgent reports (immediate danger, physical safety) | Looked at first; answer within 1 hour **[CONFIRM]** |
| All other reports | Answer within 24 hours **[CONFIRM]** |
| Outside coverage hours | Only urgent reports alert staff. Others wait for the next coverage period (their clock keeps running) |

## Escalation
A report still open after its answer time is **escalated once**: every trust lead and administrator is told, the queue marks it "escalated", and an audit entry is written. The queue is always ordered: urgent first, then escalated or overdue, then under-18 concerns, then oldest first. The queue page shows per-moderator workload (assigned, overdue, oldest, resolved in 7 days) and how many reports nobody has taken.

## What a moderator can do
- Hide a reported message (kept for the record; the sender is told why), or put it back.
- Send a **formal warning** (the person is told; it counts toward the repeat-offender flag; kept as long as the audit log).
- Suspend or restore an account, remove a listing, require a new identity check, resolve or dismiss a report.
- Every action writes an audit entry.

## Repeat-offender flag
A person is flagged on the queue when any of these is true: 2 or more warnings in the last 6 months, reported by 3 or more different people in 90 days, or suspended before. The flag is a prompt to look closer, not a decision **[CONFIRM thresholds]**.

## Appeals
A person can ask for a second look, once per decision, at: a rejected identity check, a suspension, a listing staff removed, a **warning**, a **message a moderator hid**, and (for the person who reported) a **dismissed report**. A different moderator decides (the one who made the decision cannot review it; an administrator can). The person is always told the outcome with a note. Accepting undoes the decision: verified again, account restored, listing or message put back, warning withdrawn, report reopened and unassigned.

## Blocking
Blocking is two-way: neither person sees the other's messages in a shared group chat or the other in the member list, gets alerts from them, or can follow or match with them.
