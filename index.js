#!/usr/bin/env bare

const { command, flag, arg, summary, description, header, validate } = require('paparam')
const Bundlebee = require('bundlebee')
const Corestore = require('corestore')
const path = require('path')
const process = require('process')
const fs = require('fs')
const z32 = require('z32')

const defaultStorage = '.bundlebee'

const storeCmd = command(
  'store',
  summary('Store a folder into a bundlebee'),
  description('Traverse and bundle a folder entry point into a hyperbee store.'),
  flag('--storage|-s <path>', 'corestore storage path (default: ~/.bundlebee)'),
  flag('--abi|-a [abi]', 'store under a specific abi'),
  flag('--include-modules', 'include node_modules (default: false)'),
  flag('--dry-run', 'Gather files and check abi'),
  arg('<folder>', 'project folder to bundle'),
  arg('[entrypoint]', 'entry point relative to folder (default: index.js)'),
  validate(({ args, flags }) => {
    const folder = path.resolve(args.folder)

    if (!fs.existsSync(folder)) return 'folder does not exist: ' + folder
    if (!fs.statSync(folder).isDirectory()) return 'path is not a directory: ' + folder

    const entrypoint = args.entrypoint || 'index.js'
    const entryPath = path.join(folder, entrypoint)

    if (!fs.existsSync(entryPath)) return 'entrypoint does not exist: ' + entryPath

    if (flags.abi && (isNaN(Number(flags.abi)) || Number(flags.abi) <= 0)) {
      return '--version must be a positive number'
    }

    return true
  }),
  async () => {
    const folder = path.resolve(storeCmd.args.folder || process.cwd())
    const storagePath = path.join(process.cwd(), storeCmd.flags.storage || defaultStorage)
    const entrypoint = storeCmd.args.entrypoint || 'index.js'
    const skipModules = storeCmd.flags.includeModules !== true
    const dryRun = storeCmd.flags.dryRun !== false
    const abi = storeCmd.flags.abi ? Number(storeCmd.flags.abi) : undefined

    const store = new Corestore(storagePath)
    const b = new Bundlebee(store)

    const root = new URL('file://' + folder + '/')

    if (dryRun) console.log('[DRY RUN]')
    console.log('Storing', folder, 'with entry', entrypoint)
    console.log('Storage:', path.resolve(storagePath))

    const bundle = await b.add(root, entrypoint, { skipModules, abi, dryRun })

    if (dryRun) {
      const manifest = await b.manifest()
      if (manifest && abi <= manifest.abi) {
        console.warn(`ABI must be greater than existing: ${abi} <= ${manifest.abi}`)
      }
    }

    const files = Object.keys(bundle.files)
    if (files.length === 0) {
      console.log('No changes detected.')
    } else {
      console.log('Added', files.length, 'file(s):')
      for (const f of files) console.log(' ', f)
    }

    const head = b.head()
    console.log('\nKey:', z32.encode(head.key))
    console.log('Length:', head.length)

    await b.close()
  }
)

const checkoutCmd = command(
  'checkout',
  summary('Checkout files from a Bundlebee to a folder'),
  description('Checkout the bundle to disk'),
  flag('--storage|-s <path>', 'corestore storage path (default: ~/.bundlebee)'),
  flag('--key|-k [key]', 'source Bundlebee key to checkout from'),
  flag('--abi|-a [abi]', 'checkout a specific abi'),
  flag('--out|-o [out]', 'checkout directory'),
  validate(({ flags }) => {
    if (flags.abi && (isNaN(Number(flags.abi)) || Number(flags.abi) <= 0)) {
      return '--abi must be a positive number'
    }
    return true
  }),
  async () => {
    const folder = path.resolve(process.cwd())
    const storagePath = path.join(folder, checkoutCmd.flags.storage || defaultStorage)
    const abi = checkoutCmd.flags.abi ? Number(checkoutCmd.flags.abi) : undefined
    const key = checkoutCmd.flags.key ? z32.decode(checkoutCmd.flags.key) : null
    const outPath = checkoutCmd.flags.out ? path.join(folder, checkoutCmd.flags.out) : folder

    const store = new Corestore(storagePath)
    const b = new Bundlebee(store, key ? { store: core.get({ key }) } : undefined)
    const checkout = await b.findABI(abi)

    console.log('Checking out to', folder)
    if (abi) console.log('At abi:', abi)

    let count = 0
    for await (const { id, source } of b.createEntryStream(checkout)) {
      const filePath = path.join(outPath, id)
      const dir = path.dirname(filePath)

      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(filePath, source)

      console.log(' ', id)
      count++
    }

    console.log('Wrote', count, 'file(s)')

    await b.close()
  }
)

const listCmd = command(
  'list',
  summary('List files in a Bundlebee'),
  description('List all file entries stored in the Bundlebee.'),
  flag('--storage|-s <path>', 'corestore storage path (default: ~/.bundlebee)'),
  flag('--key|-k [key]', 'source Bundlebee key to list from'),
  flag('--abi|-a [abi]', 'list a specific abi'),
  validate(({ flags }) => {
    if (flags.abi && (isNaN(Number(flags.abi)) || Number(flags.abi) <= 0)) {
      return '--version must be a positive number'
    }
    return true
  }),
  async () => {
    const folder = path.resolve(process.cwd())
    const storagePath = path.join(folder, listCmd.flags.storage || defaultStorage)
    const abi = listCmd.flags.abi ? Number(listCmd.flags.abi) : undefined
    const key = listCmd.flags.key ? z32.decode(listCmd.flags.key) : null

    const store = new Corestore(storagePath)
    const b = new Bundlebee(store, key ? { store: core.get({ key }) } : undefined)
    const checkout = await b.findABI(abi)

    let count = 0
    for await (const { id, source } of b.createEntryStream(checkout)) {
      console.log(id, `(${source.length} bytes)`)
      count++
    }

    console.log('\n' + count, 'file(s)')

    const head = b.head()
    console.log('\nKey:', z32.encode(head.key))
    console.log('Length:', head.length)

    await b.close()
  }
)

const cmd = command(
  'hyperbundle',
  summary('Bundle modules into a hyperbee'),
  header('Hyperbundle - hyperbee module bundler'),
  storeCmd,
  checkoutCmd,
  listCmd,
  () => console.log(cmd.help())
)

cmd.parse()
