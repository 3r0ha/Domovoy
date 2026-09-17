# Сборка и запуск разделены: в образ не идут ни исходники, ни инструменты сборки.
FROM node:24-alpine AS build

WORKDIR /app

# Зависимости отдельным слоем: он меняется реже кода.
COPY package.json package-lock.json ./
COPY packages/app/package.json packages/app/
COPY packages/bridge/package.json packages/bridge/
COPY packages/devhost/package.json packages/devhost/
COPY packages/domain/package.json packages/domain/
COPY packages/max-bot-api/package.json packages/max-bot-api/
COPY packages/platform-mock/package.json packages/platform-mock/
COPY packages/react/package.json packages/react/
COPY packages/runtime/package.json packages/runtime/
COPY packages/server/package.json packages/server/
COPY packages/sessions/package.json packages/sessions/
COPY packages/stickers/package.json packages/stickers/
COPY packages/storage/package.json packages/storage/
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/domovoy/package.json apps/domovoy/
COPY apps/miniapp/package.json apps/miniapp/
COPY landing/package.json landing/

RUN npm ci

COPY . .

# Мини-приложение ходит в API относительным путём: их отдаёт один и тот же
# сервер. Отдельный адрес нужен, только если статику раздаёт кто-то другой.
ARG VITE_API_URL=
# Ссылка на бота в MAX: с ней на лендинге появляется кнопка «Открыть в MAX».
ARG VITE_BOT_LINK=
RUN VITE_API_URL=$VITE_API_URL npm run build \
  && VITE_BOT_LINK=$VITE_BOT_LINK npm run build --workspace @bezslavie/landing

# Отбор того, что нужно на запуске: собранный код, описания пакетов и миграции.
# Исходники и тесты остаются в слое сборки.
RUN mkdir -p /out && cp package.json package-lock.json /out/ \
  && for dir in packages/* apps/*; do \
       [ -d "$dir/dist" ] || continue; \
       mkdir -p "/out/$dir"; \
       cp "$dir/package.json" "/out/$dir/"; \
       cp -r "$dir/dist" "/out/$dir/"; \
     done \
  && cp -r packages/storage/migrations /out/packages/storage/

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /out/ ./
# Лендинг и мини-приложение отдаёт тот же процесс: один адрес на всё.
COPY --from=build /app/landing/dist ./landing/dist
COPY --from=build /app/landing/package.json ./landing/
# Bot API MAX отдаёт сертификат «Russian Trusted Sub CA»: корня этой цепочки
# в наборе Node.js нет, и без него бот не достучится до платформы.
COPY --from=build /app/certs ./certs
ENV NODE_EXTRA_CA_CERTS=/app/certs/russian-trusted-root-ca.pem

# Только рабочие зависимости: тестовые в контейнере не нужны.
RUN npm ci --omit=dev && npm cache clean --force

# Позиция в потоке апдейтов и отметки обхода переживают перезапуск только на томе.
ENV MARKER_FILE=/state/marker
ENV SWEEP_FILE=/state/sweep.json
VOLUME /state

EXPOSE 3000

# Прямой запуск node: сигнал остановки должен дойти до процесса, а не до оболочки.
CMD ["node", "apps/domovoy/dist/main.js"]
