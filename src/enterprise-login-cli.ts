#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {ConfigSchema} from './config.js';
import {readConfigFile} from './yaml-config.js';
import {readSecret} from './secret-input.js';
import {readVault} from './vault.js';
import {saveEnterpriseLogin} from './enterprise-setup.js';
try{
 const {values,positionals}=parseArgs({allowPositionals:true,options:{config:{type:'string',default:'config.default.yaml'},file:{type:'string'}}});if(positionals.length)throw Error('arguments');
 const config=ConfigSchema.parse(await readConfigFile(values.config!));const entry=config.services['wikimedia-enterprise'];if(!entry)throw Error('configuration');
 const passphrase=await readSecret('Vault passphrase: '),file=values.file??config.vaultFile;
 const check=await readVault(file,passphrase);for(const key of Object.keys(check))delete check[key];
 const username=await readSecret('Enterprise username: '),password=await readSecret('Enterprise password: ');
 await saveEnterpriseLogin(file,passphrase,entry.directory,username,password);
 console.error('Enterprise tokens saved in the encrypted vault. Enable wikimedia-enterprise in your service YAML when ready.');
}catch{console.error('Enterprise setup failed; check the vault passphrase, configured client build, account credentials and provider availability.');process.exitCode=1;}
