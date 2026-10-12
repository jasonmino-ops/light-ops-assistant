#!/usr/bin/env node

import { builtinModules, createRequire } from 'node:module'
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const BUILTINS = new Set(
  builtinModules.flatMap((name) => [name, name.startsWith('node:') ? name.slice(5) : `node:${name}`]),
)
const PACKAGE_SPECIFIER = /^(?:@[^/]+\/[^/]+|[^/]+)$/

function walkJavaScriptFiles(root) {
  const files = []
  for (const name of readdirSync(root).sort()) {
    const filePath = join(root, name)
    const info = statSync(filePath)
    if (info.isDirectory()) files.push(...walkJavaScriptFiles(filePath))
    else if (info.isFile() && filePath.endsWith('.js')) files.push(filePath)
  }
  return files
}

function packageName(specifier) {
  if (!PACKAGE_SPECIFIER.test(specifier)) return specifier
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
}

function scanSpecifierSet(distRoot) {
  const staticSpecifiers = new Set()
  const dynamicSpecifiers = new Set()
  const files = walkJavaScriptFiles(distRoot)
  const patterns = [
    { target: staticSpecifiers, pattern: /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
    { target: staticSpecifiers, pattern: /\b(?:import|export)\s+[^;\n]*?\bfrom\s*['"]([^'"]+)['"]/g },
    { target: dynamicSpecifiers, pattern: /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
  ]

  for (const filePath of files) {
    const source = readFileSync(filePath, 'utf8')
    for (const { target, pattern } of patterns) {
      for (const match of source.matchAll(pattern)) target.add(match[1])
    }
  }

  return {
    files: files.map((filePath) => relative(distRoot, filePath).replaceAll('\\', '/')).sort(),
    staticSpecifiers: [...staticSpecifiers].sort(),
    dynamicSpecifiers: [...dynamicSpecifiers].sort(),
  }
}

function isInside(parent, child) {
  const relativePath = relative(parent, child)
  return (
    relativePath === '' ||
    (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  )
}

function resolveRuntimeDependency(entryPath, providerRoot, specifier) {
  const requireFromEntry = createRequire(entryPath)
  try {
    const resolved = requireFromEntry.resolve(specifier)
    const realResolved = realpathSync(resolved)
    const runtimeRoot = realpathSync(join(providerRoot, 'node_modules'))
    if (!isInside(runtimeRoot, realResolved)) {
      return { specifier, resolved, realResolved, error: 'resolved outside staged node_modules' }
    }
    return { specifier, resolved, realResolved }
  } catch (error) {
    return { specifier, error: error.code ?? 'RESOLUTION_FAILED', message: error.message }
  }
}

function loadEntryIsolated(entryPath, providerRoot) {
  const child = spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(entryPath)})`],
    {
      cwd: providerRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: '' },
    },
  )
  return {
    passed: child.status === 0,
    status: child.status,
    signal: child.signal,
    stdout: child.stdout,
    stderr: child.stderr,
  }
}

export function inspectProviderArtifact(providerRootInput) {
  const providerRoot = resolve(providerRootInput)
  const packagePath = join(providerRoot, 'package.json')
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
  const entryRelative = packageJson.main ?? 'dist/index.js'
  const entryPath = resolve(providerRoot, entryRelative)
  const distRoot = dirname(entryPath)
  const scan = scanSpecifierSet(distRoot)
  const allSpecifiers = [...new Set([...scan.staticSpecifiers, ...scan.dynamicSpecifiers])].sort()
  const localModules = allSpecifiers.filter((specifier) => specifier.startsWith('.') || specifier.startsWith('/'))
  const nodeBuiltins = allSpecifiers.filter((specifier) => BUILTINS.has(specifier))
  const externalRuntimeDependencies = allSpecifiers
    .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('/') && !BUILTINS.has(specifier))
    .map(packageName)
    .filter((name, index, values) => values.indexOf(name) === index)
    .sort()
  const optionalDependencies = Object.keys(packageJson.optionalDependencies ?? {}).sort()
  const optional = externalRuntimeDependencies.filter((name) => optionalDependencies.includes(name))
  const requiredExternalRuntimeDependencies = externalRuntimeDependencies.filter((name) => !optional.includes(name))
  const resolution = requiredExternalRuntimeDependencies.map((specifier) =>
    resolveRuntimeDependency(entryPath, providerRoot, specifier),
  )
  const missingRuntimeDependencies = resolution.filter((result) => result.error).map((result) => result.specifier)
  const platformSpecific = []
  if (directorySafe(join(providerRoot, 'helper', 'win-x64'))) platformSpecific.push('helper/win-x64')

  return {
    providerRoot,
    entryRelative,
    entryPath,
    emittedDependencyScan: {
      files: scan.files,
      staticSpecifiers: scan.staticSpecifiers,
      dynamicSpecifiers: scan.dynamicSpecifiers,
      localModules,
      nodeBuiltins,
      bundled: [],
      externalRuntimeDependencies,
      optional,
      platformSpecific,
    },
    resolution,
    missingRuntimeDependencies,
  }
}

function pathExists(path) {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

function directorySafe(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function verifyProviderArtifact(providerRootInput) {
  const report = inspectProviderArtifact(providerRootInput)
  const entryExists = pathExists(report.entryPath)
  if (!entryExists) throw new Error(`PROVIDER_ENTRY_MISSING: ${report.entryPath}`)
  if (report.missingRuntimeDependencies.length > 0) {
    throw new Error(`MISSING_RUNTIME_DEPENDENCIES: ${report.missingRuntimeDependencies.join(', ')}`)
  }
  const entryLoad = loadEntryIsolated(report.entryPath, report.providerRoot)
  if (!entryLoad.passed) {
    throw new Error(
      `ISOLATED_PROVIDER_ENTRY_LOAD_FAILED: status=${entryLoad.status ?? 'unknown'} stderr=${entryLoad.stderr.trim()}`,
    )
  }
  return { ...report, entryLoad: { passed: true } }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const providerRoot = process.argv[2]
  if (!providerRoot) {
    console.error('Usage: node scripts/verify-provider-packaging.mjs <provider-package-root>')
    process.exit(2)
  }
  try {
    const report = verifyProviderArtifact(providerRoot)
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
