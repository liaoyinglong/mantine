// 这是 fork 之后的发布逻辑
import path from 'path';
import { confirm, intro, note, outro } from '@clack/prompts';
import fs from 'fs-extra';
import { forkedList } from './forkedList';

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

await fs.emptyDir(temp);

{
  const shouldPublish = await confirm({
    message: `发布到 npm？`,
  });

  const r = await Bun.$`git show -s --no-show-signature --format=%h`;
  const commit = r.text().trim();
  const date = new Date();
  const dateStr = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((v) => {
      return v > 10 ? v : `0${v}`;
    })
    .join('');

  const versionSuffix = `${commit}-${dateStr}`;

  for (const pkg of forkedList) {
    note(`working with ${pkg}`);
    // 复制 pkg 的文件到 .temp 下
    const originalDir = path.resolve(projectRoot, `packages/@mantine/${pkg}`);
    const pkgTempDir = path.resolve(temp, pkg);
    const tempJson = path.resolve(pkgTempDir, 'package.json');
    await Bun.$`cp -r ${originalDir} ${temp}`;
    {
      // 删除 .map 文件如果有的话
      const g = new Bun.Glob(`**/*.map`);
      for await (const file of g.scan({
        cwd: pkgTempDir,
        absolute: true,
      })) {
        await fs.remove(file);
      }

      // 删除 cjs 文件如果有的话
      await fs.remove(path.resolve(pkgTempDir, 'cjs'));
      // 删除 styles 文件夹如果有的话，目前都是全量引入的 styles
      await fs.remove(path.resolve(pkgTempDir, 'styles'));
      await fs.remove(path.resolve(pkgTempDir, 'src'));
    }

    // 更改 package.json 中的 名字
    const json = await fs.readJson(tempJson);
    json.name = `@dune2/mantine-${pkg}`;
    json.version = `${json.version}-${versionSuffix}`;
    await fs.writeJson(tempJson, json, { spaces: 2 });
    if (shouldPublish) {
      await Bun.$`cd ${pkgTempDir} && npm publish --access public`;
    }
    note(`done with ${pkg}`);
  }

  if (shouldPublish) {
    // git tag 并且 push
    await Bun.$`git tag ${versionSuffix} && git push --tags`;
  }
}

outro(`done`);
