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

## When nobody answers, and who is on call
The full plan, including the questions the owner must answer, is in `oncall-process.md`. In short, for an **urgent** report: at 0 minutes the people on the rota are paged (push, email, text; out of coverage hours this includes physical-safety reports); at **1 hour** with nobody having taken it, trust leads, administrators and the rota are paged again and **the person who reported is told we have not answered yet and reminded to call 112**; at **2 hours** with nobody having taken it, every administrator and the owner contact are paged, marked critical. Each step happens once. A normal report goes up once, at 24 hours, to the senior staff in the app only.

## The queue order
Waiting reports are ordered: urgent first (the more steps it has gone up, the higher), then reports past their answer time (the longest-waiting first), then under-18 concerns, then the rest by when they are due. Finished reports come last. The whole queue is read, so a long queue can never hide a newer urgent report.

## "The host did not show up"
A member of a plan can say the host never came, from 30 minutes after the start until 72 hours after the end. It is an ordinary report that a moderator decides, with the plan's own records shown beside it (how many members say it, whether the host wrote in the chat during the plan, who marked themselves as attended, whether the host also marked the person who reported them, earlier confirmed absences). **Confirming it** counts against the host's reliability like any upheld report, and cancels the notes the host made about members for that plan (nobody is marked absent from a plan the host did not come to). A dismissed report changes nothing. **[CONFIRM]** the 30-minute wait and the 72-hour window.

## Hosts who say many people did not come
When, in 90 days, a host has made 4 or more notes and either those cover half or more of the people they hosted, or at least 2 of their decided notes were overturned and half or more of those decided were overturned, the moderators are told (once a month per host) and the host's notes show an "unusual" mark in the console. **Nothing happens to the host automatically**: the mark is a prompt to read those notes with care. **[CONFIRM]** the thresholds (4 notes, half, 2 decided).

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
