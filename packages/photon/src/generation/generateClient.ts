import { LiftEngine } from '@prisma/lift'
import copy from 'cpy'
import fs from 'fs-extra'
import makeDir from 'make-dir'
import { cpus } from 'os'
import path from 'path'
import {
  CompilerOptions,
  createCompilerHost,
  createProgram,
  createSourceFile,
  ModuleKind,
  ScriptTarget,
} from 'typescript'
import { Dictionary } from '../runtime/utils/common'
import { getDMMF } from '../utils/getDMMF'
import { TSClient } from './TSClient'

interface BuildClientOptions {
  datamodel: string
  browser: boolean
  cwd?: string
  transpile?: boolean
  runtimePath?: string
  binaryPath?: string
}

export async function buildClient({
  datamodel,
  cwd,
  transpile = false,
  runtimePath = './runtime',
  browser = false,
  binaryPath,
}: BuildClientOptions): Promise<Dictionary<string>> {
  const fileMap = {}

  const dmmf = await getDMMF(datamodel, binaryPath)
  const liftEngine = new LiftEngine({
    projectDir: cwd,
  })
  const config = await liftEngine.getConfig({ datamodel })
  const datamodelWithoutDatasources = await liftEngine.convertDmmfToDml({
    config: {
      datasources: [],
      generators: [],
    },
    dmmf: JSON.stringify(dmmf.datamodel),
  })
  const client = new TSClient({
    document: dmmf,
    cwd,
    datamodel: datamodelWithoutDatasources.datamodel,
    runtimePath,
    browser,
    datasources: config.datasources,
  })
  const generatedClient = String(client)
  const target = '@generated/photon/index.ts'

  if (!transpile) {
    fileMap[target] = generatedClient
    return normalizeFileMap(fileMap)
  }

  /**
   * If transpile === true, replace index.ts with index.js and index.d.ts
   * WARNING: This takes a long time
   * TODO: Implement transpilation as a separate code generator
   */

  const options: CompilerOptions = {
    module: ModuleKind.CommonJS,
    target: ScriptTarget.ES2016,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
    declaration: true,
    strict: true,
    suppressOutputPathCheck: false,
  }
  const file: any = { fileName: target, content: generatedClient }

  const compilerHost = createCompilerHost(options)
  const originalGetSourceFile = compilerHost.getSourceFile
  compilerHost.getSourceFile = fileName => {
    const newFileName = redirectToLib(fileName)
    if (fileName === file.fileName) {
      file.sourceFile = file.sourceFile || createSourceFile(fileName, file.content, ScriptTarget.ES2015, true)
      return file.sourceFile
    }
    return (originalGetSourceFile as any).call(compilerHost, newFileName)
  }
  compilerHost.writeFile = (fileName, data) => {
    if (fileName.includes('@generated/photon')) {
      // TODO: We can't rely on this anymore!
      fileMap[fileName] = data
    }
  }

  const program = createProgram([file.fileName], options, compilerHost)
  const result = program.emit()
  if (result.diagnostics.length > 0) {
    console.error(result.diagnostics)
  }
  return normalizeFileMap(fileMap)
}

function normalizeFileMap(fileMap: Dictionary<string>) {
  const sliceLength = '@generated/photon/'.length
  return Object.entries(fileMap).reduce((acc, [key, value]) => {
    acc[key.slice(sliceLength)] = value
    return acc
  }, {})
}

export interface GenerateClientOptions {
  datamodel: string
  cwd?: string
  outputDir: string
  transpile?: boolean
  runtimePath?: string
  browser?: boolean
  binaryPath?: string
}

export async function generateClient({
  datamodel,
  cwd,
  outputDir,
  transpile,
  runtimePath,
  browser,
  binaryPath,
}: GenerateClientOptions) {
  if (cwd && cwd.endsWith('.yml')) {
    cwd = path.dirname(cwd)
  }
  runtimePath = runtimePath || './runtime'
  const files = await buildClient({ datamodel, cwd, transpile, runtimePath, browser, binaryPath })
  await makeDir(outputDir)
  await Promise.all(Object.entries(files).map(([fileName, file]) => fs.writeFile(path.join(outputDir, fileName), file)))
  await copy(path.join(__dirname, '../../runtime'), path.join(outputDir, '/runtime'))
  await fs.writeFile(path.join(outputDir, '/runtime/index.d.ts'), indexDTS)
}

// TODO: fix type
// export { Engine } from './dist/Engine'
const indexDTS = `export { DMMF } from './dmmf-types'
export { DMMFClass } from './dmmf'
export { deepGet, deepSet } from './utils/deep-set'
export { makeDocument, transformDocument } from './query'

export declare var Engine: any
export declare type Engine = any

export declare var debugLib: debug.Debug & { debug: debug.Debug; default: debug.Debug };

declare namespace debug {
  interface Debug {
    (namespace: string): Debugger;
    coerce: (val: any) => any;
    disable: () => string;
    enable: (namespaces: string) => void;
    enabled: (namespaces: string) => boolean;
    log: (...args: any[]) => any;

    names: RegExp[];
    skips: RegExp[];

    formatters: Formatters;
  }

  type IDebug = Debug;

  interface Formatters {
    [formatter: string]: (v: any) => string;
  }

  type IDebugger = Debugger;

  interface Debugger {
    (formatter: any, ...args: any[]): void;

    enabled: boolean;
    log: (...args: any[]) => any;
    namespace: string;
    destroy: () => boolean;
    extend: (namespace: string, delimiter?: string) => Debugger;
  }
}
`

// This is needed because ncc rewrite some paths
function redirectToLib(fileName: string) {
  const file = path.basename(fileName)
  if (/^lib\.(.*?)\.d\.ts$/.test(file)) {
    if (!fs.pathExistsSync(fileName)) {
      const dir = path.dirname(fileName)
      return path.join(dir, 'lib', file)
    }
  }

  return fileName
}
