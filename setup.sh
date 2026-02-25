#!/bin/bash
# Google Calendar OAuth2 client_id をローカルの manifest.json に設定するスクリプト
# usage: ./setup.sh <client_id>
#   例: ./setup.sh 990076197577-xxxxx.apps.googleusercontent.com

set -e
cd "$(dirname "$0")"

if [ -z "$1" ]; then
  echo "使い方: ./setup.sh <OAuth2_CLIENT_ID>"
  echo "  例: ./setup.sh 123456789-abcdef.apps.googleusercontent.com"
  exit 1
fi

CLIENT_ID="$1"

if [[ ! "$CLIENT_ID" == *.apps.googleusercontent.com ]]; then
  echo "エラー: client_id は .apps.googleusercontent.com で終わる必要があります"
  exit 1
fi

sed -i "s|YOUR_CLIENT_ID.apps.googleusercontent.com|${CLIENT_ID}|" manifest.json

echo "manifest.json に client_id を設定しました: ${CLIENT_ID}"
echo ""
echo "次のステップ:"
echo "  1. chrome://extensions で拡張機能を再読み込み"
echo "  2. ポップアップの「カレンダーからインポート」ボタンで利用可能"
echo ""
echo "※ manifest.json の変更は git commit しないでください"
