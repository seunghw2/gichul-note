#!/bin/sh
# dist를 빌드해서 gh-pages 브랜치로 강제 푸시한다 (GitHub Pages 소스 = gh-pages 브랜치)
set -e
npm run build
cd dist
touch .nojekyll
git init -q -b gh-pages
git add -A
git commit -q -m "deploy $(date '+%Y-%m-%d %H:%M')"
git push -q -f "$(git -C .. remote get-url origin)" gh-pages
rm -rf .git
echo "배포 완료: https://seunghw2.github.io/gichul-note/"
