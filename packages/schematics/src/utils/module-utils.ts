/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {
  findNodes,
  insertAfterLastOccurrence
} from '@schematics/angular/utility/ast-utils';
import {
  Change,
  InsertChange,
  NoopChange,
  ReplaceChange,
  RemoveChange
} from '@schematics/angular/utility/change';

import * as ts from 'typescript';
import { offset, findClass } from './ast-utils';

export function addClass(
  source: ts.SourceFile,
  modulePath: string,
  clazzName: string,
  clazzSrc: string
): Change {
  if (!findClass(source, clazzName, true)) {
    const nodes = findNodes(source, ts.SyntaxKind.ClassDeclaration);
    return insertAfterLastOccurrence(
      nodes,
      offset(clazzSrc, 0, true),
      modulePath,
      0,
      ts.SyntaxKind.ClassDeclaration
    );
  }
  return new NoopChange();
}

export function addUnionTypes(
  source: ts.SourceFile,
  modulePath: string,
  typeName: string,
  typeValues: string[]
) {
  const target: ts.TypeAliasDeclaration = findNodesOfType(
    source,
    ts.SyntaxKind.TypeAliasDeclaration,
    name => name === typeName
  );
  if (!target) {
    throw new Error(`Cannot find union type '${typeName}'`);
  }

  const node = target.type as ts.TypeReferenceNode;

  // Append new types to create a union type...
  return new InsertChange(
    modulePath,
    node.end,
    ['', ...typeValues].join(' | ')
  );
}

/**
 * Add 1..n enumerators using name + (optional) value pairs
 */
export function addEnumeratorValues(
  source: ts.SourceFile,
  modulePath: string,
  enumName: string,
  pairs: NameValue[] = []
): Change[] {
  const target = findNodesOfType(
    source,
    ts.SyntaxKind.EnumDeclaration,
    name => name === enumName
  );
  const list = target ? target.members : undefined;

  if (!target) {
    throw new Error(`Cannot find enum '${enumName}'`);
  }

  return pairs.reduce((buffer, it) => {
    const addComma = !(list.hasTrailingComma || list.length === 0);
    const member = it.value ? `${it.name} = '${it.value}'` : it.name;
    const memberExists = () => {
      return list.filter(m => m.name.getText() === it.name).length;
    };

    if (memberExists()) {
      throw new Error(`Enum '${enumName}.${it.name}' already exists`);
    }

    return [
      ...buffer,
      new InsertChange(modulePath, list.end, (addComma ? ', ' : '') + member)
    ];
  }, []);
}

/**
 * Find Enum declaration in source based on name
 * e.g.
 *    export enum ProductsActionTypes {
 *       ProductsAction = '[Products] Action'
 *    }
 */
function findNodesOfType(
  source: ts.SourceFile,
  kind: ts.SyntaxKind,
  predicate: (a: any) => boolean,
  firstOnly: boolean = true
): any {
  const allEnums = findNodes(source, kind);
  const matching = allEnums.filter((i: any) => predicate(i.name.getText()));
  return matching.length
    ? firstOnly ? (matching[0] as ts.EnumDeclaration) : matching
    : undefined;
}

export interface NameValue {
  name: string;
  value?: string;
}

export function insertImport(
  source: ts.SourceFile,
  fileToEdit: string,
  symbolName: string,
  fileName: string,
  isDefault = false
): Change {
  const rootNode = source;
  const allImports = findNodes(rootNode, ts.SyntaxKind.ImportDeclaration);

  // get nodes that map to import statements from the file fileName
  const relevantImports = allImports.filter(node => {
    // StringLiteral of the ImportDeclaration is the import file (fileName in this case).
    const importFiles = node
      .getChildren()
      .filter(child => child.kind === ts.SyntaxKind.StringLiteral)
      .map(n => (n as ts.StringLiteral).text);

    return importFiles.filter(file => file === fileName).length === 1;
  });

  if (relevantImports.length > 0) {
    let importsAsterisk = false;
    // imports from import file
    const imports: ts.Node[] = [];
    relevantImports.forEach(n => {
      Array.prototype.push.apply(
        imports,
        findNodes(n, ts.SyntaxKind.Identifier)
      );
      if (findNodes(n, ts.SyntaxKind.AsteriskToken).length > 0) {
        importsAsterisk = true;
      }
    });

    // if imports * from fileName, don't add symbolName
    if (importsAsterisk) {
      return new NoopChange();
    }

    const importTextNodes = imports.filter(
      n => (n as ts.Identifier).text === symbolName
    );

    // insert import if it's not there
    if (importTextNodes.length === 0) {
      const fallbackPos =
        findNodes(
          relevantImports[0],
          ts.SyntaxKind.CloseBraceToken
        )[0].getStart() ||
        findNodes(relevantImports[0], ts.SyntaxKind.FromKeyword)[0].getStart();

      return insertAfterLastOccurrence(
        imports,
        `, ${symbolName}`,
        fileToEdit,
        fallbackPos
      );
    }

    return new NoopChange();
  }

  // no such import declaration exists
  const useStrict = findNodes(rootNode, ts.SyntaxKind.StringLiteral).filter(
    (n: ts.StringLiteral) => n.text === 'use strict'
  );
  let fallbackPos = 0;
  if (useStrict.length > 0) {
    fallbackPos = useStrict[0].end;
  }
  const open = isDefault ? '' : '{ ';
  const close = isDefault ? '' : ' }';
  // if there are no imports or 'use strict' statement, insert import at beginning of file
  const insertAtBeginning = allImports.length === 0 && useStrict.length === 0;
  const separator = insertAtBeginning ? '' : ';\n';
  const toInsert =
    `${separator}import ${open}${symbolName}${close}` +
    ` from '${fileName}'${insertAtBeginning ? ';\n' : ''}`;

  return insertAfterLastOccurrence(
    allImports,
    toInsert,
    fileToEdit,
    fallbackPos,
    ts.SyntaxKind.StringLiteral
  );
}
