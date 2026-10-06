import posthog from "posthog-js";

const token = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (token) {
  posthog.init(token, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    defaults: "2026-05-30",
    person_profiles: "identified_only",
    disable_session_recording: true,
    before_send: (event) => {
      if (!event) return null;
      event.properties = { ...event.properties, app: "geck-data" };
      return event;
    },
  });
}
