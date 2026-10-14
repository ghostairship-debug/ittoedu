import type {PublishedCourseV3,PublishedInstance} from '../../../shared/contracts/component-platform/published'
import type {CompiledScriptDiagnostic,compilePublishedWebProgram} from './compiledScript'
import type {WebRuntimeData} from '../../../components/web/moduleGraph'
export const unsupportedJavascriptSubmitAttribute='data-guoling-unsupported-javascript-submit'
export const compiledLocalParentProperty='__guoling_compiled_local_parent__'
export const compiledNativeChildDiagnosticProperty='__guoling_compiled_native_child_diagnostic__'
export interface CompiledClassicProgramSource {index:number;kind:'blocking'|'defer'|'async';factorySource:string}
export interface PreparedClassicProgram {index:number;kind:CompiledClassicProgramSource['kind'];activate:(globals:Record<string,unknown>)=>unknown}
export interface CompiledWebModuleActivation {
 index:number;kind:'defer'|'async'
 start(isActive:()=>boolean):{started:Promise<void>;completion:Promise<unknown>}
}
export interface CompiledWebRuntimeImportPort {
 assertActive():void
 validate(options:unknown):Promise<void>
 reject(specifier:unknown,options?:unknown):Promise<never>
 native:{URL:typeof URL;decodeURI:typeof decodeURI}
}
export interface CompiledWebModuleProgram {entries:readonly CompiledWebModuleActivation[];ready:Promise<unknown[]>;startAll(isActive:()=>boolean):Promise<unknown[]>;configureRuntimeImport?:(port:CompiledWebRuntimeImportPort)=>void}
export interface CompiledWebInitialization {classicPrograms:readonly PreparedClassicProgram[];handlerFactories:readonly ((globals:Record<string,unknown>)=>unknown)[]}
export type CompiledWebProgram=ReturnType<typeof compilePublishedWebProgram> & {declarations?:string[];fixedViewport?:boolean;fragment?:boolean;semanticData?:{data:WebRuntimeData;declarations?:string[]};nativeData?:WebRuntimeData}
export interface CompiledCoursePlayback {
 format:'compiled-course-v1'; id:string; title:string; html:string
 course:PublishedCourseV3
 staticViews:Record<string,Array<{signature:string;html:string}>>
 webPrograms:Record<string,Array<{signature:string;program:CompiledWebProgram}>>
 sourceStyles:Record<string,string>
 sourceFactories:Record<string,string>
 /** Custom source modules execute in a native content document, without local Window rewriting. */
 nativeSources?:Record<string,{code:string;css:string}>
 builtinFactories:Record<string,string>
 staticKeys:string[]
 diagnostics:Array<CompiledScriptDiagnostic & {instanceId?:string}>
}
export function compiledViewSignature(instance:PublishedInstance):string{return JSON.stringify([instance.data,instance.frame,instance.style])}
export function compiledProgramSignature(instance:PublishedInstance):string { const data=instance.data as unknown as WebRuntimeData;return JSON.stringify([data.html,data.css,data.moduleGraph]) }
