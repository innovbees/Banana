#!/usr/bin/env bash
# Builds the portable BananaCAD executables into ../dist. The web app in ../cad is
# embedded in the executable; Windows gets an icon, version info and a DPI-aware manifest.
# Needs Go 1.24+ and go-winres (go install github.com/tc-hib/go-winres@v0.3.3).
set -euo pipefail
cd "$(dirname "$0")"
VERSION=${VERSION:-1.0.0}
trap 'rm -rf app rsrc_windows_*.syso' EXIT
rm -rf app && mkdir app
cp -r ../cad/index.html ../cad/icon.png ../cad/css ../cad/js ../cad/lib app/
WINRES=${WINRES:-$(command -v go-winres || echo "$HOME/go/bin/go-winres")}
"$WINRES" simply --arch amd64 --icon ../cad/icon.png --manifest gui \
  --product-name BananaCAD --file-description "BananaCAD - 2D drafting (DWG/DXF)" \
  --product-version "$VERSION" --file-version "$VERSION" --original-filename BananaCAD.exe \
  --copyright "BananaCAD; includes LibreDWG (GPL-3.0) and acad-ts (MIT)" --out rsrc
mkdir -p ../dist
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui" -o ../dist/BananaCAD.exe .
rm -f rsrc_windows_*.syso
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o ../dist/BananaCAD-linux .
ls -la ../dist
