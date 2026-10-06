// 全站终检：title ≤60、description ≤160、:root 内主色与全站基线一致
//
// 主色白名单：站点存在两套合法命名，各自对应 theme.css 官方色阶。
//  - #A67D7A（--brand）= theme.css 的 --accent-deep，主色
//  - #C09D9B（--brand）= theme.css 的 --accent 浅阶，配合 --brand-dark:#A67D7A 使用
// 出现 #1f5fd0 / #2f5fe0 / #175e63 / #1d4ed8 等冷蓝色即说明该页自建色板（真分裂）。
import { readdirSync, readFileSync } from "fs";

const LIMIT_T = 60;
const LIMIT_D = 160;
const OK_BRAND = new Set(["#a67d7a", "#c09d9b"]);

const files = readdirSync("site").filter((f) => f.endsWith(".html"));
const badT = [];
const badD = [];
const badBrand = [];

for (const f of files) {
  const h = readFileSync(`site/${f}`, "utf8");
  const t = (h.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
  const d = (h.match(/name="description" content="([^"]*)"/) || [])[1] || "";
  const rm = h.match(/:root\s*\{([^}]*)\}/);
  const v = rm ? ((rm[1].match(/--brand:\s*(#[0-9a-fA-F]+)/) || [])[1] || "") : "";

  if (t.length > LIMIT_T) badT.push(`${f}=${t.length}`);
  if (d.length > LIMIT_D) badD.push(`${f}=${d.length}`);
  if (v && !OK_BRAND.has(v.toLowerCase())) badBrand.push(`${f}=${v}`);
}

console.log(`扫描页数 = ${files.length}`);
console.log(`title > ${LIMIT_T} = ${badT.length}${badT.length ? " -> " + badT.join(", ") : ""}`);
console.log(`desc > ${LIMIT_D} = ${badD.length}${badD.length ? " -> " + badD.join(", ") : ""}`);
console.log(`异常 --brand = ${badBrand.length}${badBrand.length ? " -> " + badBrand.join(", ") : ""}`);
console.log(badT.length + badD.length + badBrand.length === 0 ? "✅ 全站终检通过" : "⚠️ 有残留");
process.exit(badT.length + badD.length + badBrand.length === 0 ? 0 : 1);