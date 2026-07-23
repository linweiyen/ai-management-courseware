import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "..");
const sourcePath = path.join(srcDir, "archive", "v1-single-file", "presentation_v1.html");
const outDir = path.join(srcDir, "v4");
const slidesDir = path.join(outDir, "slides");
const source = await fs.readFile(sourcePath, "utf8");

const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function plainText(html) {
  return html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 52) || "page";
}

function findMatchingElement(html, start) {
  const open = html.slice(start).match(/^<([a-zA-Z][\w:-]*)\b[^>]*>/);
  if (!open) throw new Error(`No opening element at ${start}`);
  const tag = open[1].toLowerCase();
  if (voidTags.has(tag) || open[0].endsWith("/>")) return start + open[0].length;
  const token = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  token.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = token.exec(html))) {
    const closing = match[0].startsWith("</");
    const selfClosing = match[0].endsWith("/>");
    if (closing) depth -= 1;
    else if (!selfClosing) depth += 1;
    if (depth === 0) return token.lastIndex;
  }
  throw new Error(`Unclosed <${tag}> at ${start}`);
}

function extractElement(html, pattern, from = 0) {
  const match = pattern.exec(html.slice(from));
  if (!match) return null;
  const start = from + match.index;
  return { start, end: findMatchingElement(html, start), html: html.slice(start, findMatchingElement(html, start)) };
}

function innerHtml(element) {
  const first = element.indexOf(">");
  const last = element.lastIndexOf("</");
  return element.slice(first + 1, last);
}

function topLevelElements(html) {
  const result = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start < 0) break;
    if (/^<\!--/.test(html.slice(start))) {
      const end = html.indexOf("-->", start);
      cursor = end < 0 ? html.length : end + 3;
      continue;
    }
    if (!/^<[a-zA-Z]/.test(html.slice(start))) { cursor = start + 1; continue; }
    const end = findMatchingElement(html, start);
    result.push(html.slice(start, end));
    cursor = end;
  }
  return result;
}

const styleBlocks = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join("\n");
const hero = extractElement(source, /<header\b[^>]*class="hero"[^>]*>/i)?.html;
if (!hero) throw new Error("Hero not found");

const chapters = [];
const chapterPattern = /<section\b[^>]*class="chapter"[^>]*id="([^"]+)"[^>]*>/gi;
let chapterMatch;
while ((chapterMatch = chapterPattern.exec(source))) {
  const start = chapterMatch.index;
  const end = findMatchingElement(source, start);
  const html = source.slice(start, end);
  const header = extractElement(html, /<header\b[^>]*class="chapter-head"[^>]*>/i)?.html;
  const body = extractElement(html, /<div\b[^>]*class="chapter-body"[^>]*>/i)?.html;
  if (!header || !body) throw new Error(`Chapter structure incomplete: ${chapterMatch[1]}`);
  const chapterNo = plainText(header.match(/<span\b[^>]*class="chapter-index"[^>]*>[\s\S]*?<\/span>/i)?.[0] || "");
  const chapterTitle = plainText(header.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/i)?.[0] || chapterMatch[1]);
  const chapterDescription = plainText(header.match(/<p\b[^>]*>[\s\S]*?<\/p>/i)?.[0] || "");
  chapters.push({ id: chapterMatch[1], chapterNo, chapterTitle, chapterDescription, header, blocks: topLevelElements(innerHtml(body)) });
  chapterPattern.lastIndex = end;
}

const pages = [{
  id: "000-cover",
  chapterId: "cover",
  chapterNo: "COVER",
  chapterTitle: "課程封面",
  title: "大語言模型運用於企業管理與決策流程",
  content: hero,
  cover: true
}];

for (const chapter of chapters) {
  const groups = [];
  let current = null;
  const flush = () => { if (current?.blocks.length) groups.push(current); current = null; };
  for (const block of chapter.blocks) {
    const isH3 = /^<h3\b/i.test(block.trim());
    const isExercise = /^<div\b[^>]*class="[^"]*\bexercise\b/i.test(block.trim());
    if (isH3) {
      flush();
      current = { title: plainText(block), blocks: [block] };
    } else if (isExercise) {
      flush();
      const nestedTitle = plainText(block.match(/<h3\b[^>]*>[\s\S]*?<\/h3>/i)?.[0] || "課堂練習");
      groups.push({ title: nestedTitle, blocks: [block] });
    } else {
      if (!current) current = { title: chapter.chapterTitle, blocks: [] };
      current.blocks.push(block);
    }
  }
  flush();
  groups.forEach((group, groupIndex) => {
    const number = String(pages.length).padStart(3, "0");
    pages.push({
      id: `${number}-${chapter.id}-${slug(group.title)}`,
      chapterId: chapter.id,
      chapterNo: chapter.chapterNo,
      chapterTitle: chapter.chapterTitle,
      chapterDescription: chapter.chapterDescription,
      title: group.title,
      header: chapter.header,
      content: group.blocks.join("\n"),
      groupIndex
    });
  });
}

