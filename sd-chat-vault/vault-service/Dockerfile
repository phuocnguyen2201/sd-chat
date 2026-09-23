# Build and run the vault service. Two stages so the shipped image carries no
# TypeScript toolchain and no dev dependencies.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Blobs and the JWKS cache live on a mounted volume, never in the image layer.
# The path matches the compose file's mount point.
VOLUME /opt/sd-chat-vault

# The directory has to exist in the image, owned by `node`, BEFORE the volume is
# mounted over it. Docker copies the image's ownership onto a named volume when
# it first creates it; with no directory here the volume would be created owned
# by root and this unprivileged process could not write a single backup.
RUN mkdir -p /opt/sd-chat-vault/backups && chown -R node:node /opt/sd-chat-vault

# Unprivileged: this process only ever reads and writes that one directory.
USER node

EXPOSE 8443
CMD ["node", "dist/index.js"]
