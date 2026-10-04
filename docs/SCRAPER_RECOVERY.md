# Scraper recovery, October 4, 2026

## Scheduled jobs start late before a runner is requested

The catalog schedule is `35 14 * * 1-5`, or 14:35 UTC on weekdays.
Recent run metadata shows the delay occurs before GitHub creates the run:

| Date | Run | Created (UTC) | Delay after 14:35 |
| --- | --- | --- | --- |
| September 28 | [36480826902](https://github.com/tennysonmilesperhour/geck-data/actions/runs/36480826902) | 20:40:10 | 6h 05m |
| September 29 | [36620135058](https://github.com/tennysonmilesperhour/geck-data/actions/runs/36620135058) | 19:33:52 | 4h 58m |
| September 30 | [36766534692](https://github.com/tennysonmilesperhour/geck-data/actions/runs/36766534692) | 19:33:45 | 4h 58m |
| October 1 | [36916244693](https://github.com/tennysonmilesperhour/geck-data/actions/runs/36916244693) | 19:42:19 | 5h 07m |
| October 2 | [37054146882](https://github.com/tennysonmilesperhour/geck-data/actions/runs/37054146882) | 19:26:41 | 4h 51m |

For all five, `run_started_at` equals `created_at`. On October 2 the job was
created at 19:26:42 and its runner started at 19:26:43. For comparison, the
[September 30 manual run](https://github.com/tennysonmilesperhour/geck-data/actions/runs/36743416095)
had its job created at 16:20:02 and started at 16:20:05.

This points to scheduled-event delivery, rather than scraper startup time,
proxy failures, or a long wait for an available runner. The data does not reveal
GitHub's internal reason for the event delay.

[GitHub documents that schedules can be delayed or dropped during high load](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
It recommends avoiding the start of the hour. This catalog already uses minute
35, and the newest check uses minute 7. Moving the clock earlier would hide the
variable delay rather than make delivery reliable, so the schedules remain as
configured.

For tighter timing, use the existing Mac scheduler while the Mac is available,
or an independent hosted scheduler that calls GitHub's manual-dispatch API.
The latter needs a separately managed credential and does not guarantee runner
availability. No new scheduler, credential, secret, or variable was created.
No support request was sent. These run links can support a GitHub investigation
if one is requested.

## Details and Sellers replacement

Both scripts now use the catalog's Chromium and residential-proxy route instead
of the dead Decodo scraping API. They read the hydrated page, run requests on
one thread, and retry transient failures after 5 and 15 seconds. A confirmed
404/410 retains the existing gone-listing behavior; a connection error never
marks a listing gone. A final access-denied error stops the run immediately.

Sellers must yield store-specific metadata. A generic challenge-page title is
not enough to overwrite a store name. A recovery run that parses no records
fails instead of reporting success.

Both weekly schedules remain paused. Their manual workflows now install
Chromium and default `max_records` to 5. Entering 0 processes the full backlog;
that is not the initial recovery check. Keep the initial check capped because
both jobs write the records they successfully read.

After the owner confirms the proxy exits in the United States:

1. Complete the catalog validation already requested, including its natural end
   and inactive-listing sweep.
2. Manually run Details and Sellers with five records each. Inspect the saved
   fields and logs, not just a green workflow badge. Unit tests do not prove
   that MorphMarket's current pages still match these parsers.
3. If both checks succeed, clear the backlog within their time limits and then
   restore weekly schedules. Sequential browser requests may change duration;
   measure it before scheduling a full run. If the parser fails, repair it
   against the live page before restoring the schedule.

The catalog already refreshes many listing details every six days and supplies
seller slugs, so Sellers is the greater remaining freshness gap. The separate
Details job is kept available for fields served by its existing rich-page parser.

Discord failure alerts remain unconfigured, per the owner's instruction.