const normalizedContent = (value) => value.replace(/>\s+</g, "><").trim();
const digest = (value) => createHash("sha256").update(normalizedContent(value)).digest("hex");
const sourceContentHash = digest(chapters.flatMap((chapter) => chapter.blocks).join(""));
const generatedContentHash = digest(pages.slice(1).map((page) => page.content).join(""));
if (sourceContentHash !== generatedContentHash) throw new Error("Exact-content verification failed");

const exactCss = `
${styleBlocks}
html{background:#dfe7ec}body.v4-child{margin:0;background:#eef3f6;color:#182b3d;min-height:100vh}
.v4-page{width:min(100%,1280px);min-height:100vh;margin:0 auto;background:#f8fbfc;padding:30px 44px 24px}
.v4-page .chapter{margin:0;box-shadow:0 10px 32px rgba(18,48,67,.10);overflow:visible}
.v4-page .chapter-head{padding:30px 38px 24px}.v4-page .chapter-body{padding:28px 38px 34px}
.v4-page .chapter-body>h3:first-child{margin-top:0}.v4-page p,.v4-page li,.v4-page td,.v4-page label,.v4-page .source-note{color:#20364a}
.v4-page .muted,.v4-page .source-note{color:#42596d}.v4-page .teaching-note{color:#283f52}
.v4-page .card p,.v4-page .card li,.v4-page .callout,.v4-page details,.v4-page td{font-weight:500}
.v4-footer{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:15px 6px 0;color:#3b5367;font-size:.86rem}.v4-footer a{font-weight:800}.v4-footer .page-links{display:flex;gap:14px}
.v4-cover{padding:0}.v4-cover .hero{min-height:calc(100vh - 54px);display:grid;align-items:center}.v4-cover .v4-footer{padding:15px 34px}
body.embedded .v4-page{width:100%;max-width:none}body.embedded .v4-footer>a:first-child{display:none}
@media(max-width:720px){.v4-page{padding:12px}.v4-page .chapter-head,.v4-page .chapter-body{padding:22px 19px}.v4-footer{align-items:flex-start;flex-wrap:wrap}.v4-cover .v4-footer{padding:12px 18px}}
`;

const runtimeScript = `
document.body.classList.toggle('embedded',window.self!==window.top);
(function(){
  function n(id){return Number(document.getElementById(id)?.value)||0}
  var priority=document.getElementById('valueScore');
  if(priority){var updatePriority=function(){var v=n('valueScore'),f=n('feasScore'),a=n('adoptScore'),r=n('riskScore');[['valueLabel',v],['feasLabel',f],['adoptLabel',a],['riskLabel',r]].forEach(function(x){document.getElementById(x[0]).textContent=x[1]});var score=Math.round(((v*.4+f*.3+a*.2+(6-r)*.1)/5)*100);var advice='先釐清資料、流程或風險，不建議直接進入正式導入。';if(score>=78&&r<=3)advice='適合作為優先 PoC，下一步是建立基準線、責任人與驗收標準。';else if(score>=58)advice='可以做小型驗證，但要先降低風險或補足資料。';else if(v>=4&&f<=2)advice='價值高但可行性不足，先做資料與流程準備，不要急著選模型。';if(r>=5)advice='風險很高。即使價值明顯，也應先做法遵、倫理與人工控制評估。';document.getElementById('priorityScore').textContent=score;document.getElementById('priorityAdvice').textContent=advice};['valueScore','feasScore','adoptScore','riskScore'].forEach(function(id){document.getElementById(id).addEventListener('input',updatePriority)});updatePriority()}
  var roi=document.getElementById('monthlyHours');
  if(roi){var fmt=new Intl.NumberFormat('zh-TW',{maximumFractionDigits:0});var updateRoi=function(){var hours=n('monthlyHours'),hourly=n('hourlyCost'),save=Math.min(100,n('saveRate'))/100,realize=Math.min(100,n('realizeRate'))/100,initial=n('initialCost'),monthlyCost=n('monthlyCost'),other=n('otherBenefit'),benefit=hours*hourly*save*realize+other,net=benefit-monthlyCost,first=net*12-initial,rate=initial>0?first/initial*100:0,payback=net>0?(initial/net).toFixed(1)+' 個月':'目前無法回收';document.getElementById('roiResult').innerHTML='<strong>每月可實現效益：</strong>NT$ '+fmt.format(benefit)+'　｜　<strong>每月淨效益：</strong>NT$ '+fmt.format(net)+'<br><strong>第一年淨效益：</strong>NT$ '+fmt.format(first)+'　｜　<strong>第一年 ROI：</strong>'+rate.toFixed(1)+'%　｜　<strong>估計回收期間：</strong>'+payback+'<br><span class="small muted">結果未計入稅務、資金成本、風險損失與未量化效益，請用保守、基準、樂觀三種情境比較。</span>'};['monthlyHours','hourlyCost','saveRate','realizeRate','initialCost','monthlyCost','otherBenefit'].forEach(function(id){document.getElementById(id).addEventListener('input',updateRoi)});updateRoi()}
  var deploy=document.getElementById('dataSensitivity');
  if(deploy){var updateDeploy=function(){var d=n('dataSensitivity'),u=n('usagePattern'),l=n('latencyNeed'),i=n('itCapability'),m=n('modelFreshness'),diff=d*2+u*1.5+l*1.5+i*1.2+m-((2-d)*1.5+(2-u)*1.4+(2-l)*1.1+(2-i)*1.5+(2-m)*1.2),title,explanation;if(Math.abs(diff)<2.5){title='混合部署';explanation='將敏感或穩定工作放在受控環境，將需要彈性、尖峰容量或最新模型的工作放在雲端。'}else if(diff>0){title='偏向地端／私有環境';explanation='資料控制、穩定使用量或低延遲需求較高，但仍要確認維運人力、利用率、備援與完整 TCO。'}else{title='偏向雲端';explanation='目前較需要快速啟動、彈性與最新能力。應先確認資料政策、權限、供應商條款與用量成本。'}document.getElementById('deployResult').innerHTML='<strong>目前方向：'+title+'</strong><br>'+explanation};['dataSensitivity','usagePattern','latencyNeed','itCapability','modelFreshness'].forEach(function(id){document.getElementById(id).addEventListener('change',updateDeploy)});updateDeploy()}
})();`;

