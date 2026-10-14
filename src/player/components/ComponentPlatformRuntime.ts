import {ComponentRuntimeWorld} from './ComponentRuntimeWorld'
import {defaultBuiltinRuntimeImplementations} from './defaultBuiltinRuntimeImplementations'
/** The editable host supplies its established professional registry to the shared World. */
export class ComponentPlatformRuntime extends ComponentRuntimeWorld {
 constructor(runScopeId:string,options:ConstructorParameters<typeof ComponentRuntimeWorld>[1]={}){super(runScopeId,{...options,builtinFactory:options.builtinFactory??defaultBuiltinRuntimeImplementations})}
}
