# Private Gallery

[Русская версия](README.ru.md)

**A personal media gallery you fully control.**

Photos, videos, folders, users and access rules live on your server, in your storage, under your rules. No public photo platform, no consumer-cloud lock-in, no extra noise.

Private Gallery started as a tool for my own media archive: fast, private and comfortable to use every day. It has grown into a strong base for client work: family galleries, closed portfolios, personal archives, private media libraries or a self-hosted product for a small team.

## Why It Matters

Mainstream photo services are convenient as long as you accept their rules. Private Gallery solves a different problem: it gives the owner a polished interface and real control over the data.

- Store media in the S3-compatible storage you choose.
- Show photos and videos only to authenticated users.
- Manage folders, users and content order from an admin UI.
- Open originals through short-lived signed URLs.
- Deploy the app on your own server with Docker Compose.

## What It Includes

### Photo And Video Gallery

Folder cards on the home page, a masonry view inside each folder, a Swiper lightbox, keyboard navigation, an HD button for originals and video playback through prepared S3 variants.

### Privacy By Default

PostgreSQL-backed sessions, HTTP-only secure cookies, CSRF protection, `user` / `admin` roles, private API checks, Google, Telegram and Yandex login for pre-approved users.

### Admin Workflows That Cover Real Use

Create and edit folders, change covers, manage users, upload new images, mark a preview as video, reorder media with drag-and-drop and remove content without touching files manually.

User edits are saved with a single "Save" button, and leaving the page with unsaved changes asks for confirmation. The "Statistics" section shows who has access, when and from where they last signed in, recent activity, uploads and open sessions (which can be revoked). The "Log" section keeps every action of signed-in users and every sign-in attempt (IP, device, time) with search and filters; requests from bots without a session are not stored.

### Smart Media Handling

Originals stay separate, while lightweight WebP display versions are generated for `preview`, `screen-1280`, `screen-1920` and `screen-2560`. The gallery uses local cache to show previously opened folders faster.

Supported upload formats: JPEG, PNG, WEBP, AVIF, GIF, TIFF, iPhone HEIC/HEIF and camera RAW (Sony ARW, Canon CR2/CR3, Nikon NEF, DNG, Fujifilm RAF, Olympus ORF, Panasonic RW2 and more). HEIC is converted with `heif-dec` (libheif), RAW with `dcraw_emu` (LibRaw) at half resolution, which is enough for every display size. The original is stored as is and the HD button serves it.

### Safe Deletion

Deletion is soft first: media is hidden from the gallery, remains visible in edit mode, can be restored and is removed permanently only after the retention period. There is a dedicated screen for all files waiting for cleanup.

### Background Processing

Uploads, reorder operations and soft delete tasks run in a background worker through a PostgreSQL job queue. Reorder is more than a UI shuffle: the system renames related S3 variants, verifies hashes and exposes processing status.

## Why It Works Well For Clients

Private Gallery covers both the viewing experience and ownership of the system. A client gets a clear product: a private-first gallery that can be deployed, branded, customized around a workflow and kept independent from consumer photo-cloud platforms.

The project already includes the pieces that usually appear after the first demo: authentication, roles, admin screens, storage, optimized media versions, background jobs, soft deletion and repeatable deployment.

## Screenshots

<table>
  <tr>
    <td width="50%">
      <img src="frontend/img/home.png" alt="Home page with folder cards" />
      <br />
      <sub><strong>Home.</strong> Folders with covers, years and media count.</sub>
    </td>
    <td width="50%">
      <img src="frontend/img/page.png" alt="Folder page with media grid" />
      <br />
      <sub><strong>Folder.</strong> Fast masonry view for browsing a collection.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="frontend/img/box.png" alt="Photo lightbox" />
      <br />
      <sub><strong>Photo.</strong> Lightbox with slider navigation and original access.</sub>
    </td>
    <td width="50%">
      <img src="frontend/img/boxvideo.png" alt="Video lightbox" />
      <br />
      <sub><strong>Video.</strong> Private playback through signed media URLs.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="frontend/img/editpage.png" alt="Folder editor" />
      <br />
      <sub><strong>Folder editor.</strong> Upload, preview, ordering and delete controls.</sub>
    </td>
    <td width="50%">
      <img src="frontend/img/edithome.png" alt="Folder admin" />
      <br />
      <sub><strong>Folders.</strong> Create, order, cover and rename galleries.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="frontend/img/admin.png" alt="User admin" />
      <br />
      <sub><strong>Users.</strong> Email, Telegram ID and access roles.</sub>
    </td>
    <td width="50%">
      <img src="frontend/img/editdelpage.png" alt="Pending deletion media" />
      <br />
      <sub><strong>Soft delete.</strong> Files waiting for final cleanup.</sub>
    </td>
  </tr>
</table>

## Under The Hood

```text
Browser
  |
  v
Caddy / HTTPS (Let's Encrypt)
  |
  +-- React frontend (static files)
  |
  +-- /api -> Express API
        |
        +-- PostgreSQL: users, sessions, cards, media dimensions
        +-- Redis: folder listing and media index cache
        +-- S3-compatible storage: originals, previews, videos
        +-- PostgreSQL job queue -> worker: upload, reorder, soft delete
```

