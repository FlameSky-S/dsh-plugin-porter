#!/usr/bin/env sh
# Install dsh-plugin-porter on an isolated intranet machine (Linux/macOS).
# No npm / pnpm / network required. Node.js is used only to merge package.json.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SOURCE="$SCRIPT_DIR/porter"
[ -f "$SOURCE/package.json" ] || SOURCE=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

if [ ! -f "$SOURCE/package.json" ]; then
  echo "[ERROR] Cannot find dsh-plugin-porter package next to this script." >&2
  exit 1
fi

NAME=$(node -e 'const p=require(process.argv[1]);process.stdout.write(p.name||"")' "$SOURCE/package.json")
VERSION=$(node -e 'const p=require(process.argv[1]);process.stdout.write(p.version||"")' "$SOURCE/package.json")
if [ "$NAME" != "dsh-plugin-porter" ]; then
  echo "[ERROR] Unexpected package name: $NAME" >&2
  exit 1
fi

PROFILE="${1:-${DSH_PROFILE_DIR:-}}"
if [ -z "$PROFILE" ]; then
  DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
  PROFILE="$DSH_HOME_DIR/profiles/desktop"
fi
PROFILE=$(CDPATH= cd -- "$PROFILE" && pwd)
if [ ! -f "$PROFILE/package.json" ]; then
  echo "[ERROR] Not a DSH profile (no package.json): $PROFILE" >&2
  echo "        Set DSH_PROFILE_DIR or pass the profile as the first argument." >&2
  exit 1
fi

STAMP=$(date -u +%Y%m%d-%H%M%S)
BACKUP_ROOT="$PROFILE/.dsh-plugin-porter/backups/install-$STAMP"
TARGET="$PROFILE/node_modules/$NAME"

echo ""
echo "DSH Plugin Porter - intranet install"
echo "===================================="
echo "  package: $NAME@$VERSION"
echo "  source : $SOURCE"
echo "  profile: $PROFILE"
echo "  backup : $BACKUP_ROOT"
echo ""

mkdir -p "$BACKUP_ROOT" "$PROFILE/node_modules"
cp "$PROFILE/package.json" "$BACKUP_ROOT/package.json"

if [ -e "$TARGET" ]; then
  OLD="$PROFILE/node_modules/.$NAME-old-$STAMP"
  echo "  moving old package to: $OLD"
  mv "$TARGET" "$OLD"
fi

cleanup() {
  if [ -e "$TARGET" ] && [ -d "$TARGET" ]; then rm -rf "$TARGET"; fi
  if [ -n "${OLD:-}" ] && [ -e "$OLD" ]; then mv "$OLD" "$TARGET"; fi
  cp "$BACKUP_ROOT/package.json" "$PROFILE/package.json" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "  copying package files..."
cp -R "$SOURCE" "$TARGET"

echo "  updating profile/package.json..."
node - "$PROFILE/package.json" "$NAME" "$VERSION" <<'NODE'
const fs = require('fs');
const [pkgPath, name, version] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.dependencies = pkg.dependencies || {};
pkg.dependencies[name] = version;
pkg.dsh = pkg.dsh || {};
pkg.dsh.profile = pkg.dsh.profile || {};
const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
if (!bundles.includes(name)) bundles.push(name);
pkg.dsh.profile.bundles = bundles;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
const check = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (check.dependencies[name] !== version) throw new Error('dependency write check failed');
if (!check.dsh.profile.bundles.includes(name)) throw new Error('bundle write check failed');
NODE

trap - EXIT INT TERM
echo ""
echo "  [OK] Installed $NAME@$VERSION"
echo ""
echo "Next steps:"
echo "  1. Fully quit DSH and restart it."
echo "  2. Open Settings -> Plugin Porter -> Import, then scan the export folder."
echo "  3. Previous package files (if any) are in $BACKUP_ROOT (package.json)"
echo "     or $PROFILE/node_modules/.$NAME-old-$STAMP (old package)."
echo ""
