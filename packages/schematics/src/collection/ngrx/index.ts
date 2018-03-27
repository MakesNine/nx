import {
  apply,
  branchAndMerge,
  chain,
  externalSchematic,
  SchematicsException,
  mergeWith,
  move,
  noop,
  Rule,
  template,
  Tree,
  url
} from '@angular-devkit/schematics';
import {
  Change,
  InsertChange,
  NoopChange,
  RemoveChange,
  ReplaceChange
} from '@schematics/angular/utility/change';
import {
  findNodes,
  insertAfterLastOccurrence
} from '@schematics/angular/utility/ast-utils';
import { insertImport } from '@schematics/angular/utility/route-utils';
import { stripIndents } from '@angular-devkit/core/src/utils/literals';

import { NgrxOptions } from './schema';
import * as path from 'path';
import * as ts from 'typescript';
import * as stringUtils from '../../utils/strings';
import {
  ngrxVersion,
  routerStoreVersion,
  ngrxStoreFreezeVersion
} from '../../lib-versions';

import {
  findModuleParent,
  names,
  toClassName,
  toFileName,
  toPropertyName
} from '../../utils/name-utils';
import {
  addClass,
  addEnumeratorValues,
  addUnionTypes
} from '../../utils/module-utils';
import {
  insert,
  addImportToModule,
  addProviderToModule,
  offset
} from '../../utils/ast-utils';

import { serializeJson } from '../../utils/fileutils';
import { wrapIntoFormat } from '../../utils/tasks';

/**
 * Schematic request context
 */
export interface RequestContext {
  featureName: string;
  moduleDir: string;
  options?: NgrxOptions;
}

/**
 * Rule to generate the Nx 'ngrx' Collection
 */
export default function generateNgrxCollection(_options: NgrxOptions): Rule {
  return wrapIntoFormat(() => {
    const options = normalizeOptions(_options);
    const context: RequestContext = {
      featureName: options.name,
      moduleDir: findModuleParent(options.module),
      options
    };

    return chain([
      branchAndMerge(generateNgrxFiles(context)),
      branchAndMerge(generateNxFiles(context)),

      addImportsToModule(context),

      updateNgrxActions(context),
      updateNgrxReducers(context),
      updateNgrxEffects(context),

      options.skipPackageJson ? noop() : addNgRxToPackageJson()
    ]);
  });
}

// ********************************************************
// Internal Function
// ********************************************************

/**
 * Generate the Nx files that are NOT created by the @ngrx/schematic(s)
 */
function generateNxFiles(context: RequestContext) {
  const templateSource = apply(url('./files'), [
    template({ ...context.options, tmpl: '', ...names(context.featureName) }),
    move(context.moduleDir)
  ]);
  return chain([mergeWith(templateSource)]);
}

/**
 * Using @ngrx/schematics, generate scaffolding for 'feature': action, reducer, effect files
 */
function generateNgrxFiles(context: RequestContext) {
  return chain([
    externalSchematic('@ngrx/schematics', 'feature', {
      name: context.featureName,
      sourceDir: './',
      flat: false
    }),
    moveToNxMonoTree(
      context.featureName,
      context.moduleDir,
      context.options.directory
    )
  ]);
}

/**
 * Add LoadData and DataLoaded actions to <featureName>.actions.ts
 * See Ngrx Enhancement doc:  https://bit.ly/2I5QwxQ
 */
