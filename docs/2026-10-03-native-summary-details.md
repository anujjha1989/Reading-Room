# Native summary/book-details regression

The v182 local download migration exposed a hidden dependency: the iOS
SummaryHook inferred copy IDs from Google Drive links in the details modal.
Local API links made its copies list empty, so Read summary silently did nothing.

BookSummaryAction now owns the details action in React and nativeBridge posts
catalogue IDs directly to the existing rrSummary handler. The rr-summary marker
prevents older wrappers injecting a duplicate. A browser without that handler
hides the action; SSR and initial hydration render the same hidden control.
No native runtime change or new injection/override is needed.

The shared Close control previously had no theme-aware foreground and could
scroll away; its source rule now sets contrast, a 44px hit target and sticky
placement. Mobile modal spacing includes the top and bottom safe areas.

Candidate verification:
- Reproducible SSD build and rendered HTML check passed.
- Browser test uses East of Eden's two catalogue IDs, local-only download URLs,
  both themes, native message payloads, exactly one action, scrolling and close,
  and the browser-only hidden action. No user data or AI call is made.
- Existing home-brand, section-list and summary-settings browser checks passed.
- BookDetailsSummaryUITests on the iOS simulator passed: web action opens the
  actual native Summary controller, Done returns, web Close dismisses details.
  Candidate fixture has no real book bytes or paid-provider credentials.

Rollback is the normal complete previous-release snapshot. Manual physical
iPhone confirmation remains with the user; simulator is representative coverage,
not a claim that every real-device scenario has been tested.

Released as v183 from 8ca3496. All static deployment gates and live asset checks
passed. On authenticated public HTTPS :8443, the summary-action and home-brand
tests passed in both themes without browser exceptions. Native runtime/source
is unchanged; iOS regression test source is recorded separately at 5d6090f.
