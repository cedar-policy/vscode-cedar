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

Install `llvm` to va

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

### Test

To run NodeJS TypeScript test code from `src/test/suite/cedar-wasm.test.ts` and `src/test/suite/validation.test.ts` (using Cedar and Cedar schema files containing errors from `testdata`).

```bash
npm run test
```

### Build

The `npm install` included a devDependency for vsce (short for "Visual Studio Code Extensions"), a command-line tool for packaging, publishing and managing Visual Studio Code extensions.  Verify the installation of [@vscode/vsce](https://github.com/microsoft/vscode-vsce) by running:

```bash
npx vsce --version
```

Then run the `package` command to create the .vsix file.

```bash
npm run package
```

### Docker

To build and run tests in a clean environment, first build the container, then open a bash shell in the container.

```bash
docker build . -t cedar-policy/vscode-cedar
docker run --rm -it --entrypoint bash cedar-policy/vscode-cedar
```

Then build and test the extension inside the container.  This will take several minutes.

```bash
./build.sh
```

### Local Install

This extension can locally be installed to `~/.vscode/extensions` using the command palette and selecting **Extensions: Install from VSIX...** or running the following [Visual Studio Code command-line interface](https://code.visualstudio.com/docs/editor/command-line) command (see link if `code` is not in your PATH):

```bash
code --install-extension vscode-cedar-0.5.0.vsix
```

Note: Preview install may see a `[DEP0005] DeprecationWarning` tracked in GitHub issue [install-extension command throws Buffer deprecated warning #82524](https://github.com/microsoft/vscode/issues/82524)
