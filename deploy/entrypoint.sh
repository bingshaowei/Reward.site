#!/bin/sh
set -eu
node dist/migrate.mjs
node dist/init-admin.mjs
exec node server.js
