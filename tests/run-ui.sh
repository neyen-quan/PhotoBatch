#!/usr/bin/env bash
set -eu
export LD_LIBRARY_PATH="$PWD/build/test-deps/root/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
export DISPLAY=127.0.0.1:105
build/test-deps/root/usr/bin/Xvfb :105 -screen 0 1440x1050x24 -ac -nolisten local -nolisten unix -listen tcp >tests/xvfb.log 2>&1 &
xpid=$!
trap 'kill "$xpid" 2>/dev/null || true' EXIT
node -e 'const net=require("net");let n=0;function check(){const c=net.connect(6105,"127.0.0.1",()=>{c.end();process.exit(0)});c.on("error",()=>{if(++n>30)process.exit(1);setTimeout(check,100)})}check()'
node tests/ui-test.cjs
