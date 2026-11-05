# 0042 — Notifications: morning and 17:00, by each learner's clock, and chosen by them

**Status:** Accepted (the owner's decisions, 4 November 2026). Replaces the schedule of ADR 0031.

## Decision
- **At most two a day, by the learner's own clock.** The server works in UTC and turns it into each learner's local time on
  every run, so daylight saving and half-hour zones need nothing special. Each is sent once per local date.
- **Morning, 08:00 to before 10:00: one notification** with what the learner chose of: today's promise if not done, their
  group's last result, and decks due today.
- **17:00 to before 20:00: one notification,** only while today is still open.
- **The room to catch up** is because a free scheduler runs late. A window missed entirely sends nothing later.
- **Counts only, never names:** a lock screen can be read by anyone. The count of who is ready goes only to those with
  `see_standings` (ADR 0040), so nobody learns more than the group's page shows them.
- **The daily report is the group's last *finished* day, in the group's zone** (ADR 0039), so it never shows a day under way.
  If that isn't the reader's own yesterday, it names the date.
- **The deadline report comes at 08:00 on the deck's date,** before the class: «вы готовы» or «осталось 6 слов».
- **A learner with no known zone gets nothing,** rather than something at the wrong hour.
- **The zone is saved on every app open and on subscribing,** and only if the browser really sent one. Before this it was saved
  only on some actions, and a missing header could overwrite a real zone with UTC.
- **Four choices, on the account, all on by default,** under a device switch in «Уведомления». A choice off removes its part.
- **First run asks «Присылать напоминания?»,** but only where a yes can lead somewhere. A web app cannot open phone or browser
  settings, so yes means the browser's own popup, which must come straight from the tap; the app asks it before any other waiting.
  If already blocked, or on an iPhone in Safari, one line says what to do, and the learner goes on either way.
- **⚙ is at the top right of every page in the navigation.** «Выйти» sits beside it on the opening page.
- **«Учитель» is not a word the app uses:** teachers are ordinary accounts.

## Consequences
- **Sending has a limit.** Everyone in a zone is due within minutes, on a small server. Measured on 1,000 synthetic students: 25
  queries and about 15 ms of CPU a phone, on an Apple M1. At 0.1 CPU with network, an estimated 0.5–0.7 s a phone, so about 80–100
  in a 50-second run. **With hourly runs, that is about 200 phones in the morning window and 300 at 17:00, all in one zone.** Past
  that, those last in the order get nothing that window, and the run says `finished: false`. More frequent runs in the windows, or
  fewer queries a phone, are the way up. Nothing here has run on a real host.
- Someone who travels and doesn't open the app keeps their old zone until they do.
- Web push has still never been tried on a real iPhone. The home-screen app has separate storage, so students sign in again there.
- A learner in several groups gets only the first group's report, to keep it one line.
