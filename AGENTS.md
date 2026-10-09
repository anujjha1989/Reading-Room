# Home Books reader parity

Reader improvements must be assessed for web, iOS and tvOS together. Anuj should
not need to report the same bug for each app. iOS book reading uses this web
reader through WKWebView; native summary playback and tvOS live in the canonical
native checkout `/Users/anuj-mac/Developer/readingroom-ios-src`.

For a reader/narration change, use that checkout's
`scripts/check-reader-parity.sh` with this canonical source and dedicated iOS/TV
simulators. Record each platform's coverage and any blocker. Retain natural
punctuation, Unicode, bounded audio requests/prefetch, voice selection,
pause/resume position, chapter continuity, page numbering and existing themes.
Keep device-specific controls/layouts; parity does not mean identical UI or
cross-device reading-state synchronization.

Deploy this web source once for Safari and the iOS book reader. Install new native
apps only if native source changed. Build/test complete candidates, preserve
rollback, verify actual public/LAN routes and installed native versions. Do not
claim completion if a required platform check failed or was unavailable.
