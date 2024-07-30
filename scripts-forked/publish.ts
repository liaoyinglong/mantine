// 这是 fork 之后的发布逻辑
import path from 'path';
import { confirm, intro, note, outro } from '@clack/prompts';
import fs from 'fs-extra';

const projectRoot = path.resolve(__dirname, '..');
const temp = path.resolve(projectRoot, '.temp');

intro(`release forked mantine`);

{
  // 运行构建命令
  if (
    await confirm({
      message: '运行构建命令？',
    })
  ) {
    await Bun.$`corepack yarn run build all`;
  }
}

await fs.ensureDir(temp);

{
  note(`working with core`);
  // 复制 core 的文件到 .temp 下
  const rawCoreDir = path.resolve(projectRoot, 'packages/@mantine/core');
  const coreTempDir = path.resolve(temp, 'core');
  const tempJson = path.resolve(coreTempDir, 'package.json');
  await Bun.$`cp -r ${rawCoreDir} ${temp}`;
  {
    // 删除 .map 文件如果有的话
    const g = new Bun.Glob(`**/*.map`);
    for await (const file of g.scan({
      cwd: coreTempDir,
      absolute: true,
    })) {
      await fs.remove(file);
    }
  }

  // 更改 package.json 中的 名字
  const json = await fs.readJson(tempJson);
  json.name = '@dune2/mantine-core';
  await fs.writeJson(tempJson, json, { spaces: 2 });
  if (
    await confirm({
      message: '发布到 npm？',
    })
  ) {
    await Bun.$`cd ${coreTempDir} && npm publish --access public`;
  }
}

outro(`done`);
