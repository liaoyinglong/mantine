import path from 'node:path';
import { parseAsync, transformFromAstAsync } from '@babel/core';
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
  const isForked = ['@mantine/core'].some((p) => packagePath.includes(p));

  const packagesList = getPackagesList();

  const aliasEntries: Alias[] = packagesList.map((pkg) => ({
    find: new RegExp(`^${pkg.packageJson.name}`),
    replacement: path.resolve(pkg.path, 'src'),
  }));

  const plugins = [
    nodeResolve({ extensions: ['.ts', '.tsx', '.js', '.jsx'] }),
    isForked ? reactCompiler : undefined,
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
    // 暂时禁用，没有办法保证 css 顺序
    //isForked ? addCssImportInCore({}) : undefined,
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
        //sourcemap: true,
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const addCssImportInCore = (params: { enableLayerCss?: boolean }): Plugin => {
  const { enableLayerCss = false } = params;

  return {
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
};

// eslint-disable-next-line no-lone-blocks
{
  // 确保 react-compiler 不会判断成 dev 模式
  // @see https://github.com/facebook/react/blob/f603426f917314561c4289734f39b972be3814af/compiler/packages/babel-plugin-react-compiler/src/Babel/BabelPlugin.ts#L33-L34
  // @ts-ignore
  globalThis.__DEV__ = false;
  process.env.NODE_ENV = 'production';
}

const reactCompiler: Plugin = {
  name: 'react-compiler',

  async transform(code, id) {
    if (!id.endsWith('.tsx')) {
      return null;
    }

    // 这里需要用 ast-grep 来把代码转换成可以被 react-compiler 处理的代码
    const ast = await parseAsync(code, {
      filename: id,
      plugins: [
        [
          '@babel/plugin-syntax-typescript',
          {
            isTSX: true,
          },
        ],
      ],
      sourceType: 'module',
    });
    if (!ast) {
      throw new Error(`Unable to parse code for ${id}`);
    }

    const result = await transformFromAstAsync(ast, code, {
      envName: 'production',
      ast: false,
      filename: id,
      highlightCode: false,
      retainLines: true,
      plugins: [[require.resolve('babel-plugin-react-compiler'), {}]],
      sourceType: 'module',
      configFile: false,
      babelrc: false,
    });

    if (!result) {
      throw new Error(`Unable to transform code for ${id}`);
    }

    return result!.code;
  },
};
