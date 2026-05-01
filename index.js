#!/usr/bin/env bare

const { command, flag, arg, summary, description, header, validate, rest } = require('paparam')
const Bundlebee = require('bundlebee')
const Corestore = require('corestore')
const path = require('path')
const process = require('process')
const fs = require('fs')
const z32 = require('z32')
const Hyperswarm = require('hyperswarm')
const HyperDHT = require('hyperdht')
const ID = require('hypercore-id-encoding')
const BlindPeering = require('blind-peering')
const { spawnSync } = require('child_process')

const defaultStorage = '.bundlebee'

const esc = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`

const c = {
  bold: esc('1'),
  dim: esc('2'),
  green: esc('32'),
  yellow: esc('33'),
  cyan: esc('36'),
  red: esc('31'),
  grey: esc('90'),
  magenta: esc('35')
}

const label = {
  key: (v) => c.cyan('Key: ') + c.bold(v),
  length: (v) => c.cyan('Length: ') + v,
  storage: (v) => c.dim('Storage: ') + v,
  file: (f) => c.grey('  ' + f),
  warn: (msg) => c.yellow('⚠ ' + msg),
  err: (msg) => c.red('✖ ' + msg),
  ok: (msg) => c.green('✔ ' + msg),
  info: (msg) => c.cyan('▸ ' + msg)
}

function getUrl(head, entrypoint) {
  return `bundle+pear://0.${head.length}.${z32.encode(head.key)}/${entrypoint}`
}

// ── store ───────────────────────────────────────────────────────────────────

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

    if (!fs.existsSync(folder)) throw new Error('folder does not exist: ' + folder)
    if (!fs.statSync(folder).isDirectory()) throw new Error('path is not a directory: ' + folder)

    const entrypoint = args.entrypoint || 'index.js'
    const entryPath = path.join(folder, entrypoint)

    if (!fs.existsSync(entryPath)) throw new Error('entrypoint does not exist: ' + entryPath)

    if (flags.abi && (isNaN(Number(flags.abi)) || Number(flags.abi) <= 0)) {
      throw new Error('--version must be a positive number')
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

    if (dryRun) console.log(c.yellow('[DRY RUN]'))
    console.log(label.info('Storing ' + c.bold(folder) + ' with entry ' + c.bold(entrypoint)))
    console.log(label.storage(path.resolve(storagePath)))

    const bundle = await b.add(root, entrypoint, { skipModules, abi, dryRun })

    if (dryRun) {
      const manifest = await b.manifest()
      if (manifest && abi <= manifest.abi) {
        console.warn(label.warn(`ABI must be greater than existing: ${abi} <= ${manifest.abi}`))
      }
    }

    const files = Object.keys(bundle.files)
    if (files.length === 0) {
      console.log(c.dim('No changes detected.'))
    } else {
      console.log(label.ok('Added ' + c.bold(files.length) + ' file(s):'))
      for (const f of files) console.log(label.file(f))
    }

    const head = b.head()
    const url = getUrl(head, entrypoint)

    console.log()
    console.log(label.key(url))
    console.log(label.length(head.length))

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
      throw new Error('--abi must be a positive number')
    }
    return true
  }),
  async () => {
    const folder = path.resolve(process.cwd())
    const storagePath = path.join(folder, checkoutCmd.flags.storage || defaultStorage)
    const key = checkoutCmd.flags.key ? z32.decode(checkoutCmd.flags.key) : null
    const outPath = checkoutCmd.flags.out ? path.join(folder, checkoutCmd.flags.out) : folder

    const store = new Corestore(storagePath)
    const b = new Bundlebee(store, key ? { store: store.get({ key }) } : undefined)
    const abi = checkoutCmd.flags.abi
      ? Number(checkoutCmd.flags.abi)
      : await b.manifest().then((m) => m.abi)

    const checkout = await b.findABI(abi)
    if (!checkout) {
      console.log(label.err('ABI ' + abi + ' not found'))
      return
    }

    console.log(label.info('ABI ' + c.bold(abi)))

    console.log(label.info('Checking out to ' + c.bold(outPath)))

    let count = 0
    for await (const { id, source } of b.createEntryStream(checkout)) {
      const filePath = path.join(outPath, id)
      const dir = path.dirname(filePath)

      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(filePath, source)

      console.log(label.file(id))
      count++
    }

    console.log(label.ok('Wrote ' + c.bold(count) + ' file(s)'))

    await b.close()
  }
)

