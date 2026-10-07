declare module "convex/server" {
  export type FunctionVisibility = "public" | "internal";
  export type GenericDataModel = any;

  // ---------------------------------------------------------------------------
  // API typing (keep permissive to avoid TS2589 in large schemas)
  // ---------------------------------------------------------------------------
  // Match the structural shape used by Convex so helper generics (e.g. ctx.runQuery)
  // don't collapse to `never`.
  export type FunctionReference<
    Type extends any = any,
    Visibility extends FunctionVisibility = "public",
    Args extends any = any,
    ReturnType = any,
    ComponentPath = string | undefined,
  > = {
    _type: Type;
    _visibility: Visibility;
    _args: Args;
    _returnType: ReturnType;
    _componentPath: ComponentPath;
  };

  export type AnyFunctionReference = FunctionReference<any, any, any, any>;
  export type FilterApi<_API, _Predicate> = any;
  export type ApiFromModules<_AllModules extends Record<string, object>> = any;

  export const anyApi: any;
  export const componentsGeneric: any;

  // ---------------------------------------------------------------------------
  // Schema helpers
  // ---------------------------------------------------------------------------
  export const defineSchema: any;
  export const defineTable: any;
  export const defineApp: any;
  export const cronJobs: any;
  export const httpRouter: any;
  export const paginationOptsValidator: any;

  // ---------------------------------------------------------------------------
  // Database stubs (return `any` to avoid cascading `{}` / `unknown` errors)
  // ---------------------------------------------------------------------------
  export interface QueryStub {
    [Symbol.asyncIterator](): AsyncIterator<any>;
    withIndex(_indexName: string, _cb?: (q: any) => any): QueryStub;
    withSearchIndex(_indexName: string, _cb?: (q: any) => any): QueryStub;
    filter(_cb: (q: any) => any): QueryStub;
    order(_direction: any): QueryStub;
    take(_n: number): Promise<any[]>;
    first(): Promise<any>;
    unique(): Promise<any>;
    collect(): Promise<any[]>;
    paginate(_paginationOpts: any): Promise<any>;
  }

  export interface GenericDatabaseReader<_DataModel = any> {
    get(_id: any): Promise<any>;
    query(_tableName: string): QueryStub;
  }

  export interface GenericDatabaseWriter<_DataModel = any> extends GenericDatabaseReader<_DataModel> {
    insert(_tableName: string, _value: any): Promise<any>;
    patch(_id: any, _value: any): Promise<void>;
    delete(_id: any): Promise<void>;
  }

  export interface GenericQueryCtx<_DataModel = any> {
    db: GenericDatabaseReader<_DataModel>;
    runQuery: any;
    runMutation: any;
    runAction: any;
    auth: any;
    scheduler?: any;
    storage: any;
    vectorSearch?: any;
  }

  export interface GenericMutationCtx<_DataModel = any> {
    db: GenericDatabaseWriter<_DataModel>;
    runQuery: any;
    runMutation: any;
    runAction: any;
    auth: any;
    scheduler?: any;
    storage: any;
    vectorSearch?: any;
  }

  export interface GenericActionCtx<_DataModel = any> {
    db: GenericDatabaseWriter<_DataModel>;
    runQuery: any;
    runMutation: any;
    runAction: any;
    auth: any;
    scheduler?: any;
    storage: any;
    vectorSearch?: any;
  }

  // ---------------------------------------------------------------------------
  // Function wrappers (typed loosely)
  // ---------------------------------------------------------------------------
  export type QueryBuilder<_DataModel extends GenericDataModel = any, _Visibility extends FunctionVisibility = any> = (
    def:
      | {
          args?: any;
          returns?: any;
          handler: (ctx: GenericQueryCtx<_DataModel>, args: any) => any;
        }
      | ((ctx: GenericQueryCtx<_DataModel>, args: any) => any),
  ) => any;

  export type MutationBuilder<_DataModel extends GenericDataModel = any, _Visibility extends FunctionVisibility = any> =
    (
      def:
        | {
            args?: any;
            returns?: any;
            handler: (ctx: GenericMutationCtx<_DataModel>, args: any) => any;
          }
        | ((ctx: GenericMutationCtx<_DataModel>, args: any) => any),
    ) => any;

  export type ActionBuilder<_DataModel extends GenericDataModel = any, _Visibility extends FunctionVisibility = any> = (
    def:
      | {
          args?: any;
          returns?: any;
          handler: (ctx: GenericActionCtx<_DataModel>, args: any) => any;
        }
      | ((ctx: GenericActionCtx<_DataModel>, args: any) => any),
  ) => any;

  export type HttpActionBuilder = (handler: (ctx: GenericActionCtx<any>, request: Request) => any) => any;

  // ---------------------------------------------------------------------------
  // Registered function marker types (needed by generated API typing)
  // ---------------------------------------------------------------------------
  export type RegisteredQuery<_Visibility = any, _Args = any, _Return = any> = { isConvexFunction: true } & any;
  export type RegisteredMutation<_Visibility = any, _Args = any, _Return = any> = { isConvexFunction: true } & any;
  export type RegisteredAction<_Visibility = any, _Args = any, _Return = any> = { isConvexFunction: true } & any;
}
