// Static privacy notice. No request data, so it stays on the same
// prerendered path as the other public pages.
import Link from "next/link";
import { PageIntro } from "@/components/simple/ui";

export const metadata = {
  title: "Privacy - Geck Inspect Market",
  description: "What this site collects, which cookies it uses, and how to get in touch.",
};

const CONTACT = "morphiclabsdata@gmail.com";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <PageIntro title="Privacy">
        This is a general template, not legal advice. It describes what this site
        collects today.
      </PageIntro>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-ink-50">What is collected</h2>
        <div className="space-y-3 text-base leading-7 text-ink-300">
          <p>
            You can read prices without an account. If you create one, it is so you can
            save price alerts. The account stores the email and password you submit. The
            password is handled by the sign-in service. While you are signed in, page
            views can include that email.
          </p>
          <p>
            Public pages record a page view: the path, a per-tab session id kept in
            session storage, and, if you are signed in, your email. Uncaught errors are
            recorded with the message, the page URL, the browser&apos;s user agent, and
            the email if you are signed in. Those rows are written so the site can be
            operated. They are not sold.
          </p>
          <p>
            When PostHog is configured, the same page events are also sent there, along
            with uncaught exceptions. Session recording is off. A person profile is
            created only for an identified account, not for anonymous visitors.
          </p>
          <p>
            On the host that shows the analytics consent prompt, Google Analytics can
            measure visits, page views, scrolling, and outbound link clicks. It loads
            only after you choose Allow analytics. Advertising storage and ad
            personalization stay off. If you decline, or if your browser sends a
            do-not-track or global privacy control signal, those analytics cookies are
            not used. Form contents are not collected.
          </p>
          <p>A theme choice (light or dark) is saved in this browser.</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-ink-50">Cookies and local storage</h2>
        <div className="space-y-3 text-base leading-7 text-ink-300">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Sign-in uses a cookie that stays on this browser until you log out. If you
              turn off &quot;stay logged in&quot;, the session is kept in session storage
              and ends when the tab closes.
            </li>
            <li>The theme and the per-tab session id live in this browser&apos;s storage.</li>
            <li>
              PostHog, when configured, uses its own cookie or local storage to remember
              the browser.
            </li>
            <li>
              Google Analytics cookies are set only after you allow them on the host that
              shows the consent prompt. The choice itself is stored in local storage.
            </li>
          </ul>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-ink-50">Sale of data</h2>
        <p className="text-base leading-7 text-ink-300">
          This site does not sell personal information. Listing prices shown here come
          from public marketplace pages, not from your account.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-ink-50">How long it is kept</h2>
        <div className="space-y-3 text-base leading-7 text-ink-300">
          <p>
            Account data is kept while the account exists. Page-view and error rows are
            kept so the site can be operated, and are removed when they are no longer
            needed for that. PostHog and Google Analytics keep what they receive under
            their own settings.
          </p>
          <p>
            You can clear cookies and local storage in your browser at any time. That
            removes the theme, the analytics choice, and a signed-in session on this
            device.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-ink-50">Contact</h2>
        <p className="text-base leading-7 text-ink-300">
          Questions about this notice:{" "}
          <a className="underline hover:text-ink-50" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          . The{" "}
          <Link href="/terms" className="underline hover:text-ink-50">
            terms
          </Link>{" "}
          explain what the prices are, and are not.
        </p>
      </section>
    </div>
  );
}
