# Private Gallery

[English version](README.en.md)

**Личная медиагалерея, которую вы контролируете полностью.**

Фото, видео, папки, пользователи и доступы - на вашем сервере, в вашем хранилище, по вашим правилам. Без публичных фотоплатформ, без привязки к чужому облаку, без лишнего шума.

Private Gallery родилась как проект для себя: быстрый, закрытый и удобный архив личных медиа. Сейчас это уже хорошая основа для кастомного решения под клиента: семейной галереи, закрытого портфолио, личного архива, приватной медиатеки или self-hosted продукта для небольшой команды.

## Зачем

Обычные фотосервисы удобны, пока вы согласны жить внутри их правил. Private Gallery решает другую задачу: дать владельцу красивый интерфейс и полный контроль над данными.

- Храните медиа в S3-compatible storage, который выбираете сами.
- Показывайте фото и видео только авторизованным пользователям.
- Управляйте папками, пользователями и порядком контента из админки.
- Открывайте оригиналы через временные signed URLs.
- Деплойте проект на свой сервер через Docker Compose.

## Что Уже Есть

### Галерея Для Фото И Видео

Карточки папок на главной, masonry-витрина внутри папки, лайтбокс на Swiper, keyboard navigation, HD-кнопка для оригинала и воспроизведение видео через подготовленные S3-варианты.

### Приватность По Умолчанию

Сессии в PostgreSQL, HTTP-only secure cookies, CSRF-защита, роли `user` / `admin`, проверка приватных API routes, Telegram и Yandex login для заранее добавленных пользователей.

### Админка, Которая Закрывает Реальные Сценарии

Можно создавать и редактировать папки, менять обложки, управлять пользователями, загружать новые изображения, отмечать preview для видео, менять порядок медиа drag-and-drop и удалять контент без ручной работы с файлами.

### Умная Работа С Медиа

Оригиналы остаются отдельно, а для просмотра создаются легкие WebP-версии: `preview`, `screen-1280`, `screen-1920`, `screen-2560`. Галерея использует local cache, чтобы быстрее показывать уже открытые папки.

### Безопасное Удаление

Удаление работает мягко: медиа скрывается из галереи, остается доступным в edit mode, может быть восстановлено и удаляется окончательно только после retention period. Есть отдельный экран со всеми файлами, ожидающими удаления.

### Фоновая Обработка

Загрузка, сортировка и soft delete уходят в RabbitMQ workers. Reorder не просто меняет UI: система переименовывает связанные S3-версии, проверяет hash и показывает статус выполнения.

## Почему Это Сильная Основа Для Клиента

Private Gallery закрывает не только красивый просмотр, но и владение системой целиком. Клиент получает понятный продукт: private-first галерею, которую можно развернуть, адаптировать под бренд, расширить под нужный workflow и не зависеть от потребительских облачных фотосервисов.

Проект уже содержит то, что обычно приходится дописывать после первого демо: авторизацию, роли, админку, хранение, оптимизированные версии файлов, фоновые задачи, мягкое удаление и repeatable deploy.

## Скриншоты

<table>
  <tr>
    <td width="50%">
      <img src="frontend/img/home.png" alt="Главная страница с карточками папок" />
      <br />
      <sub><strong>Главная.</strong> Папки с обложками, годами и счетчиком медиа.</sub>
    </td>
    <td width="50%">
      <img src="frontend/img/page.png" alt="Страница папки с медиавитриной" />
      <br />
      <sub><strong>Папка.</strong> Быстрая masonry-витрина для просмотра коллекции.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="frontend/img/box.png" alt="Лайтбокс для фото" />
      <br />
      <sub><strong>Фото.</strong> Лайтбокс со слайдером и открытием оригинала.</sub>
    </td>
    <td width="50%">
      <img src="frontend/img/boxvideo.png" alt="Лайтбокс для видео" />
      <br />
      <sub><strong>Видео.</strong> Просмотр видео через приватные signed URLs.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="frontend/img/editpage.png" alt="Редактирование папки" />
      <br />
      <sub><strong>Редактор папки.</strong> Upload, preview, сортировка и удаление.</sub>
    </td>
    <td width="50%">
      <img src="frontend/img/edithome.png" alt="Админка папок" />
      <br />
      <sub><strong>Папки.</strong> Создание, порядок, обложки и названия.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="frontend/img/admin.png" alt="Админка пользователей" />
      <br />
      <sub><strong>Пользователи.</strong> Email, Telegram ID и роли доступа.</sub>
    </td>
    <td width="50%">
      <img src="frontend/img/editdelpage.png" alt="Медиа под удалением" />
      <br />
      <sub><strong>Soft delete.</strong> Все файлы, ожидающие финального удаления.</sub>
    </td>
  </tr>