function updateNgrxActions(context: RequestContext): Rule {
  return (host: Tree) => {
    const clazzName = toClassName(context.featureName);
    const componentPath = buildNameToNgrxFile(context, 'actions.ts');
    const text = host.read(componentPath);

    if (text === null) {
      throw new SchematicsException(`File ${componentPath} does not exist.`);
    }

    const sourceText = text.toString('utf-8');
    const source = ts.createSourceFile(
      componentPath,
      sourceText,
      ts.ScriptTarget.Latest,
      true
    );

    insert(host, componentPath, [
      ...addEnumeratorValues(source, componentPath, `${clazzName}ActionTypes`, [
        {
          name: 'LoadData',
          value: `[${clazzName}] Load Data`
        },
        {
          name: 'DataLoaded',
          value: `[${clazzName}] Data Loaded`
        }
      ]),
      addClass(
        source,
        componentPath,
        'LoadData',
        stripIndents`
        export class LoadData implements Action {
          readonly type = ${clazzName}ActionTypes.LoadData;
          constructor(public payload: any) { }
        }`
      ),
      addClass(
        source,
        componentPath,
        'DataLoaded',
        stripIndents`
        export class DataLoaded implements Action {
          readonly type = ${clazzName}ActionTypes.DataLoaded;
          constructor(public payload: any) { }
        }`
      ),
      addUnionTypes(source, componentPath, `${clazzName}Actions`, [
        'LoadData',
        'DataLoaded'
      ])
    ]);
  };
}

/**
 * Add DataLoaded action to <featureName>.reducer.ts
 */
function updateNgrxReducers(context: RequestContext): Rule {
  return (host: Tree) => {
    const clazzName = toClassName(context.featureName);
    const componentPath = buildNameToNgrxFile(context, 'reducer.ts');
    const text = host.read(componentPath);

    if (text === null) {
      throw new SchematicsException(`File ${componentPath} does not exist.`);
    }

    const modulePath = context.options.module;
    const sourceText = text.toString('utf-8');
    const source = ts.createSourceFile(
      componentPath,
      sourceText,
      ts.ScriptTarget.Latest,
      true
    );
    const removeStateInterface = () => {
      // Remove `export interface State {  }` since we have <featureName>.interfaces.ts
      let action: Change = new NoopChange();

      findNodes(source, ts.SyntaxKind.InterfaceDeclaration)
        .filter((it: ts.InterfaceDeclaration) => it.name.getText() === 'State')
        .map((it: ts.InterfaceDeclaration) => {
          action = new RemoveChange(componentPath, it.pos, it.getText());
        });
      return action;
    };
    const updateReducerFn = () => {
      let actions: Change[] = [];
      findNodes(source, ts.SyntaxKind.FunctionDeclaration)
        .filter((it: ts.FunctionDeclaration) => it.name.getText() === 'reducer')
        .map((it: ts.FunctionDeclaration) => {
          const fnName: ts.Identifier = it.name;
          const typeName = findNodes(it, ts.SyntaxKind.Identifier).reduce(
            (result: ts.Identifier, it: ts.Identifier): ts.Identifier => {
              return !!result
                ? result
                : it.getText() === 'State' ? it : undefined;
            },
            undefined
          );

          actions = [
            new ReplaceChange(
              componentPath,
              fnName.pos,
              fnName.getText(),
              `${toPropertyName(context.featureName)}Reducer`
            ),
            new ReplaceChange(
              componentPath,
              typeName.pos,
              typeName.getText(),
              clazzName
            )
          ];
        });

      return actions;
    };
    const updateSwitchStatement = () => {
      const toInsert = stripIndents`
        case ${clazzName}ActionTypes.DataLoaded: {
         return { ...state, ...action.payload };
        }
      `;
      return insertAfterLastOccurrence(
        findNodes(source, ts.SyntaxKind.SwitchStatement),
        toInsert,
        componentPath,
        0,
        ts.SyntaxKind.CaseClause
      );
    };

    insert(host, componentPath, [
      removeStateInterface(),
      insertImport(
        source,
        modulePath,
        clazzName,
        `./${context.featureName}.interfaces`
      ),
      insertImport(
        source,
        modulePath,
        `${clazzName}Actions`,
        `./${context.featureName}.actions`
      ),
      ...updateReducerFn(),
      updateSwitchStatement()
    ]);
  };
}

