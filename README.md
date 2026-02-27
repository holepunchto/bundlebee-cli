# bundlebee

Bundle JavaScript modules into a [Hyperbee](https://github.com/holepunchto/hyperbee2) for peer-to-peer sharing.

## Install

```
npm install -g bundlebee
```

## Usage

### Store

Bundle a folder into a Bundlebee:

```
bundlebee store ./my-project
bundlebee store ./my-project main.js --abi 1
bundlebee store ./my-project --include-modules
bundlebee store ./my-project --dry-run
```

| Flag | Description |
|------|-------------|
| `--storage, -s <path>` | Corestore storage path (default: `.bundlebee`) |
| `--abi, -a <abi>` | Store under a specific ABI |
| `--include-modules` | Include `node_modules` (default: false) |
| `--dry-run` | Gather files without writing |

### Checkout

Checkout files from a Bundlebee to disk:

```
bundlebee checkout
bundlebee checkout --abi 2 --out ./build
bundlebee checkout --key <z32-key>
```

| Flag | Description |
|------|-------------|
| `--storage, -s <path>` | Corestore storage path |
| `--key, -k <key>` | Source Bundlebee key (z32-encoded) |
| `--abi, -a <abi>` | Checkout a specific ABI |
| `--out, -o <path>` | Output directory |

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
