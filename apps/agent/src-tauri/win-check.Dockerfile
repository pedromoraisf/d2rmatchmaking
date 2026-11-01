# Local Windows-target check of the agent (AD-071): `cargo clippy --target x86_64-pc-windows-msvc` in a Linux container,
# so the #[cfg(windows)] adapters (token store, toolhelp, OCR) are checked on a machine that is not Windows.
# Only a check: nothing is linked or run, and nothing is installed on the host. CI keeps the native check on
# windows-latest. Driven by scripts/agent/win-check.mjs; build it by hand with the same tag:
#   docker build -f apps/agent/src-tauri/win-check.Dockerfile -t d2rmm-win-check apps/agent/src-tauri
# The image accepts the Microsoft Windows SDK and CRT licence (AD-071): xwin below splats them with --accept-license.

ARG RUST_IMAGE=rust:1.99.1-slim-bookworm@sha256:24707e70a4f1e23d9a7b25202ec43126d28a52294b96aad5c670df1fd1f1d400

# Stage 1: the Windows CRT and SDK headers and libraries (x86_64 only), splatted by a pinned xwin release.
# This stage is discarded; only /xwin is copied into the final image.
FROM ${RUST_IMAGE} AS xwin
ARG XWIN_VERSION=0.10.0
ARG XWIN_SHA256=d870eb4b2f390878af6da1ccd3cf321d22fcb72720984853b4be732ae597fc88
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && curl -fsSL -o /tmp/xwin.tar.gz \
        "https://github.com/Jake-Shadle/xwin/releases/download/${XWIN_VERSION}/xwin-${XWIN_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    && echo "${XWIN_SHA256}  /tmp/xwin.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/xwin.tar.gz -C /tmp "xwin-${XWIN_VERSION}-x86_64-unknown-linux-musl/xwin" \
    && /tmp/xwin-${XWIN_VERSION}-x86_64-unknown-linux-musl/xwin --accept-license --arch x86_64 splat --output /xwin \
    && rm -rf /tmp/xwin.tar.gz /tmp/xwin-${XWIN_VERSION}-x86_64-unknown-linux-musl /root/.xwin-cache /var/lib/apt/lists/*

# Stage 2: the check image.
FROM ${RUST_IMAGE}

# clang-cl compiles the C of the dependencies, lld-link and llvm-lib link and archive, llvm-rc compiles resources.
# Debian ships no clang-cl binary; clang picks its MSVC driver mode from the name it is invoked by, so a link named
# clang-cl is the same compiler in that mode. nasm and cmake are not needed: aws-lc-sys uses its prebuilt NASM objects
# for x86_64-pc-windows-msvc when no nasm is installed, and its cc builder otherwise.
RUN apt-get update \
    && apt-get install -y --no-install-recommends clang lld llvm \
    && ln -s /usr/bin/clang /usr/local/bin/clang-cl \
    && rm -rf /var/lib/apt/lists/*

# The target and clippy, nothing else (minimal profile).
RUN rustup target add x86_64-pc-windows-msvc \
    && rustup component add clippy \
    && rm -rf /usr/local/rustup/tmp /usr/local/rustup/downloads

COPY --from=xwin /xwin /xwin

# The C dependencies (aws-lc-sys through reqwest's rustls) see the Windows headers and use clang-cl and llvm-lib.
ENV CC_x86_64_pc_windows_msvc=clang-cl \
    CXX_x86_64_pc_windows_msvc=clang-cl \
    AR_x86_64_pc_windows_msvc=llvm-lib \
    CFLAGS_x86_64_pc_windows_msvc="/imsvc/xwin/crt/include /imsvc/xwin/sdk/include/ucrt /imsvc/xwin/sdk/include/um /imsvc/xwin/sdk/include/shared" \
    CXXFLAGS_x86_64_pc_windows_msvc="/imsvc/xwin/crt/include /imsvc/xwin/sdk/include/ucrt /imsvc/xwin/sdk/include/um /imsvc/xwin/sdk/include/shared" \
    RC_x86_64_pc_windows_msvc=llvm-rc \
    CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER=lld-link \
    CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="-L native=/xwin/crt/lib/x86_64 -L native=/xwin/sdk/lib/um/x86_64 -L native=/xwin/sdk/lib/ucrt/x86_64"

# A non-root user. The repository is mounted at /work and the cargo registry and target directory are named volumes.
RUN useradd --create-home --uid 1000 builder \
    && mkdir -p /work /cargo-target /home/builder/.cargo/registry \
    && chown -R builder:builder /home/builder /cargo-target /work
ENV CARGO_HOME=/home/builder/.cargo \
    CARGO_TARGET_DIR=/cargo-target
USER builder
WORKDIR /work