</table>

## Под Капотом

```text
Browser
  |
  v
Traefik / HTTPS
  |
  +-- Nginx -> React frontend
  |
  +-- Express API
        |
        +-- PostgreSQL: users, sessions, cards
        +-- S3-compatible storage: originals, previews, videos
        +-- RabbitMQ -> worker: upload, reorder, soft delete
```

## Стек

- **Frontend:** React 19, Vite, React Router, Swiper, React Responsive Masonry, DnD Kit, Lucide React, Sileo.
- **Backend:** Node.js, Express 5, PostgreSQL, `express-session`, `connect-pg-simple`, `csurf`, Helmet, Multer, Sharp.
- **Storage & jobs:** S3-compatible storage, signed URLs, RabbitMQ workers.
- **Infra:** Docker Compose, Traefik, Nginx, PostgreSQL, RabbitMQ.

## Хранение Медиа

Фото:

```text
original_photo/{year}/{category}/{name}.{ext}
preview/{year}/{category}/{name}.webp
screen-1280/{year}/{category}/{name}.webp
screen-1920/{year}/{category}/{name}.webp
screen-2560/{year}/{category}/{name}.webp
```

Видео:

```text
preview/{year}/{category}/video_{name}.webp
video_1440/{year}/{category}/{name}.mp4
video_1080/{year}/{category}/{name}.mp4
video_720/{year}/{category}/{name}.mp4
```

Видео-воспроизведение рассчитано на уже подготовленные MP4-варианты в S3-compatible storage. Сценарий загрузки в админке может загрузить preview image и отметить его как видео.

## Деплой На Ubuntu 24.04

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

### 2. Проект

```bash
sudo apt install -y git
git -v

git clone https://github.com/EgorBabin/private-gallery.git
cd private-gallery
ls -a
```

### 3. Переменные Окружения

```bash
cp .env.example .env
nano .env
```

Заполните основные значения:

- `SERVER_NAME`, `LE_EMAIL`, `FRONTEND_URL` - домен и HTTPS.
- `SESSION`, `SESSION_SECRET` - сессии.
- `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` - S3-compatible storage.
- `PG_USER`, `PG_PASSWORD`, `PG_HOST`, `PG_PORT`, `PG_DATABASE` - PostgreSQL.
- `RABBITMQ_*` - очередь фоновых задач.
- `APP_INIT_*` - первый пользователь.
- `YANDEX_*` - Yandex OAuth.
- `VITE_TG_BOT_USERNAME`, `TG_BOT_TOKEN`, `TG_CHAT_ID` - Telegram login и уведомления.

### 4. Права Docker

```bash
sudo usermod -aG docker [your_linux_username]
newgrp docker
```

### 5. Запуск

```bash
docker compose build
docker compose up -d
docker compose ps -a
```

Логи:

```bash
docker compose up
```

## Для Кого

- Личная self-hosted галерея.
- Семейный или travel archive.
- Закрытое портфолио.
- Private client preview для фотографов, дизайнеров и студий.
- База для кастомного media-management решения.

## Лицензия

Проект опубликован под MIT License. См. [LICENSE](LICENSE).

# Made with ❤️