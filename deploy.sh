#!/bin/bash

# development tool
# ./deploy <commit> <branch> <version (if branch=master)>

COMMIT_MSG="$1"
BRANCH="$2"
VERSION="$3"

if [ -z "$COMMIT_MSG" ] || [ -z "$BRANCH" ]; then
    echo "Uso: ./deploy <commit> <branch> [version if branch=master]"
    exit 1
fi

echo "Rewriting config.js"
cat > "src/config.js" << 'EOF'
export const CLIENT_ID = "bot_permanente";
export const BOT_PREFIX = "🤖 *ManyBot:* ";
export const CHATS = [
    // coloque os chats que quer aqui
];
EOF

# mudar para a branch
git checkout $BRANCH || { echo "Error ao change to $BRANCH"; exit 1; }

# se for master, atualizar versão
if [ "$BRANCH" == "master" ] && [ -n "$VERSION" ]; then
    echo "Updating version to $VERSION"
    git tag $VERSION
    npm version $VERSION --no-git-tag-version
    git add package.json
    git commit -m "Bump version to $VERSION"
    git push origin $VERSION
fi

# adicionar alterações e commit
git add .
git commit -m "$COMMIT_MSG"

# push
git push origin $BRANCH

echo "Deploy completed."