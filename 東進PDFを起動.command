#!/bin/zsh
# Finderからダブルクリックして実行します。
set -u
cd -- "$(dirname -- "$0")" || exit 1

# Finderからの起動では、対話シェルのPATHが引き継がれない場合があります。
export PATH="$HOME/.local/share/fnm/aliases/default/bin:$HOME/.volta/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  export NVM_DIR="$HOME/.nvm"
  source "$NVM_DIR/nvm.sh"
fi

fail() {
  printf '\n%s\n\n' "$1"
  printf 'このウィンドウを閉じるには Enter を押してください。'
  read -r _
  exit 1
}

printf '東進 PDF 整理を準備しています…\n'
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  fail 'Node.js 20以上とnpmが必要です。https://nodejs.org/ からインストールして再度起動してください。'
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  fail 'Node.js 20以上が必要です。Node.jsを更新して再度起動してください。'
fi

if ! node --input-type=module -e "await import('playwright'); await import('pdf-lib')" >/dev/null 2>&1; then
  printf '初回セットアップ: 必要なパッケージをインストールしています…\n'
  npm ci --no-audit --no-fund || fail 'パッケージのインストールに失敗しました。ネットワークを確認し、再度起動してください。'
fi
if ! node --input-type=module -e "import {chromium} from 'playwright'; import {existsSync} from 'node:fs'; process.exit(existsSync(chromium.executablePath()) ? 0 : 1)"; then
  printf '初回セットアップ: 専用ブラウザをインストールしています…\n'
  npx playwright install chromium || fail 'ブラウザのインストールに失敗しました。ネットワークを確認し、再度起動してください。'
fi
printf '\nGUIを起動します。このウィンドウは終了するまで開いたままにしてください。\n'
npm run gui
launch_status=$?
if (( launch_status != 0 )); then
  fail '起動できませんでした。上記のエラー、または既に起動中のブラウザがないか確認してください。'
fi
