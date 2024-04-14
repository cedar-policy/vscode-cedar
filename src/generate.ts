// Copyright Cedar Contributors
// SPDX-License-Identifier: Apache-2.0

import { Attributes, CedarSchemaDefinition, Shape } from './cedarschema';

export enum SchemaExportType {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  PlantUML = 'PlantUML',
  // eslint-disable-next-line @typescript-eslint/naming-convention
  Mermaid = 'Mermaid',
}
export const schemaExportTypeExtension: Record<
  keyof typeof SchemaExportType,
  string
> = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  PlantUML: '.puml',
  // eslint-disable-next-line @typescript-eslint/naming-convention
  Mermaid: '.mmd',
};

const buildProperties = (
  attributes: Attributes,
  diagramType: SchemaExportType,
  prefix: string = ''
): string => {
  let properties = '';

  Object.keys(attributes).forEach((k) => {
    let kname = k;
    if (attributes[k].required === false) {
      kname += '?';
    }
    let attributeType = attributes[k].type as String;
    if (attributeType === 'Entity') {
      attributeType = attributes[k].name as String;
    } else if (attributeType === 'Set') {
      const shapeType = attributes[k].element?.type as String;
      if (shapeType === 'Entity') {
        if (diagramType === SchemaExportType.Mermaid) {
          attributeType = `Set~${attributes[k].element?.name}~`;
        } else {
          attributeType = `Set<${attributes[k].element?.name}>`;
        }
      } else {
        if (diagramType === SchemaExportType.Mermaid) {
          attributeType = `Set~${shapeType}~`;
        } else {
          attributeType = `Set<${shapeType}>`;
        }
      }
    }

    if (attributeType === 'Record' && attributes[k].attributes) {
      properties += buildProperties(
        attributes[k].attributes as Attributes,
        diagramType,
        k
      );
    } else {
      if (prefix) {
        properties += `\n    ${attributeType} ${prefix}["${kname}"]`;
      } else {
        properties += `\n    ${attributeType} ${kname}`;
      }
    }
  });

  return properties;
};

