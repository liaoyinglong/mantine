import path from 'path';
import fs from 'fs-extra';
import { enableReactCompilerForkedList } from './forkedList';

for (const pkg of enableReactCompilerForkedList) {
  const file = path.join(__dirname, `../packages/@mantine/${pkg}/esm/index.mjs`);
  const content = await fs.readFile(file, 'utf-8');

  // rollup 编译完了之后 _c(1) 变成了  c(1)
  // 所以这里匹配 c(1)
  const reg = /\sc\((\d+)\)/g;

  let count = 0;
  const set = new Set<number>();

  for (const v of content.matchAll(reg)) {
    count++;
    set.add(Number(v[1]));
  }

  const arr = [...set].sort((a, b) => a - b);
  console.log(`=====@mantine/${pkg}: ${count} =====`);
  console.log(arr);
}
