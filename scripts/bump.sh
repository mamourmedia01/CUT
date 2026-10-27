#!/bin/sh
# Release: bump the app version in sw.js and every ?v= in index.html together.
set -e
cd "$(dirname "$0")/.."
OLD=$(sed -n "s/^const V = '\([0-9]*\)';/\1/p" sw.js)
NEW=$((OLD + 1))
sed -i "s/^const V = '$OLD';/const V = '$NEW';/" sw.js
sed -i "s/?v=$OLD\"/?v=$NEW\"/g" index.html
echo "v$OLD -> v$NEW"
