#!/usr/bin/env bash
# Pulls the public "casting product image data for quality inspection" dataset (pump impeller
# castings, top view) and copies a balanced subset into data/samples/kaggle for the sample strip.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v kaggle >/dev/null || { echo "pip install kaggle and put your token in ~/.kaggle/kaggle.json"; exit 1; }
tmp=$(mktemp -d)
kaggle datasets download -d ravirajsinh45/real-life-industrial-dataset-of-casting-product -p "$tmp" --unzip
dest=data/samples/kaggle
mkdir -p "$dest"
find "$tmp" -path '*test*' -name 'cast_def_0_*.jpeg' | head -12 | xargs -I{} cp {} "$dest/"
find "$tmp" -path '*test*' -name 'cast_ok_0_*.jpeg' | head -12 | xargs -I{} cp {} "$dest/"
rm -rf "$tmp"
api/.venv/bin/python -c "import sys; sys.path.insert(0,'api'); from app.seed import seed_samples; seed_samples()"
echo "Added $(ls $dest | wc -l) Kaggle images to the sample strip."
