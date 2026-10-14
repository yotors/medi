# Pinned rehearsal bases. Review image security updates before each release.
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /build
COPY package.json package-lock.json ./
# Native compiler/bundler packages are optional to npm but required for this build.
# Do not cache a nominally successful install that silently omitted either one.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --fetch-retries=2 --fetch-timeout=120000 \
    && ./node_modules/.bin/tsc --version \
    && node --input-type=module -e "await import('vite')"
COPY . .
RUN npm run build && npx --no-install tsc -p tsconfig.release.json
RUN --mount=type=cache,target=/root/.npm npm prune --omit=dev --ignore-scripts --fetch-retries=2 --fetch-timeout=60000

FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /build/package.json ./
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/dist-server ./compiled
COPY --from=build /build/server/migrations ./compiled/server/migrations
COPY deploy/migrate.mjs ./deploy/migrate.mjs
COPY deploy/keyring-init.mjs ./deploy/keyring-init.mjs
COPY deploy/secrets-init.mjs ./deploy/secrets-init.mjs
USER node
CMD ["node", "compiled/server/index.js"]

FROM caddy:2-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f AS web
COPY --from=build /build/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
