// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Cedar Schema definition
 */
export type CedarSchemaDefinition = {
  [namespace: string]: {
    commonTypes?: {
      [name: string]: Shape;
    };
    entityTypes: {
      [name: string]: {
        memberOfTypes?: string[];
        shape?: Shape;
      };
    };
    actions: {
      [name: string]: {
        appliesTo?: {
          principalTypes?: string[];
          resourceTypes?: string[];
          context?: Shape;
        };
        memberOf?: {
          id: string;
          type: string;
        }[];
      };
    };
  };
};

export type Shape = {
  type: 'Record' | String;
  attributes: Attributes;
};

export type Attributes = {
  [k: string]: AttributeType;
};

// avoid "TS2339: Property does not exist on union type"
// using optional undefined for name, element, and attributes
export type AttributeType =
  | {
      type: 'String' | 'Long' | 'Boolean';
      required?: boolean;
      name?: undefined;
      element?: undefined;
      attributes?: undefined;
    }
  | {
      type: 'Entity';
      required?: boolean;
      name: string;
      element?: undefined;
      attributes?: undefined;
    }
  | {
      type: 'Extension';
      required?: boolean;
      name: string;
      element?: undefined;
      attributes?: undefined;
    }
  | {
      type: 'Set';
      required?: boolean;
      name?: undefined;
      element: AttributeType;
      attributes?: undefined;
    }
  | {
      type: 'Record';
      required?: boolean;
      name?: undefined;
      element?: undefined;
      attributes: Attributes;
    };
