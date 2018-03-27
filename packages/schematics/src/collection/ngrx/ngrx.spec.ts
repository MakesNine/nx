import { SchematicTestRunner } from '@angular-devkit/schematics/testing';
import { Tree, VirtualTree } from '@angular-devkit/schematics';
import { getFileContent } from '@schematics/angular/utility/test';

import * as path from 'path';
import { findModuleParent } from '../../utils/name-utils';
import {
  createApp,
  createEmptyWorkspace,
  AppConfig,
  getAppConfig
} from '../../utils/testing-utils';

describe('ngrx', () => {
  const schematicRunner = new SchematicTestRunner(
    '@nrwl/schematics',
    path.join(__dirname, '../../collection.json')
  );

  let appTree: Tree;

  beforeEach(() => {
    appTree = new VirtualTree();
    appTree = createEmptyWorkspace(appTree);
    appTree = createApp(appTree, 'myapp');
  });

  it('should add empty root', () => {
    const tree = schematicRunner.runSchematic(
      'ngrx',
      {
        name: 'state',
        module: 'apps/myapp/src/app/app.module.ts',
        onlyEmptyRoot: true
      },
      appTree
    );

    const appModule = getFileContent(tree, '/apps/myapp/src/app/app.module.ts');
    expect(appModule).toContain(
      'StoreModule.forRoot({},{metaReducers: !environment.production ? [storeFreeze] : []})'
    );
    expect(appModule).toContain('EffectsModule.forRoot');

    expect(tree.exists('apps/myapp/src/app/+state')).toBeFalsy();
  });

  it('should add root', () => {
    const tree = schematicRunner.runSchematic(
      'ngrx',
      {
        name: 'state',
        module: 'apps/myapp/src/app/app.module.ts',
        root: true
      },
      appTree
    );

    const appModule = getFileContent(tree, '/apps/myapp/src/app/app.module.ts');
    expect(appModule).toContain('StoreModule.forRoot');
    expect(appModule).toContain('EffectsModule.forRoot');
    expect(appModule).toContain('!environment.production ? [storeFreeze] : []');

    expect(
      tree.exists(`/apps/myapp/src/app/+state/state.actions.ts`)
    ).toBeTruthy();
    expect(
      tree.exists(`/apps/myapp/src/app/+state/state.effects.ts`)
    ).toBeTruthy();
    expect(
      tree.exists(`/apps/myapp/src/app/+state/state.effects.spec.ts`)
    ).toBeTruthy();
    expect(
      tree.exists(`/apps/myapp/src/app/+state/state.init.ts`)
    ).toBeTruthy();
    expect(
      tree.exists(`/apps/myapp/src/app/+state/state.interfaces.ts`)
    ).toBeTruthy();
    expect(
      tree.exists(`/apps/myapp/src/app/+state/state.reducer.ts`)
    ).toBeTruthy();
    expect(
      tree.exists(`/apps/myapp/src/app/+state/state.reducer.spec.ts`)
    ).toBeTruthy();
  });

  it('should add feature', () => {
    const tree = schematicRunner.runSchematic(
      'ngrx',
      {
        name: 'state',
        module: 'apps/myapp/src/app/app.module.ts'
      },
      appTree
    );

    const appModule = getFileContent(tree, '/apps/myapp/src/app/app.module.ts');
    expect(appModule).toContain('StoreModule.forFeature');
    expect(appModule).toContain('EffectsModule.forFeature');
    expect(appModule).not.toContain(
      '!environment.production ? [storeFreeze] : []'
    );

    expect(
      tree.exists(`/apps/myapp/src/app/+state/state.actions.ts`)
    ).toBeTruthy();
  });

  it('should add with custom directoryName', () => {
    const tree = schematicRunner.runSchematic(
      'ngrx',
      {
        name: 'state',
        module: 'apps/myapp/src/app/app.module.ts',
        directory: 'myCustomState'
      },
      appTree
    );

    const appModule = getFileContent(tree, '/apps/myapp/src/app/app.module.ts');
    expect(appModule).toContain('StoreModule.forFeature');
    expect(appModule).toContain('EffectsModule.forFeature');
    expect(appModule).not.toContain(
      '!environment.production ? [storeFreeze] : []'
    );

    expect(
      tree.exists(`/apps/myapp/src/app/my-custom-state/state.actions.ts`)
    ).toBeTruthy();
  });

  it('should only add files', () => {
    const tree = schematicRunner.runSchematic(
      'ngrx',
      {
        name: 'state',
        module: 'apps/myapp/src/app/app.module.ts',
        onlyAddFiles: true
      },
      appTree
    );

    const appModule = getFileContent(tree, '/apps/myapp/src/app/app.module.ts');
    expect(appModule).not.toContain('StoreModule');
    expect(appModule).not.toContain(
      '!environment.production ? [storeFreeze] : []'
    );

    expect(
      tree.exists(`/apps/myapp/src/app/+state/state.actions.ts`)
    ).toBeTruthy();
  });

  it('should update package.json', () => {
    const tree = schematicRunner.runSchematic(
      'ngrx',
      {
        name: 'state',
        module: 'apps/myapp/src/app/app.module.ts'
      },
      appTree
    );
    const packageJson = JSON.parse(getFileContent(tree, '/package.json'));

    expect(packageJson.dependencies['@ngrx/store']).toBeDefined();
    expect(packageJson.dependencies['@ngrx/router-store']).toBeDefined();
    expect(packageJson.dependencies['@ngrx/effects']).toBeDefined();
    expect(packageJson.dependencies['ngrx-store-freeze']).toBeDefined();
  });

  it('should error when no module is provided', () => {
    expect(() =>
      schematicRunner.runSchematic(
        'ngrx',
        {
          name: 'state'
        },
        appTree
      )
    ).toThrow("should have required property 'module'");
  });

  it('should create the ngrx files', () => {
    const appConfig = getAppConfig();
    const hasFile = file => expect(tree.exists(file)).toBeTruthy();
    const tree = schematicRunner.runSchematic(
      'ngrx',
      {
        name: 'user',
        module: appConfig.appModule
      },
      appTree
    );
    // tree.visit((path) => console.log(path));

    const statePath = `${findModuleParent(appConfig.appModule)}/+state`;

    hasFile(`${statePath}/user.actions.ts`);
    hasFile(`${statePath}/user.effects.ts`);
    hasFile(`${statePath}/user.effects.spec.ts`);
    hasFile(`${statePath}/user.reducer.ts`);
    hasFile(`${statePath}/user.reducer.spec.ts`);
    hasFile(`${statePath}/user.init.ts`);
    hasFile(`${statePath}/user.interfaces.ts`);
  });

  it('should create ngrx action enums', () => {
    const appConfig = getAppConfig();
    const tree = schematicRunner.runSchematic(
      'ngrx',
      {
        name: 'user',
        module: appConfig.appModule
      },
      appTree
    );

    const statePath = `${findModuleParent(appConfig.appModule)}/+state`;
    const content = getFileContent(tree, `${statePath}/user.actions.ts`);

    expect(content).toContain('UserActionTypes');
    expect(content).toContain("LoadData = '[User] Load Data'");
    expect(content).toContain("DataLoaded = '[User] Data Loaded'");
  });

  it('should create ngrx action classes', () => {
    const appConfig = getAppConfig();
    const tree = schematicRunner.runSchematic(
      'ngrx',
      {
        name: 'user',
        module: appConfig.appModule
      },
      appTree
    );

    const statePath = `${findModuleParent(appConfig.appModule)}/+state`;
    const content = getFileContent(tree, `${statePath}/user.actions.ts`);

    expect(content).toContain('class LoadData implements Action');
    expect(content).toContain('class DataLoaded implements Action');
  });

  it('should enhance the ngrx action type', () => {
    const appConfig = getAppConfig();
    const tree = schematicRunner.runSchematic(
      'ngrx',
      {
        name: 'user',
        module: appConfig.appModule
      },
      appTree
    );

    const statePath = `${findModuleParent(appConfig.appModule)}/+state`;
    const content = getFileContent(tree, `${statePath}/user.actions.ts`);
    expect(content).toContain(
      'type UserActions = User | LoadData | DataLoaded'
    );
  });

  it('should enhance the ngrx reducer', () => {
    const appConfig = getAppConfig();
    const tree = schematicRunner.runSchematic(
      'ngrx',
      {
        name: 'user',
        module: appConfig.appModule
      },
      appTree
    );

    const statePath = `${findModuleParent(appConfig.appModule)}/+state`;
    const content = getFileContent(tree, `${statePath}/user.reducer.ts`);

    expect(content).not.toContain(`export interface State {  }`);
    expect(content).not.toContain('function reducer');

    expect(content).toContain(`import { User } from \'./user.interfaces\'`);
    expect(content).toContain(
      `import { UserActions, UserActionTypes } from \'./user.actions\'`
    );
    expect(content).toContain('function userReducer');
    expect(content).toContain(
      'function userReducer(state = initialState, action: UserActions): User'
    );
    expect(content).toContain('case UserActionTypes.DataLoaded');
  });

  it('should enhance the ngrx effects', () => {
    const appConfig = getAppConfig();
    const tree = schematicRunner.runSchematic(
      'ngrx',
      {
        name: 'user',
        module: appConfig.appModule
      },
      appTree
    );

    const statePath = `${findModuleParent(appConfig.appModule)}/+state`;
    const content = getFileContent(tree, `${statePath}/user.effects.ts`);
    const firstParam = 'private actions$: Actions';
    const secondParam = 'private dataPersistence: DataPersistence<User>';
    const actionImports = 'UserActions, UserActionTypes, LoadData, DataLoaded';

    expect(content).toContain(`import { DataPersistence } from \'@nrwl/nx\'`);
    expect(content).toContain(
      `import { ${actionImports} } from \'./user.actions\'`
    );
    expect(content).toContain(`constructor(${firstParam}, ${secondParam})`);
  });
});
