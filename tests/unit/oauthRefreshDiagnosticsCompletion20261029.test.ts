// @vitest-environment node
import {expect,it} from 'vitest'
import {ChatGPTOAuthClient,oauthMachineError} from '../../src/main/workbench/providers/ChatGPTOAuthClient'
const connection={id:'connection',revision:1,provider:'openai',protocol:'chatgpt-responses',baseURL:'https://chatgpt.com/backend-api/codex',accountId:'account',auth:{kind:'oauth',credentialRef:'credential'},billing:{kind:'subscription'},capabilities:{tools:'unknown',vision:'unknown',stream:'unknown',reasoning:'unknown'}} as const
const integration={clientId:'public-client',redirectURI:'http://localhost:1455/auth/callback',originator:'guoling',persistence:{
 async read(){return {version:1,credential:{connectionId:'connection',revision:1,accountId:'account',accessToken:'private-access',refreshToken:'private-refresh-token',expiresAt:0}}},
 async compareAndSet(){throw new Error('failed refresh must not persist or revoke')},async withLease<T>(_ref:string,work:()=>Promise<T>){return work()}
}}
it.each(['invalid_grant','invalid_client','refresh_token_reused','refresh_token_expired'] as const)('refresh preserves only allowed machine error %s, never descriptions or credentials',async code=>{
 const client=new ChatGPTOAuthClient({...integration,fetch:async()=>Response.json({error:{code,message:'secret-refresh-token-and-account'},error_description:'hidden-provider-details'},{status:401})})
 const error=await client.resolveCredential(connection).catch(error=>error)
 expect(error).toMatchObject({code:'http-401',httpStatus:401,phase:'refresh',machineError:code})
 expect(JSON.stringify(error)+String(error)).not.toMatch(/secret|private-refresh-token|hidden-provider/)
})
it('unknown error codes and oversized bodies are discarded rather than leaked to diagnostics',async()=>{
 expect(oauthMachineError({error:'private-refresh-token'})).toBe('unknown_oauth_error')
 const client=new ChatGPTOAuthClient({...integration,fetch:async()=>new Response(JSON.stringify({error:'invalid_grant',description:'X'.repeat(32*1024)}),{status:401})})
 const error=await client.resolveCredential(connection).catch(error=>error)
 expect(error.machineError).toBe('unknown_oauth_error');expect(String(error).length).toBeLessThan(200)
})
