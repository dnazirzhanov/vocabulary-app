# 0031 — Deadline reminders on the phone, by Web Push

**Status:** Accepted.

## Context
A teacher's deadline (ADR 0028) only works if students remember to open the app. The owner chose
phone notifications over e-mail: no outside account, and no students' e-mail addresses stored
(many are minors).

## Decision
- **Web Push**, the browsers' own channel: the phone's push service (Google's for Android Chrome,
  Apple's for iPhone) delivers a notification even with the app closed. The server signs with a
  VAPID key pair it holds; there is no account with any service and nothing to pay.
- **Opt in, per device.** «Напоминания о сроках» under «Аккаунт», and «Напомнить вечером» on a
  deck with a deadline. The browser asks for permission once. iPhones only allow it for an app on
  the home screen, so there the switch explains how to add it. The app now has a manifest, icons
  and a service worker for that; the worker caches nothing.
- **What is sent:** at most one reminder a day, in the learner's evening (18:00–22:00 their time),
  and only when a deck with a deadline still has words for today: «Сегодня 3 слова по «Unit 5»,
  чтобы успеть к 7 ноября». Nothing on other days.
- **Stored:** the push service's address for the device and its two encryption keys, tied to the
  learner; no name or e-mail. Deleted with the account, when turned off, or when the push service
  says the device is gone (a brand-new one gets an hour's grace).
- **Sending:** the free host sleeps, so an outside scheduler calls `POST /api/internal/reminders`
  hourly with a shared secret (docs/deploy.md has a GitHub Actions schedule). `send-reminders` in
  the CLI does the same locally.

## Consequences
- Delivered end to end in development: Chrome subscribed through the app, the server sent via
  Google's push service, and the notification showed. Not tried on a real iPhone.
- Changing the VAPID keys cuts off every subscribed device.
- New dependency: `pywebpush`. Migration: `push_subscriptions`.
