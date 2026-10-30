# Reproducible Tensor Safe image for Caution (AWS Nitro Enclaves).
# Caution runs exactly `docker build -f Containerfile .` from the repo root, with
# no build args, so every build input is pinned here or tracked in git.
#
# StageX sx2026.09.0 (linux/amd64). StageX ships no Node 22 >= 22.13 (its last
# 22.x is 22.11, which still needs --experimental-sqlite); 26.8.1 is the current
# StageX Node and satisfies `engines: >=22.13`.

FROM stagex/pallet-nodejs:sx2026.09.0@sha256:2298914fdcffacb4662a8d629545c6c8823cb657cb57983f2b8eb5803636589b AS build
ENV SOURCE_DATE_EPOCH=1 \
    TZ=UTC \
    npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false
# Build-only: the musl Rust bindings of rolldown, Tailwind and lightningcss link
# libgcc_s, which the Node pallet lacks. Not copied into the runtime image.
COPY --from=stagex/core-gcc:sx2026.09.0@sha256:396679821776a7da0e5806e9ce78fd92113452a0977d90956f62a7caa32520db /usr/lib/libgcc_s.so.1 /usr/lib/
WORKDIR /src

# The only network step: locked dependencies from package-lock.json, without
# install scripts. The production tree is installed offline from the same cache.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts \
 && mkdir /prod \
 && cp package.json package-lock.json /prod/ \
 && cd /prod && npm ci --omit=dev --ignore-scripts --offline

COPY . .
RUN --network=none <<'EOF'
set -eu
R=/rootfs

# Caution's Locksmith inputs, at the paths its docs specify, when present.
# Self-hosted builds have none and pass secrets as ordinary env vars instead;
# a Caution deployment without them can't unlock DATABASE_URL / DATA_KEY.
if [ -f .caution/quorum-bundle.json ]; then
  mkdir -p $R/etc/caution
  cp .caution/quorum-bundle.json $R/etc/caution/bundle.json
  cp .caution/keymaker-pcr-policy.json $R/etc/caution/keymaker-pcr-policy.json
  cp -R .caution/secrets $R/etc/caution/secrets
fi
# Keep .caution out of Tailwind's source scan so CSS depends on app source only.
rm -rf .caution

npm run build

mkdir -p $R/app $R/usr/bin $R/usr/lib $R/etc/ssl/certs
cp -R dist db $R/app/
cp -R /prod/node_modules /prod/package.json $R/app/

# Node plus exactly the shared libraries it links (/lib is /usr/lib in StageX).
cp /usr/bin/node $R/usr/bin/node
cp -L /lib/ld-musl-x86_64.so.1 $R/usr/lib/
ldd /usr/bin/node | awk '$2 == "=>" { print $1, $3 }' | while read -r name path; do
  cp -L "$path" "$R/usr/lib/$name"
done
# StageX Node trusts OpenSSL's default store (OPENSSLDIR=/etc/ssl); without
# cert.pem every outbound TLS (RPC, Postgres) fails. Same layout as the pallet.
cp /etc/ssl/certs/ca-certificates.crt $R/etc/ssl/certs/
ln -s certs/ca-certificates.crt $R/etc/ssl/cert.pem

# Normalize metadata: fixed mtimes and modes, root-owned and read-only for the
# runtime user (0644 files / 0755 dirs, as Caution requires for /etc/caution).
find $R -type d -exec chmod 0755 {} +
find $R -type f -exec chmod 0644 {} +
chmod 0755 $R/usr/bin/node
# The kernel execs the ELF interpreter, so the loader (and, by convention, the
# shared libraries) must stay executable; emulators hide this, native hosts don't.
chmod 0755 $R/usr/lib/ld-musl-x86_64.so.1 $R/usr/lib/*.so*
find $R -exec touch -h -d @0 {} +
# The one writable path: SQLite for self-hosting (mount a volume here).
mkdir -p $R/data
chown 1000:1000 $R/data
touch -h -d @0 $R/data
EOF

FROM stagex/core-filesystem:sx2026.09.0@sha256:da28831927652291b0fa573092fd41c8c96ca181ea224df7bff40e1833c3db13
COPY --from=build /rootfs /
USER 1000:1000
WORKDIR /app
# Defaults for self-hosting; caution.hcl sets its own. PUBLIC_ORIGIN is required.
ENV PORT=8080 \
    STATIC_DIR=/app/dist/client \
    DB_DIR=/app/db \
    DATABASE_PATH=/data/tensor-safe.db
EXPOSE 8080
ENTRYPOINT ["/usr/bin/node", "/app/dist/server/main.js"]
