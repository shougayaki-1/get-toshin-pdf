# Architecture / システム設計

## 目的と責任範囲

個人利用で許可された「共通テスト過去問演習講座」の問題PDFを、ローカルに収集して科目別に2-in-1へ組版する。東進のシステムにログインするのはユーザー本人。認証突破・無差別巡回・第三者への配布は対象外。

## アーキテクチャ

```text
Playwright (persistent Chromium profile under .local/)
  └─ User logs into pos.toshin.com manually
      └─ Print page: MondaiKaitoInsatsu?EnshuSetId=...&DaimonId=...
          └─ Existing PDF-download anchor: Contents/GetMondaiPdf?daimonId=<opaque>
              └─ same browser context request.get()
                  ├─ validate PDF signature
                  ├─ raw/<SHA256>.pdf
                  └─ manifest.json (metadata, no URL/token)
                       └─ process.js
                           ├─ infer direction from explicitly selected subject
                           ├─ pdf-lib 2-in-1 (crop/rotation/safe margin)
                           └─ output/<科目>/<年度>_<科目>_<回次>_問題_<識別子>_<hash>.pdf
```

## なぜこの方式か

ログイン後の一覧API・内部トークン形式は未検証。印刷画面で実際に示されたリンクのみ取得することで、利用可能な機能を使い、署名・トークン構造を決め打ちしない。POSトップメニューにはASP.NETの `__doPostBack` があるため、単なるURL列挙よりブラウザ経由のナビゲーションが確実。

## 制約

- 初期版は**既にブラウザで開いた**印刷ページを対象。全年度・全科目自動巡回は未実装。
- 印刷ページには科目・回次などのメタデータが表示されない場合がある。そのため起動時に `--subject`、必要に応じ `--year` / `--round` を指定する。科目・回次が変わるときは別セッションにする。
- PDFダウンロードURLの有効期間、Refererの要求、SSOの挙動は実機で要検証。
- 実サイトの認証済み操作・PDF取得は開発者の環境で確認が必要。現時点で動作保証しない。
- ダウンロード間隔は最短1.5秒。認証拒否・404・リダイレクトは再試行せず、それ以外は最大3回、30秒以上空けて再試行。失敗したものは起動し直して再試行可能。
- ログはPDF URLのクエリ、Cookie、トークンを出力しない。PDF・ブラウザプロファイル・manifestはGit管理対象外。
- PDF原本は変換後も保持。SHA-256で再取得を抑制し、処理済みPDFも再処理しない。

## 参考コード

PDF組版は [shougayaki-1/chrome-extension-2-in-1](https://github.com/shougayaki-1/chrome-extension-2-in-1) の `src/layout.js` / `src/pdf-transform.js` を元にした同等実装。安全余白12pt、CropBox/MediaBox交差と回転を反映。

## セキュリティ

認証情報の入力・保存をスクレイパーに要求しない。ブラウザプロファイルは `.local/browser-profile` に限定し、外部と共有しない。共通テスト対策の正規印刷ページと同一ホストの正規PDFエンドポイントにのみアクセスする。PDF URLはメモリに一時保持し、ファイルに書かない。
