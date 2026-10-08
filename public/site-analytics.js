/* Consent-based GA4 for public website pages. No form values or private routes. */
(function () {
  'use strict';
  const config = {"id": "G-M4N63YP4B5", "name": "Geck Intellect", "hosts": ["geckintellect.geckinspect.com"], "paths": ["^/$", "^/(markets|trends|morphs|methodology|listings|sellers|privacy|terms)/?$", "^/morphs/[a-z0-9-]+/?$"]};
  if (!config.hosts.includes(location.hostname) || window.__publicSiteAnalytics) return;
  window.__publicSiteAnalytics = true;
  const key = 'google-analytics-consent-v1';
  const disabled = 'ga-disable-' + config.id;
  const privacySignal = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
  let choice = null;
  try { choice = localStorage.getItem(key); } catch { /* Session-only choice. */ }
  if (privacySignal) choice = 'denied';
  let loaded = false;
  let previousPage = '';
  let scrolled = false;
  let root;
  let panel;
  let settings;
  const allowed = () => config.paths.some(pattern => new RegExp(pattern).test(location.pathname));
  const enabled = () => choice === 'granted' && allowed() && !privacySignal;
  const page = () => location.origin + location.pathname;
  const referrer = () => { try { return new URL(document.referrer).origin + '/'; } catch { return ''; } };
  // The Google tag queue uses the documented arguments-object format.
  // eslint-disable-next-line prefer-rest-params
  function gtag() { window.dataLayer.push(arguments); }
  function clearCookies() {
    document.cookie.split(';').forEach(part => {
      const name = part.split('=')[0].trim();
      if (!/^_ga(?:_|$)/.test(name)) return;
      const parts = location.hostname.split('.');
      document.cookie = name + '=; Max-Age=0; path=/; SameSite=Lax';
      for (let i = 0; i < parts.length - 1; i++) {
        document.cookie = name + '=; Max-Age=0; path=/; domain=.' + parts.slice(i).join('.') + '; SameSite=Lax';
      }
    });
  }
  function event(name, values) {
    if (!enabled() || !loaded) return;
    gtag('event', name, Object.assign({
      send_to: config.id,
      page_location: page(),
      page_referrer: referrer(),
      page_title: config.name,
    }, values || {}));
  }
  function update() {
    window[disabled] = !enabled();
    if (root) root.hidden = !allowed();
    if (!enabled()) { previousPage = ''; return; }
    if (!loaded) {
      loaded = true;
      window.dataLayer = window.dataLayer || [];
      gtag('consent', 'default', {
        analytics_storage: 'granted', ad_storage: 'denied',
        ad_user_data: 'denied', ad_personalization: 'denied',
      });
      gtag('js', new Date());
      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://www.googletagmanager.com/gtag/js?id=' + config.id;
      document.head.appendChild(script);
    }
    if (previousPage === page()) return;
    previousPage = page();
    scrolled = false;
    gtag('config', config.id, {
      send_page_view: false,
      page_location: page(), page_referrer: referrer(), page_title: config.name,
      allow_google_signals: false, allow_ad_personalization_signals: false,
      cookie_flags: 'SameSite=Lax;Secure',
    });
    event('page_view');
  }
  function choose(value) {
    choice = privacySignal ? 'denied' : value;
    try { localStorage.setItem(key, choice); } catch { /* Session-only choice. */ }
    if (choice !== 'granted') {
      window[disabled] = true;
      clearCookies();
    }
    panel.hidden = true;
    settings.hidden = false;
    update();
    settings.focus();
  }
  function mount() {
    root = document.createElement('aside');
    root.id = 'site-analytics-preferences';
    const shadow = root.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>:host{position:fixed;z-index:10000;bottom:12px;left:12px;max-width:calc(100vw - 24px);font:14px/1.5 system-ui,sans-serif;color:#202124;text-align:left} :host([hidden]),[hidden]{display:none!important}section{box-sizing:border-box;width:360px;max-width:calc(100vw - 24px);padding:16px;border:1px solid #d2d5d8;border-radius:12px;background:#fff;box-shadow:0 4px 20px #0002}h2{font:600 16px/1.3 system-ui;margin:0 0 8px}p{margin:0 0 12px}a{color:#245c83}button{font:inherit;cursor:pointer;border:1px solid #7c858c;border-radius:7px;padding:8px 12px;min-height:40px;background:#fff;color:#202124}button:focus-visible,a:focus-visible{outline:3px solid #3277bd;outline-offset:3px}.actions{display:flex;gap:8px;flex-wrap:wrap}.settings{font-size:12px;min-height:32px;padding:5px 9px;background:#fffefb}button:disabled{cursor:default;opacity:.6}</style><section role="region" aria-label="Optional website analytics"><h2>Help improve this website?</h2><p>With your permission, Google Analytics uses cookies to measure visits, page views, scrolling, and outbound link clicks. Form contents are not collected. You can change this choice anytime.</p><p><a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google privacy policy</a></p><p class="signal" hidden>Your browser privacy preference is keeping Google Analytics off.</p><div class="actions"><button class="decline" type="button">No thanks</button><button class="accept" type="button">Allow analytics</button></div></section><button class="settings" type="button" hidden>Analytics choices</button>';
    panel = shadow.querySelector('section');
    settings = shadow.querySelector('.settings');
    panel.hidden = choice !== null;
    settings.hidden = choice === null;
    shadow.querySelector('.accept').disabled = privacySignal;
    shadow.querySelector('.signal').hidden = !privacySignal;
    shadow.querySelector('.accept').addEventListener('click', () => choose('granted'));
    shadow.querySelector('.decline').addEventListener('click', () => choose('denied'));
    settings.addEventListener('click', () => {
      panel.hidden = false;
      settings.hidden = true;
      shadow.querySelector('.decline').focus();
    });
    document.body.appendChild(root);
    update();
  }
  window[disabled] = true;
  // Framework navigations do not reload the document. Preserve each native return value.
  ['pushState', 'replaceState'].forEach(method => {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      update();
      return result;
    };
  });
  window.addEventListener('popstate', update);
  window.addEventListener('storage', ev => {
    if (ev.key !== key) return;
    choice = privacySignal ? 'denied' : ev.newValue;
    if (choice !== 'granted') clearCookies();
    if (panel) { panel.hidden = choice !== null; settings.hidden = choice === null; }
    update();
  });
  window.addEventListener('scroll', () => {
    if (config.manualScroll === false || scrolled || !enabled()) return;
    const height = document.documentElement.scrollHeight;
    if (height > innerHeight && scrollY + innerHeight >= height * .9) {
      scrolled = true;
      event('scroll', { percent_scrolled: 90 });
    }
  }, { passive: true });
  document.addEventListener('click', ev => {
    const link = ev.target.closest && ev.target.closest('a[href]');
    if (!link || !enabled()) return;
    try {
      const url = new URL(link.href, location.origin);
      if (url.protocol === 'https:' && url.hostname !== location.hostname) {
        event('outbound_click', { link_domain: url.hostname });
      }
    } catch { /* Ignore non-web destinations. */ }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