function pageHtml(page, index) {
  const prev = pages[index - 1];
  const next = pages[index + 1];
  const body = page.cover ? page.content : `<article class="chapter exact-fragment" data-source-chapter="${escapeHtml(page.chapterId)}">${page.header}<div class="chapter-body">${page.content}</div></article>`;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(page.title)}｜v4 ${index + 1}</title><link rel="stylesheet" href="../theme.css"></head><body class="v4-child"><main class="v4-page ${page.cover ? "v4-cover" : ""}">${body}<footer class="v4-footer"><a href="../index.html" target="_top">返回教材目錄</a><span>${String(index + 1).padStart(2, "0")} / ${String(pages.length).padStart(2, "0")}</span><span class="page-links">${prev ? `<a href="${prev.id}.html">上一頁</a>` : ""}${next ? `<a href="${next.id}.html">下一頁</a>` : ""}</span></footer></main><script>${runtimeScript}</script></body></html>`;
}

function indexHtml() {
  const groups = new Map();
  for (const [index, page] of pages.entries()) {
    const key = page.cover ? "課程封面" : `${page.chapterNo}｜${page.chapterTitle}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ page, index });
  }
  const first = pages[0];
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>v4｜主教材拆頁版</title><link rel="stylesheet" href="theme.css"></head><body class="catalog-page"><main class="catalog-app"><aside class="catalog-sidebar"><header class="catalog-header"><div class="catalog-kicker">PRESENTATION V4</div><h1>主教材拆頁版</h1><p>不摘要、不改寫，只依教材細項拆頁。</p><label><span>搜尋目錄</span><input id="search" type="search" placeholder="輸入章節或細項"></label><a href="../archive/v1-single-file/presentation_v1.html" target="_blank">另開封存的 v1</a></header><nav class="catalog-nav">${[...groups.entries()].map(([name, entries]) => `<section class="catalog-group"><h2>${escapeHtml(name)}</h2><ol>${entries.map(({page,index}) => `<li data-search="${escapeHtml(`${name} ${page.title}`)}"><a href="slides/${page.id}.html" target="content-frame" data-page-title="${escapeHtml(page.title)}" class="${index === 0 ? "active" : ""}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(page.title)}</strong></a></li>`).join("")}</ol></section>`).join("")}</nav></aside><section class="catalog-view"><header class="catalog-toolbar"><div><span>目前細項</span><strong id="currentTitle">${escapeHtml(first.title)}</strong></div><a id="openPage" href="slides/${first.id}.html" target="_blank">另開此頁</a></header><iframe name="content-frame" src="slides/${first.id}.html" title="v4 主教材拆頁內容"></iframe></section></main><script>const links=[...document.querySelectorAll('.catalog-nav a')],title=document.getElementById('currentTitle'),openPage=document.getElementById('openPage');links.forEach(a=>a.addEventListener('click',()=>{links.forEach(x=>x.classList.remove('active'));a.classList.add('active');title.textContent=a.dataset.pageTitle;openPage.href=a.href}));document.getElementById('search').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();document.querySelectorAll('.catalog-group li').forEach(li=>li.hidden=!!q&&!li.dataset.search.toLowerCase().includes(q));document.querySelectorAll('.catalog-group').forEach(g=>g.hidden=![...g.querySelectorAll('li')].some(li=>!li.hidden))});</script></body></html>`;
}

const catalogCss = `
${exactCss}
.catalog-page{margin:0;height:100vh;overflow:hidden;background:#dfe7ec;color:#182b3d;font-family:"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif}.catalog-app{display:grid;grid-template-columns:350px minmax(0,1fr);height:100vh}.catalog-sidebar{overflow:auto;background:#f8fbfc;border-right:1px solid #afc1cc}.catalog-header{position:sticky;top:0;z-index:3;padding:24px;background:rgba(248,251,252,.97);border-bottom:1px solid #bdcbd4;backdrop-filter:blur(8px)}.catalog-kicker{font-size:.73rem;font-weight:900;letter-spacing:.12em;color:#006c8d}.catalog-header h1{margin:8px 0 7px;color:#123247;font-size:1.65rem}.catalog-header p{margin:0 0 16px;color:#3b5367;font-weight:550}.catalog-header label span{display:block;margin-bottom:6px;font-size:.76rem;font-weight:850}.catalog-header input{width:100%;padding:10px 12px;border:1px solid #96adbb;border-radius:10px;font:inherit}.catalog-header>a{display:inline-block;margin-top:11px;color:#006c8d;font-size:.82rem;font-weight:800}.catalog-nav{padding:12px 13px 30px}.catalog-group h2{margin:12px 7px 6px;padding-bottom:7px;border-bottom:1px solid #c4d1d9;color:#2b526a;font-size:.86rem}.catalog-group ol{list-style:none;margin:0;padding:0}.catalog-group li{margin:2px 0}.catalog-group a{display:grid;grid-template-columns:34px 1fr;gap:7px;padding:9px 10px;border-radius:9px;color:#1f374a;text-decoration:none}.catalog-group a span{color:#526b7e;font-size:.75rem;font-weight:800}.catalog-group a strong{font-size:.87rem;line-height:1.35}.catalog-group a:hover{background:#e3f0f4}.catalog-group a.active{background:#16384d;color:#fff}.catalog-group a.active span{color:#bfe6ef}.catalog-view{display:grid;grid-template-rows:58px minmax(0,1fr);min-width:0}.catalog-toolbar{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:8px 22px;background:#fff;border-bottom:1px solid #afc1cc}.catalog-toolbar span{display:block;color:#50687b;font-size:.7rem;font-weight:800}.catalog-toolbar strong{display:block;max-width:70vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.catalog-toolbar a{font-size:.8rem;font-weight:800;color:#006c8d}.catalog-view iframe{width:100%;height:100%;border:0;background:#eef3f6}@media(max-width:720px){.catalog-app{grid-template-columns:285px minmax(0,1fr)}.catalog-header{padding:18px 15px}.catalog-nav{padding:8px}.catalog-toolbar{padding:8px 13px}}
`;

await fs.mkdir(slidesDir, { recursive: true });
for (const entry of await fs.readdir(slidesDir)) {
  if (entry.endsWith(".html")) await fs.unlink(path.join(slidesDir, entry));
}
await fs.writeFile(path.join(outDir, "theme.css"), catalogCss, "utf8");
await fs.writeFile(path.join(outDir, "index.html"), indexHtml(), "utf8");
for (const [index, page] of pages.entries()) await fs.writeFile(path.join(slidesDir, `${page.id}.html`), pageHtml(page, index), "utf8");
await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify({ source: "../archive/v1-single-file/presentation_v1.html", sourceRole: "legacy-reference", generatedAt: new Date().toISOString(), pageCount: pages.length, exactContentVerified: sourceContentHash === generatedContentHash, sourceContentHash, generatedContentHash, pages: pages.map((page, index) => ({ index: index + 1, id: page.id, chapter: page.chapterNo, chapterTitle: page.chapterTitle, title: page.title })) }, null, 2), "utf8");
console.log(`Generated ${pages.length} compatibility pages from archived presentation_v1.html`);