const diffCmd = command(
  'diff',
  summary('Checkout multiple Bundles to a new git repo to allow git diffing'),
  description('Checkout historical Bundles to git'),
  flag('--storage|-s <path>', 'corestore storage path (default: ~/.bundlebee)'),
  flag('--key|-k [key]', 'source Bundlebee key to checkout from'),
  flag('--out|-o [out]', 'checkout directory'),
  flag('--all|-a', 'checkout all ABIs'),
  rest('[...abis]'),
  validate(({ rest, flags }) => {
    if (!rest && !flags.all) {
      throw new Error('one or more ABIs required')
    }

    if (flags.all) return true

    for (const abi of rest) {
      if (abi && (isNaN(Number(abi)) || Number(abi) <= 0)) {
        throw new Error('ABI must be a positive number')
      }
    }

    return true
  }),
  async () => {
    const folder = path.resolve(process.cwd())
    const storagePath = path.join(folder, diffCmd.flags.storage || defaultStorage)

    const key = diffCmd.flags.key ? z32.decode(diffCmd.flags.key) : null
    const outPath = diffCmd.flags.out ? path.join(folder, diffCmd.flags.out) : folder

    if (fs.existsSync(outPath)) throw new Error('Output folder already exists: ' + outPath)

    const store = new Corestore(storagePath)
    const b = new Bundlebee(store, key ? { store: store.get({ key }) } : undefined)

    async function loadAll() {
      const abis = []
      for await (const res of b.allABIs()) {
        abis.push(res.manifest.abi)
      }
      return abis.reverse()
    }

    const abis = diffCmd.flags.all ? await loadAll(b) : diffCmd.rest.map(Number)

    fs.mkdirSync(outPath)
    spawnSync('git', ['init'], { cwd: outPath, stdio: ['pipe', 'pipe', 'inherit'] })

    console.log(label.info('Checking out to ' + c.bold(outPath)))

    for (const abi of abis) {
      console.log(c.magenta('  ⏵ ABI ' + c.bold(abi)))
      const checkout = await b.findABI(abi)
      if (!checkout) {
        console.log(label.err('ABI ' + abi + ' not found'))
        return
      }

      let count = 0
      for await (const { id, source } of b.createEntryStream(checkout)) {
        const filePath = path.join(outPath, id)
        const dir = path.dirname(filePath)

        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(filePath, source)

        count++
      }
      console.log(label.ok('Checked out ' + c.bold(count) + ' file(s) for ABI ' + c.bold(abi)))

      spawnSync('git', ['add', '.'], { cwd: outPath, stdio: ['pipe', 'pipe', 'inherit'] })
      spawnSync('git', ['commit', '-m', abi.toString()], {
        cwd: outPath,
        stdio: ['pipe', 'pipe', 'inherit']
      })
    }

    const keepalive = setInterval(() => {}, 1 << 30)

    process.on('SIGINT', async function () {
      fs.rm(outPath, { recursive: true, force: true })
      await b.close()
      clearInterval(keepalive)
    })

    console.log(c.dim('\nWaiting for <Ctrl-C> to remove diff...'))
  }
)

