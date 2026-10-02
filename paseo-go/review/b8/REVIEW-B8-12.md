# REVIEW-B8-12 [P3] ImportClaimSummary 测钉 i18n options JSON 键序，无害重排即碎

## 现象

t(key,{count,shown}) 调换成 {shown,count} 测红而用户行为不变。

## 根因

`import.test.tsx:207-209` 断言整串 JSON 序列化顺序。

## 修复方向

JSON 段 parse 后 toEqual({count,shown})，键前缀单独断言。

## 验收

调换 options 键序现测红、改后绿；数值错传仍必红。

## 复核（RevB8）

**CONFIRMED（维持 P3）** — import.test.tsx:207-209 断言整串 `'import.claimedSummary {"count":6597,"shown":200}'`；mock t（:19-20）用 `JSON.stringify(options)` 回显，键序=调用点字面序（import.tsx:411 `{ count, shown }`）。把调用点换成 `{ shown, count }` 用户可见文案不变而测必红——脆弱性成立。数值错传仍会被整串抓住（非空洞），P3 定级恰当；修复方向（parse 后 toEqual + 键前缀单钉）两全。
