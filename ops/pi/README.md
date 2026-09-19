# Raspberry Pi operations snapshot

This directory records the source/configuration installed on the Reading Room
Pi as audited on 2026-09-19. It makes the live host reproducible without
committing its books, credentials, generated catalogue or user state.

## Installed paths

| Repository path | Pi destination |
| --- | --- |
| `systemd/reading-room.service` | `/etc/systemd/system/reading-room.service` |
| `systemd/reading-room-tts.conf` | `/etc/systemd/system/reading-room.service.d/tts.conf` |
| `systemd/reading-room-drive-sync*` | `/etc/systemd/system/` and its service drop-in |
| `systemd/rr-*` | `/etc/systemd/system/` |
| `bin/reading-room-drive-sync` | `/usr/local/bin/reading-room-drive-sync` |
| `lib/*` | `/usr/local/lib/reading-room/` |
| `sbin/*` | `/usr/local/sbin/` |
| `tools/rr-cover-extract.py` | `/opt/reading-room/tools/rr-cover-extract.py` |

`install-kit/` preserves the small installation/checking scripts found at
`/home/anujjha1989/reading-room-install/reading-room-pi`. Its old compiled site,
catalogue and image assets are intentionally excluded because they are
generated or superseded by the current source.

## Runtime data deliberately excluded

- `/home/anujjha1989/.config/rclone/` — credentials;
- `/home/anujjha1989/.reading-room/` — generated scan work and status;
- `/var/lib/reading-room/` — progress, bookmarks, settings and backups;
- `/mnt/seagate/ReadingRoom/library/` — books and scripts;
- `/mnt/seagate/ReadingRoom/book-art/` and `tts/` — generated art and audio;
- `/opt/reading-room/current/site/` — compiled deployment output.

Do not install these files by copying the directory wholesale. Preserve owners,
modes and systemd drop-in locations, then run `systemctl daemon-reload` and the
relevant validation before restarting services.
