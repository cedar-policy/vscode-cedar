# Development

Visual Studio Code extension development requires `node` and `npm`.  This extension is authored in TypeScript, which is included in the `devDependencies` section of `package.json`.

Install project dependencies:

```bash
npm install
```

## Cedar WASM

Cedar libraries in Rust, compiled to WASM, for use in this Visual Studio Code extension. Uses open source [cedar-policy/cedar](https://github.com/cedar-policy/cedar).

### Install Rust and wasm-pack

Read these for background:

* [wasm-bindgen](https://github.com/rustwasm/wasm-bindgen)
* [Welcome to the wasm-pack docs!](https://rustwasm.github.io/docs/wasm-pack/introduction.html)

Install Rust and wasm-pack

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
```

### macOS wasm build support

Install `llvm`

```bash
brew install llvm
export PATH="/usr/local/opt/llvm/bin/:$PATH"
export CC=/usr/local/opt/llvm/bin/clang
export AR=/usr/local/opt/llvm/bin/llvm-ar
```

```bash
npm run wasm-build
```

## Visual Studio Code Extension

The `package.json` directly refers to the `vscode-cedar-wasm/pkg` folder.

```json
  "dependencies": {
    "vscode-cedar-wasm": "file:vscode-cedar-wasm/pkg"
  },
```

`package.json` also determines version 1.82 or higher by setting `engines` and pinning `devDependencies` on `@types` for that version of `vscode` and its version of `node`

```json
  "engines": {
    "vscode": "^1.82.0"
  },

  "devDependencies": {
    "@types/node": "=18.15.0",
    "@types/vscode": "=1.82.0",
    // ...
  }
```

### Test

To run NodeJS TypeScript test code from `src/test/suite/*.test.ts` (using Cedar and Cedar schema files containing errors from `testdata`).

```bash
npm run test
```

### Build

The `npm install` included a devDependency for `vsce` (short for "Visual Studio Code Extensions"), a command-line tool for packaging, publishing and managing Visual Studio Code extensions.  Verify the installation of [@vscode/vsce](https://github.com/microsoft/vscode-vsce) by running:

```bash
npx vsce --version
```

Then run the `package` command to create the "pre-release" .vsix file.

```bash
npx vsce package --pre-release
```

### Container Testing

To build and run tests in a clean environment, first build the container, then open a bash shell in the container.  The CLI commands below use `docker`, but are compatible with the [`Finch`](https://github.com/runfinch/finch) open source client for container development.

```bash
docker build . -t cedar-policy/vscode-cedar
docker run --rm -it --entrypoint bash cedar-policy/vscode-cedar
```

Then build and test the extension inside the container.  This will take several minutes.

```bash
./build.sh
```

### Local Install

This extension can locally be installed to `~/.vscode/extensions` using the command palette and selecting **Extensions: Install from VSIX...** or running the following [Visual Studio Code command-line interface](https://code.visualstudio.com/docs/editor/command-line) command (see link if `code` is not in your PATH) replacing the `.vsix` filename:

```bash
code --install-extension vscode-cedar-{major}.{minor}.{patch}.vsix
```

Note: Preview install may see a `[DEP0005] DeprecationWarning` tracked in GitHub issue [install-extension command throws Buffer deprecated warning #82524](https://github.com/microsoft/vscode/issues/82524)

### GitHub Pull Request

The project currently uses GitHub flow where feature branches are merged into the `main` branch where releases are tagged.  `.github\workflows\build_and_test.yml` runs on `push` and `pull_request` to the `main` and `prerelease` branches.

Pull requests require a [Developer Certificate of Origin (DCO)](https://probot.github.io/apps/dco/) to certify the right to submit the code they are contributing to the project.  Either add the `-s` or the `--signoff` flag to your commits or update your `.vscode/settings.json` with `git.alwaysSignOff`.

```json
{
  "git.alwaysSignOff": true
}
```
