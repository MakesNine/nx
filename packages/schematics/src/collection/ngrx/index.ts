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
  addProviderToModule
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
      addLoadDataToActions(context),
      // addDataLoadedToReducer(context),

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
    moveToNxMonoTree(context.featureName, context.moduleDir)
  ]);
}

/**
 * Add LoadData and DataLoaded actions to <featureName>.actions.ts
 * See Ngrx Enhancement doc:  https://bit.ly/2I5QwxQ
 */
function addLoadDataToActions(context: RequestContext): Rule {
  return (host: Tree) => {
    const clazzName = toClassName(context.featureName);
    const componentPath = `${context.moduleDir}/+state/${stringUtils.dasherize(
      context.featureName
    )}.actions.ts`;

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
function addDataLoadedToReducer(context: RequestContext): Rule {
  return noop();
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
 *  a) apps/<appName>/src/app/+state, or
 *  b) libs/<libName>/src/+state
 */
function moveToNxMonoTree(ngrxFeatureName, nxDir): Rule {
  return move(`app/${ngrxFeatureName}`, path.join(nxDir, '+state'));
}

/**
 * Extract the parent 'directory' for the specified
 */
function normalizeOptions(options: NgrxOptions): NgrxOptions {
  return { ...options, directory: toFileName(options.directory) };
}
