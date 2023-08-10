# Cedar policy language for Visual Studio Code

The Cedar policy language extension for Visual Studio Code supports syntax highlighting, formatting, and validation.  Install from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=cedar-policy.vscode-cedar) or by [searching within VS Code](https://code.visualstudio.com/docs/editor/extension-gallery#_search-for-an-extension).

Cedar is a language for writing authorization policies and making authorization decisions based on those policies. Visit the [Cedar policy language reference guide](https://docs.cedarpolicy.com/) for the documentation and the language specification.

## Features

### Cedar policy language

Files matching `*.cedar` are detected as a Cedar policy language and receive syntax highlighting.  Validation is performed on document open, document save, during formatting, and via context menu.  Formatting can disabled per file using a leading comment line of `// @formatter:off`.  Policy navigation using Outline or Breadcrumb.

![Cedar policy validation and navigation](https://raw.githubusercontent.com/cedar-policy/vscode-cedar/main/docs/marketplace/cedar_policy.gif)

### Cedar schema

Files named `cedarschema.json` or matching `*.cedarschema.json` are detected as a Cedar schema and receive additional syntax highlighting.  Validation is performed on document open, document save, and via context menu.  When a Cedar schema file is detected or configured in [Settings](#settings), additional validation of Cedar files uses that schema.  Entity type navigation using Outline or Breadcrumb.

![Cedar schema validation and navigation](https://raw.githubusercontent.com/cedar-policy/vscode-cedar/main/docs/marketplace/cedar_schema.gif)

### Cedar entities

Files named `cedarentities.json` or matching `*.cedarentities.json` are detected as Cedar entities and receive additional syntax highlighting.  Validation is performed against a Cedar schema on document open, document save, and via context menu.  Entity navigation using Outline or Breadcrumb.

![Cedar entities validation and navigation](https://raw.githubusercontent.com/cedar-policy/vscode-cedar/main/docs/marketplace/cedar_entities.gif)

### Markdown

Syntax highlighting of `cedar` code fence blocks within markdown (`*.md`) files.

![Cedar markdown syntax highlighting](https://raw.githubusercontent.com/cedar-policy/vscode-cedar/main/docs/marketplace/cedar_markdown.png)

### Command Palette

To see all available Cedar commands, open the [Command Palette](https://code.visualstudio.com/docs/getstarted/userinterface#_command-palette) and type **Cedar**.

![Cedar Command Palette](https://raw.githubusercontent.com/cedar-policy/vscode-cedar/main/docs/marketplace/cedar_commands.png)

### Settings

Sample `.vscode/settings.json` which enables `editor` settings for `cedar` files, sets a workspace level Cedar schema, and enables auto detection of folder level Cedar schema files.

```json
{
  "[cedar]": {
    "editor.tabSize": 2,
    "editor.wordWrapColumn": 80,
    "editor.formatOnSave": true,
    "editor.defaultFormatter": "cedar-policy.vscode-cedar",
  },
  "cedar.schemaFile": "tinytodo.cedarschema.json",
  "cedar.autodetectSchemaFile": true,
}
```

## Troubleshooting

Submit bug reports and feature requests [on our Github repository](https://github.com/cedar-policy/vscode-cedar/issues). For potential security issues, visit [reporting a vulnerability](https://github.com/cedar-policy/vscode-cedar/security/policy) for instructions.
