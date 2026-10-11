#!/bin/sh
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
node server/index.js
