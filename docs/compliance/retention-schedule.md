# Retention schedule (DRAFT for approval)

These are the periods the clean-up job uses today. The job runs once a day (and can be run on demand), deletes what has passed its period, and records a summary in the audit log. The same periods are published to users at `GET /v1/retention`, so the text in the app can never disagree with what the job does. **The owner/DPO should approve or change the numbers [CONFIRM].** To change one, set its variable (a number of days) and restart the API.

| Data | Period | Counted from | Variable (default) | Notes |
|---|---|---|---|---|
| Group chat messages | 90 days | the end of the plan or trip | `RETENTION_CHAT_DAYS` (90) | A message that a safety report points at is kept until the report is closed and has itself aged out |
| Alerts, read | 90 days | when read | `RETENTION_ALERTS_READ_DAYS` (90) | |
| Alerts, never read | 365 days | when created | `RETENTION_ALERTS_UNREAD_DAYS` (365) | |
| Safety reports, closed | 730 days | when closed | `RETENTION_REPORTS_DAYS` (730) | Open and in-review reports are never deleted by the job |
| Audit log | 730 days | the event | `RETENTION_AUDIT_DAYS` (730) | Holds ids and action names, not message text |
| Identity-check history | 365 days | the decision | `RETENTION_IDENTITY_CHECKS_DAYS` (365) | A person's newest check is always kept, because their status rests on it. Never holds documents or faces |
| Travel matching wishes and yes / pass answers | 90 days | the last change (a wish also ends when its dates pass) | `RETENTION_MATCHING_DAYS` (90) | Private to the person |
| Messages in a private travel-match chat | 90 days | when each message was sent | `RETENTION_MATCHING_DAYS` (90) | A message a report points at is kept until the report ages out |
| Drafts (activities and trips saved for later) | 90 days | the last change | `RETENTION_DRAFTS_DAYS` (90) | Private to the person; deleted with the account |
| Appeals, decided | 730 days | the decision | `RETENTION_APPEALS_DAYS` (730) | Open appeals are never deleted by the job |
| No-show notes and the history of reliability level changes | 730 days | the end of the plan / the change | `RETENTION_RELIABILITY_DAYS` (730) | A disputed note is kept until a moderator decides it. The level itself is worked out from the events that remain, so it fades the same way |
| Sign-in and confirmation codes | 7 days | when used or expired | `RETENTION_CODES_DAYS` (7) | |
| Plans, trips, memberships | kept as history | | | Other people's records depend on them; a deleted person shows as "Deleted user" |
| Account details | until deletion | | | Erased immediately when the person deletes the account |
| Ban fingerprints (hashes of email, number, device) | until the ban is lifted | | | **[CONFIRM]** whether a maximum period (for example 2 years) is needed |
| Deleted-account placeholder row | indefinitely | | | Holds no personal data (a made-up email, the name "Deleted user", state "deleted"). Needed so other people's chats and plans stay intact |
| Backups | not applicable yet | | | When backups exist, deletions must age out of them within a stated time **[CONFIRM]** |

## Turning the job off (for investigation or a legal hold)
Set `RETENTION_ENABLED=false`. A legal hold on one person's data is not built (it would need a flag on the account); add it if a hold is ever needed.
