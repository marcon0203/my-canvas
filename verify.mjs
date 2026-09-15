/* 阶段 0 自检：token 三层完整性、语义层无裸 hex、深色覆盖、Tailwind 链路 */
import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8');
/* 注释里出现颜色不算违规，先剥掉 */
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
const prim = strip(read('src/styles/tokens.primitive.css'));
const sem  = strip(read('src/styles/tokens.semantic.css'));
const comp = strip(read('src/styles/tokens.component.css'));
const css  = fs.readdirSync('dist/assets').filter(f => f.endsWith('.css')).map(f => read('dist/assets/'+f)).join('');

const fail = [];
const ck = (c, m) => { if (!c) fail.push(m); };

// 1. 分层纪律：语义层只能引用 var()，不能出现裸 hex（深色推导块除外）
const semLight = sem.slice(0, sem.indexOf('[data-theme="dark"]'));
const hexInSem = semLight.match(/#[0-9a-f]{3,8}\b/gi) || [];
ck(hexInSem.length === 0, `语义层出现裸 hex：${hexInSem.join(', ')}`);

// 2. 组件层只放尺寸，不放颜色
ck(!/#[0-9a-f]{3,8}\b/i.test(comp), '组件层不应出现颜色');

// 3. 原始层必须自给自足：不引用语义层
ck(!/var\(--color-/.test(prim), '原始层不应反向依赖语义层');

// 4. token 层引用的每个变量都要真的有人定义。
//    只扫「深色块之前」会漏掉排在文件末尾的覆盖块 —— 曾因此把 --color-scene-bg
//    指到不存在的 --studio-bg-mid 上，回退成 rgba(0,0,0,.12)，舞台整片黑。
const allTokenCss = [prim, sem, comp].join('\n');
const defined = new Set(
  [...fs.readdirSync('src/styles').filter(f => f.endsWith('.css'))
    .flatMap(f => strip(read('src/styles/' + f)).match(/(--[a-z0-9-]+)\s*:/gi) || [])]
    .map(s => s.replace(/\s*:$/, '')));
// var(--a, 兜底) 只校验第一个参数：兜底可以有，但主变量不能是笔误
const used = [...new Set((allTokenCss.match(/var\(\s*--[a-z0-9-]+/gi) || [])
  .map(s => s.replace(/^var\(\s*/i, '')))];
const dangling = used.filter(v => !defined.has(v));
ck(dangling.length === 0, `token 层引用了不存在的变量：${dangling.join(', ')}`);

// 4b. 白模三档底色必须活着进产物。
//     WhiteModel 读的是 --color-model-${skin} 这种拼出来的名字，源码里没有字面量，
//     一旦写进 @theme 就会被 Tailwind v4 摇掉 —— 定义在源码里不等于能用，所以查产物。
['blue', 'grey', 'white'].forEach(skin => {
  ck(defined.has('--color-model-' + skin), `缺少白模底色 token --color-model-${skin}`);
  ck(css.includes('--color-model-' + skin), `白模底色 --color-model-${skin} 未进产物（多半是被 @theme 摇掉了）`);
});

// 5. 三层都进了产物
[['--blue-500','原始'],['--color-surface','语义'],['--stage-box','组件']].forEach(([v,l]) =>
  ck(css.includes(v), `${l}层变量 ${v} 未进产物`));

// 6. 深色覆盖存在，且覆盖了关键语义 token
ck(/data-theme=["']?dark["']?\]/.test(css), '深色模式未进产物');
['--color-canvas','--color-ink','--color-surface','--color-line'].forEach(v => {
  const dark = sem.slice(sem.indexOf('[data-theme="dark"]'));
  ck(dark.includes(v + ':'), `深色未覆盖 ${v}`);
});

// 7. Tailwind 从 token 生成了工具类
['.bg-surface','.text-ink-muted','.border-line-soft','.rounded-card','.shadow-raised','.bg-data-1','.text-metric']
  .forEach(u => ck(css.includes(u), `工具类 ${u} 未生成`));

// 8. 3D 场景色走 token
ck(css.includes('--color-scene-floor'), '3D 场景色未进 token');
ck(read('src/three/useSceneColors.ts').includes('cssVar'), '3D 未通过 CSS 变量取色');

if (fail.length) { console.log('❌ ' + fail.length + ' 项未通过:'); fail.forEach(f => console.log('  - ' + f)); process.exit(1); }
console.log('✅ 阶段 0 自检通过：三层分明 / 语义层零裸色 / 深色覆盖 / Tailwind 链路 / 3D 走 token');
