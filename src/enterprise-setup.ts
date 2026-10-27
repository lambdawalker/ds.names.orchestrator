import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {readVault,updateVault} from './vault.js';
const Bundle=z.strictObject({username:z.string().min(1).max(256),accessToken:z.string().min(1).max(12000),refreshToken:z.string().min(1).max(12000),expiresAt:z.number().finite().nonnegative()});
type Loader=(url:string)=>Promise<unknown>;
/** Loads the same trusted sibling checkout the operator configured for managed execution. */
export async function saveEnterpriseLogin(file:string,passphrase:string,directory:string,username:string,password:string,load:Loader=url=>import(url)):Promise<void>{
 const entries=await readVault(file,passphrase);for(const key of Object.keys(entries))delete entries[key];
 const adapter=await load(pathToFileURL(resolve(directory,'dist/index.js')).href);
 if(!adapter||typeof adapter!=='object'||!('login'in adapter)||typeof adapter.login!=='function')throw Error('Build the Wikimedia Enterprise client before login');
 const bundle=Bundle.parse(await adapter.login(username,password));const value=JSON.stringify(bundle);if(value.length>16384)throw Error('Enterprise credential bundle exceeds vault limit');
 await updateVault(file,passphrase,{'wikimedia-enterprise':value});
}
