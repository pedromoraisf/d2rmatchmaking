# The API under test (design.md § Images and TLS; AD-112): the build and the start command of render.yaml, nothing else.
# Built from the repository root (`docker build -f scripts/load/docker/api.Dockerfile -t <tag> .`): the context is filtered by
# the root .dockerignore, which is deny-by-default, so only what the install and the API need reaches the image. No
# certificate, key, secret or build argument is copied or set; the database and the CA arrive when the container starts.
#   base          node:26-bookworm-slim, pinned by digest (scripts/load/lib/images.mjs NODE_SLIM_IMAGE)
#   install       corepack enable && pnpm install --frozen-lockfile --ignore-scripts   (render.yaml buildCommand)
#   start         node --import ./apps/api/src/main/instrument.ts apps/api/src/main/render.ts   (render.yaml startCommand)

FROM node:26-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9

WORKDIR /app

COPY . .

RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts

USER node

CMD ["node", "--import", "./apps/api/src/main/instrument.ts", "apps/api/src/main/render.ts"]