const abiCmd = command(
  'abis',
  summary('List abis in a Bundlebee'),
  description('List all ABIs stored in the Bundlebee.'),
  flag('--storage|-s <path>', 'corestore storage path (default: ~/.bundlebee)'),
  flag('--key|-k [key]', 'source Bundlebee key to list from'),
  async () => {
    const folder = path.resolve(process.cwd())
    const storagePath = path.join(folder, abiCmd.flags.storage || defaultStorage)
    const key = abiCmd.flags.key ? z32.decode(abiCmd.flags.key) : null

    const store = new Corestore(storagePath)
    const b = new Bundlebee(store, key ? { store: store.get({ key }) } : undefined)

    console.log(label.info('ABIs'))

    let found = false
    for await (const res of b.allABIs()) {
      found = true
      console.log(
        c.magenta('  ⏵ ABI ' + c.bold(res.manifest.abi)),
        c.dim('Length ' + res.checkout.length)
      )
    }

    if (!found) {
      console.log(label.err('No ABIs'))
    }

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
      throw new Error('--version must be a positive number')
    }
    return true
  }),
  async () => {
    const folder = path.resolve(process.cwd())
    const storagePath = path.join(folder, listCmd.flags.storage || defaultStorage)
    const key = listCmd.flags.key ? z32.decode(listCmd.flags.key) : null

    const store = new Corestore(storagePath)
    const b = new Bundlebee(store, key ? { store: store.get({ key }) } : undefined)
    const abi = listCmd.flags.abi
      ? Number(listCmd.flags.abi)
      : await b.manifest().then((m) => m.abi)

    const checkout = await b.findABI(abi)
    if (!checkout) {
      console.log(label.err('ABI ' + abi + ' not found'))
      return
    }

    console.log(label.info('ABI ' + c.bold(abi)))

    console.log('')

    let count = 0
    for await (const { id, source } of b.createEntryStream(checkout)) {
      console.log(label.file(id) + c.grey(' (' + source.length + ' bytes)'))
      count++
    }

    console.log('\n' + label.ok(c.bold(count) + ' file(s)'))

    const head = b.head()
    const url = getUrl(head, '<entrypoint>')

    console.log()
    console.log(label.key(url))
    console.log(label.length(head.length))

    await b.close()
  }
)

const seedCmd = command(
  'seed',
  summary('Seed your Bundlebee'),
  description('Use Hyperswarm to share your Bundlebee with peers on your discovery key'),
  flag('--add', 'request blind peers to seed new bundlebee'),
  flag('--storage|-s <path>', 'corestore storage path (default: ~/.bundlebee)'),
  async () => {
    const folder = path.resolve(process.cwd())
    const storagePath = path.join(folder, seedCmd.flags.storage || defaultStorage)
    const key = seedCmd.flags.key ? z32.decode(seedCmd.flags.key) : null
    const addCores = !!seedCmd.flags.add

    const store = new Corestore(storagePath)
    const b = new Bundlebee(store, key ? { store: store.get({ key }) } : undefined)
    await b.ready()

    const keyPair = await store.createKeyPair('gip')

    let blindPeerKeys = []
    try {
      const packageJson = JSON.parse(fs.readFileSync(path.join(folder, 'package.json')))
      blindPeerKeys = packageJson.blindPeers || []
    } catch {}

    const swarm = new Hyperswarm({
      dht: new HyperDHT({
        keyPair: keyPair
      })
    })
    swarm.on('connection', (conn) => {
      console.log(label.ok(ID.encode(conn.remotePublicKey), '<-- connected to'))
      store.replicate(conn)
    })
    b.core.on('download', (index, byteLength, peer) => {
      console.log(label.ok(ID.encode(peer.publicKey), index, byteLength))
    })

    console.log(label.info(`Public Key: ${ID.encode(keyPair.publicKey)}`))
    console.log(label.info(`Connecting to ${blindPeerKeys.length} BlindPeers`))

    let blind
    if (addCores) {
      blind = new BlindPeering(swarm, store, { mirrors: blindPeerKeys })
      console.log(label.ok('Requesting Blind Peers to seed'))
    }

    for (const k of blindPeerKeys) {
      if (addCores) await blind.addCore(b.core, undefined, { announce: true })
      swarm.joinPeer(ID.decode(k))
    }

    swarm.join(b.discoveryKey, { client: true, server: true })

    console.log(label.info('Seeding...'))
  }
)

const cmd = command(
  'bundlebee',
  summary('Bundle modules into a hyperbee'),
  header('Bundlebee - hyperbee module bundler'),
  storeCmd,
  checkoutCmd,
  listCmd,
  diffCmd,
  abiCmd,
  seedCmd,
  () => console.log(cmd.help())
)

cmd.parse()
