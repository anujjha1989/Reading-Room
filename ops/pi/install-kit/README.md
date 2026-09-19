# The Reading Room for Raspberry Pi

This is a Linux/aarch64-ready deployment of the web application recovered from
the macOS app bundle. It contains the existing 8,046-book catalogue and browser
reader, but deliberately omits the macOS launcher, menu-bar controller, bundled
macOS Node binary, and private TLS key.

The service listens only on the Pi itself. Tailscale Serve then publishes it to
your private tailnet over a trusted HTTPS address, which is safer than exposing
port 4311 to the whole LAN and works well with iPhone Safari.

## Install on the Pi

Copy this entire `reading-room-pi` folder to the Pi. From a Mac, one option is:

```sh
scp -r reading-room-pi <pi-user>@100.107.210.44:~/
```

Then connect to the Pi and install:

```sh
ssh <pi-user>@100.107.210.44
cd ~/reading-room-pi
chmod +x install.sh publish-tailscale.sh check.sh
sudo ./install.sh
sudo ./publish-tailscale.sh
```

The last command prints a private address similar to:

```text
https://anujrpi.<your-tailnet>.ts.net
```

On the iPhone, connect Tailscale, open that HTTPS address in Safari, then use
**Share → Add to Home Screen** if you want it to behave like an app.

## How Google Drive access works

The catalogue stores a Google Drive file ID for each book. When a book is
opened, the Pi server downloads the bytes from Google Drive and streams them to
the browser. No Google OAuth secret, API key, password, or access token is
included in this package or sent to browser code.

This is the same access model as the Mac version: each referenced Drive file
must be downloadable through its sharing link. If a file is private to the
Google account and not link-accessible, this build cannot retrieve it. Adding
private-account OAuth later would require a server-side credential store and an
authorization flow; credentials must never be added to `site/` or `catalog.json`.

## Useful commands

```sh
sudo systemctl status reading-room
sudo journalctl -u reading-room -f
./check.sh
sudo systemctl restart reading-room
sudo tailscale serve status
```

Reading progress, favorites, cached covers, and state backups live in
`/var/lib/reading-room`. Reinstalling or updating the application does not
replace that directory. Each application install is kept as a timestamped
release under `/opt/reading-room/releases`, and `current` points to the active
one.

To stop publishing the app through Tailscale, use:

```sh
sudo tailscale serve off
```

## Security notes

- Tailscale Serve is private to the tailnet; do not use Tailscale Funnel for
  this library.
- Anyone allowed to reach this Pi through the tailnet can use the library.
  Tailnet access rules can narrow that further if needed.
- The old self-signed certificate and key from the Mac bundle are intentionally
  excluded. Tailscale provisions and terminates trusted HTTPS instead.
- The server makes outbound requests only when it needs a Drive book or an Open
  Library cover.
