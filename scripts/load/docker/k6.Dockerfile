# k6 with the xk6-sse extension (AD-114). Built from pinned sources in a builder stage; k6 never auto-provisions
# extensions at run time. Pins:
#   golang:1.27.1-alpine      digest of the tag (builder)
#   grafana/k6:2.3.0          digest of the tag (k6 base; its k6 binary is replaced by the one built here)
#   xk6                       commit of tag v1.4.15
#   xk6-sse                   commit of tag v0.2.0
# Build: docker build -f scripts/load/docker/k6.Dockerfile scripts/load/docker

FROM --platform=$BUILDPLATFORM golang:1.27.1-alpine@sha256:8a5910f31396cd4d89662f56c68b3ae31d374308270a1c3bd96672ee5ed43414 AS builder

ARG TARGETOS
ARG TARGETARCH
# K6_RELEASE is not named K6_VERSION: a build ARG is exported to RUN, and xk6 reads K6_VERSION as its own flag.
ARG K6_RELEASE=v2.3.0
ARG XK6_COMMIT=971105042f8d3aaedd9a6b3e6b46561f92910eb3
ARG XK6_SSE_COMMIT=6f12f6a6cd8cd7e0f6d1797dc31880ad89561284

ENV CGO_ENABLED=0 \
    GOFLAGS=-mod=readonly

RUN apk --no-cache add git=~2

RUN go install go.k6.io/xk6/cmd/xk6@${XK6_COMMIT}

RUN GOOS=${TARGETOS} GOARCH=${TARGETARCH} xk6 build --k6-version ${K6_RELEASE} \
      --with github.com/phymbert/xk6-sse=github.com/phymbert/xk6-sse@${XK6_SSE_COMMIT} \
      --output /usr/bin/k6

FROM grafana/k6:2.3.0@sha256:2dd4756ec6e14e62778916e1eb850108e4b499304c02df56760fa0bdb0fba0b8

COPY --from=builder /usr/bin/k6 /usr/bin/k6
