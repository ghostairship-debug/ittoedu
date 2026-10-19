import { parse } from '@babel/parser'
import { componentModuleSource } from './componentCompilationInput'
import { componentModuleFileExtensions, componentModuleSpecifier } from '../source/moduleSpecifier'
import type { DocumentResources } from '../../../shared/workbench/document'
import type { ComponentImplementation, CourseProjectV10 } from '../../../shared/contracts/component-platform/project'

export type SourceSyntaxNode = {type:string;start:number;end:number;[key:string]:unknown}
type SyntaxNode = SourceSyntaxNode
type Scope = {parent?:Scope;functionScope:boolean;bindings:Set<string>}
const syntaxNode=(value:unknown):value is SyntaxNode=>!!value && typeof value==='object' && 'type' in value
/** A capture can share this syntax tree between import and resource analysis. */
export function parseSourceSyntax(source:string): SourceSyntaxNode | undefined {
  const read=(jsx:boolean)=>parse(source,{sourceType:'unambiguous',attachComment:false,allowReturnOutsideFunction:true,
    plugins:jsx ? ['estree','typescript','jsx','decorators']:['estree','typescript','decorators']}).program as unknown as SyntaxNode
  try {return read(false)}catch{try{return read(true)}catch{return undefined}} // The compiler owns source diagnostics.
}
/** Runtime imports and lexical require bindings share the parser for JS, TS and TSX. */
function sourceImports(source:string,readSyntax:(source:string)=>SourceSyntaxNode|undefined):string[] | undefined {
  const imports:string[]=[], root=readSyntax(source)
  if (!root) return undefined
  const scopes=new Map<SyntaxNode,Scope>(),calls:SyntaxNode[]=[]
  const reference=(node:unknown):void=>{if(syntaxNode(node) && typeof node.value==='string')imports.push(node.value)}
  const expression=(value:unknown):unknown=>syntaxNode(value) && ['TSAsExpression','TSTypeAssertion','TSNonNullExpression','TSSatisfiesExpression','TSInstantiationExpression','ParenthesizedExpression'].includes(value.type) ? expression(value.expression):value
  const bind=(node:unknown,scope:Scope):void=>{
    if(!syntaxNode(node))return
    if(node.type==='Identifier')scope.bindings.add(String(node.name))
    else if(node.type==='TSParameterProperty')bind(node.parameter,scope)
    else if(node.type==='RestElement')bind(node.argument,scope)
    else if(node.type==='AssignmentPattern')bind(node.left,scope)
    else if(node.type==='ArrayPattern')for(const item of node.elements as unknown[])bind(item,scope)
    else if(node.type==='ObjectPattern')for(const item of node.properties as SyntaxNode[])bind(item.type==='RestElement' ? item.argument:item.value,scope)
  }
  const visit=(node:SyntaxNode,parent:Scope):void=>{
    if(node.declare===true)return
    if(node.type==='FunctionDeclaration'||node.type==='ClassDeclaration')bind(node.id,parent)
    const isFunction=['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)
    const createsScope=isFunction||['Program','BlockStatement','CatchClause','ForStatement','ForInStatement','ForOfStatement','SwitchStatement','StaticBlock','ClassExpression','TSModuleBlock'].includes(node.type)
    const scope=createsScope ? {parent,functionScope:isFunction||node.type==='Program',bindings:new Set<string>()}:parent
    scopes.set(node,scope)
    if(isFunction){bind(node.id,scope);for(const parameter of node.params as unknown[])bind(parameter,scope)}
    if(node.type==='ClassExpression')bind(node.id,scope)
    if(node.type==='CatchClause')bind(node.param,scope)
    if(node.type==='VariableDeclaration'){
      let owner=scope;if(node.kind==='var')while(!owner.functionScope && owner.parent)owner=owner.parent
      for(const declaration of node.declarations as SyntaxNode[])bind(declaration.id,owner)
    }
    if(node.type==='ImportDeclaration' && node.importKind!=='type'){
      const specifiers=node.specifiers as SyntaxNode[],runtime=specifiers.filter(item=>item.importKind!=='type')
      runtime.forEach(item=>bind(item.local,scope));if(!specifiers.length||runtime.length)reference(node.source)
    }
    if(['ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type) && node.exportKind!=='type'){
      const specifiers=node.specifiers as SyntaxNode[]|undefined;if(!specifiers?.length || specifiers.some(item=>item.exportKind!=='type'))reference(node.source)
    }
    if(node.type==='ImportExpression')reference(node.source)
    if(node.type==='TSImportEqualsDeclaration' && node.importKind!=='type'){bind(node.id,scope);if(syntaxNode(node.moduleReference) && node.moduleReference.type==='TSExternalModuleReference')reference(node.moduleReference.expression)}
    const callee=expression(node.callee)
    if(node.type==='CallExpression' && syntaxNode(callee) && callee.type==='Identifier' && callee.name==='require')calls.push(node)
    for(const value of Object.values(node)){
      if(syntaxNode(value))visit(value,scope)
      else if(Array.isArray(value))for(const child of value)if(syntaxNode(child))visit(child,scope)
    }
  }
  visit(root,{functionScope:true,bindings:new Set()})
  for(const call of calls){let scope=scopes.get(call);while(scope && !scope.bindings.has('require'))scope=scope.parent;if(!scope)reference((call.arguments as unknown[])[0])}
  return imports
}
/** Resolve only imports reachable from the current author entry. Dormant bindings do not affect its content. */
export function liveSourceOwners(project:CourseProjectV10,implementation:ComponentImplementation,resources?:DocumentResources,
  importsCache?:Map<string,string[]|undefined>, readSyntax:(source:string)=>SourceSyntaxNode|undefined=parseSourceSyntax) {
  const definitions=new Set<string>(),owners=new Set<string>(),visited=new Set<ComponentImplementation>()
  const sources = new Map<Extract<ComponentImplementation, { kind: 'source' }>, string[]>()
  const modules = new Map<Extract<ComponentImplementation, { kind: 'source' }>, Set<string>>()
  const normalize=(path:string)=>{const parts:string[]=[];for(const part of path.split('/')){if(part==='..')parts.pop();else if(part && part!=='.')parts.push(part)}return parts.join('/')}
  const visit=(source:ComponentImplementation)=>{
    if(source.kind!=='source'||visited.has(source))return;visited.add(source)
    if(source.workspace)owners.add(source.workspace.ownerId)
    let module:ReturnType<typeof componentModuleSource>;try{module=componentModuleSource(source,resources)}catch{return}
    const texts: string[] = []; sources.set(source, texts)
    const dependencies = new Set<string>(); modules.set(source, dependencies)
    const files=new Set<string>(),pending=[module.entry]
    while(pending.length){const file=pending.pop()!;if(files.has(file))continue;files.add(file)
      // Supported CSS/JSON imports are data leaves, never resources API programs.
      // Their workspace bytes and declared bindings remain owned by this source.
      if (/\.(?:css|json)$/i.test(file)) continue
      const text = module.files[file] ?? ''; texts.push(text)
      // Import syntax depends on source bytes. Bindings remain scoped to each
      // owner below, so a capture can share parsing without sharing identities.
      const references = importsCache?.has(text) ? importsCache.get(text) : sourceImports(text,readSyntax)
      if (importsCache && !importsCache.has(text)) importsCache.set(text, references)
      // An unfinished author entry is repairable input, not proof of zero dependencies.
      if (!references) for (const id of Object.values(module.moduleBindings ?? {})) {
        dependencies.add(id)
        const definition = Object.hasOwn(project.definitions, id) ? project.definitions[id] : undefined
        if (definition?.implementation.kind === 'source') { definitions.add(id); visit(definition.implementation) }
      }
      for(const reference of references ?? []) {
        const specifier=componentModuleSpecifier(reference),bindings=module.moduleBindings ?? {}
        const id=Object.hasOwn(bindings,reference) ? bindings[reference] : Object.hasOwn(bindings,specifier.pathname) ? bindings[specifier.pathname] : !reference.startsWith('.') ? specifier.pathname : undefined
        if(id!==undefined){dependencies.add(id);const definition=Object.hasOwn(project.definitions,id) ? project.definitions[id]:undefined;if(definition?.implementation.kind==='source'){definitions.add(id);visit(definition.implementation)};continue}
        if(reference.startsWith('.')){const base=normalize(file.slice(0,file.lastIndexOf('/')+1)+specifier.pathname),next=componentModuleFileExtensions.map(extension=>base+extension).find(value=>Object.hasOwn(module.files,value));if(next)pending.push(next)}
      }
    }
  }
  visit(implementation);return {definitions,owners,sources,modules}
}
