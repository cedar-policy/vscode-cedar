# Cedar policy language for Visual Studio Code

The Cedar policy language extension for Visual Studio Code supports syntax highlighting, formatting, and validation.

## Features

- Cedar policy language (`*.cedar`) files
  - Syntax highlighting, file icons, snippets, and "on hover" descriptions for functions
  - Formatting (can disabled per file using a leading comment line of `// @formatter:off`)
  - Syntax validation on document open, save, context menu, and during formatting
  - Policy navigation from Outline or Breadcrumb
- Markdown files
  - Syntax highlighting of `cedar` code fence blocks
- Cedar schema (`cedarschema.json`, `*.cedarschema.json`) files
  - Syntax highlighting
  - Cedar schema validation on document open, save, and context menu
  - When Cedar schema file is detected or configured in **Settings**, validation of Cedar files using schema
  - Entity type navigation from Outline or Breadcrumb
- Cedar entities (`cedarentities.json`, `*.cedarentities.json`) files
  - Syntax highlighting
  - Validation against Cedar schema on document open, save, and context menu
  - Entity navigation from Outline or Breadcrumb

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
  "cedar.schemaFile": "example.cedarschema.json",
  "cedar.autodetectSchemaFile": true,
}
```

### Troubleshooting

Submit bug reports and feature requests [on our Github repository](https://github.com/cedar-policy/vscode-cedar/issues).
