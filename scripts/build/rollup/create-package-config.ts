import path from 'node:path';
import alias, { Alias } from '@rollup/plugin-alias';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import { generateScopedName } from 'hash-css-selector';
import MagicString from 'magic-string';
import { Plugin, RollupOptions } from 'rollup';
import banner from 'rollup-plugin-banner2';
import esbuild from 'rollup-plugin-esbuild';
import postcss from 'rollup-plugin-postcss';
import { getPackagesList } from '../../packages/get-packages-list';
import { getPath } from '../../utils/get-path';
import { ROLLUP_EXCLUDE_USE_CLIENT } from './rollup-exclude-use-client';
import { ROLLUP_EXTERNALS } from './rollup-externals';

export async function createPackageConfig(packagePath: string): Promise<RollupOptions> {
  const packagesList = getPackagesList();

  const aliasEntries: Alias[] = packagesList.map((pkg) => ({
    find: new RegExp(`^${pkg.packageJson.name}`),
    replacement: path.resolve(pkg.path, 'src'),
  }));

  const plugins = [
    nodeResolve({ extensions: ['.ts', '.tsx', '.js', '.jsx'] }),
    esbuild({
      sourceMap: false,
      tsconfig: getPath('tsconfig.json'),
    }),
    alias({ entries: aliasEntries }),
    replace({ preventAssignment: true }),
    postcss({
      extract: true,
      modules: { generateScopedName },
    }),
    ['@mantine/core'].some((p) => packagePath.includes(p)) ? addCssImportInCore : undefined,
    banner((chunk) => {
      if (!ROLLUP_EXCLUDE_USE_CLIENT.includes(chunk.fileName)) {
        return "'use client';\n";
      }

      return undefined;
    }),
  ];

  return {
    input: path.resolve(packagePath, 'src/index.ts'),
    output: [
      {
        format: 'es',
        entryFileNames: '[name].mjs',
        dir: path.resolve(packagePath, 'esm'),
        preserveModules: true,
        sourcemap: true,
      },
      // we don't need cjs for now
      //{
      //  format: 'cjs',
      //  entryFileNames: '[name].cjs',
      //  dir: path.resolve(packagePath, 'cjs'),
      //  preserveModules: true,
      //  sourcemap: true,
      //  interop: 'auto',
      //},
    ],
    external: ROLLUP_EXTERNALS,
    plugins,
  };
}

/**
 * 添加上 css 的 import 语句
 * 目的是可以做 css 的按需加载
 * 不过得让业务方编译 node_modules 下的文件
 */
const moduleCssRegex = /\.module\.css\.mjs$/;
const enableLayerCss = true;
const addCssImportInCore: Plugin = {
  name: 'add-css-import',
  async renderChunk(code, chunk, options) {
    if (moduleCssRegex.test(chunk.fileName)) {
      // output dir: @mantine/core/esm
      const outputDir = options.dir!;

      // outputPath: @mantine/core/esm/button.module.css.mjs
      const fileDir = path.dirname(path.resolve(outputDir, chunk.fileName));

      // css file name: button.css
      const cssFileName = path
        .basename(chunk.fileName)
        .replace(moduleCssRegex, enableLayerCss ? '.layer.css' : '.css');

      // cssPath: @mantine/core/styles/button.css
      const stylesDir = path.resolve(outputDir, '../styles');
      const cssPath = path.resolve(stylesDir, cssFileName);
      const globalCssPath = path.resolve(
        stylesDir,
        enableLayerCss ? 'global.layer.css' : 'global.css'
      );
      // to get import path from outputPath to cssPath
      const importPath = path.relative(fileDir, cssPath);
      const globalImportPath = path.relative(fileDir, globalCssPath);
      const magicString = new MagicString(code);
      // 找到第一行的结束位置
      magicString.prepend(
        `\
import "${globalImportPath}";
import "${importPath}";
`
      );
      const result = magicString.toString();
      return {
        code: result,
        map: magicString.generateMap({ hires: true }),
      };
    }

    return { code, map: null };
  },
};
