#!/usr/bin/env bare

const { command, flag, arg, summary, description, header, validate, rest } = require('paparam')
const Bundlebee = require('bundlebee')
const Corestore = require('corestore')
const path = require('path')
const process = require('process')
const fs = require('fs')
const Hyperswarm = require('hyperswarm')
const HyperDHT = require('hyperdht')
const ID = require('hypercore-id-encoding')
const BlindPeering = require('blind-peering')
const { pathToFileURL } = require('url-file-url')
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

const storageFlag = flag('--storage|-s <path>', 'corestore storage path (default: ./.bundlebee)')
const keyFlag = flag('--key|-k [key]', 'read a remote Bundlebee by key, replicating from peers')
const abiFlag = flag('--abi|-a [abi]', 'select a specific abi')
const versionFlag = flag(
  '--version|-v [range]',
  'select the newest version matching a semver range'
)

function getUrl(head, entrypoint) {
  return `bundle+pear://0.${head.length}.${ID.encode(head.key)}/${entrypoint}`
}

function validateAbi({ flags }) {
  if (flags.abi && (isNaN(Number(flags.abi)) || Number(flags.abi) <= 0)) {
    throw new Error('--abi must be a positive number')
  }
  return true
}

async function open(flags) {
  const store = new Corestore(path.resolve(flags.storage || defaultStorage))
  const key = flags.key ? ID.decode(flags.key) : null
  const b = new Bundlebee(store, key ? { key } : {})
  await b.ready()

  if (!key) return { b, close: () => b.close() }

  const swarm = new Hyperswarm()
  swarm.on('connection', (conn) => store.replicate(conn))

  const done = b.core.findingPeers()
  swarm.join(b.discoveryKey, { client: true, server: false })
  swarm.flush().then(done, done)
  await b.core.update()

  return {
    b,
    async close() {
      await swarm.destroy()
      await b.close()
    }
  }
}

async function select(b, flags) {
  if (flags.version) {
    const checkout = await b.resolve(flags.version)
    if (!checkout) throw new Error('No version matches ' + flags.version)
    console.log(label.info('Version ' + c.bold(checkout.version)))
    return checkout
  }

  const abi = flags.abi ? Number(flags.abi) : (await b.manifest())?.abi
  if (!abi) throw new Error('Bundlebee is empty')

  const checkout = await b.findABI(abi)
  if (!checkout) throw new Error('ABI ' + abi + ' not found')

  console.log(label.info('ABI ' + c.bold(abi)))
  return checkout
}

async function writeEntries(b, checkout, outPath) {
  let count = 0

  for await (const { id, source } of b.createEntryStream(checkout)) {
    const filePath = path.join(outPath, id)
    if (!filePath.startsWith(outPath + path.sep)) throw new Error('Entry escapes output: ' + id)

    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, source)

    count++
  }

  return count
}

function git(cwd, ...args) {
  spawnSync('git', args, { cwd, stdio: ['pipe', 'pipe', 'inherit'] })
}

// ── store ───────────────────────────────────────────────────────────────────

const storeCmd = command(
  'store',
  summary('Store a folder into a bundlebee'),
  description('Traverse and bundle a folder entry point into a hyperbee store.'),
  storageFlag,
  flag('--abi|-a [abi]', 'store under a specific abi'),
  flag('--version|-v [version]', 'index the bundle under an exact semver version'),
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

    return validateAbi({ flags })
  }),
  async () => {
    const { flags, args } = storeCmd
    const folder = path.resolve(args.folder)
    const entrypoint = args.entrypoint || 'index.js'
    const skipModules = flags.includeModules !== true
    const dryRun = flags.dryRun
    const abi = flags.abi ? Number(flags.abi) : undefined
    const version = flags.version || undefined

    const { b, close } = await open(flags)

    try {
      if (dryRun) console.log(c.yellow('[DRY RUN]'))
      console.log(label.info('Storing ' + c.bold(folder) + ' with entry ' + c.bold(entrypoint)))
      console.log(label.storage(path.resolve(flags.storage || defaultStorage)))

      const root = pathToFileURL(folder + path.sep)
      const bundle = await b.add(root, entrypoint, { skipModules, abi, version, dryRun })

      if (dryRun) {
        const manifest = await b.manifest()
        if (manifest && abi <= manifest.abi) {
          console.warn(label.warn(`ABI must be greater than existing: ${abi} <= ${manifest.abi}`))
        }
        const existing = version ? await b.resolve(version) : null
        if (existing && existing.version === version) {
          console.warn(label.warn(`Version ${version} already exists`))
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

      console.log()
      console.log(label.key(getUrl(head, entrypoint)))
      console.log(label.length(head.length))
    } finally {
      await close()
    }
  }
)

// ── checkout ────────────────────────────────────────────────────────────────

const checkoutCmd = command(
  'checkout',
  summary('Checkout files from a Bundlebee to a folder'),
  description('Checkout the bundle to disk'),
  storageFlag,
  keyFlag,
  abiFlag,
  versionFlag,
  flag('--out|-o [out]', 'checkout directory'),
  validate(validateAbi),
  async () => {
    const { flags } = checkoutCmd
    const outPath = path.resolve(flags.out || '.')

    const { b, close } = await open(flags)

    try {
      const checkout = await select(b, flags)

      console.log(label.info('Checking out to ' + c.bold(outPath)))

      const count = await writeEntries(b, checkout, outPath)

      console.log(label.ok('Wrote ' + c.bold(count) + ' file(s)'))
    } finally {
      await close()
    }
  }
)

// ── diff ────────────────────────────────────────────────────────────────────

const diffCmd = command(
  'diff',
  summary('Checkout multiple Bundles to a new git repo to allow git diffing'),
  description('Checkout historical Bundles to git'),
  storageFlag,
  keyFlag,
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
    const { flags } = diffCmd
    const outPath = path.resolve(flags.out || '.')

    if (fs.existsSync(outPath)) throw new Error('Output folder already exists: ' + outPath)

    const { b, close } = await open(flags)

    try {
      const abis = []
      if (flags.all) {
        for await (const res of b.allABIs()) abis.unshift(res.manifest.abi)
      } else {
        abis.push(...diffCmd.rest.map(Number))
      }

      fs.mkdirSync(outPath)
      git(outPath, 'init')

      console.log(label.info('Checking out to ' + c.bold(outPath)))

      for (const abi of abis) {
        console.log(c.magenta('  ⏵ ABI ' + c.bold(abi)))

        const checkout = await b.findABI(abi)
        if (!checkout) throw new Error('ABI ' + abi + ' not found')

        const count = await writeEntries(b, checkout, outPath)
        console.log(label.ok('Checked out ' + c.bold(count) + ' file(s) for ABI ' + c.bold(abi)))

        git(outPath, 'add', '.')
        git(outPath, 'commit', '-m', abi.toString())
      }
    } finally {
      await close()
    }

    console.log(c.dim('\nWaiting for <Ctrl-C> to remove diff...'))

    const keepalive = setInterval(() => {}, 1 << 30)

    process.once('SIGINT', () => {
      clearInterval(keepalive)
      fs.rmSync(outPath, { recursive: true, force: true })
    })
  }
)

