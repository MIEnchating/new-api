FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS builder

WORKDIR /build/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY ./web ./
COPY ./VERSION /build/VERSION
RUN DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(cat /build/VERSION) bun run build

FROM golang:1.26.10-alpine@sha256:9ce231b28998b32e116927c61aa5c406183061d4f3f2d61b292c88e7f6bdf7ca AS builder2
ENV GO111MODULE=on CGO_ENABLED=0 GOWORK=off

ARG TARGETOS
ARG TARGETARCH
ENV GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64}
ENV GOEXPERIMENT=greenteagc

WORKDIR /build

ADD go.mod go.sum ./
# relaykit, tokenkit and pluginkit are local submodules referenced via replace;
# their go.mod files must be present for go mod download to resolve the main
# module graph.
ADD relaykit/go.mod ./relaykit/go.mod
ADD tokenkit/go.mod ./tokenkit/go.mod
ADD pluginkit/go.mod ./pluginkit/go.mod
# Registry and module proxies can transiently fail during a release. Retry the
# dependency download so a single network blip cannot publish an incomplete
# architecture image or leave the release workflow in a partial state.
RUN for attempt in 1 2 3; do \
      if go mod download; then exit 0; fi; \
      echo "go mod download failed (attempt ${attempt}/3)" >&2; \
      if [ "${attempt}" -lt 3 ]; then sleep $((attempt * 10)); fi; \
    done; \
    exit 1

COPY . .
COPY --from=builder /build/web/dist ./web/dist
RUN go build -pgo="$(go list -m -f '{{.Dir}}' github.com/MoeForge/moejs)/default.pgo" -ldflags "-s -w -X 'github.com/QuantumNous/new-api/common.Version=$(cat VERSION)'" -o new-api

FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS model-detector

WORKDIR /opt/model-detection
COPY scripts/model-detection/package.json scripts/model-detection/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM debian:bookworm-slim@sha256:f06537653ac770703bc45b4b113475bd402f451e85223f0f2837acbf89ab020a

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata libasan8 wget \
        poppler-utils tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates

COPY --from=model-detector /usr/local/bin/node /usr/local/bin/node
COPY --from=model-detector /opt/model-detection/node_modules /opt/model-detection/node_modules
ENV MODEL_DETECTION_CLI_PATH=/opt/model-detection/node_modules/.bin/fpd

COPY --from=builder2 /build/new-api /
COPY LICENSE NOTICE THIRD-PARTY-LICENSES.md /licenses/
COPY --from=model-detector /usr/local/LICENSE /licenses/Node-LICENSE
EXPOSE 3000
WORKDIR /data
ENTRYPOINT ["/new-api"]
