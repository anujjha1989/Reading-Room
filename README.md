# The Reading Room — hand-maintained sources

Everything in this repo is edited by hand and deployed onto the Pi.  The built
React bundle under `/opt/reading-room/current/site/assets/` is NOT tracked: it
is hashed, immutable, and comes from the release tarball.

    server/     standalone-server.mjs          -> /opt/reading-room/current/
    site/       index.html                     -> /opt/reading-room/current/site/
    overrides/  library-fix.*, reader-fix.*    -> .../site/assets/
    book-art/   fullscreen-bundle-*, read-aloud-* -> /mnt/seagate/ReadingRoom/book-art/

`./deploy` copies them into place, rewrites the `?v=` query strings in
index.html from the real filenames, and restarts the service.  Rewriting the
version strings by hand is what let fullscreen-bundle-v43.css sit finished on
disk for a day without ever being loaded.
