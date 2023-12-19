# JSON Schemas

The [JSON Schema](https://json-schema.org/) files in this folder are **experimental** and **not enabled** in the Cedar policy language extension for Visual Studio Code.  The extension already validates Cedar schema and entities files using Cedar APIs.  These JSON Schemas perform a base level of validation, but also can enable simple auto-completion.  They include VS Code-specific schema extensions including `defaultSnippets` and `markdownDescription`.

The Visual Studio Code documentation for [JSON schemas and settings](https://code.visualstudio.com/docs/languages/json#_json-schemas-and-settings) explains how to associate a JSON file with a JSON Schema.  You can edit your `.vscode/settings.json` to reference the GitHub hosted files:

```json
  "json.schemas": [
    {
      "fileMatch": ["*.cedarschema.json", "cedarschema.json"],
      "url": "https://raw.githubusercontent.com/cedar-policy/vscode-cedar/main/schemas/cedarschema.schema.json"
    },
    {
      "fileMatch": ["*.cedarentities.json", "cedarentities.json"],
      "url": "https://raw.githubusercontent.com/cedar-policy/vscode-cedar/main/schemas/cedarentities.schema.json"
    },
    {
      "fileMatch": ["*.cedartemplatelinks.json", "cedartemplatelinks.json"],
      "url": "https://raw.githubusercontent.com/cedar-policy/vscode-cedar/main/schemas/cedartemplatelinks.schema.json"
    },
    {
      "fileMatch": ["*.cedarauth.json", "cedarauth.json"],
      "url": "https://raw.githubusercontent.com/cedar-policy/vscode-cedar/main/schemas/cedarauth.schema.json"
    }
  ],
```

You can also download these schema files and change the `url` values to reference your local copies.

## Development

If you are building the Cedar policy language extension for Visual Studio from source and creating a custom `.vsix` file, you can update `package.json` with the `jsonValidation` section below to enable this for all extension users.

```json
    "jsonValidation": [
      {
        "fileMatch": [
          "*.cedarschema.json", 
          "cedarschema.json"
        ],
        "url": "./schemas/cedarschema.schema.json"
      },
      {
        "fileMatch": [
          "*.cedarentities.json", 
          "cedarentities.json"
        ],
        "url": "./schemas/cedarentities.schema.json"
      },
      {
        "fileMatch": [
          "*.cedartemplatelinks.json", 
          "cedartemplatelinks.json"
        ],
        "url": "./schemas/cedartemplatelinks.schema.json"
      },
      {
        "fileMatch": [
          "*.cedarauth.json", 
          "cedarauth.json"
        ],
        "url": "./schemas/cedarauth.schema.json"
      }
    ],
```