## Stack

- **Frontend:** React 19, Vite, React Router, Swiper, DnD Kit, Lucide React, Sileo.
- **Backend:** Node.js, Express 5, PostgreSQL, `express-session`, `connect-pg-simple`, CSRF (HMAC token + Origin), Helmet, Multer, Sharp.
- **Storage & jobs:** S3-compatible storage, signed URLs, Redis cache, PostgreSQL job queue.
- **Infra:** Docker Compose, Caddy, PostgreSQL, Redis.

## Media Storage

Photos:

```text
original_photo/{year}/{category}/{name}.{ext}
preview/{year}/{category}/{name}.webp
screen-1280/{year}/{category}/{name}.webp
screen-1920/{year}/{category}/{name}.webp
screen-2560/{year}/{category}/{name}.webp
```

Videos:

```text
preview/{year}/{category}/video_{name}.webp
video_1440/{year}/{category}/{name}.mp4
video_1080/{year}/{category}/{name}.mp4
video_720/{year}/{category}/{name}.mp4
```

Video playback expects prepared MP4 variants in S3-compatible storage. The admin upload flow can upload a preview image and mark it as a video item.

## Deploy On Ubuntu 24.04

### 1. Docker

```bash
sudo apt update
sudo apt install -y ca-certificates curl

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

docker -v
docker compose version

sudo systemctl start docker
sudo systemctl enable docker
```

### 2. Project

```bash
sudo apt install -y git
git -v

git clone https://github.com/EgorBabin/private-gallery.git
cd private-gallery
ls -a
```

### 3. Environment

```bash
cp .env.example .env
nano .env
```

Fill in the main values:

- `SERVER_NAME`, `LE_EMAIL`, `FRONTEND_URL` - domain and HTTPS (Caddy issues the certificate, ports 80 and 443 must be open).
- `SESSION`, `SESSION_SECRET` - sessions.
- `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` - S3-compatible storage.
- `PG_USER`, `PG_PASSWORD`, `PG_HOST`, `PG_PORT`, `PG_DATABASE` - PostgreSQL.
- `APP_INIT_*` - first user.
- `GOOGLE_*` - Google login. In Google Cloud Console create an OAuth client of type "Web application", set the redirect URI to `https://<domain>/api/google/callback` and keep only the `openid` and `email` scopes. The address is matched against the same user `email` array as Yandex.
- `YANDEX_*` - Yandex OAuth.
- `TG_BOT_TOKEN`, `TG_CHAT_ID` - Telegram login and notifications. Set the site domain for the bot in BotFather with `/setdomain`.

### 4. Docker Permissions

```bash
sudo usermod -aG docker [your_linux_username]
newgrp docker
```

### 5. Start

```bash
docker compose build
docker compose up -d
docker compose ps -a
```

Logs:

```bash
docker compose logs -f --tail=200 backend photo-worker
```

Container logs are rotated automatically (up to 3 files of 10 MB per container), every service has a memory limit and `photo-worker` also has a CPU limit. Defaults can be changed in `.env` (the `container resource limits` block).

### 6. Update

```bash
git pull
docker compose build
docker compose up -d
docker image prune -f
docker builder prune -f
```

The last two commands remove old images and build cache. Without them every rebuild leaves hundreds of megabytes on disk.

> **Moving from the Traefik + nginx + RabbitMQ version.** Update when no uploads are being processed: jobs from the old RabbitMQ queue are not carried over. Old containers are removed with `--remove-orphans`, and Caddy issues a new certificate on first start:
>
> ```bash
> docker compose up -d --build --remove-orphans
> docker volume rm private-gallery_rabbitmqdata private-gallery_traefik-letsencrypt
> ```

### 7. Privacy

- Caddy sends a Content-Security-Policy, `Referrer-Policy: strict-origin-when-cross-origin` (S3 and other sites only see the domain, not folder names) and `X-Robots-Tag: noindex`. Set `S3_PUBLIC_ORIGIN` in `.env` so images and video are allowed only from your storage.
- Sessions are not bound to the IP (`SESSION_BIND_IP=false`), otherwise phones get logged out when switching networks. CSRF protection: an HMAC session token plus an `Origin` check. The API is rate limited per IP.
- GPS coordinates can be removed from originals without damaging the files: the GPS block is wiped in place, while the image, orientation, date, camera and other metadata stay intact. JPEG, PNG, TIFF, HEIC/HEIF and RAW (including CR3) are supported. For new uploads set `STRIP_GPS_ON_UPLOAD=true`; for existing files use the script (check first, then clean):

```bash
docker compose run --rm photo-worker node scripts/stripLocation.js
docker compose run --rm photo-worker node scripts/stripLocation.js --apply
```

## Who It Fits

- Personal self-hosted gallery.
- Family or travel archive.
- Closed portfolio.
- Private client preview for photographers, designers and studios.
- Base for a custom media-management product.

## Open Source

The project is released under the MIT License. See [LICENSE](LICENSE).

# Made with ❤️