export const generateDiagram = (
  diagramFilename: string,
  cedarschema: CedarSchemaDefinition,
  diagramType: SchemaExportType
): string => {
  let dsl = '';

  Object.keys(cedarschema).forEach((namespace: string) => {
    let title = 'Cedar Schema';
    if (namespace) {
      title += ' - ' + namespace;
    }
    let commonTypesDSL = '';

    let commonTypes: String[] = [];
    if (cedarschema[namespace].commonTypes) {
      // @ts-ignore
      commonTypes = Object.keys(cedarschema[namespace]?.commonTypes);
      commonTypes.forEach((name) => {
        // @ts-ignore
        const e = cedarschema[namespace]?.commonTypes[name];
        let properties = '\n';
        if (e?.attributes) {
          const attributes = e.attributes;
          properties = buildProperties(attributes, diagramType).replace(
            /    /g,
            '  '
          );
        }
        if (diagramType === SchemaExportType.Mermaid) {
          commonTypesDSL += `class ${name} {\n  <<commonType>>${properties}\n}\n\n`;
        } else {
          commonTypesDSL += `struct ${name} <<commonType>> {${properties}\n}\n\n`;
        }
      });
    }

    let entityTypesDSL = '';
    const entityTypesDSLTmp: Record<string, string> = {};
    let membersDSL = '';
    let parentsDSL = '';
    const entityTypes = Object.keys(cedarschema[namespace].entityTypes);
    entityTypes.forEach((name) => {
      const e = cedarschema[namespace].entityTypes[name];
      let properties = '';
      if (e?.shape?.attributes) {
        const attributes = e.shape.attributes;
        properties = buildProperties(attributes, diagramType);
      }
      entityTypesDSLTmp[name] =
        diagramType === SchemaExportType.Mermaid
          ? `  class ${name} {\n    <<Entity>>${properties}`
          : `  class ${name} <<Entity>> {${properties}`;

      if (e?.memberOfTypes) {
        e?.memberOfTypes.forEach((m) => {
          if (diagramType === SchemaExportType.Mermaid) {
            membersDSL += `${name} ..> ${m} : memberOf\n`;
          } else {
            membersDSL += `${name} - ${m} : > memberOf\n`;
          }
        });
      }
      if (commonTypes.includes(e?.shape?.type as string)) {
        if (diagramType === SchemaExportType.Mermaid) {
          parentsDSL += `${name} ..> ${e?.shape?.type} : shape\n`;
        } else {
          parentsDSL += `${name} -U- ${e?.shape?.type} : > shape\n`;
        }
      }
    });

    const actionsTmp: Record<string, string> = {};

    let actions = '';
    Object.keys(cedarschema[namespace].actions).forEach((name) => {
      const a = cedarschema[namespace].actions[name];
      let tmp =
        diagramType === SchemaExportType.Mermaid
          ? `  class ${name} {\n    <<Action>>`
          : `  class ${name} <<Action>> {`;

      if (a.appliesTo?.context?.attributes) {
        const attributes = a.appliesTo.context.attributes;
        let properties = buildProperties(attributes, diagramType);
        if (diagramType === SchemaExportType.PlantUML) {
          tmp += '\n    --context--';
        }
        tmp += properties + '\n';
      }
      if (tmp[tmp.length - 1] === '{') {
        tmp += '}\n';
      } else {
        tmp += '  }\n';
      }
      //tmp += diagramType === ExportType.Mermaid ? `\n  }\n` : `}\n`;
      if (commonTypes.includes(a.appliesTo?.context?.type as string)) {
        if (diagramType === SchemaExportType.Mermaid) {
          parentsDSL += `${name} ..> ${a.appliesTo?.context?.type} : context\n`;
        } else {
          parentsDSL += `${name} -U- ${a.appliesTo?.context?.type} : > context\n`;
        }
      }
      actions += tmp + '\n';

      if (a?.memberOf) {
        a.memberOf.forEach((m) => {
          if (diagramType === SchemaExportType.Mermaid) {
            membersDSL += `${name} ..> ${m.id} : memberOf\n`;
          } else {
            membersDSL += `${name} - ${m.id} : > memberOf\n`;
          }
        });
      }

      if (
        a.appliesTo &&
        a.appliesTo.principalTypes &&
        a.appliesTo.resourceTypes !== undefined
      ) {
        a.appliesTo.principalTypes.forEach((p) => {
          // @ts-ignore
          a.appliesTo.resourceTypes.forEach((r) => {
            if (!actionsTmp[p]) {
              actionsTmp[p] = '';
            }
            actionsTmp[p] += `\n    ${name}(${r})`;
          });
        });
      }
    });

    entityTypes.forEach((name) => {
      entityTypesDSL += entityTypesDSLTmp[name];
      if (actionsTmp[name]) {
        entityTypesDSL += actionsTmp[name];
      }
      if (entityTypesDSL[entityTypesDSL.length - 1] !== '{') {
        entityTypesDSL += '\n  ';
      }
      entityTypesDSL += '}\n\n';
    });

    if (diagramType === SchemaExportType.Mermaid) {
      dsl += formatMermaid(
        diagramFilename,
        title,
        commonTypesDSL,
        entityTypesDSL,
        actions,
        membersDSL,
        parentsDSL
      );
    } else {
      dsl += formatPuml(
        diagramFilename,
        title,
        commonTypesDSL,
        entityTypesDSL,
        actions,
        membersDSL,
        parentsDSL
      );
    }
  });
  return dsl;
};

const formatPuml = (
  diagramFilename: string,
  title: string,
  commonTypes: string,
  entityTypes: string,
  actions: string,
  members: string,
  parents: string
): string => {
  const puml = `@startuml ${diagramFilename}

title ${title}

${commonTypes}
package entityTypes <<Rectangle>> {

${entityTypes}}

package actions <<Rectangle>> {
  
${actions}}

${members}
${parents}
@enduml
`;

  return puml;
};

const formatMermaid = (
  diagramFilename: string,
  title: string,
  commonTypes: string,
  entityTypes: string,
  actions: string,
  members: string,
  parents: string
): string => {
  const mmd = `---
title: ${title}
---
classDiagram

${commonTypes}
namespace entityTypes {

${entityTypes}}

namespace actions {
  
${actions}}

${members}
${parents}`;

  return mmd;
};
