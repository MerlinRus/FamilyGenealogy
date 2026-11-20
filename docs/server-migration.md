# Сервер с 20 ноября 2026

Адрес: `m.pivorental@195.133.25.63:22`, ключ остаётся на компьютере владельца. Рабочая папка `/opt/genealogy`. Повышение привилегий только через `sudo -n` для установки проекта и отдельного виртуального хоста.

`deploy/compose.genealogy.yaml` запускает Python API и Caddy в Docker. Caddy опубликован только на `127.0.0.1:8094`; API доступен исключительно внутри сети Compose. Существующий системный Nginx завершает TLS и проксирует `family.maark.ru`. Пароль проверяется Caddy на всех маршрутах, в том числе JSON, API и файлах.

```sh
cd /opt/genealogy
sudo docker compose --project-directory . -f deploy/compose.genealogy.yaml ps
sudo docker compose --project-directory . -f deploy/compose.genealogy.yaml up -d --wait
```

Данные: `private/case/`, `private/editor.sqlite3`, `site/releases/`; активная версия `site/current`. Пароль и его хеш остаются в `private/`. Не заменять SQLite при обновлениях. `deploy/install_nginx.py` сохраняет существующую SQLite через backup API и не импортирует подготовленную базу повторно. Выпуски и исходные семейные файлы не помещаются в публичный Git.

Nginx: `/etc/nginx/sites-available/family.maark.ru`, отдельная ссылка в `sites-enabled`. Сертификат Let’s Encrypt: `/etc/letsencrypt/live/family.maark.ru/`; webroot проверки `/opt/genealogy/acme`. После продления hook `genealogy-nginx` проверяет конфигурацию и перезагружает Nginx. Другие виртуальные хосты не меняются.

Старые `scripts/deploy.py` и `deploy/remote_install.py` относятся к недоступному серверу `/opt/familytree`; не использовать их для нового сервера. Новый установщик принимает пакет и SHA256 через SSH stdin. Пакет: `repository.bundle`, `manifest.json` с commit/release, `site/`, `case/`, `access.json`; только при первичном восстановлении — `editor.sqlite3` и `recovery.json`.

Для первичного переноса использована последняя сохранённая копия от 29 октября. SSH и HTTPS старого сервера не ответили. Сведения восстановлены из проверенного JSON; исходная история действий SQLite недоступна. Новая история начинается с явной записи восстановления, а не с вымышленных прежних операций.
