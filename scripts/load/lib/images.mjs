// The pinned image references of the run (design.md § Images and TLS; LB-01). Pure data: the container builders take these
// as parameters (`container-spec.mjs`), and the static test reads them.
//
// Every image the run pulls carries a tag and a `@sha256:` digest, the index digest of the tag (it covers every platform),
// looked up with `docker buildx imagetools inspect` on 2026-11-03. The two images the run builds (the API and k6) carry a
// local tag: an image id changes with every build, so their pins are the `FROM` lines of their Dockerfiles, which the static
// test compares with the constants below.

/** Postgres 17 for the throwaway database with TLS (the image the integration tests already pull). */
export const POSTGRES_IMAGE =
  'postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b';

/** The meter and the sink run `node` from this image, with `scripts/load` mounted read-only. */
export const NODE_ALPINE_IMAGE =
  'node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94';

/** The base of the API image (`api.Dockerfile`) and of the spike's fixture server. */
export const NODE_SLIM_IMAGE =
  'node:26-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9';

/** The builder stage of the k6 image (`k6.Dockerfile`): xk6 and xk6-sse are compiled here. */
export const GOLANG_BUILDER_IMAGE =
  'golang:1.27.1-alpine@sha256:8a5910f31396cd4d89662f56c68b3ae31d374308270a1c3bd96672ee5ed43414';

/** The base of the k6 image; its k6 binary is replaced by the one the builder compiles. */
export const K6_BASE_IMAGE =
  'grafana/k6:2.3.0@sha256:2dd4756ec6e14e62778916e1eb850108e4b499304c02df56760fa0bdb0fba0b8';

/** The API image the run builds from `api.Dockerfile`: a local tag, pinned by its FROM line (NODE_SLIM_IMAGE). */
export const API_IMAGE_TAG = 'd2rmm-load-api:f0';

/** The k6 image the run builds from `k6.Dockerfile`: a local tag, pinned by its FROM lines. */
export const K6_IMAGE_TAG = 'd2rmm-load-k6:f0';