// ── abis ────────────────────────────────────────────────────────────────────

const abiCmd = command(
  'abis',
  summary('List abis in a Bundlebee'),
  description('List all ABIs stored in the Bundlebee.'),
  storageFlag,
  keyFlag,
  async () => {
    const { b, close } = await open(abiCmd.flags)

    try {
      console.log(label.info('ABIs'))

      let found = false
      for await (const res of b.allABIs()) {
        found = true
        console.log(
          c.magenta('  ⏵ ABI ' + c.bold(res.manifest.abi)),
          c.dim('Length ' + res.checkout.length)
        )
      }

      if (!found) console.log(label.err('No ABIs'))
    } finally {
      await close()
    }
  }
)

// ── list ────────────────────────────────────────────────────────────────────

const listCmd = command(
  'list',
  summary('List files in a Bundlebee'),
  description('List all file entries stored in the Bundlebee.'),
  storageFlag,
  keyFlag,
  abiFlag,
  versionFlag,
  validate(validateAbi),
  async () => {
    const { flags } = listCmd
    const { b, close } = await open(flags)

    try {
      const checkout = await select(b, flags)

      console.log('')

      let count = 0
      for await (const { id, source } of b.createEntryStream(checkout)) {
        console.log(label.file(id) + c.grey(' (' + source.length + ' bytes)'))
        count++
      }

      console.log('\n' + label.ok(c.bold(count) + ' file(s)'))

      console.log()
      console.log(label.key(getUrl(checkout, '<entrypoint>')))
      console.log(label.length(checkout.length))
    } finally {
      await close()
    }
  }
)

// ── seed ────────────────────────────────────────────────────────────────────

const seedCmd = command(
  'seed',
  summary('Seed your Bundlebee'),
  description('Use Hyperswarm to share your Bundlebee with peers on your discovery key'),
  flag('--add', 'request blind peers to seed new bundlebee'),
  storageFlag,
  async () => {
    const { flags } = seedCmd
    const store = new Corestore(path.resolve(flags.storage || defaultStorage))
    const b = new Bundlebee(store)
    await b.ready()

    const keyPair = await store.createKeyPair('gip')

    let blindPeerKeys = []
    try {
      const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json')))
      blindPeerKeys = packageJson.blindPeers || []
    } catch {}

    const swarm = new Hyperswarm({ dht: new HyperDHT({ keyPair }) })

    swarm.on('connection', (conn) => {
      console.log(label.ok('Connected to ' + ID.encode(conn.remotePublicKey)))
      store.replicate(conn)
    })

    b.core.on('upload', (index, byteLength, peer) => {
      console.log(
        label.ok(`Sent block ${index} (${byteLength} bytes) to ${ID.encode(peer.remotePublicKey)}`)
      )
    })

    console.log(label.info(`Public Key: ${ID.encode(keyPair.publicKey)}`))
    console.log(label.info(`Connecting to ${blindPeerKeys.length} BlindPeers`))

    let blind = null
    if (flags.add && blindPeerKeys.length > 0) {
      blind = new BlindPeering(swarm, store, { mirrors: blindPeerKeys })
      await blind.addCore(b.core, undefined, { announce: true })
      console.log(label.ok('Requested Blind Peers to seed'))
    }

    for (const k of blindPeerKeys) swarm.joinPeer(ID.decode(k))

    swarm.join(b.discoveryKey, { client: true, server: true })

    console.log(label.info('Seeding ' + getUrl(b.head(), '<entrypoint>')))

    process.once('SIGINT', async () => {
      if (blind) await blind.close()
      await swarm.destroy()
      await b.close()
    })
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
