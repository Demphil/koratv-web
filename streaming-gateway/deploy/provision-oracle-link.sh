#!/usr/bin/env bash
set -euo pipefail
umask 077
dir=/etc/koratv/oracle-link
source_dir=$(cd "$(dirname "$0")" && pwd)
install -d -m 0700 "$dir"
if ! test -f "$dir/ca.key"; then
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$dir/ca.key"
  openssl req -new -x509 -key "$dir/ca.key" -sha256 -days 3650 \
    -subj '/CN=Koratv Private Edge CA' -addext 'basicConstraints=critical,CA:TRUE' \
    -addext 'keyUsage=critical,keyCertSign,cRLSign' -out "$dir/ca.crt"
fi
for role in server client; do
  if test -f "$dir/$role.crt"; then continue; fi
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$dir/$role.key"
  openssl req -new -key "$dir/$role.key" -subj "/CN=koratv-edge-$role" -out "$dir/$role.csr"
  openssl x509 -req -in "$dir/$role.csr" -CA "$dir/ca.crt" -CAkey "$dir/ca.key" \
    -set_serial "0x$(openssl rand -hex 16)" -days 730 -sha256 \
    -extfile "$source_dir/oracle-link-$role.ext" -out "$dir/$role.crt"
done
chmod 0600 "$dir/"*.key
openssl verify -CAfile "$dir/ca.crt" -purpose sslserver "$dir/server.crt"
openssl verify -CAfile "$dir/ca.crt" -purpose sslclient "$dir/client.crt"
