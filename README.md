# bundlebee

Bundle JavaScript modules into a [Hyperbee](https://github.com/holepunchto/hyperbee2) for peer-to-peer sharing.

## Install

```
npm install -g bundlebee
```

## Publishing modules with Bundlebee

Bundlebee replaces `npm publish` with P2P distribution. You bundle your module into a Hyperbee, seed it on the swarm, and consumers import it by link — no registry required.

### Release flow

#### 1. Bundle your module

```sh
bundlebee store . index.js
```

This traverses `.`, resolves its dependency tree from `index.js` (if no entrypoint, `index.js` will be used), and stores everything into a local Hyperbee. On completion it prints the import link directly:

```
✔ Added 14 file(s):
  /index.js
  /lib/utils.js
  ...

Key: bundle+pear://0.7.zgqe3s3i7dcb9tirqu8zb5tb9c7xkbs165eyiaxy1ep7xhqboozy/index.js
Length: 7
```

That `Key:` line is your import link — copy it and share it with consumers.

Optionally: Use `--abi` to tag each release. The ABI must increment with each publish — think of it as your version number. Append `?abi=<n>` to the link so consumers resolve the correct checkout.

If ABI is provided instead of length, it has the same end effect. Except it will need to get the latest Bundlebee data; and search it to find the correct checkout point based on the ABI.

> **Pinning with length:** For safety, length is prefixed to the url so we can checkout the exact Bundle rather than latest:
>
> ```
> bundle+pear://0.7.zgqe3s3i7dcb9tirqu8zb5tb9c7xkbs165eyiaxy1ep7xhqboozy@7/index.js?abi=1
> ```

> **Note:** `--dry-run` lets you preview what would be stored and warns if your ABI isn't greater than the last one.

#### 2. Seed it

```sh
bundlebee seed
```

This joins the Hyperswarm on your bundle's discovery key so peers can replicate. Keep this running (or add blind peers to `package.json` for persistent seeding):

```json
{
  "blindPeers": ["<public-key>"]
}
```

#### 4. Import from another project

```js
const Import = require('bundlebee-import')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')

const store = new Corestore('./reader-storage')
const swarm = new Hyperswarm()
swarm.on('connection', (conn) => store.replicate(conn))

const mod = await Import(store, 'bundle+pear://0.7.zgqe3s3i7dcb...@7/index.js', {
  swarm
})

// mod is the module's exports, as if you had require()'d it
```

`bundlebee-import` joins the swarm, replicates the core, resolves the ABI checkout, loads the module graph, and returns `module.exports` — then tears down the Bundlebee instance.

Note: swarm is optional, and can be handled manually

### Updating

To publish a new version, simply run again:

```sh
bundlebee store . index.js
```

Distribute the new link with the updated length or abi.

## Usage

### Store

Bundle a folder into a Bundlebee:

```
bundlebee store ./my-project
bundlebee store ./my-project main.js --abi 1
bundlebee store ./my-project --include-modules
bundlebee store ./my-project --dry-run
```

| Flag                   | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `--storage, -s <path>` | Corestore storage path (default: `.bundlebee`) |
| `--abi, -a <abi>`      | Store under a specific ABI                     |
| `--include-modules`    | Include `node_modules` (default: false)        |
| `--dry-run`            | Gather files without writing                   |

### Checkout

Checkout files from a Bundlebee to disk:

```
bundlebee checkout
bundlebee checkout --abi 2 --out ./build
bundlebee checkout --key <z32-key>
```

| Flag                   | Description                        |
| ---------------------- | ---------------------------------- |
| `--storage, -s <path>` | Corestore storage path             |
| `--key, -k <key>`      | Source Bundlebee key (z32-encoded) |
| `--abi, -a <abi>`      | Checkout a specific ABI            |
| `--out, -o <path>`     | Output directory                   |

### List

List files stored in a Bundlebee:

```
bundlebee list
bundlebee list --abi 1
```

### ABIs

List all stored ABIs:

```
bundlebee abis
```

### Diff

Checkout multiple ABIs into a temporary git repo for diffing:

```
bundlebee diff 1 2 3
bundlebee diff --all
bundlebee diff --all --out ./diff-output
```

Each ABI is checked out as a separate git commit. The output directory is removed on `Ctrl-C`.

### Seed

Seed your Bundlbee. Can optionally get blind peer keys from `package.json`.

Should be an array of z32 encoded strings `blindPeers`.

```json
{
  "main": "index.js",
  "blindPeers": [
    "qt1zg7dwci3ze7dfqp48e3muqt4gkh5wqt1zg7dwci3ze7dfqp4y"
  ],
  ...
}
```

```
bundlebee seed
bundlebee seed --add
```

`--add` will add your core to the blind peers and request they be announced

## How it works

Bundlebee traverses a project's dependency graph starting from an entry point, resolves all `require()` calls, and stores the resulting files in a Hyperbee keyed by ABI version. This makes versioned module bundles available over Hyperswarm for P2P distribution.

## License

Apache-2.0