function updateNgrxEffects(context: RequestContext): Rule {
  return (host: Tree) => {
    const clazzName = toClassName(context.featureName);
    const componentPath = buildNameToNgrxFile(context, 'effects.ts');
    const featureInterfaces = `./${context.featureName}.interfaces`;
    const text = host.read(componentPath);

    if (text === null) {
      throw new SchematicsException(`File ${componentPath} does not exist.`);
    }

    const modulePath = context.options.module;
    const sourceText = text.toString('utf-8');
    const source = ts.createSourceFile(
      componentPath,
      sourceText,
      ts.ScriptTarget.Latest,
      true
    );
    const updateConstructor = () => {
      const toInsert = stripIndents`
        , private dataPersistence: DataPersistence<${clazzName}>
      `;
      const astConstructor = findNodes(source, ts.SyntaxKind.Constructor)[0];
      const lastParameter = findNodes(
        astConstructor,
        ts.SyntaxKind.Parameter
      ).pop();

      return new InsertChange(componentPath, lastParameter.end, toInsert);
    };
    const addEffect = () => {
      const toInsert = `\n
  @Effect()
  loadData = this.dataPersistence.fetch('LOAD_DATA', {
   run: (action: LoadData, state: ${clazzName}) => {
     return new DataLoaded({ });
   },
  
   onError: (action: LoadData, error) => {
     console.error('Error', error);
   }
  });
       `;
      const astConstructor = findNodes(source, ts.SyntaxKind.Constructor)[0];
      return new InsertChange(componentPath, astConstructor.pos, toInsert);
    };

    const actionsFile = `./${context.featureName}.actions`;

    insert(host, componentPath, [
      insertImport(source, modulePath, 'DataPersistence', `@nrwl/nx`),
      insertImport(source, modulePath, 'LoadData, DataLoaded', actionsFile),
      insertImport(source, modulePath, `${clazzName}`, featureInterfaces),
      updateConstructor(),
      addEffect()
    ]);
  };
}

function addImportsToModule(context: RequestContext): Rule {
  return (host: Tree) => {
    if (context.options.onlyAddFiles) {
      return host;
    }

    if (!host.exists(context.options.module)) {
      throw new Error('Specified module does not exist');
    }

    const modulePath = context.options.module;

    const sourceText = host.read(modulePath)!.toString('utf-8');
    const source = ts.createSourceFile(
      modulePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true
    );

    if (context.options.onlyEmptyRoot) {
      insert(host, modulePath, [
        insertImport(source, modulePath, 'StoreModule', '@ngrx/store'),
        insertImport(source, modulePath, 'EffectsModule', '@ngrx/effects'),
        insertImport(
          source,
          modulePath,
          'StoreDevtoolsModule',
          '@ngrx/store-devtools'
        ),
        insertImport(
          source,
          modulePath,
          'environment',
          '../environments/environment'
        ),
        insertImport(
          source,
          modulePath,
          'StoreRouterConnectingModule',
          '@ngrx/router-store'
        ),
        insertImport(source, modulePath, 'storeFreeze', 'ngrx-store-freeze'),
        ...addImportToModule(
          source,
          modulePath,
          `StoreModule.forRoot({},{metaReducers: !environment.production ? [storeFreeze] : []})`
        ),
        ...addImportToModule(source, modulePath, `EffectsModule.forRoot([])`),
        ...addImportToModule(
          source,
          modulePath,
          `!environment.production ? StoreDevtoolsModule.instrument() : []`
        ),
        ...addImportToModule(source, modulePath, `StoreRouterConnectingModule`)
      ]);
      return host;
    } else {
      const reducerPath = `./${toFileName(
        context.options.directory
      )}/${toFileName(context.featureName)}.reducer`;
      const effectsPath = `./${toFileName(
        context.options.directory
      )}/${toFileName(context.featureName)}.effects`;
      const initPath = `./${toFileName(context.options.directory)}/${toFileName(
        context.featureName
      )}.init`;

      const reducerName = `${toPropertyName(context.featureName)}Reducer`;
      const effectsName = `${toClassName(context.featureName)}Effects`;
      const initName = `${toPropertyName(context.featureName)}InitialState`;

      const common = [
        insertImport(source, modulePath, 'StoreModule', '@ngrx/store'),
        insertImport(source, modulePath, 'EffectsModule', '@ngrx/effects'),
        insertImport(source, modulePath, reducerName, reducerPath),
        insertImport(source, modulePath, initName, initPath),
        insertImport(source, modulePath, effectsName, effectsPath),
        ...addProviderToModule(source, modulePath, effectsName)
      ];

      if (context.options.root) {
        insert(host, modulePath, [
          ...common,
          insertImport(
            source,
            modulePath,
            'StoreDevtoolsModule',
            '@ngrx/store-devtools'
          ),
          insertImport(
            source,
            modulePath,
            'environment',
            '../environments/environment'
          ),
          insertImport(
            source,
            modulePath,
            'StoreRouterConnectingModule',
            '@ngrx/router-store'
          ),
          insertImport(source, modulePath, 'storeFreeze', 'ngrx-store-freeze'),
          ...addImportToModule(
            source,
            modulePath,
            `StoreModule.forRoot({${toPropertyName(
              context.featureName
            )}: ${reducerName}}, {
              initialState: {${toPropertyName(
                context.featureName
              )}: ${initName}},
              metaReducers: !environment.production ? [storeFreeze] : []
            })`
          ),
          ...addImportToModule(
            source,
            modulePath,
            `EffectsModule.forRoot([${effectsName}])`
          ),
          ...addImportToModule(
            source,
            modulePath,
            `!environment.production ? StoreDevtoolsModule.instrument() : []`
          ),
          ...addImportToModule(
            source,
            modulePath,
            `StoreRouterConnectingModule`
          )
        ]);
      } else {
        insert(host, modulePath, [
          ...common,
          ...addImportToModule(
            source,
            modulePath,
            `StoreModule.forFeature('${toPropertyName(
              context.featureName
            )}', ${reducerName}, {initialState: ${initName}})`
          ),
          ...addImportToModule(
            source,
            modulePath,
            `EffectsModule.forFeature([${effectsName}])`
          )
        ]);
      }

      return host;
    }
  };
}

