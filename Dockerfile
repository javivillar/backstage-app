# Stage 1 - Create yarn install skeleton layer
FROM node:22-bookworm-slim AS packages

WORKDIR /app
COPY package.json yarn.lock ./

COPY packages packages
COPY plugins plugins

RUN find packages \! -name "package.json" -mindepth 2 -maxdepth 2 -exec rm -rf {} \+

# Stage 2 - Install dependencies and build packages
FROM node:22-bookworm-slim AS build

USER node
WORKDIR /app

COPY --from=packages --chown=node:node /app .

RUN --mount=type=cache,target=/home/node/.cache/yarn,sharing=locked,uid=1000,gid=1000 \
    yarn install --frozen-lockfile --network-timeout 600000

COPY --chown=node:node . .

RUN yarn tsc
RUN yarn --cwd packages/backend build

RUN mkdir packages/backend/dist/skeleton packages/backend/dist/bundle \
    && tar xzf packages/backend/dist/skeleton.tar.gz -C packages/backend/dist/skeleton \
    && tar xzf packages/backend/dist/bundle.tar.gz -C packages/backend/dist/bundle

# Stage 3 - Build the actual backend image and install production dependencies
FROM node:22-bookworm-slim

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv g++ build-essential ca-certificates curl

RUN yarn config set python /usr/bin/python3

# Add kubectl for the kube apply plugin
RUN curl -L -o /usr/local/bin/kubectl https://dl.k8s.io/release/v1.29.9/bin/linux/amd64/kubectl && chmod +x /usr/local/bin/kubectl

# Add cnoe-cli v0.1.0. Its sha256 is pinned here (the one of the release's checksums.txt): the release asset host
# answered 504 for checksums.txt on 2026-11-08 and broke every image build. Downloads retry on any error.
ARG CNOE_CLI_SHA256=55a421f62963c74cb83880983fe360fa6cb1862444e15e4d74c15dd50bbe5fe4
RUN curl -fsSL --retry 10 --retry-delay 10 --retry-all-errors -o cnoe_Linux_x86_64.tar.gz \
      https://github.com/cnoe-io/cnoe-cli/releases/download/v0.1.0/cnoe_Linux_x86_64.tar.gz && \
    echo "${CNOE_CLI_SHA256}  cnoe_Linux_x86_64.tar.gz" | sha256sum -c --strict --status && \
    tar -xzf cnoe_Linux_x86_64.tar.gz && \
    mv cnoe /usr/bin/cnoe-cli && \
    chmod +x /usr/bin/cnoe-cli && \
    rm cnoe_Linux_x86_64.tar.gz
COPY ./cnoe-wrapper.sh /usr/bin/cnoe
RUN chmod +x /usr/bin/cnoe

# Add mkdocs for TechDocs
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"
RUN pip3 install 'mkdocs-techdocs-core==1.4.2'

# Claude Code, for the runner "claude-code" of the operations assistant (plugins/ops-assistant-backend/src/claudeCode.ts):
# it answers with the operator's Claude subscription instead of the API. Pinned; it never updates itself
# (DISABLE_AUTOUPDATER in the runner).
ARG CLAUDE_CODE_VERSION=2.1.296
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && claude --version

USER node
WORKDIR /app

COPY --from=build --chown=node:node /app/yarn.lock /app/package.json /app/packages/backend/dist/skeleton/ ./

RUN --mount=type=cache,target=/home/node/.cache/yarn,sharing=locked,uid=1000,gid=1000 \
    yarn install --frozen-lockfile --production --network-timeout 600000

COPY --from=build --chown=node:node /app/packages/backend/dist/bundle/ ./
COPY --chown=node:node app-config.yaml app-config.production.yaml ./

ENV NODE_ENV production
ENV NODE_OPTIONS="--no-node-snapshot"

CMD ["node", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.production.yaml"]
