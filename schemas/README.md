# JSON Schemas

The [JSON Schema](https://json-schema.org/) files in this folder are **experimental** and **not enabled** in the Cedar policy language extension for Visual Studio Code.  The extension already validates Cedar schema and entities files using Cedar APIs.  These JSON Schemas perform a base level of validation, but also can enable a base level of auto-completion.

The Visual Studio Code documentation for [JSON schemas and settings](https://code.visualstudio.com/docs/languages/json#_json-schemas-and-settings) explains how to associate a JSON file with a JSON Schema.  For example, if you download `cedarschema.schema.json` and `cedarentities.schema.json` into your workspace, you can edit your `.vscode/settings.json` to reference them:

```json
  "json.schemas": [
    {
      "fileMatch": ["*.cedarschema.json", "cedarschema.json"],
      "url": "./cedarschema.schema.json"
    },
    {
      "fileMatch": ["*.cedarentities.json", "cedarentities.json"],
      "url": "./cedarentities.schema.json"
    }
  ],
```

These schema files include VS Code-specific schema extensions including `defaultSnippets` and `markdownDescription`.

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
      }
    ],
```