function addNgRxToPackageJson() {
  return (host: Tree) => {
    if (!host.exists('package.json')) return host;

    const sourceText = host.read('package.json')!.toString('utf-8');
    const json = JSON.parse(sourceText);
    if (!json['dependencies']) {
      json['dependencies'] = {};
    }

    if (!json['dependencies']['@ngrx/store']) {
      json['dependencies']['@ngrx/store'] = ngrxVersion;
    }
    if (!json['dependencies']['@ngrx/effects']) {
      json['dependencies']['@ngrx/effects'] = ngrxVersion;
    }
    if (!json['dependencies']['@ngrx/entity']) {
      json['dependencies']['@ngrx/entity'] = ngrxVersion;
    }
    if (!json['dependencies']['@ngrx/store-devtools']) {
      json['dependencies']['@ngrx/store-devtools'] = ngrxVersion;
    }
    if (!json['dependencies']['@ngrx/router-store']) {
      json['dependencies']['@ngrx/router-store'] = routerStoreVersion;
    }
    if (!json['dependencies']['ngrx-store-freeze']) {
      json['dependencies']['ngrx-store-freeze'] = ngrxStoreFreezeVersion;
    }

    host.overwrite('package.json', serializeJson(json));
    return host;
  };
}

/**
 * @ngrx/schematics generates files in:
 *    `/apps/<ngrxFeatureName>/`
 *
 * For Nx monorepo, however, we need to move the files to either
 *  a) apps/<appName>/src/app/<directory>, or
 *  b) libs/<libName>/src/<directory>
 */
function moveToNxMonoTree(ngrxFeatureName, nxDir, directory): Rule {
  return move(`app/${ngrxFeatureName}`, path.join(nxDir, directory));
}

/**
 * Extract the parent 'directory' for the specified
 */
function normalizeOptions(options: NgrxOptions): NgrxOptions {
  return { ...options, directory: toFileName(options.directory) };
}

function buildNameToNgrxFile(context: RequestContext, suffice: string) {
  return path.join(
    context.moduleDir,
    context.options.directory,
    `${stringUtils.dasherize(context.featureName)}.${suffice}`
  );
}
