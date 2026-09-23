# conlang-font-builder

Glyph Editor（ブラウザツール）で書き出した `characters.json` を読み込み、
実際に動く OTF フォントを Node.js + opentype.js で生成するスクリプトです。

## セットアップ

```
npm install
```

## 使い方

```
node build-font.js characters.json MyLanguage
```

- 第1引数: 入力する characters.json のパス（省略時 `characters.sample.json`）
- 第2引数: 出力ファイル名のベース（省略時 `MyLanguage`）

`MyLanguage-Regular.otf` と `MyLanguage-Regular.ttf` が生成されます。

## 実装している機能

- **normal / final 字形**: 各文字を通常形と語末形の2グリフとして書き出し
- **rr 合字（GSUB Lookup Type 4）**: `r` + `r` の連続入力を `rr_liga` グリフに
  自動置換するテーブルを実際に組み込み。フォントを対応エディタで開き
  `rr` と入力すると合字表示になります（`liga` フィーチャー）。
- **voiced マーク**: 各文字ごとに「ベース＋マーク」を **事前合成した1グリフ**
  （`<letter>_voiced`）として書き出し、`U+E0F0`（voiced トリガー文字）を
  直後に入力すると GSUB で合成済みグリフに置換される仕組みです。

## 実装していないこと（正直な制約）

- **GPOS（mark-to-base アンカー結合）は使っていません。**
  opentype.js は GPOS Lookup Type 4 の書き出しに対応していないため
  （パーサー側にも `'GPOS Lookup 4 not supported'` という制約があります）、
  「ベースグリフに動的にマークを重ねる」方式は実現できませんでした。
  代わりに、可能な組み合わせ（文字 × voiced）をすべて事前合成グリフとして
  用意し、GSUB置換で呼び出す方式に変更しています。
  → これは文字数が少ないうちは問題ありませんが、マークの種類が増えると
    組み合わせ爆発（文字数 × マーク数のグリフが必要）になる点に注意してください。
- **真の TrueType（glyf）アウトラインではありません。**
  opentype.js の `Font.toArrayBuffer()` は常に CFF（PostScript曲線）形式の
  sfnt コンテナを出力します。`.ttf` 拡張子で書き出してはいますが、
  中身は `.otf` と同一のCFFデータです。多くのシステムはCFF入りの`.ttf`でも
  問題なく表示できますが、厳密なTrueType glyfアウトラインが必要な場合は
  別途 fonttools（Python）等での変換が必要です。
- **WOFF2 出力は未実装**です。ブラウザで使う場合は生成したOTFを
  fonttools の `fonttools varLib.instancer` や `woff2_compress` 等で
  変換するのが現実的です。

## 座標系の変換について

Glyph Editor のキャンバスは 360×440px、baseline は y=340（上が原点、下方向が
プラス）という前提で座標を保存しています。このスクリプトはその座標を
OpenTypeのem単位（unitsPerEm=1000、baseline=0、上方向がプラス）に変換します。
Glyph Editor 側のキャンバスサイズを変更した場合は、`build-font.js` 冒頭の
`CANVAS_H` / `BASELINE_Y` の値も合わせて変更してください。

## 動作確認方法

```
node -e "
const opentype = require('opentype.js');
const font = opentype.loadSync('MyLanguage-Regular.otf');
console.log(font.numGlyphs, 'glyphs');
console.log('GSUB:', !!font.tables.gsub);
"
```

macOS の Font Book や FontDrop!（https://fontdrop.info/）にドラッグ&ドロップ
すると、実際のグリフ形状とGSUBフィーチャーの一覧を視覚的に確認できます。
